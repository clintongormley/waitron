import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VENUE_HOLDER_KINDS, type VenueHolderKind } from "@waitron/db";
import { writeFileAtomic } from "./fs-atomic.js";

/** Where a box sits on the escalation, and therefore whether it can still SELL. */
export type RecoveryLevel = "normal" | "recovery";

export interface RecoveryState {
  failures: number;
  level: RecoveryLevel;
  lastErrorCode: string | null;
  lastFailureAt: string | null;
  /** How many times the count has been cleared. An attempt that takes its own failure back uses it
   *  to tell whether a clear has already removed that failure (`withoutAttempt`). */
  clears: number;
  /** Which kind of program held the venue folder when a start was refused by a holder that had
   *  stopped writing its heartbeat. Absent when unknown, and for every other failure. */
  holderKind?: VenueHolderKind;
  /** Present, and true, only when the running server stopped itself; it holds the box at
   *  `recovery` whatever the count, until a clear. */
  refused?: true;
  /** The trigger names whose fault made the running server stop; kept only beside `refused`. */
  refusedTriggers?: RefusedTriggers;
}

export interface RefusedTriggers {
  missing: string[];
  altered: string[];
}

export const FRESH: RecoveryState = {
  failures: 0,
  level: "normal",
  lastErrorCode: null,
  lastFailureAt: null,
  clears: 0,
};

const RECOVERY_AT = 3;

export function levelFor(failures: number, refused = false): RecoveryLevel {
  return refused || failures >= RECOVERY_AT ? "recovery" : "normal";
}

/**
 * The one builder of a failure record. The holder's kind is carried only when given: it names the
 * program holding the folder, and a later failure of any other kind must not show that name.
 */
function failureRecord(
  state: RecoveryState,
  failures: number,
  errorCode: string,
  at: Date,
  holderKind?: VenueHolderKind,
): RecoveryState {
  const refused = state.refused === true;
  const record: RecoveryState = {
    failures,
    level: levelFor(failures, refused),
    lastErrorCode: errorCode,
    lastFailureAt: at.toISOString(),
    clears: state.clears,
  };
  if (holderKind !== undefined) record.holderKind = holderKind;
  if (refused) {
    record.refused = true;
    if (state.refusedTriggers !== undefined) record.refusedTriggers = state.refusedTriggers;
  }
  return record;
}

export function afterFailure(state: RecoveryState, errorCode: string, at: Date): RecoveryState {
  return failureRecord(state, state.failures + 1, errorCode, at);
}

/**
 * Read `<stateDir>/recovery.json`. An absent OR unreadable file is FRESH, never a throw: this is
 * the file consulted on the path that exists to recover a broken box, so a corrupt copy of it must
 * not itself be what prevents booting.
 */
export async function readRecoveryState(stateDir: string): Promise<RecoveryState> {
  let text: string;
  try {
    text = await readFile(join(stateDir, "recovery.json"), "utf8");
  } catch {
    return FRESH;
  }
  try {
    const raw = JSON.parse(text) as Partial<RecoveryState>;
    const failures = typeof raw.failures === "number" && raw.failures >= 0 ? raw.failures : 0;
    const refused = raw.refused === true;
    const state: RecoveryState = {
      failures,
      level: levelFor(failures, refused),
      lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
      lastFailureAt: typeof raw.lastFailureAt === "string" ? raw.lastFailureAt : null,
      clears: Number.isSafeInteger(raw.clears) && (raw.clears as number) >= 0 ? raw.clears! : 0,
    };
    // The page turns the kind into wording through a closed table, so only a member of the set
    // is kept.
    const kind = VENUE_HOLDER_KINDS.find((known) => known === raw.holderKind);
    if (kind !== undefined) state.holderKind = kind;
    if (refused) {
      state.refused = true;
      const triggers = triggersIn(raw.refusedTriggers);
      if (triggers !== undefined) state.refusedTriggers = triggers;
    }
    return state;
  } catch {
    return FRESH;
  }
}

function namesIn(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((name) => typeof name === "string")
    ? [...(value as string[])]
    : undefined;
}

/** The names reach the page, so only the two lists of strings are kept, and nothing else. */
function triggersIn(value: unknown): RefusedTriggers | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { missing, altered } = value as Record<string, unknown>;
  const missingNames = namesIn(missing);
  const alteredNames = namesIn(altered);
  if (missingNames === undefined || alteredNames === undefined) return undefined;
  return { missing: missingNames, altered: alteredNames };
}

/** 0600: it sits beside the vault key in the state volume. */
export async function writeRecoveryState(stateDir: string, state: RecoveryState): Promise<void> {
  await writeFileAtomic(
    join(stateDir, "recovery.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    0o600,
  );
}

/** The same count, now carrying `errorCode` — a failed attempt whose count was written before it
 *  started. */
export function withFailureCode(
  current: RecoveryState,
  errorCode: string,
  at: Date,
  holderKind?: VenueHolderKind,
): RecoveryState {
  return failureRecord(current, current.failures, errorCode, at, holderKind);
}

/** What a start serves, never writes, when it cannot record itself because the disk is full. */
export function fullDiskAtStart(current: RecoveryState, at: Date): RecoveryState {
  return { ...withFailureCode(current, "storage.disk_full", at), level: "recovery" };
}

/** The count back to nothing, one clear on from `current`. */
export function cleared(current: RecoveryState): RecoveryState {
  return { ...FRESH, clears: current.clears + 1 };
}

/** The running server stopped itself: the next start serves the page, whatever the count. */
export function refusedWhileRunning(
  current: RecoveryState,
  errorCode: string,
  at: Date,
  triggers: RefusedTriggers,
): RecoveryState {
  return withFailureCode({ ...current, refused: true, refusedTriggers: triggers }, errorCode, at);
}

/** A server that stayed up clears the count, but not a refusal it made itself in that time. */
export function stayedUpClear(current: RecoveryState): RecoveryState {
  return current.refused === true ? current : cleared(current);
}

function sameState(a: RecoveryState, b: RecoveryState): boolean {
  return (
    a.failures === b.failures &&
    a.clears === b.clears &&
    a.lastErrorCode === b.lastErrorCode &&
    a.lastFailureAt === b.lastFailureAt &&
    a.holderKind === b.holderKind &&
    a.refused === b.refused &&
    sameNames(a.refusedTriggers?.missing, b.refusedTriggers?.missing) &&
    sameNames(a.refusedTriggers?.altered, b.refusedTriggers?.altered)
  );
}

function sameNames(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * Takes back the one failure an attempt counted before it started (`wrote`, made from `before`).
 * If the file still holds exactly `wrote`, nothing else changed it since and `before` goes back
 * whole. If the count has been cleared since, the clear already took this attempt's failure away
 * and nothing changes. Otherwise other starts have counted since, and only the one failure comes
 * off.
 */
export function withoutAttempt(
  current: RecoveryState,
  before: RecoveryState,
  wrote: RecoveryState,
): RecoveryState {
  if (sameState(current, wrote)) return before;
  if (current.clears !== wrote.clears) return current;
  const failures = Math.max(0, current.failures - 1);
  return { ...current, failures, level: levelFor(failures, current.refused === true) };
}

export interface RecoveryStore {
  lock: <T>(stateDir: string, body: () => Promise<T>) => Promise<T>;
  read: (stateDir: string) => Promise<RecoveryState>;
  write: (stateDir: string, state: RecoveryState) => Promise<void>;
}

/**
 * Reads `recovery.json`, applies `change` and writes the result, all under `store.lock`. A lock
 * rather than a check before the write: a check and the write that follows it are two steps, and
 * another process can write between them.
 */
export async function updateRecoveryState(
  store: RecoveryStore,
  stateDir: string,
  change: (current: RecoveryState) => RecoveryState,
): Promise<{ before: RecoveryState; after: RecoveryState }> {
  return await store.lock(stateDir, async () => {
    const before = await store.read(stateDir);
    const after = change(before);
    await store.write(stateDir, after);
    return { before, after };
  });
}
