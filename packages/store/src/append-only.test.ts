import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { installAppendOnlyTriggers } from "./append-only.js";
import { drizzleNodeSqlite, type NodeSqliteDatabase } from "./node-sqlite-adapter.js";
import { connectionPair } from "./connections.js";

const open = () => {
  const connection = new DatabaseSync(":memory:");
  connection.exec("pragma recursive_triggers = on");
  connection.exec(
    `create table registros_facturacion (id integer primary key, huella text not null)`,
  );
  connection.exec(`create table tables_ (id integer primary key, name text not null)`);
  connections.push(connection);
  return drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} });
};

const connections: DatabaseSync[] = [];
afterEach(() => {
  while (connections.length > 0) connections.pop()!.close();
});

const seed = (db: NodeSqliteDatabase<Record<string, never>>) => {
  db.run(sql`insert into registros_facturacion (id, huella) values (1, 'first')`);
};

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in.
 *
 * Asserting on the caught error directly would prove nothing: Drizzle's wrapper message is
 * `Failed to run the query '<the statement>'`, so a match on the table name — or on any word the
 * statement contains — passes whether a trigger fired or not. Measured: with no triggers installed
 * at all, `toThrow(/registros_facturacion/)` against the wrapper still passes.
 */
const refusal = (body: () => unknown): { message: string; errcode: number } => {
  try {
    body();
  } catch (error) {
    let layer: unknown = error;
    while (layer !== null && typeof layer === "object") {
      const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
      if (typeof errcode === "number" && typeof message === "string") return { message, errcode };
      layer = (layer as { cause?: unknown }).cause;
    }
    throw new Error("no driver refusal in the cause chain", { cause: error });
  }
  throw new Error("the statement was accepted");
};

describe("installAppendOnlyTriggers", () => {
  it("refuses an update to a ledger table", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(refusal(() => db.run(sql`update registros_facturacion set huella = 'x'`)).message).toBe(
      "registros_facturacion is append-only",
    );
    expect(db.get(sql`select huella from registros_facturacion where id = 1`)).toEqual({
      huella: "first",
    });
  });

  it("refuses a delete from a ledger table", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(refusal(() => db.run(sql`delete from registros_facturacion`)).message).toBe(
      "registros_facturacion is append-only",
    );
    expect(db.all(sql`select id from registros_facturacion`)).toHaveLength(1);
  });

  it("refuses an insert that replaces a row already there", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(
      refusal(() =>
        db.run(sql`insert or replace into registros_facturacion (id, huella) values (1, 'x')`),
      ).message,
    ).toBe("registros_facturacion is append-only");
    expect(db.get(sql`select huella from registros_facturacion where id = 1`)).toEqual({
      huella: "first",
    });
  });

  it("refuses an insert that updates the row it conflicts with", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(
      refusal(() =>
        db.run(
          sql`insert into registros_facturacion (id, huella) values (1, 'x') on conflict (id) do update set huella = 'x'`,
        ),
      ).message,
    ).toBe("registros_facturacion is append-only");
  });

  // SQLITE_CONSTRAINT_TRIGGER (1811). A caller that has to tell this refusal from a unique-index or
  // foreign-key one reads the result code, and the code a `RAISE(ABORT)` raises is its own.
  it("refuses under the trigger result code", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(refusal(() => db.run(sql`delete from registros_facturacion`)).errcode).toBe(1811);
  });

  it("lets a new row be appended", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    db.run(sql`insert into registros_facturacion (id, huella) values (2, 'second')`);
    expect(db.all(sql`select id from registros_facturacion`)).toHaveLength(2);
  });

  it("leaves a table it was not given alone", () => {
    const db = open();
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    db.run(sql`insert into tables_ (id, name) values (1, 'one')`);
    db.run(sql`update tables_ set name = 'two'`);
    expect(db.get(sql`select name from tables_ where id = 1`)).toEqual({ name: "two" });
  });

  it("can be run again over a database that already carries the triggers", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);
    installAppendOnlyTriggers(db, ["registros_facturacion"]);

    expect(refusal(() => db.run(sql`delete from registros_facturacion`)).message).toBe(
      "registros_facturacion is append-only",
    );
  });

  it("refuses a table name that is not a plain identifier", () => {
    const db = open();
    expect(() => installAppendOnlyTriggers(db, ['x"; drop table tables_; --'])).toThrow(
      /not a plain table name/,
    );
    expect(db.all(sql`select name from sqlite_master where type = 'table'`)).toHaveLength(2);
  });
});
