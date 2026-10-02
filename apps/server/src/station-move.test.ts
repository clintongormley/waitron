import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  orderGroups,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import {
  listStationNotices,
  setStationToday,
  writeEditSentLines,
  writePrintHeldWork,
} from "@waitron/venue-service";
import { createStation, deactivateStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { fireGroup, readCurrentOrders, submitGroups } from "./order-groups.js";
import { attachPrinterToStation } from "./station-printers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import {
  inTx,
  orderForParty,
  seat,
  setupPartyVenue,
  type PartyVenue,
  OPERATOR,
} from "./testing/party-venue.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { openPartyTab } from "./testing/serve-line.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { moveDishesToStation, stillMovable } from "./station-move.js";
import {
  addTabRound,
  carveOffLines,
  createOpenOrder,
  listStationQueue,
  readTabLines,
  updateOrderLine,
} from "./working-order.js";

let venue: PartyVenue;
let bar: string;
let grill: string;
let barPrinter: string;
let grillPrinter: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    venue.cfg.locale = "en-GB";
    await inTx(venue, async (tx) => {
      bar = (await createStation(tx, venue.cfg, { name: "Bar", isDefault: true })).id;
      grill = (await createStation(tx, venue.cfg, { name: "Grill" })).id;
      barPrinter = (
        await createPrinter(
          tx,
          { locationId: venue.cfg.locationId },
          { name: "Bar printer", transport: "cloud_poll", pollId: randomUUID() },
        )
      ).id;
      grillPrinter = (
        await createPrinter(
          tx,
          { locationId: venue.cfg.locationId },
          { name: "Grill printer", transport: "cloud_poll", pollId: randomUUID() },
        )
      ).id;
      await attachPrinterToStation(tx, { stationId: bar, printerId: barPrinter });
      await attachPrinterToStation(tx, { stationId: grill, printerId: grillPrinter });
      await routeProductTo(tx, venue.cfg, venue.productId("Burger"), bar);
    });
  },
});
const splitSuite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const splitTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(splitSuite.db, fn);
const splitJobs = (printerId: string) =>
  splitTx((tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId)),
  );

async function jobs(printerId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: printJobs.id, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId)),
  );
}

async function burger() {
  const tableId = await venue.table(`M-${randomUUID().slice(0, 8)}`);
  const { partyId, tabId } = await seat(venue, tableId);
  await orderForParty(venue, partyId, ["Burger"], tabId);
  const [item] = await inTx(venue, (tx) =>
    tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
  );
  return { partyId, tabId, item: item! };
}

async function snapshot(tabId: string, itemId: string) {
  return {
    barJobs: (await jobs(barPrinter)).length,
    grillJobs: (await jobs(grillPrinter)).length,
    notices: (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar))).length,
    item: (
      await inTx(venue, (tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, itemId)))
    )[0],
    revision: (
      await inTx(venue, (tx) =>
        tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId)),
      )
    )[0]!.revision,
  };
}

describe("stillMovable", () => {
  const line = { servedAt: null, servedQuantity: 0 };

  it("offers a queued kitchen item still at its station", () => {
    expect(stillMovable({ state: "queued", awayAt: null, madeHere: false }, line)).toBe(true);
  });

  it.each([
    [{ state: "preparing", awayAt: null, madeHere: false }, line],
    [{ state: "ready", awayAt: null, madeHere: false }, line],
    [{ state: "queued", awayAt: "2026-10-02T12:00:00Z", madeHere: false }, line],
    [{ state: "queued", awayAt: null, madeHere: true }, line],
    [
      { state: "queued", awayAt: null, madeHere: false },
      { servedAt: null, servedQuantity: 1000 },
    ],
  ] as const)("hides an item already started, away, made here, or served %#", (item, served) => {
    expect(stillMovable(item, served)).toBe(false);
  });
});

describe("moveDishesToStation", () => {
  it("prints at both stations, records a reroute, and replays without moving work again", async () => {
    const { tabId, item } = await burger();
    expect(item.stationId).toBe(bar);
    const oldBarJobs = (await jobs(barPrinter)).length;
    const oldGrillJobs = (await jobs(grillPrinter)).length;
    const s1 = { submissionId: randomUUID(), lineIds: [item.workingOrderLineId], stationId: grill };
    const movedAt = new Date("2026-10-02T18:45:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(movedAt);
    let first: Awaited<ReturnType<typeof moveDishesToStation>>;
    try {
      first = await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, s1));
    } finally {
      vi.useRealTimers();
    }
    expect(first.moved).toEqual([
      { workingOrderLineId: item.workingOrderLineId, fromStationId: bar },
    ]);
    const [movedItem] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
    );
    expect(movedItem).toMatchObject({
      stationId: grill,
      firedAt: item.firedAt,
      queuedAt: movedAt.toISOString(),
      stationChosenAt: movedAt.toISOString(),
    });
    const [movedLine] = await inTx(venue, (tx) =>
      tx
        .select({ makeAt: workingOrderLines.makeAtStationId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, item.workingOrderLineId)),
    );
    expect(movedLine!.makeAt).toBe(grill);
    expect((await jobs(barPrinter)).length, "Bar's printer has one new job").toBe(oldBarJobs + 1);
    expect(decodeTicket((await jobs(barPrinter))[oldBarJobs]!.payload)).toContain("MOVED TO GRILL");
    const grillPaper = decodeTicket((await jobs(grillPrinter))[oldGrillJobs]!.payload);
    expect(grillPaper).toContain("From Bar");
    expect(grillPaper).toContain("BURG");
    const notices = await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar));
    expect(notices.at(-1)).toMatchObject({ kind: "rerouted", reroutedTo: "Grill" });
    const back = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: s1.lineIds,
        stationId: bar,
      }),
    );
    const beforeReplay = {
      bar: (await jobs(barPrinter)).length,
      grill: (await jobs(grillPrinter)).length,
      notices: (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar))).length,
      revision: (
        await inTx(venue, (tx) =>
          tx
            .select({ revision: workingOrders.revision })
            .from(workingOrders)
            .where(eq(workingOrders.id, tabId)),
        )
      )[0]!.revision,
    };
    const replay = await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, s1));
    const [after] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
    );
    expect(after!.stationId).toBe(bar);
    expect({
      bar: (await jobs(barPrinter)).length,
      grill: (await jobs(grillPrinter)).length,
      notices: (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar))).length,
      revision: (
        await inTx(venue, (tx) =>
          tx
            .select({ revision: workingOrders.revision })
            .from(workingOrders)
            .where(eq(workingOrders.id, tabId)),
        )
      )[0]!.revision,
    }).toEqual(beforeReplay);
    expect(replay).toEqual(first);
    expect(back.revision).toBe(first.revision + 1);
  });

  it("corrects a genuinely printed HOLD ticket and fires the moved work at its new station", async () => {
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    const tableId = await venue.table(`H-${randomUUID().slice(0, 8)}`);
    const { partyId, tabId } = await seat(venue, tableId);
    const beforeSubmitJobs = (await jobs(barPrinter)).length;
    const revision = (
      await inTx(venue, (tx) =>
        tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId)),
      )
    )[0]!.revision;
    const submitted = await inTx(venue, (tx) =>
      submitGroups(tx, venue.cfg, partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        billId: tabId,
        groups: [{ lines: [{ menuItemId: venue.item("Burger"), quantity: "1" }], release: "hold" }],
      }),
    );
    const held = submitted.groups[0]!;
    const [heldGroup] = await inTx(venue, (tx) =>
      tx
        .select({ holdPrintedAt: orderGroups.holdPrintedAt })
        .from(orderGroups)
        .where(eq(orderGroups.id, held.id)),
    );
    expect(heldGroup!.holdPrintedAt).toEqual(expect.any(String));
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, held.lineIds[0]!)),
    );
    expect(item!.firedAt).toBeNull();
    expect(decodeTicket((await jobs(barPrinter))[beforeSubmitJobs]!.payload)).toContain("HOLD");
    const barCount = (await jobs(barPrinter)).length;
    const grillCount = (await jobs(grillPrinter)).length;
    await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item!.workingOrderLineId],
        stationId: grill,
      }),
    );
    expect(decodeTicket((await jobs(barPrinter))[barCount]!.payload)).toContain("HOLD CANCELLED");
    const movedPaper = decodeTicket((await jobs(grillPrinter))[grillCount]!.payload);
    expect(movedPaper).toContain("HOLD");
    expect(movedPaper).toContain("From Bar");
    const rerouted = await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar));
    expect(rerouted.at(-1)).toMatchObject({ kind: "rerouted", reroutedTo: "Grill" });
    const grillBeforeFire = (await jobs(grillPrinter)).length;
    const newRevision = (
      await inTx(venue, (tx) =>
        tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId)),
      )
    )[0]!.revision;
    const partyRevision = submitted.revision;
    await inTx(venue, (tx) =>
      fireGroup(tx, venue.cfg, partyId, held.id, {
        submissionId: randomUUID(),
        expectedPartyRevision: partyRevision,
        operatorId: OPERATOR,
      }),
    );
    expect(newRevision).toBeGreaterThan(revision);
    expect(decodeTicket((await jobs(grillPrinter))[grillBeforeFire]!.payload)).toContain("FIRE");
  });

  it("sends added units to the moved station when an edit carries makeAt null", async () => {
    const { tabId, item } = await burger();
    const moved = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item.workingOrderLineId],
        stationId: grill,
      }),
    );
    await inTx(venue, (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        tabId,
        1,
        { quantity: "2", makeAt: null },
        moved.revision,
        OPERATOR,
      ),
    );
    const records = await inTx(venue, (tx) =>
      tx
        .select({ stationId: ticketItems.stationId, lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(records).toHaveLength(2);
    expect(records.map((row) => row.stationId)).toEqual([grill, grill]);
    const added = records.find((row) => row.lineId !== item.workingOrderLineId)!;
    const [addedLine] = await inTx(venue, (tx) =>
      tx
        .select({ makeAt: workingOrderLines.makeAtStationId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, added.lineId)),
    );
    expect(addedLine!.makeAt).toBe(grill);
  });

  it("sends added units to an explicitly chosen station while keeping the moved record", async () => {
    const { tabId, item } = await burger();
    const moved = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item.workingOrderLineId],
        stationId: grill,
      }),
    );
    await inTx(venue, (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        tabId,
        1,
        { quantity: "2", makeAt: bar },
        moved.revision,
        OPERATOR,
      ),
    );
    const records = await inTx(venue, (tx) =>
      tx
        .select({ stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(records.map((row) => row.stationId).sort()).toEqual([bar, grill].sort());
  });

  it.each(["preparing", "ready"] as const)("refuses %s without writing", async (state) => {
    const { tabId, item } = await burger();
    await inTx(venue, (tx) =>
      tx.update(ticketItems).set({ state }).where(eq(ticketItems.id, item.id)),
    );
    const before = await snapshot(tabId, item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      ),
    ).rejects.toMatchObject({ code: "ticket.already_started" });
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it("refuses a partly served line without writing", async () => {
    const { tabId, item } = await burger();
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedQuantity: 1000 })
        .where(eq(workingOrderLines.id, item.workingOrderLineId)),
    );
    const before = await snapshot(tabId, item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      ),
    ).rejects.toMatchObject({ code: "ticket.already_started" });
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it("refuses a record marked away without writing", async () => {
    const { tabId, item } = await burger();
    await inTx(venue, (tx) =>
      tx
        .update(ticketItems)
        .set({ awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, item.id)),
    );
    const before = await snapshot(tabId, item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      ),
    ).rejects.toMatchObject({ code: "ticket.already_started" });
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it("returns an empty move at the same station without changing the order", async () => {
    const { tabId, item } = await burger();
    const before = await snapshot(tabId, item.id);
    const answer = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item.workingOrderLineId],
        stationId: bar,
      }),
    );
    expect(answer).toEqual({ revision: before.revision, stationId: bar, moved: [] });
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it("refuses a line with no kitchen record without writing", async () => {
    const tableId = await venue.table(`U-${randomUUID().slice(0, 8)}`);
    const { tabId } = await inTx(venue, (tx) =>
      openPartyTab(tx, venue.cfg, {
        tableId,
        lines: [{ menuItemId: venue.item("Burger"), quantity: "1" }],
      }),
    );
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId)),
    );
    const before = {
      bar: (await jobs(barPrinter)).length,
      grill: (await jobs(grillPrinter)).length,
    };
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [line!.id],
          stationId: grill,
        }),
      ),
    ).rejects.toMatchObject({ code: "ticket.not_sent" });
    expect({
      bar: (await jobs(barPrinter)).length,
      grill: (await jobs(grillPrinter)).length,
    }).toEqual(before);
  });

  it("refuses an unowned line and an unknown destination", async () => {
    const one = await burger();
    const other = await burger();
    const before = await snapshot(one.tabId, one.item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, one.tabId, {
          submissionId: randomUUID(),
          lineIds: [other.item.workingOrderLineId],
          stationId: grill,
        }),
      ),
    ).rejects.toMatchObject({ code: "tab.line_not_found" });
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, one.tabId, {
          submissionId: randomUUID(),
          lineIds: [one.item.workingOrderLineId],
          stationId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "station.not_found" });
    const foreignStation = await inTx(venue, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: `Elsewhere ${randomUUID()}`,
          invoiceLocales: ["en-GB"],
          operationDescription: "Other venue",
        })
        .returning({ id: locations.id });
      const [station] = await tx
        .insert(kitchenStations)
        .values({ locationId: location!.id, name: "Foreign grill" })
        .returning({ id: kitchenStations.id });
      return station!.id;
    });
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, one.tabId, {
          submissionId: randomUUID(),
          lineIds: [one.item.workingOrderLineId],
          stationId: foreignStation,
        }),
      ),
    ).rejects.toMatchObject({ code: "station.not_found" });
    expect(await snapshot(one.tabId, one.item.id)).toEqual(before);
  });

  it("refuses a switched-off station but accepts one closed for today", async () => {
    const { tabId, item } = await burger();
    const inactive = await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: `Off ${randomUUID()}` });
      await deactivateStation(tx, venue.cfg, station.id);
      return station.id;
    });
    const before = await snapshot(tabId, item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: inactive,
        }),
      ),
    ).rejects.toMatchObject({ code: "route.station_inactive" });
    expect(await snapshot(tabId, item.id)).toEqual(before);
    await inTx(venue, (tx) => setStationToday(tx, venue.cfg, grill, "closed", new Date()));
    try {
      const result = await inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      );
      expect(result.moved).toHaveLength(1);
    } finally {
      await inTx(venue, (tx) => setStationToday(tx, venue.cfg, grill, null, new Date()));
    }
  });

  it.each(["abandoned", "collected"] as const)(
    "refuses a %s order without writing",
    async (condition) => {
      const { tabId, item } = await burger();
      await inTx(venue, (tx) =>
        tx
          .update(workingOrders)
          .set(
            condition === "abandoned"
              ? { status: "abandoned" }
              : { collectedAt: new Date().toISOString() },
          )
          .where(eq(workingOrders.id, tabId)),
      );
      const before = await snapshot(tabId, item.id);
      await expect(
        inTx(venue, (tx) =>
          moveDishesToStation(tx, venue.cfg, tabId, {
            submissionId: randomUUID(),
            lineIds: [item.workingOrderLineId],
            stationId: grill,
          }),
        ),
      ).rejects.toMatchObject({
        code:
          condition === "abandoned" ? "working_order.not_open" : "working_order.already_collected",
      });
      expect(await snapshot(tabId, item.id)).toEqual(before);
    },
  );

  it("moves kitchen work even when ordinary sent-line edits are switched off", async () => {
    const { tabId, item } = await burger();
    await inTx(venue, (tx) => writeEditSentLines(tx, false));
    try {
      const answer = await inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      );
      expect(answer.moved).toEqual([
        { workingOrderLineId: item.workingOrderLineId, fromStationId: bar },
      ]);
    } finally {
      await inTx(venue, (tx) => writeEditSentLines(tx, true));
    }
  });

  it("moves held work with no printed group without issuing paper or a notice", async () => {
    const tableId = await venue.table(`Q-${randomUUID().slice(0, 8)}`);
    const { tabId } = await seat(venue, tableId);
    await inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, tabId, [
        { menuItemId: venue.item("Burger"), quantity: "1", hold: true },
      ]),
    );
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(item!.firedAt).toBeNull();
    const before = await snapshot(tabId, item!.id);
    const result = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item!.workingOrderLineId],
        stationId: grill,
      }),
    );
    expect(result.moved).toHaveLength(1);
    const after = await snapshot(tabId, item!.id);
    expect(after).toMatchObject({
      barJobs: before.barJobs,
      grillJobs: before.grillJobs,
      notices: before.notices,
      item: { stationId: grill },
    });
  });

  it.each([null, "Bar"] as const)(
    "keeps a moved HELD line's station when its edit carries makeAt %s",
    async (choice) => {
      const tableId = await venue.table(`E-${randomUUID().slice(0, 8)}`);
      const { tabId } = await seat(venue, tableId);
      await inTx(venue, (tx) =>
        addTabRound(tx, venue.cfg, tabId, [
          { menuItemId: venue.item("Burger"), quantity: "1", hold: true },
        ]),
      );
      const [item] = await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
      );
      const moved = await inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item!.workingOrderLineId],
          stationId: grill,
        }),
      );
      await inTx(venue, (tx) =>
        updateOrderLine(
          tx,
          venue.cfg,
          tabId,
          1,
          { makeAt: choice === null ? null : bar },
          moved.revision,
          OPERATOR,
        ),
      );
      const [line] = await inTx(venue, (tx) =>
        tx
          .select({ makeAt: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.id, item!.workingOrderLineId)),
      );
      const [record] = await inTx(venue, (tx) =>
        tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.id, item!.id)),
      );
      expect(line!.makeAt).toBe(grill);
      expect(record!.stationId).toBe(grill);
    },
  );

  it("copies the manual station choice onto a held unit split to another check", async () => {
    const tableId = await venue.table(`S-${randomUUID().slice(0, 8)}`);
    const { partyId, tabId } = await seat(venue, tableId);
    const revision = (
      await inTx(venue, (tx) =>
        tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId)),
      )
    )[0]!.revision;
    const submitted = await inTx(venue, (tx) =>
      submitGroups(tx, venue.cfg, partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        billId: tabId,
        groups: [{ lines: [{ menuItemId: venue.item("Burger"), quantity: "2" }], release: "hold" }],
      }),
    );
    const [item] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, submitted.groups[0]!.lineIds[0]!)),
    );
    await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: [item!.workingOrderLineId],
        stationId: grill,
      }),
    );
    const [marked] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, item!.id)),
    );
    const checkId = randomUUID();
    await inTx(venue, async (tx) => {
      await createOpenOrder(tx, venue.cfg, checkId, [], null, { partyId });
      await VENUE_SERVICE.copyOrderContext(tx, venue.cfg, tabId, checkId);
      await carveOffLines(tx, venue.cfg, tabId, checkId, [{ lineNo: 1, quantity: "1" }], {
        refuseHeld: false,
      });
    });
    const [copied] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, checkId)),
    );
    expect(copied).toMatchObject({ stationId: grill, stationChosenAt: marked!.stationChosenAt });
    expect(copied!.stationChosenAt).not.toBeNull();
  });

  it("does not repurpose a submission for a different destination", async () => {
    const { tabId, item } = await burger();
    const submissionId = randomUUID();
    await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId,
        lineIds: [item.workingOrderLineId],
        stationId: grill,
      }),
    );
    const before = await snapshot(tabId, item.id);
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId,
          lineIds: [item.workingOrderLineId],
          stationId: bar,
        }),
      ),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it.each(["fire", "hold"] as const)(
    "refuses a genuinely made-here drink sent with a %s group",
    async (release) => {
      const deviceId = await inTx(venue, async (tx) => {
        const [profile] = await tx
          .insert(deviceProfiles)
          .values({ name: `Bar till ${randomUUID()}`, formFactor: "till", capabilities: [] })
          .returning({ id: deviceProfiles.id });
        const [device] = await tx
          .insert(devices)
          .values({
            locationId: venue.cfg.locationId,
            tillId: venue.cfg.tillId,
            deviceProfileId: profile!.id,
            label: "Bar till",
            tokenHash: randomUUID(),
          })
          .returning({ id: devices.id });
        await tx.insert(deviceMadeHereStations).values({ deviceId: device!.id, stationId: bar });
        return device!.id;
      });
      const tableId = await venue.table(`D-${randomUUID().slice(0, 8)}`);
      const { partyId, tabId } = await seat(venue, tableId);
      const revision = (
        await inTx(venue, (tx) =>
          tx
            .select({ revision: workingOrders.revision })
            .from(workingOrders)
            .where(eq(workingOrders.id, tabId)),
        )
      )[0]!.revision;
      const submitted = await inTx(venue, (tx) =>
        submitGroups(tx, { ...venue.cfg, sendingDeviceId: deviceId }, partyId, {
          submissionId: randomUUID(),
          expectedPartyRevision: revision,
          operatorId: OPERATOR,
          billId: tabId,
          groups: [
            {
              lines: [
                { menuItemId: venue.item("Caña"), quantity: "1" },
                ...(release === "hold"
                  ? [{ menuItemId: venue.item("Burger"), quantity: "1" }]
                  : []),
              ],
              release,
            },
          ],
        }),
      );
      const [drink] = await inTx(venue, (tx) =>
        tx
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, submitted.groups[0]!.lineIds[0]!)),
      );
      expect(drink).toMatchObject({
        madeHere: true,
        state: "ready",
        stationId: bar,
        firedAt: expect.any(String),
      });
      const tabLines = await inTx(venue, (tx) => readTabLines(tx, venue.cfg, tabId));
      expect(tabLines.find((line) => line.id === drink!.workingOrderLineId)).toMatchObject({
        stationId: bar,
        movable: false,
      });
      const current = await inTx(venue, (tx) => readCurrentOrders(tx, partyId));
      expect(
        current.groups[0]!.rows.find((row) => row.lineId === drink!.workingOrderLineId)!.kitchen,
      ).toMatchObject({ stationId: bar, movable: false });
      const before = await snapshot(tabId, drink!.id);
      await expect(
        inTx(venue, (tx) =>
          moveDishesToStation(tx, venue.cfg, tabId, {
            submissionId: randomUUID(),
            lineIds: [drink!.workingOrderLineId],
            stationId: grill,
          }),
        ),
      ).rejects.toMatchObject({ code: "ticket.made_here" });
      expect(await snapshot(tabId, drink!.id)).toEqual(before);
    },
  );

  it("answers a plain repeat with the original move result", async () => {
    const { tabId, item } = await burger();
    const request = {
      submissionId: randomUUID(),
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    };
    const first = await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, request));
    const before = await snapshot(tabId, item.id);
    expect(await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, request))).toEqual(
      first,
    );
    expect(await snapshot(tabId, item.id)).toEqual(before);
  });

  it("keeps paper and notice counts on a replay after a round trip", async () => {
    const { tabId, item } = await burger();
    const request = {
      submissionId: randomUUID(),
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    };
    await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, request));
    await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: request.lineIds,
        stationId: bar,
      }),
    );
    const before = {
      barJobs: (await jobs(barPrinter)).length,
      grillJobs: (await jobs(grillPrinter)).length,
      notices: (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar))).length,
    };
    await inTx(venue, (tx) => moveDishesToStation(tx, venue.cfg, tabId, request));
    expect(
      {
        barJobs: (await jobs(barPrinter)).length,
        grillJobs: (await jobs(grillPrinter)).length,
        notices: (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar))).length,
      },
      "the counts of print jobs and kitchen notices stay the same after replay",
    ).toEqual(before);
  });

  it.each(["placed", "settled"] as const)(
    "moves a %s bill without updating its frozen line",
    async (status) => {
      const { tabId, item } = await burger();
      const [lineBefore] = await inTx(venue, (tx) =>
        tx
          .select({ makeAt: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.id, item.workingOrderLineId)),
      );
      await inTx(venue, async (tx) => {
        await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, tabId));
        if (status === "settled")
          await tx
            .update(workingOrders)
            .set({ status: "settled", settledAt: new Date().toISOString() })
            .where(eq(workingOrders.id, tabId));
      });
      const before = await snapshot(tabId, item.id);
      const answer = await inTx(venue, (tx) =>
        moveDishesToStation(tx, venue.cfg, tabId, {
          submissionId: randomUUID(),
          lineIds: [item.workingOrderLineId],
          stationId: grill,
        }),
      );
      expect(answer.moved).toEqual([
        { workingOrderLineId: item.workingOrderLineId, fromStationId: bar },
      ]);
      const [lineAfter] = await inTx(venue, (tx) =>
        tx
          .select({ makeAt: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.id, item.workingOrderLineId)),
      );
      expect(lineAfter!.makeAt).toBe(lineBefore!.makeAt);
      expect(answer.revision).toBe(before.revision);
    },
  );

  it("moves a dish without moving its split-off chips at another station", async () => {
    useSplitExtrasDb(splitSuite.db);
    const split = await setupSplitExtrasVenue();
    split.cfg.locale = "en-GB";
    const downstairs = await splitTx(async (tx) => {
      const station = await createStation(tx, split.cfg, { name: "Downstairs grill" });
      const printer = await createPrinter(
        tx,
        { locationId: split.cfg.locationId },
        { name: "Downstairs printer", transport: "cloud_poll", pollId: randomUUID() },
      );
      await attachPrinterToStation(tx, { stationId: station.id, printerId: printer.id });
      return { stationId: station.id, printerId: printer.id };
    });
    await splitTx((tx) =>
      addTabRound(tx, split.cfg, split.party.tabId, [
        {
          menuItemId: split.tables.offerFor(split.products.burger),
          quantity: "1",
          extras: [
            {
              listId: split.lists.burger,
              picks: [{ productId: split.products.chips, quantity: 1 }],
            },
          ],
        },
      ]),
    );
    const lines = await splitTx((tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, split.party.tabId)),
    );
    const dish = lines.find((line) => line.parentLineId === null)!;
    const chips = lines.find((line) => line.productId === split.products.chips)!;
    const fryerBefore = await splitJobs(split.printers.fryer);
    const answer = await splitTx((tx) =>
      moveDishesToStation(tx, split.cfg, split.party.tabId, {
        submissionId: randomUUID(),
        lineIds: [dish.id],
        stationId: downstairs.stationId,
      }),
    );
    expect(answer.moved).toEqual([
      { workingOrderLineId: dish.id, fromStationId: split.stations.grill },
    ]);
    const records = await splitTx((tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, split.party.tabId)),
    );
    expect(records.find((row) => row.lineId === dish.id)!.stationId).toBe(downstairs.stationId);
    expect(records.find((row) => row.lineId === chips.id)!.stationId).toBe(split.stations.fryer);
    expect((await splitJobs(split.printers.fryer)).length).toBe(fryerBefore.length);
    const fryerQueue = await splitTx((tx) => listStationQueue(tx, split.stations.fryer));
    expect(JSON.stringify(fryerQueue)).toContain("Downstairs grill");
    expect(decodeTicket((await splitJobs(downstairs.printerId)).at(-1)!.payload)).toContain(
      "with CHIPS from Fryer",
    );
    const fryerJobsBeforeChipsMove = (await splitJobs(split.printers.fryer)).length;
    const grillJobsBeforeChipsMove = (await splitJobs(split.printers.grill)).length;
    const chipsMove = await splitTx((tx) =>
      moveDishesToStation(tx, split.cfg, split.party.tabId, {
        submissionId: randomUUID(),
        lineIds: [chips.id],
        stationId: split.stations.grill,
      }),
    );
    expect(chipsMove.moved).toEqual([
      { workingOrderLineId: chips.id, fromStationId: split.stations.fryer },
    ]);
    const afterChipsMove = await splitTx((tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, split.party.tabId)),
    );
    expect(afterChipsMove.find((row) => row.lineId === dish.id)!.stationId).toBe(
      downstairs.stationId,
    );
    expect(afterChipsMove.find((row) => row.lineId === chips.id)!.stationId).toBe(
      split.stations.grill,
    );
    expect(
      decodeTicket((await splitJobs(split.printers.fryer))[fryerJobsBeforeChipsMove]!.payload),
    ).toContain("MOVED TO GRILL");
    expect(
      decodeTicket((await splitJobs(split.printers.grill))[grillJobsBeforeChipsMove]!.payload),
    ).toContain("From Fryer");
  });

  it("prints one destination ticket per old station in a two-dish move", async () => {
    const fryer = await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: `Fryer ${randomUUID()}` });
      await routeProductTo(tx, venue.cfg, venue.productId("Vino"), station.id);
      const printer = await createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        { name: "Fryer printer", transport: "cloud_poll", pollId: randomUUID() },
      );
      await attachPrinterToStation(tx, { stationId: station.id, printerId: printer.id });
      return station.id;
    });
    const tableId = await venue.table(`T-${randomUUID().slice(0, 8)}`);
    const { partyId, tabId } = await seat(venue, tableId);
    await orderForParty(venue, partyId, ["Burger", "Vino"], tabId);
    const items = await inTx(venue, (tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(items.map((item) => item.stationId).sort()).toEqual([bar, fryer].sort());
    const before = (await jobs(grillPrinter)).length;
    const result = await inTx(venue, (tx) =>
      moveDishesToStation(tx, venue.cfg, tabId, {
        submissionId: randomUUID(),
        lineIds: items.map((item) => item.lineId),
        stationId: grill,
      }),
    );
    expect(result.moved).toHaveLength(2);
    const paper = (await jobs(grillPrinter)).slice(before).map((job) => decodeTicket(job.payload));
    expect(paper).toHaveLength(2);
    expect(paper.some((ticket) => ticket.includes("From Bar"))).toBe(true);
    expect(paper.some((ticket) => ticket.includes("From Fryer"))).toBe(true);
  });
});
