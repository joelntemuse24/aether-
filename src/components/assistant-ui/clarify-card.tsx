"use client";

import { useState, type FC } from "react";
import { cn } from "@/lib/utils";
import type { ClarifyQuestion, HarnessClassification } from "@/lib/harness/types";
import { budgetForDepth } from "@/lib/harness/budgets";

type ClarifyCardProps = {
  classification: HarnessClassification;
  busy?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
};

export const ClarifyCard: FC<ClarifyCardProps> = ({
  classification,
  busy,
  onSubmit,
  onSkip,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const budget = budgetForDepth(classification.depth);
  const questions = classification.questions;
  const allAnswered = questions.every((q) => !!answers[q.id]?.trim());

  return (
    <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-3 text-[13px] text-[var(--text-secondary)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-medium text-[var(--text)]">
          Quick check before I go deep
        </div>
        <span className="rounded-md bg-[var(--hover-overlay)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          {budget.label} · {classification.intent.replace("_", " ")}
        </span>
      </div>

      {classification.planSteps && classification.planSteps.length > 0 && (
        <ol className="mb-3 list-decimal space-y-0.5 pl-4 text-[12px] text-[var(--muted)]">
          {classification.planSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

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

      <div className="mt-3 flex items-center gap-2">
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
          Skip — just go
        </button>
      </div>
    </div>
  );
};

const QuestionBlock: FC<{
  question: ClarifyQuestion;
  value?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ question, value, disabled, onChange }) => {
  const options = question.options ?? [];
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-[var(--text)]">
        {question.prompt}
      </div>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const selected = value === opt.id || value === opt.label;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt.label)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]/40"
          placeholder="Your answer"
        />
      )}
    </div>
  );
};
