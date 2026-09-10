import {
  clearGitHubCookie,
  getValidGitHubAccessToken,
} from "@/lib/github-session";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_FILE_CHARS = 120_000;

export type GitHubRepoRef = {
  owner: string;
  repo: string;
  /** File or directory path inside the repo (no leading slash). */
  path?: string;
  /** Branch, tag, or commit SHA when present in a blob/tree URL. */
  ref?: string;
};

/**
 * Parse `owner/repo`, a github.com URL, or blob/tree deep links.
 * Returns null when the string is not a recognizable GitHub repo reference.
 */
export function parseGitHubRepoRef(input: string): GitHubRepoRef | null {
  const raw = input.trim();
  if (!raw) return null;

  const short = raw.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.*))?$/,
  );
  if (short && !raw.includes("://") && !raw.includes("github.com")) {
    const path = short[3]?.replace(/^\/+|\/+$/g, "") || undefined;
    return { owner: short[1], repo: short[2].replace(/\.git$/, ""), path };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!owner || !repo) return null;

  // /owner/repo/blob|tree/<ref>/<path...>
  if (
    parts.length >= 4 &&
    (parts[2] === "blob" || parts[2] === "tree" || parts[2] === "raw")
  ) {
    const ref = parts[3];
    const path = parts.slice(4).join("/") || undefined;
    return { owner, repo, ref, path };
  }

  return { owner, repo };
}

/** True when the text mentions a github.com repo URL or owner/repo shorthand. */
export function messageMentionsGitHubRepo(text: string): boolean {
  if (!text) return false;
  if (/https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(text)) {
    return true;
  }
  // Conservative shorthand: word/word that looks like a paste of owner/repo.
  return /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/.test(text) &&
    /github/i.test(text);
}

async function githubFetch(
  userId: string,
  path: string,
  init?: RequestInit,
  accessToken?: string,
): Promise<Response | { error: string }> {
  const token =
    accessToken || (await getValidGitHubAccessToken(userId))?.accessToken;
  if (!token) {
    return { error: "GitHub is not connected." };
  }

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Aether",
      "X-GitHub-Api-Version": API_VERSION,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    if (!accessToken) await clearGitHubCookie();
    return { error: "GitHub authorization expired. Reconnect GitHub in Preferences." };
  }

  return res;
}

function resolveRef(input: string): GitHubRepoRef | { error: string } {
  const parsed = parseGitHubRepoRef(input);
  if (!parsed) {
    return {
      error:
        "Could not parse a GitHub repo. Pass owner/repo or a github.com URL.",
    };
  }
  return parsed;
}

export async function githubGetRepoForUser(
  userId: string,
  repo: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  repository?: {
    fullName: string;
    description: string | null;
    defaultBranch: string;
    private: boolean;
    language: string | null;
    htmlUrl: string;
    topics: string[];
  };
}> {
  const ref = resolveRef(repo);
  if ("error" in ref) return { ok: false, error: ref.error };

  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return {
      ok: false,
      error: `GitHub get repo failed (${res.status})`,
    };
  }
  const data = (await res.json()) as {
    full_name?: string;
    description?: string | null;
    default_branch?: string;
    private?: boolean;
    language?: string | null;
    html_url?: string;
    topics?: string[];
  };
  return {
    ok: true,
    repository: {
      fullName: data.full_name ?? `${ref.owner}/${ref.repo}`,
      description: data.description ?? null,
      defaultBranch: data.default_branch ?? "main",
      private: !!data.private,
      language: data.language ?? null,
      htmlUrl: data.html_url ?? `https://github.com/${ref.owner}/${ref.repo}`,
      topics: data.topics ?? [],
    },
  };
}

export async function githubListContentsForUser(
  userId: string,
  repo: string,
  path = "",
  ref?: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  path?: string;
  ref?: string;
  entries?: Array<{
    name: string;
    path: string;
    type: "file" | "dir" | "symlink" | "submodule" | string;
    size?: number;
    sha?: string;
  }>;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const dirPath = (path || parsed.path || "").replace(/^\/+|\/+$/g, "");
  const branch = ref || parsed.ref;
  const apiPath =
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents` +
    (dirPath ? `/${dirPath.split("/").map(encodeURIComponent).join("/")}` : "") +
    (branch ? `?ref=${encodeURIComponent(branch)}` : "");

  const res = await githubFetch(userId, apiPath, undefined, accessToken);
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return {
      ok: false,
      error: `GitHub list contents failed (${res.status})`,
    };
  }

  const data = await res.json();
  // File path → single object; directory → array.
  const items = Array.isArray(data) ? data : [data];
  return {
    ok: true,
    owner: parsed.owner,
    repo: parsed.repo,
    path: dirPath,
    ref: branch,
    entries: items.map(
      (item: {
        name?: string;
        path?: string;
        type?: string;
        size?: number;
        sha?: string;
      }) => ({
        name: item.name ?? "",
        path: item.path ?? "",
        type: item.type ?? "file",
        size: item.size,
        sha: item.sha,
      }),
    ),
  };
}

export async function githubReadFileForUser(
  userId: string,
  repo: string,
  path: string,
  ref?: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  name?: string;
  path?: string;
  text?: string;
  truncated?: boolean;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const filePath = (path || parsed.path || "").replace(/^\/+/, "");
  if (!filePath) {
    return {
      ok: false,
      error: "Pass a file path (e.g. README.md or src/app.ts).",
    };
  }
  const branch = ref || parsed.ref;
  const apiPath =
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/` +
    `${filePath.split("/").map(encodeURIComponent).join("/")}` +
    (branch ? `?ref=${encodeURIComponent(branch)}` : "");

  const res = await githubFetch(userId, apiPath, undefined, accessToken);
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return {
      ok: false,
      error: `GitHub read file failed (${res.status})`,
    };
  }

  const data = (await res.json()) as {
    type?: string;
    name?: string;
    path?: string;
    encoding?: string;
    content?: string;
    size?: number;
    download_url?: string | null;
  };

  if (data.type === "dir") {
    return {
      ok: false,
      error: "Path is a directory. Use github_list_contents instead.",
      name: data.name,
      path: data.path,
    };
  }

  let text = "";
  if (data.encoding === "base64" && typeof data.content === "string") {
    try {
      text = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString(
        "utf8",
      );
    } catch {
      return { ok: false, error: "Could not decode file contents as UTF-8." };
    }
  } else if (data.download_url) {
    // Durable callbacks carry the token explicitly because they have no browser cookie.
    const authToken =
      accessToken || (await getValidGitHubAccessToken(userId))?.accessToken;
    if (!authToken) return { ok: false, error: "GitHub is not connected." };
    const raw = await fetch(data.download_url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "User-Agent": "Aether",
        Accept: "application/vnd.github.raw",
      },
    });
    if (raw.status === 401) {
      if (!accessToken) await clearGitHubCookie();
      return {
        ok: false,
        error: "GitHub authorization expired. Reconnect GitHub in Preferences.",
      };
    }
    if (!raw.ok) {
      return { ok: false, error: `Download failed (${raw.status})` };
    }
    text = await raw.text();
  } else {
    return { ok: false, error: "File has no readable text content." };
  }

  // Reject obvious binary (NUL bytes).
  if (text.includes("\u0000")) {
    return {
      ok: false,
      error: "File looks binary. Attach it in the composer instead.",
      name: data.name,
      path: data.path,
    };
  }

  const truncated = text.length > MAX_FILE_CHARS;
  return {
    ok: true,
    name: data.name,
    path: data.path ?? filePath,
    text: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
    truncated,
  };
}

// ─── Extended read operations ───

export async function githubListIssuesForUser(
  userId: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  issues?: Array<{
    number: number;
    title: string;
    state: string;
    author?: string;
    comments?: number;
    url?: string;
  }>;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues?state=${encodeURIComponent(state)}&per_page=25`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub list issues failed (${res.status})` };
  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    state: string;
    pull_request?: unknown;
    user?: { login?: string };
    comments?: number;
    html_url?: string;
  }>;
  return {
    ok: true,
    issues: data
      .filter((issue) => !issue.pull_request)
      .slice(0, 25)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user?.login,
        comments: issue.comments,
        url: `https://github.com/${parsed.owner}/${parsed.repo}/issues/${issue.number}`,
      })),
  };
}

export async function githubGetIssueForUser(
  userId: string,
  repo: string,
  issueNumber: number,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  issue?: {
    number: number;
    title: string;
    state: string;
    body: string | null;
    author?: string;
    labels: string[];
    url?: string;
  };
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${encodeURIComponent(String(issueNumber))}`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub get issue failed (${res.status})` };
  const data = (await res.json()) as {
    number: number;
    title: string;
    state: string;
    body: string | null;
    user?: { login?: string };
    labels?: Array<{ name?: string }>;
  };
  return {
    ok: true,
    issue: {
      number: data.number,
      title: data.title,
      state: data.state,
      body: data.body,
      author: data.user?.login,
      labels: (data.labels ?? [])
        .map((label) => label.name ?? "")
        .filter(Boolean),
      url: `https://github.com/${parsed.owner}/${parsed.repo}/issues/${issueNumber}`,
    },
  };
}

export async function githubListPullRequestsForUser(
  userId: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  pullRequests?: Array<{
    number: number;
    title: string;
    state: string;
    draft: boolean;
    author?: string;
    branch?: string;
    url?: string;
  }>;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls?state=${encodeURIComponent(state)}&per_page=25`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub list PRs failed (${res.status})` };
  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    user?: { login?: string };
    head?: { ref?: string };
  }>;
  return {
    ok: true,
    pullRequests: data.slice(0, 25).map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: !!pr.draft,
      author: pr.user?.login,
      branch: pr.head?.ref,
      url: `https://github.com/${parsed.owner}/${parsed.repo}/pull/${pr.number}`,
    })),
  };
}

export async function githubGetPullRequestForUser(
  userId: string,
  repo: string,
  pullNumber: number,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  pullRequest?: {
    number: number;
    title: string;
    state: string;
    draft: boolean;
    mergeable: boolean | null;
    author?: string;
    branch?: string;
    base?: string;
    body: string | null;
    changedFiles?: number;
    url?: string;
  };
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub get PR failed (${res.status})` };
  const data = (await res.json()) as {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    body: string | null;
    user?: { login?: string };
    head?: { ref?: string };
    base?: { ref?: string };
    changed_files?: number;
    mergeable?: boolean | null;
  };
  return {
    ok: true,
    pullRequest: {
      number: data.number,
      title: data.title,
      state: data.state,
      draft: !!data.draft,
      mergeable: data.mergeable ?? null,
      author: data.user?.login,
      branch: data.head?.ref,
      base: data.base?.ref,
      body: data.body,
      changedFiles: data.changed_files,
      url: `https://github.com/${parsed.owner}/${parsed.repo}/pull/${pullNumber}`,
    },
  };
}

export async function githubListCommitsForUser(
  userId: string,
  repo: string,
  ref?: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  commits?: Array<{
    sha: string;
    message: string;
    author?: string;
    date?: string;
    url?: string;
  }>;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const sha = ref || parsed.ref;
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits${sha ? `?sha=${encodeURIComponent(sha)}&per_page=25` : "?per_page=25"}`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub list commits failed (${res.status})` };
  const data = (await res.json()) as Array<{
    sha: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
  }>;
  return {
    ok: true,
    commits: data.slice(0, 25).map((entry) => ({
      sha: entry.sha,
      message: (entry.commit?.message ?? "").split("\n")[0] ?? "",
      author: entry.commit?.author?.name,
      date: entry.commit?.author?.date,
      url: `https://github.com/${parsed.owner}/${parsed.repo}/commit/${entry.sha}`,
    })),
  };
}

// ─── Write operations ───

export type RepoOwnership = {
  isOwnedByConnectedUser: boolean;
  hasPush: boolean;
  ownerLogin: string;
  connectedLogin: string;
  private: boolean;
};

/**
 * Classify ownership from real repository metadata — never from model args.
 * Organization-owned repos count as foreign even when the user is a member,
 * because writes there are visible to others.
 */
export async function classifyRepoOwnership(
  userId: string,
  repo: string,
  accessToken?: string,
): Promise<{ ok: true; classification: RepoOwnership } | { ok: false; error: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
    undefined,
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub repo lookup failed (${res.status})` };

  const data = (await res.json()) as {
    owner?: { login?: string };
    private?: boolean;
    permissions?: { push?: boolean; admin?: boolean };
  };
  const connected = accessToken
    ? { login: undefined }
    : await getValidGitHubAccessToken(userId);

  let connectedLogin = connected?.login;
  if (!connectedLogin) {
    const me = await githubFetch(userId, "/user", undefined, accessToken);
    if (!(me instanceof Response) || !me.ok) {
      return { ok: false, error: "Could not verify the connected GitHub account." };
    }
    const meData = (await me.json()) as { login?: string };
    connectedLogin = meData.login;
  }

  const ownerLogin = parsed.owner;
  return {
    ok: true,
    classification: {
      isOwnedByConnectedUser: ownerLogin === connectedLogin,
      hasPush: !!data.permissions?.push || !!data.permissions?.admin,
      ownerLogin,
      connectedLogin: connectedLogin ?? "",
      private: !!data.private,
    },
  };
}

export async function githubCreateBranchForUser(
  userId: string,
  repo: string,
  branchName: string,
  fromRef?: string,
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; branch?: string; url?: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const baseRef = fromRef || parsed.ref;
  const baseRes = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/ref/heads/${encodeURIComponent(baseRef || "main")}`,
    undefined,
    accessToken,
  );
  if (!(baseRes instanceof Response)) return { ok: false, error: baseRes.error };
  if (!baseRes.ok) return { ok: false, error: `Could not find base branch (${baseRes.status})` };
  const baseData = (await baseRes.json()) as {
    object?: { sha?: string };
  };
  const baseSha = baseData.object?.sha;
  if (!baseSha) return { ok: false, error: "Base branch has no head commit." };

  const createRes = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    },
    accessToken,
  );
  if (!(createRes instanceof Response)) return { ok: false, error: createRes.error };
  if (!createRes.ok) {
    return { ok: false, error: `Branch creation failed (${createRes.status})` };
  }
  return {
    ok: true,
    branch: branchName,
    url: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${branchName}`,
  };
}

export async function githubCreateOrUpdateFileForUser(
  userId: string,
  repo: string,
  path: string,
  content: string,
  commitMessage: string,
  branch?: string,
  expectedSha?: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  path?: string;
  commitSha?: string;
  url?: string;
}> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const filePath = path.replace(/^\/+|\/+$/g, "");
  if (!filePath) return { ok: false, error: "A file path is required." };

  let sha = expectedSha;
  if (!sha) {
    const existing = await githubFetch(
      userId,
      `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`,
      undefined,
      accessToken,
    );
    if (existing instanceof Response && existing.status === 404) {
      sha = undefined;
    } else if (!(existing instanceof Response)) {
      return { ok: false, error: existing.error };
    } else if (!existing.ok) {
      return { ok: false, error: `Could not check existing file (${existing.status})` };
    } else {
      const existingData = (await existing.json()) as { sha?: string };
      sha = existingData.sha;
    }
  }

  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(branch ? { branch } : {}),
        ...(sha ? { sha } : {}),
      }),
    },
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 409
          ? "The file changed since you last saw it. Re-read it and try again."
          : `GitHub file write failed (${res.status})`,
    };
  }
  const data = (await res.json()) as {
    commit?: { sha?: string };
    content?: { html_url?: string };
  };
  return {
    ok: true,
    path: filePath,
    commitSha: data.commit?.sha,
    url: data.content?.html_url,
  };
}

export async function githubCreateIssueForUser(
  userId: string,
  repo: string,
  title: string,
  body?: string,
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; number?: number; url?: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`,
    {
      method: "POST",
      body: JSON.stringify({ title, ...(body ? { body } : {}) }),
    },
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub create issue failed (${res.status})` };
  const data = (await res.json()) as { number: number };
  return {
    ok: true,
    number: data.number,
    url: `https://github.com/${parsed.owner}/${parsed.repo}/issues/${data.number}`,
  };
}

export async function githubAddIssueCommentForUser(
  userId: string,
  repo: string,
  issueNumber: number,
  body: string,
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${encodeURIComponent(String(issueNumber))}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: `GitHub comment failed (${res.status})` };
  const data = (await res.json()) as { html_url?: string };
  return { ok: true, url: data.html_url };
}

export async function githubCreatePullRequestForUser(
  userId: string,
  repo: string,
  input: {
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
  },
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; number?: number; url?: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base,
        ...(input.body ? { body: input.body } : {}),
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
      }),
    },
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return { ok: false, error: `GitHub create PR failed (${res.status})` };
  }
  const data = (await res.json()) as { number: number; html_url?: string };
  return { ok: true, number: data.number, url: data.html_url };
}

export async function githubMergePullRequestForUser(
  userId: string,
  repo: string,
  pullNumber: number,
  commitTitle?: string,
  commitMessage?: string,
  mergeMethod: "merge" | "squash" | "rebase" = "squash",
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; merged?: boolean; url?: string }> {
  const parsed = resolveRef(repo);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const res = await githubFetch(
    userId,
    `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${encodeURIComponent(String(pullNumber))}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        commit_title: commitTitle,
        commit_message: commitMessage,
        merge_method: mergeMethod,
      }),
    },
    accessToken,
  );
  if (!(res instanceof Response)) return { ok: false, error: res.error };
  if (!res.ok) {
    return { ok: false, error: `GitHub merge failed (${res.status})` };
  }
  return { ok: true, merged: true };
}
