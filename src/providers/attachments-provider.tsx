"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  MAX_ATTACHMENTS,
  processFiles,
  type PendingAttachment,
} from "@/lib/attachments";
import {
  clearAttachmentPayloads,
  deleteAttachmentPayload,
  setAttachmentPayload,
} from "@/lib/attachment-payloads";

type AttachmentsContextValue = {
  attachments: PendingAttachment[];
  addFiles: (files: FileList | File[]) => Promise<string[]>;
  addAttachments: (items: PendingAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  hasAttachments: boolean;
  remainingSlots: number;
};

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

/**
 * Move large file `dataUrl`s into the side store so React state stays small.
 * Images keep `dataUrl` in state (thumbnails / typical sizes are manageable).
 */
function detachFilePayloads(items: PendingAttachment[]): PendingAttachment[] {
  return items.map((item) => {
    if (item.kind === "file" && item.dataUrl) {
      setAttachmentPayload(item.id, item.dataUrl);
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

export function AttachmentsProvider({ children }: { children: ReactNode }) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { attachments: next, errors } = await processFiles(
      files,
      attachments.length,
    );
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...detachFilePayloads(next)]);
    }
    return errors;
  }, [attachments.length]);

  const addAttachments = useCallback((items: PendingAttachment[]) => {
    if (!items.length) return;
    const light = detachFilePayloads(items);
    setAttachments((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      if (remaining <= 0) {
        // Drop payloads we just stashed but won't keep
        for (const item of light) {
          if (item.hasPayload) deleteAttachmentPayload(item.id);
        }
        return prev;
      }
      const kept = light.slice(0, remaining);
      for (const item of light.slice(remaining)) {
        if (item.hasPayload) deleteAttachmentPayload(item.id);
      }
      return [...prev, ...kept];
    });
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
        addAttachments(detail);
      }
    };
    window.addEventListener("aether:add-attachments", handler);
    return () => window.removeEventListener("aether:add-attachments", handler);
  }, [addAttachments]);

  // Clear attachments when the active thread changes (custom event from runtime)
  useEffect(() => {
    const handler = () => {
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
