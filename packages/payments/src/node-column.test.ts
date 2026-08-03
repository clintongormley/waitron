import { CORE_MIGRATIONS, captureError, pgErrorCode } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

/**
 * node_id scaffolding (Task 3 of the node rekey): `payments` gains a NULLABLE `node_id` with a
 * plain FK to core's `nodes`, and stays nullable in this slice — no writer yet (design §5).
 *
 * PGlite (via usePgliteDb): a column-existence, nullability and FK-round-trip test, none of which
 * needs the non-superuser deployment role or lock contention that would require real Postgres
 * (CLAUDE.md §4). Each test seeds its own tenant (via `freshNif`), so payments accumulate in the
 * shared database without colliding on `payments_provider_ref_key`.
 */
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

/** Seeds tenant → location → till → working_order plus a node under that tenant/location. */
async function seedOrderWithNode(): Promise<{
  seeded: { tenantId: string; workingOrderId: string };
  node: string;
}> {
  const seeded = await seedWorkingOrder(pg.db, freshNif());
  const { rows } = await pg.db.execute<{ location_id: string }>(
    sql`select location_id from tills where id = ${seeded.tillId}`,
  );
  const node = await seedNode(
    pg.db,
    brandTenantId(seeded.tenantId),
    brandLocationId(rows[0]!.location_id),
  );
  return { seeded, node };
}

async function insertPayment(
  seeded: { tenantId: string; workingOrderId: string },
  paymentRef: string,
  nodeId: string | null,
): Promise<{ node_id: string | null }[]> {
  const { rows } = await pg.db.execute<{ node_id: string | null }>(sql`
    insert into payments (tenant_id, working_order_id, node_id, provider, payment_ref, amount, state)
    values (${seeded.tenantId}, ${seeded.workingOrderId}, ${nodeId}, 'fake', ${paymentRef}, '10.00', 'captured')
    returning node_id`);
  return rows;
}

describe("payments.node_id (node rekey scaffolding, Task 3)", () => {
  it("is a nullable column — a payment inserts without it", async () => {
    const { seeded } = await seedOrderWithNode();
    const meta = await pg.db.execute<{ is_nullable: string }>(
      sql`select is_nullable from information_schema.columns
           where table_name = 'payments' and column_name = 'node_id'`,
    );
    expect(meta.rows).toEqual([{ is_nullable: "YES" }]);
    const inserted = await insertPayment(seeded, "p-no-node", null);
    expect(inserted[0]?.node_id).toBeNull();
  });

  it("accepts a valid node id", async () => {
    const { seeded, node } = await seedOrderWithNode();
    const inserted = await insertPayment(seeded, "p-with-node", node);
    expect(inserted[0]?.node_id).toBe(node);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const { seeded } = await seedOrderWithNode();
    const error = await captureError(() => insertPayment(seeded, "p-bad-node", BOGUS_NODE));
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects a node_id belonging to another tenant with a foreign-key violation", async () => {
    // The composite (tenant_id, node_id) → nodes(tenant_id, id) FK bites: `foreign.node` EXISTS
    // but under a DIFFERENT tenant, so the (own tenant, foreign node) pair has no matching parent
    // row and the insert is rejected 23503. This is the tenant-consistency a plain single-column
    // node_id FK could NOT enforce — it would have accepted the cross-tenant node because the id
    // exists in `nodes`. Mirrors payments' own composite sale/working-order FKs and `sales_node_fk`.
    const own = await seedOrderWithNode();
    const foreign = await seedOrderWithNode();
    const error = await captureError(() =>
      insertPayment(own.seeded, "p-cross-tenant-node", foreign.node),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });
});
