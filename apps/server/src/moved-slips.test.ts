import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayJoins, floorTodayTables } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { kitchenNotices } from "@waitron/venue-service";
import { writeMerge } from "./floor-today-merges.js";
import { withMovedSlips, type MovedSlipsReach, type SlipsLater } from "./moved-slips.js";
import { inTx, order, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

const suffixed = (name: string) => `${name} ${randomUUID().slice(0, 6)}`;

/** The kitchen notices recorded against the bills, oldest first. */
async function noticesOn(billIds: string[]) {
  return inTx(v, (tx) =>
    tx
      .select({
        workingOrderId: kitchenNotices.workingOrderId,
        kind: kitchenNotices.kind,
        movedTo: kitchenNotices.movedTo,
      })
      .from(kitchenNotices)
      .where(inArray(kitchenNotices.workingOrderId, billIds))
      .orderBy(kitchenNotices.createdAt, sql`rowid`),
  );
}

const renameToday = (tx: Transaction, tableId: string, name: string) =>
  tx.update(floorTodayTables).set({ name }).where(eq(floorTodayTables.tableId, tableId));

/** A party at Table A with a Burger sent to the kitchen. */
async function partyWithBurger() {
  const { table } = await plannedZone(v, [{ key: "a", label: "Table A", seats: 4 }]);
  const guests = await seat(v, table.a!);
  await order(v, guests.tabId, "Burger");
  return { tableId: table.a!, ...guests };
}

/** `reach` around a write that renames `tableId` for today. */
function renameUnder(reach: MovedSlipsReach | null, tableId: string, name: string) {
  return inTx(v, (tx) =>
    withMovedSlips(tx, v.cfg, reach, async () => {
      await renameToday(tx, tableId, name);
    }),
  );
}

describe("withMovedSlips", () => {
  it("a reach by party tells the kitchen once that the party's bill moved", async () => {
    const { tableId, partyId, tabId } = await partyWithBurger();
    const name = suffixed("Window");

    await renameUnder({ parties: [partyId] }, tableId, name);

    expect(await noticesOn([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", movedTo: name },
    ]);
  });

  it("a reach by table finds the party through the table it holds", async () => {
    const { tableId, tabId } = await partyWithBurger();
    const name = suffixed("Window");

    await renameUnder({ tables: [tableId] }, tableId, name);

    expect(await noticesOn([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", movedTo: name },
    ]);
  });

  it("no reach runs the write and tells the kitchen nothing", async () => {
    const { tableId, tabId } = await partyWithBurger();
    const name = suffixed("Window");

    await renameUnder(null, tableId, name);

    expect((await todayRow(v, tableId))!.name).toBe(name);
    expect(await noticesOn([tabId])).toEqual([]);
  });

  it("an inner call given the outer's slips writes into them and leaves the telling to the outer, once", async () => {
    const { tableId, partyId, tabId } = await partyWithBurger();
    const name = suffixed("Window");
    const notABill = randomUUID();
    const into = randomUUID();
    let outer: SlipsLater | undefined;

    const answer = await inTx(v, (tx) =>
      withMovedSlips(tx, v.cfg, { parties: [partyId] }, async (slips) => {
        outer = slips;
        return withMovedSlips(tx, v.cfg, { later: slips }, async (inner) => {
          expect(inner).toBe(slips);
          inner.mergedInto.set(notABill, into);
          await renameToday(tx, tableId, name);
          return "inner's answer";
        });
      }),
    );

    expect(answer).toBe("inner's answer");
    expect(outer!.mergedInto.get(notABill)).toBe(into);
    expect(await noticesOn([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", movedTo: name },
    ]);
  });

  describe("targetGroupOf", () => {
    /** A party at Counter 6 with a Burger sent, then free Table 9 pushed onto Counter 6. */
    async function groupWithParty() {
      const { table } = await plannedZone(v, [
        { key: "c6", label: "Counter 6", seats: 2, place: { x: 60, y: 0, width: 2, height: 2 } },
        { key: "t9", label: "Table 9", seats: 4, place: { x: 70, y: 0, width: 2, height: 2 } },
      ]);
      const guests = await seat(v, table.c6!);
      await order(v, guests.tabId, "Burger");
      await inTx(v, (tx) =>
        writeMerge(tx, v.cfg, {
          movingId: table.t9!,
          targetId: table.c6!,
          side: "right",
          seats: 6,
          free: false,
        }),
      );
      const merge = (await mergeOf(v, table.t9!))!;
      return { table, merge, ...guests };
    }

    const nameGroup = (tx: Transaction, joinId: string, name: string) =>
      tx.update(floorTodayJoins).set({ name }).where(eq(floorTodayJoins.id, joinId));

    it("reaches the party at another table of the group", async () => {
      const { table, merge, tabId } = await groupWithParty();
      const name = suffixed("Fiesta");

      await inTx(v, (tx) =>
        withMovedSlips(tx, v.cfg, { tables: [table.t9!], targetGroupOf: table.t9! }, () =>
          nameGroup(tx, merge.joinId, name),
        ),
      );

      expect(await noticesOn([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", movedTo: name },
      ]);
    });

    it("without it, a free table of the group reaches nobody", async () => {
      const { table, merge, tabId } = await groupWithParty();

      await inTx(v, (tx) =>
        withMovedSlips(tx, v.cfg, { tables: [table.t9!] }, () =>
          nameGroup(tx, merge.joinId, suffixed("Fiesta")),
        ),
      );

      expect(await noticesOn([tabId])).toEqual([]);
    });
  });
});
