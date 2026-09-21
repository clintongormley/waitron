import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "./client.js";
import { constraintTarget, refusalOn, sameTarget } from "./constraint-target.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
} from "./sql-state.js";
import { isPgError, isUniqueViolation } from "./unique-violation.js";

/**
 * Every case here is a REAL refusal from the engine, never a hand-built error: what this file
 * parses is one driver's exact words, and a crafted message would only prove the parser reads
 * itself. `constraint-target.test.ts` beside it drives the same questions through PGlite and a
 * real PostgreSQL, and is the storage swap's step 25 (step group 7).
 */
const opened: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const open = async (): Promise<Database> => {
  const store = await openVenueDatabase(mkdtempSync(join(tmpdir(), "waitron-refusal-")));
  opened.push(store);
  const db = store.venue;
  db.run(sql`create table parent (id integer primary key, name text not null unique)`);
  db.run(sql`create table child (
    id text primary key,
    parent_id integer not null references parent(id) on delete restrict,
    code text,
    tag text,
    amount integer,
    unique (code, tag),
    constraint child_amount_ck check (amount is null or amount > 0))`);
  db.run(sql`create table expr (a text)`);
  db.run(sql`create unique index expr_lower_uq on expr (lower(a))`);
  db.run(sql`insert into parent (id, name) values (1, 'one')`);
  db.run(sql`insert into child (id, parent_id, code, tag) values ('c1', 1, 'C', 'T')`);
  db.run(sql`insert into expr (a) values ('X')`);
  return db;
};

const refusal = async (db: Database, statement: ReturnType<typeof sql>): Promise<unknown> => {
  try {
    db.run(statement);
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to be refused, but it succeeded");
};

describe("reading a SQLite refusal", () => {
  it("names the table and column a unique index refused", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into parent (id, name) values (2, 'one')`);
    expect(constraintTarget(error)).toEqual({ table: "parent", columns: ["name"] });
    expect(isUniqueViolation(error)).toBe(true);
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "parent", columns: ["name"] })).toBe(true);
  });

  it("names both columns of a composite unique index, in the index's order", async () => {
    const db = await open();
    const error = await refusal(
      db,
      sql`insert into child (id, parent_id, code, tag) values ('c2', 1, 'C', 'T')`,
    );
    expect(constraintTarget(error)).toEqual({ table: "child", columns: ["code", "tag"] });
    // Order is part of the identity: `(code, tag)` is a different index from `(tag, code)`.
    expect(sameTarget(constraintTarget(error), { table: "child", columns: ["tag", "code"] })).toBe(
      false,
    );
  });

  it("reads a primary-key collision as a unique violation", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into child (id, parent_id) values ('c1', 1)`);
    // SQLite reports a primary key under its own result code, where PostgreSQL folded it into
    // 23505. A caller asking "was this key already taken?" must get the same answer either way.
    expect(isUniqueViolation(error)).toBe(true);
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "child", columns: ["id"] })).toBe(true);
  });

  it("names the table and column a NOT NULL refused", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into parent (id, name) values (3, null)`);
    expect(constraintTarget(error)).toEqual({ table: "parent", columns: ["name"] });
    expect(isPgError(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(isUniqueViolation(error)).toBe(false);
  });

  it("names nothing for an index over an expression", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into expr (a) values ('x')`);
    // `UNIQUE constraint failed: index 'expr_lower_uq'` — the class is reportable, the key is not.
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("names nothing for a foreign key, and still reports the class", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into child (id, parent_id) values ('c9', 99)`);
    // `FOREIGN KEY constraint failed`, and that is the whole message — no table, no column, no
    // constraint name. A caller that has to know WHICH foreign key cannot learn it from here.
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("tells a restricted delete apart from a value naming no parent", async () => {
    const db = await open();
    const error = await refusal(db, sql`delete from parent where id = 1`);
    expect(isPgError(error, RESTRICT_VIOLATION)).toBe(true);
    // The two directions carried different SQLSTATEs on PostgreSQL and carry different result
    // codes here, so the distinction survives the engine change.
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(false);
  });

  it("names nothing for a CHECK, and still reports the class", async () => {
    const db = await open();
    const error = await refusal(
      db,
      sql`insert into child (id, parent_id, amount) values ('c3', 1, 0)`,
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("is not a refusal at all when nothing in the chain carries a result code", () => {
    expect(constraintTarget(new Error("plain"))).toBeUndefined();
    expect(constraintTarget(undefined)).toBeUndefined();
    expect(refusalOn(new Error("plain"), UNIQUE_VIOLATION, { table: "t", columns: ["c"] })).toBe(
      false,
    );
  });

  it("refuses to match a target on a different class of refusal", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into parent (id, name) values (3, null)`);
    // The NOT NULL and the unique index name the same table and column, so the class is the only
    // thing telling them apart — which is why `refusalOn` asks for both.
    expect(refusalOn(error, NOT_NULL_VIOLATION, { table: "parent", columns: ["name"] })).toBe(true);
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "parent", columns: ["name"] })).toBe(false);
  });
});
