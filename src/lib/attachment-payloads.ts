/**
 * Side store for large binary attachment payloads (images, Drive PDFs).
 *
 * Keeping multi-MB base64 strings in React state freezes the composer after
 * attaching several files — every context consumer re-renders with huge
 * strings, and the chat transport rebuilds against that state. Payloads live
 * here instead; React state only holds lightweight metadata.
 */

const payloads = new Map<string, string>();

/** Approximate total embedded payload size (decoded), for send budgets. */
let totalApproxBytes = 0;

export function setAttachmentPayload(id: string, dataUrl: string, approxBytes?: number): void {
  const prev = payloads.get(id);
  if (prev) {
    totalApproxBytes -= estimatePayloadBytes(prev);
  }
  payloads.set(id, dataUrl);
  totalApproxBytes += approxBytes ?? estimatePayloadBytes(dataUrl);
}

export function getAttachmentPayload(id: string): string | undefined {
  return payloads.get(id);
}

export function deleteAttachmentPayload(id: string): void {
  const prev = payloads.get(id);
  if (prev) {
    totalApproxBytes -= estimatePayloadBytes(prev);
    payloads.delete(id);
  }
}

export function clearAttachmentPayloads(): void {
  payloads.clear();
  totalApproxBytes = 0;
}

export function hasAttachmentPayload(id: string): boolean {
  return payloads.has(id);
}

export function getTotalPayloadApproxBytes(): number {
  return Math.max(0, totalApproxBytes);
}

/** Rough decoded size from a data URL (base64 expands ~4/3). */
export function estimatePayloadBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
  return Math.floor((b64 * 3) / 4);
}
