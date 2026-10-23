export const CLOCK_WITNESS_MARGIN_MS = 60_000;

export interface ClockWitness {
  readonly kind: "authority" | "device";
  /** The device's id; "authority" for AEAT readings. */
  readonly id: string;
  /** The box's wall clock at the moment the comparison refers to, ISO 8601. */
  readonly boxAt: string;
  /** The witness's clock at that moment, ISO 8601. */
  readonly witnessAt: string;
  readonly uncertaintyMs: number;
}

export interface ClockWitnessVerdict {
  /** Witnesses that agree with the box, the latest per id. */
  readonly agreeing: readonly ClockWitness[];
  /** Authority witnesses that disagree, the latest first. */
  readonly authorityDisagrees: readonly ClockWitness[];
  /** The largest group (every pair agrees with each other) of two or more devices that all
   * disagree with the box; among groups of one size, the one whose newest `boxAt` is latest. */
  readonly devicesDisagreeing: readonly ClockWitness[];
}

function boxAtMs(witness: ClockWitness): number {
  return Date.parse(witness.boxAt);
}

function differenceMs(witness: ClockWitness): number {
  return Date.parse(witness.witnessAt) - boxAtMs(witness);
}

function agrees(witness: ClockWitness): boolean {
  return Math.abs(differenceMs(witness)) + witness.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS;
}

function disagrees(witness: ClockWitness): boolean {
  return Math.abs(differenceMs(witness)) - witness.uncertaintyMs > CLOCK_WITNESS_MARGIN_MS;
}

function latestPerId(witnesses: readonly ClockWitness[]): ClockWitness[] {
  const latest = new Map<string, ClockWitness>();
  for (const witness of witnesses) {
    const seen = latest.get(witness.id);
    if (seen === undefined || boxAtMs(witness) > boxAtMs(seen)) latest.set(witness.id, witness);
  }
  return [...latest.values()];
}

function newestBoxAtMs(group: readonly ClockWitness[]): number {
  return Math.max(...group.map(boxAtMs));
}

/** Differences on one line agree pairwise exactly when the group's spread is within the margin, so
 * the largest groups are runs of the devices sorted by difference. */
function largestDeviceGroup(devices: readonly ClockWitness[]): ClockWitness[] {
  const sorted = [...devices].sort((a, b) => differenceMs(a) - differenceMs(b));
  let best: ClockWitness[] = [];
  for (const [start, first] of sorted.entries()) {
    let end = start;
    while (
      end + 1 < sorted.length &&
      differenceMs(sorted[end + 1]!) - differenceMs(first) <= CLOCK_WITNESS_MARGIN_MS
    ) {
      end++;
    }
    const group = sorted.slice(start, end + 1);
    if (
      group.length >= 2 &&
      (group.length > best.length ||
        (group.length === best.length && newestBoxAtMs(group) > newestBoxAtMs(best)))
    ) {
      best = group;
    }
  }
  return best;
}

export function judgeClockWitnesses(witnesses: readonly ClockWitness[]): ClockWitnessVerdict {
  const devices = latestPerId(witnesses.filter((witness) => witness.kind === "device"));
  const authorities = witnesses.filter((witness) => witness.kind === "authority");
  return {
    agreeing: [...devices.filter(agrees), ...latestPerId(authorities.filter(agrees))],
    authorityDisagrees: authorities.filter(disagrees).sort((a, b) => boxAtMs(b) - boxAtMs(a)),
    devicesDisagreeing: largestDeviceGroup(devices.filter(disagrees)),
  };
}
