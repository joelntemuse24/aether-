import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeedTier } from "../../src/lib/hosted/speed-tiers";
import type { ProbeAuth } from "./client";
import type { ProbeCategory } from "./types";
import {
  detectUiFailures,
  isWelcomePhrase,
  type UiSnapshot,
} from "./ui-detectors";

const PACK_DIR = dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = join(PACK_DIR, "artifacts");

export type UiTurnInput = {
  baseUrl: string;
  promptId: string;
  category: ProbeCategory;
  prompt: string;
  tier: SpeedTier;
  timeoutMs: number;
  auth?: ProbeAuth;
};

export function artifactPngPath(promptId: string, tier: SpeedTier): string {
  const safe = promptId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return join(ARTIFACTS_DIR, `${safe}-${tier}-ui.png`);
}

export function parseCookieHeader(
  cookieHeader: string,
  baseUrl: string,
): Array<{ name: string; value: string; url: string }> {
  const origin = new URL(baseUrl).origin;
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const name = eq === -1 ? part : part.slice(0, eq).trim();
      const value = eq === -1 ? "" : part.slice(eq + 1).trim();
      return { name, value, url: origin };
    })
    .filter((c) => c.name);
}

type PlaywrightPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  locator: (sel: string) => PlaywrightLocator;
  getByRole: (role: string, opts?: { name?: string | RegExp }) => PlaywrightLocator;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  content: () => Promise<string>;
  innerText: () => Promise<string>;
  waitForTimeout: (ms: number) => Promise<void>;
  on: (event: string, fn: (err: Error) => void) => void;
};

type PlaywrightLocator = {
  first: () => PlaywrightLocator;
  count: () => Promise<number>;
  isVisible: () => Promise<boolean>;
  textContent: () => Promise<string | null>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  fill: (text: string) => Promise<void>;
  click: (opts?: { timeout?: number }) => Promise<void>;
  waitFor: (opts?: { timeout?: number }) => Promise<void>;
  press: (key: string) => Promise<void>;
  pressSequentially: (text: string, opts?: { delay?: number }) => Promise<void>;
  all: () => Promise<PlaywrightLocator[]>;
};

async function visible(locator: PlaywrightLocator): Promise<boolean> {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function collectUiDom(page: PlaywrightPage): Promise<Omit<
  UiSnapshot,
  "elapsedMs" | "timedOut" | "finished" | "sawWorkingDuringTurn" | "pageError"
>> {
  const welcome = page.locator("h1").first();
  const welcomePhrase = (await welcome.textContent().catch(() => null))?.trim() ?? null;
  const welcomeVisible =
    (await visible(welcome)) && isWelcomePhrase(welcomePhrase);

  const userMessageCount = await page.locator('[data-role="user"]').count();
  const assistantNodes = await page.locator('[data-role="assistant"]').all();
  const assistantChunks: string[] = [];
  for (const node of assistantNodes) {
    assistantChunks.push((await node.innerText().catch(() => "")) || "");
  }
  const assistantVisibleText = assistantChunks.join("\n").trim();

  const activityNodes = await page.locator(".aether-activity").all();
  let workingStripCount = 0;
  let workedForVisible = false;
  for (const node of activityNodes) {
    const text = ((await node.innerText().catch(() => "")) || "").trim();
    if (/worked for /i.test(text)) workedForVisible = true;
    const liveLines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => /^working(?: for \S+)?$/i.test(line));
    if (liveLines.length > 0) workingStripCount += 1;
  }

  const stopVisible = await visible(page.locator('button[aria-label="Stop generating"]'));
  const sendVisible = await visible(page.locator('button[aria-label="Send message"]'));
  const stepFailedVisible = await visible(page.locator(".aether-tool-trace__error"));
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const applicationErrorVisible = /application error/i.test(bodyText);

  return {
    welcomeVisible,
    welcomePhrase: welcomeVisible ? welcomePhrase : null,
    userMessageCount,
    assistantVisibleText,
    workingStripCount,
    workedForVisible,
    stopVisible,
    sendVisible,
    stepFailedVisible,
    applicationErrorVisible,
    bodyText,
  };
}

async function dismissPreferences(page: PlaywrightPage) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const close = page.getByRole("button", { name: "Close preferences" });
    if (await visible(close)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
    const dialog = page.getByRole("dialog");
    if (!(await visible(dialog))) return;
    await page.waitForTimeout(200);
  }
}

async function typeComposer(page: PlaywrightPage, text: string) {
  const box = page.locator('textarea[aria-label="Message input"]').first();
  await box.waitFor({ timeout: 15_000 });
  await box.click();
  await box.fill("");
  await box.pressSequentially(text, { delay: 8 });
  const value = await box.inputValue().catch(() => "");
  if (value.trim() !== text.trim()) {
    await box.fill(text);
  }
}

export async function runUiTurn(input: UiTurnInput): Promise<{
  snap: UiSnapshot;
  screenshot: string | null;
}> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is required for UI probes. Run `npm i` then `npx playwright install chromium`.",
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: input.auth?.sessionToken
      ? { authorization: `Bearer ${input.auth.sessionToken}` }
      : undefined,
  });
  if (input.auth?.cookie?.trim()) {
    await context.addCookies(parseCookieHeader(input.auth.cookie, input.baseUrl));
  }
  const page = (await context.newPage()) as unknown as PlaywrightPage;
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  const started = Date.now();
  let timedOut = false;
  let sawWorkingDuringTurn = false;

  try {
    await page.goto(input.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await dismissPreferences(page);
    await page.locator('textarea[aria-label="Message input"]').waitFor({ timeout: 15_000 });

    const tierName = input.tier === "expert" ? "Expert" : "Fast";
    const radio = page.getByRole("radio", { name: tierName });
    if (await visible(radio)) await radio.click();

    await typeComposer(page, input.prompt);
    const send = page.locator('button[aria-label="Send message"]');
    await send.click({ timeout: 5000 });

    while (Date.now() - started < input.timeoutMs) {
      const mid = await collectUiDom(page);
      if (mid.workingStripCount > 0) sawWorkingDuringTurn = true;
      const sent = mid.userMessageCount > 0 || !mid.welcomeVisible;
      const hasOutcome =
        mid.assistantVisibleText.length > 0 ||
        mid.applicationErrorVisible ||
        mid.stepFailedVisible ||
        /missing authentication header/i.test(mid.bodyText);
      if (
        sent &&
        hasOutcome &&
        mid.sendVisible &&
        !mid.stopVisible &&
        Date.now() - started > 400
      ) {
        await page.waitForTimeout(400);
        break;
      }
      await page.waitForTimeout(250);
    }
    timedOut = Date.now() - started >= input.timeoutMs;

    const dom = await collectUiDom(page);
    const snap: UiSnapshot = {
      ...dom,
      workingStripCount: dom.workingStripCount,
      sawWorkingDuringTurn,
      pageError: pageErrors[0] ?? null,
      elapsedMs: Date.now() - started,
      timedOut,
      finished: !dom.stopVisible && (dom.sendVisible || dom.userMessageCount > 0),
    };
    const findings = detectUiFailures(snap);
    let screenshot: string | null = null;
    if (findings.length > 0) {
      screenshot = artifactPngPath(input.promptId, input.tier);
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true });
    }
    return { snap, screenshot };
  } finally {
    await browser.close();
  }
}
