import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "./client.js";
import {
  checkFailed,
  constraintTarget,
  indexViolated,
  refusalOn,
  sameTarget,
  triggerRaised,
} from "./constraint-target.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  RESTRICT_VIOLATION,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
} from "./sql-state.js";
import { isRefusal, isUniqueViolation } from "./unique-violation.js";

/**
 * Every case here is a REAL refusal from the engine, never a hand-built error: what this file
 * parses is one driver's exact words, and a crafted message would only prove the parser reads
 * itself. `constraint-target.test.ts` beside it holds the complement — the cause-chain shapes no
 * engine emits, which have to be crafted — and its own header states that split.
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
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
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
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("tells a restricted delete apart from a value naming no parent", async () => {
    const db = await open();
    const error = await refusal(db, sql`delete from parent where id = 1`);
    expect(isRefusal(error, RESTRICT_VIOLATION)).toBe(true);
    // The two directions carried different SQLSTATEs on PostgreSQL and carry different result
    // codes here, so the distinction survives the engine change.
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(false);
  });

  it("names nothing for a CHECK, and still reports the class", async () => {
    const db = await open();
    const error = await refusal(
      db,
      sql`insert into child (id, parent_id, amount) values ('c3', 1, 0)`,
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
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
    expect(isRefusal(raised, TRIGGER_ABORT)).toBe(true);
    expect(triggerRaised(raised, RAISED)).toBe(true);

    // The control, and the whole reason the predicate reads the message: SQLite implements
    // `ON DELETE RESTRICT` with an internal trigger, so a restricted delete arrives under the SAME
    // result code as the raise above. Only the words separate them.
    const restricted = await refusal(db, sql`delete from parent where id = 1`);
    expect(isRefusal(restricted, TRIGGER_ABORT)).toBe(true);
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

/**
 * WHICH CHECK refused this write — the question a table carrying several of them has to ask.
 *
 * `constraintTarget` returns `undefined` for every CHECK, because a CHECK names no key; what
 * SQLite puts after the colon is the constraint's NAME. That is enough to tell one CHECK on a
 * table from another, which `isRefusal(error, CHECK_VIOLATION)` on its own is not.
 */
describe("reading which CHECK refused a write", () => {
  it("names the constraint a refused row broke, and declines its sibling on the same table", async () => {
    const db = await open();
    db.run(sql`alter table child add column rank integer
               constraint child_rank_ck check (rank is null or rank < 10)`);
    const amount = await refusal(
      db,
      sql`insert into child (id, parent_id, amount) values ('c6', 1, 0)`,
    );
    expect(isRefusal(amount, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(amount, "child_amount_ck")).toBe(true);
    // The control, and the whole point: the class alone cannot separate these two, because both
    // are 275 on the same table.
    expect(checkFailed(amount, "child_rank_ck")).toBe(false);

    const rank = await refusal(
      db,
      sql`insert into child (id, parent_id, rank) values ('c7', 1, 99)`,
    );
    expect(checkFailed(rank, "child_rank_ck")).toBe(true);
    expect(checkFailed(rank, "child_amount_ck")).toBe(false);
  });

  it("declines every other class of refusal, however it is worded", async () => {
    const db = await open();
    const unique = await refusal(db, sql`insert into parent (id, name) values (2, 'one')`);
    expect(checkFailed(unique, "child_amount_ck")).toBe(false);
    const fk = await refusal(db, sql`delete from parent where id = 1`);
    expect(checkFailed(fk, "child_amount_ck")).toBe(false);
  });

  it("cannot name an ANONYMOUS check, which reports its expression instead", async () => {
    // The hedge stated on the predicate, measured rather than assumed: a CHECK declared with no
    // name reports the EXPRESSION, so there is no name to ask for and this can only ever be false.
    const db = await open();
    db.run(sql`create table anon (a integer, check (a > 0))`);
    const error = await refusal(db, sql`insert into anon (a) values (0)`);
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, "anon_a_ck")).toBe(false);
  });

  // Crafted for the reason `triggerRaised`'s twin states: no engine produces the result code on
  // one layer and the wording on another, and that is the shape the same-layer rule rules out.
  it("does not join a result code on one layer to a message on another", () => {
    const split = new Error("outer", {
      cause: Object.assign(new Error("some other refusal"), {
        errcode: 275,
        cause: new Error("CHECK constraint failed: child_amount_ck"),
      }),
    });
    expect(checkFailed(split, "child_amount_ck")).toBe(false);
  });

  it("is false for anything that is not a refusal at all", () => {
    expect(
      checkFailed(new Error("CHECK constraint failed: child_amount_ck"), "child_amount_ck"),
    ).toBe(false);
    expect(checkFailed(undefined, "child_amount_ck")).toBe(false);
  });
});

/**
 * WHICH INDEX refused this write, when the engine names an index rather than a key.
 *
 * SQLite reports a unique index over an EXPRESSION as `UNIQUE constraint failed: index '<name>'` —
 * the index's own name, and no columns — so {@link constraintTarget} returns `undefined` for it and
 * every `sameTarget` comparison against such an index is false. The name is the identity, the same
 * way a CHECK's is.
 *
 * The hedge, and it is the thing a reader must not have to discover: this is NOT how a plain-column
 * index is reported. That one names its TABLE and COLUMNS and no index name at all, so asking
 * `indexViolated` for it can only ever be false — `refusalOn` is its question. Both shapes are
 * driven below, each against the other as its control.
 */
describe("reading which INDEX refused a write", () => {
  it("names the index an expression-index collision refused, and declines another name", async () => {
    const db = await open();
    const error = await refusal(db, sql`insert into expr (a) values ('x')`);
    expect(isUniqueViolation(error)).toBe(true);
    expect(indexViolated(error, "expr_lower_uq")).toBe(true);
    // Both ways: a refusal on some OTHER index must not answer yes, or the predicate would let a
    // caller translate a refusal it never read.
    expect(indexViolated(error, "expr_some_other_uq")).toBe(false);
    // And the reciprocal that made this predicate necessary: there is no key to compare.
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("cannot name a PLAIN-column index, which reports its table and columns instead", async () => {
    const db = await open();
    db.run(sql`create table named_uq (a text)`);
    db.run(sql`create unique index named_uq_a_uq on named_uq (a)`);
    db.run(sql`insert into named_uq (a) values ('K')`);
    const error = await refusal(db, sql`insert into named_uq (a) values ('K')`);
    // The index has a name and the refusal does not carry it — measured, not assumed.
    expect(indexViolated(error, "named_uq_a_uq")).toBe(false);
    // The control in the other direction: this shape IS identifiable, by its key.
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "named_uq", columns: ["a"] })).toBe(true);
  });

  it("declines every other class of refusal, however it is worded", async () => {
    const db = await open();
    const notNull = await refusal(db, sql`insert into parent (id, name) values (3, null)`);
    expect(indexViolated(notNull, "expr_lower_uq")).toBe(false);
    const fk = await refusal(db, sql`delete from parent where id = 1`);
    expect(indexViolated(fk, "expr_lower_uq")).toBe(false);
  });

  // Crafted for the reason the two sibling predicates state: no engine puts the result code on one
  // layer and the wording on another, and that is the shape the same-layer rule rules out.
  it("does not join a result code on one layer to a message on another", () => {
    const split = new Error("outer", {
      cause: Object.assign(new Error("some other refusal"), {
        errcode: 2067,
        cause: new Error("UNIQUE constraint failed: index 'expr_lower_uq'"),
      }),
    });
    expect(indexViolated(split, "expr_lower_uq")).toBe(false);
  });

  it("is false for anything that is not a refusal at all", () => {
    expect(
      indexViolated(new Error("UNIQUE constraint failed: index 'expr_lower_uq'"), "expr_lower_uq"),
    ).toBe(false);
    expect(indexViolated(undefined, "expr_lower_uq")).toBe(false);
  });
});
