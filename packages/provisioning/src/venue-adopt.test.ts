import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { adoptVenue, type AdoptResult, type AdoptVenueRows } from "./venue-adopt.js";

// PGlite's default connection is a SUPERUSER, so it BYPASSES row-level security (ENABLE and FORCE
// alike). That is acceptable here: `adoptVenue`'s inserts run in-test as superuser, and this suite
// exercises the wiring, FK order, idempotency and the designated-id assertion. The role-split apply
// path — the non-superuser OWNER inserting these parent rows under the tenant GUC — is proven by a
// LATER task's real-Postgres e2e (the container end-to-end that runs adopt over the owner
// connection), the same split `venue-apply.test.ts` documents for `applyVenue`.
//
// CORE → IDENTITY → FISCAL, the manifest order (`venue-apply.test.ts:19-21`): the FISCAL set is what
// creates `registro_sif`/`cadenas`/`contadores_instalacion`, which the sibling no-sif suite asserts
// stay empty; loading it here keeps the two suites' schemas identical.
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

/**
 * A minimal mirror bundle: tenant + 1 location + 1 node + 1 till + 2 invoice_series, every id
 * explicit (the primary's real ids, which the mirror inserts VERBATIM). Keys are camelCase to match
 * Drizzle's `$inferInsert` mapping — Task 5's bundle assembler produces these rows via `select()`,
 * so the key shape already matches. Each row supplies exactly the NOT NULL columns without a schema
 * default; the defaulted fiscal/address/mode columns are omitted deliberately.
 */
function makeRows(): { rows: AdoptVenueRows; designated: AdoptResult } {
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const nodeId = randomUUID();
  const tillId = randomUUID();
  const seriesId = randomUUID();
  const rectificativeSeriesId = randomUUID();

  const rows: AdoptVenueRows = {
    // A unique tax_id per fixture — this suite shares one PGlite database across its tests, and
    // `tenants` is UNIQUE on (country, tax_id); the real mirror inserts exactly one primary tenant
    // into a fresh DB, so this collision is a shared-DB test artifact, not an adopt concern.
    tenant: {
      id: tenantId,
      country: "ES",
      taxId: `B${randomUUID().slice(0, 8)}`,
      legalName: "Primary SL",
    },
    locations: [
      {
        id: locationId,
        tenantId,
        name: "Mostrador",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
      },
    ],
    nodes: [{ id: nodeId, tenantId, locationId, name: "Node 1" }],
    tills: [{ id: tillId, tenantId, locationId, name: "Caja 1" }],
    invoiceSeries: [
      { id: seriesId, tenantId, nodeId, code: "A" },
      { id: rectificativeSeriesId, tenantId, nodeId, code: "R", purpose: "rectificative" },
    ],
  };

  const designated: AdoptResult = { tenantId, locationId, tillId, nodeId, seriesId };
  return { rows, designated };
}

describe("adoptVenue", () => {
  it("inserts every parent row verbatim and returns the designated ids", async () => {
    const { rows, designated } = makeRows();

    const result = await adoptVenue(rows, designated, { db: suite.db });
    expect(result).toEqual(designated);

    // Parents exist with the EXACT ids the bundle named.
    const t = await suite.db.execute(sql`select id from tenants where id = ${designated.tenantId}`);
    expect(t.rows).toHaveLength(1);
    const l = await suite.db.execute(
      sql`select id from locations where id = ${designated.locationId}`,
    );
    expect(l.rows).toHaveLength(1);
    const n = await suite.db.execute(sql`select id from nodes where id = ${designated.nodeId}`);
    expect(n.rows).toHaveLength(1);
    const till = await suite.db.execute(sql`select id from tills where id = ${designated.tillId}`);
    expect(till.rows).toHaveLength(1);

    // Both series carried (≥2), and the designated series is one of them.
    const s = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from invoice_series where tenant_id = ${designated.tenantId}`,
    );
    expect(s.rows[0].n).toBe(2);
    const one = await suite.db.execute(
      sql`select id from invoice_series where id = ${designated.seriesId}`,
    );
    expect(one.rows).toHaveLength(1);
  });

  it("is idempotent — a second adopt inserts no duplicates", async () => {
    const { rows, designated } = makeRows();

    await adoptVenue(rows, designated, { db: suite.db });
    await adoptVenue(rows, designated, { db: suite.db }); // ON CONFLICT (id) DO NOTHING

    const l = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from locations where tenant_id = ${designated.tenantId}`,
    );
    expect(l.rows[0].n).toBe(1);
    const s = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from invoice_series where tenant_id = ${designated.tenantId}`,
    );
    expect(s.rows[0].n).toBe(2);
  });

  it("revives an ISO-string created_at (the JSON round-trip shape) into a Date the insert accepts", async () => {
    // Bundle timestamps arrive as ISO strings. Drizzle's date-mode inserts need Dates, so
    // schema-driven revival covers created_at on tenants, nodes and tills, plus retired_at on
    // invoice_series. Locations has no date column and passes through unchanged.
    const { rows, designated } = makeRows();
    const stamp = "2026-01-02T03:04:05.000Z";
    rows.tenant.createdAt = stamp;
    rows.nodes[0]!.createdAt = stamp;
    rows.tills[0]!.createdAt = stamp;
    rows.invoiceSeries[0]!.retiredAt = stamp;

    await expect(
      adoptVenue(JSON.parse(JSON.stringify(rows)) as typeof rows, designated, { db: suite.db }),
    ).resolves.toEqual(designated);
    // The three created_at values, each read back by its own id (tenants keys on id, not tenant_id).
    for (const [table, id] of [
      ["tenants", designated.tenantId],
      ["nodes", designated.nodeId],
      ["tills", designated.tillId],
    ] as const) {
      const r = await suite.db.execute<{ ts: string }>(
        sql`select created_at::text as ts from ${sql.raw(table)} where id = ${id}`,
      );
      expect(new Date(r.rows[0]!.ts).toISOString()).toBe(stamp);
    }
    // `locations` has no date column — the pass-through path.
    const l = await suite.db.execute(
      sql`select id from locations where id = ${designated.locationId}`,
    );
    expect(l.rows).toHaveLength(1);
    // `invoice_series.retired_at` crosses the bundle as an ISO string and lands as a timestamp.
    const s = await suite.db.execute<{ n: number; ts: string | null }>(
      sql`select count(*)::int as n, min(retired_at)::text as ts from invoice_series where tenant_id = ${designated.tenantId}`,
    );
    expect(s.rows[0]!.n).toBe(2);
    expect(new Date(s.rows[0]!.ts!).toISOString()).toBe(stamp);
  });

  it("nulls the out-of-scope FK columns (locations.catalogue_id, tills.receipt_printer_id) even when the bundle carried non-null values", async () => {
    // The Critical C2b fix. A REAL trading venue sets `locations.catalogue_id` (a menu, catalogue.ts's
    // `assignCatalogue`) and `tills.receipt_printer_id` (a receipt printer, print-api.ts). Both are
    // nullable FKs to tables that do NOT exist on a mirror at adopt time: `catalogues` is empty in setup
    // mode (sync starts only after the reboot, and `locations` never re-syncs to restore the pointer),
    // and `printers` is not synced AT ALL (packages/sync registry). A verbatim insert of the primary's
    // non-null values raises 23503, which is not an AppError → the adopt boundary maps it to a 500 and
    // rolls back, so the mirror cannot be provisioned. adoptVenue nulls both before insert.
    //
    // The bundle here carries FRESH random ids in both columns — ids of catalogue/printer rows that do
    // NOT exist in this database, so a verbatim insert WOULD violate the FK. Deletion-proof of the fix:
    // drop `stripOutOfScopeFks` (or the map entries) in venue-adopt.ts and this insert throws 23503
    // instead of nulling — the exact production failure this pins.
    const { rows, designated } = makeRows();
    rows.locations[0]!.catalogueId = randomUUID();
    rows.tills[0]!.receiptPrinterId = randomUUID();

    await expect(adoptVenue(rows, designated, { db: suite.db })).resolves.toEqual(designated);

    const loc = await suite.db.execute<{ catalogueId: string | null }>(
      sql`select catalogue_id as "catalogueId" from locations where id = ${designated.locationId}`,
    );
    expect(loc.rows[0]!.catalogueId).toBeNull();
    const till = await suite.db.execute<{ receiptPrinterId: string | null }>(
      sql`select receipt_printer_id as "receiptPrinterId" from tills where id = ${designated.tillId}`,
    );
    expect(till.rows[0]!.receiptPrinterId).toBeNull();
  });

  it("throws provisioning.adopt_incomplete when the bundle omits a designated id", async () => {
    const { rows, designated } = makeRows();
    // The bundle's series rows do not contain the designated seriesId — a malformed bundle.
    const bogusDesignated: AdoptResult = { ...designated, seriesId: randomUUID() };

    await expect(adoptVenue(rows, bogusDesignated, { db: suite.db })).rejects.toMatchObject({
      code: "provisioning.adopt_incomplete",
      params: { missing: "series" },
    });
  });
});
