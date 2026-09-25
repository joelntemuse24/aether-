"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BUZZ_MODEL_STORAGE_KEY,
  BUZZ_UNAVAILABLE_KEY,
  DEFAULT_BUZZ_MODEL,
  buzzModelLabel,
  knownBuzzChatModels,
  type BuzzChatModel,
} from "@/lib/buzz/models";
import { cn } from "@/lib/utils";

function readStoredModel(): string {
  if (typeof window === "undefined") return DEFAULT_BUZZ_MODEL;
  return localStorage.getItem(BUZZ_MODEL_STORAGE_KEY) || DEFAULT_BUZZ_MODEL;
}

function readUnavailable(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(BUZZ_UNAVAILABLE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberUnavailable(id: string) {
  const next = Array.from(new Set([...readUnavailable(), id]));
  sessionStorage.setItem(BUZZ_UNAVAILABLE_KEY, JSON.stringify(next));
}

export function BuzzModelPicker() {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<BuzzChatModel[]>(knownBuzzChatModels);
  const [selected, setSelected] = useState(DEFAULT_BUZZ_MODEL);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    setSelected(readStoredModel());
    setUnavailable(readUnavailable());
    let cancelled = false;
    fetch("/api/hosted/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models?: BuzzChatModel[] } | null) => {
        if (cancelled || !body?.models?.length) return;
        setModels(body.models);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onUnavailable = (event: Event) => {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "");
      const match = models.find((model) => text.startsWith(model.label));
      if (!match) return;
      rememberUnavailable(match.id);
      setUnavailable(readUnavailable());
    };
    window.addEventListener("aether:buzz-model-unavailable", onUnavailable);
    return () => window.removeEventListener("aether:buzz-model-unavailable", onUnavailable);
  }, [models]);

  const choose = useCallback((id: string) => {
    localStorage.setItem(BUZZ_MODEL_STORAGE_KEY, id);
    setSelected(id);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const ordered = [
    ...models.filter((model) => model.group === "OpenAI"),
    ...models.filter((model) => model.group === "Anthropic"),
  ];
  const current = ordered.find((model) => model.id === selected) ?? ordered[0];
  const label = current?.label ?? buzzModelLabel(selected);
  const groups = ["OpenAI", "Anthropic"] as const;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setActive(Math.max(0, ordered.findIndex((model) => model.id === selected)));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (index + step + ordered.length) % ordered.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const model = ordered[active];
      if (model && !unavailable.includes(model.id)) choose(model.id);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="flex h-7 max-w-[9.5rem] items-center gap-1 rounded-full border border-[var(--border)] bg-transparent px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setActive(Math.max(0, ordered.findIndex((model) => model.id === selected)));
          setOpen((value) => !value);
        }}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-[var(--muted)]" />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Models"
          className="fixed inset-x-3 bottom-3 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--elevated-deep)] p-1 shadow-lg md:absolute md:inset-x-auto md:bottom-full md:left-0 md:mb-2 md:max-h-80 md:w-64"
        >
          {groups.map((group) => {
            const rows = ordered.filter((model) => model.group === group);
            if (!rows.length) return null;
            return (
              <div key={group} className="py-1">
                <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-soft)]">
                  {group}
                </div>
                {rows.map((model) => {
                  const index = ordered.indexOf(model);
                  const disabled = unavailable.includes(model.id);
                  const checked = model.id === selected;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={checked}
                      aria-disabled={disabled}
                      disabled={disabled}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]",
                        index === active && "bg-[var(--hover-overlay)]",
                        disabled
                          ? "cursor-not-allowed text-[var(--muted-soft)]"
                          : "text-[var(--text)]",
                      )}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(model.id)}
                    >
                      <span className="flex-1 truncate">{model.label}</span>
                      {disabled ? (
                        <span className="text-[10px] text-[var(--muted-soft)]">Unavailable</span>
                      ) : checked ? (
                        <CheckIcon className="size-3.5 text-[var(--accent)]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
