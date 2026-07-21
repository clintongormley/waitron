import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "./client.js";
import { locations, tenants, tills } from "./schema/tenants.js";
import { pgErrorMessage } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";
import { withTenant } from "./tenancy.js";

/**
 * Matches the underlying Postgres error message, not the wrapper's.
 *
 * drizzle-orm@0.45.2 wraps every failed query in a `DrizzleQueryError` whose
 * own `.message` is `Failed query: <sql>\nparams: <params>` — the actual
 * Postgres text (`new row violates row-level security policy...`, `violates
 * check constraint "locations_invoice_locales_len"`) lives on `.cause`, not on
 * `.message`. `expect(...).rejects.toThrow(/pattern/)` inspects `.message`
 * only (verified against chai's `throws`), so it cannot tell "insert failed
 * for the expected reason" apart from "insert failed for any reason at all,
 * or didn't fail" — it would pass equally against a stripped-down policy that
 * throws some other error. This is what actually reads the reason.
 *
 * The extraction itself is `testing/errors.ts`'s `pgErrorMessage` (Task 5),
 * not a private copy of the same `.cause` unwrapping carried in this file —
 * two independent implementations of ".cause extraction" in one package is
 * how a later task ends up copying the wrong one. `pgErrorMessage` itself
 * throws rather than falling back to `String(error)` when neither
 * `.cause.message` nor `.message` is a string, which is this helper's own
 * load-bearing property: `String(err)` on a `DrizzleQueryError` reproduces
 * the exact `Failed query: <sql>` text this helper exists to bypass, so a
 * silent fallback would let a pattern that happens to match the SQL text
 * (e.g. a table or column name) pass for the wrong reason. `expect(cause
 * instanceof Error)` below still runs first, so a rejection with no usable
 * cause fails the assertion immediately rather than reaching
 * `pgErrorMessage` at all.
 */
async function rejectsWithCauseMatching(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await promise.then(
    () => {
      throw new Error("expected promise to reject, but it resolved");
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(pgErrorMessage(err)).toMatch(pattern);
    },
  );
}

describeEachTarget("tenant isolation", (target) => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    // Seeded as the migration owner, deliberately: provisioning is an admin
    // action and RLS must not be able to prevent it. Two tenants, because a
    // single-tenant fixture cannot distinguish RLS from an absent predicate.
    await db.insert(tenants).values([
      { id: tenantA, nif: "B12345674", legalName: "Bar Alfa SL" },
      { id: tenantB, nif: "B87654328", legalName: "Bar Beta SL" },
    ]);
    await db.insert(locations).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        name: "Alfa Centre",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Servicios de restauración",
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        name: "Beta Port",
        invoiceLocales: ["es"],
        operationDescription: "Servicios de restauración",
      },
    ]);
  });

  // Closed here rather than left to teardown: harness.ts's own
  // Target.create() consumer (harness.test.ts) does the same. Without it, a
  // pg Pool per test is left open when the postgres target's container stops
  // at describe-level teardown, and the pool surfaces that as an unhandled
  // "FATAL: terminating connection due to administrator command" rejection
  // rather than a test failure.
  afterEach(async () => {
    await db.close();
  });

  it("returns only the calling tenant's locations", async () => {
    // No WHERE clause anywhere in this query. That is the whole point: if the
    // test scoped the read itself it would pass with RLS switched off.
    const rows = await withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
  });

  it("returns only the calling tenant's own row from tenants", async () => {
    const rows = await withTenant(db, tenantB, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(tenants);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tenantB);
  });

  it("rejects an insert carrying another tenant's id", async () => {
    // WITH CHECK, not USING. Without it a tenant could write rows into a
    // neighbour's data and simply never see them again.
    const attempt = withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tills).values({
        tenantId: tenantB,
        locationId: randomUUID(),
        name: "smuggled",
      });
    });

    await rejectsWithCauseMatching(attempt, /row-level security/i);
  });

  it("inserts a row for the calling tenant as app_user, and it lands", async () => {
    // The positive counterpart to the rejection above. Every other write
    // assertion in this file is a rejection, so a missing or over-narrow
    // GRANT (e.g. no GRANT INSERT on locations) would look identical to
    // correct policy enforcement — every rejection test would still pass.
    // This is the one test that fails if app_user cannot write at all.
    const id = randomUUID();

    await withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      await tx.insert(locations).values({
        id,
        tenantId: tenantA,
        name: "Alfa Kiosk",
        invoiceLocales: ["es"],
        operationDescription: "Servicios de restauración",
      });
    });

    // Read back as the migration owner (superuser, bypasses RLS), so this
    // assertion is a pure check on the GRANT/insert path, not a second
    // read-side RLS check duplicating "returns only the calling tenant's
    // locations".
    const [row] = await db.select().from(locations).where(eq(locations.id, id));
    expect(row?.tenantId).toBe(tenantA);
  });

  it("returns no rows when no tenant has been set", async () => {
    // Fail closed. current_setting(..., true) is NULL when unset, the policy
    // predicate is NULL, and NULL is not TRUE, so nothing matches.
    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);
  });

  it("returns no rows for an SQL injection payload, and the table survives", async () => {
    const payload = "t1' ; drop table docs; --";

    const rows = await withTenant(db, payload, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);

    // The real assertion. A returned [] proves the predicate did not match; it
    // does not prove the payload was never executed. Reading the table back
    // does.
    const survivors = await db.select().from(locations);
    expect(survivors.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no rows for an empty tenant id rather than raising", async () => {
    // A custom GUC set with set_config(..., true) is restored to '' at
    // transaction end, not to unset. Without the NULLIF in current_tenant_id()
    // the next transaction on a pooled connection casts '' and raises 22P02.
    const rows = await withTenant(db, "", async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);
  });

  it("silently ignores SET LOCAL outside a transaction, and then sees nothing", async () => {
    // Pinned deliberately. This is fail-closed but baffling to debug, and the
    // obvious "fix" — dropping the transaction requirement from withTenant —
    // makes tenancy stop working with no error anywhere.
    //
    // The interpolation below is the injection vector this task exists to
    // avoid, shown once, in a test, with a literal we control.
    await db.execute(sql`set local app.tenant_id = ${sql.raw(`'${tenantA}'`)}`);

    const after = await db.execute<{ v: string | null }>(
      sql`select current_setting('app.tenant_id', true) as v`,
    );
    expect(after.rows[0]?.v ?? "").not.toBe(tenantA);

    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });
    expect(rows).toEqual([]);
  });

  it("does not constrain a superuser, even with FORCE ROW LEVEL SECURITY", async () => {
    // Pinned so that nobody "fixes" it. Seeing every tenant's rows here is
    // correct Postgres behaviour, not a broken policy: superusers always
    // bypass RLS. The fix for a test that sees too much is asAppUser, never a
    // change to the policy.
    const rows = await withTenant(db, tenantA, async (tx) => tx.select().from(locations));

    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("does not leak app.tenant_id to a later transaction on the same connection", async () => {
    // Proves set_config's third argument in tenancy.ts (`true`, i.e.
    // transaction-LOCAL) is load-bearing. Deliberately reuses the SAME `db`
    // handle a completed `withTenant` call has already run against — unlike
    // "returns no rows when no tenant has been set" above, which is the
    // FIRST thing to touch a fresh `db` from `target.create()` and so cannot
    // observe anything left over from a prior transaction. A pooled
    // connection (postgres) or the single reused session (pglite) that still
    // carries tenant A's GUC after `withTenant` returns would make this
    // second, tenant-less transaction see tenant A's row.
    const withinTenant = await withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });
    expect(withinTenant).toHaveLength(1);

    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);
  });
});

describeEachTarget("invoice_locales", (target) => {
  const tenantId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.insert(tenants).values({ id: tenantId, nif: "B44444447", legalName: "Bar Gamma SL" });
  });

  afterEach(async () => {
    await db.close();
  });

  const insertLocales = async (invoiceLocales: string[]): Promise<unknown> => {
    return db.insert(locations).values({
      tenantId,
      name: `locales-${invoiceLocales.join("-") || "empty"}`,
      invoiceLocales,
      operationDescription: "Servicios de restauración",
    });
  };

  it("accepts a single locale", async () => {
    await expect(insertLocales(["es"])).resolves.toBeDefined();
  });

  it("accepts two locales and preserves their order", async () => {
    await insertLocales(["ca", "es"]);

    const [row] = await db
      .select()
      .from(locations)
      .where(sql`${locations.name} = 'locales-ca-es'`);

    // ["ca","es"] and ["es","ca"] are different invoices, not the same invoice
    // rendered differently. A set-valued column would lose that distinction.
    expect(row?.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects an empty locale list", async () => {
    // The trap this constraint exists for: array_length('{}', 1) is NULL, and
    // a CHECK whose expression is NULL is SATISFIED, so an array_length-based
    // constraint would accept this row. cardinality('{}') is 0.
    await rejectsWithCauseMatching(insertLocales([]), /locations_invoice_locales_len/);
  });

  it("rejects three locales", async () => {
    await rejectsWithCauseMatching(
      insertLocales(["es", "ca", "en"]),
      /locations_invoice_locales_len/,
    );
  });
});
