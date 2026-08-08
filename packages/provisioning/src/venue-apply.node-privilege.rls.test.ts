import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, withTenant, type Database } from "@waitron/db";
import { applyInstance, withDatabase } from "./instance-apply.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { sqlStateOf } from "./sql-state.js";
import { obligadoTenantId } from "./tenant-id.js";
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
const FIXED_PW = "fixedpw"; // every role instance creates gets this, so we can connect as any of them

describe("who may INSERT a node under FORCE RLS", () => {
  let pg: RealPostgres;
  let superuser: Database;
  let owner: Database; // prov_admin @ target — ran the migrations, therefore owns the tables
  let provisioner: Database; // waitron_provisioner @ target — member of app_user + tenant_provisioner
  let tenantId: string;
  let locationId: string;

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
      // three login roles (each with FIXED_PW), stamp. prov_admin ends up owning the tables.
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
    provisioner = await createPostgresDb(
      withDatabase(roleUrl(pg.uri, "waitron_provisioner", FIXED_PW), DATABASE),
    );

    // Seed a tenant + location as the owner, under the tenant scope (deterministic id).
    tenantId = obligadoTenantId("ES", "B00000000");
    locationId = await withTenant(owner, tenantId, async (tx) => {
      await tx.execute(sql`
        insert into tenants (id, country, tax_id, legal_name)
        values (${tenantId}, 'ES', 'B00000000', 'Probe SL') on conflict do nothing`);
      const loc = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Probe', array['es-ES'], 'venta') returning id`);
      return loc.rows[0]!.id;
    });
  }, 180_000);

  afterAll(async () => {
    if (provisioner !== undefined) await provisioner.close();
    if (owner !== undefined) await owner.close();
    if (superuser !== undefined) await superuser.close();
    if (pg !== undefined) await pg.stop();
  });

  it("prov_admin is a non-superuser (the negative control for this whole suite)", async () => {
    const rows = await owner.execute<{ me: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select current_user as me, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]?.me).toBe("prov_admin");
    expect(rows.rows[0]?.rolsuper).toBe(false);
    expect(rows.rows[0]?.rolbypassrls).toBe(false);
  });

  it("the OWNER-admin CAN insert a node under the tenant GUC", async () => {
    const nodeId = await withTenant(owner, tenantId, async (tx) => {
      const node = await tx.execute<{ id: string }>(sql`
        insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Owner node') returning id`);
      return node.rows[0]!.id;
    });
    expect(nodeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("waitron_provisioner CANNOT (nodes is SELECT-only, 0017) — the control that proves the owner path does real work", async () => {
    let sqlState: string | null = null;
    try {
      await withTenant(provisioner, tenantId, async (tx) => {
        await tx.execute(sql`
          insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Provisioner node')`);
      });
      expect.unreachable("provisioner should be refused INSERT on nodes");
    } catch (error) {
      sqlState = sqlStateOf(error);
    }
    expect(sqlState).toBe("42501"); // permission denied for table nodes
  });

  it("the REAL applyVenue provisions a complete sellable venue over the owner connection, end-to-end under FORCE RLS", async () => {
    // The one place the whole flow runs as the non-superuser OWNER against a migrated + stamped
    // real database — closing the gap PGlite (a superuser that bypasses RLS) cannot. A fresh
    // obligado, distinct from this suite's B00000000 seed, so ensure-tenant creates rather than
    // reuses.
    const result = await applyVenue(planVenue(venueRequest("B12345678")), { db: owner });
    expect(result.sif.numeroInstalacion).toBeGreaterThanOrEqual(1);

    // FORCE RLS is REAL for the owner here, and reading back must happen INSIDE the tenant scope:
    // the USING policy `tenant_id = current_tenant_id()` hides every row from a session with no GUC
    // set, so an unscoped `owner.execute(...)` count returns 0 for rows that were in fact written
    // (measured in this task's first container run: all four counts came back 0 against a venue
    // `applyVenue` had just committed). The PGlite unit test does NOT catch this — its superuser
    // connection bypasses RLS, so the same raw SELECT sees the rows. This scoped read-back is the
    // gap that test cannot close.
    const { counts, node, sif } = await withTenant(owner, result.tenantId, async (tx) => {
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
        select nif from registro_sif where id = ${result.sif.id}`);
      return { counts, node, sif };
    });

    expect(counts.rows[0]).toEqual({ tenants: 1, nodes: 1, series: 2, sif: 1 });
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "iva" });
    // The SIF's nif came from the tenant's tax_id, read inside the transaction — never an argument.
    expect(sif.rows[0]?.nif).toBe("B12345678");
  });
});
