import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parties, partyTables } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { memberTables, partyZone } from "./parties.js";
import { partyWatchZones } from "./watch-zones.js";
import { listTablesWithState } from "./working-order.js";
import { inTx, OPERATOR, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function joinedTables(secondJoinedAt: string) {
  const suffix = randomUUID().slice(1);
  const first = await v.table(`First ${suffix}`, v.tables.zoneId);
  const second = await v.table(`Second ${suffix}`, v.counter.zoneId);
  const partyId = await inTx(v, async (tx) => {
    const [party] = await tx.insert(parties).values({ openedBy: OPERATOR }).returning();
    await tx.insert(partyTables).values({
      id: `f${suffix}`,
      partyId: party!.id,
      tableId: first,
      joinedAt: "2026-10-14T12:00:00.000Z",
    });
    await tx.insert(partyTables).values({
      id: `0${suffix}`,
      partyId: party!.id,
      tableId: second,
      joinedAt: secondJoinedAt,
    });
    return party!.id;
  });
  return { partyId, first, second };
}

describe("party table join order", () => {
  it("lists same-millisecond memberships by writing order, against their ids", async () => {
    const { partyId, first, second } = await joinedTables("2026-10-14T12:00:00.000Z");
    expect(await inTx(v, (tx) => memberTables(tx, partyId))).toEqual([first, second]);
  });

  it("chooses the first-written table's zone when join times tie", async () => {
    const { partyId } = await joinedTables("2026-10-14T12:00:00.000Z");
    expect(await inTx(v, (tx) => partyZone(tx, v.cfg, partyId))).toBe(v.tables.zoneId);
  });

  it("watches the first-written table's zone when join times tie", async () => {
    const { partyId } = await joinedTables("2026-10-14T12:00:00.000Z");
    expect(await inTx(v, (tx) => partyWatchZones(tx, v.cfg, [partyId]))).toEqual(
      new Map([[partyId, v.tables.zoneId]]),
    );
  });

  it("lists seated party tables by writing order when join times tie", async () => {
    const { partyId, first, second } = await joinedTables("2026-10-14T12:00:00.000Z");
    const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
    for (const tableId of [first, second]) {
      expect(floor.find((table) => table.id === tableId)!.party).toMatchObject({
        id: partyId,
        tableIds: [first, second],
      });
    }
  });

  it("still puts an earlier join time before writing order", async () => {
    const { partyId, first, second } = await joinedTables("2026-10-14T11:59:59.999Z");
    expect(await inTx(v, (tx) => memberTables(tx, partyId))).toEqual([second, first]);
    expect(await inTx(v, (tx) => partyZone(tx, v.cfg, partyId))).toBe(v.counter.zoneId);
    expect(await inTx(v, (tx) => partyWatchZones(tx, v.cfg, [partyId]))).toEqual(
      new Map([[partyId, v.counter.zoneId]]),
    );
    const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
    expect(floor.find((table) => table.id === first)!.party!.tableIds).toEqual([second, first]);
  });
});
