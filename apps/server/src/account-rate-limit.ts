import "./errors.js";
import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";

export const ACCOUNT_ACTION_RATE_WINDOW_MS = 60_000;
export const ACCOUNT_ACTION_RATE_MAX = 30;
export const ACCOUNT_ACTION_GLOBAL_RATE_MAX = 300;

export interface AccountActionRateLimiter {
  check(subject: string): void;
}

/** Process-local resend spacing, independent of account existence. Call after the flood guard. */
export function createPasswordResetCooldown(
  now: () => number = Date.now,
): (email: string) => boolean {
  const deadlines = new Map<string, number>();
  return (email) => {
    const current = now();
    for (const [key, deadline] of deadlines) {
      if (deadline <= current) deadlines.delete(key);
    }
    const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    if (deadlines.has(key)) return false;
    deadlines.set(key, current + 60_000);
    return true;
  };
}

/** A process-local flood guard with per-subject isolation and a bounded global ceiling. */
export function createAccountActionRateLimiter(
  now: () => number = Date.now,
): AccountActionRateLimiter {
  let windowStart = now();
  let globalCount = 0;
  const counts = new Map<string, number>();
  return {
    check(subject: string): void {
      const current = now();
      if (current - windowStart >= ACCOUNT_ACTION_RATE_WINDOW_MS) {
        windowStart = current;
        globalCount = 0;
        counts.clear();
      }
      const key = createHash("sha256").update(subject, "utf8").digest("hex");
      const count = counts.get(key) ?? 0;
      if (count >= ACCOUNT_ACTION_RATE_MAX || globalCount >= ACCOUNT_ACTION_GLOBAL_RATE_MAX) {
        throw new AppError("account_action.rate_limited", {});
      }
      counts.set(key, count + 1);
      globalCount += 1;
    },
  };
}
