import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

export function afterFailure(state: RecoveryState, errorCode: string, at: Date): RecoveryState {
  const failures = state.failures + 1;
  return {
    failures,
    level: levelFor(failures),
    lastErrorCode: errorCode,
    lastFailureAt: at.toISOString(),
  };
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
    return {
      failures,
      level: levelFor(failures),
      lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
      lastFailureAt: typeof raw.lastFailureAt === "string" ? raw.lastFailureAt : null,
    };
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
