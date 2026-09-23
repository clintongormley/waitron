import { CORE_MIGRATIONS, FOREIGN_KEY_VIOLATION, captureError, isPgError } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

/**
 * node_id scaffolding (Task 3 of the node rekey): `payments` gains a NULLABLE `node_id` with a
 * plain FK to core's `nodes`, and stays nullable in this slice — no writer yet (design §5).
 *
 * One venue file (`useVenueDb`): a column-existence, nullability and FK-round-trip test, none of
 * which turns on who is connected or on two writers contending. The FK half is only refused
 * because the venue store opens every connection with `pragma foreign_keys = on`
 * (`packages/store/src/index.ts`) — SQLite checks no foreign key without it.
 */
const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

/** Seeds tenant → location → till → working_order plus a node under that tenant/location. */
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
 * Inserts one payment by hand, naming `id`, `created_at` and `updated_at` as well.
 *
 * Those three were omitted here because PostgreSQL filled them: `id` had `defaultRandom()` and the
 * two timestamps `defaultNow()`. Neither survives the storage switch. `packages/db/src/schema/columns.ts`
 * generates both in JavaScript through drizzle's `$defaultFn`, which is not a SQL DEFAULT — so a row
 * written by raw SQL rather than through drizzle gets nothing, and the generated table says so:
 * `id text PRIMARY KEY NOT NULL` with no default clause (`packages/payments/drizzle/0000_baseline.sql`).
 * Measured: without the three, this insert was refused with `NOT NULL constraint failed: payments.id`.
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
    // `pragma table_info` as a table-valued function, in place of `information_schema.columns`,
    // which is answered here with `no such table: information_schema.columns`. It is the same
    // replacement the sibling suite made (`./migrations.test.ts`'s `columnsOf`), and it reports
    // nullability the other way round: `notnull` is 1 for a NOT NULL column and 0 otherwise, so
    // `0` is what `is_nullable = 'YES'` used to say. The row list is still compared whole, so a
    // column that vanished returns `[]` and fails rather than matching nothing.
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
    // `isPgError(..., FOREIGN_KEY_VIOLATION)` rather than the SQLSTATE literal `23503`. This engine
    // has no SQLSTATEs: `node:sqlite` sets `code` to `"ERR_SQLITE_ERROR"` on every failure alike and
    // puts the discriminating extended result code on `errcode` — measured, the assertion read
    // `'ERR_SQLITE_ERROR'` where it wanted `'23503'`. `FOREIGN_KEY_VIOLATION`
    // (`packages/db/src/sql-state.ts`) is the class, and this is the idiom the package's own
    // foreign-key suites already use (`./schema/payments-reader-id.fk.test.ts`).
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
