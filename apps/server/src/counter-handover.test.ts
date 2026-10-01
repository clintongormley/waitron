import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorZones, invoiceSeries, workingOrders } from "@waitron/db";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { ServiceMode } from "@waitron/module";
import { VENUE_SERVICE } from "./modules.js";
import { markCollected, parkOrder, placeOrder } from "./working-order.js";
import { inTx, provisionBillVenue, registroCount, tabWith } from "./testing/bill-venue.js";
import type { BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { collectOrder, payWorkingOrder, payWorkingOrderIntegrated } from "./till-sale.js";
import "./errors.js";

// Counter service (spec §5): a counter order may be handed over before or after it is paid.
let venue: BillVenue;
const zones = {} as Record<"ticket_then_pay" | "invoice_first" | "prepay", string>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    for (const mode of ["ticket_then_pay", "invoice_first", "prepay"] as const) {
      zones[mode] = await inTx(venue, async (tx) => {
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: venue.cfg.locationId, name: `Barra ${mode}` })
          .returning({ id: floorZones.id });
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, serviceMode: mode });
        return zone!.id;
      });
    }
    // Caña is poured at the bar: it goes to no station, so an order of it alone has no kitchen
    // ticket.
    venue.db.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = (select product_id from menu_items where id = ${venue.offerFor("Caña")})`);
  },
});

const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });

/** A counter order of one of each named dish in the zone of `mode`, parked and still open. */
async function parked(mode: ServiceMode, ...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder(deps(), venue.cfg, {
    id,
    zoneId: zones[mode as keyof typeof zones],
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    operatorId: venue.operatorId,
  });
  return id;
}

/** A counter order sent to the kitchen without payment. */
async function placed(mode: ServiceMode, ...names: string[]): Promise<string> {
  const id = await parked(mode, ...names);
  await placeOrder(deps(), venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  return id;
}

async function orderRow(id: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(workingOrders).where(eq(workingOrders.id, id)),
  );
  return row!;
}

function ticketItemCount(id: string): number {
  const [row] = venue.db.all<{ count: number }>(
    sql`select count(*) as count from ticket_items where working_order_id = ${id}`,
  );
  return Number(row!.count);
}

function saleCount(id: string): number {
  const [row] = venue.db.all<{ count: number }>(
    sql`select count(*) as count from sales where working_order_id = ${id}`,
  );
  return Number(row!.count);
}

describe("handing over a counter order sent without payment", () => {
  it.each(["ticket_then_pay", "invoice_first"] as const)(
    "hands over a placed, fired %s order: only collected_at changes and it stays placed",
    async (mode) => {
      const id = await placed(mode, "Tarta");
      const before = await orderRow(id);
      expect(before.status).toBe("placed");
      expect(before.collectedAt).toBeNull();

      await markCollected({ db: venue.db }, venue.cfg, id);

      const after = await orderRow(id);
      expect(after.collectedAt).not.toBeNull();
      expect(after).toEqual({ ...before, collectedAt: after.collectedAt });
      expect(after.status).toBe("placed");
    },
  );

  it("refuses a second handover of a placed order (working_order.already_collected)", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, id);
    const first = (await orderRow(id)).collectedAt;

    await expect(markCollected({ db: venue.db }, venue.cfg, id)).rejects.toMatchObject({
      code: "working_order.already_collected",
      params: { workingOrderId: id },
    });
    expect((await orderRow(id)).collectedAt).toBe(first);
  });

  it("refuses an open counter order (working_order.not_settled)", async () => {
    const id = await parked("ticket_then_pay", "Tarta");
    await expect(markCollected({ db: venue.db }, venue.cfg, id)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: id },
    });
    expect((await orderRow(id)).collectedAt).toBeNull();
  });

  it("refuses a placed order with no kitchen ticket (ticket.not_fired)", async () => {
    const id = await placed("ticket_then_pay", "Caña");
    expect(ticketItemCount(id)).toBe(0);
    const before = await orderRow(id);

    await expect(markCollected({ db: venue.db }, venue.cfg, id)).rejects.toMatchObject({
      code: "ticket.not_fired",
      params: { workingOrderId: id },
    });
    expect(await orderRow(id)).toEqual(before);
  });

  it("refuses a presented table bill, even in a mode that takes payment after sending (working_order.not_settled)", async () => {
    const id = await tabWith(venue, "Paella");
    await inTx(venue, (tx) =>
      VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, id, zones.ticket_then_pay),
    );
    const context = await inTx(venue, (tx) => VENUE_SERVICE.findOrderContext(tx, venue.cfg, id));
    expect(context?.serviceMode).toBe("ticket_then_pay");
    await placeOrder(deps(), venue.cfg, id, venue.operatorId, venue.cfg.tillId);
    const before = await orderRow(id);
    expect(before.status).toBe("placed");
    expect(before.partyId).not.toBeNull();
    expect(ticketItemCount(id)).toBeGreaterThan(0);

    await expect(markCollected({ db: venue.db }, venue.cfg, id)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: id },
    });
    expect(await orderRow(id)).toEqual(before);
  });

  it("refuses a placed order whose service mode takes payment first (working_order.not_settled)", async () => {
    const id = await placed("prepay", "Tarta");
    expect(ticketItemCount(id)).toBeGreaterThan(0);

    await expect(markCollected({ db: venue.db }, venue.cfg, id)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: id },
    });
    expect((await orderRow(id)).collectedAt).toBeNull();
  });

  it("files nothing when it hands over a placed order", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, id);
    expect(saleCount(id)).toBe(0);
    expect(registroCount(venue, id)).toBe(0);
  });
});

/** Long enough that a payment stamped at its own time cannot carry the handover's millisecond. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Pays a placed order in cash through the till's collect. */
function collectCash(id: string, amount = "50.00") {
  return collectOrder(deps(), venue.cfg, {
    id,
    lines: [],
    tender: { method: "cash", amount },
  });
}

/** Pays a placed order on the card reader through the till's integrated card collect. */
async function collectByCard(id: string): Promise<void> {
  const out = await payWorkingOrderIntegrated(
    { ...deps(), provider: venue.card },
    venue.cfg,
    { id, lines: [] },
    venue.operatorId,
  );
  expect(out.outcome).toBe("captured");
}

/**
 * Pays a placed order on the card reader whose capture is recorded but whose reply is lost, then
 * presses Pay again, which files the captured payment without charging the card twice.
 */
async function collectByCardAfterLostReply(id: string): Promise<void> {
  venue.card.crashNextCollect("captured");
  await expect(
    payWorkingOrderIntegrated({ ...deps(), provider: venue.card }, venue.cfg, { id, lines: [] }),
  ).rejects.toThrow(/process stopped/);
  await collectByCard(id);
}

/** Records a credit note for the bill's whole issued invoice, so it owes nothing. */
async function creditWholeInvoice(billId: string): Promise<void> {
  const [issued] = venue.db.all<{ id: string }>(
    sql`select id from sales where working_order_id = ${billId}`,
  );
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "rectificative")),
      );
    const session = await loginWithPin(tx, {
      tillId: venue.cfg.tillId,
      personId: venue.adminId,
      pin: "1234",
    });
    await recordCorrection(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(issued!.id),
      total: "-18.00",
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [venue.cfg.locale]: "Descuento" },
          quantity: "-1",
          unitPrice: "14.88",
          vatRate: "21.00",
          lineTotal: "-14.88",
        },
      ],
      clock: venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

describe("paying a counter order that was handed over before payment", () => {
  it.each([
    ["ticket_then_pay", "cash", collectCash],
    ["ticket_then_pay", "card", collectByCard],
    ["invoice_first", "cash", collectCash],
    ["invoice_first", "card", collectByCard],
    ["ticket_then_pay", "card, its reply lost,", collectByCardAfterLostReply],
    ["invoice_first", "card, its reply lost,", collectByCardAfterLostReply],
  ] as const)(
    "a %s order paid by %s settles once, keeps its handover time and fires nothing again",
    async (mode, _method, pay) => {
      const id = await placed(mode, "Tarta");
      const tickets = ticketItemCount(id);
      expect(tickets).toBeGreaterThan(0);
      const salesBefore = saleCount(id);
      await markCollected({ db: venue.db }, venue.cfg, id);
      const handedOverAt = (await orderRow(id)).collectedAt;
      await tick();

      await pay(id);

      const after = await orderRow(id);
      expect(after.status).toBe("settled");
      expect(after.settledAt).not.toBe(handedOverAt);
      expect(after.collectedAt).toBe(handedOverAt);
      expect(saleCount(id)).toBe(1);
      expect(salesBefore).toBe(mode === "invoice_first" ? 1 : 0);
      expect(registroCount(venue, id)).toBe(1);
      expect(ticketItemCount(id)).toBe(tickets);
    },
  );

  it("an invoice_first order that owes nothing once corrected keeps its handover time", async () => {
    const id = await placed("invoice_first", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, id);
    const handedOverAt = (await orderRow(id)).collectedAt;
    await creditWholeInvoice(id);
    await tick();

    const ticket = await collectCash(id);

    expect(ticket.tender).toEqual({ method: "unpaid" });
    const after = await orderRow(id);
    expect(after.status).toBe("settled");
    expect(after.settledAt).not.toBe(handedOverAt);
    expect(after.collectedAt).toBe(handedOverAt);
  });

  it("a placed order paid without a handover is stamped handed over at payment, as before", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    await collectCash(id);
    const after = await orderRow(id);
    expect(after.status).toBe("settled");
    expect(after.collectedAt).toBe(after.settledAt);
  });
});

describe("payment and handover in either order end with the same facts", () => {
  async function facts(id: string) {
    const row = await orderRow(id);
    return {
      status: row.status,
      handedOver: row.collectedAt !== null,
      sales: saleCount(id),
      registros: registroCount(venue, id),
      tickets: ticketItemCount(id),
    };
  }

  it("pay then hand over (prepay), and hand over then pay (ticket_then_pay)", async () => {
    const paidFirst = randomUUID();
    await payWorkingOrder(
      deps(),
      venue.cfg,
      {
        id: paidFirst,
        zoneId: zones.prepay,
        lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
        tender: { method: "cash", amount: "50.00" },
      },
      venue.operatorId,
    );
    expect((await orderRow(paidFirst)).collectedAt).toBeNull();
    await markCollected({ db: venue.db }, venue.cfg, paidFirst);

    const handedOverFirst = await placed("ticket_then_pay", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, handedOverFirst);
    await collectCash(handedOverFirst);

    const expected = { status: "settled", handedOver: true, sales: 1, registros: 1, tickets: 1 };
    expect(await facts(paidFirst)).toEqual(expected);
    expect(await facts(handedOverFirst)).toEqual(expected);
  });
});
