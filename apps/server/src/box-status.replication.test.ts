import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { startLogicalPostgresContainer } from "@waitron/db/testing/postgres.js";
import type { StartedContainer } from "@waitron/db/testing/postgres.js";
import { listSlots, readSubscriptionStatus, subscriptionName } from "@waitron/sync";
import { collectBoxStatus, type BoxStatusReaders } from "./box-status.js";

// The swap S4 replication cell proven against a REAL logical node. A PRIMARY is a publisher and lists its
// peers' slots (`listSlots`); a MIRROR is a subscriber (`readSubscriptionStatus`). The unit suite
// (box-status.test.ts) proves the cell MAPPING over canned reader output; this proves the readers are
// honest against actual `pg_replication_slots`. `startLogicalPostgresContainer` — PGlite has no slots
// (CLAUDE.md §4).
const PEER_NODE_ID = "44444444-4444-4444-8444-444444444444";
const SLOT = subscriptionName("preproduction", PEER_NODE_ID);

function baseReaders(over: Partial<BoxStatusReaders>): BoxStatusReaders {
  return {
    mode: async () => "primary",
    singletonRole: async () => "primary",
    environment: "preproduction",
    time: async () => ({ synced: true, source: "timedatectl", warn: false }),
    cert: undefined,
    awaitingFiscalCertificate: () => false,
    chain: async () => ({ height: 0, lastAt: null }),
    replicationSlots: undefined,
    replicationSubscription: undefined,
    disposal: undefined,
    backup: undefined,
    duties: () => ({}),
    ...over,
  };
}

describe("box-status replication cell over a real logical slot", () => {
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

  it("reports a primary with no slots as a publisher with an empty slot list", async () => {
    const status = await collectBoxStatus(baseReaders({ replicationSlots: () => listSlots(db!) }));
    expect(status.replication).toEqual({ configured: true, role: "publisher", slots: [] });
  });

  it("lists a seeded slot as an inactive publisher slot", async () => {
    await db!.execute(sql`select pg_create_logical_replication_slot(${SLOT}, 'pgoutput')`);
    const status = await collectBoxStatus(baseReaders({ replicationSlots: () => listSlots(db!) }));
    expect(status.replication).toMatchObject({ configured: true, role: "publisher" });
    const rep = status.replication as {
      configured: true;
      role: "publisher";
      slots: { peer: string; active: boolean }[];
    };
    const slot = rep.slots.find((s) => s.peer === SLOT);
    expect(slot).toBeDefined();
    expect(slot!.active).toBe(false); // a manual slot has no consumer
    await db!.execute(sql`select pg_drop_replication_slot(${SLOT})`); // clean up for suite isolation
  });

  it("reports a MIRROR's subscription as a subscriber cell (absent subscription → not enabled)", async () => {
    // A mirror reader over `readSubscriptionStatus`; with no subscription created the reader still returns
    // an `exists:false` shape, which maps to a subscriber cell reporting disabled/zero — proving the
    // subscriber branch and the `publications` passthrough wire up (I6).
    const status = await collectBoxStatus(
      baseReaders({
        mode: async () => "mirror",
        replicationSubscription: () =>
          readSubscriptionStatus(db!, subscriptionName("preproduction", PEER_NODE_ID)),
      }),
    );
    expect(status.replication).toEqual({
      configured: true,
      role: "subscriber",
      enabled: false,
      workerUp: false,
      tablesReady: 0,
      tablesTotal: 0,
      applyErrorCount: 0,
      syncErrorCount: 0,
      publications: [],
    });
  });
});
