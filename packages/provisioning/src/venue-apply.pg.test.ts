import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createPostgresDb, withTenant, type Database } from "@waitron/db";
import { applyInstance, withDatabase } from "./instance-apply.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

function venueRequest(taxId: string): VenueRequest {
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
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$00$00" },
  };
}

const DATABASE = "waitron_venue_priv_suite";
const FIXED_PW = "fixedpw"; // a fixed generator, so `applyInstance` is deterministic here

// The one place `applyVenue` runs end to end against a real, migrated, stamped database over a
// connection that is NOT a superuser — so the grants and triggers the venue write path passes
// through are genuinely enforced, which PGlite (every connection a superuser holding every grant,
// CLAUDE.md §4) cannot do. The other venue-apply suites use PGlite.
describe("applyVenue against a real container, as the non-superuser owner", () => {
  let pg: RealPostgres;
  let superuser: Database;
  let owner: Database; // prov_admin @ target — ran the migrations, therefore owns the tables

  beforeAll(async () => {
    pg = await startBarePostgres();
    superuser = await pg.connect();
    await superuser.execute(
      sql.raw(`create role prov_admin login createdb createrole password 'prov'`),
    );
    const adminUri = roleUrl(pg.uri, "prov_admin", "prov");
    const admin = await createPostgresDb(adminUri);
    try {
      // Stand up the whole deployment as prov_admin: create db, migrate every set, create the
      // two login roles (each with FIXED_PW), stamp. prov_admin ends up owning the tables.
      const before = await readInstanceState(admin, DATABASE, null);
      await applyInstance(
        planInstance(before, { database: DATABASE, environment: "preproduction" }, () => FIXED_PW),
        {
          admin,
          database: DATABASE,
          adminUri,
          migrationsRoot: null,
          openTarget: async () => {
            const db = await createPostgresDb(withDatabase(adminUri, DATABASE));
            return { db, release: () => db.close() };
          },
        },
      );
    } finally {
      await admin.close();
    }

    owner = await createPostgresDb(withDatabase(adminUri, DATABASE));
  }, 180_000);

  afterAll(async () => {
    if (owner !== undefined) await owner.close();
    if (superuser !== undefined) await superuser.close();
    if (pg !== undefined) await pg.stop();
  });

  it("prov_admin is a non-superuser (the negative control for the run below)", async () => {
    const rows = await owner.execute<{ me: string; rolsuper: boolean }>(
      sql`select current_user as me, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]?.me).toBe("prov_admin");
    expect(rows.rows[0]?.rolsuper).toBe(false);
    const ownership = await owner.execute<{ owns: boolean }>(sql`
      select relowner = (select oid from pg_roles where rolname = current_user) as owns
      from pg_class where oid = 'public.tenants'::regclass`);
    expect(ownership.rows).toEqual([{ owns: true }]);
  });

  it("the REAL applyVenue provisions a complete sellable venue over the owner connection, end to end", async () => {
    // The one place the whole flow runs as the non-superuser OWNER against a migrated + stamped real
    // database, where every grant and trigger it passes through is genuinely enforced — the gap
    // PGlite (a superuser holding every grant) cannot close. The database is fresh, so ensure-tenant
    // creates rather than reuses.
    const result = await applyVenue(planVenue(venueRequest("B12345678"), ALL_MODULES), {
      db: owner,
      modules: ALL_MODULES,
    });
    // The fiscal module's seed ran inside the venue transaction and reported its SIF line.
    expect(result.seeded).toEqual([
      { module: "fiscal", report: expect.stringMatching(/^SIF .* \(installation \d+\)$/) },
    ]);

    // Read the committed venue back in one transaction with explicit tenant and node predicates.
    const { counts, node, sif, profiles } = await withTenant(owner, result.tenantId, async (tx) => {
      const counts = await tx.execute<{
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
      const node = await tx.execute<{ filing_module: string; tax_module: string }>(sql`
        select filing_module, tax_module from nodes where id = ${result.nodeId}`);
      const sif = await tx.execute<{ nif: string }>(sql`
        select nif from registro_sif where node_id = ${result.nodeId} and revocado_en is null`);
      // The starter device profiles, read back under the same scope. This is the ONE place the store's
      // createDeviceProfile (which opens an admin management session and validates capabilities) runs
      // as the non-superuser OWNER against real device_profiles / management_sessions grants — the
      // gap PGlite (a superuser holding every grant) cannot close.
      const profiles = await tx.execute<{
        name: string;
        canvas_id: string | null;
        capabilities: string[];
      }>(sql`
        select name, canvas_id, capabilities from device_profiles
        where tenant_id = ${result.tenantId} order by name`);
      return { counts, node, sif, profiles };
    });

    expect(counts.rows[0]).toEqual({ tenants: 1, nodes: 1, series: 2, sif: 1 });
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "iva" });
    // The SIF's nif came from the tenant's tax_id, read inside the transaction — never an argument.
    expect(sif.rows[0]?.nif).toBe("B12345678");
    // Exactly the three starter profiles, es-ES names (this venue's primary invoice locale), each with
    // no bound canvas and the form-factor default capabilities.
    expect(profiles.rows).toEqual([
      { name: "Cocina", canvas_id: null, capabilities: ["act-as-kds"] },
      {
        name: "Mostrador",
        canvas_id: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      },
      { name: "Móvil", canvas_id: null, capabilities: [] },
    ]);
  });
});
