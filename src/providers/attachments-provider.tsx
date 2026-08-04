"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MAX_ATTACHMENTS,
  MAX_TOTAL_EMBEDDED_BYTES,
  processFiles,
  type PendingAttachment,
} from "@/lib/attachments";
import {
  clearAttachmentPayloads,
  deleteAttachmentPayload,
  getTotalPayloadApproxBytes,
  setAttachmentPayload,
} from "@/lib/attachment-payloads";

type AttachmentsContextValue = {
  attachments: PendingAttachment[];
  addFiles: (files: FileList | File[]) => Promise<string[]>;
  addAttachments: (items: PendingAttachment[]) => string[];
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  hasAttachments: boolean;
  remainingSlots: number;
};

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

/**
 * Move image/file `dataUrl`s into the side store so React state stays small.
 */
function detachBinaryPayloads(items: PendingAttachment[]): PendingAttachment[] {
  return items.map((item) => {
    if ((item.kind === "file" || item.kind === "image") && item.dataUrl) {
      setAttachmentPayload(item.id, item.dataUrl, item.size);
      return {
        id: item.id,
        name: item.name,
        kind: item.kind,
        mime: item.mime,
        size: item.size,
        text: item.text,
        hasPayload: true,
      };
    }
    return item;
  });
}

function dropPayloads(items: PendingAttachment[]) {
  for (const item of items) {
    if (item.hasPayload) deleteAttachmentPayload(item.id);
  }
}

function applySlotAndBudgetCap(
  prev: PendingAttachment[],
  candidates: PendingAttachment[],
): { kept: PendingAttachment[]; errors: string[] } {
  const errors: string[] = [];
  const remaining = MAX_ATTACHMENTS - prev.length;
  if (remaining <= 0) {
    dropPayloads(candidates);
    errors.push(`Maximum of ${MAX_ATTACHMENTS} files allowed.`);
    return { kept: [], errors };
  }

  // Live total already includes candidate payloads we just stashed.
  const candidatePayloadBytes = candidates.reduce(
    (sum, c) => (c.hasPayload ? sum + c.size : sum),
    0,
  );
  let usedWithoutCandidates =
    getTotalPayloadApproxBytes() - candidatePayloadBytes;

  const kept: PendingAttachment[] = [];
  let truncatedBySlots = false;

  for (const item of candidates) {
    if (kept.length >= remaining) {
      dropPayloads([item]);
      truncatedBySlots = true;
      continue;
    }
    if (item.hasPayload) {
      if (usedWithoutCandidates + item.size > MAX_TOTAL_EMBEDDED_BYTES) {
        deleteAttachmentPayload(item.id);
        kept.push({ ...item, hasPayload: false });
        errors.push(
          `"${item.name}" exceeded the remaining attach budget, so it was attached by name only.`,
        );
        continue;
      }
      usedWithoutCandidates += item.size;
    }
    kept.push(item);
  }

  if (truncatedBySlots) {
    const skipped = candidates.length - kept.length;
    if (prev.length === 0) {
      errors.push(
        `You can attach up to ${MAX_ATTACHMENTS} files. ${Math.max(skipped, 1)} skipped.`,
      );
    } else {
      errors.push(
        `Skipped ${Math.max(skipped, 1)} file(s) — only ${remaining} attachment slot(s) left.`,
      );
    }
  }

  return { kept, errors };
}

export function AttachmentsProvider({ children }: { children: ReactNode }) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { attachments: next, errors } = await processFiles(
      files,
      attachmentsRef.current.length,
    );
    if (next.length === 0) return errors;

    const light = detachBinaryPayloads(next);
    let capErrors: string[] = [];
    setAttachments((prev) => {
      const { kept, errors: e } = applySlotAndBudgetCap(prev, light);
      capErrors = e;
      if (kept.length === 0) return prev;
      return [...prev, ...kept];
    });
    return [...errors, ...capErrors];
  }, []);

  const addAttachments = useCallback((items: PendingAttachment[]) => {
    if (!items.length) return [] as string[];
    const light = detachBinaryPayloads(items);
    let capErrors: string[] = [];
    setAttachments((prev) => {
      const { kept, errors: e } = applySlotAndBudgetCap(prev, light);
      capErrors = e;
      if (kept.length === 0) return prev;
      return [...prev, ...kept];
    });
    return capErrors;
  }, []);

  const removeAttachment = useCallback((id: string) => {
    deleteAttachmentPayload(id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    clearAttachmentPayloads();
    setAttachments([]);
  }, []);

  // Allow Google Drive (and other sources) to inject attachments via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PendingAttachment[]>).detail;
      if (Array.isArray(detail) && detail.length > 0) {
        const errs = addAttachments(detail);
        if (errs.length > 0) {
          window.dispatchEvent(
            new CustomEvent("aether:notice", { detail: errs }),
          );
        }
      }
    };
    window.addEventListener("aether:add-attachments", handler);
    return () => window.removeEventListener("aether:add-attachments", handler);
  }, [addAttachments]);

  // Clear attachments when the active thread changes (custom event from runtime)
  useEffect(() => {
    const handler = () => {
      if (attachmentsRef.current.length > 0) {
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail:
              "Pending attachments were cleared because you switched chats.",
          }),
        );
      }
      clearAttachmentPayloads();
      setAttachments([]);
    };
    window.addEventListener("aether:thread-switched", handler);
    return () => window.removeEventListener("aether:thread-switched", handler);
  }, []);

  const value = useMemo(
    () => ({
      attachments,
      addFiles,
      addAttachments,
      removeAttachment,
      clearAttachments,
      hasAttachments: attachments.length > 0,
      remainingSlots: Math.max(0, MAX_ATTACHMENTS - attachments.length),
    }),
    [attachments, addFiles, addAttachments, removeAttachment, clearAttachments],
  );

  return (
    <AttachmentsContext.Provider value={value}>
      {children}
    </AttachmentsContext.Provider>
  );
}

export function useAttachments() {
  const ctx = useContext(AttachmentsContext);
  if (!ctx) {
    throw new Error("useAttachments must be used within AttachmentsProvider");
  }
  return ctx;
}
