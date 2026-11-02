import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustments } from "@waitron/adjustments";
import {
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listStationNotices } from "@waitron/venue-service";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { readBillEditState } from "./bill-editing.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { createStation } from "./kitchen.js";
import { fireGroup } from "./order-groups.js";
import { printedLines } from "./testing/decode-ticket.js";
import { moveDishesToStation } from "./testing/order-writer-fixture.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

/** Three Pizzas with two Olives each, 36.00; the Pizzas are sent to a waiting station, so Requested. */
async function requestedPizzas(release: "fire" | "hold" = "fire") {
  await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [venue.stationId]));
  try {
    const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
      release,
      shape: "grouped",
    });
    const parent = await inTx(venue, async (tx) => {
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId))
        .orderBy(workingOrderLines.lineNo);
      if (release === "hold") {
        const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
        await fireGroup(tx, venue.cfg, order.partyId, line!.groupId!, {
          submissionId: randomUUID(),
          expectedPartyRevision: party!.revision,
          operatorId: venue.staffId,
        });
      }
      return line!;
    });
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, order.billId)),
    );
    expect(items).toMatchObject([
      { workingOrderLineId: parent.id, requestedAt: expect.any(String), firedAt: null },
    ]);
    return { ...order, parent };
  } finally {
    await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [venue.stationId]));
  }
}
type Order = Awaited<ReturnType<typeof requestedPizzas>>;

async function pay(order: Order) {
  await payWorkingOrder(
    { admission: testTradingAdmission(), db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { id: order.billId, tender: { method: "cash", amount: "36.00" }, lines: [] },
  );
}

async function askFor(
  order: Order,
  outcome: CancelItemAsk["outcome"],
  quantity = "2",
): Promise<CancelItemAsk> {
  return inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
    const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, order.billId));
    return {
      quantity,
      expectedEdit: await readBillEditState(tx, order.billId),
      outcome,
      reasonId: venue.reasonId.houseVoid,
      expectedPartyRevision: party!.revision,
      expectedBillRevision: bill!.revision,
      expectedContext: await readCancellationContext(tx, order.partyId, order.parent.id),
      submissionId: randomUUID(),
    };
  });
}

function cancel(order: Order, ask: CancelItemAsk) {
  return inTx(venue, (tx) =>
    cancelItem(
      tx,
      venue.cfg,
      order.partyId,
      order.parent.id,
      { ...ask, admission: testTradingAdmission() },
      venue.staffId,
    ),
  );
}

const jobs = () =>
  inTx(venue, (tx) =>
    tx
      .select()
      .from(printJobs)
      .orderBy(sql`rowid`),
  );
const notices = async (order: Order, stationId = venue.stationId) =>
  (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, stationId))).filter(
    (notice) => notice.workingOrderId === order.billId,
  );

describe("A773 requested lifecycle: cancel", () => {
  it("keeps the charge on a paid Requested dish without printing or telling the kitchen", async () => {
    const order = await requestedPizzas();
    await pay(order);
    const before = (await jobs()).length;
    await cancel(order, await askFor(order, "keep_charge"));
    expect((await jobs()).slice(before).map((job) => printedLines(job.payload))).toEqual([]);
    expect(await notices(order)).toEqual([]);
  });

  it("records keeping the charge on a paid Requested dish at stage unsent", async () => {
    const order = await requestedPizzas();
    await pay(order);
    await cancel(order, await askFor(order, "keep_charge"));
    const recorded = await inTx(venue, (tx) =>
      tx.select().from(adjustments).where(eq(adjustments.workingOrderId, order.billId)),
    );
    expect(recorded).toMatchObject([
      { lineId: order.parent.id, action: "cancel", quantity: 2000, stage: "unsent" },
    ]);
  });

  it("keeps the charge where the group's HOLD paper printed: one HOLD CANCELLED slip naming the group", async () => {
    await inTx(venue, (tx) => setStationPrinting(tx, { printHeldWork: true }, [venue.stationId]));
    try {
      const before = (await jobs()).length;
      const order = await requestedPizzas("hold");
      const holdPaper = (await jobs()).slice(before);
      expect(holdPaper).toHaveLength(1);
      await pay(order);
      const beforeCancel = (await jobs()).length;
      await cancel(order, await askFor(order, "keep_charge"));
      const printed = (await jobs()).slice(beforeCancel);
      expect(printed.map((job) => job.printerId)).toEqual([venue.printerId]);
      const lines = printedLines(printed[0]!.payload);
      expect(lines).toContain(`*** ${kitchenTicketWords("es").holdCancelled} ***`);
      expect(lines.join("\n")).toContain("2.000 x PIZZA");
      const [group] = await inTx(venue, (tx) =>
        tx.select().from(orderGroups).where(eq(orderGroups.id, order.parent.groupId!)),
      );
      expect(lines).toContain(`${kitchenTicketWords("es").group} ${group!.displayNumber}`);
      expect(await notices(order)).toMatchObject([{ kind: "void", quantity: "2.000" }]);
    } finally {
      await inTx(venue, (tx) =>
        setStationPrinting(tx, { printHeldWork: false }, [venue.stationId]),
      );
    }
  });

  it("removes the charge on an unpaid Requested dish without printing or telling the kitchen", async () => {
    const order = await requestedPizzas();
    const before = (await jobs()).length;
    await cancel(order, await askFor(order, "remove_charge"));
    const lines = await inTx(venue, (tx) =>
      tx
        .select({ quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(lines.map((line) => line.quantity)).toEqual([1000, 2000]);
    expect((await jobs()).slice(before).map((job) => printedLines(job.payload))).toEqual([]);
    expect(await notices(order)).toEqual([]);
  });

  it("refuses a claim that preparation started on a Requested dish", async () => {
    const order = await requestedPizzas();
    await expect(
      cancel(order, { ...(await askFor(order, "remove_charge")), preparationStarted: true }),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "preparationStarted" },
    });
  });
  it("keeps the charge on a Requested dish moved away from its group's HOLD paper without telling either station", async () => {
    await inTx(venue, (tx) => setStationPrinting(tx, { printHeldWork: true }, [venue.stationId]));
    try {
      const before = (await jobs()).length;
      const order = await requestedPizzas("hold");
      expect((await jobs()).slice(before)).toHaveLength(1);
      const elsewhere = await inTx(venue, async (tx) => {
        const station = await createStation(tx, venue.cfg, { name: "No HOLD paper here" });
        await moveDishesToStation(
          tx,
          venue.cfg,
          order.billId,
          { submissionId: randomUUID(), lineIds: [order.parent.id], stationId: station.id },
          { deviceId: venue.deviceId, personId: venue.staffId },
        );
        return station.id;
      });
      await pay(order);
      const beforeCancel = (await jobs()).length;
      await cancel(order, await askFor(order, "keep_charge"));
      expect((await jobs()).slice(beforeCancel)).toEqual([]);
      expect(await notices(order, elsewhere)).toEqual([]);
      expect(await notices(order)).toEqual([]);
    } finally {
      await inTx(venue, (tx) =>
        setStationPrinting(tx, { printHeldWork: false }, [venue.stationId]),
      );
    }
  });

  it("with no station waiting, keeps the charge on a held dish with no HOLD paper: one HOLD CANCELLED slip", async () => {
    const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
      release: "hold",
      shape: "grouped",
    });
    const parent = await inTx(venue, async (tx) => {
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId))
        .orderBy(workingOrderLines.lineNo);
      const [group] = await tx.select().from(orderGroups).where(eq(orderGroups.id, line!.groupId!));
      expect(group).toMatchObject({ state: "held", holdPrintedAt: null });
      return line!;
    });
    const held = { ...order, parent };
    await pay(held);
    const before = (await jobs()).length;
    await cancel(held, await askFor(held, "keep_charge"));
    const printed = (await jobs()).slice(before);
    expect(printed.map((job) => job.printerId)).toEqual([venue.printerId]);
    const lines = printedLines(printed[0]!.payload);
    expect(lines).toContain(`*** ${kitchenTicketWords("es").holdCancelled} ***`);
    expect(lines.join("\n")).toContain("2.000 x PIZZA");
    expect(await notices(held)).toMatchObject([{ kind: "void", quantity: "2.000" }]);
  });
});
