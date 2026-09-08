import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { startLogicalPostgresContainer } from "@waitron/db/testing/postgres.js";
import type { StartedContainer } from "@waitron/db/testing/postgres.js";
import { isDrained, readSlotDrain, subscriptionName } from "@waitron/sync";
import { collectBoxStatus, type BoxStatusReaders, type DisposalStatus } from "./box-status.js";

// The swap S4 disposal cell proven against a REAL logical slot. `drained` is `isDrained(slot, fenceLsn)`,
// computed by the boot-wired reader; box-status maps it onto the wire. Before the slot advances past the
// fence LSN the cell reads `drained:false`; after `pg_replication_slot_advance` it reads `drained:true`.
// `startLogicalPostgresContainer` — PGlite has no slots (CLAUDE.md §4).
const CARRIER_NODE_ID = "55555555-5555-4555-8555-555555555555";
const SLOT = subscriptionName("preproduction", CARRIER_NODE_ID);

function baseReaders(disposal: (() => Promise<DisposalStatus>) | undefined): BoxStatusReaders {
  return {
    mode: async () => "primary",
    singletonRole: async () => "secondary",
    environment: "preproduction",
    time: async () => ({ synced: true, source: "timedatectl", warn: false }),
    cert: undefined,
    awaitingFiscalCertificate: () => false,
    chain: async () => ({ height: 0, lastAt: null }),
    replicationSlots: undefined,
    replicationSubscription: undefined,
    disposal,
    backup: undefined,
    duties: () => ({}),
  };
}

// The boot-wired disposal reader: read the carrier's slot on this node and fold in `isDrained` against
// the fence LSN, exactly as boot.ts assembles `readDisposal`.
function disposalReader(db: Database, fenceLsn: string): () => Promise<DisposalStatus> {
  return async () => {
    const d = await readSlotDrain(db, SLOT);
    return {
      carrierNodeId: CARRIER_NODE_ID,
      drained: isDrained(d, fenceLsn) && !d.active,
      active: d.active,
      walStatus: d.walStatus,
      retainedBytes: d.retainedBytes,
    };
  };
}

describe("box-status disposal cell over a real logical slot", () => {
  let container: StartedContainer | undefined;
  let db: Database | undefined;
  let fence: string;

  beforeAll(async () => {
    container = await startLogicalPostgresContainer();
    db = await createPostgresDb(container.uri);
    await db.execute(sql`select pg_create_logical_replication_slot(${SLOT}, 'pgoutput')`);
    await db.execute(sql.raw(`create table disposal_probe (x int)`));
    await db.execute(sql.raw(`insert into disposal_probe select generate_series(1, 5000)`));
    fence = (await db.execute<{ lsn: string }>(sql`select pg_current_wal_lsn()::text as lsn`))
      .rows[0]!.lsn;
  }, 120_000);

  afterAll(async () => {
    if (db !== undefined) await db.close();
    if (container !== undefined) await container.stop();
  });

  it("reports drained:false while confirmed_flush lags the fence LSN", async () => {
    const status = await collectBoxStatus(baseReaders(disposalReader(db!, fence)));
    expect(status.disposal).toMatchObject({
      applicable: true,
      carrierNodeId: CARRIER_NODE_ID,
      drained: false,
      active: false,
    });
  });

  it("reports drained:true once the slot advances past the fence LSN", async () => {
    await db!.execute(sql`select pg_replication_slot_advance(${SLOT}, ${fence}::pg_lsn)`);
    const status = await collectBoxStatus(baseReaders(disposalReader(db!, fence)));
    expect(status.disposal).toMatchObject({
      applicable: true,
      carrierNodeId: CARRIER_NODE_ID,
      drained: true,
      active: false,
    });
  });
});
