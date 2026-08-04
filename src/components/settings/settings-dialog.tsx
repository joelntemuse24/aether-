"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  XIcon,
  ExternalLinkIcon,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  LinkIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { useDrive } from "@/providers/drive-provider";
import { useGitHub } from "@/providers/github-provider";
import { useSession } from "@/providers/session-provider";
import { ACCENTS, THEMES, useTheme } from "@/providers/theme-provider";
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
    connect: connectDrive,
    disconnect: disconnectDrive,
    refresh: refreshDrive,
  } = useDrive();
  const {
    connected: githubConnected,
    login: githubLogin,
    githubConfigured,
    loading: githubLoading,
    connect: connectGitHubAccount,
    disconnect: disconnectGitHubAccount,
    refresh: refreshGitHub,
  } = useGitHub();
  const titleId = useId();
  const connectedRef = useRef<HTMLDivElement>(null);
  const [advOpen, setAdvOpen] = useState(
    () => settings.accessMode === "byok" && !hasKey,
  );

  useEffect(() => {
    if (!openSettings) return;
    void refreshDrive();
    void refreshGitHub();
  }, [openSettings, refreshDrive, refreshGitHub]);

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
          <h2
            id={titleId}
            className="text-[15px] font-medium text-[var(--text)]"
          >
            Preferences
          </h2>
          {hasKey && (
            <button
              type="button"
              onClick={() => setOpenSettings(false)}
              className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Close preferences"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-5 py-5">
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]">
              Appearance
            </div>
            <div className="space-y-2">
              <Label className="sr-only">Theme</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {THEMES.map((item) => {
                  const selected = theme === item.id;
                  const Icon =
                    item.id === "dark"
                      ? MoonIcon
                      : item.id === "white"
                        ? CircleIcon
                        : SunIcon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTheme(item.id)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--hover-overlay)]",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Accent</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {ACCENTS.map((item) => {
                  const selected = accent === item.id;
                  const lightSurface = theme === "light" || theme === "white";
                  const swatch =
                    item.id === "mono"
                      ? lightSurface
                        ? "#1a1714"
                        : "#e8e4d9"
                      : item.id === "default"
                        ? lightSurface
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

          {/* Voice */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]">
              Voice
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              How Aether should respond in conversation.
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]">
                  Tools
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  Web search, code execution, and artifacts. Disable for plain
                  text chat.
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
              "space-y-3 transition-[box-shadow,background-color] duration-500",
              focusConnectedAccounts &&
                "-mx-2 rounded-xl bg-[var(--accent-muted)] px-2 py-3 ring-1 ring-[var(--accent)]/25",
            )}
          >
            <div className="flex items-center gap-2">
              <LinkIcon className="size-4 text-[var(--muted)]" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]">
                Connected accounts
              </span>
            </div>

            {!isAuthenticated ? (
              <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  Sign in to connect Google Drive or GitHub. Chat still works
                  without signing in.
                </p>
                <Link
                  href="/auth/signin?callbackUrl=%2F%3Fconnect%3Dgithub"
                  onClick={() => setOpenSettings(false)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Sign in
                  <ExternalLinkIcon className="size-3" />
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <GoogleDriveIcon className="size-4" />
                    <span className="text-sm text-[var(--text)]">
                      Google Drive
                    </span>
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
                    Connect Drive to browse and attach files from the composer.
                  </p>
                  {!googleConfigured && !driveConnected ? (
                    <p className="text-xs text-[var(--error-text)]">
                      Google OAuth is not configured on the server. Set
                      GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
                    </p>
                  ) : driveConnected ? (
                    <button
                      type="button"
                      onClick={() => void disconnectDrive()}
                      className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                    >
                      Disconnect Google Drive
                    </button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-1"
                      onClick={() => connectDrive()}
                    >
                      Connect Google Drive
                    </Button>
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <GitHubIcon className="size-4" />
                    <span className="text-sm text-[var(--text)]">GitHub</span>
                    {githubLoading ? (
                      <Loader2Icon className="ml-auto size-3.5 animate-spin text-[var(--muted)]" />
                    ) : githubConnected ? (
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]">
                        <CheckIcon className="size-3" />
                        Connected{githubLogin ? ` · @${githubLogin}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--muted-soft)]">
                    Connect GitHub so Aether can look up repos, list files, and
                    read source when you paste a link or ask about a codebase.
                  </p>
                  {!githubConfigured && !githubConnected ? (
                    <p className="text-xs text-[var(--error-text)]">
                      GitHub OAuth is not configured on the server. Set
                      GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, and add the
                      callback URL /api/github/callback.
                    </p>
                  ) : githubConnected ? (
                    <button
                      type="button"
                      onClick={() => void disconnectGitHubAccount()}
                      className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                    >
                      Disconnect GitHub
                    </button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-1"
                      onClick={() => connectGitHubAccount()}
                    >
                      Connect GitHub
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <MemorySettingsPanel />

          {/* Advanced — collapsed last; BYOK lives here */}
          <div className="border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => setAdvOpen((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[13px] text-[var(--muted)] transition-colors"
            >
              Advanced
              <ChevronRightIcon
                className={cn(
                  "size-4 text-[var(--muted-soft)] transition-transform",
                  advOpen && "rotate-90",
                )}
              />
            </button>
            {advOpen && (
              <div className="mt-3 space-y-4">
                <p className="text-[12px] leading-relaxed text-[var(--muted-soft)]">
                  Optional: use your own API key. Keys stay in this browser and
                  are sent only to your chosen provider.
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
                    <div className="font-medium">Hosted models</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                      {hostedLoading
                        ? "Checking…"
                        : hostedStatus?.available
                          ? "Ready — pick a model in the composer"
                          : "Not configured on this server"}
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
                    <div className="font-medium">Your own API key</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                      OpenRouter, OpenAI, Anthropic, or custom
                    </div>
                  </button>
                </div>

                {settings.accessMode === "byok" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
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

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="api-key"
                          className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]"
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
                          updateSettings({
                            [keyField]: e.target.value,
                          } as Partial<typeof settings>)
                        }
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
                      />
                    </div>

                    {(settings.provider === "custom" ||
                      settings.provider === "openai") && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="base-url"
                          className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]"
                        >
                          Base URL
                        </label>
                        <input
                          id="base-url"
                          type="url"
                          spellCheck={false}
                          placeholder="https://api.example.com/v1"
                          value={settings.baseURL}
                          onChange={(e) =>
                            updateSettings({ baseURL: e.target.value })
                          }
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label
                        htmlFor="custom-model"
                        className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-soft)]"
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
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
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
            Done
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

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.523 2 12 2Z" />
    </svg>
  );
}
