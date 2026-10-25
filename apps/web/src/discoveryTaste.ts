/** One owner for the legacy Discovery taste storage/event contract.
 * Neutral dismissal is separate and deliberately NEVER written here.
 */
export type TasteEntry = { value: -1 | 1; artist: string; tags: string[] };
export type TasteState = Record<string, TasteEntry>;

const TASTE_KEY = "waxloom.discovery.taste.v1";
const TASTE_EVENT = "waxloom:discovery-taste";

export function readTaste(): TasteState {
  try {
    const raw = window.localStorage.getItem(TASTE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as TasteState;
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

export function writeTaste(value: TasteState): void {
  try { window.localStorage.setItem(TASTE_KEY, JSON.stringify(value)); }
  catch { /* Private browsing/storage disabled: notify other mounted views anyway. */ }
  window.dispatchEvent(new Event(TASTE_EVENT));
}

export function subscribeTaste(listener: () => void): () => void {
  window.addEventListener(TASTE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(TASTE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}