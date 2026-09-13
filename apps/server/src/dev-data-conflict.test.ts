import { describe, expect, it } from "vitest";
import type { Logger } from "./logger.js";
import { DEV_DATA_CONFLICT_SQL_STATES, withDevDataConflictHint } from "./dev-data-conflict.js";

/** A pg driver error as drizzle hands it on: the SQLSTATE is on `.cause`, never the top level. */
function failedMigration(code: string): Error {
  const driver = Object.assign(
    new Error('column "name" of relation "categories" contains null values'),
    {
      code,
      table: "categories",
      column: "name",
    },
  );
  return Object.assign(new Error("Failed query"), { cause: driver });
}

function recorder(): { lines: Record<string, unknown>[]; log: Logger } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    log: (level, event, fields) => {
      lines.push({ level, event, ...fields });
    },
  };
}

const rejects = (error: Error) => () => Promise.reject(error);

describe("withDevDataConflictHint", () => {
  it("names the remedy when existing rows break a rule the migration adds", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23502");

    await expect(withDevDataConflictHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([
      {
        level: "error",
        event: "migrations.dev_data_conflict",
        sqlState: "23502",
        remedy: "wa-wt reset demo <worktree-name>",
      },
    ]);
  });

  it("names the remedy for every pinned SQLSTATE", async () => {
    // Walks the pinned list: a state added to the table that the code cannot act on fails here.
    for (const sqlState of DEV_DATA_CONFLICT_SQL_STATES) {
      const { lines, log } = recorder();
      await expect(
        withDevDataConflictHint(log, true, rejects(failedMigration(sqlState))),
      ).rejects.toThrow();
      expect(lines).toEqual([
        {
          level: "error",
          event: "migrations.dev_data_conflict",
          sqlState,
          remedy: "wa-wt reset demo <worktree-name>",
        },
      ]);
    }
  });

  it("says nothing about stale data when the migration itself is broken", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("42601");

    await expect(withDevDataConflictHint(log, true, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it("says nothing outside dev mode, where `wa-wt reset` is not the remedy", async () => {
    const { lines, log } = recorder();
    const failure = failedMigration("23502");

    await expect(withDevDataConflictHint(log, false, rejects(failure))).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it("logs nothing when the migrations apply", async () => {
    const { lines, log } = recorder();

    await withDevDataConflictHint(log, true, () => Promise.resolve());

    expect(lines).toEqual([]);
  });
});
