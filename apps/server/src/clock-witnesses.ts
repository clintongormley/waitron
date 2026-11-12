import type { ClockWitness } from "@waitron/fiscal";

const FRESH_FOR_MS = 300_000;
const STEP_TOLERANCE_MS = 1_000;
const LATEST_DATE_MS = 8.64e15;

/** The box's wall clock (`Date.now()`) and steady clock (`performance.now()`) read together. */
export interface BoxClockReading {
  readonly wallMs: number;
  readonly monoMs: number;
}

export interface ClockWitnessStore {
  /** `address`: the network address the reading came from; an empty one counts as none, so it
   * does not merge unrelated devices into one witness. `arrived`: the box's clocks when the
   * request arrived. */
  noteDevice(
    deviceId: string,
    address: string | undefined,
    deviceMs: number,
    arrived: BoxClockReading,
  ): void;
  /** Every fresh reading (at most five minutes old by the steady clock, with no step of the wall
   * clock since), agreeing or not. */
  witnesses(): ClockWitness[];
  /** The clock was set: forget every reading `witnesses()` would hand out. */
  clear(): void;
}

interface Kept {
  readonly witness: ClockWitness;
  readonly at: BoxClockReading;
}

function writable(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= LATEST_DATE_MS;
}

export function createClockWitnessStore(
  deps: { wall?: () => number; monotonic?: () => number } = {},
): ClockWitnessStore {
  const wall = deps.wall ?? (() => Date.now());
  const monotonic = deps.monotonic ?? (() => performance.now());
  const devices = new Map<string, Kept>();

  function fresh(kept: Kept, now: BoxClockReading): boolean {
    const steadyElapsed = now.monoMs - kept.at.monoMs;
    const wallElapsed = now.wallMs - kept.at.wallMs;
    return (
      steadyElapsed <= FRESH_FOR_MS && Math.abs(wallElapsed - steadyElapsed) <= STEP_TOLERANCE_MS
    );
  }

  return {
    noteDevice(deviceId, address, deviceMs, arrived) {
      if (!Number.isSafeInteger(deviceMs) || !writable(deviceMs) || !writable(arrived.wallMs))
        return;
      const seen = devices.get(deviceId);
      if (seen !== undefined && seen.at.monoMs > arrived.monoMs) return;
      devices.set(deviceId, {
        witness: {
          kind: "device",
          id: deviceId,
          ...(address === undefined || address === "" ? {} : { address }),
          boxAt: new Date(arrived.wallMs).toISOString(),
          witnessAt: new Date(deviceMs).toISOString(),
          uncertaintyMs: 0,
        },
        at: arrived,
      });
    },
    witnesses() {
      const now = { wallMs: wall(), monoMs: monotonic() };
      for (const [id, kept] of devices) if (!fresh(kept, now)) devices.delete(id);
      return [...devices.values()].map((kept) => kept.witness);
    },
    clear() {
      devices.clear();
    },
  };
}
