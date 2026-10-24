export const CLOCK_WITNESS_MARGIN_MS = 60_000;

export interface ClockWitness {
  readonly kind: "authority" | "device";
  /** The device's id; "authority" for AEAT readings. */
  readonly id: string;
  /** The network address a device's reading came from; devices at one address are one witness. */
  readonly address?: string;
  /** The box's wall clock at the moment the comparison refers to, ISO 8601. */
  readonly boxAt: string;
  /** The witness's clock at that moment, ISO 8601. */
  readonly witnessAt: string;
  readonly uncertaintyMs: number;
}

export interface ClockWitnessVerdict {
  /** Each address whose latest device reading agrees with the box, and the authority's latest
   * agreeing reading. */
  readonly agreeing: readonly ClockWitness[];
  /** Authority witnesses that disagree, the latest first. */
  readonly authorityDisagrees: readonly ClockWitness[];
  /** The largest group (every pair agrees with each other) of two or more devices, one per
   * address, that all disagree with the box; among groups of one size, the one whose newest `boxAt`
   * is latest. */
  readonly devicesDisagreeing: readonly ClockWitness[];
}

interface Reading {
  readonly witness: ClockWitness;
  readonly boxAtMs: number;
  readonly differenceMs: number;
}

function readable(witness: ClockWitness): Reading | undefined {
  const boxAtMs = Date.parse(witness.boxAt);
  const differenceMs = Date.parse(witness.witnessAt) - boxAtMs;
  if (!Number.isFinite(differenceMs)) return undefined;
  if (!Number.isFinite(witness.uncertaintyMs) || witness.uncertaintyMs < 0) return undefined;
  return { witness, boxAtMs, differenceMs };
}

function agrees(reading: Reading): boolean {
  return Math.abs(reading.differenceMs) + reading.witness.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS;
}

function disagrees(reading: Reading): boolean {
  return Math.abs(reading.differenceMs) - reading.witness.uncertaintyMs > CLOCK_WITNESS_MARGIN_MS;
}

function latestPer(readings: readonly Reading[], key: (reading: Reading) => string): Reading[] {
  const latest = new Map<string, Reading>();
  for (const reading of readings) {
    const seen = latest.get(key(reading));
    if (seen === undefined || reading.boxAtMs > seen.boxAtMs) latest.set(key(reading), reading);
  }
  return [...latest.values()];
}

function latestPerId(readings: readonly Reading[]): Reading[] {
  return latestPer(readings, (reading) => reading.witness.id);
}

function latestPerAddress(readings: readonly Reading[]): Reading[] {
  return latestPer(readings, ({ witness }) =>
    witness.address === undefined ? `id ${witness.id}` : `address ${witness.address}`,
  );
}

function newestBoxAtMs(group: readonly Reading[]): number {
  return Math.max(...group.map((reading) => reading.boxAtMs));
}

/** Differences on one line agree pairwise exactly when the group's spread is within the margin, so
 * the largest groups are runs of the devices sorted by difference. */
function largestDeviceGroup(devices: readonly Reading[]): Reading[] {
  const sorted = [...devices].sort((a, b) => a.differenceMs - b.differenceMs);
  let best: Reading[] = [];
  for (const [start, first] of sorted.entries()) {
    let end = start;
    while (
      end + 1 < sorted.length &&
      sorted[end + 1]!.differenceMs - first.differenceMs <= CLOCK_WITNESS_MARGIN_MS
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

function witnessesOf(readings: readonly Reading[]): ClockWitness[] {
  return readings.map((reading) => reading.witness);
}

/** A witness whose times are unreadable, or whose uncertainty is negative or not finite, counts
 * neither way. */
export function judgeClockWitnesses(witnesses: readonly ClockWitness[]): ClockWitnessVerdict {
  const readings = witnesses.flatMap((witness) => readable(witness) ?? []);
  const devices = latestPerAddress(
    latestPerId(readings.filter((reading) => reading.witness.kind === "device")),
  );
  const authorities = readings.filter((reading) => reading.witness.kind === "authority");
  return {
    agreeing: witnessesOf([...devices.filter(agrees), ...latestPerId(authorities.filter(agrees))]),
    authorityDisagrees: witnessesOf(
      authorities.filter(disagrees).sort((a, b) => b.boxAtMs - a.boxAtMs),
    ),
    devicesDisagreeing: witnessesOf(largestDeviceGroup(devices.filter(disagrees))),
  };
}
