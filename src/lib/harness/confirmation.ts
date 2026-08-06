/**
 * Confirmation protocol for side-effecting actions.
 * Tools that would submit/send/post return needs_confirmation; the user (or
 * Agent panel later) must approve before the action executes.
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

/** In-memory pending confirmations (per server instance). Good enough for Vercel soft state + client relay. */
const pending = new Map<
  string,
  {
    request: ConfirmationRequest;
    userId?: string | null;
    createdAt: number;
  }
>();

const TTL_MS = 30 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, row] of pending) {
    if (now - row.createdAt > TTL_MS) pending.delete(id);
  }
}

export function createConfirmationRequest(
  request: ConfirmationRequest,
  userId?: string | null,
): ConfirmationToolResult {
  gc();
  const confirmation_id = crypto.randomUUID();
  pending.set(confirmation_id, {
    request,
    userId: userId ?? null,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    needs_confirmation: true,
    confirmation_id,
    action: request.action,
    title: request.title,
    preview: request.preview,
    target: request.target,
    instruction:
      "Stop before this side effect. Show the user the preview and wait for explicit approval (UI confirm or user saying approve). Do not claim the action completed.",
  };
}

export function resolveConfirmation(
  confirmationId: string,
  approved: boolean,
  userId?: string | null,
): ConfirmationResolved | { ok: false; error: string } {
  gc();
  const row = pending.get(confirmationId);
  if (!row) {
    return { ok: false, error: "Confirmation expired or not found." };
  }
  if (row.userId && userId && row.userId !== userId) {
    return { ok: false, error: "Confirmation belongs to another session." };
  }
  pending.delete(confirmationId);
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

export function peekConfirmation(confirmationId: string) {
  gc();
  return pending.get(confirmationId) ?? null;
}
