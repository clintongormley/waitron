import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "./client.js";
import { constraintTarget, refusalOn, sameTarget, triggerRaised } from "./constraint-target.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  RESTRICT_VIOLATION,
  TRIGGER_ABORT,
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

/**
 * A trigger's own `RAISE(ABORT, …)` — how this schema's hand-written guards refuse a write, and the
 * one refusal whose wording the migration, not the engine, chooses.
 *
 * The hand-built cases live here rather than in `constraint-target.test.ts` because that file
 * crafts PostgreSQL shapes (`code`, `table`, `detail`) that this engine never produces; the fields
 * these read are the ones `open()` above drives for real.
 */
// Deliberately NOT one of the product's own trigger messages
// (`packages/db/src/trigger-refusals.ts`): what is under test here is the PREDICATE, against a
// trigger this suite creates itself, and borrowing a real refusal's wording would suggest a
// binding between the two that does not exist.
const RAISED = "this suite's own guard refused the row";

describe("reading a trigger's raise", () => {
  it("matches the text a trigger raised, and declines a RESTRICT refusal carrying the same code", async () => {
    const db = await open();
    db.run(
      sql`create trigger child_guard before insert on child for each row when new.code = 'STOP'
          begin select raise(abort, 'this suite''s own guard refused the row'); end`,
    );
    const raised = await refusal(
      db,
      sql`insert into child (id, parent_id, code) values ('c4', 1, 'STOP')`,
    );
    expect(isPgError(raised, TRIGGER_ABORT)).toBe(true);
    expect(triggerRaised(raised, RAISED)).toBe(true);

    // The control, and the whole reason the predicate reads the message: SQLite implements
    // `ON DELETE RESTRICT` with an internal trigger, so a restricted delete arrives under the SAME
    // result code as the raise above. Only the words separate them.
    const restricted = await refusal(db, sql`delete from parent where id = 1`);
    expect(isPgError(restricted, TRIGGER_ABORT)).toBe(true);
    expect(triggerRaised(restricted, RAISED)).toBe(false);
  });

  it("declines a raise whose text merely contains the one asked for", async () => {
    const db = await open();
    db.run(
      sql`create trigger child_wider before insert on child for each row when new.code = 'WIDE'
          begin select raise(abort, 'this suite''s own guard refused the row, and then some'); end`,
    );
    const error = await refusal(
      db,
      sql`insert into child (id, parent_id, code) values ('c5', 1, 'WIDE')`,
    );
    // Equality, not containment: the text is a literal one migration owns, and a guard that raised
    // a longer sentence is a different guard.
    expect(triggerRaised(error, RAISED)).toBe(false);
  });

  it("declines every other class of refusal, however it is worded", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into parent (id, name) values (2, 'one')`);
    expect(triggerRaised(error, "UNIQUE constraint failed: parent.name")).toBe(false);
  });

  // No engine can produce this: the result code on one layer and the wording on another. It is the
  // shape that separates the same-layer rule from asking the two questions separately.
  it("does not join a result code on one layer to a message on another", () => {
    const split = new Error("outer", {
      cause: Object.assign(new Error("some other refusal"), {
        errcode: 1811,
        cause: new Error(RAISED),
      }),
    });
    expect(triggerRaised(split, RAISED)).toBe(false);
  });

  // Crafted for the same reason: SQLite never raises a trigger's words under another class's code.
  it("does not accept the right wording under the wrong result code", () => {
    expect(triggerRaised(Object.assign(new Error(RAISED), { errcode: 2067 }), RAISED)).toBe(false);
  });

  it("is false for anything that is not a refusal at all", () => {
    expect(triggerRaised(new Error(RAISED), RAISED)).toBe(false);
    expect(triggerRaised(undefined, RAISED)).toBe(false);
    expect(triggerRaised(RAISED, RAISED)).toBe(false);
  });
});
