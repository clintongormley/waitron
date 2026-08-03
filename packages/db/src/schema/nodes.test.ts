import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants } from "./tenants.js";
import { nodes } from "./nodes.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const NODE_A1 = "aaaaaaaa-2222-4000-8000-000000000001";
// Never seeded — the FK target for the "location does not exist" rejection below.
const LOCATION_MISSING = "cccccccc-0000-4000-8000-000000000009";

/**
 * Both drivers expose `.rows`, but the pglite driver returns its own Results
 * object rather than node-postgres's QueryResult. Normalising here keeps the
 * introspection tests identical across targets instead of forking on driver.
 * (Same helper as series.test.ts — copied deliberately rather than shared, so
 * each schema suite reads standalone.)
 */
async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** Seeds as owner, deliberately: RLS has nothing to say about the fixture. */
async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    },
  ]);
}

describeEachTarget("nodes schema", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  // Without it, a pg Pool per test is left open when the postgres target's
  // container stops at describe-level teardown (see series.test.ts / tenancy.test.ts).
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("inserts a node under its tenant", async () => {
    await db.insert(nodes).values({ tenantId: TENANT_A, locationId: LOCATION_A, name: "Node A1" });
    const found = await db
      .select({ name: nodes.name })
      .from(nodes)
      .where(eq(nodes.tenantId, TENANT_A));
    expect(found.map((r) => r.name)).toEqual(["Node A1"]);
  });

  it("rejects a duplicate (tenant_id, id) with 23505", async () => {
    // `id` is the primary key, so a duplicate `(tenant_id, id)` is necessarily
    // also a duplicate `id`: the PK (`nodes_pkey`) and the composite unique
    // (`nodes_tenant_id_key`) are coextensive on this table and cannot be
    // isolated from each other by an insert. Both raise 23505; asserting the
    // SQLSTATE is what the brief's "unique (tenant_id, id) rejects a duplicate"
    // check comes down to here. The composite constraint's DISTINCT role — a
    // tenant-consistent FK target for later tables — is verified by the
    // introspection test below, which is the only thing that tells it apart
    // from the PK.
    await db
      .insert(nodes)
      .values({ id: NODE_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "N" });
    const error = await captureError(() =>
      db
        .insert(nodes)
        .values({ id: NODE_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "N again" }),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("carries a unique constraint nodes_tenant_id_key on (tenant_id, id)", async () => {
    // The reason the constraint exists at all: a composite target so a fiscal or
    // commercial table can carry a tenant-consistent (tenant_id, node_id) FK —
    // the role invoice_series_tenant_id_key / sales_tenant_id_key already play.
    // The PK on (id) alone cannot serve as that target, so this asserts the pair
    // exists as a UNIQUE index by name, not merely that duplicates are rejected.
    const found = await rows<{ indexname: string; indexdef: string }>(
      db,
      sql`select indexname, indexdef from pg_indexes where tablename = 'nodes'`,
    );
    const composite = found.filter(
      (i) => /UNIQUE/i.test(i.indexdef) && /\(tenant_id, id\)/.test(i.indexdef),
    );
    expect(composite.map((i) => i.indexname)).toEqual(["nodes_tenant_id_key"]);
  });

  it("rejects a node whose location does not exist with a foreign-key violation", async () => {
    // The brief frames this as "a location_id belonging to another tenant", but
    // `nodes` carries no composite (tenant_id, location_id) FK to `locations`
    // (none is in scope — mirroring `tills`), so another tenant's location is a
    // perfectly valid FK target and would NOT be rejected. What the plain
    // `location_id -> locations.id` FK actually guarantees is referential
    // existence, so that is what is asserted: a location that does not exist is
    // rejected with 23503 (foreign_key_violation).
    const error = await captureError(() =>
      db.insert(nodes).values({ tenantId: TENANT_A, locationId: LOCATION_MISSING, name: "Orphan" }),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("enables and forces row level security", async () => {
    // ENABLE + FORCE, mirroring `tills` (0001_tenancy_rls.sql). FORCE, the
    // tenant-isolation policy and the app-role grants were added in
    // 0017_nodes_rls.sql now that the node_id rekey makes seven fiscal/commercial
    // tables FK `nodes` — the condition 0001 deferred FORCE on ("nothing FKs
    // nodes yet"). FORCE is inert against the superuser test connection, so it is
    // not the control that matters; the tenant-isolation policy the tests below
    // exercise is. relforcerowsecurity is now pinned true — a regression that
    // drops FORCE is caught here.
    const found = await rows<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      db,
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'nodes'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.relrowsecurity).toBe(true);
    expect(found[0]?.relforcerowsecurity).toBe(true);
  });

  it("returns only the calling tenant's nodes to the app role", async () => {
    // The read half of the 0017 tenant-isolation policy. No WHERE clause in the
    // reads — RLS is what scopes them, so a scoped query would pass with the
    // policy switched off, which is exactly why there is none. Runs against real
    // Postgres too (describeEachTarget): PGlite's connection is superuser and
    // bypasses FORCE RLS, so a PGlite-only pass would be a false pass (CLAUDE.md §4).
    await db.insert(nodes).values([
      { tenantId: TENANT_A, locationId: LOCATION_A, name: "Node A" },
      { tenantId: TENANT_B, locationId: LOCATION_B, name: "Node B" },
    ]);
    const seenByA = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(nodes);
    });
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]?.tenantId).toBe(TENANT_A);
    // The other tenant's node is invisible — the assertion that bites, and would
    // fail if the policy leaked or were absent.
    const seenByB = await withTenant(db, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(nodes);
    });
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]?.tenantId).toBe(TENANT_B);
  });

  it("lets the app role insert a node for its own tenant, and rejects a smuggled tenant id", async () => {
    // The GRANT INSERT + WITH CHECK half of the policy, mirroring tenancy.test.ts's
    // tills assertions. The positive insert is the one test that fails if app_user
    // cannot write nodes at all (an over-narrow grant); the negative proves WITH
    // CHECK stops a cross-tenant write.
    const inserted = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx
        .insert(nodes)
        .values({ tenantId: TENANT_A, locationId: LOCATION_A, name: "App node" })
        .returning({ id: nodes.id });
    });
    // Read back as the owner (superuser, bypasses RLS): a pure check on the write
    // path, not a second read-side RLS check.
    const [row] = await db.select().from(nodes).where(eq(nodes.id, inserted[0].id));
    expect(row?.tenantId).toBe(TENANT_A);

    // WITH CHECK rejects a node carrying another tenant's id.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx
          .insert(nodes)
          .values({ tenantId: TENANT_B, locationId: LOCATION_A, name: "smuggled" });
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/row-level security/i);
  });
});
