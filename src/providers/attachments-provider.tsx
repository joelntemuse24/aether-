"use client";

import {
  createContext,
  useCallback,
  useContext,
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

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const value = useMemo(
    () => ({
      attachments,
      addFiles,
      removeAttachment,
      clearAttachments,
      hasAttachments: attachments.length > 0,
    }),
    [attachments, addFiles, removeAttachment, clearAttachments],
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
