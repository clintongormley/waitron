import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorZones, invoiceSeries, workingOrders } from "@waitron/db";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { ServiceMode } from "@waitron/module";
import { VENUE_SERVICE } from "./modules.js";
import { markCollected, parkOrder, placeOrder } from "./working-order.js";
import { inTx, provisionBillVenue, registroCount, send, tabWith } from "./testing/bill-venue.js";
import { runServiceCommand } from "./parties.js";
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

describe("POST /api/orders/:id/collect with a submission id (retry-safe)", () => {
  const handOverRoute = (id: string, body?: unknown) =>
    send(venue.app, venue.cookie, "POST", `/api/orders/${id}/collect`, body);

  it("answers a resent handover with the first result, not already_collected", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    const submissionId = randomUUID();

    const first = await handOverRoute(id, { submissionId });
    expect(first).toEqual({ status: 200, json: { body: "" } });
    const handedOverAt = (await orderRow(id)).collectedAt;
    expect(handedOverAt).not.toBeNull();

    const retry = await handOverRoute(id, { submissionId });
    expect(retry).toEqual({ status: 200, json: { body: "" } });
    expect((await orderRow(id)).collectedAt).toBe(handedOverAt);
  });

  it("refuses a new handover request on an order already handed over", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    expect((await handOverRoute(id, { submissionId: randomUUID() })).status).toBe(200);

    const again = await handOverRoute(id, { submissionId: randomUUID() });
    expect(again).toEqual({
      status: 409,
      json: { code: "working_order.already_collected", params: { workingOrderId: id } },
    });
  });

  it("records nothing for a refused handover, so the same id can be sent again once it can succeed", async () => {
    const id = await parked("prepay", "Tarta");
    const submissionId = randomUUID();
    const refused = await handOverRoute(id, { submissionId });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "working_order.not_settled" });

    await payWorkingOrder(
      deps(),
      venue.cfg,
      { id, lines: [], tender: { method: "cash", amount: "50.00" } },
      venue.operatorId,
    );
    expect((await handOverRoute(id, { submissionId })).status).toBe(200);
    expect((await orderRow(id)).collectedAt).not.toBeNull();
  });

  it("refuses the id when it was used for another command on the same bill (submission.id_reused)", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    const submissionId = randomUUID();
    await inTx(venue, (tx) =>
      runServiceCommand(
        tx,
        { kind: "bill", workingOrderId: id },
        submissionId,
        "adjustment.apply",
        { orderId: id },
        () => Promise.resolve({}),
      ),
    );

    const reused = await handOverRoute(id, { submissionId });
    expect(reused).toEqual({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId } },
    });
    expect((await orderRow(id)).collectedAt).toBeNull();
  });

  it("treats the same id on another order as that order's own request", async () => {
    const first = await placed("ticket_then_pay", "Tarta");
    const second = await placed("ticket_then_pay", "Tarta");
    const submissionId = randomUUID();
    expect((await handOverRoute(first, { submissionId })).status).toBe(200);
    expect((await handOverRoute(second, { submissionId })).status).toBe(200);
    expect((await orderRow(second)).collectedAt).not.toBeNull();
  });

  it.each([
    ["empty", ""],
    ["too long", "x".repeat(201)],
    ["not a string", 7],
    ["null", null],
  ])("refuses a submission id that is %s, and hands nothing over", async (_case, submissionId) => {
    const id = await placed("ticket_then_pay", "Tarta");
    const refused = await handOverRoute(id, { submissionId });
    expect(refused).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "submissionId" } },
    });
    expect((await orderRow(id)).collectedAt).toBeNull();
  });

  it("reads a body that is not an object as one with no submission id", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    expect((await handOverRoute(id, 7)).status).toBe(200);
    expect((await orderRow(id)).collectedAt).not.toBeNull();
  });

  it("without a submission id, behaves as before: a second request is already_collected", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    expect((await handOverRoute(id, {})).status).toBe(200);
    expect((await handOverRoute(id)).status).toBe(409);
  });
});

describe("GET /api/orders/counter-waiting", () => {
  interface WaitingRow {
    id: string;
    orderNumber: number;
    label: string | null;
    status: string;
    openedAt: string;
    settledAt: string | null;
    collectedAt: string | null;
    total: string;
    canHandOver: boolean;
    serviceMode: string | null;
  }

  async function waiting(): Promise<WaitingRow[]> {
    const answer = await send(venue.app, venue.cookie, "GET", "/api/orders/counter-waiting");
    expect(answer.status).toBe(200);
    return answer.json as unknown as WaitingRow[];
  }

  async function paidPrepay(): Promise<string> {
    const id = randomUUID();
    await payWorkingOrder(
      deps(),
      venue.cfg,
      {
        id,
        zoneId: zones.prepay,
        lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
        tender: { method: "cash", amount: "50.00" },
      },
      venue.operatorId,
    );
    return id;
  }

  it("lists sent-not-paid, handed-over-not-paid and paid-not-handed-over counter orders, with what can be handed over now", async () => {
    const sent = await placed("ticket_then_pay", "Tarta");
    const handedOver = await placed("invoice_first", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, handedOver);
    const sentPrepay = await placed("prepay", "Tarta");
    const sentNothingToCook = await placed("ticket_then_pay", "Caña");
    const paid = await paidPrepay();

    const rows = await waiting();
    const row = (id: string) => rows.find((r) => r.id === id);

    expect(row(sent)).toEqual({
      id: sent,
      orderNumber: (await orderRow(sent)).orderNumber,
      label: null,
      status: "placed",
      openedAt: (await orderRow(sent)).openedAt,
      settledAt: null,
      collectedAt: null,
      total: "18.00",
      canHandOver: true,
      serviceMode: "ticket_then_pay",
    });
    expect(row(handedOver)).toMatchObject({
      status: "placed",
      collectedAt: (await orderRow(handedOver)).collectedAt,
      canHandOver: false,
      serviceMode: "invoice_first",
    });
    expect(row(handedOver)!.collectedAt).not.toBeNull();
    expect(row(sentPrepay)).toMatchObject({
      status: "placed",
      canHandOver: false,
      serviceMode: "prepay",
    });
    expect(row(sentNothingToCook)).toMatchObject({ status: "placed", canHandOver: false });
    expect(row(paid)).toMatchObject({
      status: "settled",
      settledAt: (await orderRow(paid)).settledAt,
      collectedAt: null,
      canHandOver: true,
      serviceMode: null,
    });
  });

  it("totals a placed order by the sale already issued for it (here the invoice issued at placing), net of its credit notes, which is what collecting it charges", async () => {
    const credited = await placed("invoice_first", "Tarta");
    await creditWholeInvoice(credited);
    const uncredited = await placed("invoice_first", "Tarta");

    const rows = await waiting();

    expect(rows.find((r) => r.id === credited)!.total).toBe("0.00");
    expect(rows.find((r) => r.id === uncredited)!.total).toBe("18.00");
    expect((await collectCash(credited)).tender).toEqual({ method: "unpaid" });
  });

  it("leaves out a handed-over paid order, an open order, a table bill, an abandoned order and a paid order with nothing fired", async () => {
    const collected = await paidPrepay();
    await markCollected({ db: venue.db }, venue.cfg, collected);
    const open = await parked("ticket_then_pay", "Tarta");
    const tableBill = await tabWith(venue, "Paella");
    await placeOrder(deps(), venue.cfg, tableBill, venue.operatorId, venue.cfg.tillId);
    const abandoned = await parked("ticket_then_pay", "Tarta");
    venue.db.run(sql`update working_orders set status = 'abandoned' where id = ${abandoned}`);
    const paidUnfired = randomUUID();
    await payWorkingOrder(
      deps(),
      venue.cfg,
      {
        id: paidUnfired,
        zoneId: zones.ticket_then_pay,
        lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
        tender: { method: "cash", amount: "50.00" },
      },
      venue.operatorId,
    );
    expect(ticketItemCount(paidUnfired)).toBe(0);

    const ids = (await waiting()).map((r) => r.id);
    for (const id of [collected, open, tableBill, abandoned, paidUnfired]) {
      expect(ids).not.toContain(id);
    }
  });

  it("drops a placed order once it is handed over and paid", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, id);
    expect((await waiting()).map((r) => r.id)).toContain(id);
    await collectCash(id);
    expect((await waiting()).map((r) => r.id)).not.toContain(id);
  });

  it("lists the oldest first", async () => {
    const older = await placed("ticket_then_pay", "Tarta");
    await tick();
    const newer = await paidPrepay();
    const ids = (await waiting()).map((r) => r.id);
    expect(ids.indexOf(older)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
    const opened = (await waiting()).map((r) => r.openedAt);
    expect(opened).toEqual([...opened].sort());
  });

  it("reads the service modes once, however many placed orders it lists", async () => {
    await placed("ticket_then_pay", "Tarta");
    await placed("invoice_first", "Tarta");
    const batch = vi.spyOn(VENUE_SERVICE, "findOrderModes");
    const single = vi.spyOn(VENUE_SERVICE, "findOrderContext");
    try {
      const rows = await waiting();
      expect(rows.filter((r) => r.status === "placed" && r.canHandOver).length).toBeGreaterThan(1);
      expect(batch).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
    } finally {
      batch.mockRestore();
      single.mockRestore();
    }
  });

  it("requires a signed-in session", async () => {
    const answer = await send(venue.app, "", "GET", "/api/orders/counter-waiting");
    expect(answer.status).toBe(401);
  });
});

describe("GET /api/working-orders/:id/placed", () => {
  const read = (id: string, cookie = venue.cookie) =>
    send(venue.app, cookie, "GET", `/api/working-orders/${id}/placed`);

  it("answers a counter order sent without payment as the open-order read answered it before it was sent", async () => {
    const id = await parked("ticket_then_pay", "Tarta", "Caña");
    const open = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
    expect(open.status).toBe(200);
    await placeOrder(deps(), venue.cfg, id, venue.operatorId, venue.cfg.tillId);

    const answer = await read(id);

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ ...open.json, revision: (await orderRow(id)).revision });
    expect((answer.json.lines as unknown[]).length).toBe(2);
  });

  it("answers one that was handed over before it was paid", async () => {
    const id = await placed("invoice_first", "Tarta");
    await markCollected({ db: venue.db }, venue.cfg, id);
    expect((await read(id)).status).toBe(200);
  });

  it("refuses an open, a paid, a table's and an unknown order alike (working_order.not_found)", async () => {
    const open = await parked("ticket_then_pay", "Tarta");
    const paid = await placed("ticket_then_pay", "Tarta");
    await collectCash(paid);
    const tableBill = await tabWith(venue, "Paella");
    await placeOrder(deps(), venue.cfg, tableBill, venue.operatorId, venue.cfg.tillId);

    for (const id of [open, paid, tableBill, randomUUID(), "not-a-uuid"]) {
      const answer = await read(id);
      expect(answer.status).toBe(404);
      expect(answer.json.code).toBe("working_order.not_found");
    }
  });

  it("requires a signed-in session", async () => {
    const id = await placed("ticket_then_pay", "Tarta");
    expect((await read(id, "")).status).toBe(401);
  });
});
