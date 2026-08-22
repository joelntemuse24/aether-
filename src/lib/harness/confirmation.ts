/**
 * Confirmation protocol for side-effecting actions.
 * Tools that would submit/send/post return needs_confirmation; the user (or
 * Agent panel later) must approve before the action executes.
 *
 * In-memory map covers guests / no-DB. Signed-in + cloud DB also persist so
 * confirm cards survive refresh (same /api/harness/confirm contract).
 */

import { z } from "zod";

export const CONFIRMABLE_ACTIONS = [
  "submit_form",
  "send_message",
  "upload_file",
  "browser_click_submit",
  "browser_fill_and_submit",
  "delete_resource",
  "other_side_effect",
] as const;

export type ConfirmableAction = (typeof CONFIRMABLE_ACTIONS)[number];

export const confirmationRequestSchema = z.object({
  action: z.enum(CONFIRMABLE_ACTIONS),
  title: z.string().min(1).max(120),
  preview: z.string().min(1).max(2000),
  /** Optional target URL or resource id for the UI. */
  target: z.string().max(2000).optional(),
  /** Opaque payload the client returns on approve (no secrets). */
  payload: z.record(z.string(), z.any()).optional(),
});

export type ConfirmationRequest = z.infer<typeof confirmationRequestSchema>;

export type ConfirmationToolResult = {
  ok: true;
  needs_confirmation: true;
  confirmation_id: string;
  action: ConfirmableAction;
  title: string;
  preview: string;
  target?: string;
  /** Shown to the model — do not execute until user confirms. */
  instruction: string;
};

export type ConfirmationResolved = {
  ok: true;
  needs_confirmation: false;
  confirmation_id: string;
  approved: boolean;
  note: string;
};

export type PendingConfirmationRow = {
  id: string;
  request: ConfirmationRequest;
  userId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  createdAt: number;
  status: "pending" | "approved" | "declined";
  approved?: boolean;
};

export type ConfirmationRepository = {
  save(row: PendingConfirmationRow): Promise<void>;
  load(id: string): Promise<PendingConfirmationRow | null>;
  remove?(id: string): Promise<void>;
};

const pending = new Map<string, PendingConfirmationRow>();
const TTL_MS = 30 * 60 * 1000;

let repository: ConfirmationRepository | null = null;

export function setConfirmationRepository(
  next: ConfirmationRepository | null,
): void {
  repository = next;
}

export function getConfirmationRepository(): ConfirmationRepository | null {
  return repository;
}

function gc() {
  const now = Date.now();
  for (const [id, row] of pending) {
    if (now - row.createdAt > TTL_MS) pending.delete(id);
  }
}

export function forgetMemoryConfirmation(confirmationId: string): void {
  pending.delete(confirmationId);
}

function toResult(row: PendingConfirmationRow): ConfirmationToolResult {
  return {
    ok: true,
    needs_confirmation: true,
    confirmation_id: row.id,
    action: row.request.action,
    title: row.request.title,
    preview: row.request.preview,
    target: row.request.target,
    instruction:
      "Stop before this side effect. Show the user the preview and wait for explicit approval (UI confirm or user saying approve). Do not claim the action completed.",
  };
}

export async function createConfirmationRequest(
  request: ConfirmationRequest,
  userId?: string | null,
  extras?: { conversationId?: string | null; runId?: string | null },
): Promise<ConfirmationToolResult> {
  gc();
  const confirmation_id = crypto.randomUUID();
  const row: PendingConfirmationRow = {
    id: confirmation_id,
    request,
    userId: userId ?? null,
    conversationId: extras?.conversationId ?? null,
    runId: extras?.runId ?? null,
    createdAt: Date.now(),
    status: "pending",
  };
  pending.set(confirmation_id, row);
  if (repository && userId) {
    await repository.save(row);
  }
  return toResult(row);
}

export async function peekConfirmation(
  confirmationId: string,
): Promise<PendingConfirmationRow | null> {
  gc();
  const memory = pending.get(confirmationId);
  if (memory) return memory;
  if (!repository) return null;
  const stored = await repository.load(confirmationId);
  if (!stored) return null;
  pending.set(confirmationId, stored);
  return stored;
}

export async function resolveConfirmation(
  confirmationId: string,
  approved: boolean,
  userId?: string | null,
): Promise<ConfirmationResolved | { ok: false; error: string }> {
  gc();
  let row = pending.get(confirmationId) ?? null;
  if (!row && repository) {
    row = await repository.load(confirmationId);
  }
  if (!row) {
    return { ok: false, error: "Confirmation expired or not found." };
  }
  if (row.status !== "pending") {
    return {
      ok: true,
      needs_confirmation: false,
      confirmation_id: confirmationId,
      approved: row.status === "approved",
      note:
        row.status === "approved"
          ? "User already approved. You may proceed with the described action carefully."
          : "User already declined. Do not perform the action; offer an alternative.",
    };
  }
  if (row.userId && userId && row.userId !== userId) {
    return { ok: false, error: "Confirmation belongs to another session." };
  }
  const next: PendingConfirmationRow = {
    ...row,
    status: approved ? "approved" : "declined",
    approved,
  };
  pending.set(confirmationId, next);
  if (repository) {
    await repository.save(next);
  }
  return {
    ok: true,
    needs_confirmation: false,
    confirmation_id: confirmationId,
    approved,
    note: approved
      ? "User approved. You may proceed with the described action carefully."
      : "User declined. Do not perform the action; offer an alternative.",
  };
}
