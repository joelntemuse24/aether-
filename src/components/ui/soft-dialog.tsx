"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SoftDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
};

/**
 * Lightweight in-app dialog — calm Aether shell alternative to window.prompt/confirm.
 */
export function SoftDialog({
  open,
  title,
  description,
  onClose,
  children,
  className,
}: SoftDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Focus first focusable control.
    requestAnimationFrame(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, button:not([disabled])",
      );
      el?.focus();
    });
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-4 shadow-none animate-[fadeIn_120ms_ease-out]",
          className,
        )}
      >
        <h2
          id={titleId}
          className="font-[family-name:var(--font-sc)] text-[13px] font-medium tracking-[0.06em] text-[var(--text)]"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

type SoftConfirmProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function SoftConfirm({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onClose,
}: SoftConfirmProps) {
  return (
    <SoftDialog open={open} title={title} description={description} onClose={onClose}>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </SoftDialog>
  );
}

type SoftPromptProps = {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  multiline?: boolean;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
};

export function SoftPrompt({
  open,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  multiline,
  confirmLabel = "Save",
  onSubmit,
  onClose,
}: SoftPromptProps) {
  const inputId = useId();
  const valueRef = useRef(initialValue);

  useEffect(() => {
    if (open) valueRef.current = initialValue;
  }, [open, initialValue]);

  const submit = () => {
    onSubmit(valueRef.current);
    onClose();
  };

  return (
    <SoftDialog open={open} title={title} description={description} onClose={onClose}>
      <div className="mt-3 space-y-2">
        {label ? (
          <label
            htmlFor={inputId}
            className="block text-[11px] font-medium text-[var(--muted)]"
          >
            {label}
          </label>
        ) : null}
        {multiline ? (
          <textarea
            id={inputId}
            key={`ta-${open}-${initialValue}`}
            defaultValue={initialValue}
            placeholder={placeholder}
            rows={4}
            onChange={(e) => {
              valueRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
          />
        ) : (
          <input
            id={inputId}
            key={`in-${open}-${initialValue}`}
            type="text"
            defaultValue={initialValue}
            placeholder={placeholder}
            onChange={(e) => {
              valueRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
          />
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit}>
          {confirmLabel}
        </Button>
      </div>
    </SoftDialog>
  );
}
