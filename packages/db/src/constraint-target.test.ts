import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { constraintTarget, sameTarget } from "./constraint-target.js";
import { describeEachTarget } from "./testing/harness.js";

/**
 * Driven through REAL refusals rather than hand-built error objects: the fields this parser reads
 * (`table`, `detail`) are populated by the DRIVER, so a crafted error would only prove the parser
 * reads the craft. It runs against both targets for the same reason — PGlite is not node-postgres,
 * and the whole point of this helper is what each of them reports. The crafted-error cases at the
 * bottom are the exception, and deliberately so: a cause chain deeper than the walk's bound, and a
 * self-referential one, are shapes no database can be made to produce.
 */
describeEachTarget("constraintTarget", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  /** Runs `statements` until one is refused, and returns that refusal. */
  const violate = async (statements: readonly string[]): Promise<unknown> => {
    try {
      for (const statement of statements) await db.execute(sql.raw(statement));
    } catch (error) {
      return error;
    }
    throw new Error("expected a refusal, got none");
  };

  it("names the table and column of a single-column unique violation", async () => {
    const error = await violate([
      `create table probe_people (id int primary key, email text,
         constraint probe_people_email_key unique (email))`,
      `insert into probe_people values (1, 'a@x')`,
      `insert into probe_people values (2, 'a@x')`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_people", columns: ["email"] });
  });

  it("names both columns of a multi-column unique constraint", async () => {
    const error = await violate([
      `create table probe_pairs (a int, b int, constraint probe_pairs_ab_key unique (a, b))`,
      `insert into probe_pairs values (1, 2)`,
      `insert into probe_pairs values (1, 2)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_pairs", columns: ["a", "b"] });
  });

  it("names the expression when the unique index is over one", async () => {
    const error = await violate([
      `create table probe_expr (id int primary key, email text)`,
      `create unique index probe_expr_email_uq on probe_expr (lower(email)) where email is not null`,
      `insert into probe_expr values (1, 'A@x')`,
      `insert into probe_expr values (2, 'a@X')`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_expr", columns: ["lower(email)"] });
  });

  it("keeps the quotes a quoted identifier is reported with", async () => {
    const error = await violate([
      `create table probe_q ("My Col" int, b int, constraint probe_q_uq unique ("My Col", b))`,
      `insert into probe_q values (1, 2)`,
      `insert into probe_q values (1, 2)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_q", columns: ['"My Col"', "b"] });
  });

  it("names the referencing table and column of a foreign-key violation", async () => {
    const error = await violate([
      `create table probe_parent (id int primary key)`,
      `create table probe_child (id int primary key, p int,
         constraint probe_child_p_fk foreign key (p) references probe_parent(id))`,
      `insert into probe_child values (1, 7)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_child", columns: ["p"] });
  });

  // A RESTRICT refusal names the REFERENCING table and the REFERENCED table's key columns — the two
  // halves come from opposite ends of the foreign key. Measured, not assumed: the refusal below
  // reports `table: probe_rc` with `Key (id)=(1) is referenced from table "probe_rc".`, where `id`
  // is `probe_rp`'s column.
  it("names the referencing table of a RESTRICT violation", async () => {
    const error = await violate([
      `create table probe_rp (id int primary key)`,
      `create table probe_rc (id int primary key, p int,
         constraint probe_rc_p_fk foreign key (p) references probe_rp(id) on delete restrict)`,
      `insert into probe_rp values (1)`,
      `insert into probe_rc values (1, 1)`,
      `delete from probe_rp where id = 1`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_rc", columns: ["id"] });
  });

  it("returns undefined for a CHECK violation, which names no key", async () => {
    const error = await violate([
      `create table probe_chk (n int, constraint probe_chk_pos check (n > 0))`,
      `insert into probe_chk values (-1)`,
    ]);
    expect(constraintTarget(error)).toBeUndefined();
  });

  it("returns undefined for an error that is not a constraint violation", async () => {
    const error = await violate([`select * from a_table_that_does_not_exist`]);
    expect(constraintTarget(error)).toBeUndefined();
  });
});

describe("constraintTarget's cause walk", () => {
  const violation = Object.assign(new Error("dup"), {
    table: "people",
    detail: "Key (email)=(a@x) already exists.",
  });
  const wrapped = (depth: number, inner: unknown): unknown => {
    let error = inner;
    for (let i = 0; i < depth; i++) error = new Error(`layer ${i}`, { cause: error });
    return error;
  };

  it("finds a violation four layers down and gives up on the fifth", () => {
    expect(constraintTarget(wrapped(4, violation))).toEqual({
      table: "people",
      columns: ["email"],
    });
    expect(constraintTarget(wrapped(5, violation))).toBeUndefined();
  });

  it("does not spin on a self-referential cause", () => {
    const looped: { cause?: unknown } = {};
    looped.cause = looped;
    expect(constraintTarget(looped)).toBeUndefined();
  });

  it("returns undefined for values that are not errors at all", () => {
    expect(constraintTarget(null)).toBeUndefined();
    expect(constraintTarget(undefined)).toBeUndefined();
    expect(constraintTarget("dup key")).toBeUndefined();
  });

  it("ignores a layer that reports a table but no detail", () => {
    expect(constraintTarget(Object.assign(new Error("dup"), { table: "people" }))).toBeUndefined();
  });

  it("ignores a layer whose detail names no key", () => {
    expect(
      constraintTarget(
        Object.assign(new Error("chk"), { table: "people", detail: "Failing row contains (-1)." }),
      ),
    ).toBeUndefined();
  });
});

describe("sameTarget", () => {
  const target = { table: "persons", columns: ["lower(email)"] } as const;

  it("is true for the same table and the same columns", () => {
    expect(sameTarget({ table: "persons", columns: ["lower(email)"] }, target)).toBe(true);
  });

  it("is false for a different table", () => {
    expect(sameTarget({ table: "people", columns: ["lower(email)"] }, target)).toBe(false);
  });

  it("is false for a different column", () => {
    expect(sameTarget({ table: "persons", columns: ["email"] }, target)).toBe(false);
  });

  it("is false for a longer column list that starts the same way", () => {
    expect(sameTarget({ table: "persons", columns: ["lower(email)", "id"] }, target)).toBe(false);
  });

  // Column ORDER is part of the identity: `(location_id, name)` and `(name, location_id)` are two
  // different indexes, and PostgreSQL reports each in its own declared order.
  it("is false when the same columns arrive in the other order", () => {
    const pair = { table: "tills", columns: ["location_id", "name"] } as const;
    expect(sameTarget({ table: "tills", columns: ["name", "location_id"] }, pair)).toBe(false);
  });

  it("is false when there is no target at all", () => {
    expect(sameTarget(undefined, target)).toBe(false);
  });
});
