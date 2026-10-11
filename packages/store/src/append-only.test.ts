import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { type SQL, sql } from "drizzle-orm";
import { appendOnlyTriggerFaults, installAppendOnlyTriggers } from "./append-only.js";
import { drizzleNodeSqlite, type NodeSqliteDatabase } from "./node-sqlite-adapter.js";
import { connectionPair } from "./connections.js";

const open = () => {
  const connection = new DatabaseSync(":memory:");
  connection.exec("pragma recursive_triggers = on");
  connection.exec(`create table immutable_records (id integer primary key, digest text not null)`);
  connection.exec(`create table tables_ (id integer primary key, name text not null)`);
  connections.push(connection);
  return drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} });
};

const connections: DatabaseSync[] = [];
afterEach(() => {
  while (connections.length > 0) connections.pop()!.close();
});

const seed = (db: NodeSqliteDatabase<Record<string, never>>) => {
  db.run(sql`insert into immutable_records (id, digest) values (1, 'first')`);
};

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in. Drizzle's own message is
 * `Failed to run the query '<the statement>'`, so matching the table name on it passes whether a
 * trigger fired or not.
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
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(refusal(() => db.run(sql`update immutable_records set digest = 'x'`)).message).toBe(
      "immutable_records is append-only",
    );
    expect(db.get(sql`select digest from immutable_records where id = 1`)).toEqual({
      digest: "first",
    });
  });

  it("refuses a delete from a ledger table", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(refusal(() => db.run(sql`delete from immutable_records`)).message).toBe(
      "immutable_records is append-only",
    );
    expect(db.all(sql`select id from immutable_records`)).toHaveLength(1);
  });

  it("refuses an insert that replaces a row already there", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(
      refusal(() =>
        db.run(sql`insert or replace into immutable_records (id, digest) values (1, 'x')`),
      ).message,
    ).toBe("immutable_records is append-only");
    expect(db.get(sql`select digest from immutable_records where id = 1`)).toEqual({
      digest: "first",
    });
  });

  it("refuses an insert that updates the row it conflicts with", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(
      refusal(() =>
        db.run(
          sql`insert into immutable_records (id, digest) values (1, 'x') on conflict (id) do update set digest = 'x'`,
        ),
      ).message,
    ).toBe("immutable_records is append-only");
  });

  // SQLITE_CONSTRAINT_TRIGGER (1811). A caller that has to tell this refusal from a unique-index or
  // foreign-key one reads the result code, and the code a `RAISE(ABORT)` raises is its own.
  it("refuses under the trigger result code", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(refusal(() => db.run(sql`delete from immutable_records`)).errcode).toBe(1811);
  });

  it("lets a new row be appended", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    db.run(sql`insert into immutable_records (id, digest) values (2, 'second')`);
    expect(db.all(sql`select id from immutable_records`)).toHaveLength(2);
  });

  it("leaves a table it was not given alone", () => {
    const db = open();
    installAppendOnlyTriggers(db, ["immutable_records"]);

    db.run(sql`insert into tables_ (id, name) values (1, 'one')`);
    db.run(sql`update tables_ set name = 'two'`);
    expect(db.get(sql`select name from tables_ where id = 1`)).toEqual({ name: "two" });
  });

  it("can be run again over a database that already carries the triggers", () => {
    const db = open();
    seed(db);
    installAppendOnlyTriggers(db, ["immutable_records"]);
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(refusal(() => db.run(sql`delete from immutable_records`)).message).toBe(
      "immutable_records is append-only",
    );
  });

  it("stores what the installer sent, as `CREATE TRIGGER` plus the rest", () => {
    const db = open();
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(
      db.get(
        sql`select sql from sqlite_master where name = 'immutable_records_append_only_update'`,
      ),
    ).toEqual({
      sql: `CREATE TRIGGER "immutable_records_append_only_update" before update on "immutable_records" for each row begin select raise(abort, 'immutable_records is append-only'); end`,
    });
  });

  it("refuses a table name that is not a plain identifier", () => {
    const db = open();
    expect(() => installAppendOnlyTriggers(db, ['x"; drop table tables_; --'])).toThrow(
      /not a plain table name/,
    );
    expect(db.all(sql`select name from sqlite_master where type = 'table'`)).toHaveLength(2);
  });

  it("refuses a bad name anywhere in the list before sending any statement", () => {
    const sent: SQL[] = [];
    expect(() =>
      installAppendOnlyTriggers({ run: (query) => sent.push(query) }, [
        "immutable_records",
        'x"; drop table tables_; --',
      ]),
    ).toThrow('append-only trigger: x"; drop table tables_; -- is not a plain table name');
    expect(sent).toEqual([]);
  });
});

describe("appendOnlyTriggerFaults", () => {
  const both = ["immutable_records", "tables_"] as const;

  it("finds nothing wrong with what the installer wrote", () => {
    const db = open();
    installAppendOnlyTriggers(db, both);

    expect(appendOnlyTriggerFaults(db, both)).toEqual({ missing: [], altered: [] });
  });

  it("reports a dropped trigger as missing", () => {
    const db = open();
    installAppendOnlyTriggers(db, both);
    db.run(sql`drop trigger "tables__append_only_delete"`);

    expect(appendOnlyTriggerFaults(db, both)).toEqual({
      missing: ["tables__append_only_delete"],
      altered: [],
    });
  });

  it("reports a same-name trigger with another body as altered, even after the installer runs again", () => {
    const db = open();
    installAppendOnlyTriggers(db, both);
    db.run(sql`drop trigger "immutable_records_append_only_update"`);
    db.run(
      sql`create trigger "immutable_records_append_only_update" before update on "immutable_records" for each row begin select 1; end`,
    );

    const expected = { missing: [], altered: ["immutable_records_append_only_update"] };
    expect(appendOnlyTriggerFaults(db, both)).toEqual(expected);
    installAppendOnlyTriggers(db, both);
    expect(appendOnlyTriggerFaults(db, both)).toEqual(expected);
  });

  it("reports a same-name, same-body trigger on another table as altered", () => {
    const db = open();
    installAppendOnlyTriggers(db, both);
    db.run(sql`drop trigger "immutable_records_append_only_delete"`);
    db.run(
      sql.raw(
        `create trigger "immutable_records_append_only_delete" before delete on "tables_" for each row begin select raise(abort, 'immutable_records is append-only'); end`,
      ),
    );

    expect(appendOnlyTriggerFaults(db, both)).toEqual({
      missing: [],
      altered: ["immutable_records_append_only_delete"],
    });
  });

  it("reports an upper-case replacement as altered, not missing", () => {
    const db = open();
    installAppendOnlyTriggers(db, both);
    db.run(sql`drop trigger "immutable_records_append_only_update"`);
    db.run(
      sql`create trigger "IMMUTABLE_RECORDS_APPEND_ONLY_UPDATE" before update on "immutable_records" for each row begin select 1; end`,
    );

    expect(appendOnlyTriggerFaults(db, both)).toEqual({
      missing: [],
      altered: ["immutable_records_append_only_update"],
    });
  });

  it("ignores triggers it does not expect", () => {
    const db = open();
    db.run(sql`create table unlisted (id integer primary key)`);
    installAppendOnlyTriggers(db, ["immutable_records"]);
    db.run(
      sql`create trigger "waitron_change_immutable_records" after insert on "immutable_records" begin select 1; end`,
    );
    db.run(
      sql`create trigger "unlisted_append_only_update" before update on "unlisted" begin select 1; end`,
    );

    expect(appendOnlyTriggerFaults(db, ["immutable_records"])).toEqual({
      missing: [],
      altered: [],
    });
  });

  it("reports both triggers of a table that was never installed, in list order", () => {
    const db = open();
    installAppendOnlyTriggers(db, ["immutable_records"]);

    expect(appendOnlyTriggerFaults(db, both)).toEqual({
      missing: ["tables__append_only_update", "tables__append_only_delete"],
      altered: [],
    });
  });

  it("reads nothing for an empty list", () => {
    const read: SQL[] = [];
    const target = {
      execute: <TRow extends Record<string, unknown>>(query: SQL) => {
        read.push(query);
        return { rows: [] as TRow[] };
      },
    };

    expect(appendOnlyTriggerFaults(target, [])).toEqual({ missing: [], altered: [] });
    expect(read).toEqual([]);
  });
});
