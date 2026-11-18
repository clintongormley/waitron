import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { insertInChunks, rowsPerStatement, statementChunks } from "./insert-in-chunks.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { orderEvents } from "./schema/order-events.js";
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

const EVENT_COLUMNS = 14;

describe("statementChunks", () => {
  it("cuts rows into runs of as many as fit the limit at one value per column, in order", () => {
    expect(statementChunks(orderEvents, ["a", "b", "c", "d", "e"], EVENT_COLUMNS * 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
    expect(statementChunks(orderEvents, ["a", "b"], EVENT_COLUMNS * 2)).toEqual([["a", "b"]]);
  });

  it("gives no runs for no rows", () => {
    expect(statementChunks(orderEvents, [], EVENT_COLUMNS * 2)).toEqual([]);
  });

  it("by default fills each run up to SQLite's limit", () => {
    const rows = Array.from(
      { length: Math.floor(SQL_VARIABLE_LIMIT / EVENT_COLUMNS) + 1 },
      (_, i) => i,
    );
    expect(statementChunks(orderEvents, rows).map((run) => run.length)).toEqual([
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

  const events = (count: number) => {
    const fromOrderId = randomUUID();
    return Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      lineId: String(i).padStart(5, "0"),
      fromOrderId,
      detail: { cohortId: fromOrderId, ordinal: i + 1 },
      kind: "dish.cancelled" as const,
    }));
  };

  async function insertCounting(rows: ReturnType<typeof events>, limit?: number): Promise<number> {
    return withTransaction(suite.db, async (tx) => {
      const insert = vi.spyOn(tx, "insert");
      await insertInChunks(tx, orderEvents, rows, limit);
      const statements = insert.mock.calls.length;
      insert.mockRestore();
      return statements;
    });
  }

  const stored = (fromOrderId: string) =>
    suite.db
      .select({
        id: orderEvents.id,
        lineId: orderEvents.lineId,
        fromOrderId: orderEvents.fromOrderId,
        detail: orderEvents.detail,
        kind: orderEvents.kind,
      })
      .from(orderEvents)
      .where(eq(orderEvents.fromOrderId, fromOrderId))
      .orderBy(asc(orderEvents.lineId));

  it("writes nothing, and issues no statement, for no rows", async () => {
    expect(await insertCounting([])).toBe(0);
    expect(await suite.db.select().from(orderEvents)).toEqual([]);
  });

  it("splits rows across statements so none binds more than the limit, and writes every row", async () => {
    const rows = events(5);
    expect(await insertCounting(rows, EVENT_COLUMNS * 2)).toBe(3);
    expect(await stored(rows[0]!.fromOrderId)).toEqual(rows);
  });

  it("by default fills each statement up to SQLite's limit", async () => {
    const perStatement = Math.floor(SQL_VARIABLE_LIMIT / EVENT_COLUMNS);
    const fits = events(perStatement);
    expect(await insertCounting(fits)).toBe(1);
    const over = events(perStatement + 1);
    expect(await insertCounting(over)).toBe(2);
    expect(await stored(over[0]!.fromOrderId)).toEqual(over);
  });
});
