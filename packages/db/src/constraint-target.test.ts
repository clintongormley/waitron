import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { constraintTarget, refusalOn, sameTarget } from "./constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "./sql-state.js";
import { describeEachTarget } from "./testing/harness.js";

/**
 * Driven through REAL refusals rather than hand-built error objects: the fields this parser reads
 * (`table`, `detail`) are populated by the DRIVER, so a crafted error would only prove the parser
 * reads the craft. It runs against both targets for the same reason — PGlite is not node-postgres,
 * and the whole point of this helper is what each of them reports. The crafted-error cases at the
 * bottom are the exception, for shapes no database can be made to produce — a cause chain deeper
 * than the walk's bound, a self-referential one, and a SQLSTATE and a key arriving on two different
 * layers. The rest of that block crafts for a second reason: a `detail` a server would not write.
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

  // A quoted identifier may contain the separator the column list uses. Splitting on every comma
  // would report two columns where the index declares one, and no caller could ever match it.
  it("keeps a comma that is inside a quoted identifier", async () => {
    const error = await violate([
      `create table probe_comma ("a, b" int, c int, constraint probe_comma_uq unique ("a, b", c))`,
      `insert into probe_comma values (1, 2)`,
      `insert into probe_comma values (1, 2)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_comma", columns: ['"a, b"', "c"] });
  });

  // An index over an expression is reported as that expression, and an expression may take several
  // arguments — so the same comma problem arrives without any quoting at all.
  it("keeps the commas inside a multi-argument expression", async () => {
    const error = await violate([
      `create table probe_args (id int primary key, email text)`,
      `create unique index probe_args_uq on probe_args (replace(email, 'x'::text, 'y'::text))`,
      `insert into probe_args values (1, 'axb')`,
      `insert into probe_args values (2, 'ayb')`,
    ]);
    expect(constraintTarget(error)).toEqual({
      table: "probe_args",
      columns: ["replace(email, 'x'::text, 'y'::text)"],
    });
  });

  // `)=(` is what separates the key from the value, and a quoted identifier may contain it.
  it("does not mistake a quoted identifier for the key-value boundary", async () => {
    const error = await violate([
      `create table probe_boundary ("a)=(b" int, constraint probe_boundary_uq unique ("a)=(b"))`,
      `insert into probe_boundary values (1)`,
      `insert into probe_boundary values (1)`,
    ]);
    expect(constraintTarget(error)).toEqual({
      table: "probe_boundary",
      columns: ['"a)=(b"'],
    });
  });

  // The module's doc groups the primary key with the unique constraint. It is the same `23505` and
  // the same detail shape, but "same" is what this case is here to show rather than assume.
  it("names the key of a primary-key collision", async () => {
    const error = await violate([
      `create table probe_pk (id int primary key)`,
      `insert into probe_pk values (1)`,
      `insert into probe_pk values (1)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_pk", columns: ["id"] });
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

  // A SQL literal inside an expression can hold a parenthesis, so the scanner has to know it is
  // inside one. The alternative counts that `)` against the nesting depth and stops early.
  it("keeps a parenthesis that is inside a SQL literal", async () => {
    const error = await violate([
      `create table probe_lit (id int primary key, email text)`,
      `create unique index probe_lit_uq on probe_lit (replace(email, ')'::text, 'z'::text))`,
      `insert into probe_lit values (1, 'a)b')`,
      `insert into probe_lit values (2, 'azb')`,
    ]);
    const target = constraintTarget(error);
    expect(target?.table).toBe("probe_lit");
    expect(target?.columns).toHaveLength(1);
    expect(target?.columns[0]).toContain("replace(email,");
  });

  it("asks refusalOn both questions at once", async () => {
    const error = await violate([
      `create table probe_both (a int, b int, constraint probe_both_uq unique (a, b))`,
      `insert into probe_both values (1, 2)`,
      `insert into probe_both values (1, 2)`,
    ]);
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "probe_both", columns: ["a", "b"] })).toBe(
      true,
    );
    // Right key, wrong class.
    expect(
      refusalOn(error, FOREIGN_KEY_VIOLATION, { table: "probe_both", columns: ["a", "b"] }),
    ).toBe(false);
    // Right class, wrong key — a sibling constraint on the same table is exactly what the target
    // half exists to rule out.
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "probe_both", columns: ["a"] })).toBe(false);
  });

  // `detail` is a MESSAGE, and a message has a language — which `.constraint`, the structured field
  // this parser replaced, did not. So the English prefix the parser anchors on is a dependency, and
  // this is the guard on it rather than a sentence claiming it is safe. Measured 2026-09-21 on the
  // image the suites and `deploy/compose.yml` both run: `set lc_messages` to a Spanish locale is
  // ACCEPTED and the refusal comes back in English anyway. Swap in an image that carries locale
  // data and this test is what says so. PGlite has no session locale to set, hence postgres only.
  it.runIf(target.name === "postgres")("still reads a refusal asked for in Spanish", async () => {
    const error = await violate([
      `set lc_messages = 'es_ES.UTF-8'`,
      `create table probe_locale (email text, constraint probe_locale_uq unique (email))`,
      `insert into probe_locale values ('a@x')`,
      `insert into probe_locale values ('a@x')`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_locale", columns: ["email"] });
  });

  it("returns undefined for a CHECK violation, which names no key", async () => {
    const error = await violate([
      `create table probe_chk (n int, constraint probe_chk_pos check (n > 0))`,
      `insert into probe_chk values (-1)`,
    ]);
    // The `detail` has to be PRESENT for this case to test anything: without the first assertion a
    // refusal carrying no `detail` at all would satisfy the second, and the two situations the
    // parser must tell apart would look alike.
    expect((error as { cause?: { detail?: string } }).cause?.detail).toMatch(/^Failing row/);
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

  // No database can produce this: the SQLSTATE on one layer and the key on another. It is the one
  // shape that separates refusalOn's same-layer rule from asking the two questions separately.
  it("refusalOn does not join a code on one layer to a key on another", () => {
    const split = new Error("outer", {
      cause: Object.assign(new Error("code only"), {
        code: "23505",
        cause: violation,
      }),
    });
    expect(refusalOn(split, "23505", { table: "people", columns: ["email"] })).toBe(false);
    // …while the two questions asked separately DO join them, which is the difference.
    expect(sameTarget(constraintTarget(split), { table: "people", columns: ["email"] })).toBe(true);
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

  // PostgreSQL cannot write this, so it has to be crafted: an empty key is not a key.
  it("treats an empty key as no key at all", () => {
    expect(
      constraintTarget(
        Object.assign(new Error("dup"), { table: "people", detail: "Key ()=() already exists." }),
      ),
    ).toBeUndefined();
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
