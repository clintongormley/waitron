import "./errors.js";
import { createHash } from "node:crypto";
import { createPinThrottle, PIN_THROTTLE_IDLE_MS } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";

type Outcome = "success" | "invalid" | "error";
export interface PasswordThrottle {
  begin(email: string): (outcome: Outcome) => void;
}

/** Reuse the PIN delay policy, with bounded public-email keys and one in-flight attempt per email. */
export function createPasswordThrottle(now: () => number = Date.now): PasswordThrottle {
  const throttle = createPinThrottle({ now });
  const entries = new Map<string, { lastAt: number; pending: boolean }>();
  return {
    begin(email) {
      const time = now();
      for (const [key, entry] of entries) {
        if (!entry.pending && time - entry.lastAt >= PIN_THROTTLE_IDLE_MS) {
          entries.delete(key);
          throttle.clear("dashboard", key);
        }
      }
      const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
      const entry = entries.get(key);
      if (entry?.pending) throw new AppError("password.throttled", { retryAfterSeconds: 1 });
      if (entry === undefined && entries.size >= 1000) {
        throw new AppError("password.throttled", { retryAfterSeconds: 60 });
      }
      try {
        throttle.check("dashboard", key);
      } catch (error) {
        if (isAppError(error) && error.code === "pin.throttled") {
          throw new AppError("password.throttled", (error as AppError<"pin.throttled">).params);
        }
        throw error;
      }
      entries.set(key, { lastAt: time, pending: true });
      return (outcome) => {
        if (outcome === "success") {
          entries.delete(key);
          throttle.clear("dashboard", key);
        } else {
          entries.set(key, { lastAt: now(), pending: false });
          if (outcome === "invalid") throttle.recordFailure("dashboard", key);
        }
      };
    },
  };
}
