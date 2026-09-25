import { clearProvisionFixture } from "./testing/clear-provision-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readDeploymentEnvironment, stampDeployment, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin } from "@waitron/identity";
import type { VenueRequest } from "@waitron/provisioning";
import { isAppError } from "@waitron/shared";
import { parseModuleConfig } from "@waitron/module";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";

const ALL_ENABLED = parseModuleConfig({}, ALL_MODULES);
const ES_CONFIG = venueModuleConfig(ALL_ENABLED, "ES-common");

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

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

/** `GB-vat` resolves to the no-regime filing module, so it registers no SIF. */
function gbVenueRequest(taxId: string): VenueRequest {
  return {
    ...venueRequest(taxId),
    country: "GB",
    location: { ...venueRequest(taxId).location, fiscalTerritory: "GB-vat" },
  };
}

interface FiscalCounts {
  sif: number;
  series: number;
  nodes: number;
  registros: number;
}

async function fiscalCounts(db: Database): Promise<FiscalCounts> {
  const [sif, series, nodes, registros] = await Promise.all([
    db.execute<{ n: number }>(sql`select cast(count(*) as int) as n from registro_sif`),
    db.execute<{ n: number }>(sql`select cast(count(*) as int) as n from invoice_series`),
    db.execute<{ n: number }>(sql`select cast(count(*) as int) as n from nodes`),
    db.execute<{ n: number }>(sql`select cast(count(*) as int) as n from registros_facturacion`),
  ]);
  return {
    sif: sif.rows[0]!.n,
    series: series.rows[0]!.n,
    nodes: nodes.rows[0]!.n,
    registros: registros.rows[0]!.n,
  };
}

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

afterEach(() => clearProvisionFixture(suite.db));
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
  it("stamps the environment and mints one venue with four ids and exactly one SIF + series set", async () => {
    const db = ownerDb();
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });

    const result = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    );

    for (const id of [result.locationId, result.tillId, result.nodeId, result.seriesIds[0]]) {
      expect(typeof id).toBe("string");
      expect((id as string).length).toBeGreaterThan(0);
    }
    expect(result.seriesIds).toHaveLength(2);
    expect(result.seeded.map((s) => s.module)).toEqual([
      "catalogue",
      "venue-service",
      "fiscal-verifactu",
    ]);
    const defaults = await db.execute<{ menus: number; zone_menus: number }>(sql`
      select
        (select cast(count(*) as int) from catalogues ) as menus,
        (select cast(count(*) as int) from zone_menus zm
          join zone_service_policies p on p.zone_id = zm.zone_id
          where p.location_id = ${result.locationId}) as zone_menus`);
    expect(defaults.rows[0]).toEqual({ menus: 1, zone_menus: 1 });

    expect(await readDeploymentEnvironment(db)).toBe("preproduction");

    expect(await fiscalCounts(db)).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    const written = await readModuleConfig(stateDir);
    expect(written.overrides.get("fiscal-none")).toBe(false);
    expect(written.overrides.get("fiscal-verifactu")).toBe(true);
  });

  it("a GB (no-regime) venue mints no SIF/chain and persists modules.json disabling fiscal-verifactu", async () => {
    const db = ownerDb();
    const config = venueModuleConfig(ALL_ENABLED, "GB-vat");

    const result = await provisionVenue(
      { ownerDb: db, moduleConfig: config, database: "waitron", stateDir },
      { environment: "preproduction", venue: gbVenueRequest(nextNif()) },
    );

    expect(result.seeded.map((s) => s.module)).toEqual(["catalogue", "venue-service"]);
    expect(result.seriesIds).toHaveLength(2);
    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 2, nodes: 1, registros: 0 });

    const written = await readModuleConfig(stateDir);
    expect(written.overrides.get("fiscal-verifactu")).toBe(false);
    expect(written.overrides.get("fiscal-none")).toBe(true);
  });

  it("refuses venue provisioning when the fiscal slot is emptied — before minting anything", async () => {
    // `ownerDb` throws on any access, so the slot check must refuse before the database is reached.
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

    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      request,
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("setup.already_provisioned");

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
      locationId: minted.locationId,
      tillId: minted.tillId,
      nodeId: minted.nodeId,
      seriesIds: minted.seriesIds,
    });
    expect(await fiscalCounts(db)).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });
  });

  it("refuses a FOREIGN tenant in an occupied database and mints no second tenant (§5)", async () => {
    const db = ownerDb();
    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    );
    const afterFirst = await fiscalCounts(db);
    const firstTenants = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from tenants`,
    );
    expect(firstTenants.rows[0]!.n).toBe(1);

    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");

    const tenants = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from tenants`,
    );
    expect(tenants.rows[0]!.n).toBe(1);
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("refuses a re-provision of the SAME business in a DIFFERENT casing, BY NAME (§5)", async () => {
    // The second request is in a non-canonical casing, so casing plays no part in the decision.
    const db = ownerDb();
    const nif = nextNif();
    const env = "preproduction" as const;

    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: env, venue: venueRequest(nif) },
    );
    const afterFirst = await fiscalCounts(db);
    expect(afterFirst).toEqual({ sif: 1, series: 2, nodes: 1, registros: 0 });

    const nonCanonical = { ...venueRequest(nif), country: "es", taxId: nif.toLowerCase() };
    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: env, venue: nonCanonical },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("setup.already_provisioned");

    const tenants = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from tenants`,
    );
    expect(tenants.rows[0]!.n).toBe(1);
    expect(await fiscalCounts(db)).toEqual(afterFirst);
  });

  it("lets a deployment.already_stamped from a changed environment propagate and mints nothing", async () => {
    const db = ownerDb();
    await stampDeployment(db, "production");

    const error = await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      { environment: "preproduction", venue: venueRequest(nextNif()) },
    ).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("deployment.already_stamped");

    expect(await fiscalCounts(db)).toEqual({ sif: 0, series: 0, nodes: 0, registros: 0 });
  });
});

describe("recoverProvisionedVenue — refusals", () => {
  it("refuses with setup.already_provisioned when no committed venue matches the request", async () => {
    const request = { environment: "preproduction" as const, venue: venueRequest(nextNif()) };

    await expect(recoverProvisionedVenue(ownerDb(), request)).rejects.toMatchObject({
      code: "setup.already_provisioned",
    });
  });

  it("refuses with setup.already_provisioned when the committed series codes differ from the request's", async () => {
    const db = ownerDb();
    const request = { environment: "preproduction" as const, venue: venueRequest(nextNif()) };
    await provisionVenue(
      { ownerDb: db, moduleConfig: ES_CONFIG, database: "waitron", stateDir },
      request,
    );

    await expect(
      recoverProvisionedVenue(db, {
        ...request,
        venue: { ...request.venue, seriesCode: "B" },
      }),
    ).rejects.toMatchObject({ code: "setup.already_provisioned" });
    await expect(
      recoverProvisionedVenue(db, {
        ...request,
        venue: { ...request.venue, rectificativeSeriesCode: "S" },
      }),
    ).rejects.toMatchObject({ code: "setup.already_provisioned" });
  });
});
