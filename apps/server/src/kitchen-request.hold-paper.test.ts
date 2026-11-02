import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { fireGroup } from "./order-groups.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem } from "./line-cancel.js";
import "./errors.js";

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

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

    type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

    const burger = (venue: Venue, chips: boolean) => ({
      menuItemId: venue.tables.offerFor(venue.products.burger),
      quantity: "1",
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

    /** A held group of one burger whose HOLD ticket printed at Grill, fired with Grill waiting. */
    async function firedFromHold(tx: Transaction, venue: Venue, chips: boolean) {
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(venue, chips)], release: "hold" }],
      });
      const hold = await slips(tx, venue);
      expect(hold.grill!.map((slip) => slip[0])).toEqual(["*** HOLD ***"]);
      expect(hold.pass!.map((slip) => slip[0])).toEqual(["*** HOLD ***"]);
      expect(hold.fryer).toEqual([]);
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        await partyArgs(tx, venue),
      );
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

    async function recall(tx: Transaction, venue: Venue, lineId: string) {
      await recallToDraft(tx, venue.cfg, venue.party.partyId, lineId, {
        ...(await partyArgs(tx, venue)),
        expectedEdit: await readBillEditState(tx, venue.party.tabId),
      });
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
