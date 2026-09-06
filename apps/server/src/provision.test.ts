import { clearProvisionFixture } from "./testing/clear-provision-fixture.js";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readDeploymentEnvironment, stampDeployment, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin } from "@waitron/identity";
import type { VenueRequest } from "@waitron/provisioning";
import { isAppError } from "@waitron/shared";
import { parseModuleConfig } from "@waitron/module";
import { provisionVenue } from "./provision.js";
import { ALL_MODULES } from "./modules.js";

/** All modules enabled (an absent/empty modules.json) — the default the happy-path deps pass. */
const ALL_ENABLED = parseModuleConfig({}, ALL_MODULES);

// Each provisioned venue needs its own NIF (`tenants_country_tax_id_key` is unique); the shared database
// draws from one generator, the same nextNif shape `till-sale.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A valid ES-common venue with already-hashed admin secrets, mirroring `dev-setup.ts`'s fixture. */
function venueRequest(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli Test SL",
    location: {
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Administradora",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("dashPass123"),
    },
  };
}

/** The row counts a duplicate provision would grow — each a fresh node = a fresh SIF/hash chain. */
interface FiscalCounts {
  sif: number;
  series: number;
  nodes: number;
  registros: number;
}

async function fiscalCounts(db: Database): Promise<FiscalCounts> {
  const [sif, series, nodes, registros] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from invoice_series`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from nodes`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from registros_facturacion`),
  ]);
  return {
    sif: sif.rows[0]!.n,
    series: series.rows[0]!.n,
    nodes: nodes.rows[0]!.n,
    registros: registros.rows[0]!.n,
  };
}

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

afterEach(() => clearProvisionFixture(suite.db));

function ownerDb(): Database {
  return suite.db;
}

describe("provisionVenue", () => {
  it("stamps the environment and mints one venue with five ids and exactly one SIF + series set", async () => {
    const db = ownerDb();
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });

    const result = await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    );

    // The five ids the trading boot needs, each a non-empty string.
    for (const id of [
      result.tenantId,
      result.locationId,
      result.tillId,
      result.nodeId,
      result.seriesIds[0],
    ]) {
      expect(typeof id).toBe("string");
      expect((id as string).length).toBeGreaterThan(0);
    }
    expect(result.seriesIds).toHaveLength(2);
    expect(result.seeded.map((s) => s.module)).toEqual(["fiscal"]);

    // The box is now stamped for the requested environment.
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");

    // Exactly one SIF, one series set (standard + rectificative) and one node.
    expect(await fiscalCounts(db)).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });
  });

  it("refuses venue provisioning when a provision-only module is disabled — before minting anything", async () => {
    // The SP-1b fiscal gate (spec §4): disabling the `fiscal` (provision-only) module must REFUSE
    // provisioning outright — never mint an unrecoverable SIF/hash chain for a module that is off
    // (CLAUDE.md §5). The guard is step 0, before planVenue/stampDeployment/applyVenue, so nothing is
    // validated, stamped or minted. Proven by an `ownerDb` Proxy that THROWS on ANY property access:
    // if the guard short-circuits first, the DB is never touched, so a `module.provision_only_disabled`
    // throw (rather than "ownerDb must not be touched") is the proof.
    const moduleConfig = parseModuleConfig({ modules: { fiscal: false } }, ALL_MODULES);
    const ownerDb = new Proxy(
      {},
      {
        get() {
          throw new Error("ownerDb must not be touched");
        },
      },
    ) as never;
    const err = await provisionVenue(
      { ownerDb, moduleConfig, database: "waitron" },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.provision_only_disabled");
  });

  it("refuses a second provision of the same NIF and mints no second SIF/chain (the fiscal footgun)", async () => {
    const db = ownerDb();
    const request = { environment: "preproduction" as const, venue: venueRequest(nextNif()) };

    await provisionVenue({ ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" }, request);
    const afterFirst = await fiscalCounts(db);
    expect(afterFirst).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    // A second provision with the SAME NIF is refused BEFORE any fiscal write.
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      request,
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("setup.already_provisioned");

    // No second SIF, series or node — the guard prevented a duplicate hash chain.
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("refuses a FOREIGN obligado in an occupied database and mints no second tenant (§5)", async () => {
    // The production gap: `POST /setup-api/provision` reaches this function, and one tenant per
    // database is the post-RLS isolation boundary — with row-level security gone a second
    // `(country, tax_id)` would expose one business's rows to the other (§5). A DIFFERENT obligado in
    // an occupied database is refused BEFORE stamping or applyVenue, exactly as the `venue` CLI does.
    const db = ownerDb();
    await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    );
    const afterFirst = await fiscalCounts(db);
    const firstTenants = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(firstTenants.rows[0]!.n).toBe(1);

    // A DIFFERENT business (a fresh NIF) against the SAME database is refused as a foreign tenant.
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");

    // Still exactly one tenant — and no second SIF/series/node/chain.
    const tenants = await db.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
    expect(tenants.rows[0]!.n).toBe(1);
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("refuses a re-provision of the SAME business in a DIFFERENT casing — cross-layer invariance (§5)", async () => {
    // The most load-bearing path: the double-provision guard (provision.ts) recomputes the obligado id
    // from the RAW request (`obligadoTenantId(req.venue.country, req.venue.taxId)`), while the stored
    // id comes from `planVenue` (which canonicalizes country/taxId). For the guard to recognize a
    // re-provision in a different casing, BOTH normalization layers must agree: planVenue canonicalizes
    // the plan/stored row, and obligadoTenantId self-normalizes the id the guard recomputes. Without
    // the latter, a re-provision in a NON-canonical casing recomputes a raw id that MISSES the stored
    // (canonical) tenant, so the guard passes and applyVenue ADDS a second node → a second, permanent,
    // unmergeable SIF/hash chain (§5). No existing test catches this: "refuses a second provision" sends
    // byte-identical requests, so its guard id matches trivially.
    //
    // The re-provision is SECOND in a NON-canonical casing on purpose: the guard reads the SECOND
    // call's raw request, so that call must be non-canonical for the cross-layer invariance to be under
    // test. (A canonical second call derives the canonical id directly and would be refused even with
    // obligadoTenantId's normalization removed — a false green.) `nextNif()` ends in an uppercase "K",
    // so lower-casing the NIF plus a lowercase country gives a genuinely non-canonical re-provision of
    // the same business.
    const db = ownerDb();
    const nif = nextNif(); // e.g. "60000001K" — canonical (uppercase)
    const env = "preproduction" as const;

    // First: provision in the CANONICAL casing.
    await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: env, venue: venueRequest(nif) },
    );
    const afterFirst = await fiscalCounts(db);
    expect(afterFirst).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    // Second: re-provision the SAME business in a NON-canonical casing (lowercase country + NIF).
    const nonCanonical = { ...venueRequest(nif), country: "es", taxId: nif.toLowerCase() };
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: env, venue: nonCanonical },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("setup.already_provisioned");

    // One tenant, one SIF/series set, one node — no duplicate chain. (Strip tenant-id.ts's
    // self-normalization and this reads {sif:2, series:4, nodes:2}, the reviewer's negative control.)
    const tenants = await db.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
    expect(tenants.rows[0]!.n).toBe(1);
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("lets a deployment.already_stamped from a changed environment propagate and mints nothing", async () => {
    const db = ownerDb();
    // The box is stamped production first ...
    await stampDeployment(db, "production");

    // ... so provisioning it for preproduction is refused at the stamp step, before any venue mint.
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ALL_ENABLED, database: "waitron" },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("deployment.already_stamped");

    // The refused provision minted no venue.
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });
  });
});
