import type { ReleaseReminder } from "../api/client.js";

/** The longest delay `setTimeout` holds: 2^31 − 1 ms, about 24.8 days. */
export const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** When a release reminder falls due, in epoch milliseconds; never, while it has no readable time. */
export function reminderDueAt(reminder: ReleaseReminder | null | undefined): number {
  const dueAt = Date.parse(reminder?.dueAt ?? "");
  return Number.isNaN(dueAt) ? Number.POSITIVE_INFINITY : dueAt;
}
