import { clearProvisionFixture } from "./testing/clear-provision-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readDeploymentEnvironment, stampDeployment, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin } from "@waitron/identity";
import type { VenueRequest } from "@waitron/provisioning";
import { isAppError } from "@waitron/shared";
import { parseModuleConfig } from "@waitron/module";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";

/** All modules enabled (an absent/empty modules.json) — the operator base a provision starts from. */
const ALL_ENABLED = parseModuleConfig({}, ALL_MODULES);
/** The fiscal-slot-resolved config a Spanish (ES-common → Veri*Factu) provision runs and persists —
 * what boot's `venueModuleConfig` builds from the request's territory before calling `provisionVenue`. */
const ES_CONFIG = venueModuleConfig(ALL_ENABLED, "ES-common");

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
      email: "owner@example.test",
    },
  };
}

/** A valid no-regime (`GB-vat`) venue: country GB, a country-prefixed territory, everything else the
 * same shape as the ES fixture. Its filing module resolves to `none`, so it registers no SIF. */
function gbVenueRequest(taxId: string): VenueRequest {
  return {
    ...venueRequest(taxId),
    country: "GB",
    location: { ...venueRequest(taxId).location, fiscalTerritory: "GB-vat" },
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
// A fresh state dir per test so `provisionVenue`'s `writeModuleConfig(stateDir, …)` has somewhere to
// land and its `modules.json` can be read back and asserted.
let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-provision-"));
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function ownerDb(): Database {
  return suite.db;
}

describe("provisionVenue", () => {
  it("stamps the environment and mints one venue with five ids and exactly one SIF + series set", async () => {
    const db = ownerDb();
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });

    const result = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
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
    expect(result.seeded.map((s) => s.module)).toEqual(["fiscal-verifactu"]);

    // The box is now stamped for the requested environment.
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");

    // Exactly one SIF, one series set (standard + rectificative) and one node.
    expect(await fiscalCounts(db)).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    // The resolved slot was persisted: `fiscal-none` disabled so the trading boot resolves to
    // Veri*Factu rather than failing `module.fiscal_slot_ambiguous` under the default-on set.
    const written = await readModuleConfig(stateDir);
    expect(written.overrides.get("fiscal-none")).toBe(false);
    expect(written.overrides.get("fiscal-verifactu")).toBe(true);
  });

  it("a GB (no-regime) venue mints no SIF/chain and persists modules.json disabling fiscal-verifactu", async () => {
    // The `GB-vat` territory resolves `filing: "none"`, so `venueModuleConfig` selects `fiscal-none`
    // and disables `fiscal-verifactu`. A no-regime node registers NO SIF and runs no fiscal seed —
    // it still gets its two invoice series (a core concern, not fiscal). This is the first venue that
    // provisions the second fiscal-slot member, the coexistence the whole slice exists to prove.
    const db = ownerDb();
    const config = venueModuleConfig(ALL_ENABLED, "GB-vat");

    const result = await provisionVenue(
      { ownerDb: db, moduleConfig: config, database: "waitron", stateDir },
      { environment: "preproduction", venue: gbVenueRequest(nextNif()) },
    );

    // No fiscal seed ran (fiscal-none contributes none), so nothing was seeded.
    expect(result.seeded).toEqual([]);
    expect(result.seriesIds).toHaveLength(2);
    // No registro_sif, no chain — but the node and its two series exist.
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 2, nodes: 1, registros: 0 });

    // The persisted slot disables Veri*Factu and keeps `fiscal-none`.
    const written = await readModuleConfig(stateDir);
    expect(written.overrides.get("fiscal-verifactu")).toBe(false);
    expect(written.overrides.get("fiscal-none")).toBe(true);
  });

  it("refuses venue provisioning when the fiscal slot is emptied — before minting anything", async () => {
    // A caller that hands `provisionVenue` a config with BOTH fiscal-slot members disabled empties the
    // slot, so provisioning must REFUSE outright — never mint an unrecoverable SIF/hash chain with no
    // regime to file it (CLAUDE.md §5). Both members carry a `fiscal` seat, so the provision-only gate
    // no longer flags them (that set is governed by the slot's exactly-one rule); the slot check is what
    // refuses, as step 0b, before planVenue/stampDeployment/applyVenue — nothing is validated, stamped
    // or minted. Proven by an `ownerDb` Proxy that THROWS on ANY property access: a
    // `module.fiscal_slot_empty` throw (rather than "ownerDb must not be touched") is the proof the slot
    // check short-circuits before the DB is ever reached. (Normal callers reach `provisionVenue` through
    // `venueModuleConfig`, which forces exactly one member on — the empty slot is the defensive branch a
    // territory whose filing has no module would hit.)
    const moduleConfig = parseModuleConfig(
      { modules: { "fiscal-verifactu": false, "fiscal-none": false } },
      ALL_MODULES,
    );
    const ownerDb = new Proxy(
      {},
      {
        get() {
          throw new Error("ownerDb must not be touched");
        },
      },
    ) as never;
    const err = await provisionVenue(
      { ownerDb, moduleConfig, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.fiscal_slot_empty");
  });

  it("refuses a second provision of the same NIF and mints no second SIF/chain (the fiscal footgun)", async () => {
    const db = ownerDb();
    const request = { environment: "preproduction" as const, venue: venueRequest(nextNif()) };

    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      request,
    );
    const afterFirst = await fiscalCounts(db);
    expect(afterFirst).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    // A second provision with the SAME NIF is refused BEFORE any fiscal write.
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      request,
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("setup.already_provisioned");

    // No second SIF, series or node — the guard prevented a duplicate hash chain.
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("recovers the exact committed venue after a process dies before file publication", async () => {
    const db = ownerDb();
    const request = { environment: "preproduction" as const, venue: venueRequest(nextNif()) };
    const minted = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      request,
    );

    const recovered = await recoverProvisionedVenue(db, request);

    expect(recovered).toMatchObject({
      tenantId: minted.tenantId,
      locationId: minted.locationId,
      tillId: minted.tillId,
      nodeId: minted.nodeId,
      seriesIds: minted.seriesIds,
    });
    expect(await fiscalCounts(db)).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });
  });

  it("refuses a FOREIGN tenant in an occupied database and mints no second tenant (§5)", async () => {
    // The production gap: `POST /setup-api/provision` reaches this function, and one tenant per
    // database is the post-RLS isolation boundary — with row-level security gone a second
    // `(country, tax_id)` would expose one business's rows to the other (§5). A DIFFERENT tenant in
    // an occupied database is refused BEFORE stamping or applyVenue, exactly as the `venue` CLI does.
    const db = ownerDb();
    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    );
    const afterFirst = await fiscalCounts(db);
    const firstTenants = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(firstTenants.rows[0]!.n).toBe(1);

    // A DIFFERENT business (a fresh NIF) against the SAME database is refused as a foreign tenant.
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
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
    // The most load-bearing path: the double-provision guard (provision.ts) recomputes the tenant id
    // from the RAW request (`deriveTenantId(req.venue.country, req.venue.taxId)`), while the stored
    // id comes from `planVenue` (which canonicalizes country/taxId). For the guard to recognize a
    // re-provision in a different casing, BOTH normalization layers must agree: planVenue canonicalizes
    // the plan/stored row, and deriveTenantId self-normalizes the id the guard recomputes. Without
    // the latter, a re-provision in a NON-canonical casing recomputes a raw id that MISSES the stored
    // (canonical) tenant, so the guard passes and applyVenue ADDS a second node → a second, permanent,
    // unmergeable SIF/hash chain (§5). No existing test catches this: "refuses a second provision" sends
    // byte-identical requests, so its guard id matches trivially.
    //
    // The re-provision is SECOND in a NON-canonical casing on purpose: the guard reads the SECOND
    // call's raw request, so that call must be non-canonical for the cross-layer invariance to be under
    // test. (A canonical second call derives the canonical id directly and would be refused even with
    // deriveTenantId's normalization removed — a false green.) `nextNif()` ends in an uppercase "K",
    // so lower-casing the NIF plus a lowercase country gives a genuinely non-canonical re-provision of
    // the same business.
    const db = ownerDb();
    const nif = nextNif(); // e.g. "60000001K" — canonical (uppercase)
    const env = "preproduction" as const;

    // First: provision in the CANONICAL casing.
    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: env, venue: venueRequest(nif) },
    );
    const afterFirst = await fiscalCounts(db);
    expect(afterFirst).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    // Second: re-provision the SAME business in a NON-canonical casing (lowercase country + NIF).
    const nonCanonical = { ...venueRequest(nif), country: "es", taxId: nif.toLowerCase() };
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
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
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("deployment.already_stamped");

    // The refused provision minted no venue.
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });
  });
});
