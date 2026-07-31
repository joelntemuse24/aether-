"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  fetchOpenRouterModels,
  getCachedModels,
  setCachedModels,
  type ModelOption,
} from "@/lib/models";
import { rankModelsForPicker } from "@/lib/hosted/rank-models";
import { useSettings } from "@/providers/settings-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PickerModel = ModelOption & { family?: string };

const SECTION_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  other: "More",
};

export function ModelPicker({ className }: { className?: string }) {
  const {
    settings,
    updateSettings,
    activeModel,
    activeModelLabel,
    hostedStatus,
    hostedLoading,
  } = useSettings();
  const hosted = settings.accessMode === "hosted";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(!hosted && !getCachedModels());
  const [models, setModels] = useState<PickerModel[]>(
    () => (hosted ? [] : getCachedModels() ?? []),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const didAutoSelect = useRef(false);

  useEffect(() => {
    if (hosted) {
      const hostedModels: PickerModel[] = (hostedStatus?.models ?? []).map(
        (m) => ({
          id: m.id,
          label: m.label,
          provider: "openrouter" as const,
          description: m.description,
          family: m.family,
        }),
      );
      setModels(hostedModels);
      setLoading(hostedLoading);
      if (
        !didAutoSelect.current &&
        !settings.useCustomModel &&
        hostedModels.length > 0 &&
        (!activeModel || !hostedModels.some((m) => m.id === activeModel))
      ) {
        const next =
          hostedStatus?.defaultModel &&
          hostedModels.some((m) => m.id === hostedStatus.defaultModel)
            ? hostedStatus.defaultModel
            : hostedModels[0].id;
        didAutoSelect.current = true;
        updateSettings({ model: next, useCustomModel: false });
      }
      return;
    }

    didAutoSelect.current = false;
    const cached = getCachedModels();
    if (cached) {
      setModels(cached);
      setLoading(false);
    }
    let cancelled = false;
    if (!cached) setLoading(true);
    fetchOpenRouterModels()
      .then((live) => {
        if (cancelled) return;
        // Same capability ranking as Aether Cloud for BYOK OpenRouter picks
        const ranked = rankModelsForPicker(
          live.map((m) => ({
            id: m.id,
            name: m.label,
            context_length: undefined,
          })),
        ).map(
          (m): PickerModel => ({
            id: m.id,
            label: m.label,
            provider: "openrouter",
            description: m.description,
            family: m.family,
          }),
        );
        setModels(ranked);
        setCachedModels(ranked);
        if (!activeModel && ranked.length > 0) {
          const def =
            ranked.find((m) => m.family === "chatgpt")?.id ?? ranked[0].id;
          updateSettings({ model: def, useCustomModel: false });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when access mode / hosted catalog changes
  }, [hosted, hostedStatus, hostedLoading]);

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

  const sections = useMemo(() => {
    const order = ["chatgpt", "claude", "other"] as const;
    const grouped = new Map<string, PickerModel[]>();
    for (const m of models) {
      const key = m.family || "other";
      const list = grouped.get(key) ?? [];
      list.push(m);
      grouped.set(key, list);
    }
    // If models lack family (legacy cache), show flat "Models"
    if (![...grouped.keys()].some((k) => k in SECTION_LABELS)) {
      return [{ key: "all", label: hosted ? "Aether Cloud" : "Models", models }];
    }
    return order
      .filter((key) => (grouped.get(key)?.length ?? 0) > 0)
      .map((key) => ({
        key,
        label: SECTION_LABELS[key],
        models: grouped.get(key) ?? [],
      }));
  }, [models, hosted]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 max-w-[14rem] items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
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
          className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--elevated-deep)] py-1"
        >
          {loading ? (
            <div className="px-3 py-3 text-center">
              <Label>Loading models…</Label>
            </div>
          ) : models.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <Label>
                {hosted ? "Cloud models unavailable" : "No models loaded"}
              </Label>
            </div>
          ) : (
            <>
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="px-3 pb-1 pt-2">
                    <Label>{section.label}</Label>
                  </div>
                  {section.models.map((model) => {
                    const selected =
                      activeModel === model.id && !settings.useCustomModel;
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
                </div>
              ))}
              {!hosted && settings.useCustomModel && settings.customModel && (
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
