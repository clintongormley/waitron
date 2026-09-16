import type { DutyOutcome, PeriodDuty, RunPeriod } from "../duty.js";

export interface FakeDutyCall {
  period: RunPeriod;
  now: Date;
}

/**
 * A programmable `PeriodDuty`. `behaviour` is consulted per call, so one instance can succeed, then
 * fail, then succeed again — which is what the retry and park paths need.
 */
export class FakeDuty implements PeriodDuty {
  readonly cadence = "daily" as const;
  readonly calls: FakeDutyCall[] = [];

  constructor(
    readonly name = "test.duty",
    private readonly behaviour: (call: FakeDutyCall, index: number) => Promise<DutyOutcome> = () =>
      Promise.resolve({ summary: { ok: true } }),
  ) {}

  async run(period: RunPeriod, now: Date): Promise<DutyOutcome> {
    const call = { period, now };
    this.calls.push(call);
    return this.behaviour(call, this.calls.length - 1);
  }
}

/** A duty that always throws the given error — the failure/park path's subject. */
export function throwingDuty(name: string, error: unknown): PeriodDuty {
  return {
    name,
    cadence: "daily",
    run: () => Promise.reject(error),
  };
}
