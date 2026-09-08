import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { startLogicalPostgresContainer } from "@waitron/db/testing/postgres.js";
import type { StartedContainer } from "@waitron/db/testing/postgres.js";
import { isDrained, readSlotDrain, subscriptionName } from "@waitron/sync";

// The swap S4 drain guard proven against a REAL logical replication slot (Ruling C2). The unit suites
// (retire.test.ts / rejoin.test.ts) prove the guard LOGIC over `SlotDrain` fixtures; this proves the
// fixtures are honest — that `readSlotDrain` + `isDrained(d, fenceLsn) && !d.active` actually flips from
// "not drained" to "drained" when the carrier's slot advances past the fence LSN a fenced box recorded.
//
// A single node booted with `wal_level=logical` (`startLogicalPostgresContainer`): a MANUALLY created
// logical slot is inactive and its `confirmed_flush_lsn` is driven by `pg_replication_slot_advance`, so
// no peer is needed. CLAUDE.md §4 — PGlite cannot model a replication slot at all.
const CARRIER_NODE_ID = "11111111-1111-4111-8111-111111111111";
const SLOT = subscriptionName("preproduction", CARRIER_NODE_ID);

describe("the fence-LSN drain guard over a real logical slot", () => {
  let container: StartedContainer | undefined;
  let db: Database | undefined;

  beforeAll(async () => {
    container = await startLogicalPostgresContainer();
    db = await createPostgresDb(container.uri);
  }, 120_000);

  afterAll(async () => {
    if (db !== undefined) await db.close();
    if (container !== undefined) await container.stop();
  });

  it("reads not-drained while confirmed_flush lags the fence LSN, then drained once the slot advances past it", async () => {
    // 1. Seed a logical slot — inactive, no consumer. Its confirmed_flush starts at the creation LSN.
    await db!.execute(sql`select pg_create_logical_replication_slot(${SLOT}, 'pgoutput')`);

    // 2. Produce WAL AFTER the slot so current_wal (and the fence LSN we capture) is ahead of the slot's
    //    confirmed_flush — the state a fenced ex-primary is in the moment it records its fence.
    await db!.execute(sql.raw(`create table fence_probe (x int)`));
    await db!.execute(sql.raw(`insert into fence_probe select generate_series(1, 5000)`));
    const fence = (
      await db!.execute<{ lsn: string }>(sql`select pg_current_wal_lsn()::text as lsn`)
    ).rows[0]!.lsn;

    // 3. Before the drain: the slot's confirmed_flush is behind the fence LSN, and the slot is inactive.
    const before = await readSlotDrain(db!, SLOT);
    expect(before.exists).toBe(true);
    expect(before.active).toBe(false); // no consumer attached to a manual slot
    expect(isDrained(before, fence)).toBe(false); // confirmed_flush < fence_lsn
    expect(isDrained(before, fence) && !before.active).toBe(false); // the guard: NOT drained

    // 4. Advance the slot past the fence LSN — the carrier confirming it applied this node's tail.
    await db!.execute(sql`select pg_replication_slot_advance(${SLOT}, ${fence}::pg_lsn)`);

    // 5. After the drain: confirmed_flush has passed the fence LSN and the slot is still inactive, so the
    //    guard reads DRAINED — the exact transition the retire/rejoin guards gate the irreversible steps on.
    const after = await readSlotDrain(db!, SLOT);
    expect(after.active).toBe(false);
    expect(isDrained(after, fence)).toBe(true); // confirmed_flush >= fence_lsn
    expect(isDrained(after, fence) && !after.active).toBe(true); // the guard: DRAINED
  });
});
