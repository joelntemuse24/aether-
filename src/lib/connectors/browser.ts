/**
 * Browser / computer-use connector for agent-class flows.
 *
 * Modes:
 * 1. Browserless (BROWSERLESS_URL or BROWSERLESS_TOKEN) — real headless Chrome
 * 2. Fetch fallback — public pages only; no JS apps; never auto-submit
 *
 * Side effects (submit/click submit) always return needs_confirmation first.
 */

import {
  assertPublicHttpUrl,
  fetchWithPublicRedirects,
} from "@/lib/connectors/url-safety";
import {
  createConfirmationRequest,
  type ConfirmableAction,
} from "@/lib/harness/confirmation";

export type BrowserNavigateResult = {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  text?: string;
  mode?: "browserless" | "fetch";
  warning?: string;
};

export type BrowserActResult = {
  ok: boolean;
  error?: string;
  needs_confirmation?: boolean;
  confirmation_id?: string;
  title?: string;
  preview?: string;
  instruction?: string;
  url?: string;
  text?: string;
  note?: string;
};

function browserlessEndpoint(): string | null {
  const base = process.env.BROWSERLESS_URL?.trim();
  if (base) return base.replace(/\/$/, "");
  if (process.env.BROWSERLESS_TOKEN?.trim()) {
    return "https://chrome.browserless.io";
  }
  return null;
}

async function browserlessContent(
  url: string,
  signal?: AbortSignal,
): Promise<{ title?: string; text: string } | null> {
  const endpoint = browserlessEndpoint();
  if (!endpoint) return null;
  const token = process.env.BROWSERLESS_TOKEN?.trim();
  const contentUrl = token
    ? `${endpoint}/content?token=${encodeURIComponent(token)}`
    : `${endpoint}/content`;

  try {
    const res = await fetch(contentUrl, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
      }),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60_000);
    return { title, text };
  } catch {
    return null;
  }
}

export async function browserNavigate(
  url: string,
  userId?: string | null,
): Promise<BrowserNavigateResult> {
  void userId;
  const gate = await assertPublicHttpUrl(url);
  if (!gate.ok) {
    return { ok: false, error: gate.error, url };
  }
  const finalUrl = gate.url.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  try {
    const bl = await browserlessContent(finalUrl, controller.signal);
    if (bl?.text) {
      return {
        ok: true,
        url: finalUrl,
        title: bl.title,
        text: bl.text,
        mode: "browserless",
      };
    }

    const res = await fetchWithPublicRedirects(gate.url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AetherBrowser/1.0; +https://github.com/joelntemuse24/aether-)",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
      },
      maxRedirects: 5,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Navigate failed (${res.status})`,
        url: finalUrl,
      };
    }
    const ctype = res.headers.get("content-type") || "";
    const raw = (await res.text()).slice(0, 200_000);
    if (ctype.includes("pdf") || raw.startsWith("%PDF")) {
      return {
        ok: true,
        url: finalUrl,
        title: "PDF document",
        text: "[PDF binary — attach the file or use a text export for full extraction.]",
        mode: "fetch",
        warning: "PDF body not fully extracted in fetch mode.",
      };
    }
    const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60_000);
    if (!text) {
      return {
        ok: false,
        error: "Page returned no readable text (may need JS rendering).",
        url: finalUrl,
        mode: "fetch",
        warning:
          "Set BROWSERLESS_TOKEN for JS-heavy portals, or guide the user through login manually.",
      };
    }
    return {
      ok: true,
      url: finalUrl,
      title,
      text,
      mode: "fetch",
      warning: browserlessEndpoint()
        ? undefined
        : "Fetch mode — JS apps may be incomplete. Configure Browserless for full portal support.",
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "AbortError"
          ? "Navigate timed out."
          : err instanceof Error
            ? err.message
            : "Navigate failed",
      url: finalUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

const SUBMIT_HINT =
  /\b(submit|send|confirm payment|place order|finalize|enroll|upload and finish)\b/i;

/**
 * High-level browser act. Submit-class actions always request confirmation.
 */
export async function browserAct(input: {
  url: string;
  action: "extract" | "fill_preview" | "click" | "submit";
  selector?: string;
  value?: string;
  description?: string;
  userId?: string | null;
}): Promise<BrowserActResult> {
  const { action, url, description, userId } = input;

  if (action === "submit" || (action === "click" && SUBMIT_HINT.test(description || ""))) {
    const confirmAction: ConfirmableAction =
      action === "submit" ? "browser_fill_and_submit" : "browser_click_submit";
    const conf = createConfirmationRequest(
      {
        action: confirmAction,
        title: description?.slice(0, 100) || "Confirm browser action",
        preview: [
          `URL: ${url}`,
          description ? `Action: ${description}` : `Action: ${action}`,
          input.selector ? `Selector: ${input.selector}` : null,
          input.value ? `Value: ${input.value.slice(0, 200)}` : null,
          "This may submit data to an external site. Aether will not auto-submit without your OK.",
        ]
          .filter(Boolean)
          .join("\n"),
        target: url,
        payload: {
          action,
          selector: input.selector,
          value: input.value,
        },
      },
      userId,
    );
    return {
      ok: true,
      needs_confirmation: true,
      confirmation_id: conf.confirmation_id,
      title: conf.title,
      preview: conf.preview,
      instruction: conf.instruction,
      url,
    };
  }

  if (action === "extract" || action === "fill_preview") {
    const page = await browserNavigate(url, userId);
    if (!page.ok) {
      return { ok: false, error: page.error, url: page.url };
    }
    return {
      ok: true,
      url: page.url,
      text:
        action === "fill_preview"
          ? [
              page.title ? `Title: ${page.title}` : null,
              description ? `Would fill: ${description}` : null,
              input.selector ? `Field: ${input.selector}` : null,
              input.value ? `With: ${input.value.slice(0, 500)}` : null,
              "Fill is not applied until you confirm a submit-class action.",
              "",
              (page.text || "").slice(0, 8000),
            ]
              .filter(Boolean)
              .join("\n")
          : page.text,
      note:
        action === "fill_preview"
          ? "Preview only — no form fields were changed."
          : page.warning,
    };
  }

  // click (non-submit): describe only unless browserless automation is extended later
  return {
    ok: true,
    url,
    note: `Click “${description || input.selector || "element"}” is not auto-executed in safe mode. Guide the user or request submit confirmation if this completes a form.`,
    needs_confirmation: false,
  };
}
