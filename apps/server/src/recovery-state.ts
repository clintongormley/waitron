import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VENUE_HOLDER_KINDS, type VenueHolderKind } from "@waitron/db";
import { writeFileAtomic } from "./fs-atomic.js";

/** Where a box sits on the escalation, and therefore whether it can still SELL. Only two levels:
 *  a degraded-but-trading mode cannot be built on the tiers that exist (spec §9.1) and belongs to
 *  the recovery spec. */
export type RecoveryLevel = "normal" | "recovery";

export interface RecoveryState {
  failures: number;
  level: RecoveryLevel;
  lastErrorCode: string | null;
  lastFailureAt: string | null;
  /** Which kind of program held the venue folder when a start was refused by a holder that had
   *  stopped writing its heartbeat. Absent when unknown, and for every other failure. */
  holderKind?: VenueHolderKind;
}

export const FRESH: RecoveryState = {
  failures: 0,
  level: "normal",
  lastErrorCode: null,
  lastFailureAt: null,
};

const RECOVERY_AT = 3;

export function levelFor(failures: number): RecoveryLevel {
  return failures >= RECOVERY_AT ? "recovery" : "normal";
}

/**
 * The one builder of a failure record. The holder's kind is carried only when given: it names the
 * program holding the folder, and a later failure of any other kind must not show that name.
 */
function failureRecord(
  failures: number,
  errorCode: string,
  at: Date,
  holderKind?: VenueHolderKind,
): RecoveryState {
  const record: RecoveryState = {
    failures,
    level: levelFor(failures),
    lastErrorCode: errorCode,
    lastFailureAt: at.toISOString(),
  };
  if (holderKind !== undefined) record.holderKind = holderKind;
  return record;
}

export function afterFailure(state: RecoveryState, errorCode: string, at: Date): RecoveryState {
  return failureRecord(state.failures + 1, errorCode, at);
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
    const state: RecoveryState = {
      failures,
      level: levelFor(failures),
      lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
      lastFailureAt: typeof raw.lastFailureAt === "string" ? raw.lastFailureAt : null,
    };
    // The page turns the kind into wording through a closed table, so only a member of the set
    // is kept.
    const kind = VENUE_HOLDER_KINDS.find((known) => known === raw.holderKind);
    if (kind !== undefined) state.holderKind = kind;
    return state;
  } catch {
    return FRESH;
  }
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
  return failureRecord(current.failures, errorCode, at, holderKind);
}

function sameState(a: RecoveryState, b: RecoveryState): boolean {
  return (
    a.failures === b.failures &&
    a.lastErrorCode === b.lastErrorCode &&
    a.lastFailureAt === b.lastFailureAt &&
    a.holderKind === b.holderKind
  );
}

/**
 * Takes back the one failure an attempt counted before it started (`wrote`, made from `before`).
 * If the file still holds exactly `wrote`, nothing else changed it since and `before` goes back
 * whole. Otherwise another process changed it — a clear by the running server, a failure another
 * start recorded — and only the one failure comes off.
 *
 * Taking one off can take off another start's: A counts, the server clears, C counts, A undoes
 * (removing C's), and C's failure is then recorded with a count of 0 where 1 is right.
 */
export function withoutAttempt(
  current: RecoveryState,
  before: RecoveryState,
  wrote: RecoveryState,
): RecoveryState {
  if (sameState(current, wrote)) return before;
  const failures = Math.max(0, current.failures - 1);
  return { ...current, failures, level: levelFor(failures) };
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
