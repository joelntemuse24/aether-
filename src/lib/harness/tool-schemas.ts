/**
 * Schema-only tools for the first-turn warm path.
 * This module must stay limited to `ai` + `zod` (+ local zod schemas).
 * Heavy execute deps belong on the durable agent, not this import graph.
 */

import { tool, type ToolSet } from "ai";
import {
  TOOL_NAMES,
  executePythonInput,
  webSearchInput,
  createArtifactInput,
  memorySearchInput,
  memoryWriteInput,
  driveSearchInput,
  driveReadInput,
  githubGetRepoInput,
  githubListContentsInput,
  githubReadFileInput,
  githubListIssuesInput,
  githubGetIssueInput,
  githubListPullRequestsInput,
  githubGetPullRequestInput,
  githubListCommitsInput,
  githubCreateBranchInput,
  githubCreateOrUpdateFileInput,
  githubCreateIssueInput,
  githubAddIssueCommentInput,
  githubCreatePullRequestInput,
  githubMergePullRequestInput,
  fetchUrlInput,
  toolSearchInput,
  requestConfirmationInput,
  browserNavigateInput,
  browserActInput,
  workspaceExecInput,
  workspaceReadFileInput,
  workspaceWriteFileInput,
  workspaceListFilesInput,
  workspacePublishFileInput,
  createPresentationInput,
  createSpreadsheetInput,
  createDocumentInput,
  createPdfInput,
  generateImageInput,
  gmailSearchInput,
  gmailReadInput,
  gmailSendInput,
  gmailCreateDraftInput,
  calendarListEventsInput,
  calendarCreateEventInput,
  calendarDeleteEventInput,
  contactsSearchInput,
  contactsCreateInput,
} from "@/lib/tools";
import { verifyChecklistInput } from "@/lib/harness/verify";

export type HeadStartToolCapabilities = {
  toolsEnabled?: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
  hasGmail?: boolean;
  hasCalendar?: boolean;
  hasContacts?: boolean;
};

export function buildHeadStartToolSchemas(
  ctx: HeadStartToolCapabilities = {},
): ToolSet {
  if (ctx.toolsEnabled === false) return {};

  const tools: ToolSet = {
    [TOOL_NAMES.executePython]: tool({
      description:
        "Execute Python code in a sandboxed in-browser Pyodide runtime and return stdout and the final expression value. Use for math, data processing, or verifying code.",
      inputSchema: executePythonInput,
    }),
    [TOOL_NAMES.webSearch]: tool({
      description:
        "Search the web for current or factual information and return a list of result snippets. Prefer few focused queries; near-duplicates are blocked. Do not use for inspecting GitHub repositories — use github_* tools instead.",
      inputSchema: webSearchInput,
    }),
    [TOOL_NAMES.createArtifact]: tool({
      description:
        "Create a rich artifact (code, document, data, image, or svg) shown in the side panel. Prefer for substantial reusable content. Persists to the user's account when signed in with cloud storage.",
      inputSchema: createArtifactInput,
    }),
    [TOOL_NAMES.fetchUrl]: tool({
      description:
        "Fetch a public http(s) URL and return extracted text (HTML stripped). Soft-fails paywalls; PDF text is best-effort. Do not use for github.com repositories — use github_* tools.",
      inputSchema: fetchUrlInput,
    }),
    [TOOL_NAMES.verifyChecklist]: tool({
      description:
        "Run a structured verify pass before handing back substantial work (deep research, essays, multi-step jobs). Call after drafting; fix failed checks or state limits clearly.",
      inputSchema: verifyChecklistInput,
    }),
    [TOOL_NAMES.requestConfirmation]: tool({
      description:
        "Request user approval before any side effect (submit form, send message, upload, irreversible action). Returns needs_confirmation — do not claim the action completed until the user approves.",
      inputSchema: requestConfirmationInput,
    }),
    [TOOL_NAMES.workspaceExec]: tool({
      description:
        "Run a shell command in the conversation's isolated Linux workspace. Use for coding, tests, package installation, data processing, and document generation. Files persist for this conversation.",
      inputSchema: workspaceExecInput,
    }),
    [TOOL_NAMES.workspaceReadFile]: tool({
      description:
        "Read a UTF-8 text file from the isolated conversation workspace.",
      inputSchema: workspaceReadFileInput,
    }),
    [TOOL_NAMES.workspaceWriteFile]: tool({
      description:
        "Create or replace a text file in the isolated conversation workspace. Ordinary user-requested file creation does not need confirmation.",
      inputSchema: workspaceWriteFileInput,
    }),
    [TOOL_NAMES.workspaceListFiles]: tool({
      description:
        "List files and directories in the isolated conversation workspace.",
      inputSchema: workspaceListFilesInput,
    }),
    [TOOL_NAMES.workspacePublishFile]: tool({
      description:
        "Attach a binary file from the isolated workspace (pptx, xlsx, pdf, images) as a downloadable artifact in this thread. Use after workspace_exec writes the file. Ordinary user-requested files do not need confirmation.",
      inputSchema: workspacePublishFileInput,
    }),
    [TOOL_NAMES.createPresentation]: tool({
      description:
        "Build a real PowerPoint (.pptx) from structured slides and attach it in-thread for download. Use this for decks — do not use create_artifact markdown and do not wait on workspace_exec / pip install python-pptx.",
      inputSchema: createPresentationInput,
    }),
    [TOOL_NAMES.createSpreadsheet]: tool({
      description:
        "Build a real Excel workbook (.xlsx) from headers and rows and attach it in-thread for download. Use this for spreadsheets the user asked to download — not a markdown table.",
      inputSchema: createSpreadsheetInput,
    }),
    [TOOL_NAMES.createDocument]: tool({
      description:
        "Build a real Word document (.docx) from a title and paragraphs and attach it in-thread for download. Use this when the user asked for a downloadable document — not a markdown briefing.",
      inputSchema: createDocumentInput,
    }),
    [TOOL_NAMES.createPdf]: tool({
      description:
        "Build a real PDF from a title and paragraphs and attach it in-thread for download. Use this when the user asked for a PDF.",
      inputSchema: createPdfInput,
    }),
    [TOOL_NAMES.generateImage]: tool({
      description:
        "Generate a bitmap image from a text description. Returns an image artifact shown in the side panel. Each generation costs credits — the user confirms first.",
      inputSchema: generateImageInput,
    }),
    [TOOL_NAMES.browserNavigate]: tool({
      description:
        "Open a public URL and extract readable text (fetch mode, or Browserless when configured). Prefer for portal-like pages after the user shares a link. Not for github.com repos.",
      inputSchema: browserNavigateInput,
    }),
    [TOOL_NAMES.browserAct]: tool({
      description:
        "Browser action: extract, fill_preview (no apply), click, or submit. submit and submit-like clicks always return needs_confirmation — never auto-submit.",
      inputSchema: browserActInput,
    }),
  };

  if (ctx.hasMemory) {
    tools[TOOL_NAMES.memorySearch] = tool({
      description:
        "Search the user's curated long-term memory (preferences, people, projects, constraints). Use before assuming you know lasting facts about them. Discover via tool_search first if not already unlocked.",
      inputSchema: memorySearchInput,
    });
    tools[TOOL_NAMES.memoryWrite] = tool({
      description:
        "Write or update a lasting memory about the user (preference, person, project, constraint, writing_voice, belief_or_practice, open_question, note). Only store durable facts they would want remembered across chats. Discover via tool_search first if not already unlocked.",
      inputSchema: memoryWriteInput,
    });
  }

  if (ctx.hasDrive) {
    tools[TOOL_NAMES.driveSearch] = tool({
      description:
        "Search the user's Google Drive by file name. Returns file ids for drive_read. Discover via tool_search first if not already unlocked.",
      inputSchema: driveSearchInput,
    });
    tools[TOOL_NAMES.driveRead] = tool({
      description:
        "Read a Google Drive file as text (Docs/Sheets export or text-like files). Pass a file id from drive_search. Discover via tool_search first if not already unlocked.",
      inputSchema: driveReadInput,
    });
  }

  if (ctx.hasGitHub) {
    tools[TOOL_NAMES.githubGetRepo] = tool({
      description:
        "Get metadata for a GitHub repository the signed-in user can access. Pass owner/repo or a github.com URL. Prefer this over fetch_url/web_search for repos.",
      inputSchema: githubGetRepoInput,
    });
    tools[TOOL_NAMES.githubListContents] = tool({
      description:
        "List files and folders at a path in a GitHub repository. Pass owner/repo (or URL), optional path and ref.",
      inputSchema: githubListContentsInput,
    });
    tools[TOOL_NAMES.githubReadFile] = tool({
      description:
        "Read one text file from a GitHub repository by path (README, source, config). Pass owner/repo (or URL), a single path, optional ref. For multiple files, call this tool multiple times in parallel — never put two JSON objects in one call.",
      inputSchema: githubReadFileInput,
    });
    tools[TOOL_NAMES.githubListIssues] = tool({
      description:
        "List issues in a GitHub repository the signed-in user can access.",
      inputSchema: githubListIssuesInput,
    });
    tools[TOOL_NAMES.githubGetIssue] = tool({
      description: "Read one GitHub issue with its body and labels.",
      inputSchema: githubGetIssueInput,
    });
    tools[TOOL_NAMES.githubListPullRequests] = tool({
      description: "List pull requests in a GitHub repository.",
      inputSchema: githubListPullRequestsInput,
    });
    tools[TOOL_NAMES.githubGetPullRequest] = tool({
      description:
        "Read one GitHub pull request: branch, base, body, changed files count.",
      inputSchema: githubGetPullRequestInput,
    });
    tools[TOOL_NAMES.githubListCommits] = tool({
      description:
        "List recent commits on a GitHub repository branch or ref.",
      inputSchema: githubListCommitsInput,
    });
    tools[TOOL_NAMES.githubCreateBranch] = tool({
      description:
        "Create a new branch in a GitHub repository. Writes to repos the connected user owns run directly; writes to other owners' or organization repos require confirmation.",
      inputSchema: githubCreateBranchInput,
    });
    tools[TOOL_NAMES.githubCreateOrUpdateFile] = tool({
      description:
        "Create or replace one file in a GitHub repository with a commit. Pass expectedSha from a prior read when updating an existing file.",
      inputSchema: githubCreateOrUpdateFileInput,
    });
    tools[TOOL_NAMES.githubCreateIssue] = tool({
      description:
        "Open a new GitHub issue. Always asks for confirmation first — it is visible to others.",
      inputSchema: githubCreateIssueInput,
    });
    tools[TOOL_NAMES.githubAddIssueComment] = tool({
      description:
        "Post a comment on a GitHub issue or pull request. Always asks for confirmation first.",
      inputSchema: githubAddIssueCommentInput,
    });
    tools[TOOL_NAMES.githubCreatePullRequest] = tool({
      description:
        "Open a new GitHub pull request. Always asks for confirmation first.",
      inputSchema: githubCreatePullRequestInput,
    });
    tools[TOOL_NAMES.githubMergePullRequest] = tool({
      description:
        "Merge a GitHub pull request. Always asks for confirmation first.",
      inputSchema: githubMergePullRequestInput,
    });
  }

  if (ctx.hasGmail) {
    tools[TOOL_NAMES.gmailSearch] = tool({
      description:
        "Search the user's Gmail. Supports Gmail operators (from:, is:unread, subject:).",
      inputSchema: gmailSearchInput,
    });
    tools[TOOL_NAMES.gmailRead] = tool({
      description: "Read one email by message id from gmail_search.",
      inputSchema: gmailReadInput,
    });
    tools[TOOL_NAMES.gmailSend] = tool({
      description:
        "Send an email from the user's Gmail. In Ask mode the user confirms first; in Auto it sends directly.",
      inputSchema: gmailSendInput,
    });
    tools[TOOL_NAMES.gmailCreateDraft] = tool({
      description:
        "Create a Gmail draft without sending. Use when the user wants to review before sending.",
      inputSchema: gmailCreateDraftInput,
    });
  }

  if (ctx.hasCalendar) {
    tools[TOOL_NAMES.calendarListEvents] = tool({
      description:
        "List upcoming events on the user's primary calendar.",
      inputSchema: calendarListEventsInput,
    });
    tools[TOOL_NAMES.calendarCreateEvent] = tool({
      description:
        "Create an event on the user's primary calendar. Ordinary creation lands directly; deletion always confirms.",
      inputSchema: calendarCreateEventInput,
    });
    tools[TOOL_NAMES.calendarDeleteEvent] = tool({
      description:
        "Delete a calendar event. Always asks for confirmation first.",
      inputSchema: calendarDeleteEventInput,
    });
  }

  if (ctx.hasContacts) {
    tools[TOOL_NAMES.contactsSearch] = tool({
      description: "Search the user's Google contacts.",
      inputSchema: contactsSearchInput,
    });
    tools[TOOL_NAMES.contactsCreate] = tool({
      description: "Create a Google contact.",
      inputSchema: contactsCreateInput,
    });
  }

  const hasDeferred =
    !!tools[TOOL_NAMES.memorySearch] ||
    !!tools[TOOL_NAMES.driveSearch] ||
    !!tools[TOOL_NAMES.githubGetRepo];

  if (hasDeferred) {
    tools[TOOL_NAMES.toolSearch] = tool({
      description:
        "Discover and unlock optional tools by keyword (memory, Drive, GitHub). Call once with clear capability words — e.g. 'memory preferences', 'google drive files', 'github repository' — then use the unlocked tools in later steps of this turn. Sibling tools unlock together (read+write, full GitHub suite).",
      inputSchema: toolSearchInput,
    });
  }

  return tools;
}
