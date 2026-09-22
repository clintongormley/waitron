import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { UNREACHABLE_RESULT_CODES } from "./boot-failure.js";
import type { LogLevel, Logger } from "./logger.js";
import { MIGRATION_CONSTRAINT_RESULT_CODES, withDevMigrationHint } from "./dev-migration-hint.js";

/** A driver error as drizzle hands it on: the result code is on `.cause`, never the top level. */
function failedMigration(errcode: number): Error {
  const driver = Object.assign(new Error("NOT NULL constraint failed: categories.name"), {
    errcode,
    code: "ERR_SQLITE_ERROR",
  });
  return Object.assign(new Error("Failed query"), { cause: driver });
}

/** A REAL refusal from the engine, for the one case that must not rest on a number I chose. */
function realRefusal(build: (db: DatabaseSync) => void): unknown {
  const dir = mkdtempSync(join(tmpdir(), "dev-hint-"));
  try {
    build(new DatabaseSync(join(dir, "venue.db")));
    throw new Error("the probe did not fail — this case is measuring nothing");
  } catch (error) {
    return error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Line = { level: LogLevel; event: string; fields?: Record<string, unknown> };

function recorder(): { lines: Line[]; log: Logger } {
  const lines: Line[] = [];
  return { lines, log: (level, event, fields) => void lines.push({ level, event, fields }) };
}

const rejects = (error: unknown) => () => Promise.reject(error);

const hint = (errcode: number): Line => ({
  level: "error",
  event: "migrations.dev_constraint_violation",
  fields: { errcode, remedyIfStaleDatabase: "wa-wt reset demo <worktree-name>" },
});

describe("MIGRATION_CONSTRAINT_RESULT_CODES", () => {
  // Pinned LITERALLY, not by iterating the export: a test that reads the implementation's own list
  // loses a case the moment someone deletes one, and reports nothing. Proven by mutation on the
  // list this replaces — dropping an entry from the module left the old iterating test passing.
  //
  // Every number here was taken from a real refusal, 2026-09-22 on Node v26.7.0: a CHECK (275), a
  // foreign key (787), a NOT NULL (1299), a primary key (1555) and a unique index (2067).
  it("is exactly the constraint result codes, and nothing wider", () => {
    expect([...MIGRATION_CONSTRAINT_RESULT_CODES].sort((a, b) => a - b)).toEqual([
      275, 787, 1299, 1555, 2067,
    ]);
  });

  // The module claims it shares no code with `classifyBootFailure`'s list, and nothing else would
  // fail if a later edit put one in both. It matters because the two give OPPOSITE advice: this file
  // offers a wipe, and a boot classification sends the operator to restore.
  it("never names a code `boot-failure.ts` classifies", () => {
    const theirs = new Set(UNREACHABLE_RESULT_CODES);
    expect(MIGRATION_CONSTRAINT_RESULT_CODES.filter((code) => theirs.has(code))).toEqual([]);
  });
});

describe("withDevMigrationHint", () => {
  // A REAL refusal, so the hint is proven against what a migration on this engine actually throws
  // rather than against a number chosen to match the implementation.
  it("names the remedy for a real refusal from the engine", async () => {
    const refusal = realRefusal((db) => {
      db.exec("create table categories (id integer primary key, name text not null)");
      db.exec("insert into categories (id) values (1)");
    });
    const { lines, log } = recorder();
    await expect(withDevMigrationHint(log, true, rejects(refusal))).rejects.toThrow();
    expect(lines).toEqual([hint(1299)]);
  });

  it("names the remedy for every pinned code", async () => {
    for (const errcode of MIGRATION_CONSTRAINT_RESULT_CODES) {
      const { lines, log } = recorder();
      await expect(
        withDevMigrationHint(log, true, rejects(failedMigration(errcode))),
      ).rejects.toThrow();
      expect(lines).toEqual([hint(errcode)]);
    }
  });

  // The walk starts at the OUTERMOST error, so a driver error that was never wrapped is a live
  // shape here too — the sibling (`boot-failure.test.ts`) asserts both for exactly that reason.
  it("names the remedy when the code is on the error itself, not under `cause`", async () => {
    const { lines, log } = recorder();
    const bare = Object.assign(new Error("NOT NULL constraint failed: categories.name"), {
      errcode: 1299,
    });

    await expect(withDevMigrationHint(log, true, rejects(bare))).rejects.toBe(bare);

    expect(lines).toEqual([hint(1299)]);
  });

  it("re-throws the original failure, identity intact", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration(1299);

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([hint(1299)]);
  });

  it("still re-throws the original failure when the log sink itself throws", async () => {
    // No sink this process builds today is known to throw: `createRotatingFileSink` catches its own
    // IO failures and degrades to a no-op, and `boot.ts`'s stdout sink discards its write's return
    // value and passes no callback. But `tee` does not catch, so ANY sink that ever throws
    // propagates from here — and
    // reporting a logging failure in place of the migration failure would send the reader after
    // entirely the wrong problem. Cheap insurance on the one error that must survive.
    const failure = failedMigration(1299);
    const throwing: Logger = () => {
      throw new Error("EPIPE: broken pipe");
    };

    await expect(withDevMigrationHint(throwing, true, rejects(failure))).rejects.toBe(failure);
  });

  it("says nothing about a stale database when the migration itself is broken", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration(1); // SQL logic error — wiping the database fixes nothing

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  // The direct control for "a pinned list, never a low-byte match": every constraint code on this
  // engine is `SQLITE_CONSTRAINT` (19) plus a reason in the high byte, so a test of the low byte
  // alone would fire on 19 itself and on a trigger's own `raise(abort)` (1811), which is a
  // deliberate refusal rather than rows failing a new constraint.
  it("says nothing for a constraint code that is not on the list", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration(1811);

    await expect(withDevMigrationHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it("says nothing outside dev mode, where `wa-wt reset` is not the remedy", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration(1299);

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
