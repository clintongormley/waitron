import "./errors.js";
import { AppError } from "@waitron/shared";

export function createLiveOperationRateLimit(options: { now?: () => number } = {}) {
  const now = options.now ?? (() => performance.now());
  let windowStart = now();
  let count = 0;
  let inFlight = 0;
  return {
    async withAdmission<T>(run: () => Promise<T>): Promise<T> {
      const current = now();
      if (current - windowStart >= 60_000) {
        windowStart = current;
        count = 0;
      }
      if (count >= 60 || inFlight >= 2) throw new AppError("recovery.rate_limited", {});
      count += 1;
      inFlight += 1;
      try {
        return await run();
      } finally {
        inFlight -= 1;
      }
    },
  };
}
