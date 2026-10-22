import { vi } from "vitest";

/** A clock a test moves by hand. `set` and `advance` move the wall and the monotonic reading together. */
export interface HourTestClock {
  wall(): number;
  monotonic(): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function createHourTestClock(startMs: number): HourTestClock {
  let wall = startMs;
  let monotonic = 1_000_000;
  const advance = (ms: number) => {
    if (!(ms >= 0) || !Number.isFinite(ms))
      throw new RangeError("a test clock never runs backwards");
    wall += ms;
    monotonic += ms;
  };
  return {
    wall: () => wall,
    monotonic: () => monotonic,
    advance,
    set: (ms) => advance(ms - wall),
  };
}

/**
 * The same interface over Vitest's faked `Date` and `performance`, for a suite already on fake
 * timers: moving it moves both fakes, so every other reader of them agrees with the box.
 */
export function createFakeTimersHourClock(): HourTestClock {
  const advance = (ms: number) => {
    if (!(ms >= 0) || !Number.isFinite(ms))
      throw new RangeError("a test clock never runs backwards");
    vi.advanceTimersByTime(ms);
  };
  return {
    wall: () => Date.now(),
    monotonic: () => performance.now(),
    advance,
    set: (ms) => advance(ms - Date.now()),
  };
}

function waitingTarget(answer: unknown): number | undefined {
  const record = (value: unknown) =>
    typeof value === "object" && value !== null
      ? (value as { status?: unknown; targetMs?: unknown; preparation?: unknown })
      : undefined;
  for (const candidate of [record(answer), record(record(answer)?.preparation)])
    if (candidate?.status === "waiting" && typeof candidate.targetMs === "number")
      return candidate.targetMs;
  return undefined;
}

/**
 * Asks, and while the answer (or a route's `preparation`) is `waiting`, moves the clock past its
 * `targetMs` and asks again. `ask` takes a fresh clock reading each time: an old one is stale by
 * the time a wait ends.
 */
export async function selectPastWaits<T>(
  clock: HourTestClock | undefined,
  ask: () => Promise<T>,
  rounds = 3,
): Promise<T> {
  for (let round = 0; ; round++) {
    const answer = await ask();
    const targetMs = waitingTarget(answer);
    if (targetMs === undefined) return answer;
    if (clock === undefined)
      throw new Error(`the selection is waiting until ${targetMs} and no test clock was given`);
    if (round === rounds) throw new Error(`still waiting after ${rounds} clock moves`);
    clock.set(Math.max(clock.wall(), targetMs) + 1);
  }
}

/**
 * A recovery or promotion's clock check and select, through `service.prepare`, repeated past each
 * wait. `beforeAsk` runs before every round (a suite on fake timers moves them to the clock there).
 */
export function recoverySelectPastWaits(
  clock: HourTestClock,
  service: { prepare(proposal: unknown, client: { onBox: boolean }): Promise<unknown> },
  proposal: { answer: "no" | "yes" | "unknown"; installationCodes: readonly string[] },
  client: { onBox: boolean },
  beforeAsk: () => void = () => {},
): Promise<unknown> {
  return selectPastWaits(clock, async () => {
    beforeAsk();
    const challenge = (await service.prepare({ action: "clock-challenge" }, client)) as {
      id: string;
    };
    const compared = (await service.prepare(
      {
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: clock.wall() },
      },
      client,
    )) as { id: string };
    return service.prepare({ action: "select", ...proposal, comparisonId: compared.id }, client);
  });
}
