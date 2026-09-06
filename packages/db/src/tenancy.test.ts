import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "./client.js";
import { locations, tenants } from "./schema/tenants.js";
import { withTenant } from "./tenancy.js";
import { pgErrorMessage } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";

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

describeEachTarget("invoice_locales", (target) => {
  const tenantId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db
      .insert(tenants)
      .values({ id: tenantId, country: "ES", taxId: "B44444447", legalName: "Bar Gamma SL" });
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
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

describeEachTarget("app.node_id origin context", (target) => {
  const tenantId = randomUUID();
  const nodeId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  const nodeSetting = (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ): Promise<string | null> =>
    tx
      .execute<{ v: string | null }>(sql`select current_setting('app.node_id', true) as v`)
      .then((r) => r.rows[0]?.v ?? null);

  it("no longer sets app.tenant_id — the database holds one tenant (spec §1)", async () => {
    await withTenant(db, tenantId, async (tx) => {
      const { rows } = await tx.execute<{ v: string }>(
        sql`select current_setting('app.tenant_id', true) as v`,
      );
      expect(rows[0]?.v ?? "").toBe("");
    });
  });

  it("still sets app.node_id when asked (the capture triggers read it until step 4)", async () => {
    await withTenant(
      db,
      tenantId,
      async (tx) => {
        const { rows } = await tx.execute<{ v: string }>(
          sql`select current_setting('app.node_id', true) as v`,
        );
        expect(rows[0]?.v).toBe(nodeId);
      },
      { nodeId },
    );
  });

  it("sets app.node_id to the supplied node id within the transaction (4-arg form)", async () => {
    const seen = await withTenant(db, tenantId, (tx) => nodeSetting(tx), { nodeId });
    expect(seen).toBe(nodeId);
  });

  it("leaves app.node_id unset on the plain 3-arg form (default path byte-unchanged)", async () => {
    // Proves the existing signature is untouched: no app.node_id is set, so capture falls back to the
    // all-zero origin. current_setting(..., true) is NULL when never set (or '' once a local set has
    // been restored at txn end); it is NEVER the node id.
    const seen = await withTenant(db, tenantId, (tx) => nodeSetting(tx));
    expect(seen === null || seen === "").toBe(true);
    expect(seen).not.toBe(nodeId);
  });

  it("does not leak app.node_id to a later transaction on the same connection", async () => {
    // The node setting must be cleared when the transaction ends.
    const within = await withTenant(db, tenantId, (tx) => nodeSetting(tx), { nodeId });
    expect(within).toBe(nodeId);

    const after = await db.transaction((tx) => nodeSetting(tx));
    expect(after === null || after === "").toBe(true);
    expect(after).not.toBe(nodeId);
  });
});
