"use client";

import { useState, type FC } from "react";
import { cn } from "@/lib/utils";
import type { ClarifyQuestion, HarnessClassification } from "@/lib/harness/types";

type ClarifyCardProps = {
  classification: HarnessClassification;
  busy?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
};

/** Inline clarify prompts folded into the composer stack — no card chrome. */
export const ClarifyCard: FC<ClarifyCardProps> = ({
  classification,
  busy,
  onSubmit,
  onSkip,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = classification.questions;
  const allAnswered = questions.every((q) => !!answers[q.id]?.trim());

  return (
    <div className="mb-2 px-1 py-1 text-[13px] text-[var(--text-secondary)]">
      <div className="mb-2 text-[13px] font-medium text-[var(--text)]">
        Before I go further
      </div>

      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionBlock
            key={q.id}
            question={q}
            value={answers[q.id]}
            disabled={busy}
            onChange={(value) =>
              setAnswers((prev) => ({ ...prev, [q.id]: value }))
            }
          />
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !allAnswered}
          onClick={() => onSubmit(answers)}
          className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {busy ? "Starting…" : "Continue"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="rounded-lg px-2 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
        >
          Skip
        </button>
      </div>
    </div>
  );
};

function QuestionBlock({
  question,
  value,
  disabled,
  onChange,
}: {
  question: ClarifyQuestion;
  value?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (question.options && question.options.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="text-[12px] text-[var(--text)]">{question.prompt}</div>
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((opt) => {
            const active = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt.id)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[12px] transition-colors",
                  active
                    ? "bg-[var(--accent-muted)] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] text-[var(--text)]">
        {question.prompt}
      </label>
      <input
        type="text"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border-0 bg-[var(--elevated)] px-2.5 py-1.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:ring-1 focus:ring-[var(--focus-ring)]"
        placeholder="Your answer"
      />
    </div>
  );
}
