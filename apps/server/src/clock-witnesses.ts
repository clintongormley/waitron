import { judgeClockWitnesses, type AuthorityTimeSample, type ClockWitness } from "@waitron/fiscal";

export type { AuthorityTimeSample };

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
  noteAuthority(sample: AuthorityTimeSample): void;
  /** Every fresh reading (at most five minutes old by the steady clock, with no step of the wall
   * clock since), agreeing or not, and every AEAT disagreement noted since the last `endStop()`,
   * whatever its age and through steps. */
  witnesses(): ClockWitness[];
  /** AEAT witnesses noted since the last call. */
  takeNewAuthority(): ClockWitness[];
  /** The stop has ended: forget the kept AEAT disagreements. */
  endStop(): void;
  /** The clock was confirmed: forget every reading `witnesses()` would hand out. AEAT readings
   * not yet taken by `takeNewAuthority` stay, so a disproof among them is still recorded. */
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
  let authorities: Kept[] = [];
  let disagreements: ClockWitness[] = [];
  let untaken: ClockWitness[] = [];

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
    noteAuthority({ authorityMs, uncertaintyMs, at }) {
      if (!writable(authorityMs) || !writable(at.wallMs)) return;
      if (!Number.isFinite(uncertaintyMs) || uncertaintyMs < 0) return;
      const witness: ClockWitness = {
        kind: "authority",
        id: "authority",
        boxAt: new Date(at.wallMs).toISOString(),
        witnessAt: new Date(authorityMs).toISOString(),
        uncertaintyMs,
      };
      untaken.push(witness);
      if (judgeClockWitnesses([witness]).authorityDisagrees.length > 0) disagreements.push(witness);
      else authorities.push({ witness, at });
    },
    witnesses() {
      const now = { wallMs: wall(), monoMs: monotonic() };
      for (const [id, kept] of devices) if (!fresh(kept, now)) devices.delete(id);
      authorities = authorities.filter((kept) => fresh(kept, now));
      return [
        ...[...devices.values()].map((kept) => kept.witness),
        ...authorities.map((kept) => kept.witness),
        ...disagreements,
      ];
    },
    takeNewAuthority() {
      const taken = untaken;
      untaken = [];
      return taken;
    },
    endStop() {
      disagreements = [];
    },
    clear() {
      devices.clear();
      authorities = [];
      disagreements = [];
    },
  };
}
