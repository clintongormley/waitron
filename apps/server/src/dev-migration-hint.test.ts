import { describe, expect, it } from "vitest";
import { SCHEMA_MISMATCH_SQL_STATES, UNREACHABLE_SQL_STATES } from "./boot-failure.js";
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
  it("never names a state `boot-failure.ts` classifies", () => {
    const theirs = new Set([...UNREACHABLE_SQL_STATES, ...SCHEMA_MISMATCH_SQL_STATES]);
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

  it("re-throws the original failure, identity intact", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23502");

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([hint("23502")]);
  });

  it("still re-throws the original failure when the log sink itself throws", async () => {
    // The boot logger tees to a rotating FILE as well as stdout, and that sink can fail on a state
    // directory that has become unwritable (`boot.ts` builds a stdout-only logger for exactly that
    // notice). Losing the migration failure and reporting the sink's failure in its place would
    // send the reader after the wrong problem entirely.
    const failure = failedMigration("23502");
    const throwing: Logger = () => {
      throw new Error("state directory is unwritable");
    };

    await expect(withDevMigrationHint(throwing, true, rejects(failure))).rejects.toBe(failure);
  });

  it("says nothing about a stale database when the migration itself is broken", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("42601"); // syntax_error — wiping the database fixes nothing

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
