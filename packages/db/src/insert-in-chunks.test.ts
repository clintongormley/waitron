import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { insertInChunks, rowsPerStatement, statementChunks } from "./insert-in-chunks.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { orderPortions } from "./schema/order-portions.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("rowsPerStatement", () => {
  it("fits as many whole rows as the limit allows", () => {
    expect(rowsPerStatement(7, 32766)).toBe(4680);
    expect(rowsPerStatement(5, 10)).toBe(2);
    expect(rowsPerStatement(5, 14)).toBe(2);
    expect(rowsPerStatement(5, 15)).toBe(3);
    expect(rowsPerStatement(5, 5)).toBe(1);
  });

  it("refuses a limit too small for one row", () => {
    expect(() => rowsPerStatement(5, 4)).toThrow(
      "rowsPerStatement: a row of 5 columns does not fit in 4 bound values",
    );
  });
});

describe("statementChunks", () => {
  it("cuts rows into runs of as many as fit the limit at one value per column, in order", () => {
    expect(statementChunks(orderPortions, ["a", "b", "c", "d", "e"], 10)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
    expect(statementChunks(orderPortions, ["a", "b"], 10)).toEqual([["a", "b"]]);
  });

  it("gives no runs for no rows", () => {
    expect(statementChunks(orderPortions, [], 10)).toEqual([]);
  });

  it("by default fills each run up to SQLite's limit", () => {
    const rows = Array.from({ length: Math.floor(SQL_VARIABLE_LIMIT / 5) + 1 }, (_, i) => i);
    expect(statementChunks(orderPortions, rows).map((run) => run.length)).toEqual([
      rows.length - 1,
      1,
    ]);
  });
});

it("the limit is no higher than this runtime's SQLite allows", () => {
  const connection = new DatabaseSync(":memory:");
  expect(SQL_VARIABLE_LIMIT).toBe(32766);
  expect(connection.limits.variableNumber).toBeGreaterThanOrEqual(SQL_VARIABLE_LIMIT);
  connection.close();
});

describe("insertInChunks", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  const portions = (count: number) => {
    const cohortId = randomUUID();
    return Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      cohortId,
      ordinal: i + 1,
      measured: i % 2 === 0,
    }));
  };

  async function insertCounting(
    rows: ReturnType<typeof portions>,
    limit?: number,
  ): Promise<number> {
    return withTransaction(suite.db, async (tx) => {
      const insert = vi.spyOn(tx, "insert");
      await insertInChunks(tx, orderPortions, rows, limit);
      const statements = insert.mock.calls.length;
      insert.mockRestore();
      return statements;
    });
  }

  const stored = (cohortId: string) =>
    suite.db
      .select({
        id: orderPortions.id,
        cohortId: orderPortions.cohortId,
        ordinal: orderPortions.ordinal,
        measured: orderPortions.measured,
      })
      .from(orderPortions)
      .where(eq(orderPortions.cohortId, cohortId))
      .orderBy(asc(orderPortions.ordinal));

  it("writes nothing, and issues no statement, for no rows", async () => {
    expect(await insertCounting([])).toBe(0);
    expect(await suite.db.select().from(orderPortions)).toEqual([]);
  });

  it("splits rows across statements so none binds more than the limit, and writes every row", async () => {
    const rows = portions(5);
    expect(await insertCounting(rows, 10)).toBe(3);
    expect(await stored(rows[0]!.cohortId)).toEqual(rows);
  });

  it("by default fills each statement up to SQLite's limit", async () => {
    const perStatement = Math.floor(SQL_VARIABLE_LIMIT / 5);
    const fits = portions(perStatement);
    expect(await insertCounting(fits)).toBe(1);
    const over = portions(perStatement + 1);
    expect(await insertCounting(over)).toBe(2);
    expect(await stored(over[0]!.cohortId)).toEqual(over);
  });
});
