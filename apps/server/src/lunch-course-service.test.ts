import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { attendanceOperationFacts } from "@waitron/workforce";
import { systemClock } from "./till-backend.js";
import { applyPartyAllergyPatch, allergyTargets, readAllergySendView } from "./party-allergy.js";
import { serviceDishCondition } from "./service-dishes.js";
import { VENUE_SERVICE } from "./modules.js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  insertInChunks,
  ticketItems,
  printJobs,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { updateProduct, updateExtraList, writeProductModifiers } from "@waitron/catalogue";
import { workingLineContexts, setRoutingCell } from "@waitron/venue-service";
import { createCourse, setProductCourse } from "./kitchen.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  addTabRound,
  sendLines,
  updateOrderLine,
  moveDishesToStation,
} from "./testing/order-writer-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { finishPartyService } from "./finish-party-service.js";
import { readBillEditState } from "./bill-editing.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { ensureOperator, cancelLine } from "./testing/cancel-line.js";
import { adjustments } from "@waitron/adjustments";
import { readOrderDetail } from "./orders-list.js";
import { readOrderPreviewItems } from "./order-preview.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { createTable } from "./testing/live-table.js";
import { readOrderStateCounts } from "./order-state-counts.js";
import {
  markServed,
  ordersWithUnfiredDish,
  listCounterWaiting,
  fireOrderLines,
  listStationQueues,
  readPassRows,
} from "./working-order.js";
import { partyRevision } from "./parties.js";
import { cancelItemForTest } from "./testing/cancel-line.js";
import {
  readCurrentOrders,
  fireHeldLine,
  fireGroup,
  readHeldCounts,
  listOrderGroups,
} from "./order-groups.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeAll(() => useSplitExtrasDb(suite.db));

async function lunch(
  tx: Transaction,
  venue: Awaited<ReturnType<typeof setupSplitExtrasVenue>>,
  held: boolean | "round" = false,
) {
  await updateProduct(tx, venue.products.burger, {
    setLunch: true,
    unitPrice: "18.00",
    vatClass: "reduced",
  });
  const starter = await createCourse(tx, { name: "Starter", displayOrder: 1 });
  const main = await createCourse(tx, { name: "Main", displayOrder: 2 });
  await setProductCourse(tx, venue.products.cheese, starter.id);
  await setProductCourse(tx, venue.products.chips, main.id);
  await setProductCourse(tx, venue.products.onionRings, main.id);
  await updateExtraList(
    tx,
    venue.lists.burger,
    {
      name: "Lunch choices",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      active: true,
      items: [venue.products.cheese, venue.products.chips, venue.products.onionRings].map(
        (productId) => ({
          productId,
          maxQuantity: 1,
          preselected: false,
          price: productId === venue.products.chips ? "3.00" : "0.00",
        }),
      ),
    },
    venue.cfg.locale,
  );
  await writeProductModifiers(tx, venue.products.burger, [
    { kind: "extras", id: venue.lists.burger },
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
  const picks = (ids: string[]) => [
    { listId: venue.lists.burger, picks: ids.map((productId) => ({ productId, quantity: 1 })) },
  ];
  const request = {
    menuItemId: offers.offerFor(venue.products.burger),
    quantity: "1",
    extras: picks([venue.products.cheese, venue.products.chips]),
  };
  if (held === true)
    await placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [{ lines: [request], release: "hold" }],
    });
  else
    await addTabRound(tx, venue.cfg, venue.party.tabId, [{ ...request, hold: held === "round" }]);
  return { starter, main, picks };
}
async function rows(tx: Transaction, id: string) {
  return tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
}
async function tickets(tx: Transaction, id: string) {
  return ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, id));
}

describe("set lunch course service", () => {
  it("sends children by their own course, excludes the shell, and prints only the current dishes with their lunch reference", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      const { starter, main } = await lunch(tx, venue);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      const chips = lines.find((line) => line.productId === venue.products.chips)!;
      const initial = await tickets(tx, id);
      expect(
        initial.map((item) => ({
          lineId: item.workingOrderLineId,
          course: item.courseId,
          fired: item.firedAt !== null,
        })),
      ).toEqual([
        { lineId: cheese.id, course: starter.id, fired: true },
        { lineId: chips.id, course: main.id, fired: false },
      ]);
      expect((await rows(tx, id)).find((line) => line.id === chips.id)!.sentAt).toBeNull();
      await sendLines(tx, venue.cfg, id, [chips.lineNo]);
      const sent = await tickets(tx, id);
      expect(sent.find((item) => item.workingOrderLineId === cheese.id)).toEqual(initial[0]);
      expect(sent.find((item) => item.workingOrderLineId === chips.id)?.firedAt).not.toBeNull();
      const paper = (
        await tx.select().from(printJobs).where(eq(printJobs.printerId, venue.printers.fryer))
      )
        .map((job) => decodeTicket(job.payload))
        .join("\n");
      expect(paper).toContain("CHIPS");
      expect(paper).toContain("BURG");
      expect(paper).not.toContain("CHED");
      expect(await readOrderStateCounts(tx, [id])).toEqual(
        new Map([[id, { ordered: 2, unsent: 0, held: 0, waiting: 2, ready: 0 }]]),
      );
      const current = await readCurrentOrders(tx, venue.party.partyId);
      expect(current.ungrouped.map((row) => row.lineId).sort()).toEqual(
        [cheese.id, chips.id].sort(),
      );
    });
  });
  it("replaces an unsent later choice while the starter is preparing, then explicitly sends the replacement", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      const { picks } = await lunch(tx, venue);
      const initial = await tickets(tx, id);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      await tx
        .update(ticketItems)
        .set({ state: "preparing" })
        .where(eq(ticketItems.workingOrderLineId, cheese.id));
      const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      await updateOrderLine(
        tx,
        venue.cfg,
        id,
        lines[0]!.lineNo,
        { extras: picks([venue.products.cheese, venue.products.onionRings]) },
        bill!.revision,
        OPERATOR,
      );
      const changed = await rows(tx, id);
      expect(changed.map((line) => line.lineTotal).sort((a, b) => a - b)).toEqual([0, 0, 1800]);
      expect((await tickets(tx, id)).find((item) => item.workingOrderLineId === cheese.id)).toEqual(
        { ...initial.find((item) => item.workingOrderLineId === cheese.id), state: "preparing" },
      );
      const rings = changed.find((line) => line.productId === venue.products.onionRings)!;
      expect((await tickets(tx, id)).some((item) => item.workingOrderLineId === rings.id)).toBe(
        false,
      );
      await ensureOperator(tx, OPERATOR);
      const [beforeSend] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      await sendLines(tx, venue.cfg, id, [rings.lineNo], {
        personId: OPERATOR,
        recorder: recordAttendanceFact,
        clock: systemClock(),
      });
      const [afterSend] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect(afterSend!.revision).toBe(beforeSend!.revision + 1);
      expect(
        await tx
          .select({
            key: attendanceOperationFacts.key,
            personId: attendanceOperationFacts.personId,
            outcome: attendanceOperationFacts.outcome,
          })
          .from(attendanceOperationFacts)
          .where(eq(attendanceOperationFacts.source, "order")),
      ).toEqual([
        { key: `${id}:${afterSend!.revision}:send`, personId: OPERATOR, outcome: "qualifying" },
      ]);
      expect(
        (await tickets(tx, id)).find((item) => item.workingOrderLineId === rings.id),
      ).toMatchObject({
        courseId: rings.courseId,
        firedAt: expect.any(String),
        stationId: venue.stations.fryer,
      });
    });
  });
  it("serves the starter alone and moves the held main to another station without moving the lunch's billing family", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      const chips = lines.find((line) => line.productId === venue.products.chips)!;
      await markServed(tx, venue.cfg, venue.party.partyId, [{ lineId: cheese.id, quantity: "1" }], {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      expect(
        (await rows(tx, id)).filter((line) => line.servedQuantity > 0).map((line) => line.id),
      ).toEqual([cheese.id]);
      expect(await ordersWithUnfiredDish(tx, [id])).toEqual(new Set([id]));
      await moveDishesToStation(
        tx,
        venue.cfg,
        id,
        { lineIds: [chips.id], stationId: venue.stations.bar, submissionId: randomUUID() },
        { personId: OPERATOR, deviceId: null },
      );
      expect(
        (await tickets(tx, id)).find((item) => item.workingOrderLineId === chips.id)?.stationId,
      ).toBe(venue.stations.bar);
      expect((await rows(tx, id)).find((line) => line.id === chips.id)?.parentLineId).toBe(
        lines[0]!.id,
      );
      await cancelItemForTest(tx, venue.cfg, id, chips.lineNo, undefined, OPERATOR);
      expect(await ordersWithUnfiredDish(tx, [id])).toEqual(new Set());
    });
  });
  it("releases a single lunch course from a held group and counts the remaining dishes", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue, true);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      const chips = lines.find((line) => line.productId === venue.products.chips)!;
      expect(await readHeldCounts(tx, [venue.party.partyId])).toEqual(
        new Map([[venue.party.partyId, 2]]),
      );
      await fireHeldLine(tx, venue.cfg, venue.party.partyId, cheese.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      const sent = await tickets(tx, id);
      expect(sent.find((item) => item.workingOrderLineId === cheese.id)?.firedAt).not.toBeNull();
      expect(sent.find((item) => item.workingOrderLineId === chips.id)?.firedAt).toBeNull();
      expect(await readHeldCounts(tx, [venue.party.partyId])).toEqual(
        new Map([[venue.party.partyId, 1]]),
      );
      await fireHeldLine(tx, venue.cfg, venue.party.partyId, chips.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      expect(
        (await listOrderGroups(tx, venue.party.partyId)).groups.map((group) => group.state),
      ).toEqual(["fired", "fired"]);
      expect((await rows(tx, id)).find((line) => line.id === chips.id)?.parentLineId).toBe(
        lines[0]!.id,
      );
    });
  });

  it("moves a lunch bill between tables with each course's state and keeps its financial preview grouped", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue, true);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      const chips = lines.find((line) => line.productId === venue.products.chips)!;
      await fireHeldLine(tx, venue.cfg, venue.party.partyId, cheese.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      const before = await tickets(tx, id);
      const target = await createTable(tx, venue.cfg, {
        label: "Next table",
        zoneId: venue.tables.zoneId,
      });
      const moved = await moveBill(
        tx,
        venue.cfg,
        id,
        { tableId: target.id },
        {
          operatorId: OPERATOR,
          partyId: venue.party.partyId,
          expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        },
      );
      expect(await tickets(tx, id)).toEqual(before);
      const view = await readCurrentOrders(tx, moved.partyId!);
      const all = [...view.groups.flatMap((group) => group.rows), ...view.ungrouped];
      expect(all.map((row) => row.lineId).sort()).toEqual([cheese.id, chips.id].sort());
      expect(all.find((row) => row.lineId === cheese.id)?.released).toBe(true);
      expect(all.find((row) => row.lineId === chips.id)?.released).toBe(false);
      const preview = await readOrderPreviewItems(tx, [id]);
      expect(preview.get(id)).toEqual([
        expect.objectContaining({
          lineId: lines[0]!.id,
          name: "Burger",
          extras: [
            expect.objectContaining({ lineId: cheese.id }),
            expect.objectContaining({ lineId: chips.id }),
          ],
        }),
      ]);
    });
  });
  it("keeps identical lunches separate in the order detail", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue, true);
      const offers = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            lines: [
              {
                menuItemId: offers.offerFor(venue.products.burger),
                quantity: "1",
                extras: [
                  {
                    listId: venue.lists.burger,
                    picks: [
                      { productId: venue.products.cheese, quantity: 1 },
                      { productId: venue.products.chips, quantity: 1 },
                    ],
                  },
                ],
              },
            ],
            release: "hold",
          },
        ],
      });
      const detail = await readOrderDetail(tx, id, "all", false);
      expect(
        detail!.lines.filter((line) => line.name === "Burger").map((line) => line.quantity),
      ).toEqual(["1.000", "1.000"]);
    });
  });

  it("lists the unserved lunch dishes when finishing a settled table, without the priced shell", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue);
      const lines = await rows(tx, id);
      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: new Date().toISOString() })
        .where(eq(workingOrders.id, id));
      await expect(
        finishPartyService(tx, venue.cfg, {
          admission: testTradingAdmission(),
          partyId: venue.party.partyId,
          operatorId: OPERATOR,
          expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
          expectedEdits: [await readBillEditState(tx, id)],
        }),
      ).rejects.toMatchObject({
        code: "party.unserved_dishes",
        params: {
          dishes: [
            expect.objectContaining({ lineId: lines[1]!.id }),
            expect.objectContaining({ lineId: lines[2]!.id }),
          ],
        },
      });
    });
  });
  it.each(["dish", "lunch"])("records the fired stage when cancelling the %s", async (target) => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue);
      const lines = await rows(tx, id);
      const cheese = lines.find((line) => line.productId === venue.products.cheese)!;
      const subject = target === "dish" ? cheese : lines[0]!;
      await cancelLine(tx, venue.cfg, id, subject.lineNo, undefined, OPERATOR);
      const [record] = await tx
        .select()
        .from(adjustments)
        .where(eq(adjustments.lineId, subject.id));
      expect(record?.stage).toBe("fired");
    });
  });
  it("carries a later course's guest allergy onto its own slip without changing the earlier course", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue);
      const lines = await rows(tx, id);
      const chips = lines.find((line) => line.productId === venue.products.chips)!;
      const initial = await tickets(tx, id);
      const earlier = initial.find((item) => item.workingOrderLineId !== chips.id)!;
      const frozen = await VENUE_SERVICE.readTicketAllergies(tx, [earlier.id]);
      const view = await readAllergySendView(tx, venue.cfg, venue.party.partyId, {
        kind: "lines",
        orderId: id,
        lineNos: [chips.lineNo],
      });
      await applyPartyAllergyPatch(
        tx,
        venue.party.partyId,
        {
          party: {
            answer: "allergies",
            guests: [{ who: "Guest A", allergens: { gluten: { kinds: ["wheat"] } }, note: null }],
          },
          ticks: [{ line: { kind: "working", id: chips.id }, guestIndex: 0 }],
        },
        OPERATOR,
        allergyTargets(view),
      );
      await sendLines(tx, venue.cfg, id, [chips.lineNo]);
      const item = (await tickets(tx, id)).find((item) => item.workingOrderLineId === chips.id)!;
      const recorded = await VENUE_SERVICE.readTicketAllergies(tx, [earlier.id, item.id]);
      expect(recorded.get(item.id)?.originalBlock).toMatchObject({
        who: "Guest A",
        clashes: { gluten: { kinds: ["wheat"] } },
      });
      expect(recorded.get(earlier.id)).toEqual(frozen.get(earlier.id));
    });
  });
  it("keeps recalled lunch dishes in their courses when its note changes, without sending an unqueued choice", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      const { picks } = await lunch(tx, venue);
      let [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      await updateOrderLine(
        tx,
        venue.cfg,
        id,
        (await rows(tx, id))[0]!.lineNo,
        { extras: picks([venue.products.cheese, venue.products.onionRings]) },
        bill!.revision,
        OPERATOR,
      );
      [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      await updateOrderLine(
        tx,
        venue.cfg,
        id,
        (await rows(tx, id))[0]!.lineNo,
        { note: "No salt" },
        bill!.revision,
        OPERATOR,
      );
      const lines = await rows(tx, id);
      const items = await tickets(tx, id);
      expect(
        items.map((item) => ({
          productId: lines.find((line) => line.id === item.workingOrderLineId)!.productId,
          fired: item.firedAt !== null,
        })),
      ).toEqual([{ productId: venue.products.cheese, fired: true }]);
      const jobs = await tx
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, venue.printers.kitchen));
      expect(decodeTicket(jobs.at(-1)!.payload)).toContain("No salt");
      expect(items[0]!.note).toBe("No salt");
      expect(
        (await listStationQueues(tx, [venue.stations.kitchen])).get(venue.stations.kitchen)![0]!
          .items[0]!.note,
      ).toBe("No salt");
      expect(
        (
          await readPassRows(
            tx,
            inArray(
              ticketItems.workingOrderLineId,
              sql`(select id from working_order_lines where working_order_id = ${id})`,
            ),
            Date.now(),
          )
        )[0]!.item.note,
      ).toBe("No salt");
    });
  });
  it.each(["group", "line"] as const)(
    "fires a replaced choice through its held %s",
    async (path) => {
      const venue = await setupSplitExtrasVenue();
      const id = venue.party.tabId;
      await withTransaction(suite.db, async (tx) => {
        const { picks } = await lunch(tx, venue, true);
        const initial = await rows(tx, id);
        const starter = initial.find((line) => line.productId === venue.products.cheese)!;
        await fireHeldLine(tx, venue.cfg, venue.party.partyId, starter.id, {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        });
        const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
        await updateOrderLine(
          tx,
          venue.cfg,
          id,
          initial[0]!.lineNo,
          { extras: picks([venue.products.cheese, venue.products.onionRings]) },
          bill!.revision,
          OPERATOR,
        );
        const choice = (await rows(tx, id)).find(
          (line) => line.productId === venue.products.onionRings,
        )!;
        const [beforeSend] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
        if (path === "line") await fireOrderLines(tx, venue.cfg, id, [choice.id]);
        else
          await fireGroup(tx, venue.cfg, venue.party.partyId, choice.groupId!, {
            operatorId: OPERATOR,
            submissionId: randomUUID(),
            expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
          });
        const [afterSend] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
        expect(afterSend!.revision).toBe(beforeSend!.revision + 1);
        expect(
          (await tickets(tx, id)).find((item) => item.workingOrderLineId === choice.id),
        ).toMatchObject({ firedAt: expect.any(String) });
      });
    },
  );
  it.each([false, true])(
    "keeps copied courses held and unqueued choices unsent (later choice: %s)",
    async (late) => {
      const venue = await setupSplitExtrasVenue();
      const id = venue.party.tabId;
      await withTransaction(suite.db, async (tx) => {
        const { picks } = await lunch(tx, venue);
        if (late) {
          const [before] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
          await updateOrderLine(
            tx,
            venue.cfg,
            id,
            (await rows(tx, id))[0]!.lineNo,
            { extras: picks([venue.products.cheese, venue.products.onionRings]) },
            before!.revision,
            OPERATOR,
          );
        }
        const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
        await updateOrderLine(
          tx,
          venue.cfg,
          id,
          (await rows(tx, id))[0]!.lineNo,
          { quantity: "2" },
          bill!.revision,
          OPERATOR,
        );
        const lines = await rows(tx, id);
        const items = await tickets(tx, id);
        expect(
          lines.filter((line) => line.parentLineId === null).map((line) => line.quantity),
        ).toEqual([1000, 1000]);
        expect(
          items
            .filter(
              (item) =>
                lines.find((line) => line.id === item.workingOrderLineId)!.productId ===
                venue.products.chips,
            )
            .map((item) => item.firedAt),
        ).toEqual(late ? [] : [null, null]);
        expect(
          items.filter(
            (item) =>
              lines.find((line) => line.id === item.workingOrderLineId)!.productId ===
              venue.products.onionRings,
          ),
        ).toEqual([]);
        expect(
          items
            .filter(
              (item) =>
                lines.find((line) => line.id === item.workingOrderLineId)!.productId ===
                venue.products.cheese,
            )
            .map((item) => item.firedAt),
        ).toEqual([expect.any(String), expect.any(String)]);
      });
    },
  );
  it("holds lunch dishes added through the round writer until asked", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue, "round");
      expect((await tickets(tx, venue.party.tabId)).map((item) => item.firedAt)).toEqual([
        null,
        null,
      ]);
    });
  });

  it("inherits the guest assigned to the whole lunch on each course slip", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue, true);
      const lines = await rows(tx, id);
      await VENUE_SERVICE.writePartyAllergy(
        tx,
        venue.party.partyId,
        {
          answer: "allergies",
          guests: [{ who: "Guest B", allergens: { gluten: { kinds: ["wheat"] } }, note: null }],
        },
        OPERATOR,
      );
      const snapshot = await VENUE_SERVICE.readPartyAllergy(tx, venue.party.partyId);
      await VENUE_SERVICE.setAllergyLineTicks(tx, venue.party.partyId, [
        { workingLineId: lines[0]!.id, draftLineId: null, guestId: snapshot.guests[0]!.id },
      ]);
      const groupId = (await listOrderGroups(tx, venue.party.partyId)).groups[0]!.id;
      await fireGroup(tx, venue.cfg, venue.party.partyId, groupId, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      const items = await tickets(tx, id);
      const recorded = await VENUE_SERVICE.readTicketAllergies(
        tx,
        items.map((item) => item.id),
      );
      expect(items.map((item) => recorded.get(item.id)?.originalBlock?.who)).toEqual([
        "Guest B",
        "Guest B",
      ]);
    });
  });
  it("shows a settled counter lunch's dishes as waiting for collection", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    const children = await withTransaction(suite.db, async (tx) => {
      await lunch(tx, venue);
      const lines = await rows(tx, id);
      await tx
        .update(workingOrders)
        .set({ partyId: null, status: "settled", settledAt: new Date().toISOString() })
        .where(eq(workingOrders.id, id));
      return {
        starter: lines.find((line) => line.productId === venue.products.cheese)!.id,
        main: lines.find((line) => line.productId === venue.products.chips)!.id,
      };
    });
    expect(
      (await listCounterWaiting({ db: suite.db })).find((order) => order.id === id)?.movableDishes,
    ).toEqual([
      { lineId: children.starter, stationId: venue.stations.kitchen },
      { lineId: children.main, stationId: venue.stations.fryer },
    ]);
  });
});

it("selects the dishes of 32,767 set lunches while excluding their priced shells", async () => {
  const venue = await setupSplitExtrasVenue();
  await withTransaction(suite.db, async (tx) => {
    await lunch(tx, venue);
    await addTabRound(tx, venue.cfg, venue.party.tabId, [
      { menuItemId: venue.tables.offerFor(venue.products.water), quantity: "1" },
    ]);
    const original = await rows(tx, venue.party.tabId);
    const shell = original.find((row) => row.productId === venue.products.burger)!;
    const children = original.filter((row) => row.parentLineId === shell.id);
    const [context] = await tx
      .select()
      .from(workingLineContexts)
      .where(eq(workingLineContexts.workingOrderLineId, shell.id));
    const shells = Array.from({ length: 32766 }, () => randomUUID());
    const dishes = shells.map(() => randomUUID());
    await insertInChunks(
      tx,
      workingOrderLines,
      shells.flatMap((id, i) => [
        { ...shell, id, lineNo: 5 + i * 2 },
        { ...children[0]!, id: dishes[i]!, parentLineId: id, lineNo: 6 + i * 2 },
      ]),
    );
    await insertInChunks(
      tx,
      workingLineContexts,
      shells.map((id) => ({ ...context!, workingOrderLineId: id })),
    );
    const scope = eq(workingOrderLines.workingOrderId, venue.party.tabId);
    const selected = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(scope, await serviceDishCondition(tx, scope)));
    expect(new Set(selected.map((row) => row.id))).toEqual(
      new Set([
        ...children.map((row) => row.id),
        ...dishes,
        original.find((row) => row.productId === venue.products.water)!.id,
      ]),
    );
  });
});
