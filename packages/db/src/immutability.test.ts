import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAppendOnlyTriggers } from "@waitron/store";
import type { Database } from "./client.js";
import { refusalCode, triggerRaised } from "./constraint-target.js";
import { captureError } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";
import { CORE_MIGRATIONS } from "./migrations.js";

/*
 * LOSS, from the storage swap, and it is a DDL loss rather than a DML one.
 *
 * PostgreSQL protected an append-only table twice over: the `reject_mutation()` trigger, which
 * refused the owner as well as anyone else, and a `REVOKE` that made the application role a
 * NON-OWNER. Only the trigger has an equivalent here. SQLite has no roles and no grants — one
 * process opens one file — so every connection is the owner-equivalent, and the DDL the ownership
 * check used to close is open to every caller. Measured through `useVenueDb` on a table this
 * file's own helper had just protected, one statement per line:
 *
 *   drop trigger probe_guarded_append_only_update => SUCCEEDED
 *   the next UPDATE                               => SUCCEEDED, row read back 'tampered'
 *   drop table sales                              => SUCCEEDED, table and triggers both gone
 *
 * and the same two statements as `app_user` against the PostgreSQL shape this replaces, reproduced
 * on PGlite 0.5.8 with an owner-created trigger-protected table and `revoke update, delete,
 * truncate … from app_user`:
 *
 *   update       => REFUSED 42501 "permission denied for table ledger_probe"
 *   drop trigger => REFUSED 42501 "must be owner of relation ledger_probe"
 *   drop table   => REFUSED 42501 "must be owner of table ledger_probe"
 *
 * None of the cases below ever covered that path — this file ran as the owner deliberately, and
 * the owner could always drop a trigger on PostgreSQL too (measured in the same run: DROP TRIGGER
 * SUCCEEDED as owner). So nothing here got weaker. What got weaker is the application's own
 * connection, and replacing it is not a test's job: it needs a control outside the engine, since
 * the engine no longer has one.
 */

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/*
 * The pattern is proved against tables this file owns outright, created and protected here.
 *
 * Deliberately NOT `sales`, though `sales` now carries the same triggers: a dedicated probe keeps
 * this file honest, because it fails when the PATTERN is wrong rather than when a sale column
 * changes. A SECOND probe exists so that "the rejection names the offending table" is checkable —
 * with one table every wrong answer and the right answer read alike.
 *
 * Created per test rather than by a migration, because it is scaffolding for the proof rather than
 * part of the product schema.
 */
const PROBE = "immutability_probe";
const OTHER_PROBE = "immutability_other_probe";

/** What `installAppendOnlyTriggers` raises. A trigger's refusal has no other identity: the result
 * code is shared with `ON DELETE RESTRICT`, so the words are the whole of it. */
const refusalFor = (table: string): string => `${table} is append-only`;

/**
 * The product's own installer, not hand-written trigger SQL.
 *
 * The version of this file that stood here wrote its `create trigger` statements out, which was
 * right when each migration carried them; the pattern's one home is now
 * `installAppendOnlyTriggers` (`packages/store/src/append-only.ts`), driven per migration set by
 * `applyMigrations` and by this suite's own helper. Writing the triggers again here would prove a
 * shape nothing in the product runs.
 */
async function createProtectedProbe(db: Database, table: string): Promise<void> {
  await db.execute(sql.raw(`create table ${table} (id text primary key, note text not null)`));
  installAppendOnlyTriggers(db, [table]);
}

/** The probe's rows, for the read-back that turns "it threw" into "the row is still the row that
 * was written" — the only form of the claim append-only actually makes. */
async function notes(db: Database, table: string): Promise<string[]> {
  const result = await db.execute<{ note: string }>(
    sql.raw(`select note from ${table} order by id`),
  );
  return result.rows.map((row) => row.note);
}

describe("immutability", () => {
  const rowId = "22222222-2222-4222-8222-222222222222";
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await createProtectedProbe(db, PROBE);
    await db.execute(sql.raw(`insert into ${PROBE} (id, note) values ('${rowId}', 'original')`));
  });

  // The child goes first: its parent is referenced, and dropping a referenced table runs the
  // implicit delete that `pragma foreign_keys = on` then refuses.
  afterEach(async () => {
    for (const table of [
      "immutability_restrict_child",
      "immutability_restrict_parent",
      OTHER_PROBE,
      PROBE,
    ]) {
      await db.execute(sql.raw(`drop table if exists ${table}`));
    }
  });

  it("rejects an UPDATE on trigger grounds", async () => {
    const error = await captureError(async () =>
      db.execute(sql.raw(`update ${PROBE} set note = 'tampered' where id = '${rowId}'`)),
    );

    expect(triggerRaised(error, refusalFor(PROBE))).toBe(true);
    expect(await notes(db, PROBE)).toEqual(["original"]);
  });

  it("rejects a DELETE on trigger grounds", async () => {
    const error = await captureError(async () =>
      db.execute(sql.raw(`delete from ${PROBE} where id = '${rowId}'`)),
    );

    expect(triggerRaised(error, refusalFor(PROBE))).toBe(true);
    expect(await notes(db, PROBE)).toEqual(["original"]);
  });

  it("rejects the statement that empties the table in one go", async () => {
    /*
     * The successor to this file's TRUNCATE case, and the mechanism is not the same one.
     *
     * On PostgreSQL a FOR EACH ROW trigger does not fire on TRUNCATE, so a second, STATEMENT-level
     * trigger existed purely to stop the owner emptying the table with no error at all. SQLite has
     * no TRUNCATE statement, and asserting that it refuses one would measure nothing: `truncate
     * table <t>` is `errcode 1, near "truncate": syntax error` on a protected table and on an
     * unprotected one alike — the same two answers, which is CLAUDE.md §1's "a measurement taken
     * where both answers look alike".
     *
     * What DOES empty a table here is a `DELETE` with no `WHERE`, and the row trigger — the only
     * kind SQLite has — fires once per row, so the hole the statement trigger existed for does not
     * open. Measured, with an identical table carrying no triggers as the control: refused 1811 on
     * the protected table, `changes: 1` and the rows gone on the control.
     *
     * The residual hole is `DROP TABLE`, which succeeds; see this file's header.
     */
    await db.execute(sql.raw(`insert into ${PROBE} (id, note) values ('second-row', 'original')`));

    const error = await captureError(async () => db.execute(sql.raw(`delete from ${PROBE}`)));

    expect(triggerRaised(error, refusalFor(PROBE))).toBe(true);
    expect(await notes(db, PROBE)).toEqual(["original", "original"]);
  });

  it("names the offending table in the rejection", async () => {
    // One installer serves every protected table in the tree, so it reports the name it was given
    // rather than a literal. A single-table check could not see it blaming the wrong one: the
    // second probe is what makes the claim checkable.
    await createProtectedProbe(db, OTHER_PROBE);
    await db.execute(sql.raw(`insert into ${OTHER_PROBE} (id, note) values ('x', 'original')`));

    const error = await captureError(async () => db.execute(sql.raw(`delete from ${OTHER_PROBE}`)));

    expect(triggerRaised(error, refusalFor(OTHER_PROBE))).toBe(true);
    expect(triggerRaised(error, refusalFor(PROBE))).toBe(false);
  });

  it("is not confusable with the engine's own refusal under the same result code", async () => {
    /*
     * LOSS, and the replacement for this file's TG_OP case.
     *
     * PostgreSQL's message named the operation — `… is append-only: UPDATE is not permitted` — so
     * an incident report could not send a reader after the wrong actor.
     * `installAppendOnlyTriggers` raises the same words for an update and a delete alike; the
     * operation now survives only in the trigger's NAME, and nothing reports that to a caller. The
     * wording is owned by `packages/store/src/append-only.ts` and pinned by suites across the tree,
     * so it is recorded here rather than changed here.
     *
     * The discriminating property that DID survive is the one worth a case, because it is the same
     * risk one layer down: result code 1811 is `SQLITE_CONSTRAINT_TRIGGER`, and SQLite implements
     * `ON DELETE RESTRICT` with an internal trigger, so a restricted delete arrives under the
     * append-only refusal's exact code (`./sql-state.ts`). A reader who matched on the code alone
     * would read one as the other. The RESTRICT refusal below is the control: same class, and
     * `triggerRaised` must still say no.
     */
    await db.execute(sql.raw(`create table immutability_restrict_parent (id text primary key)`));
    await db.execute(
      sql.raw(
        `create table immutability_restrict_child (
           id text primary key,
           parent text not null references immutability_restrict_parent(id) on delete restrict
         )`,
      ),
    );
    await db.execute(sql.raw(`insert into immutability_restrict_parent (id) values ('p')`));
    await db.execute(
      sql.raw(`insert into immutability_restrict_child (id, parent) values ('c','p')`),
    );

    const appendOnly = await captureError(async () => db.execute(sql.raw(`delete from ${PROBE}`)));
    const restricted = await captureError(async () =>
      db.execute(sql.raw(`delete from immutability_restrict_parent`)),
    );

    expect(refusalCode(restricted)).toBe(refusalCode(appendOnly));
    expect(triggerRaised(appendOnly, refusalFor(PROBE))).toBe(true);
    expect(triggerRaised(restricted, refusalFor(PROBE))).toBe(false);
    expect(triggerRaised(restricted, "immutability_restrict_parent is append-only")).toBe(false);
  });

  it("rejects an INSERT that silently replaces the row already there", async () => {
    /*
     * The one shape only THIS file can see, and the reason it is not a copy of
     * `packages/store/src/append-only.test.ts`.
     *
     * `INSERT OR REPLACE` performs an internal delete, and a `BEFORE DELETE` trigger fires on it
     * only when `pragma recursive_triggers` is on. Without the pragma the row is rewritten with no
     * error at all — the exact shape of the TRUNCATE hole this file used to guard. The store
     * suite sets that pragma on the connection it builds, so it proves the triggers and cannot see
     * the pragma missing; this suite's database comes from the product's own opener
     * (`useVenueDb` → `openVenueDatabase` → `openVenueStore`), which is where the pragma has to be
     * for a real box to be protected.
     */
    const error = await captureError(async () =>
      db.execute(
        sql.raw(`insert or replace into ${PROBE} (id, note) values ('${rowId}', 'replaced')`),
      ),
    );

    expect(triggerRaised(error, refusalFor(PROBE))).toBe(true);
    expect(await notes(db, PROBE)).toEqual(["original"]);
  });
});
