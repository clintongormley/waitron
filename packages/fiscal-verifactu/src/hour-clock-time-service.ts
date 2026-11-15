import type { HourClockObservation } from "./hour-clock.js";

// The server's `DEFAULT_STATUS_MS` (apps/server/src/box-host-client.ts), which this package cannot import.
const STATUS_MS = 2_000;

interface TimeServiceClockDependencies {
  wall?: () => number;
  monotonic?: () => number;
}

/** A synchronised time service vouches for the box's own clock, so it reads as the box's time. */
export async function observeTimeServiceHourClock(
  read: () => Promise<boolean>,
  deps: TimeServiceClockDependencies = {},
): Promise<HourClockObservation> {
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  const wallStartedMs = wall();
  const monotonicStartedMs = monotonic();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let synchronised: boolean;
  try {
    synchronised =
      (await Promise.race([
        read(),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), STATUS_MS);
        }),
      ])) === true;
  } catch {
    synchronised = false;
  } finally {
    clearTimeout(timer);
  }
  const wallFinishedMs = wall();
  const monotonicFinishedMs = monotonic();
  if (!synchronised)
    return {
      source: "internet",
      result: "unavailable",
      reason: "not_synchronised",
      wallStartedMs,
      wallFinishedMs,
      monotonicStartedMs,
      monotonicFinishedMs,
      uncertaintyMs: null,
    };
  return {
    source: "internet",
    result: "usable",
    instantMs: (wallStartedMs + wallFinishedMs) / 2,
    uncertaintyMs: 0,
    wallStartedMs,
    wallFinishedMs,
    monotonicStartedMs,
    monotonicFinishedMs,
  };
}
