export const CHANGES_AFTER_SENDING = ["never", "held", "held-or-waiting"] as const;
export type ChangesAfterSending = (typeof CHANGES_AFTER_SENDING)[number];

export function isChangesAfterSending(value: unknown): value is ChangesAfterSending {
  return (CHANGES_AFTER_SENDING as readonly unknown[]).includes(value);
}

export function allowsChangeAfterSending(value: ChangesAfterSending, fired: boolean): boolean {
  if (value === "held-or-waiting") return true;
  if (value === "held") return !fired;
  return false;
}
