import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError } from "./errors.js";
import { refusalError, type Refusal } from "./refusals.js";
import { useVenueDb } from "./venue-db.js";

/**
 * Each case provokes the REAL refusal on a database opened by the product's own opener and asks
 * that `refusalError` builds the same thing, so every crafted refusal in the tree is a quotation
 * of the engine rather than a guess about it.
 *
 * One database serves every case: each statement is refused, so none changes what the next one
 * meets.
 */
const suite = useVenueDb({
  migrations: [],
  resetPerTest: false,
  setup: (db) => {
    db.run(sql`create table parent (id integer primary key, name text not null unique)`);
    db.run(sql`create table child (
      id text primary key,
      parent_id integer references parent(id) on delete restrict,
      code text,
      tag text,
      amount integer,
      unique (code, tag),
      constraint child_amount_ck check (amount is null or amount > 0))`);
    db.run(sql`create table expr (a text)`);
    db.run(sql`create unique index expr_lower_uq on expr (lower(a))`);
    db.run(
      sql`create trigger expr_guard before insert on expr for each row when new.a = 'STOP'
          begin select raise(abort, 'expr refuses STOP'); end`,
    );
    db.run(sql`insert into parent (id, name) values (1, 'one')`);
    db.run(sql`insert into child (id, parent_id, code, tag) values ('c1', 1, 'C', 'T')`);
    db.run(sql`insert into expr (a) values ('X')`);
    return Promise.resolve();
  },
});

/** Everything a reader could look at on either error: its prototype, its own keys and their values. */
const shape = (error: unknown) => {
  const e = error as Record<string, unknown>;
  return {
    prototype: Object.getPrototypeOf(error) as unknown,
    ownKeys: Object.keys(e),
    message: e.message,
    code: e.code,
    errcode: e.errcode,
    errstr: e.errstr,
  };
};

const cases: [string, Refusal, ReturnType<typeof sql>][] = [
  [
    "a unique index over columns",
    { unique: { table: "child", columns: ["code", "tag"] } },
    sql`insert into child (id, parent_id, code, tag) values ('c2', 1, 'C', 'T')`,
  ],
  [
    "a primary key",
    { primaryKey: { table: "child", column: "id" } },
    sql`insert into child (id, parent_id) values ('c1', 1)`,
  ],
  [
    "a unique index over an expression",
    { uniqueIndex: "expr_lower_uq" },
    sql`insert into expr (a) values ('x')`,
  ],
  [
    "a NOT NULL column",
    { notNull: { table: "parent", column: "name" } },
    sql`insert into parent (id, name) values (2, null)`,
  ],
  [
    "a foreign key naming no parent",
    { foreignKey: true },
    sql`insert into child (id, parent_id) values ('c3', 99)`,
  ],
  ["an ON DELETE RESTRICT key", { restrict: true }, sql`delete from parent where id = 1`],
  [
    "a named CHECK",
    { check: "child_amount_ck" },
    sql`insert into child (id, parent_id, amount) values ('c4', 1, 0)`,
  ],
  [
    "a trigger's RAISE(ABORT)",
    { trigger: "expr refuses STOP" },
    sql`insert into expr (a) values ('STOP')`,
  ],
];

describe("refusalError", () => {
  it.each(cases)("builds what the engine throws for %s", async (_name, refusal, statement) => {
    const real = await captureError(() => suite.db.execute(statement));
    expect(shape(refusalError(refusal))).toEqual(shape(real));
  });
});
