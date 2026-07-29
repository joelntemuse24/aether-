"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  HarnessChatContext,
  HarnessClassification,
} from "@/lib/harness/types";

export type HarnessPendingClarify = {
  text: string;
  runId: string;
  classification: HarnessClassification;
};

type HarnessContextValue = {
  pending: HarnessPendingClarify | null;
  setPending: (next: HarnessPendingClarify | null) => void;
  /** Context attached to the next /api/chat body (depth budgets + clarifications). */
  peekChatContext: () => HarnessChatContext | null;
  armChatContext: (ctx: HarnessChatContext) => void;
  clearChatContext: () => void;
  classifying: boolean;
  setClassifying: (v: boolean) => void;
  lastPlanSteps: string[] | undefined;
  setLastPlanSteps: (steps: string[] | undefined) => void;
};

const HarnessContext = createContext<HarnessContextValue | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<HarnessPendingClarify | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [lastPlanSteps, setLastPlanSteps] = useState<string[] | undefined>();
  const chatCtxRef = useRef<HarnessChatContext | null>(null);

  const peekChatContext = useCallback(() => chatCtxRef.current, []);
  const armChatContext = useCallback((ctx: HarnessChatContext) => {
    chatCtxRef.current = ctx;
  }, []);
  const clearChatContext = useCallback(() => {
    chatCtxRef.current = null;
  }, []);

  const value = useMemo(
    () => ({
      pending,
      setPending,
      peekChatContext,
      armChatContext,
      clearChatContext,
      classifying,
      setClassifying,
      lastPlanSteps,
      setLastPlanSteps,
    }),
    [
      pending,
      peekChatContext,
      armChatContext,
      clearChatContext,
      classifying,
      lastPlanSteps,
    ],
  );

  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}

export function useHarness(): HarnessContextValue {
  const ctx = useContext(HarnessContext);
  if (!ctx) {
    throw new Error("useHarness must be used within HarnessProvider");
  }
  return ctx;
}
