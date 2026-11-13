import { seedActivityActor } from "@waitron/db/testing/seed.js";
import { cancelItemForTest, cancelLine } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import {
  sendLines,
  setLineCourse,
  updateHeldOrder,
  updateOrderLine,
} from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import {
  replaceMenuWeek,
  readBusinessDayScheduleRevision,
  setRoutingCell,
  setStationToday,
} from "@waitron/venue-service";
import { decodeTicket } from "./testing/decode-ticket.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import {
  createExtraList,
  updateProduct,
  writeProductModifiers,
  updateExtraList,
} from "@waitron/catalogue";
import { createCourse, setProductCourse } from "./kitchen.js";
import { offerProducts } from "./testing/zone-offers.js";
import { OPERATOR } from "./testing/party-venue.js";
import { setStationPrinting } from "./testing/station-printing.js";

import { fireGroup } from "./order-groups.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { placeGrouped } from "./testing/adjustment-venue.js";
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
async function cancelFirst(venue: Venue) {
  return withTransaction(db, (tx) =>
    cancelItemForTest(tx, venue.cfg, venue.party.tabId, 1, undefined, OPERATOR),
  );
}

async function removeFirst(venue: Venue) {
  const id = venue.party.tabId;
  const { rows, currentRevision } = await withTransaction(db, async (tx) => ({
    rows: (await state(tx, id)).lines.filter((row) => row.parentLineId === null),
    currentRevision: await revision(tx, id),
  }));
  return updateHeldOrder({ admission: testTradingAdmission(), db }, venue.cfg, id, {
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
      await edit(tx, venue, 1, { portionLineNos: [], note: "No salt" });
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
      await edit(tx, venue, 1, { portionLineNos: [], note: "No salt", extras: [] });
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
      await edit(tx, venue, 1, {
        portionLineNos: [],
        extras: line(venue, "burger", "1", 1).extras,
      });
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
      await cancelItemForTest(tx, venue.cfg, id, 1, "1", OPERATOR);
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
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger")], release: "hold" }],
      });
      await edit(tx, venue, 1, {
        portionLineNos: [],
        extras: line(venue, "burger", "1", 1).extras,
      });
      const chips = (await state(tx, venue.party.tabId)).items.find(
        (item) => item.stationId === venue.stations.fryer,
      );
      expect(chips?.firedAt).toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("HOLD CHANGED");
    });
  });

  it("an extra added to a held dish prints +N only at a station recorded for the group", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      await setStationPrinting(tx, { printHeldWork: false }, [venue.stations.fryer]);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1)], release: "hold" }],
      });
      expect(await slips(tx, venue.printers.grill)).toHaveLength(1);
      await edit(tx, venue, 1, {
        portionLineNos: [],
        extras: line(venue, "burger", "1", 1, 1).extras,
      });
      const rings = (await state(tx, venue.party.tabId)).lines.find(
        (row) => row.productId === venue.products.onionRings,
      )!;
      expect((await state(tx, venue.party.tabId)).items).toContainEqual(
        expect.objectContaining({
          lineId: rings.id,
          stationId: venue.stations.fryer,
          firedAt: null,
        }),
      );
      expect(await slips(tx, venue.printers.fryer)).toEqual([]);
      // Grill, recorded, gets the dish taken off and given back with the rings it gained.
      const grill = await slips(tx, venue.printers.grill);
      expect(grill).toHaveLength(3);
      expect(grill.at(-1)).toContain("HOLD CHANGED");
      expect(grill.at(-1)).toContain("RINGS");
    });
  });

  it("prints HOLD CHANGED when a prior inline extra gains its first station record on an edit", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: venue.folders.sides }, zoneId: null },
        { kind: "no_preparation" },
      );
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1)], release: "hold" }],
      });
      expect(await slips(tx, venue.printers.fryer)).toHaveLength(0);
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: venue.folders.sides }, zoneId: null },
        {
          kind: "station",
          stationId: venue.stations.fryer,
        },
      );
      await edit(tx, venue, 1, {
        portionLineNos: [],
        extras: line(venue, "burger", "1", 1, 1).extras,
      });
      const chipsLine = (await state(tx, venue.party.tabId)).lines.find(
        (row) => row.productId === venue.products.chips,
      )!;
      expect((await state(tx, venue.party.tabId)).items).toContainEqual(
        expect.objectContaining({
          lineId: chipsLine.id,
          stationId: venue.stations.fryer,
          firedAt: null,
        }),
      );
      expect(
        (await slips(tx, venue.printers.fryer)).find((slip) => slip.includes("CHIPS")),
      ).toContain("HOLD CHANGED");
    });
  });

  it.each(["send", "course"] as const)(
    "refuses %s on an extra line number without changing the order",
    async (action) => {
      const venue = await setupSplitExtrasVenue();
      await withTransaction(db, async (tx) => {
        await addTabRound(tx, venue.cfg, venue.party.tabId, [
          { ...line(venue, "burger", "1", 1), hold: true },
        ]);
        const extraNo = (await state(tx, venue.party.tabId)).lines.find(
          (row) => row.parentLineId !== null,
        )!.lineNo;
        const before = await state(tx, venue.party.tabId);
        const beforeRevision = await revision(tx, venue.party.tabId);
        const beforeSlips = await slips(tx, venue.printers.fryer);
        const request =
          action === "send"
            ? sendLines(tx, venue.cfg, venue.party.tabId, [extraNo])
            : setLineCourse(tx, venue.cfg, venue.party.tabId, extraNo, null);
        await expect(request).rejects.toMatchObject({
          code: "management.request_invalid",
          params: { field: "lineNo" },
        });
        expect(await state(tx, venue.party.tabId)).toEqual(before);
        expect(await revision(tx, venue.party.tabId)).toBe(beforeRevision);
        expect(await slips(tx, venue.printers.fryer)).toEqual(beforeSlips);
      });
    },
  );

  it("raises held burger and chips records proportionally with corrections at both stations", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      // Grouped, as an order stored before portions.
      await placeGrouped(
        tx,
        venue.cfg,
        venue.party,
        [line(venue, "burger", "1", 2)],
        "hold",
        OPERATOR,
      );
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
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
      await setStationPrinting(tx, { printHeldWork: true });
      // Grouped, as an order stored before portions.
      const placed = [
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
      ];
      await placeGrouped(tx, venue.cfg, venue.party, placed, "hold", OPERATOR);
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
      const items = (await state(tx, venue.party.tabId)).items;
      expect(items.find((item) => item.stationId === venue.stations.fryer)?.quantity).toBe(2000);
      expect(items).toHaveLength(2);
    });
  });

  it("A803 portions: raising a sent held burger with chips adds a portion with its own chips", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 2)], release: "hold" }],
      });
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
      const { lines, items } = await state(tx, venue.party.tabId);
      const dishes = lines.filter((row) => row.parentLineId === null);
      expect(dishes.map((row) => row.quantity)).toEqual([1000, 1000]);
      expect(
        dishes.map((dish) =>
          lines.filter((row) => row.parentLineId === dish.id).map((row) => row.quantity),
        ),
      ).toEqual([[2000], [2000]]);
      expect(
        items
          .filter((item) => item.stationId === venue.stations.fryer)
          .map((item) => item.quantity),
      ).toEqual([2000, 2000]);
      expect((await slips(tx, venue.printers.grill)).at(-1)).toContain("HOLD CHANGED");
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("+2");
    });
  });

  it("A803 portions: raising a sent held burger with a routed and an inline extra adds a portion", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      const burger = {
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
      };
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger], release: "hold" }],
      });
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
      const items = (await state(tx, venue.party.tabId)).items;
      expect(
        items
          .filter((item) => item.stationId === venue.stations.fryer)
          .map((item) => item.quantity),
      ).toEqual([1000, 1000]);
      expect(items).toHaveLength(4);
    });
  });

  it("A803 portions: raising a sent held water with chips adds a portion and no dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2)], release: "hold" }],
      });
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
      const { lines, items } = await state(tx, venue.party.tabId);
      expect(lines.filter((row) => row.parentLineId === null).map((row) => row.quantity)).toEqual([
        1000, 1000,
      ]);
      expect(items.map((item) => [item.stationId, item.quantity])).toEqual([
        [venue.stations.fryer, 2000],
        [venue.stations.fryer, 2000],
      ]);
      const after = await slips(tx, venue.printers.fryer);
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toContain("+2");
      expect(await slips(tx, venue.printers.grill)).toEqual([]);
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
      await expect(
        edit(tx, venue, 1, { portionLineNos: [], note: "No salt" }),
      ).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: chips.id },
      });
      expect((await state(tx, id)).items.find((item) => item.id === chips.id)?.state).toBe(
        "preparing",
      );
      expect((await state(tx, id)).lines.find((row) => row.parentLineId === null)?.note).toBeNull();
    });
  });

  it("raises a burger whose chips have started: the started chips stay, the extra burger and chips go to their stations", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      const sent = (await state(tx, id)).items;
      const chips = sent.find((item) => item.stationId === venue.stations.fryer)!;
      await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, chips.id));
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
      const { items } = await state(tx, id);
      expect(items.find((item) => item.id === chips.id)).toMatchObject({
        state: "preparing",
        quantity: 1000,
      });
      const added = items.filter((item) => !sent.some((before) => before.id === item.id));
      expect(added.every((item) => item.state === "queued")).toBe(true);
      expect(added.map((item) => item.stationId).sort()).toEqual(
        [venue.stations.grill, venue.stations.fryer].sort(),
      );
      expect(added.every((item) => item.firedAt !== null)).toBe(true);
    });
  });
  it("keeps chips with the dish when Fryer closes and sends its work to Grill", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      await setStationToday(
        tx,
        venue.stations.fryer,
        "closed",
        new Date(),
        await seedActivityActor(tx),
        venue.stations.grill,
      );
      await edit(tx, venue, 1, { portionLineNos: [], note: "No salt" });
      expect((await state(tx, id)).items.map((item) => item.stationId)).toEqual([
        venue.stations.grill,
      ]);
      expect((await slips(tx, venue.printers.grill)).at(-1)).toContain("+ CHIPS");
    });
  });

  it("edits a sent water with fired chips without a dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 2)]);
      const old = (await state(tx, id)).items[0]!;
      await edit(tx, venue, 1, { portionLineNos: [], note: "Cold" });
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
      await cancelItemForTest(tx, venue.cfg, id, 1, "1", OPERATOR);
      expect((await state(tx, id)).items[0]?.quantity).toBe(1000);
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("VOID");
      expect(await slips(tx, venue.printers.grill)).toEqual([]);
    });
  });

  it("refuses to leave a sent water's fired chips out of the whole-order save, printing nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, (tx) =>
      addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 2), line(venue, "water")]),
    );
    const before = await withTransaction(db, async (tx) => ({
      state: await state(tx, id),
      fryer: await slips(tx, venue.printers.fryer),
      grill: await slips(tx, venue.printers.grill),
    }));
    await expect(removeFirst(venue)).rejects.toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: id },
    });
    await withTransaction(db, async (tx) => {
      expect(await state(tx, id)).toEqual(before.state);
      expect(await slips(tx, venue.printers.fryer)).toEqual(before.fryer);
      expect(await slips(tx, venue.printers.grill)).toEqual(before.grill);
    });
  });

  it("voids a sent water's fired chips at Fryer when the extra is cancelled", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    const before = await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "water", "1", 1)]);
      return {
        state: await state(tx, id),
        fryer: await slips(tx, venue.printers.fryer),
      };
    });
    const water = before.state.lines.find((row) => row.parentLineId === null)!;
    const chips = before.state.lines.find((row) => row.parentLineId !== null)!;
    expect(before.state.items).toEqual([
      expect.objectContaining({ lineId: chips.id, stationId: venue.stations.fryer }),
    ]);

    await withTransaction(db, (tx) =>
      cancelLine(tx, venue.cfg, id, chips.lineNo, undefined, OPERATOR),
    );

    await withTransaction(db, async (tx) => {
      expect(await state(tx, id)).toEqual({ lines: [water], items: [] });
      const printed = (await slips(tx, venue.printers.fryer)).slice(before.fryer.length);
      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain("*** VOID ***");
      expect(printed[0]).toContain("1 x CHIPS");
    });
  });

  it("cancels both stations when a printed held burger with chips is removed", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1), line(venue, "water")], release: "hold" }],
      });
    });
    await cancelFirst(venue);
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
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "burger", "1", 1)], release: "hold" }],
      });
      await edit(tx, venue, 1, { portionLineNos: [], extras: [] });
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
      await setStationPrinting(tx, { printHeldWork: true });
      // Grouped, as an order stored before portions.
      await placeGrouped(
        tx,
        venue.cfg,
        venue.party,
        [line(venue, "water", "1", 2)],
        "hold",
        OPERATOR,
      );
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { portionLineNos: [], quantity: "2" });
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
      await setStationPrinting(tx, { printHeldWork: true });
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water")], release: "hold" }],
      });
      await edit(tx, venue, 1, { portionLineNos: [], extras: line(venue, "water", "1", 1).extras });
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
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2), line(venue, "water")], release: "hold" }],
      });
    });
    const before = await withTransaction(
      db,
      async (tx) => (await slips(tx, venue.printers.fryer)).length,
    );
    await cancelFirst(venue);
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
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(venue, "water", "1", 2)], release: "hold" }],
      });
      const before = (await slips(tx, venue.printers.fryer)).length;
      await edit(tx, venue, 1, { portionLineNos: [], note: "Cold" });
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
      await edit(tx, venue, 1, { portionLineNos: [], extras: line(venue, "water", "1", 1).extras });
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
      await edit(tx, venue, 1, { portionLineNos: [], extras: line(venue, "water", "1", 1).extras });
      const items = (await state(tx, id)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.firedAt).not.toBeNull();
      expect((await slips(tx, venue.printers.fryer)).at(-1)).toContain("CHIPS");
    });
  });

  it("uses one routing snapshot when held chips are added and a fired burger is changed", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      await setStationPrinting(tx, { printHeldWork: true });
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
      await updateHeldOrder({ admission: testTradingAdmission(), db }, venue.cfg, id, {
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

it.each([false, true])(
  "keeps a lunch's open choice and recorded supplement price; initial main started: %s",
  async (initialMain) => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await updateProduct(tx, venue.products.burger, {
        setLunch: true,
        unitPrice: "18.00",
        vatClass: "reduced",
      });
      const course = await createCourse(tx, { name: "Lunch main" });
      await setProductCourse(tx, venue.products.chips, course.id);
      const main = await createExtraList(
        tx,
        {
          name: "Lunch main",
          customerName: null,
          kitchenName: null,
          minPicks: 1,
          maxPicks: 1,
          active: true,
          items: [
            { productId: venue.products.chips, maxQuantity: 1, preselected: false, price: "3.00" },
          ],
        },
        venue.cfg.locale,
      );
      const coffee = await createExtraList(
        tx,
        {
          name: "Lunch coffee",
          customerName: null,
          kitchenName: null,
          minPicks: 1,
          maxPicks: 1,
          active: true,
          items: [
            { productId: venue.products.water, maxQuantity: 1, preselected: false, price: "0.00" },
          ],
        },
        venue.cfg.locale,
      );
      await writeProductModifiers(tx, venue.products.burger, [
        { kind: "extras", id: main.id },
        { kind: "extras", id: coffee.id },
      ]);
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: venue.products.burger }, zoneId: null },
        { kind: "no_preparation" },
      );
      const offers = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      await addTabRound(tx, venue.cfg, id, [
        {
          menuItemId: offers.offerFor(venue.products.burger),
          quantity: "1",
          ...(initialMain
            ? {
                extras: [
                  { listId: main.id, picks: [{ productId: venue.products.chips, quantity: 1 }] },
                ],
              }
            : {}),
        },
      ]);
      if (initialMain) {
        const item = (await state(tx, id)).items.find(
          (item) => item.stationId === venue.stations.fryer,
        )!;
        await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, item.id));
      }
      const initialItems = (await state(tx, id)).items;
      const before = (await state(tx, id)).lines[0]!;
      const contexts = await VENUE_SERVICE.listLineContexts(tx, id);
      await updateProduct(tx, venue.products.burger, { setLunch: false });
      await updateExtraList(
        tx,
        main.id,
        {
          name: "Lunch main",
          customerName: null,
          kitchenName: null,
          minPicks: 1,
          maxPicks: 1,
          active: true,
          items: [
            { productId: venue.products.chips, maxQuantity: 1, preselected: false, price: "9.00" },
          ],
        },
        venue.cfg.locale,
      );
      await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      await edit(tx, venue, before.lineNo, {
        portionLineNos: [],
        extras: [{ listId: main.id, picks: [{ productId: venue.products.chips, quantity: 1 }] }],
      });
      const chosen = (await state(tx, id)).lines;
      const parent = chosen.find((row) => row.parentLineId === null)!;
      const child = chosen.find((row) => row.parentLineId === parent.id)!;
      expect(parent.id).toBe(before.id);
      expect(child.productId).toBe(venue.products.chips);
      expect(
        (await tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, child.id)))[0]!
          .courseId,
      ).toBe(course.id);
      const rows = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      expect(rows.map((row) => row.lineTotal).sort((a, b) => a - b)).toEqual([300, 1800]);
      expect(rows.map((row) => row.vatClass)).toEqual(["reduced", "reduced"]);
      expect((await state(tx, id)).items).toEqual(initialItems);
      expect(
        (await VENUE_SERVICE.listLineContexts(tx, id)).find(
          (row) => row.workingOrderLineId === child.id,
        )!.menuVersionId,
      ).toBe(contexts[0]!.menuVersionId);
      const context = await VENUE_SERVICE.resolveZoneContext(tx, venue.tables.zoneId);
      await replaceMenuWeek(
        tx,
        context.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        new Date(),
        await readBusinessDayScheduleRevision(tx),
      );
      expect(
        (await VENUE_SERVICE.resolveDepartmentService(tx, context.departmentId, new Date()))
          .orderableMenuIds,
      ).not.toContain(offers.menuId);
      await edit(tx, venue, parent.lineNo, {
        portionLineNos: [],
        extras: [
          { listId: main.id, picks: [{ productId: venue.products.chips, quantity: 1 }] },
          { listId: coffee.id, picks: [{ productId: venue.products.water, quantity: 1 }] },
        ],
      });
      const completed = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      expect(completed.find((row) => row.id === child.id)?.lineTotal).toBe(300);
      expect(completed.map((row) => row.lineTotal).sort((a, b) => a - b)).toEqual([0, 300, 1800]);
      expect((await state(tx, id)).items).toEqual(initialItems);
    });
  },
);

it.each([false, true])(
  "keeps a stored ordinary dish ordinary after it is published as lunch; null version: %s",
  async (nullVersion) => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await updateProduct(tx, venue.products.burger, { vatClass: "reduced" });
      await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      await addTabRound(tx, venue.cfg, venue.party.tabId, [line(venue, "burger")]);
      if (nullVersion)
        await tx.run(
          sql`update working_line_contexts set menu_version_id = null where working_order_line_id in (select id from working_order_lines where working_order_id = ${venue.party.tabId})`,
        );
      await updateProduct(tx, venue.products.burger, { setLunch: true });
      await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      await edit(tx, venue, 1, {
        portionLineNos: [],
        extras: [
          { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
        ],
      });
      const rows = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
      expect(rows.find((row) => row.productId === venue.products.chips)!.vatClass).toBe("general");
    });
  },
);
