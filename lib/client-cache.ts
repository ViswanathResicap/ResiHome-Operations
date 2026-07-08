// Module-level cache that survives client-side navigation within a session
// (the module stays loaded across route changes in the SPA). This makes
// re-opening a tab you've already viewed instant — no re-fetch — while a
// background revalidation quietly keeps it fresh. Cleared on full page reload.
const store = new Map<string, unknown>();

export function getCachedPayload<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCachedPayload<T>(key: string, value: T): void {
  store.set(key, value);
}
