import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { locations, tenants } from "./schema/tenants.js";
import { withTenant } from "./tenancy.js";
import { pgErrorMessage } from "./testing/errors.js";
import { usePgliteDb } from "./testing/lifecycle.js";
import { CORE_MIGRATIONS } from "./migrations.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from locations`);
  await suite.db.execute(sql`delete from tenants`);
});

/** Match the underlying PostgreSQL error, not Drizzle's SQL wrapper message. */
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

describe("invoice_locales", () => {
  const tenantId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await db
      .insert(tenants)
      .values({ id: tenantId, country: "ES", taxId: "B44444447", legalName: "Bar Gamma SL" });
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

describe("withTenant transaction context", () => {
  const tenantId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("sets no app.tenant_id GUC — the database holds one tenant (spec §1)", async () => {
    await withTenant(db, tenantId, async (tx) => {
      const { rows } = await tx.execute<{ v: string }>(
        sql`select current_setting('app.tenant_id', true) as v`,
      );
      expect(rows[0]?.v ?? "").toBe("");
    });
  });
});
