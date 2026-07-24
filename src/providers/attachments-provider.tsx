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
  processFiles,
  type PendingAttachment,
} from "@/lib/attachments";

type AttachmentsContextValue = {
  attachments: PendingAttachment[];
  addFiles: (files: FileList | File[]) => Promise<string[]>;
  addAttachments: (items: PendingAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  hasAttachments: boolean;
};

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

export function AttachmentsProvider({ children }: { children: ReactNode }) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { attachments: next, errors } = await processFiles(
      files,
      attachments.length,
    );
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
    }
    return errors;
  }, [attachments.length]);

  const addAttachments = useCallback((items: PendingAttachment[]) => {
    if (!items.length) return;
    setAttachments((prev) => {
      const remaining = 6 - prev.length;
      if (remaining <= 0) return prev;
      return [...prev, ...items.slice(0, remaining)];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
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

  const value = useMemo(
    () => ({
      attachments,
      addFiles,
      addAttachments,
      removeAttachment,
      clearAttachments,
      hasAttachments: attachments.length > 0,
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
