import { describe, expect, it } from "vitest";
import {
  SCHEMA_MISMATCH_SQL_STATES,
  UNREACHABLE_SOCKET_CODES,
  UNREACHABLE_SQL_STATES,
} from "./boot-failure.js";
import type { LogLevel, Logger } from "./logger.js";
import { MIGRATION_CONSTRAINT_SQL_STATES, withDevMigrationHint } from "./dev-migration-hint.js";

/** A pg driver error as drizzle hands it on: the SQLSTATE is on `.cause`, never the top level. */
function failedMigration(code: string): Error {
  const driver = Object.assign(
    new Error('column "name" of relation "categories" contains null values'),
    { code, table: "categories", column: "name" },
  );
  return Object.assign(new Error("Failed query"), { cause: driver });
}

type Line = { level: LogLevel; event: string; fields?: Record<string, unknown> };

function recorder(): { lines: Line[]; log: Logger } {
  const lines: Line[] = [];
  return { lines, log: (level, event, fields) => void lines.push({ level, event, fields }) };
}

const rejects = (error: unknown) => () => Promise.reject(error);

const hint = (sqlState: string): Line => ({
  level: "error",
  event: "migrations.dev_constraint_violation",
  fields: { sqlState, remedyIfStaleDatabase: "wa-wt reset demo <worktree-name>" },
});

describe("MIGRATION_CONSTRAINT_SQL_STATES", () => {
  // Pinned LITERALLY, not by iterating the export: a test that reads the implementation's own list
  // loses a case the moment someone deletes one, and reports nothing. Proven by mutation — dropping
  // `23503` from the module left the old iterating test at 5 passed.
  it("is exactly the integrity-violation states, and nothing wider", () => {
    expect([...MIGRATION_CONSTRAINT_SQL_STATES].sort()).toEqual([
      "23502",
      "23503",
      "23505",
      "23514",
      "23P01",
    ]);
  });

  // The module comment claims it shares no table with `classifyBootFailure`. That claim is the kind
  // this repo asks to be pinned rather than asserted: nothing else would fail if a later edit put a
  // state in both, and the two tables carry OPPOSITE remedies — wipe this database, versus restore
  // it from a backup.
  it("never names a code `boot-failure.ts` classifies, in any of its three tables", () => {
    const theirs = new Set([
      ...UNREACHABLE_SOCKET_CODES,
      ...UNREACHABLE_SQL_STATES,
      ...SCHEMA_MISMATCH_SQL_STATES,
    ]);
    expect(MIGRATION_CONSTRAINT_SQL_STATES.filter((state) => theirs.has(state))).toEqual([]);
  });
});

describe("withDevMigrationHint", () => {
  it("names the remedy for every pinned state", async () => {
    for (const sqlState of MIGRATION_CONSTRAINT_SQL_STATES) {
      const { lines, log } = recorder();
      await expect(
        withDevMigrationHint(log, true, rejects(failedMigration(sqlState))),
      ).rejects.toThrow();
      expect(lines).toEqual([hint(sqlState)]);
    }
  });

  // `sqlStateOf` starts at the OUTERMOST error, so a driver error that was never wrapped is a live
  // shape here too — the sibling (`boot-failure.test.ts`) asserts both for exactly that reason.
  it("names the remedy when the code is on the error itself, not under `cause`", async () => {
    const { lines, log } = recorder();
    const bare = Object.assign(new Error("pg"), { code: "23502" });

    await expect(withDevMigrationHint(log, true, rejects(bare))).rejects.toBe(bare);

    expect(lines).toEqual([hint("23502")]);
  });

  it("re-throws the original failure, identity intact", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23502");

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([hint("23502")]);
  });

  it("still re-throws the original failure when the log sink itself throws", async () => {
    // NOT the rotating file sink: `createRotatingFileSink` catches its own IO failures and degrades
    // to a no-op (`log-file.ts`), so it never throws at a caller. `tee` does not catch, so what can
    // propagate is the stdout write itself — a closed or full pipe. Losing the migration failure and
    // reporting the sink's failure in its place would send the reader after the wrong problem.
    const failure = failedMigration("23502");
    const throwing: Logger = () => {
      throw new Error("EPIPE: broken pipe");
    };

    await expect(withDevMigrationHint(throwing, true, rejects(failure))).rejects.toBe(failure);
  });

  it("says nothing about a stale database when the migration itself is broken", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("42601"); // syntax_error — wiping the database fixes nothing

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  // The direct control for "a pinned list, never a class-`23` prefix match": `23000` is an
  // integrity violation by class and is NOT a member, so a prefix test would fire on it.
  it("says nothing for a class-23 state that is not on the list", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23000");

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it("says nothing outside dev mode, where `wa-wt reset` is not the remedy", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23502");

    await expect(withDevMigrationHint(log, false, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it("carries a thrown non-Error through without reading a code off it", async () => {
    const { lines, log } = recorder();

    await expect(withDevMigrationHint(log, true, rejects("boom"))).rejects.toBe("boom");

    expect(lines).toEqual([]);
  });

  it("logs nothing when the migrations apply", async () => {
    const { lines, log } = recorder();
    let calls = 0;

    await withDevMigrationHint(log, true, () => {
      calls += 1;
      return Promise.resolve();
    });

    expect(calls).toBe(1);
    expect(lines).toEqual([]);
  });
});
