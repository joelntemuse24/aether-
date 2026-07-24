"use client";

import { useEffect, useId } from "react";
import { XIcon, ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { PROVIDER_DEFAULTS, type ProviderId } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PROVIDERS: ProviderId[] = ["openrouter", "openai", "anthropic", "custom"];

export function SettingsDialog() {
  const {
    settings,
    updateSettings,
    openSettings,
    setOpenSettings,
    hasKey,
  } = useSettings();
  const titleId = useId();

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
        className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-0 shadow-none"
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
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Bring your own key. Keys stay in this browser&apos;s localStorage and
            are sent only to your chosen provider via the app&apos;s chat proxy.
          </p>

          <div className="space-y-2">
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
              <code className="text-[var(--text)]">anthropic/claude-sonnet-4</code>.
            </p>
          </div>

          {/* Google Drive */}
          <div className="space-y-2 border-t border-[var(--border)] pt-5">
            <label
              htmlFor="google-client-id"
              className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]"
            >
              Google Client ID (for Drive)
            </label>
            <input
              id="google-client-id"
              type="text"
              spellCheck={false}
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              value={settings.googleClientId}
              onChange={(e) =>
                updateSettings({ googleClientId: e.target.value.trim() })
              }
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
            />
            <p className="text-xs leading-relaxed text-[var(--muted-soft)]">
              Optional. Create an OAuth 2.0 Client ID (Web application) in{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                Google Cloud Console
              </a>
              , enable the <strong>Google Picker API</strong> and{" "}
              <strong>Google Drive API</strong>, then paste the Client ID here.
              Add your site origin (e.g. https://aether-seven-theta.vercel.app)
              under Authorized JavaScript origins.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          {hasKey && (
            <Button variant="ghost" onClick={() => setOpenSettings(false)}>
              Cancel
            </Button>
          )}
          <Button
            onClick={() => setOpenSettings(false)}
            disabled={!keyValue.trim()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
