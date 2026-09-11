import { z } from "zod";
import {
  ARTIFACT_KINDS,
  CANONICAL_ARTIFACT_KINDS,
  type ArtifactKind,
} from "@/lib/artifacts/kinds";

export { ARTIFACT_KINDS, CANONICAL_ARTIFACT_KINDS, type ArtifactKind };

/**
 * Shared tool definitions used by both the server (to declare tools for the
 * model) and the client (to render tool calls and, for client-executed tools,
 * to run them). Keeping the input schemas here guarantees the server and client
 * agree on shapes without duplicating types.
 */

export const TOOL_NAMES = {
  executePython: "execute_python",
  webSearch: "web_search",
  createArtifact: "create_artifact",
  memorySearch: "memory_search",
  memoryWrite: "memory_write",
  driveSearch: "drive_search",
  driveRead: "drive_read",
  driveUpload: "drive_upload",
  driveWrite: "drive_write",
  githubGetRepo: "github_get_repo",
  githubListContents: "github_list_contents",
  githubReadFile: "github_read_file",
  githubListIssues: "github_list_issues",
  githubGetIssue: "github_get_issue",
  githubListPullRequests: "github_list_pull_requests",
  githubGetPullRequest: "github_get_pull_request",
  githubListCommits: "github_list_commits",
  githubCreateBranch: "github_create_branch",
  githubCreateOrUpdateFile: "github_create_or_update_file",
  githubCreateIssue: "github_create_issue",
  githubAddIssueComment: "github_add_issue_comment",
  githubCreatePullRequest: "github_create_pull_request",
  githubMergePullRequest: "github_merge_pull_request",
  fetchUrl: "fetch_url",
  browsePage: "browse_page",
  browserSnapshot: "browser_snapshot",
  searchImages: "search_images",
  /** Deferred discovery — unlocks memory/Drive/GitHub tools into later steps. */
  toolSearch: "tool_search",
  /** Structured verify pass for deep / substantial work. */
  verifyChecklist: "verify_checklist",
  /** Gate side effects until the user approves. */
  requestConfirmation: "request_confirmation",
  /** Open / extract a public page (fetch or Browserless). */
  browserNavigate: "browser_navigate",
  /** Extract, preview fill, or request confirm for click/submit. */
  browserAct: "browser_act",
  workspaceExec: "workspace_exec",
  workspaceReadFile: "workspace_read_file",
  workspaceWriteFile: "workspace_write_file",
  workspaceListFiles: "workspace_list_files",
  workspacePublishFile: "workspace_publish_file",
  createPresentation: "create_presentation",
  createSpreadsheet: "create_spreadsheet",
  createDocument: "create_document",
  createPdf: "create_pdf",
  generateImage: "generate_image",
  gmailSearch: "gmail_search",
  gmailRead: "gmail_read",
  gmailSend: "gmail_send",
  gmailCreateDraft: "gmail_create_draft",
  calendarListEvents: "calendar_list_events",
  calendarCreateEvent: "calendar_create_event",
  calendarDeleteEvent: "calendar_delete_event",
  contactsSearch: "contacts_search",
  contactsCreate: "contacts_create",
  projectKnowledgeSearch: "project_knowledge_search",
  workspaceFfmpeg: "workspace_ffmpeg",
  scheduleCreate: "schedule_create",
  scheduleList: "schedule_list",
  scheduleCancel: "schedule_cancel",
  designList: "design_list",
  designRead: "design_read",
  deploymentsList: "deployments_list",
  deploymentsRead: "deployments_read",
  socialSearch: "social_search",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Tools executed in the browser (no server-side `execute`). */
export const CLIENT_TOOLS: ReadonlySet<string> = new Set([
  TOOL_NAMES.executePython,
]);

export function isClientTool(name: string): boolean {
  return CLIENT_TOOLS.has(name);
}

// ─── Input schemas ───

export const executePythonInput = z.object({
  code: z.string().describe("The Python source code to execute."),
  description: z
    .string()
    .optional()
    .describe("A short description of what the code does."),
});
export type ExecutePythonInput = z.infer<typeof executePythonInput>;

export const executePythonOutput = z.object({
  ok: z.boolean(),
  stdout: z.string().default(""),
  result: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});
export type ExecutePythonOutput = z.infer<typeof executePythonOutput>;

export const webSearchInput = z.object({
  query: z.string().describe("The search query."),
});
export type WebSearchInput = z.infer<typeof webSearchInput>;

export type WebSearchResult = {
  id?: string;
  title: string;
  snippet: string;
  url?: string;
};
export type WebSearchOutput = {
  ok: boolean;
  query: string;
  source?: string;
  results: WebSearchResult[];
  error?: string;
  /** Soft quality note (e.g. encyclopedia-only for a current-facts query). */
  warning?: string;
};

export const createArtifactInput = z.object({
  kind: z
    .enum(ARTIFACT_KINDS)
    .describe(
      "The artifact type: markdown, code, html, react, svg, csv, image, pptx, xlsx, docx, pdf. Aliases document/data/file still work. Use html/react for a live sandboxed preview. Use create_presentation / create_spreadsheet / create_document / create_pdf for real office files.",
    ),
  title: z.string().describe("A short, human-friendly title."),
  language: z
    .string()
    .optional()
    .describe("For code artifacts, the programming language (e.g. 'tsx')."),
  content: z
    .string()
    .describe(
      "The artifact body. Code/markdown/JSON as text, SVG markup for 'svg', or a data URL / https URL for 'image'.",
    ),
});
export type CreateArtifactInput = z.infer<typeof createArtifactInput>;

export type CreateArtifactOutput = {
  ok: boolean;
  kind: ArtifactKind;
  title: string;
  id?: string;
  persisted?: boolean;
  /** Echo of body for client open when tool args were incomplete. */
  content?: string;
  filename?: string;
  mime?: string;
  bytes?: number;
  downloadPath?: string;
  hint?: string;
};

export const memorySearchInput = z.object({
  query: z
    .string()
    .describe("Search query for the user's curated long-term memory."),
});

export const projectKnowledgeSearchInput = z.object({
  query: z.string().describe("Search query over uploaded project knowledge files."),
  projectId: z
    .string()
    .optional()
    .describe("Project id. Defaults to the active project for this chat."),
});
export type ProjectKnowledgeSearchInput = z.infer<
  typeof projectKnowledgeSearchInput
>;

export const memoryWriteInput = z.object({
  id: z.string().optional().describe("Existing memory id to update."),
  type: z
    .enum([
      "preference",
      "person",
      "project",
      "belief_or_practice",
      "open_question",
      "writing_voice",
      "constraint",
      "note",
    ])
    .optional(),
  title: z.string().describe("Short memory title."),
  body: z.string().describe("Memory body / details."),
  importance: z.enum(["low", "normal", "high"]).optional(),
  tags: z.array(z.string()).optional(),
});

export const driveSearchInput = z.object({
  query: z.string().describe("Drive file name search query."),
});

export const driveReadInput = z.object({
  fileId: z.string().describe("Google Drive file id."),
});

export const driveUploadInput = z.object({
  filename: z
    .string()
    .describe("File name with extension (pptx, xlsx, pdf, or docx)."),
  folderId: z
    .string()
    .optional()
    .describe("Drive folder id from drive_search. Omit to save in My Drive."),
  workspacePath: z
    .string()
    .optional()
    .describe("Path of a generated file in the isolated workspace."),
  artifactId: z
    .string()
    .optional()
    .describe("Persisted artifact id to upload."),
  content: z
    .string()
    .optional()
    .describe("data: URL or raw text of the generated file."),
  mimeType: z.string().optional(),
});
export const driveWriteInput = driveUploadInput;

export const githubGetRepoInput = z.object({
  repo: z
    .string()
    .describe(
      "GitHub repository as owner/repo or a github.com URL (blob/tree links are ok).",
    ),
});

export const githubListContentsInput = z.object({
  repo: z
    .string()
    .describe("GitHub repository as owner/repo or a github.com URL."),
  path: z
    .string()
    .optional()
    .describe("Directory path inside the repo (omit for the root)."),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA (defaults to the repo default branch)."),
});

export const githubReadFileInput = z.object({
  repo: z
    .string()
    .describe("GitHub repository as owner/repo or a github.com URL."),
  path: z
    .string()
    .describe(
      "Single file path inside the repo (e.g. README.md). One path per call — for multiple files, issue parallel github_read_file calls.",
    ),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA (defaults to the repo default branch)."),
});

export const fetchUrlInput = z.object({
  url: z.string().url().describe("Public http(s) URL to fetch as text."),
});

export const browsePageInput = z.object({
  url: z.string().url().describe("Public http(s) URL to read."),
  instructions: z
    .string()
    .optional()
    .describe(
      "What to extract (fees, dates, product names). Returns a structured extract focused on that ask.",
    ),
});

export const browserSnapshotInput = z.object({
  url: z.string().url().describe("Public http(s) URL to open."),
  screenshot: z
    .boolean()
    .optional()
    .describe(
      "When true, store a page screenshot as an image artifact the next step can see.",
    ),
});

export const searchImagesInput = z.object({
  query: z.string().min(1).describe("What the images should show."),
});

export const toolSearchInput = z.object({
  query: z
    .string()
    .describe(
      "Keywords for the capability you need (e.g. 'memory preferences', 'google drive files', 'github repository').",
    ),
});
export type ToolSearchInput = z.infer<typeof toolSearchInput>;

export const requestConfirmationInput = z.object({
  action: z
    .enum([
      "submit_form",
      "send_message",
      "upload_file",
      "browser_click_submit",
      "browser_fill_and_submit",
      "delete_resource",
      "other_side_effect",
    ])
    .describe("Kind of side effect that needs approval."),
  title: z.string().describe("Short title for the confirmation card."),
  preview: z
    .string()
    .describe("What will happen if the user approves (plain language)."),
  target: z
    .string()
    .optional()
    .describe("URL or resource label the action targets."),
});

export const browserNavigateInput = z.object({
  url: z.string().url().describe("Public http(s) URL to open and extract."),
});

export const workspaceExecInput = z.object({
  command: z.string().min(1).describe("Shell command to run in the isolated workspace."),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

export const workspaceReadFileInput = z.object({
  path: z.string().min(1).describe("Path relative to the workspace root."),
});

export const workspaceWriteFileInput = z.object({
  path: z.string().min(1).describe("Path relative to the workspace root."),
  content: z.string().describe("Complete file content."),
});

export const workspaceListFilesInput = z.object({
  path: z.string().optional().describe("Directory relative to the workspace root."),
  depth: z.number().int().min(1).max(6).optional(),
});

export const workspacePublishFileInput = z.object({
  path: z
    .string()
    .min(1)
    .describe("Workspace-relative path of the file to attach in-thread (pptx, xlsx, pdf, etc.)."),
  title: z
    .string()
    .optional()
    .describe("Short title for the artifact panel."),
});

export const createPresentationInput = z.object({
  title: z.string().min(1).describe("Deck title shown to the user and used as the filename."),
  subtitle: z.string().optional().describe("Optional subtitle for the title slide."),
  slides: z
    .array(
      z.object({
        title: z.string().min(1).describe("Slide title."),
        bullets: z
          .array(z.string())
          .optional()
          .describe("3–5 short bullets. Omit on a title/section slide."),
        notes: z.string().optional().describe("Optional speaker notes (plain text)."),
        layout: z
          .enum(["title", "title_and_bullets", "section"])
          .optional()
          .describe("title = cover; section = section divider; default is title plus bullets."),
      }),
    )
    .min(1)
    .max(40)
    .describe("Ordered slides. Prefer 6–12 for a research deck."),
});

export const createSpreadsheetInput = z.object({
  title: z.string().min(1).describe("Workbook title used as the filename."),
  sheets: z
    .array(
      z.object({
        name: z.string().optional().describe("Sheet tab name."),
        headers: z.array(z.string()).optional().describe("Column headers for the first row."),
        rows: z
          .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
          .describe("Data rows. Values are stored as text or numbers."),
      }),
    )
    .min(1)
    .max(8),
});

export const createDocumentInput = z.object({
  title: z.string().min(1).describe("Document title shown to the user and used as the filename."),
  subtitle: z.string().optional().describe("Optional subtitle under the title."),
  paragraphs: z
    .array(z.string())
    .max(80)
    .optional()
    .describe("Body paragraphs in order. Prefer short paragraphs, not markdown."),
});

export const createPdfInput = z.object({
  title: z.string().min(1).describe("PDF title shown to the user and used as the filename."),
  paragraphs: z
    .array(z.string())
    .max(80)
    .optional()
    .describe("Body paragraphs in order."),
});

export const githubListIssuesInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  state: z.enum(["open", "closed", "all"]).optional(),
});

export const githubGetIssueInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  issueNumber: z.number().int().min(1),
});

export const githubListPullRequestsInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  state: z.enum(["open", "closed", "all"]).optional(),
});

export const githubGetPullRequestInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  pullNumber: z.number().int().min(1),
});

export const githubListCommitsInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  ref: z.string().optional().describe("Branch, tag, or SHA."),
});

export const githubCreateBranchInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  branchName: z.string().describe("New branch name."),
  fromRef: z.string().optional().describe("Base branch (defaults to repo default)."),
});

export const githubCreateOrUpdateFileInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  path: z.string().describe("File path inside the repo."),
  content: z.string().describe("Complete UTF-8 file content."),
  commitMessage: z.string().describe("Commit message."),
  branch: z.string().optional(),
  expectedSha: z
    .string()
    .optional()
    .describe("Blob SHA from a prior read; omit to create a new file."),
});

export const githubCreateIssueInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  title: z.string(),
  body: z.string().optional(),
});

export const githubAddIssueCommentInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  issueNumber: z.number().int().min(1),
  body: z.string(),
});

export const githubCreatePullRequestInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  title: z.string(),
  head: z.string().describe("Source branch."),
  base: z.string().describe("Target branch."),
  body: z.string().optional(),
  draft: z.boolean().optional(),
});

export const githubMergePullRequestInput = z.object({
  repo: z.string().describe("GitHub repository as owner/repo or URL."),
  pullNumber: z.number().int().min(1),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
});

export const gmailSearchInput = z.object({
  query: z
    .string()
    .describe("Gmail search query (supports Gmail operators like from:, is:unread)."),
  maxResults: z.number().int().min(1).max(25).optional(),
});

export const gmailReadInput = z.object({
  messageId: z.string().describe("Message id from gmail_search."),
});

export const gmailSendInput = z.object({
  to: z.string().describe("Recipient email address."),
  subject: z.string(),
  body: z.string(),
  threadId: z.string().optional().describe("Reply within this thread."),
});

export const gmailCreateDraftInput = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  threadId: z.string().optional(),
});

export const calendarListEventsInput = z.object({
  timeMin: z.string().optional().describe("ISO 8601 start of range."),
  timeMax: z.string().optional().describe("ISO 8601 end of range."),
  maxResults: z.number().int().min(1).max(50).optional(),
});

export const calendarCreateEventInput = z.object({
  summary: z.string().describe("Event title."),
  start: z.string().describe("ISO 8601 start datetime."),
  end: z.string().describe("ISO 8601 end datetime."),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
  timeZone: z.string().optional().describe("IANA timezone, e.g. America/New_York."),
});

export const calendarDeleteEventInput = z.object({
  eventId: z.string().describe("Event id from calendar_list_events."),
});

export const contactsSearchInput = z.object({
  query: z.string().describe("Name, email, or phone fragment to search."),
});

export const contactsCreateInput = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  emails: z.array(z.string().email()).optional(),
  phones: z.array(z.string()).optional(),
});

export const generateImageInput = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("What the image should show, described concretely."),
  size: z
    .enum(["square", "portrait", "landscape"])
    .optional()
    .describe("Aspect ratio: square (default), portrait, or landscape."),
});

export const workspaceFfmpegInput = z.object({
  action: z
    .enum(["trim", "concat", "gif", "burn_subs"])
    .describe("trim, concat, gif, or burn_subs. Runs ffmpeg in the isolated workspace when it is installed."),
  inputPath: z.string().describe("Workspace-relative input media path."),
  outputPath: z.string().describe("Workspace-relative output path."),
  extraInputs: z
    .array(z.string())
    .optional()
    .describe("Additional workspace-relative inputs for concat."),
  start: z.string().optional().describe("Trim start timestamp (HH:MM:SS)."),
  duration: z.string().optional().describe("Trim duration in seconds or HH:MM:SS."),
  subsPath: z.string().optional().describe("Workspace-relative captions file for burn_subs."),
});

export const scheduleCreateInput = z.object({
  title: z.string().describe("Short name for the automation."),
  prompt: z.string().describe("What to prepare when it fires."),
  when: z
    .string()
    .describe('When to run: "every morning", "every weekday morning", "every evening", or a 5-field cron.'),
  delivery: z
    .enum(["inbox", "email"])
    .optional()
    .describe("inbox = chat draft; email = email draft. Both wait on a confirm card before send."),
  timezone: z.string().optional().describe("IANA timezone, default UTC."),
});

export const scheduleListInput = z.object({});

export const scheduleCancelInput = z.object({
  id: z.string().describe("Schedule id from schedule_list."),
});

export const designListInput = z.object({
  query: z.string().optional().describe("Optional name filter."),
  teamId: z.string().optional().describe("Operator team id when listing projects."),
});

export const designReadInput = z.object({
  fileKey: z.string().describe("Design file key to read (pages and title only)."),
});

export const deploymentsListInput = z.object({
  projectId: z.string().optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export const deploymentsReadInput = z.object({
  id: z.string().describe("Deployment id from deployments_list."),
});

export const socialSearchInput = z.object({
  query: z.string().describe("Social feed query. Requires an official API key — there is no scrape path."),
});

export const browserActInput = z.object({
  url: z.string().url().describe("Page URL for the action."),
  action: z
    .enum(["extract", "fill_preview", "click", "submit"])
    .describe(
      "extract=read page; fill_preview=describe fill without applying; click/submit=side effects (submit always needs confirmation).",
    ),
  selector: z.string().optional().describe("CSS selector or field name hint."),
  value: z.string().optional().describe("Value for fill_preview."),
  description: z
    .string()
    .optional()
    .describe("Human description of the intended action."),
});

// ─── Display metadata (client rendering) ───

export type ToolDisplay = {
  label: string;
  runningLabel: string;
};

export const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  [TOOL_NAMES.executePython]: {
    label: "Python",
    runningLabel: "Running Python…",
  },
  [TOOL_NAMES.webSearch]: {
    label: "Web search",
    runningLabel: "Searching the web…",
  },
  [TOOL_NAMES.createArtifact]: {
    label: "Artifact",
    runningLabel: "Creating artifact…",
  },
  [TOOL_NAMES.memorySearch]: {
    label: "Memory",
    runningLabel: "Searching memory…",
  },
  [TOOL_NAMES.projectKnowledgeSearch]: {
    label: "Project knowledge",
    runningLabel: "Searching project files…",
  },
  [TOOL_NAMES.memoryWrite]: {
    label: "Memory",
    runningLabel: "Saving memory…",
  },
  [TOOL_NAMES.driveSearch]: {
    label: "Drive",
    runningLabel: "Searching Drive…",
  },
  [TOOL_NAMES.driveRead]: {
    label: "Drive",
    runningLabel: "Reading Drive file…",
  },
  [TOOL_NAMES.driveUpload]: {
    label: "Drive",
    runningLabel: "Saving to Drive…",
  },
  [TOOL_NAMES.driveWrite]: {
    label: "Drive",
    runningLabel: "Saving to Drive…",
  },
  [TOOL_NAMES.githubGetRepo]: {
    label: "GitHub",
    runningLabel: "Looking up repository…",
  },
  [TOOL_NAMES.githubListContents]: {
    label: "GitHub",
    runningLabel: "Listing repository files…",
  },
  [TOOL_NAMES.githubReadFile]: {
    label: "GitHub",
    runningLabel: "Reading repository file…",
  },
  [TOOL_NAMES.githubListIssues]: {
    label: "GitHub",
    runningLabel: "Listing issues…",
  },
  [TOOL_NAMES.githubGetIssue]: {
    label: "GitHub",
    runningLabel: "Reading issue…",
  },
  [TOOL_NAMES.githubListPullRequests]: {
    label: "GitHub",
    runningLabel: "Listing pull requests…",
  },
  [TOOL_NAMES.githubGetPullRequest]: {
    label: "GitHub",
    runningLabel: "Reading pull request…",
  },
  [TOOL_NAMES.githubListCommits]: {
    label: "GitHub",
    runningLabel: "Listing commits…",
  },
  [TOOL_NAMES.githubCreateBranch]: {
    label: "GitHub",
    runningLabel: "Creating branch…",
  },
  [TOOL_NAMES.githubCreateOrUpdateFile]: {
    label: "GitHub",
    runningLabel: "Committing file…",
  },
  [TOOL_NAMES.githubCreateIssue]: {
    label: "GitHub",
    runningLabel: "Creating issue…",
  },
  [TOOL_NAMES.githubAddIssueComment]: {
    label: "GitHub",
    runningLabel: "Posting comment…",
  },
  [TOOL_NAMES.githubCreatePullRequest]: {
    label: "GitHub",
    runningLabel: "Opening pull request…",
  },
  [TOOL_NAMES.githubMergePullRequest]: {
    label: "GitHub",
    runningLabel: "Merging pull request…",
  },
  [TOOL_NAMES.fetchUrl]: {
    label: "Fetch URL",
    runningLabel: "Fetching page…",
  },
  [TOOL_NAMES.browsePage]: {
    label: "Browse",
    runningLabel: "Reading page…",
  },
  [TOOL_NAMES.browserSnapshot]: {
    label: "Screenshot",
    runningLabel: "Capturing page…",
  },
  [TOOL_NAMES.searchImages]: {
    label: "Images",
    runningLabel: "Searching images…",
  },
  [TOOL_NAMES.toolSearch]: {
    label: "Looking up",
    runningLabel: "Finding what you need…",
  },
  [TOOL_NAMES.verifyChecklist]: {
    label: "Verify",
    runningLabel: "Checking work…",
  },
  [TOOL_NAMES.requestConfirmation]: {
    label: "Needs approval",
    runningLabel: "Waiting for approval…",
  },
  [TOOL_NAMES.browserNavigate]: {
    label: "Browser",
    runningLabel: "Opening page…",
  },
  [TOOL_NAMES.browserAct]: {
    label: "Browser",
    runningLabel: "Working on page…",
  },
  [TOOL_NAMES.workspaceExec]: {
    label: "Workspace",
    runningLabel: "Running command…",
  },
  [TOOL_NAMES.workspaceReadFile]: {
    label: "Workspace",
    runningLabel: "Reading file…",
  },
  [TOOL_NAMES.workspaceWriteFile]: {
    label: "Workspace",
    runningLabel: "Writing file…",
  },
  [TOOL_NAMES.workspaceListFiles]: {
    label: "Workspace",
    runningLabel: "Listing files…",
  },
  [TOOL_NAMES.workspacePublishFile]: {
    label: "File",
    runningLabel: "Attaching file…",
  },
  [TOOL_NAMES.createPresentation]: {
    label: "Slides",
    runningLabel: "Building slides…",
  },
  [TOOL_NAMES.createSpreadsheet]: {
    label: "Spreadsheet",
    runningLabel: "Building spreadsheet…",
  },
  [TOOL_NAMES.createDocument]: {
    label: "Document",
    runningLabel: "Building document…",
  },
  [TOOL_NAMES.createPdf]: {
    label: "PDF",
    runningLabel: "Building PDF…",
  },
  [TOOL_NAMES.generateImage]: {
    label: "Image",
    runningLabel: "Generating image…",
  },
  [TOOL_NAMES.gmailSearch]: {
    label: "Gmail",
    runningLabel: "Searching Gmail…",
  },
  [TOOL_NAMES.gmailRead]: {
    label: "Gmail",
    runningLabel: "Reading email…",
  },
  [TOOL_NAMES.gmailSend]: {
    label: "Gmail",
    runningLabel: "Sending email…",
  },
  [TOOL_NAMES.gmailCreateDraft]: {
    label: "Gmail",
    runningLabel: "Creating draft…",
  },
  [TOOL_NAMES.calendarListEvents]: {
    label: "Calendar",
    runningLabel: "Listing events…",
  },
  [TOOL_NAMES.calendarCreateEvent]: {
    label: "Calendar",
    runningLabel: "Creating event…",
  },
  [TOOL_NAMES.calendarDeleteEvent]: {
    label: "Calendar",
    runningLabel: "Deleting event…",
  },
  [TOOL_NAMES.contactsSearch]: {
    label: "Contacts",
    runningLabel: "Searching contacts…",
  },
  [TOOL_NAMES.contactsCreate]: {
    label: "Contacts",
    runningLabel: "Creating contact…",
  },
  [TOOL_NAMES.workspaceFfmpeg]: {
    label: "Media",
    runningLabel: "Processing media…",
  },
  [TOOL_NAMES.scheduleCreate]: {
    label: "Automation",
    runningLabel: "Scheduling…",
  },
  [TOOL_NAMES.scheduleList]: {
    label: "Automation",
    runningLabel: "Listing automations…",
  },
  [TOOL_NAMES.scheduleCancel]: {
    label: "Automation",
    runningLabel: "Removing automation…",
  },
  [TOOL_NAMES.designList]: {
    label: "Design",
    runningLabel: "Listing design files…",
  },
  [TOOL_NAMES.designRead]: {
    label: "Design",
    runningLabel: "Reading design file…",
  },
  [TOOL_NAMES.deploymentsList]: {
    label: "Deployments",
    runningLabel: "Listing deployments…",
  },
  [TOOL_NAMES.deploymentsRead]: {
    label: "Deployments",
    runningLabel: "Reading deployment…",
  },
  [TOOL_NAMES.socialSearch]: {
    label: "Social",
    runningLabel: "Searching social…",
  },
};

export function getToolDisplay(name: string): ToolDisplay {
  return (
    TOOL_DISPLAY[name] ?? {
      label: name,
      runningLabel: `Running ${name}…`,
    }
  );
}

/** System prompt appended to instruct the model on tool + artifact usage. */
export const TOOLS_SYSTEM_PROMPT = `You are Aether, with access to tools and an artifact panel.

## Decision posture
- Use tools decisively when they improve correctness (current facts, repo inspection, math verification, Drive files, memory). Do not stall or ask permission to call an available tool.
- Prefer a short tool call over confident guessing on facts that change, numbers, or private user data.
- Always end the turn with a clear, user-visible answer — even when tools return thin, empty, or blocked results. State uncertainty briefly; never leave the user with only tool noise.

## Core tools (always available when tools are on)
- "execute_python": sandboxed in-browser Python for math, data, or verifying code.
- "web_search": current or factual lookups. Few focused queries only. Results include id (1, 2, …) — cite those ids inline as [1], [2] in the final answer.
- "browse_page": read a public page and return a structured extract (title, headings, excerpts, links). Pass instructions to focus the extract. Soft-fails paywalls; PDFs best-effort. Never use for github.com repos. Cite the page as the next [n] after search hits.
- "fetch_url": compat alias for browse_page without instructions.
- "create_artifact": substantial reusable content. Prefer kind "markdown" (or "document") for essays/briefs; "html" / "react" for live previews; "code" / "csv" / "svg" / "image" when those fit. Do not use this for a PowerPoint, Excel, Word, or PDF file.
- "create_presentation": build a real .pptx and attach it in-thread. Use this for decks / slides / PowerPoint — do not install python-pptx or fall back to a markdown briefing.
- "create_spreadsheet": build a real .xlsx and attach it in-thread. Use this for Excel / tables the user asked to download.
- "create_document": build a real Word file (.docx) and attach it in-thread. Use this when they asked to download a document — not a markdown briefing.
- "create_pdf": build a real PDF and attach it in-thread. Use this when they asked for a PDF.
- "verify_checklist": structured verify pass before handing back substantial work (deep / research / write / timed drafts).
- "request_confirmation": gate any side effect (submit, send, upload) until the user approves. Never claim a side effect completed without approval.
- "browser_navigate": open a public URL and extract text (fetch or full browser when configured).
- "browser_snapshot": open a public URL and optionally store a screenshot as an image artifact the next step can see.
- "browser_act": extract / fill_preview / click / submit on a page. submit always returns needs_confirmation.
- "search_images": web image search. Returns carousel-ready image URLs (no spend).
- "workspace_exec": run shell commands in an isolated per-conversation Linux workspace. If it reports the workspace unavailable, use create_presentation / create_spreadsheet / create_document / create_pdf for office files instead of retrying pip. For trim/concat/GIF/burned-in captions prefer workspace_ffmpeg. If ffmpeg is MISSING, say so — do not invent a video.
- "workspace_ffmpeg": trim, concat, GIF, or burn captions via ffmpeg in that workspace. Honest MISSING if the binary is not installed.
- "workspace_read_file" / "workspace_write_file" / "workspace_list_files": inspect and edit files in that isolated workspace.
- "schedule_create" / "schedule_list" / "schedule_cancel": recurring automations (“every morning…”). Creating always confirms. When a job fires it prepares a draft and waits on a confirm card — never silent-send.
- "design_list" / "design_read": read connected design files. If not connected, say so.
- "deployments_list" / "deployments_read": read connected deployments. If not connected, say so.
- "social_search": social feed lookup. Unavailable without an official API key — never scrape.
- "workspace_publish_file": attach a binary from the isolated workspace (csv, png, zip, or other generated files) as a downloadable file in this thread. Do not use this to rebuild Word/PDF/Excel — use create_document / create_pdf / create_spreadsheet.
- "generate_image": generate a bitmap image from a description. Confirms before spending — the user sees a card.
- "tool_search": unlock optional tools (memory, Drive, GitHub) by keyword when needed.

## Optional tools (via tool_search when the session supports them; GitHub may already be unlocked if the user pasted a repo link)
- "memory_search" / "memory_write": lasting facts about the user.
- "project_knowledge_search": retrieve passages from files uploaded to the active project. Do not assume the whole folder is in this prompt.
- "drive_search" / "drive_read": the user's Google Drive when connected.
- "drive_upload" / "drive_write": save a generated pptx/xlsx/pdf/docx (workspace path, artifact, or data URL) into a Drive folder. Always waits on a confirm card — including Auto.
- "github_get_repo" / "github_list_contents" / "github_read_file": repo tools (one path per read_file call; parallelize multiple files).
- "github_list_issues" / "github_get_issue" / "github_list_pull_requests" / "github_get_pull_request" / "github_list_commits": inspect issues, PRs, and commit history.
- "github_create_branch" / "github_create_or_update_file": code writes. Your own repos commit directly; other owners' or org repos ask first.
- "gmail_search" / "gmail_read": the user's Gmail when connected.
- "gmail_create_draft": default email path — create a draft without sending. In Auto it runs directly.
- "gmail_send": send only after the user confirms the card. Never silent-send, including in Auto. Prefer a draft unless they explicitly asked to send.
- "calendar_list_events" / "calendar_create_event": the user's primary calendar. Ordinary event creation just lands; deleting always confirms.
- "contacts_search" / "contacts_create": the user's Google contacts. Creating just lands; searching is instant.

## GitHub rule (hard)
- github.com / owner-repo → github_* only. Never Drive/fetch_url/web_search for repo contents.

## Side effects & portals (hard)
- Never submit forms, send messages, or complete enrollments without request_confirmation or browser_act(submit) approval.
- If the user is logged into a portal, guide them and use extract/preview tools — never ask for passwords.
- Essay / deadline flows: draft artifact first → verify lightly → then portal steps with confirmation.

## Web research discipline (enforced by the harness)
- Prefer 1–2 focused web_search calls, then browse_page (or fetch_url) on the best links, then draft. Near-duplicates and depth budgets apply (time budgets may tighten further).
- Cite sources inline as [1], [2] matching web_search/browse_page/fetch_url result ids so they render as citation chips.
- When blocked or budget exhausted → browse_page / fetch_url / browser_navigate on known links, or answer.
- Paywall / thin results → say so and finish with a usable answer.

## Artifacts & narration
- Short snippets in chat; create_artifact for long or reusable work (essays, briefs).
- Decks, spreadsheets, Word files, and PDFs the user asked to download must be real files (create_presentation / create_spreadsheet / create_document / create_pdf), not markdown stand-ins.
- After those tools, the thread shows a file chip with Download. Do not claim a file is attached unless the tool returned persisted/downloadPath or in-thread content. Guests keep the file in this thread — never say it is attached with no file.
- Weave tool results into the answer; no raw JSON dumps.

## If tools are unavailable
Answer normally as a text-only assistant.`;
