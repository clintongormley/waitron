import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  orderGroupHoldStations,
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { adjustmentReasons, createAdjustmentReason } from "@waitron/adjustments";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { kitchenNotices, listStationNotices } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  billWith,
  inTx,
  placeGrouped,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { recallToDraft } from "./draft-recall.js";
import { fireGroup } from "./order-groups.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem } from "./line-cancel.js";
import { cancelLine, cancelReasonId, GIVE_AWAY_REASON } from "./testing/cancel-line.js";
import {
  moveDishesToStation,
  updateHeldOrder,
  updateOrderLine,
} from "./testing/order-writer-fixture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setMadeHereStations } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readScopedPassBoard } from "./pass-board.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import "./errors.js";

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const burger = (venue: Venue, chips: boolean, quantity = "1") => ({
  menuItemId: venue.tables.offerFor(venue.products.burger),
  quantity,
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists.burger,
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});

async function partyArgs(tx: Transaction, venue: Venue) {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, venue.party.partyId));
  return {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
  };
}

async function slips(tx: Transaction, venue: Venue) {
  const out: Record<string, string[][]> = {};
  for (const [name, id] of Object.entries(venue.printers))
    out[name] = (
      await tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, id))
        .orderBy(sql`rowid`)
    ).map((job) => printedLines(job.payload));
  return out;
}

const noticesAt = (tx: Transaction, stationId: string) =>
  tx
    .select({ kind: kitchenNotices.kind, quantity: kitchenNotices.quantity })
    .from(kitchenNotices)
    .where(eq(kitchenNotices.stationId, stationId));

/** A held group of burgers whose HOLD ticket printed at Grill, fired with Grill waiting. */
async function firedFromHold(
  tx: Transaction,
  venue: Venue,
  chips: boolean,
  lines = [burger(venue, chips)],
  shape?: "grouped",
) {
  await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.grill]);
  const groupId =
    shape === "grouped"
      ? await placeGrouped(tx, venue.cfg, venue.party, lines, "hold", OPERATOR)
      : (
          await placeGroups(tx, venue.cfg, venue.party.partyId, {
            operatorId: OPERATOR,
            groups: [{ lines, release: "hold" }],
          })
        ).groups[0]!.id;
  const hold = await slips(tx, venue);
  expect(hold.grill!.map((slip) => slip[0])).toEqual(["*** HOLD ***"]);
  expect(hold.pass!.map((slip) => slip[0])).toEqual(["*** HOLD ***"]);
  expect(hold.fryer).toEqual([]);
  await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
  await fireGroup(tx, venue.cfg, venue.party.partyId, groupId, await partyArgs(tx, venue));
  const items = await tx
    .select({ stationId: ticketItems.stationId, requestedAt: ticketItems.requestedAt })
    .from(ticketItems)
    .where(and(eq(ticketItems.workingOrderId, venue.party.tabId)));
  expect(items).toEqual(
    expect.arrayContaining([{ stationId: venue.stations.grill, requestedAt: AT }]),
  );
  if (chips)
    expect(items).toEqual(
      expect.arrayContaining([{ stationId: venue.stations.fryer, requestedAt: AT }]),
    );
  const [line] = await tx
    .select()
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, venue.party.tabId),
        eq(workingOrderLines.productId, venue.products.burger),
      ),
    );
  return line!;
}

const cancelledBurger = [
  "*** HOLD CANCELLED ***",
  "Grill",
  "Split extras",
  "1",
  "13:05",
  "GROUP 1",
  "1.000 x BURG",
  "",
];

describe("A773 hold paper: recall and cancel", () => {
  describe("draft recall", () => {
    const suite = useVenueDb({
      migrations: migrationOptionsFor(manifestSets(), null),
      timeoutMs: 60_000,
    });
    let db: Database;
    afterEach(() => {
      vi.useRealTimers();
    });

    async function recall(tx: Transaction, venue: Venue, lineId: string) {
      await recallToDraft(tx, venue.cfg, venue.party.partyId, lineId, {
        ...(await partyArgs(tx, venue)),
        expectedEdit: await readBillEditState(tx, venue.party.tabId),
      });
    }

    it("recalling a Requested burger cancels it on the HOLD paper at each printer that printed it", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
      db = suite.db;
      useSplitExtrasDb(db);
      const venue = await setupSplitExtrasVenue();
      await withTransaction(db, async (tx) => {
        const line = await firedFromHold(tx, venue, false);
        const before = await slips(tx, venue);
        vi.setSystemTime(new Date(LATER));

        await recall(tx, venue, line.id);

        const after = await slips(tx, venue);
        const added = (name: string) => after[name]!.slice(before[name]!.length);
        expect(added("grill")).toEqual([cancelledBurger]);
        expect(added("pass")).toEqual([cancelledBurger]);
        for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
        expect(await noticesAt(tx, venue.stations.grill)).toEqual([
          { kind: "void", quantity: 1000 },
        ]);
      });
    });

    it("recalling a Requested burger with chips cancels only the burger, where its HOLD paper is", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
      db = suite.db;
      useSplitExtrasDb(db);
      const venue = await setupSplitExtrasVenue();
      await withTransaction(db, async (tx) => {
        const line = await firedFromHold(tx, venue, true);
        const before = await slips(tx, venue);
        vi.setSystemTime(new Date(LATER));

        await recall(tx, venue, line.id);

        expect(
          await tx
            .select({ id: ticketItems.id })
            .from(ticketItems)
            .where(eq(ticketItems.workingOrderId, venue.party.tabId)),
        ).toEqual([]);
        const after = await slips(tx, venue);
        const added = (name: string) => after[name]!.slice(before[name]!.length);
        const withChips = [...cancelledBurger.slice(0, -1), "  > with CHIPS from Fryer", ""];
        expect(added("grill")).toEqual([withChips]);
        expect(added("pass")).toEqual([withChips]);
        for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
        expect(await noticesAt(tx, venue.stations.grill)).toEqual([
          { kind: "void", quantity: 1000 },
        ]);
        expect(await noticesAt(tx, venue.stations.fryer)).toEqual([]);
      });
    });
  });

  describe("the cancel that removes the charge", () => {
    let venue: AdjustmentVenue;
    useVenueDb({
      resetPerTest: false,
      migrations: migrationOptionsFor(manifestSets(), null),
      timeoutMs: 60_000,
      setup: async (db) => {
        venue = await provisionAdjustmentVenue(db);
      },
    });

    /** Three Pizzas with two Olives each, held with HOLD paper at the venue's station, then fired with it waiting. */
    async function requestedFromHold(shape: "grouped" | "portions") {
      await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [venue.stationId]));
      try {
        const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
          release: "hold",
          ...(shape === "grouped" ? { shape } : {}),
        });
        const lines = await inTx(venue, async (tx) => {
          const found = await tx
            .select()
            .from(workingOrderLines)
            .where(
              and(
                eq(workingOrderLines.workingOrderId, order.billId),
                sql`${workingOrderLines.parentLineId} is null`,
              ),
            )
            .orderBy(workingOrderLines.lineNo);
          const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
          await fireGroup(tx, venue.cfg, order.partyId, found[0]!.groupId!, {
            submissionId: randomUUID(),
            expectedPartyRevision: party!.revision,
            operatorId: venue.staffId,
          });
          return found;
        });
        expect(lines).toHaveLength(shape === "grouped" ? 1 : 3);
        const items = await inTx(venue, (tx) =>
          tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, order.billId)),
        );
        expect(items.length).toBeGreaterThan(0);
        for (const item of items)
          expect(item).toMatchObject({ requestedAt: expect.any(String), firedAt: null });
        return { ...order, lines };
      } finally {
        await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [venue.stationId]));
      }
    }
    type Order = Awaited<ReturnType<typeof requestedFromHold>>;

    async function removeTwo(order: Order, lineIds?: string[]) {
      await inTx(venue, async (tx) => {
        const lineId = order.lines[0]!.id;
        const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
        const [bill] = await tx
          .select()
          .from(workingOrders)
          .where(eq(workingOrders.id, order.billId));
        await cancelItem(
          tx,
          venue.cfg,
          order.partyId,
          lineId,
          {
            quantity: "2",
            expectedEdit: await readBillEditState(tx, order.billId),
            outcome: "remove_charge",
            reasonId: venue.reasonId.houseVoid,
            expectedPartyRevision: party!.revision,
            expectedBillRevision: bill!.revision,
            expectedContext: await readCancellationContext(tx, order.partyId, lineId, lineIds),
            submissionId: randomUUID(),
            ...(lineIds === undefined ? {} : { lineIds }),
            admission: testTradingAdmission(),
          },
          venue.staffId,
        );
      });
    }

    const jobs = () =>
      inTx(venue, (tx) =>
        tx
          .select()
          .from(printJobs)
          .orderBy(sql`rowid`),
      );
    const notices = async (order: Order) =>
      (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, venue.stationId))).filter(
        (notice) => notice.workingOrderId === order.billId,
      );

    async function expectOneHoldCancelled(order: Order, cancel: () => Promise<void>) {
      const before = (await jobs()).length;
      await cancel();
      const printed = (await jobs()).slice(before);
      expect(printed.map((job) => job.printerId)).toEqual([venue.printerId]);
      const lines = printedLines(printed[0]!.payload);
      const [group] = await inTx(venue, (tx) =>
        tx.select().from(orderGroups).where(eq(orderGroups.id, order.lines[0]!.groupId!)),
      );
      const header = lines.slice(1, lines.indexOf(`GRUPO ${group!.displayNumber}`));
      expect(header.length).toBeGreaterThan(0);
      expect(lines).toEqual([
        "*** EN ESPERA CANCELADO ***",
        ...header,
        `GRUPO ${group!.displayNumber}`,
        "2.000 x PIZZA",
        "  + Olives x2",
        "",
      ]);
      expect(await notices(order)).toMatchObject([{ kind: "void", quantity: "2.000" }]);
    }

    async function withHoldPaper(run: () => Promise<void>) {
      await inTx(venue, (tx) => setStationPrinting(tx, { printHeldWork: true }, [venue.stationId]));
      try {
        await run();
      } finally {
        await inTx(venue, (tx) =>
          setStationPrinting(tx, { printHeldWork: false }, [venue.stationId]),
        );
      }
    }

    it("removing the charge on 2 of 3 Requested Pizzas on one stored line cancels them on the HOLD paper", async () => {
      await withHoldPaper(async () => {
        const order = await requestedFromHold("grouped");
        await expectOneHoldCancelled(order, () => removeTwo(order));
      });
    });

    it("removing the charge on 2 of 3 Requested Pizza portions (removePortions) cancels them on the HOLD paper", async () => {
      await withHoldPaper(async () => {
        const order = await requestedFromHold("portions");
        await expectOneHoldCancelled(order, () =>
          removeTwo(
            order,
            order.lines.map((line) => line.id),
          ),
        );
      });
    });
  });
});

describe("A773 hold paper: extras off and moves", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh(): Promise<Venue> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    db = suite.db;
    useSplitExtrasDb(db);
    return setupSplitExtrasVenue();
  }

  const mover = (venue: Venue) => ({ deviceId: venue.cfg.origin.deviceId, personId: OPERATOR });

  const moveTo = (tx: Transaction, venue: Venue, lineId: string, stationId: string) =>
    moveDishesToStation(
      tx,
      venue.cfg,
      venue.party.tabId,
      { submissionId: randomUUID(), lineIds: [lineId], stationId },
      mover(venue),
    );

  const reroutedAt = (tx: Transaction, stationId: string) =>
    tx
      .select({ kind: kitchenNotices.kind, reroutedTo: kitchenNotices.reroutedTo })
      .from(kitchenNotices)
      .where(eq(kitchenNotices.stationId, stationId));

  const itemOf = async (tx: Transaction, lineId: string) => {
    const [item] = await tx
      .select({
        id: ticketItems.id,
        stationId: ticketItems.stationId,
        requestedAt: ticketItems.requestedAt,
        firedAt: ticketItems.firedAt,
      })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, lineId));
    return item!;
  };

  it("taking the chips off a Requested burger tells Grill on its HOLD paper and cancels the chips on Fryer's", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [
        venue.stations.grill,
        venue.stations.fryer,
      ]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(venue, true)], release: "hold" }],
      });
      const hold = await slips(tx, venue);
      for (const name of ["grill", "fryer", "pass"])
        expect(hold[name]!.map((slip) => slip[0])).toContain("*** HOLD ***");
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        await partyArgs(tx, venue),
      );
      const [chips] = await tx
        .select({ lineNo: workingOrderLines.lineNo, id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, venue.party.tabId),
            eq(workingOrderLines.productId, venue.products.chips),
          ),
        );
      expect(await itemOf(tx, chips!.id)).toMatchObject({ requestedAt: AT, firedAt: null });
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await cancelLine(tx, venue.cfg, venue.party.tabId, chips!.lineNo);

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      const grill = [
        "*** HOLD CHANGED ***",
        "Grill",
        "Split extras",
        "1",
        "13:05",
        "GROUP 1",
        "1.000 x BURG",
        "  CANCEL: Chips",
        "",
      ];
      const fryer = [
        "*** HOLD CANCELLED ***",
        "Fryer",
        "Split extras",
        "1",
        "13:05",
        "GROUP 1",
        "1.000 x CHIPS",
        "  > for BURG at Grill",
        "",
      ];
      expect(added("grill")).toEqual([grill]);
      expect(added("fryer")).toEqual([fryer]);
      expect(added("pass")).toEqual([fryer, grill]);
      for (const name of ["kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });

  it("moving a Requested burger away from its HOLD paper cancels it there and tells the old station", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      const line = await firedFromHold(tx, venue, false);
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await moveTo(tx, venue, line.id, venue.stations.fryer);

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      expect(added("grill")).toEqual([cancelledBurger]);
      expect(added("pass")).toEqual([cancelledBurger]);
      for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
      expect(await reroutedAt(tx, venue.stations.grill)).toEqual([
        { kind: "rerouted", reroutedTo: "Fryer" },
      ]);
      expect(await reroutedAt(tx, venue.stations.fryer)).toEqual([]);
      expect(await itemOf(tx, line.id)).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: AT,
        firedAt: null,
      });
    });
  });

  it("moving a Requested burger to a station that prints held work and holds none of the group's gives it the HOLD ticket, which the pass's release marks FIRE", async () => {
    const venue = await fresh();
    const { line, groupId } = await withTransaction(db, async (tx) => {
      const line = await firedFromHold(tx, venue, false);
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.fryer]);
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await moveTo(tx, venue, line.id, venue.stations.fryer);

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      expect(added("grill")).toEqual([cancelledBurger]);
      const fryer = added("fryer");
      expect(fryer).toHaveLength(1);
      expect(fryer[0]![0]).toBe("*** HOLD ***");
      expect(fryer[0]).toContain("From Grill");
      expect(fryer[0]).toContain("1.000 x BURG");
      expect(added("pass")).toEqual([cancelledBurger, fryer[0]]);
      const recorded = await tx
        .select({ stationId: orderGroupHoldStations.stationId })
        .from(orderGroupHoldStations)
        .where(eq(orderGroupHoldStations.groupId, line.groupId!));
      expect(recorded.map((row) => row.stationId).sort()).toEqual(
        [venue.stations.grill, venue.stations.fryer].sort(),
      );
      return { line, groupId: line.groupId! };
    });

    const pass = await passOn(db, venue);
    const card = await withTransaction(db, async (tx) => {
      const screen = (
        await VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, pass.deviceId)
      ).find((candidate) => candidate.kind === "pass")!;
      return (await readScopedPassBoard(tx, venue.cfg, passScopeOf(screen))).toFire.find(
        (found) => found.target.kind === "group" && found.target.groupId === groupId,
      )!;
    });
    expect(card.releaseTicketItemIds).toEqual([
      (await withTransaction(db, (tx) => itemOf(tx, line.id))).id,
    ]);
    const before = await withTransaction(db, (tx) => slips(tx, venue));
    await withTransaction(db, (tx) =>
      releasePassItems(tx, venue.cfg, pass, {
        submissionId: randomUUID(),
        target: card.target,
        ticketItemIds: card.releaseTicketItemIds,
        expectedContext: card.releaseContext,
      }),
    );
    const after = await withTransaction(db, (tx) => slips(tx, venue));
    const added = (name: string) => after[name]!.slice(before[name]!.length);
    const fired = added("fryer");
    expect(fired).toHaveLength(1);
    expect(fired[0]![0]).toBe(`*** ${kitchenTicketWords("en").fire} ***`);
    expect(fired[0]).toContain("1.000 x BURG");
    expect(added("pass")).toEqual(fired);
    for (const name of ["grill", "kitchen", "bar"]) expect(added(name)).toEqual([]);
  });
});

describe("A773 hold paper: edits", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh(): Promise<Venue> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    db = suite.db;
    useSplitExtrasDb(db);
    return setupSplitExtrasVenue();
  }

  const revisionOf = async (tx: Transaction, venue: Venue) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, venue.party.tabId));
    return order!.revision;
  };

  it("cutting a line of two Requested burgers to one takes one off the HOLD paper where it printed", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      const line = await firedFromHold(tx, venue, false, [burger(venue, false, "2")], "grouped");
      expect(line.quantity).toBe(2000);
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await updateOrderLine(
        tx,
        venue.cfg,
        venue.party.tabId,
        line.lineNo,
        { quantity: "1" },
        await revisionOf(tx, venue),
        OPERATOR,
      );

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      const cut = [
        "*** HOLD CHANGED ***",
        "Grill",
        "Split extras",
        "1",
        "13:05",
        "GROUP 1",
        "-1.000 x BURG",
        "",
      ];
      expect(added("grill")).toEqual([cut]);
      expect(added("pass")).toEqual([cut]);
      for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });

  it("removing a Requested burger's line in an edit cancels it on the HOLD paper where it printed", async () => {
    const venue = await fresh();
    const { kept, removedId, revision, expected } = await withTransaction(db, async (tx) => {
      await firedFromHold(tx, venue, false, [burger(venue, false), burger(venue, false)]);
      const lines = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, venue.party.tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      return {
        kept: lines[0]!.id,
        removedId: lines[1]!.id,
        revision: await revisionOf(tx, venue),
        expected: await slips(tx, venue),
      };
    });
    vi.setSystemTime(new Date(LATER));

    await updateHeldOrder({ admission: testTradingAdmission(), db }, venue.cfg, venue.party.tabId, {
      revision,
      operatorId: OPERATOR,
      lines: [
        {
          workingOrderLineId: kept,
          menuItemId: venue.tables.offerFor(venue.products.burger),
          quantity: "1",
        },
      ],
    });

    await withTransaction(db, async (tx) => {
      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(expected[name]!.length);
      expect(added("grill")).toEqual([cancelledBurger]);
      expect(added("pass")).toEqual([cancelledBurger]);
      for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
      expect(
        await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.id, removedId)),
      ).toEqual([]);
    });
  });
});

describe("A773 hold paper: added work", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh(): Promise<Venue> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    db = suite.db;
    useSplitExtrasDb(db);
    return setupSplitExtrasVenue();
  }

  const edit = async (
    tx: Transaction,
    venue: Venue,
    lineNo: number,
    patch: Parameters<typeof updateOrderLine>[4],
  ) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, venue.party.tabId));
    return updateOrderLine(
      tx,
      venue.cfg,
      venue.party.tabId,
      lineNo,
      patch,
      order!.revision,
      OPERATOR,
    );
  };

  const changed = (station: string, ...lines: string[]) => [
    "*** HOLD CHANGED ***",
    station,
    "Split extras",
    "1",
    "13:05",
    "GROUP 1",
    ...lines,
    "",
  ];

  const addedBurger = changed("Grill", "+1.000 x BURG");

  it("adding onion rings to a Requested burger tells Grill and Fryer on their HOLD paper", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [
        venue.stations.grill,
        venue.stations.fryer,
      ]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(venue, true)], release: "hold" }],
      });
      const hold = await slips(tx, venue);
      for (const name of ["grill", "fryer", "pass"])
        expect(hold[name]!.map((slip) => slip[0])).toContain("*** HOLD ***");
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        await partyArgs(tx, venue),
      );
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await edit(tx, venue, 1, {
        extras: [
          {
            listId: venue.lists.burger,
            picks: [
              { productId: venue.products.chips, quantity: 1 },
              { productId: venue.products.onionRings, quantity: 1 },
            ],
          },
        ],
      });

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      const grill = [
        changed("Grill", "-1.000 x BURG", "  > with CHIPS from Fryer"),
        changed("Grill", "+1.000 x BURG", "  > with CHIPS from Fryer", "  > with RINGS from Fryer"),
      ];
      const fryer = [
        changed("Fryer", "-1.000 x CHIPS", "  > for BURG at Grill"),
        changed("Fryer", "+1.000 x CHIPS", "  > for BURG at Grill"),
        changed("Fryer", "+1.000 x RINGS", "  > for BURG at Grill"),
      ];
      expect(added("grill")).toEqual(grill);
      expect(added("fryer")).toEqual(fryer);
      expect(added("pass")).toEqual([grill[0], fryer[0], grill[1], fryer[1], fryer[2]]);
      for (const name of ["kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });

  it("raising a Requested burger's line by a portion tells Grill on its HOLD paper", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      const line = await firedFromHold(tx, venue, false);
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await edit(tx, venue, line.lineNo, { quantity: "2" });

      const burgers = await tx
        .select({
          groupId: workingOrderLines.groupId,
          requestedAt: ticketItems.requestedAt,
          firedAt: ticketItems.firedAt,
        })
        .from(workingOrderLines)
        .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
        .where(
          and(
            eq(workingOrderLines.workingOrderId, venue.party.tabId),
            eq(workingOrderLines.productId, venue.products.burger),
          ),
        )
        .orderBy(workingOrderLines.lineNo);
      expect(burgers).toEqual([
        { groupId: line.groupId, requestedAt: AT, firedAt: null },
        { groupId: line.groupId, requestedAt: LATER, firedAt: null },
      ]);
      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      expect(added("grill")).toEqual([addedBurger]);
      expect(added("pass")).toEqual([addedBurger]);
      for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });

  it("raising a comped Requested burger adds a burger apart from it and tells Grill on its HOLD paper", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      const line = await firedFromHold(tx, venue, false);
      await tx
        .insert(persons)
        .values({ id: OPERATOR, displayName: "Operator", role: "supervisor" })
        .onConflictDoNothing({ target: persons.id });
      const [reason] = await tx
        .select({ id: adjustmentReasons.id })
        .from(adjustmentReasons)
        .where(eq(adjustmentReasons.name, GIVE_AWAY_REASON.name));
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, venue.party.tabId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          orderId: venue.party.tabId,
          expectedEdit: await readBillEditState(tx, venue.party.tabId),
          submissionId: randomUUID(),
          expectedRevision: order!.revision,
          lineId: line.id,
          reasonId: reason?.id ?? (await createAdjustmentReason(tx, GIVE_AWAY_REASON)).id,
          action: "comp",
          note: null,
          operatorId: OPERATOR,
        },
        venue.cfg.locale,
      );
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await edit(tx, venue, line.lineNo, { quantity: "2" });

      const burgers = await tx
        .select({
          quantity: workingOrderLines.quantity,
          groupId: workingOrderLines.groupId,
          requestedAt: ticketItems.requestedAt,
          firedAt: ticketItems.firedAt,
        })
        .from(workingOrderLines)
        .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
        .where(
          and(
            eq(workingOrderLines.workingOrderId, venue.party.tabId),
            eq(workingOrderLines.productId, venue.products.burger),
          ),
        )
        .orderBy(workingOrderLines.lineNo);
      expect(burgers).toEqual([
        { quantity: 1000, groupId: line.groupId, requestedAt: AT, firedAt: null },
        { quantity: 1000, groupId: line.groupId, requestedAt: LATER, firedAt: null },
      ]);
      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      expect(added("grill")).toEqual([addedBurger]);
      expect(added("pass")).toEqual([addedBurger]);
      for (const name of ["fryer", "kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });
});

describe("A773 hold paper: cancels of a whole dish, and released work", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh(): Promise<Venue> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    db = suite.db;
    useSplitExtrasDb(db);
    return setupSplitExtrasVenue();
  }

  async function cancelBurger(
    tx: Transaction,
    venue: Venue,
    lineId: string,
    outcome: "remove_charge" | "keep_charge",
  ) {
    await tx
      .insert(persons)
      .values({ id: OPERATOR, displayName: "Operator", role: "supervisor" })
      .onConflictDoNothing({ target: persons.id });
    const [bill] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, venue.party.tabId));
    await cancelItem(
      tx,
      venue.cfg,
      venue.party.partyId,
      lineId,
      {
        quantity: "1",
        outcome,
        reasonId: await cancelReasonId(tx),
        expectedEdit: await readBillEditState(tx, venue.party.tabId),
        expectedPartyRevision: (await partyArgs(tx, venue)).expectedPartyRevision,
        expectedBillRevision: bill!.revision,
        expectedContext: await readCancellationContext(tx, venue.party.partyId, lineId),
        submissionId: randomUUID(),
        admission: testTradingAdmission(),
      },
      OPERATOR,
    );
  }

  const burgerLine = async (tx: Transaction, venue: Venue) => {
    const [line] = await tx
      .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, venue.party.tabId),
          eq(workingOrderLines.productId, venue.products.burger),
        ),
      );
    return line!;
  };

  it("cancelling a Requested burger cancels its Requested chips on Fryer's HOLD paper", async () => {
    const venue = await fresh();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [
        venue.stations.grill,
        venue.stations.fryer,
      ]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(venue, true)], release: "hold" }],
      });
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        await partyArgs(tx, venue),
      );
      const line = await burgerLine(tx, venue);
      const before = await slips(tx, venue);
      vi.setSystemTime(new Date(LATER));

      await cancelLine(tx, venue.cfg, venue.party.tabId, line.lineNo);

      const after = await slips(tx, venue);
      const added = (name: string) => after[name]!.slice(before[name]!.length);
      const grill = [...cancelledBurger.slice(0, -1), "  > with CHIPS from Fryer", ""];
      const fryer = [
        "*** HOLD CANCELLED ***",
        "Fryer",
        "Split extras",
        "1",
        "13:05",
        "GROUP 1",
        "1.000 x CHIPS",
        "  > for BURG at Grill",
        "",
      ];
      expect(added("grill")).toEqual([grill]);
      expect(added("fryer")).toEqual([fryer]);
      expect(added("pass")).toEqual([grill, fryer]);
      for (const name of ["kitchen", "bar"]) expect(added(name)).toEqual([]);
    });
  });

  it("keeping the charge on a burger made here tells a waiting Fryer of its Requested chips in a held group whose HOLD printed elsewhere", async () => {
    const venue = await fresh();
    const [profile] = await withTransaction(db, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: "Grill till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id }),
    );
    const here = await enrolDeviceForTest(db, venue.cfg, {
      name: "Grill till",
      profileId: profile!.id,
    });
    await withTransaction(db, async (tx) => {
      await setMadeHereStations(tx, venue.cfg, here.deviceId, [venue.stations.grill]);
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.kitchen]);
      const placed = await placeGroups(
        tx,
        { ...venue.cfg, sendingDeviceId: here.deviceId },
        venue.party.partyId,
        {
          operatorId: OPERATOR,
          groups: [
            {
              lines: [
                burger(venue, true),
                { menuItemId: venue.tables.offerFor(venue.products.cheese), quantity: "1" },
              ],
              release: "hold",
            },
          ],
        },
      );
      const groupId = placed.groups[0]!.id;
      const [group] = await tx.select().from(orderGroups).where(eq(orderGroups.id, groupId));
      expect(group).toMatchObject({ state: "held", holdPrintedAt: AT });
      expect(
        await tx
          .select({ stationId: orderGroupHoldStations.stationId })
          .from(orderGroupHoldStations)
          .where(eq(orderGroupHoldStations.groupId, groupId)),
      ).toEqual([{ stationId: venue.stations.kitchen }]);
      const items = await tx
        .select({
          stationId: ticketItems.stationId,
          state: ticketItems.state,
          requestedAt: ticketItems.requestedAt,
          firedAt: ticketItems.firedAt,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, venue.party.tabId));
      expect(items).toEqual(
        expect.arrayContaining([
          { stationId: venue.stations.grill, state: "ready", requestedAt: AT, firedAt: AT },
          {
            stationId: venue.stations.fryer,
            state: expect.any(String),
            requestedAt: AT,
            firedAt: null,
          },
        ]),
      );
      const line = await burgerLine(tx, venue);
      const before = await slips(tx, venue);

      await cancelBurger(tx, venue, line.id, "keep_charge");

      const after = await slips(tx, venue);
      for (const name of Object.keys(after))
        expect(after[name]!.slice(before[name]!.length)).toEqual([]);
      expect(await noticesAt(tx, venue.stations.fryer)).toEqual([{ kind: "void", quantity: 1000 }]);
    });
  });

  /** A held burger with chips whose HOLD ticket printed at Grill and Fryer, fired with nothing
   *  waiting, so released. */
  async function releasedFromHold(tx: Transaction, venue: Venue) {
    await setStationPrinting(tx, { printHeldWork: true }, [
      venue.stations.grill,
      venue.stations.fryer,
    ]);
    const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [{ lines: [burger(venue, true)], release: "hold" }],
    });
    await fireGroup(
      tx,
      venue.cfg,
      venue.party.partyId,
      placed.groups[0]!.id,
      await partyArgs(tx, venue),
    );
    const line = await burgerLine(tx, venue);
    expect(
      await tx
        .select({ requestedAt: ticketItems.requestedAt, firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, venue.party.tabId)),
    ).toEqual([
      { requestedAt: AT, firedAt: AT },
      { requestedAt: AT, firedAt: AT },
    ]);
    const [group] = await tx
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.id, placed.groups[0]!.id));
    expect(group).toMatchObject({ state: "fired", holdPrintedAt: AT });
    return line;
  }

  for (const writer of ["draft recall", "the cancel that removes the charge"] as const)
    it(`${writer} of a released burger with chips in a fired group whose HOLD printed prints its slip and no HOLD CANCELLED`, async () => {
      const venue = await fresh();
      await withTransaction(db, async (tx) => {
        const line = await releasedFromHold(tx, venue);
        const before = await slips(tx, venue);
        vi.setSystemTime(new Date(LATER));

        if (writer === "draft recall")
          await recallToDraft(tx, venue.cfg, venue.party.partyId, line.id, {
            ...(await partyArgs(tx, venue)),
            expectedEdit: await readBillEditState(tx, venue.party.tabId),
          });
        else await cancelBurger(tx, venue, line.id, "remove_charge");

        const after = await slips(tx, venue);
        const added = (name: string) => after[name]!.slice(before[name]!.length);
        const word = writer === "draft recall" ? "*** RECALLED ***" : "*** VOID ***";
        const head = ["Split extras", "1", "13:05"];
        const grill = [word, "Grill", ...head, "1.000 x BURG", "  > with CHIPS from Fryer", ""];
        const fryer = [word, "Fryer", ...head, "1.000 x CHIPS", "  > for BURG at Grill", ""];
        expect(added("grill")).toEqual([grill]);
        expect(added("fryer")).toEqual([fryer]);
        expect(added("pass")).toEqual([grill, fryer]);
        for (const name of ["kitchen", "bar"]) expect(added(name)).toEqual([]);
      });
    });
});

/** A device whose own kitchen profile may run the pass, showing every station. */
async function passOn(db: Database, venue: Venue): Promise<PassActor> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({
        name: "Every pass profile",
        formFactor: "kds",
        capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
      })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name: "Every pass",
    profileId: profile!.id,
    kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
  });
  return { deviceId: joined.deviceId, personId: null };
}
