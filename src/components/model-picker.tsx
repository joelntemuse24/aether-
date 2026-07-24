"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  fetchOpenRouterModels,
  getCachedModels,
  setCachedModels,
  type ModelOption,
} from "@/lib/models";
import { useSettings } from "@/providers/settings-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function ModelPicker({ className }: { className?: string }) {
  const { settings, updateSettings, activeModel, activeModelLabel } =
    useSettings();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(!getCachedModels());
  const [models, setModels] = useState<ModelOption[]>(
    () => getCachedModels() ?? [],
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = getCachedModels();
    if (cached) {
      setModels(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchOpenRouterModels()
      .then((live) => {
        if (cancelled) return;
        setModels(live);
        setCachedModels(live);
        // Auto-select first model if none is set
        if (!activeModel && live.length > 0) {
          updateSettings({ model: live[0].id, useCustomModel: false });
        }
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 max-w-[11rem] items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{activeModelLabel}</span>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 opacity-50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--elevated-deep)] py-1"
        >
          <div className="px-3 pb-1.5 pt-2">
            <Label>Models</Label>
          </div>
          {loading ? (
            <div className="px-3 py-3 text-center">
              <Label>Loading models…</Label>
            </div>
          ) : (
            <>
              {models.map((model) => {
                const selected = activeModel === model.id && !settings.useCustomModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      updateSettings({
                        model: model.id,
                        useCustomModel: false,
                      });
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--hover-overlay)]",
                      selected && "bg-[var(--accent-muted)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[var(--text)]">
                        {model.label}
                      </div>
                      {model.description && (
                        <Label>{model.description}</Label>
                      )}
                    </div>
                    {selected && (
                      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />
                    )}
                  </button>
                );
              })}
              {settings.useCustomModel && settings.customModel && (
                <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                  Custom: {settings.customModel}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
