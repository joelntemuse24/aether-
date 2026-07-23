"use client";

import { useEffect, useId } from "react";
import { XIcon, ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { PROVIDER_DEFAULTS, type ProviderId } from "@/lib/models";
import { Button } from "@/components/ui/button";
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
        className="absolute inset-0 bg-[rgba(20,20,19,0.28)]"
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
              className="text-base font-semibold text-[var(--text)]"
            >
              Settings
            </h2>
          </div>
          {hasKey && (
            <button
              type="button"
              onClick={() => setOpenSettings(false)}
              className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
              aria-label="Close settings"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>

        <div className="space-y-5 px-5 py-5">
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Bring your own key. Keys stay in this browser&apos;s localStorage and
            are sent only to your chosen provider via the app&apos;s chat proxy.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]">
              Provider
            </label>
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
                    "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    settings.provider === id
                      ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--elevated)]",
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
              ids like <code className="text-[var(--text)]">anthropic/claude-sonnet-4</code>.
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
