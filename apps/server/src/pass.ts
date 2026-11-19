/** This host's own label for the fiscal drainer. */
export const DRAIN_DUTY = "fiscal.drain";
/** Aggregate payment-audit health label; scheduled runs keep their provider-specific duty names. */
export const RECONCILE_DUTY = "payments.reconcile";

/** Consumers that must cover every duty (`health.ts`'s `DUTY_BUDGET_MS`) key off `Duty`, so adding a
 * duty here without updating them is a compile error. */
export const ALL_DUTIES = [DRAIN_DUTY, RECONCILE_DUTY] as const;
export type Duty = (typeof ALL_DUTIES)[number];

export interface DutyReport {
  duty: string;
  ok: boolean;
  errorCode?: string;
  nextDueAt: Date | null;
  /**
   * How much due work this duty abandoned this pass (its result's `skipped.length`); undefined when
   * the duty threw. A skip is a failure of the duty, yet `ok` is false only on a throw, so `/health`
   * reads this count (`recordPass`, health.ts) to see it.
   */
  skipped?: number;
  /** How long this duty took, by the monotonic clock; present when the duty threw too. */
  durationMs: number;
  /**
   * How many runs this pass ended `outcome: "parked"`: they exhausted `maxAttempts`, and only the
   * duty's `retryParkedAfterMs` brings that (duty, period) back. A `runDue` that parked every run
   * still returns normally, so `recordPass` reads this as it reads `skipped`. `failed` is excluded
   * because a failed run retries on its own backoff. Always `0` for `fiscal.drain`; undefined when
   * the duty threw.
   */
  parked?: number;
}

export interface PassReport {
  duties: DutyReport[];
  /** The next time the loop has work, or null when nothing is due. */
  nextDueAt: Date | null;
}

/**
 * True while the last drain pass that had work skipped it for a missing `fiscal.aeat` credential.
 * The filing job writes it; box-status reads it. Shared by reference so a flip is seen with no restart.
 */
export interface AwaitingCertStatus {
  current: boolean;
}
