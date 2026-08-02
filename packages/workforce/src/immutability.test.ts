import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { startRealPostgres } from "./testing/postgres.js";
import { insertTimeEntry, seedLocation, seedPerson } from "../test/fixtures.js";

// REAL Postgres, not PGlite: the append-only floor lives in the app role's PRIVILEGE set, and
// PGlite runs every connection as a superuser. The whole proof rests on running as `app_user`, which
// the first test below pins down — a suite that forgot the role switch would pass green while
// asserting nothing (CLAUDE.md §4, and the inmutabilidad.test.ts this mirrors).
const suite = useRealPostgres({ start: startRealPostgres });

let ctx: { tenantId: string; personId: string; locationId: string };

beforeAll(async () => {
  const tenantId = await seedTenant(suite.admin);
  const locationId = await seedLocation(suite.admin, tenantId);
  const personId = await seedPerson(suite.admin, tenantId);
  ctx = { tenantId, personId, locationId };
});

/** Runs `fn` inside a tenant transaction, downgraded to the non-owner application role. */
async function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, ctx.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

class RollbackSignal extends Error {}

describe("time_entries is immutable, as the app role", () => {
  it("is actually running as the non-owner application role", async () => {
    // Without this the whole file is theatre. pg_roles, not pg_user: app_user is created NOLOGIN, so
    // a pg_user lookup returns zero rows and reads back NULL, passing a truthiness check for the
    // wrong reason. A strict `.toBe(false)` distinguishes "confirmed not super" from "role missing".
    const who = await asApp(async (tx) => {
      const result = await tx.execute<{ u: string; s: boolean }>(
        sql`select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as s`,
      );
      return result.rows[0];
    });
    expect(who?.u).toBe("app_user");
    expect(who?.s).toBe(false);
  });

  it("permits INSERT", async () => {
    // The control. Without it, the rejection tests below would all pass against a role with no access
    // to the table at all, proving nothing about immutability — and it also proves the
    // GENERATED-ALWAYS-AS-IDENTITY `ingest_seq` needs no separate sequence grant for an INSERT-only
    // role.
    await expect(asApp((tx) => insertTimeEntry(tx, ctx))).resolves.toBeUndefined();
  });

  it("rejects UPDATE with insufficient_privilege", async () => {
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertTimeEntry(tx, ctx);
        await tx.execute(sql`update time_entries set event_offset_minutes = 0`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects DELETE with insufficient_privilege", async () => {
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertTimeEntry(tx, ctx);
        await tx.execute(sql`delete from time_entries`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects UPDATE by trigger even when the privilege is granted", async () => {
    // The layered proof. Revocation fires first, so the two tests above never reach the trigger — and
    // a trigger nobody has ever seen fire is a comment, not a backstop. Grant the privilege inside a
    // transaction that rolls back (which undoes the grant too), and watch the second layer catch it.
    await withTenant(suite.admin, ctx.tenantId, async (tx) => {
      await tx.execute(sql`grant update, delete on time_entries to app_user`);
      await tx.execute(sql`set local role app_user`);
      await insertTimeEntry(tx, ctx);
      const error = await captureError(() =>
        tx.execute(sql`update time_entries set event_offset_minutes = 0`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("rejects TRUNCATE by statement trigger", async () => {
    // A row trigger does NOT fire on TRUNCATE. Nothing references time_entries.id in Slice 2, so a
    // bare TRUNCATE (no CASCADE) is enough; the statement trigger is what stops it.
    await withTenant(suite.admin, ctx.tenantId, async (tx) => {
      await tx.execute(sql`grant truncate on time_entries to app_user`);
      await tx.execute(sql`set local role app_user`);
      const error = await captureError(() => tx.execute(sql`truncate time_entries`));
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });
});

describe("row-level security is enabled AND forced on the new tenant-scoped tables", () => {
  it("has relrowsecurity and relforcerowsecurity on employments and time_entries", async () => {
    // ENABLE alone (drizzle's .enableRLS(), migration 0002) leaves the owner and every superuser
    // exempt; FORCE (the hand-written 0003) is what binds the deployment role. Deleting either 0003
    // FORCE line drops relforcerowsecurity to false and fails this.
    const result = await suite.admin.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in ('employments', 'time_entries')
      order by relname`);
    expect(result.rows).toEqual([
      { relname: "employments", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "time_entries", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
