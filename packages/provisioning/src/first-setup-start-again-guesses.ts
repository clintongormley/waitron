import { join } from "node:path";
import { AppError, isUuid } from "@waitron/shared";
import { inTurn } from "./attempt-turns.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { isCanonicalInstant } from "./first-setup-start-again-confirmation.js";
import { START_AGAIN_GUESSES_FILE } from "./first-setup-start-again-names.js";
import "./errors.js";

export { START_AGAIN_GUESSES_FILE };

export const START_AGAIN_FREE_GUESSES = 5;
export const START_AGAIN_FORGIVE_MS = 15 * 60_000;
export const START_AGAIN_MAX_WAIT_MS = 15 * 60_000;

const COUNTER_LIMIT = 4 * 1024;
const MINUTE = 60_000;
const turns = {};

interface Counter {
  version: 1;
  attemptId: string;
  failures: number;
  lastFailureAt: string | null;
  waitUntil: string | null;
}

/** The wait after the `failures`-th wrong guess. */
export function startAgainWaitMs(failures: number): number {
  if (failures <= START_AGAIN_FREE_GUESSES) return 0;
  return Math.min(START_AGAIN_MAX_WAIT_MS, 2 ** (failures - START_AGAIN_FREE_GUESSES - 1) * MINUTE);
}

const instantOrNull = (value: unknown) => value === null || isCanonicalInstant(value);

function parseCounter(value: unknown): Counter | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 5
  )
    return null;
  const { version, attemptId, failures, lastFailureAt, waitUntil } = value as Record<
    string,
    unknown
  >;
  if (
    version !== 1 ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    !Number.isSafeInteger(failures) ||
    (failures as number) < 0 ||
    !instantOrNull(lastFailureAt) ||
    !instantOrNull(waitUntil)
  )
    return null;
  return {
    version: 1,
    attemptId,
    failures: failures as number,
    lastFailureAt: lastFailureAt as string | null,
    waitUntil: waitUntil as string | null,
  };
}

/** What the counter means now: a time ahead of the clock is never trusted past the ceiling. */
async function readCounter(
  path: string,
  attemptId: string,
  now: number,
): Promise<{
  failures: number;
  lastFailureAt: number | null;
  waitUntil: number | null;
  /** A stored time was ahead of the clock and was read as an earlier one. */
  capped: boolean;
}> {
  let stored: Counter | null;
  try {
    const value = await readDurableHostJson(path, COUNTER_LIMIT);
    if (value === null) return { failures: 0, lastFailureAt: null, waitUntil: null, capped: false };
    stored = parseCounter(value);
  } catch {
    stored = null;
  }
  // Damaged: the free tries spent, no wait yet.
  if (stored === null)
    return {
      failures: START_AGAIN_FREE_GUESSES,
      lastFailureAt: now,
      waitUntil: null,
      capped: false,
    };
  if (stored.attemptId.toLowerCase() !== attemptId)
    return { failures: 0, lastFailureAt: null, waitUntil: null, capped: false };
  const lastFailureAt = stored.lastFailureAt === null ? null : Date.parse(stored.lastFailureAt);
  const waitUntil = stored.waitUntil === null ? null : Date.parse(stored.waitUntil);
  const ceiling = now + START_AGAIN_MAX_WAIT_MS;
  return {
    failures: stored.failures,
    lastFailureAt: lastFailureAt === null ? null : Math.min(lastFailureAt, now),
    waitUntil: waitUntil === null ? null : Math.min(waitUntil, ceiling),
    capped:
      (lastFailureAt !== null && lastFailureAt > now) ||
      (waitUntil !== null && waitUntil > ceiling),
  };
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Counts a password try before the password is checked: the wrong guess is on disk first, so a
 * process killed mid-check, or a counter that cannot be written, never gives a free guess. The
 * returned finish sets the count back to 0 on success; a wrong guess was already counted.
 */
export async function beginStartAgainGuess(
  stateDir: string,
  givenAttemptId: string,
  now: Date,
): Promise<(outcome: "success" | "invalid") => Promise<void>> {
  // Folded as the choice records fold it: the marker may spell the id in upper case.
  const attemptId = givenAttemptId.toLowerCase();
  const path = join(stateDir, START_AGAIN_GUESSES_FILE);
  const write = (failures: number, lastFailureAt: number | null, waitUntil: number | null) =>
    writeDurableHostJson(
      path,
      {
        version: 1,
        attemptId,
        failures,
        lastFailureAt: iso(lastFailureAt),
        waitUntil: iso(waitUntil),
      },
      COUNTER_LIMIT,
    );
  await inTurn(turns, stateDir, async () => {
    const at = now.getTime();
    const read = await readCounter(path, attemptId, at);
    if (read.waitUntil !== null && read.waitUntil > at) {
      // Store the capped times, so the next try's clock reads the wait this refusal named. The try
      // is refused either way, so a failed write still answers with the wait.
      if (read.capped)
        await write(read.failures, read.lastFailureAt, read.waitUntil).catch(() => undefined);
      throw new AppError("password.throttled", {
        retryAfterSeconds: Math.ceil((read.waitUntil - at) / 1000),
      });
    }
    const forgiven =
      read.lastFailureAt === null
        ? 0
        : Math.floor((at - read.lastFailureAt) / START_AGAIN_FORGIVE_MS);
    const failures = Math.max(0, read.failures - forgiven) + 1;
    const wait = startAgainWaitMs(failures);
    await write(failures, at, wait === 0 ? null : at + wait);
  });
  return async (outcome) => {
    if (outcome === "success") await inTurn(turns, stateDir, () => write(0, null, null));
  };
}
