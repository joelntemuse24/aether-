"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import {
  XIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  CheckIcon,
  Loader2Icon,
  LinkIcon,
  PaletteIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { useDrive } from "@/providers/drive-provider";
import { useSession } from "@/providers/session-provider";
import { ACCENTS, useTheme } from "@/providers/theme-provider";
import { PROVIDER_DEFAULTS, type ProviderId } from "@/lib/models";
import { VOICE_OPTIONS } from "@/lib/voice";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MemorySettingsPanel } from "@/components/settings/memory-settings-panel";

const PROVIDERS: ProviderId[] = ["openrouter", "openai", "anthropic", "custom"];

export function SettingsDialog() {
  const {
    settings,
    updateSettings,
    openSettings,
    setOpenSettings,
    hasKey,
    hostedStatus,
    hostedLoading,
    focusConnectedAccounts,
    clearFocusConnectedAccounts,
  } = useSettings();
  const { data: session, status } = useSession();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const {
    connected: driveConnected,
    email: driveEmail,
    googleConfigured,
    loading: driveLoading,
    connect,
    disconnect,
    refresh,
  } = useDrive();
  const titleId = useId();
  const connectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSettings) return;
    void refresh();
  }, [openSettings, refresh]);

  useEffect(() => {
    if (!openSettings || !focusConnectedAccounts) return;
    const el = connectedRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    const t = window.setTimeout(() => clearFocusConnectedAccounts(), 2400);
    return () => window.clearTimeout(t);
  }, [openSettings, focusConnectedAccounts, clearFocusConnectedAccounts]);

  useEffect(() => {
    if (!openSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasKey) setOpenSettings(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSettings, hasKey, setOpenSettings]);

  if (!openSettings) return null;

  const providerMeta = PROVIDER_DEFAULTS[settings.provider];

  const keyField =
    settings.provider === "openrouter"
      ? "openrouterKey"
      : settings.provider === "openai"
        ? "openaiKey"
        : settings.provider === "anthropic"
          ? "anthropicKey"
          : "customKey";

  const keyValue = settings[keyField];
  const isAuthenticated = status === "authenticated" && !!session?.user;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={() => hasKey && setOpenSettings(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-0 shadow-none"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-[var(--accent)]" />
            <h2
              id={titleId}
              className="font-[family-name:var(--font-sc)] text-[14px] font-medium tracking-[0.06em] text-[var(--text)]"
            >
              Settings
            </h2>
          </div>
          {hasKey && (
            <button
              type="button"
              onClick={() => setOpenSettings(false)}
              className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Close settings"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
          {/* Access mode */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-[var(--text)]">
              Model access
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              Use Aether Cloud models out of the box, or bring your own API keys.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => updateSettings({ accessMode: "hosted" })}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  settings.accessMode === "hosted"
                    ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                )}
              >
                <div className="font-medium">Aether Cloud</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                  Claude, ChatGPT, and more — no key needed
                </div>
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ accessMode: "byok" })}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  settings.accessMode === "byok"
                    ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                )}
              >
                <div className="font-medium">Bring your own key</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                  OpenRouter, OpenAI, Anthropic, or custom
                </div>
              </button>
            </div>
            {settings.accessMode === "hosted" && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
                {hostedLoading ? (
                  "Checking Aether Cloud…"
                ) : hostedStatus?.available ? (
                  <>
                    Aether Cloud is ready. Pick a model from the composer — Claude,
                    ChatGPT, and more, with no key required.
                  </>
                ) : (
                  <>
                    Aether Cloud is not configured on this server. Switch to Bring
                    your own key, or ask the operator to enable hosted models.
                  </>
                )}
              </div>
            )}
          </div>

          {/* Preferences */}
          <div className="space-y-3 border-t border-[var(--border)] pt-5">
            <div className="flex items-center gap-2">
              <PaletteIcon className="size-4 text-[var(--muted)]" />
              <span className="text-sm font-medium text-[var(--text)]">
                Preferences
              </span>
            </div>

            <div className="space-y-2">
              <Label>Appearance</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    theme === "dark"
                      ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                  )}
                >
                  <MoonIcon className="size-3.5" />
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    theme === "light"
                      ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                  )}
                >
                  <SunIcon className="size-3.5" />
                  Light
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Accent</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {ACCENTS.map((item) => {
                  const selected = accent === item.id;
                  const swatch =
                    item.id === "mono"
                      ? theme === "light"
                        ? "#1a1714"
                        : "#e8e4d9"
                      : item.id === "default"
                        ? theme === "light"
                          ? "#c96442"
                          : item.swatch
                        : item.swatch;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAccent(item.id)}
                      aria-pressed={selected}
                      title={item.label}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                      )}
                    >
                      <span
                        className="size-5 rounded-full border border-black/10"
                        style={{ background: swatch }}
                        aria-hidden
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {settings.accessMode === "byok" && (
            <>
              <div className="space-y-2 border-t border-[var(--border)] pt-5">
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  Keys stay in this browser&apos;s localStorage and are sent only
                  to your chosen provider via the app&apos;s chat proxy.
                </p>
                <Label>Provider</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PROVIDERS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        updateSettings({
                          provider: id,
                          baseURL:
                            id === "custom"
                              ? settings.baseURL
                              : PROVIDER_DEFAULTS[id].baseURL,
                        })
                      }
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        settings.provider === id
                          ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                      )}
                    >
                      {PROVIDER_DEFAULTS[id].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="api-key"
                    className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]"
                  >
                    API key
                  </label>
                  {providerMeta.docsUrl && (
                    <a
                      href={providerMeta.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                    >
                      Get a key
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}
                </div>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    settings.provider === "openrouter"
                      ? "sk-or-..."
                      : settings.provider === "anthropic"
                        ? "sk-ant-..."
                        : "sk-..."
                  }
                  value={keyValue}
                  onChange={(e) =>
                    updateSettings({ [keyField]: e.target.value } as Partial<
                      typeof settings
                    >)
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
                />
              </div>

              {(settings.provider === "custom" ||
                settings.provider === "openai") && (
                <div className="space-y-2">
                  <label
                    htmlFor="base-url"
                    className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]"
                  >
                    Base URL
                  </label>
                  <input
                    id="base-url"
                    type="url"
                    spellCheck={false}
                    placeholder="https://api.example.com/v1"
                    value={settings.baseURL}
                    onChange={(e) => updateSettings({ baseURL: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="custom-model"
                  className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]"
                >
                  Custom model id (optional)
                </label>
                <input
                  id="custom-model"
                  type="text"
                  spellCheck={false}
                  placeholder="provider/model-name"
                  value={settings.customModel}
                  onChange={(e) =>
                    updateSettings({
                      customModel: e.target.value,
                      useCustomModel: e.target.value.trim().length > 0,
                    })
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
                />
                <p className="text-xs text-[var(--muted-soft)]">
                  Overrides the composer model picker when set. OpenRouter accepts
                  ids like{" "}
                  <code className="text-[var(--text)]">
                    anthropic/claude-sonnet-4
                  </code>
                  .
                </p>
              </div>
            </>
          )}

          {/* Voice */}
          <div className="space-y-2 border-t border-[var(--border)] pt-5">
            <div className="text-sm font-medium text-[var(--text)]">Voice</div>
            <p className="text-xs leading-relaxed text-[var(--muted-soft)]">
              How Aether should sound — literary by default for reading, writing,
              and careful conversation.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {VOICE_OPTIONS.map((opt) => {
                const active = settings.voice === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateSettings({ voice: opt.id })}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-[var(--accent)]/50 bg-[var(--accent-muted)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover-overlay)]",
                    )}
                  >
                    <div className="text-[13px] font-medium text-[var(--text)]">
                      {opt.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                      {opt.blurb}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tools */}
          <div className="space-y-2 border-t border-[var(--border)] pt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--text)]">
                  Tools
                </div>
                <p className="text-xs leading-relaxed text-[var(--muted-soft)]">
                  Let the model run Python, search the web, and build artifacts.
                  Turn off for plain text-only chat.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.enableTools}
                onClick={() =>
                  updateSettings({ enableTools: !settings.enableTools })
                }
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                  settings.enableTools
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--border)]",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-4 transform rounded-full bg-white transition-transform",
                    settings.enableTools ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </button>
            </div>
          </div>

          {/* Connected accounts */}
          <div
            ref={connectedRef}
            className={cn(
              "space-y-3 border-t border-[var(--border)] pt-5 transition-[box-shadow,background-color] duration-500",
              focusConnectedAccounts &&
                "-mx-2 rounded-xl bg-[var(--accent-muted)] px-2 py-3 ring-1 ring-[var(--accent)]/25",
            )}
          >
            <div className="flex items-center gap-2">
              <LinkIcon className="size-4 text-[var(--muted)]" />
              <span className="text-sm font-medium text-[var(--text)]">
                Connected accounts
              </span>
            </div>

            {!isAuthenticated ? (
              <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  Sign in to connect Google Drive. Chat still works without
                  signing in.
                </p>
                <Link
                  href="/auth/signin?callbackUrl=%2F%3Fconnect%3Ddrive"
                  onClick={() => setOpenSettings(false)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Sign in
                  <ExternalLinkIcon className="size-3" />
                </Link>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <div className="flex items-center gap-2">
                  <GoogleDriveIcon className="size-4" />
                  <span className="text-sm text-[var(--text)]">Google Drive</span>
                  {driveLoading ? (
                    <Loader2Icon className="ml-auto size-3.5 animate-spin text-[var(--muted)]" />
                  ) : driveConnected ? (
                    <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]">
                      <CheckIcon className="size-3" />
                      Connected{driveEmail ? ` · ${driveEmail}` : ""}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-[var(--muted-soft)]">
                  Optionally connect Drive with read-only access. A file browser
                  appears in the composer once connected.
                </p>
                {!googleConfigured && !driveConnected ? (
                  <p className="text-xs text-[var(--error-text)]">
                    Google OAuth is not configured on the server. Set
                    GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
                  </p>
                ) : driveConnected ? (
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                  >
                    Disconnect Google Drive
                  </button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-1"
                    onClick={() => connect()}
                  >
                    Connect Google Drive
                  </Button>
                )}
              </div>
            )}
          </div>

          <MemorySettingsPanel />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button
            onClick={() => setOpenSettings(false)}
            disabled={
              settings.accessMode === "byok"
                ? !keyValue.trim()
                : !hasKey && !hostedLoading
            }
          >
            {hasKey ? "Done" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.3 2L14.7 2L22 15.5L19.3 20.5L12.7 20.5L9.3 2Z" fill="#0F9D58" />
      <path d="M9.3 2L2 15.5L4.7 20.5L12 7L9.3 2Z" fill="#4285F4" />
      <path d="M14.7 2L9.3 2L2 15.5L7.3 15.5L14.7 2Z" fill="#0F9D58" />
      <path d="M12 7L7.3 15.5L12 15.5L16.7 15.5L12 7Z" fill="#FFC107" />
      <path d="M12 7L16.7 15.5L22 15.5L12 7Z" fill="#FFC107" />
    </svg>
  );
}
