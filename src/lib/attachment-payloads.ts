/**
 * Side store for large binary attachment payloads (e.g. Drive PDF data URLs).
 *
 * Keeping multi-MB base64 strings in React state freezes the composer after
 * attaching several files — every context consumer re-renders with huge
 * strings, and the chat transport rebuilds against that state. Payloads live
 * here instead; React state only holds lightweight metadata.
 */

const payloads = new Map<string, string>();

export function setAttachmentPayload(id: string, dataUrl: string): void {
  payloads.set(id, dataUrl);
}

export function getAttachmentPayload(id: string): string | undefined {
  return payloads.get(id);
}

export function deleteAttachmentPayload(id: string): void {
  payloads.delete(id);
}

export function clearAttachmentPayloads(): void {
  payloads.clear();
}

export function hasAttachmentPayload(id: string): boolean {
  return payloads.has(id);
}
