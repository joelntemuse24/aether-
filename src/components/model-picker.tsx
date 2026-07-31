"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import {
  fetchOpenRouterModels,
  getCachedModels,
  setCachedModels,
  type ModelOption,
} from "@/lib/models";
import {
  featuredModelsForPicker,
  filterModelsByQuery,
  rankModelsForPicker,
} from "@/lib/hosted/rank-models";
import { useSettings } from "@/providers/settings-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PickerModel = ModelOption & { family?: string };

const SECTION_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  other: "More",
};

const SEARCH_RESULT_LIMIT = 40;

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
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!hosted && !getCachedModels());
  const [models, setModels] = useState<PickerModel[]>(
    () => (hosted ? [] : getCachedModels() ?? []),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const searching = query.trim().length > 0;

  const visibleModels = useMemo(() => {
    if (searching) {
      return filterModelsByQuery(models, query).slice(0, SEARCH_RESULT_LIMIT);
    }
    const featured = featuredModelsForPicker(models);
    // Keep the active model visible even if it isn't on the shortlist
    if (
      activeModel &&
      !settings.useCustomModel &&
      !featured.some((m) => m.id === activeModel)
    ) {
      const current = models.find((m) => m.id === activeModel);
      if (current) return [current, ...featured];
    }
    return featured.length > 0 ? featured : models.slice(0, 12);
  }, [models, query, searching, activeModel, settings.useCustomModel]);

  const sections = useMemo(() => {
    const order = ["chatgpt", "claude", "other"] as const;
    const grouped = new Map<string, PickerModel[]>();
    for (const m of visibleModels) {
      const key = m.family || "other";
      const list = grouped.get(key) ?? [];
      list.push(m);
      grouped.set(key, list);
    }
    if (![...grouped.keys()].some((k) => k in SECTION_LABELS)) {
      return [
        {
          key: "all",
          label: searching ? "Results" : "Models",
          models: visibleModels,
        },
      ];
    }
    return order
      .filter((key) => (grouped.get(key)?.length ?? 0) > 0)
      .map((key) => ({
        key,
        label: SECTION_LABELS[key],
        models: grouped.get(key) ?? [],
      }));
  }, [visibleModels, searching]);

  const selectModel = (id: string) => {
    updateSettings({ model: id, useCustomModel: false });
    setOpen(false);
  };

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
          className="absolute bottom-full left-0 z-50 mb-2 flex w-72 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--elevated-deep)]"
        >
          <div className="border-b border-[var(--border)] px-2 py-2">
            <div className="flex items-center gap-2 rounded-md bg-[var(--surface)] px-2 py-1.5">
              <SearchIcon className="size-3.5 shrink-0 text-[var(--muted-soft)]" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)]"
                aria-label="Search models"
              />
            </div>
          </div>

          <div role="listbox" className="max-h-72 overflow-y-auto py-1">
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
            ) : visibleModels.length === 0 ? (
              <div className="px-3 py-3 text-center">
                <Label>No matches</Label>
              </div>
            ) : (
              <>
                {!searching && (
                  <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-soft)]">
                    Featured
                  </div>
                )}
                {sections.map((section) => (
                  <div key={section.key}>
                    <div className="px-3 pb-0.5 pt-1.5">
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
                          onClick={() => selectModel(model.id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--hover-overlay)]",
                            selected && "bg-[var(--accent-muted)]",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                            {model.label}
                          </span>
                          {selected && (
                            <CheckIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {searching &&
                  filterModelsByQuery(models, query).length >
                    SEARCH_RESULT_LIMIT && (
                    <div className="px-3 py-2 text-[11px] text-[var(--muted-soft)]">
                      Showing top {SEARCH_RESULT_LIMIT} matches — refine search
                    </div>
                  )}
                {!hosted &&
                  settings.useCustomModel &&
                  settings.customModel && (
                    <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                      Custom: {settings.customModel}
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
