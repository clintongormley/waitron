// Real PostgreSQL: provisions a sellable venue as a verified non-superuser owner.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createPostgresDb, withTenant, type Database } from "@waitron/db";
import { withRole } from "./identifiers.js";
import { applyInstance, withDatabase } from "./instance-apply.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { readTenantIdentities } from "./tenant-guard.js";
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
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
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
  let owner: Database; // waitron_migrator @ target — `instance` migrated AS it, so it owns the tables
  let ownerUri: string;

  beforeAll(async () => {
    pg = await startBarePostgres();
    superuser = await pg.connect();
    await superuser.execute(
      sql.raw(`create role prov_admin login createdb createrole password 'prov'`),
    );
    const adminUri = roleUrl(pg.uri, "prov_admin", "prov");
    const admin = await createPostgresDb(adminUri);
    // The target is opened AS the migrator (the role option): the migration and the post-migrate role
    // work run as it, so it owns every table — which is what `applyVenue` then inserts as below.
    ownerUri = withRole(withDatabase(adminUri, DATABASE), "waitron_migrator");
    try {
      // Stand up the whole deployment as prov_admin: create the migrator, the db it owns, migrate AS
      // it, create the two login roles (each with FIXED_PW), stamp. waitron_migrator owns the tables.
      const before = await readInstanceState(admin, DATABASE, null);
      await applyInstance(
        planInstance(before, { database: DATABASE, environment: "preproduction" }, () => FIXED_PW),
        {
          admin,
          database: DATABASE,
          adminUri,
          migrationsRoot: null,
          openTarget: async () => {
            const db = await createPostgresDb(ownerUri);
            return { db, release: () => db.close() };
          },
        },
      );
    } finally {
      await admin.close();
    }

    owner = await createPostgresDb(ownerUri);
  }, 180_000);

  afterAll(async () => {
    if (owner !== undefined) await owner.close();
    if (superuser !== undefined) await superuser.close();
    if (pg !== undefined) await pg.stop();
  });

  it("the owner connection is the non-superuser migrator that owns the tables (negative control)", async () => {
    // The role option makes the session `waitron_migrator` — a non-superuser — and it owns `tenants`,
    // so every grant and trigger `applyVenue` passes through below is genuinely enforced.
    const rows = await owner.execute<{ me: string; rolsuper: boolean }>(
      sql`select current_user as me, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]?.me).toBe("waitron_migrator");
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
      {
        module: "catalogue",
        report: "initial menu ready",
      },
      {
        module: "venue-service",
        report: "default department and counter zone ready",
      },
      {
        module: "fiscal-verifactu",
        report: expect.stringMatching(/^SIF .* \(installation \d+\)$/),
      },
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
        form_factor: string;
        canvas_id: string | null;
        capabilities: string[];
        inactivity_timeout_seconds: number | null;
      }>(sql`
        select name, form_factor, canvas_id, capabilities, inactivity_timeout_seconds
        from device_profiles
        where tenant_id = ${result.tenantId} order by name`);
      return { counts, node, sif, profiles };
    });

    expect(counts.rows[0]).toEqual({ tenants: 1, nodes: 1, series: 2, sif: 1 });
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "vat" });
    // The SIF's nif came from the tenant's tax_id, read inside the transaction — never an argument.
    expect(sif.rows[0]?.nif).toBe("B12345678");
    // Exactly the three starter profiles, es-ES names (this venue's primary invoice locale), each with
    // no bound canvas, its form-factor persisted, and the form-factor default capabilities.
    expect(profiles.rows).toEqual([
      {
        name: "Cocina",
        form_factor: "kds",
        canvas_id: null,
        capabilities: ["act-as-kds"],
        inactivity_timeout_seconds: null,
      },
      {
        name: "Mostrador",
        form_factor: "till",
        canvas_id: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
        inactivity_timeout_seconds: 300,
      },
      {
        name: "Móvil",
        form_factor: "phone-portrait",
        canvas_id: null,
        capabilities: [],
        inactivity_timeout_seconds: 300,
      },
    ]);
  });

  it("serialises concurrent same-venue retries and refuses a competing different venue", async () => {
    const secondOwner = await createPostgresDb(ownerUri);
    try {
      const samePlan = planVenue(venueRequest("B12345678"), ALL_MODULES);
      const different = venueRequest("B12345678");
      different.location.name = "Another venue";
      const results = await Promise.allSettled([
        applyVenue(samePlan, { db: owner, modules: ALL_MODULES }),
        applyVenue(planVenue(different, ALL_MODULES), {
          db: secondOwner,
          modules: ALL_MODULES,
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({ reason: { code: "provisioning.second_venue" } }),
      ]);
      const counts = await owner.execute<{ locations: number; nodes: number }>(sql`
        select
          (select count(*) from locations)::int as locations,
          (select count(*) from nodes)::int as nodes`);
      expect(counts.rows).toEqual([{ locations: 1, nodes: 1 }]);
    } finally {
      await secondOwner.close();
    }
  });

  it("readTenantIdentities reads the real committed tenant — the venue guard's real read (§5)", async () => {
    // The `venue` command refuses a SECOND, DIFFERENT tenant in one database (one tenant per
    // database, the post-RLS isolation boundary) by reading the existing `(country, tax_id)` set with
    // this function before it applies; the refusal DECISION is proven in cli.test.ts with an injected
    // reader, exactly as the deployment-stamp refusal is. This is the real read, run against the real
    // database the end-to-end test above committed B12345678 into — proven by running, not reasoned.
    const identities = await readTenantIdentities(owner);
    expect(identities).toEqual([{ country: "ES", taxId: "B12345678" }]);
    // The predicate the guard applies: any identity but the one present is FOREIGN, the same one stays.
    expect(identities.some((t) => t.country !== "ES" || t.taxId !== "B99999999")).toBe(true);
    expect(identities.some((t) => t.country !== "ES" || t.taxId !== "B12345678")).toBe(false);
  });
});
