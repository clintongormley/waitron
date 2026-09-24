import { CORE_MIGRATIONS, FOREIGN_KEY_VIOLATION, captureError, isRefusal } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

/**
 * The FK half is only refused because the venue store opens its WRITE connection with
 * `pragma foreign_keys = on` (`packages/store/src/index.ts`); SQLite checks no foreign key without
 * it.
 */
const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

async function seedOrderWithNode(): Promise<{
  seeded: { workingOrderId: string };
  node: string;
}> {
  const seeded = await seedWorkingOrder(pg.db, freshNif());
  const { rows } = await pg.db.execute<{ location_id: string }>(
    sql`select location_id from tills where id = ${seeded.tillId}`,
  );
  const node = await seedNode(pg.db, brandLocationId(rows[0]!.location_id));
  return { seeded, node };
}

/**
 * Names `id`, `created_at` and `updated_at` because drizzle generates them through `$defaultFn`,
 * which is not a SQL DEFAULT, so a raw-SQL insert gets none of them.
 */
async function insertPayment(
  seeded: { workingOrderId: string },
  paymentRef: string,
  nodeId: string | null,
): Promise<{ node_id: string | null }[]> {
  const stamp = new Date().toISOString();
  const { rows } = await pg.db.execute<{ node_id: string | null }>(sql`
    insert into payments (id, working_order_id, node_id, provider, payment_ref, amount, state, created_at, updated_at)
    values (${randomUUID()}, ${seeded.workingOrderId}, ${nodeId}, 'fake', ${paymentRef}, 1000, 'captured', ${stamp}, ${stamp})
    returning node_id`);
  return rows;
}

describe("payments.node_id (node rekey scaffolding, Task 3)", () => {
  it("is a nullable column — a payment inserts without it", async () => {
    const { seeded } = await seedOrderWithNode();
    // Compared whole, so a column that vanished returns `[]` and fails rather than matching nothing.
    const meta = await pg.db.execute<{ notnull: number }>(
      sql`select "notnull" from pragma_table_info('payments') where name = 'node_id'`,
    );
    expect(meta.rows).toEqual([{ notnull: 0 }]);
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
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
