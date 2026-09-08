import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { startLogicalPostgresContainer } from "@waitron/db/testing/postgres.js";
import type { StartedContainer } from "@waitron/db/testing/postgres.js";
import { databaseUrl } from "@waitron/db/testing/postgres.js";
import { withRole } from "@waitron/provisioning";
import { readSlotDrain, subscriptionName } from "@waitron/sync";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import { dropAndCreateDatabase } from "./db-wipe.js";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";
import { clearTradingEnv, writeTradingEnv } from "./trading-config.js";

// End-to-end proof of the swap S4 rejoin wipe against a REAL logical slot (Ruling I3 / probe F): the
// `DROP DATABASE … WITH (FORCE)` reclaims the target's INACTIVE logical slot for free — so rejoin does NO
// slot drop of its own — and recreates the database migrator-owned, with `trading.env` cleared so the
// next boot enters setup mode. A single `wal_level=logical` node; the fenced ex-primary's slot is created
// manually and advanced past the fence LSN so the drain guard passes. CLAUDE.md §4/§5.
const CARRIER_NODE_ID = "22222222-2222-4222-8222-222222222222";
const NODE_ID = "33333333-3333-4333-8333-333333333333";
const SLOT = subscriptionName("preproduction", CARRIER_NODE_ID);
const TARGET_DB = "rejoin_e2e_target";

function fencedHeld(): SignedMembershipDocument {
  const nodes: MembershipNode[] = [
    { nodeId: NODE_ID, contactUrl: "", standing: "sell-only" },
    { nodeId: CARRIER_NODE_ID, contactUrl: "https://carrier", standing: "serving-primary" },
  ];
  return {
    body: { term: 3, nodes },
    signerNodeId: CARRIER_NODE_ID,
    signature: "sig",
    endorsements: [],
  };
}

describe("rejoinAsSecondary end-to-end wipe (real logical postgres)", () => {
  let container: StartedContainer | undefined;
  let adminUri: string; // superuser on the default maintenance db (a DIFFERENT db from the target)
  let admin: Database | undefined;

  beforeAll(async () => {
    container = await startLogicalPostgresContainer();
    adminUri = container.uri;
    admin = await createPostgresDb(adminUri);
    // A LOGIN NOCREATEDB migrator-owner (probe A) and the target database it owns.
    await admin.execute(sql.raw(`create role wipe_migrator login nocreatedb`));
    await admin.execute(sql.raw(`create database ${TARGET_DB} owner wipe_migrator`));
  }, 120_000);

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (container !== undefined) await container.stop();
  });

  it("passes the drain guard, drops the db reclaiming the slot, recreates it migrator-owned, and clears trading.env", async () => {
    const targetUri = databaseUrl(adminUri, TARGET_DB);
    // A connection ON the target db that holds the slot and reads the drain — closed before the wipe.
    const targetConn = await createPostgresDb(targetUri);
    await targetConn.execute(sql`select pg_create_logical_replication_slot(${SLOT}, 'pgoutput')`);
    await targetConn.execute(sql.raw(`create table drain_probe (x int)`));
    await targetConn.execute(sql.raw(`insert into drain_probe select generate_series(1, 5000)`));
    const fence = (
      await targetConn.execute<{ lsn: string }>(sql`select pg_current_wal_lsn()::text as lsn`)
    ).rows[0]!.lsn;
    await targetConn.execute(sql`select pg_replication_slot_advance(${SLOT}, ${fence}::pg_lsn)`);

    // A trading.env in a temp state dir — the wipe clears it so the next boot enters setup mode.
    const stateDir = mkdtempSync(join(tmpdir(), "rejoin-e2e-"));
    await writeTradingEnv(stateDir, {
      tenantId: "t",
      tillId: "till",
      nodeId: NODE_ID,
      seriesId: "s",
      locationId: "l",
      databaseUrl: targetUri,
      migrationsDatabaseUrl: targetUri,
      environment: "preproduction",
    });
    expect(existsSync(join(stateDir, "trading.env"))).toBe(true);

    const deps: RejoinDeps = {
      held: fencedHeld(),
      nodeId: NODE_ID,
      readSlotDrain: () => readSlotDrain(targetConn, SLOT),
      fenceLsn: fence,
      acceptLoss: false,
      // Close our own connection to the target BEFORE the FORCE drop (it would otherwise terminate it).
      closePreWipe: () => targetConn.close(),
      wipeDatabase: async () => {
        const dropAs = await createPostgresDb(withRole(adminUri, "wipe_migrator")); // owner, no CREATEDB
        try {
          await dropAndCreateDatabase({
            dropAs,
            createAs: admin!, // superuser holding CREATEDB
            database: TARGET_DB,
            owner: "wipe_migrator",
          });
        } finally {
          await dropAs.close();
        }
        await clearTradingEnv(stateDir);
      },
      log: () => {},
    };

    const result = await rejoinAsSecondary(deps);
    expect(result).toEqual({ wiped: true, carrierNodeId: CARRIER_NODE_ID });

    // The DROP DATABASE FORCE reclaimed the inactive slot with the database (probe F) — no slot drop of
    // our own. Slots are cluster-wide but a logical slot belongs to its database, so it is gone now.
    const slots = await admin!.execute<{ slot_name: string }>(
      sql`select slot_name from pg_replication_slots where slot_name = ${SLOT}`,
    );
    expect(slots.rows).toEqual([]);

    // The database was recreated OWNED by the migrator (the OWNER clause), empty (no drain_probe table),
    // and trading.env is gone so the next boot enters setup mode.
    const owner = await admin!.execute<{ owner: string }>(
      sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${TARGET_DB}`,
    );
    expect(owner.rows[0]?.owner).toBe("wipe_migrator");
    const fresh = await createPostgresDb(databaseUrl(adminUri, TARGET_DB));
    const present = await fresh.execute<{ present: boolean }>(
      sql`select exists (select 1 from information_schema.tables where table_name = 'drain_probe') as present`,
    );
    expect(present.rows[0]?.present).toBe(false);
    await fresh.close();
    expect(existsSync(join(stateDir, "trading.env"))).toBe(false);
  });
});
