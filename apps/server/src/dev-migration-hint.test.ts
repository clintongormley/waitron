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

/** A REAL refusal from the engine, so one case does not rest on a chosen number. */
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
  // Pinned literally: a test iterating the export would not notice an entry deleted from it.
  it("is exactly the constraint result codes, and nothing wider", () => {
    expect([...MIGRATION_CONSTRAINT_RESULT_CODES].sort((a, b) => a - b)).toEqual([
      275, 787, 1299, 1555, 2067,
    ]);
  });

  it("never names a code `boot-failure.ts` classifies", () => {
    const theirs = new Set(UNREACHABLE_RESULT_CODES);
    expect(MIGRATION_CONSTRAINT_RESULT_CODES.filter((code) => theirs.has(code))).toEqual([]);
  });
});

describe("withDevMigrationHint", () => {
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

  // The walk starts at the OUTERMOST error, so an unwrapped driver error is a live shape too.
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
    // `tee` does not catch, so any sink that throws would otherwise replace the migration failure.
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

  // A low-byte match would fire on a trigger's `raise(abort)` (1811), a deliberate refusal.
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
