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
): Promise<Response | { error: string }> {
  const auth = await getValidGitHubAccessToken(userId);
  if (!auth) {
    return { error: "GitHub is not connected." };
  }

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Aether",
      "X-GitHub-Api-Version": API_VERSION,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    await clearGitHubCookie();
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

  const res = await githubFetch(userId, apiPath);
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

  const res = await githubFetch(userId, apiPath);
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
    // Absolute raw.githubusercontent.com URL — fetch with the same token.
    const auth = await getValidGitHubAccessToken(userId);
    if (!auth) return { ok: false, error: "GitHub is not connected." };
    const raw = await fetch(data.download_url, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "User-Agent": "Aether",
        Accept: "application/vnd.github.raw",
      },
    });
    if (raw.status === 401) {
      await clearGitHubCookie();
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
