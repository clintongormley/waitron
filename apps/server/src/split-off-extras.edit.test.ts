import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setStationToday, writePrintHeldWork } from "@waitron/venue-service";
import { decodeTicket } from "./testing/decode-ticket.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { OPERATOR } from "./testing/party-venue.js";
import { addTabRound, recallLines, updateHeldOrder, updateOrderLine } from "./working-order.js";
import { fireGroup, placeGroups } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});
type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
type Dish = "burger" | "water";
function line(venue: Venue, dish: Dish, quantity = "1", chips = 0, rings = 0) {
  const picks = [
    ...(chips ? [{ productId: venue.products.chips, quantity: chips }] : []),
    ...(rings ? [{ productId: venue.products.onionRings, quantity: rings }] : []),
  ];
  return {
    menuItemId: venue.tables.offerFor(venue.products[dish]),
    quantity,
    ...(picks.length ? { extras: [{ listId: venue.lists[dish], picks }] } : {}),
  };
}
async function state(tx: Transaction, id: string) {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  const items = await tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, id));
  return { lines, items };
}
async function slips(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));
}
async function revision(tx: Transaction, id: string) {
  return (
    await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id))
  )[0]!.revision;
}
async function edit(
  tx: Transaction,
  venue: Venue,
  lineNo: number,
  patch: Parameters<typeof updateOrderLine>[4],
) {
  return updateOrderLine(
    tx,
    venue.cfg,
    venue.party.tabId,
    lineNo,
    patch,
    await revision(tx, venue.party.tabId),
    OPERATOR,
  );
}
async function removeFirst(venue: Venue) {
  const id = venue.party.tabId;
  const { rows, currentRevision } = await withTransaction(db, async (tx) => ({
    rows: (await state(tx, id)).lines.filter((row) => row.parentLineId === null),
    currentRevision: await revision(tx, id),
  }));
  return updateHeldOrder({ db }, venue.cfg, id, {
    revision: currentRevision,
    operatorId: OPERATOR,
    lines: [{ ...line(venue, "water"), workingOrderLineId: rows[1]!.id }],
  });
}

describe("editing split-off extras", () => {
  it("recalls and resends a changed fired burger and its chips at their stations", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      const old = (await state(tx, id)).items;
      await edit(tx, venue, 1, { note: "No salt" });
      const current = await state(tx, id);
      expect(current.items.map((item) => item.id)).not.toContain(
        old.find((item) => item.stationId === venue.stations.fryer)!.id,
      );
      expect(current.items.map((item) => item.stationId).sort()).toEqual(
        [venue.stations.fryer, venue.stations.grill].sort(),
      );
      expect((await slips(tx, venue.printers.grill)).join("\n")).toContain("RECALLED");
      expect((await slips(tx, venue.printers.fryer)).join("\n")).toContain("RECALLED");
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("voids removed chips while recalling and resending a changed burger", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      await edit(tx, venue, 1, { note: "No salt", extras: [] });
      expect((await state(tx, id)).items.map((item) => item.stationId)).toEqual([
        venue.stations.grill,
      ]);
      expect((await slips(tx, venue.printers.fryer)).join("\n")).toContain("VOID");
      expect((await slips(tx, venue.printers.grill)).join("\n")).toContain("RECALLED");
      expect((await slips(tx, venue.printers.grill)).at(-1)).not.toContain("CHIPS");
    });
  });

  it("routes chips added to a fired burger to Fryer", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      await edit(tx, venue, 1, { extras: line(venue, "burger", "1", 1).extras });
      expect((await state(tx, id)).items.map((item) => item.stationId).sort()).toEqual(
        [venue.stations.fryer, venue.stations.grill].sort(),
      );
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("voids the dropped chips quantity and scales its record", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "2", 2)]);
      await edit(tx, venue, 1, { quantity: "1" });
      expect(
        (await state(tx, id)).items.find((item) => item.stationId === venue.stations.fryer)
          ?.quantity,
      ).toBe(2000);
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("VOID");
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("2");
    });
  });

  it("holds chips added to a printed held burger and prints HOLD CHANGED at Fryer", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger")], release: "hold" }],
      });
      await edit(tx, venue, 1, { extras: line(venue, "burger", "1", 1).extras });
      const chips = (await state(tx, venue.party.tabId)).items.find(
        (item) => item.stationId === venue.stations.fryer,
      );
      expect(chips?.firedAt).toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("HOLD CHANGED");
    });
  });

  it("raises held burger and chips records proportionally with corrections at both stations", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 2)], release: "hold" }],
      });
      await edit(tx, venue, 1, { quantity: "2" });
      expect(
        (await state(tx, venue.party.tabId)).items.find(
          (item) => item.stationId === venue.stations.fryer,
        )?.quantity,
      ).toBe(4000);
      expect((await slips(tx, venue.printers.grill)).at(-1)).toContain("HOLD CHANGED");
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("+2");
    });
  });

  it("raises a held routed extra beside an inline extra without a record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            lines: [
              {
                ...line(venue, "burger"),
                extras: [
                  {
                    listId: venue.lists.burger,
                    picks: [
                      { productId: venue.products.chips, quantity: 1 },
                      { productId: venue.products.cheese, quantity: 1 },
                    ],
                  },
                ],
              },
            ],
            release: "hold",
          },
        ],
      });
      await edit(tx, venue, 1, { quantity: "2" });
      const items = (await state(tx, venue.party.tabId)).items;
      expect(items.find((item) => item.stationId === venue.stations.fryer)?.quantity).toBe(2000);
      expect(items).toHaveLength(2);
    });
  });

  it("refuses changing a burger when its chips have started", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      const chips = (await state(tx, id)).items.find(
        (item) => item.stationId === venue.stations.fryer,
      )!;
      await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, chips.id));
      await expect(edit(tx, venue, 1, { note: "No salt" })).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: chips.id },
      });
      expect((await state(tx, id)).items.find((item) => item.id === chips.id)?.state).toBe(
        "preparing",
      );
      expect((await state(tx, id)).lines.find((row) => row.parentLineId === null)?.note).toBeNull();
    });
  });

  it("keeps chips with the dish after Fryer closes without fallback", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      await setStationToday(tx, venue.cfg, venue.stations.fryer, "closed", new Date());
      await edit(tx, venue, 1, { note: "No salt" });
      expect((await state(tx, id)).items.map((item) => item.stationId)).toEqual([
        venue.stations.grill,
      ]);
      expect((await slips(tx, venue.printers.grill)).at(-1)).toContain("+ Chips");
    });
  });

  it("edits a sent water with fired chips without a dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 2)]);
      const old = (await state(tx, id)).items[0]!;
      await edit(tx, venue, 1, { note: "Cold" });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.id).not.toBe(old.id);
      expect(items[0]!.stationId).toBe(venue.stations.fryer);
      expect((await slips(tx, venue.printers.fryer)).join("\n")).toContain("RECALLED");
    });
  });

  it("drops sent water with chips and voids only at Fryer", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water", "2", 1)]);
      await edit(tx, venue, 1, { quantity: "1" });
      expect((await state(tx, id)).items[0]?.quantity).toBe(1000);
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("VOID");
      expect(await slips(tx, venue.printers.grill)).toEqual([]);
    });
  });

  it("voids a removed sent water's chips only at Fryer", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, (tx) =>
      addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 2), line(venue, "water")]),
    );
    const before = await withTransaction(
      db,
      async (tx) => (await slips(tx, venue.printers.fryer)).length,
    );
    await removeFirst(venue);
    await withTransaction(db, async (tx) => {
      expect((await state(tx, id)).items).toEqual([]);
      const after = await slips(tx, venue.printers.fryer);
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toContain("VOID");
      expect(await slips(tx, venue.printers.grill)).toEqual([]);
    });
  });

  it("cancels both stations when a printed held burger with chips is removed", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1), line(venue, "water")], release: "hold" }],
      });
    });
    await removeFirst(venue);
    await withTransaction(db, async (tx) => {
      expect((await slips(tx, venue.printers.grill)).at(-1)).toContain("HOLD CANCELLED");
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("HOLD CANCELLED");
      expect((await state(tx, id)).items).toEqual([]);
    });
  });

  it("cancels held chips removed from a printed held burger", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1)], release: "hold" }],
      });
      await edit(tx, venue, 1, { extras: [] });
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("HOLD CANCELLED");
      expect((await state(tx, id)).items.map((item) => item.stationId)).toEqual([
        venue.stations.grill,
      ]);
    });
  });

  it("raises a held water's chips without creating a dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2)], release: "hold" }],
      });
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { quantity: "2" });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.quantity).toBe(4000);
      const after = await slips(tx, venue.printers.fryer);
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toContain("+2");
      expect(after.at(-1)).toContain("CHIPS");
      expect(await slips(tx, venue.printers.grill)).toEqual([]);
    });
  });

  it("sends chips added by edit when a held water is released", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water")], release: "hold" }],
      });
      await edit(tx, venue, 1, { extras: line(venue, "water", "1", 1).extras });
      expect((await state(tx, id)).items).toEqual([]);
      await fireGroup(tx, venue.cfg, venue.party.partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: placed.revision + 1,
      });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.stationId).toBe(venue.stations.fryer);
      expect(items[0]!.firedAt).not.toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("cancels a held water's chips at Fryer when water is removed", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2), line(venue, "water")], release: "hold" }],
      });
    });
    const before = await withTransaction(
      db,
      async (tx) => (await slips(tx, venue.printers.fryer)).length,
    );
    await removeFirst(venue);
    await withTransaction(db, async (tx) => {
      const after = await slips(tx, venue.printers.fryer);
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toContain("HOLD CANCELLED");
      expect(after.at(-1)).toContain("CHIPS");
      expect((await state(tx, id)).items).toEqual([]);
    });
  });

  it("prints take and give corrections for a held water's changed note", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2)], release: "hold" }],
      });
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { note: "Cold" });
      const after = await slips(tx, venue.printers.fryer);
      expect(after).toHaveLength(before + 2);
      expect(after.at(-2)).toContain("-2");
      expect(after.at(-1)).toContain("+2");
      expect((await state(tx, id)).items[0]!.quantity).toBe(2000);
    });
  });

  it("adds fired chips to sent water that had none", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water")]);
      await edit(tx, venue, 1, { extras: line(venue, "water", "1", 1).extras });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.stationId).toBe(venue.stations.fryer);
      expect(items[0]!.firedAt).not.toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("fires chips added to sent water in a released group", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water")], release: "fire" }],
      });
      await edit(tx, venue, 1, { extras: line(venue, "water", "1", 1).extras });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.firedAt).not.toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("keeps a recalled water's newly added onion rings held", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 1)]);
      await recallLines(tx, venue.cfg, id, [1]);
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { extras: line(venue, "water", "1", 1, 1).extras });
      const rows = await state(tx, id);
      const rings = rows.lines.find((row) => row.productId === venue.products.onionRings)!;
      expect(rows.items.find((item) => item.lineId === rings.id)?.firedAt).toBeNull();
      expect(rows.items.find((item) => item.lineId !== rings.id)?.firedAt).toBeNull();
      expect((await slips(tx, venue.printers.fryer)).length).toBe(before);
    });
  });

  it("keeps chips added to a recalled burger held with its dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      await recallLines(tx, venue.cfg, id, [1]);
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { extras: line(venue, "burger", "1", 1).extras });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.firedAt === null)).toBe(true);
      expect((await slips(tx, venue.printers.fryer)).length).toBe(before);
    });
  });

  it("uses one routing snapshot when held chips are added and a fired burger is changed", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger")], release: "hold" }],
      });
    });
    const current = await withTransaction(db, (tx) => state(tx, id));
    const fired = current.lines.find((row) => row.parentLineId === null && row.lineNo === 1)!;
    const held = current.lines.find((row) => row.parentLineId === null && row.id !== fired.id)!;
    const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
    const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
    const extras = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
    try {
      await updateHeldOrder({ db }, venue.cfg, id, {
        revision: await withTransaction(db, (tx) => revision(tx, id)),
        operatorId: OPERATOR,
        lines: [
          { ...line(venue, "burger"), workingOrderLineId: fired.id, note: "Changed" },
          { ...line(venue, "burger", "1", 1), workingOrderLineId: held.id },
        ],
      });
      expect(opened).toHaveBeenCalledTimes(1);
      expect(dishes).not.toHaveBeenCalled();
      expect(extras).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
