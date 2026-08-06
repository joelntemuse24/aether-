/**
 * Session skills — soft capability descriptors for "user is already logged in"
 * flows. Never stores passwords. Powers agent guidance for portals/Drive/etc.
 */

export type SessionSkill = {
  id: string;
  label: string;
  /** Consumer-facing description. */
  description: string;
  /** Hints injected into the system prompt when active. */
  promptHint: string;
  available: boolean;
};

export function resolveSessionSkills(input: {
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasBrowserless?: boolean;
  signedIn?: boolean;
}): SessionSkill[] {
  const skills: SessionSkill[] = [
    {
      id: "browser_public",
      label: "Open pages",
      description: "Navigate public pages and extract text",
      promptHint:
        "You can open public URLs with browser_navigate / fetch_url. Prefer browser_navigate for portal-like pages when available.",
      available: true,
    },
    {
      id: "browser_actions_gated",
      label: "Gated actions",
      description: "Fill/submit only after user confirmation",
      promptHint:
        "Any submit, send, or irreversible browser action MUST call request_confirmation or browser_act(action=submit) first. Never claim submission succeeded without approval.",
      available: true,
    },
    {
      id: "user_logged_in_tab",
      label: "User session",
      description: "User may already be logged into a portal in their browser",
      promptHint:
        "When the user says they are logged in, give precise click-path instructions and use extract/preview tools. Do not ask for passwords. Prefer confirmation-gated actions over credential collection.",
      available: true,
    },
    {
      id: "google_drive",
      label: "Google Drive",
      description: "Search and read Drive files",
      promptHint:
        "Google Drive is connected — use drive_search / drive_read (tool_search for drive if needed).",
      available: !!input.hasDrive,
    },
    {
      id: "github",
      label: "GitHub",
      description: "Read repositories the user can access",
      promptHint:
        "GitHub is connected — use github_* tools for github.com links.",
      available: !!input.hasGitHub,
    },
    {
      id: "browserless",
      label: "Full browser",
      description: "JS-rendered pages via Browserless",
      promptHint:
        "Headless browser rendering is available — prefer browser_navigate for JS-heavy sites.",
      available: !!input.hasBrowserless,
    },
    {
      id: "account_memory",
      label: "Memory",
      description: "Long-term preferences when signed in",
      promptHint: "User is signed in — memory tools may be available.",
      available: !!input.signedIn,
    },
  ];

  return skills.filter((s) => s.available);
}

export function sessionSkillsSystemAddendum(skills: SessionSkill[]): string {
  if (skills.length === 0) return "";
  const lines = [
    "## Session skills (available this turn)",
    ...skills.map((s) => `- ${s.label}: ${s.promptHint}`),
  ];
  return lines.join("\n");
}
