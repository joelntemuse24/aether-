/** Local Vault notes — browser fallback when cloud is unavailable. */

import type { VaultNoteDTO } from "@/lib/vault/types";

export type VaultNote = VaultNoteDTO;
export type { VaultNoteDTO } from "@/lib/vault/types";

export const VAULT_STORAGE_KEY = "aether:vault-notes";
export const VAULT_MIGRATED_KEY = "aether:vault-migrated";

export function loadVaultNotes(): VaultNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VaultNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVaultNotes(notes: VaultNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* Session state still holds the note. */
  }
}

export function clearLocalVaultNotes(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
