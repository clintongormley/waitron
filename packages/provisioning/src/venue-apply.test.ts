import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { planVenue, type VenueAction, type VenueRequest } from "./venue-plan.js";
import { obligadoTenantId } from "./tenant-id.js";
import { applyVenue } from "./venue-apply.js";

// PGlite's default connection is a SUPERUSER, so it BYPASSES row-level security (ENABLE and FORCE
// alike). That is fine here: this suite exercises the wiring and idempotency logic, and the
// privilege behaviour under FORCE RLS as the non-superuser owner is proven separately by C1's
// container test (`venue-apply.node-privilege.rls.test.ts`) and by the container end-to-end that
// runs the real `applyVenue` over the owner connection.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

function request(taxId = "B12345678"): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli SL",
    location: {
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
  };
}

describe("applyVenue", () => {
  it("provisions a sellable venue: tenant, location, till, node, live SIF, two series", async () => {
    const result = await applyVenue(planVenue(request()), { db: suite.db });

    const counts = await suite.db.execute<{
      tenants: number;
      nodes: number;
      series: number;
      sif: number;
    }>(sql`
      select
        (select count(*) from tenants where id = ${result.tenantId})::int as tenants,
        (select count(*) from nodes where id = ${result.nodeId})::int as nodes,
        (select count(*) from invoice_series where node_id = ${result.nodeId})::int as series,
        (select count(*) from registro_sif where node_id = ${result.nodeId} and revocado_en is null)::int as sif`);
    expect(counts.rows[0]).toEqual({ tenants: 1, nodes: 1, series: 2, sif: 1 });
    expect(result.sif.numeroInstalacion).toBeGreaterThanOrEqual(1);

    const series = await suite.db.execute<{ purpose: string }>(sql`
      select purpose from invoice_series where node_id = ${result.nodeId} order by purpose`);
    expect(series.rows.map((r) => r.purpose)).toEqual(["rectificative", "standard"]);

    // The node carries the resolved modules.
    const node = await suite.db.execute<{ filing_module: string; tax_module: string }>(sql`
      select filing_module, tax_module from nodes where id = ${result.nodeId}`);
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "iva" });

    // registro_sif.nif came from the tenant's tax_id, never an argument.
    const sif = await suite.db.execute<{ nif: string }>(sql`
      select nif from registro_sif where id = ${result.sif.id}`);
    expect(sif.rows[0]?.nif).toBe("B12345678");
  });

  it("reuses the obligado on a re-run rather than duplicating it (idempotent tenant, spec D8)", async () => {
    const first = await applyVenue(planVenue(request("B99999999")), { db: suite.db });
    const second = await applyVenue(planVenue(request("B99999999")), { db: suite.db });
    expect(second.tenantId).toBe(first.tenantId); // same deterministic id, reused

    const tenants = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenants where country = 'ES' and tax_id = 'B99999999'`);
    expect(tenants.rows[0]?.n).toBe(1); // exactly one obligado, not two
  });

  it("mints a distinct installation number per node under one obligado", async () => {
    const a = await applyVenue(planVenue(request("B11111111")), { db: suite.db });
    const b = await applyVenue(planVenue(request("B11111111")), { db: suite.db });
    expect(a.tenantId).toBe(b.tenantId);
    expect(a.sif.numeroInstalacion).not.toBe(b.sif.numeroInstalacion); // fresh node ⇒ fresh install #, new chain
  });

  it("refuses a plan with no ensure-tenant — the scope it adopts must be present", async () => {
    // The tenant scope every WITH CHECK is satisfied against comes from the ensure-tenant action;
    // a plan lacking it has no scope to adopt, so applyVenue throws before opening a transaction.
    const withoutTenant = planVenue(request()).filter((a) => a.kind !== "ensure-tenant");
    await expect(applyVenue(withoutTenant, { db: suite.db })).rejects.toThrow(
      "applyVenue: plan is missing ensure-tenant",
    );
  });

  it("never returns a phantom series id when ON CONFLICT drops a colliding series", async () => {
    // planVenue rejects equal codes, so this hand-builds the colliding plan directly to prove the
    // apply-side gate: two create-series sharing (tenant, node, code), the second dropped by
    // ON CONFLICT DO NOTHING. Its id must NOT reach the result, and the venue must end with exactly
    // one series row — the honest reflection of what was written.
    const taxId = "B22222222";
    const tenantId = obligadoTenantId("ES", taxId);
    const collidingPlan: VenueAction[] = [
      { kind: "ensure-tenant", tenantId, country: "ES", taxId, legalName: "Deli SL" },
      {
        kind: "create-location",
        name: "Mostrador",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      },
      { kind: "create-till", name: "Caja 1" },
      { kind: "create-node", name: "Mostrador", filingModule: "verifactu", taxModule: "iva" },
      { kind: "register-sif", idSistemaInformatico: "W1" },
      { kind: "create-series", code: "A", purpose: "standard" },
      { kind: "create-series", code: "A", purpose: "rectificative" }, // same code ⇒ dropped
    ];

    const result = await applyVenue(collidingPlan, { db: suite.db });
    expect(result.seriesIds).toHaveLength(1); // the dropped series' id is not returned

    const series = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from invoice_series where node_id = ${result.nodeId}`);
    expect(series.rows[0]?.n).toBe(1); // only one series row exists
  });

  describe("guards a malformed plan whose actions arrive out of order", () => {
    // planVenue always emits create-location before create-till/create-node, and create-node before
    // register-sif/create-series, so these orderings are unreachable from it. A hand-built (or a
    // future-planner) plan that runs a step early would otherwise hit the DB with an EMPTY uuid — a
    // low-signal 22P02 — or register a SIF against an empty node id (fiscally load-bearing). Each
    // guard turns that into a clear plan-integrity Error BEFORE any such write, not an operator-facing
    // AppError: a malformed plan is a programming bug, not operator input.
    const taxId = "B33333333";
    const tenantId = obligadoTenantId("ES", taxId);
    const ensure: VenueAction = {
      kind: "ensure-tenant",
      tenantId,
      country: "ES",
      taxId,
      legalName: "Deli SL",
    };
    const createLocation: VenueAction = {
      kind: "create-location",
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    };

    it.each([
      {
        name: "create-till before create-location",
        plan: [ensure, { kind: "create-till", name: "Caja 1" } as VenueAction],
        message: "applyVenue: create-till before create-location",
      },
      {
        name: "create-node before create-location",
        plan: [
          ensure,
          {
            kind: "create-node",
            name: "Mostrador",
            filingModule: "verifactu",
            taxModule: "iva",
          } as VenueAction,
        ],
        message: "applyVenue: create-node before create-location",
      },
      {
        name: "register-sif before create-node",
        plan: [
          ensure,
          createLocation,
          { kind: "register-sif", idSistemaInformatico: "W1" } as VenueAction,
        ],
        message: "applyVenue: register-sif before create-node",
      },
      {
        name: "create-series before create-node",
        plan: [
          ensure,
          createLocation,
          { kind: "create-series", code: "A", purpose: "standard" } as VenueAction,
        ],
        message: "applyVenue: create-series before create-node",
      },
    ])("throws a clear error for $name, not a raw SQL error", async ({ plan, message }) => {
      await expect(applyVenue(plan, { db: suite.db })).rejects.toThrow(message);
    });
  });
});
