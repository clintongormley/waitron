export const AGREEMENT_MS = 30_000;

export interface ClockMoment {
  readonly wall: number;
  readonly monotonic: number;
}

// Steady-clock fields must come from this process's steady clock (performance.now(), or the
// host's testClock.monotonic); readings on another clock are judged stale.
export type DeviceClockReading =
  | {
      readonly result: "usable";
      readonly instantMs: number;
      readonly uncertaintyMs: number;
      readonly wallStartedMs: number;
      readonly wallFinishedMs: number;
      readonly monotonicStartedMs: number;
      readonly monotonicFinishedMs: number;
    }
  | { readonly result: "unavailable"; readonly reason: "same_machine" | "challenge" };

export interface KeptClockConfirmation {
  readonly reading: DeviceClockReading;
  /** The box's boot reading when it was kept. */
  readonly boot: {
    readonly bootId: string | null;
    readonly uptimeMs: number;
    readonly wallMs: number;
  };
}

export function measureDeviceReading(
  issued: ClockMoment | undefined,
  instantMs: number,
  received: ClockMoment,
  onBox: boolean,
): DeviceClockReading {
  if (onBox) return { result: "unavailable", reason: "same_machine" };
  const elapsed = issued === undefined ? NaN : received.monotonic - issued.monotonic;
  if (
    issued === undefined ||
    !Number.isSafeInteger(instantMs) ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > 5000 ||
    Math.abs(received.wall - issued.wall - elapsed) > 1000
  )
    return { result: "unavailable", reason: "challenge" };
  return {
    result: "usable",
    instantMs,
    uncertaintyMs: elapsed / 2,
    wallStartedMs: issued.wall,
    wallFinishedMs: received.wall,
    monotonicStartedMs: issued.monotonic,
    monotonicFinishedMs: received.monotonic,
  };
}
