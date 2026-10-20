import type { ReleaseReminder } from "../api/client.js";

/** The longest delay `setTimeout` holds: 2^31 − 1 ms, about 24.8 days. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** When a release reminder falls due, in epoch milliseconds; never, while it has no readable time. */
export function reminderDueAt(reminder: ReleaseReminder | null | undefined): number {
  const dueAt = Date.parse(reminder?.dueAt ?? "");
  return Number.isNaN(dueAt) ? Number.POSITIVE_INFINITY : dueAt;
}

/** The minutes left until `dueAt`, rounded up, so the last minute reads 1. For `dueAt > now` only. */
export function minutesToFire(dueAt: number, now: number): number {
  return Math.ceil((dueAt - now) / 60_000);
}

/** The moment `minutesToFire` next changes: `dueAt` itself in the last minute. */
export function nextCountdownChange(dueAt: number, now: number): number {
  return dueAt - (minutesToFire(dueAt, now) - 1) * 60_000;
}

/**
 * The delay to hand `setTimeout` for a timer due at `dueAt`, capped at the longest it holds: a longer
 * delay overflows the browser's timer, which then fires at once.
 */
export function delayUntil(dueAt: number): number {
  return Math.min(dueAt - Date.now(), LONGEST_TIMER_MS);
}
