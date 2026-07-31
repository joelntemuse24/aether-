/** Local Vault notes — browser-only scratchpad (links, drafts, thoughts). */

export type VaultNote = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};

export const VAULT_STORAGE_KEY = "aether:vault-notes";

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
