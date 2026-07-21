import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";

/*
 * The pattern is proved against a table this task owns outright, created and
 * protected here in one statement sequence.
 *
 * Deliberately NOT `sales`. That table belongs to Task 8, which applies this
 * same pattern in the migration that creates it; testing the pattern through
 * `sales` would mean this task and that one both owning the same schema, and
 * an earlier draft of this plan did exactly that — two CREATE TABLE statements
 * for one table across two migrations. A dedicated probe also keeps this file
 * honest: it fails when the PATTERN is wrong, not when a sale column changes.
 *
 * Created per test rather than by a migration, because it is scaffolding for
 * the proof rather than part of the product schema.
 */
async function createProtectedProbe(db: Database): Promise<void> {
  await db.execute(sql`
    create table immutability_probe (
      id uuid primary key,
      tenant_id uuid not null,
      note text not null
    )
  `);
  // Parts 1-3 of the recipe. Part 4 (RLS) is Task 4's concern and is exercised
  // there; what is under test here is immutability, not isolation.
  await db.execute(sql`revoke update, delete, truncate on immutability_probe from app_user`);
  await db.execute(sql`grant select, insert on immutability_probe to app_user`);
  await db.execute(sql`
    create trigger immutability_probe_immutable
      before update or delete on immutability_probe
      for each row execute function reject_mutation()
  `);
  await db.execute(sql`
    create trigger immutability_probe_no_truncate
      before truncate on immutability_probe
      for each statement execute function reject_mutation()
  `);
}

describeEachTarget("immutability", (target) => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const rowId = "22222222-2222-4222-8222-222222222222";
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await createProtectedProbe(db);
    await db.execute(
      sql`insert into immutability_probe (id, tenant_id, note)
          values (${rowId}, ${tenantId}, 'original')`,
    );
  });

  // This package's convention (see tenancy.test.ts): without it, a pg Pool
  // per test is left open when the postgres target's container stops at
  // describe-level teardown, and it surfaces as an unhandled FATAL 57P01
  // rejection rather than a test failure.
  afterEach(async () => {
    await db.close();
  });

  it("permits SELECT and INSERT from the application role", async () => {
    // The control that stops every other test in this file from passing for
    // the wrong reason. Revoking ALL privileges would satisfy the rejection
    // tests; only this one notices.
    const inserted = "33333333-3333-4333-8333-333333333333";

    await db.transaction(async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`insert into immutability_probe (id, tenant_id, note)
            values (${inserted}, ${tenantId}, 'appended')`,
      );
    });

    const result = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.execute(sql`select id from immutability_probe where id = ${inserted}`);
    });
    expect(result.rows).toHaveLength(1);
  });

  it("rejects an UPDATE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`);
      }),
    );

    // 42501 insufficient_privilege. The role was never granted UPDATE, so the
    // statement is refused before any row is examined and before any trigger
    // could fire. This is the control.
    expect(pgErrorCode(error)).toBe("42501");
    expect(pgErrorMessage(error)).toMatch(/permission denied/i);
  });

  it("rejects a DELETE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`delete from immutability_probe where id = ${rowId}`);
      }),
    );

    expect(pgErrorCode(error)).toBe("42501");
    expect(pgErrorMessage(error)).toMatch(/permission denied/i);
  });

  it("rejects an UPDATE from the table owner on trigger grounds", async () => {
    // The owner has every privilege, so the second, independent reason is the
    // only thing left. Run as owner deliberately — this is the ONE place in
    // the suite where the role must NOT be switched, because the owner is the
    // actor whose behaviour is under test.
    const error = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(/append-only/);
  });

  it("rejects a DELETE from the table owner on trigger grounds", async () => {
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
  });

  it("rejects a TRUNCATE from the table owner", async () => {
    // The hole this test exists for: a FOR EACH ROW trigger does not fire on
    // TRUNCATE, so without the statement-level trigger the owner empties the
    // table with no error at all.
    const error = await captureError(() => db.execute(sql`truncate table immutability_probe`));

    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(/TRUNCATE is not permitted/);

    // TRUNCATE is transactional in Postgres, so a rolled-back one leaves no
    // trace — but this one never committed anything to roll back. Read the
    // rows to prove the rejection was real rather than a message on the way
    // out.
    const result = await db.execute(sql`select id from immutability_probe`);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("rejects a TRUNCATE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`truncate table immutability_probe`);
      }),
    );

    expect(pgErrorCode(error)).toBe("42501");
    expect(pgErrorMessage(error)).toMatch(/permission denied/i);
  });

  it("names the offending table in the rejection", async () => {
    // reject_mutation() is shared by every protected table in the package, so
    // it reports TG_TABLE_NAME rather than a literal. A hardcoded name here
    // would be invisible until the second table adopted the pattern and
    // started blaming the first one for its own rejections.
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );
    expect(pgErrorMessage(error)).toMatch(/immutability_probe is append-only/);
  });

  it("reports the operation that was attempted", async () => {
    // TG_OP, not a fixed string: an incident report saying "UPDATE" when
    // someone ran TRUNCATE sends the reader after the wrong actor.
    const update = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'x' where id = ${rowId}`),
    );
    expect(pgErrorMessage(update)).toMatch(/UPDATE is not permitted/);

    const truncate = await captureError(() => db.execute(sql`truncate table immutability_probe`));
    expect(pgErrorMessage(truncate)).toMatch(/TRUNCATE is not permitted/);
  });

  /*
   * Part 4 of the recipe (immutability.sql.md) requires ENABLE ROW LEVEL
   * SECURITY to already be in effect before FORCE and CREATE POLICY do
   * anything — omit it and both still succeed with no error, and a policy
   * that looks correctly wired sits there silently inert while a second
   * tenant's row leaks straight through a SELECT. This codebase gets ENABLE
   * for free from `.enableRLS()` on a Drizzle table definition
   * (schema/tenants.ts), but a hand-written `--custom` migration — like this
   * task's own 0002_immutability.sql — has no Drizzle definition to draw it
   * from and must issue it itself. Tasks 6, 7, 8 and 12 each reproduce this
   * recipe (or, for Task 7, just its RLS half) in their own migrations; this
   * guard exists so a missing ENABLE fails a named test instead of shipping
   * a silent cross-tenant leak.
   *
   * A fresh db from `target.create()`, not the outer `db`/`immutability_probe`
   * fixture: that fixture deliberately applies only parts 1-3 of the recipe
   * (see createProtectedProbe's comment — RLS is out of scope for the
   * immutability tests above), so checking it here would fail for a reason
   * this file already accounts for elsewhere, not for the reason this guard
   * exists.
   */
  describe("row-level security on every table carrying the immutability triggers", () => {
    let rlsDb: Database;

    beforeEach(async () => {
      rlsDb = await target.create();
    });

    afterEach(async () => {
      await rlsDb.close();
    });

    /**
     * Auto-discovery, the same principle as the English-only guard
     * (english-only.ts's `sourceFilesIn`): rather than hand-listing tables,
     * ask Postgres which tables actually carry a trigger executing
     * `reject_mutation()`. A table qualifies for this check by having the
     * trigger, not by being named in this file, so a table Task 6, 8 or a
     * later migration in this package adds is covered automatically, with no
     * line here to remember to update.
     */
    async function tablesWithImmutabilityTriggers(): Promise<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    > {
      const result = await rlsDb.execute<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(sql`
        select distinct c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p on p.oid = t.tgfoid
        where p.proname = 'reject_mutation'
          and not t.tgisinternal
        order by c.relname
      `);
      return result.rows;
    }

    it("requires ENABLE and FORCE ROW LEVEL SECURITY, checked against a table built with the full corrected recipe", async () => {
      // All four parts of immutability.sql.md, verbatim, including the
      // ENABLE Part 4 originally omitted — this proves the corrected recipe
      // is internally consistent, not merely that the discovery query below
      // can run.
      await rlsDb.execute(sql`
        create table immutability_rls_probe (
          id uuid primary key,
          tenant_id uuid not null,
          note text not null
        )
      `);
      await rlsDb.execute(
        sql`revoke update, delete, truncate on immutability_rls_probe from app_user`,
      );
      await rlsDb.execute(sql`grant select, insert on immutability_rls_probe to app_user`);
      await rlsDb.execute(sql`
        create trigger immutability_rls_probe_immutable
          before update or delete on immutability_rls_probe
          for each row execute function reject_mutation()
      `);
      await rlsDb.execute(sql`
        create trigger immutability_rls_probe_no_truncate
          before truncate on immutability_rls_probe
          for each statement execute function reject_mutation()
      `);
      await rlsDb.execute(sql`alter table immutability_rls_probe enable row level security`);
      await rlsDb.execute(sql`alter table immutability_rls_probe force row level security`);
      await rlsDb.execute(sql`
        create policy immutability_rls_probe_tenant_isolation on immutability_rls_probe
          for all
          using (tenant_id = current_tenant_id())
          with check (tenant_id = current_tenant_id())
      `);

      const tables = await tablesWithImmutabilityTriggers();
      // A guard that discovers nothing passes every assertion below it — this
      // is the assertion that stops that (same shape as english-only.test.ts's
      // "discovers source files in every generic package that exists on
      // disk").
      expect(tables.map((t) => t.relname)).toContain("immutability_rls_probe");

      // Reported as formatted lines rather than a bare boolean, for the same
      // reason english-only.test.ts's violations are: a failure needs to say
      // WHICH table is missing WHICH flag, or the next person deletes the
      // test instead of fixing the migration.
      const nonCompliant = tables
        .filter((t) => !t.relrowsecurity || !t.relforcerowsecurity)
        .map(
          (t) =>
            `${t.relname}: relrowsecurity=${String(t.relrowsecurity)} ` +
            `relforcerowsecurity=${String(t.relforcerowsecurity)}`,
        );
      expect(nonCompliant).toEqual([]);
    });
  });
});
