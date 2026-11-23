import { seedZone } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState, noteFullAtStart, type DiskFullState } from "./disk-full-state.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let free: ZoneOffers;
let freeId = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const cat = await createMenu(tx, { name: "Free menu" });
      const category = await createCategory(tx, { name: "Free" });
      const water = await createProduct(tx, {
        categoryId: category.id,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      freeId = water.id;
      await assignMenuToVenue(tx, cat.id);
      const [zone] = [await seedZone(tx, { name: "Free counter" })];
      free = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
        productIds: [freeId],
      });
    });
  },
});

const quiet = () => {};
const REFUSED = { status: 507, json: { code: "storage.disk_full", params: {} } };

function diskState(room: { bytes: number } = { bytes: 0 }): DiskFullState {
  return createDiskFullState({
    dir: "/unused",
    now: () => new Date(),
    log: quiet,
    statfs: () => Promise.resolve({ bavail: room.bytes, frsize: 1 }),
  });
}

function notedState(room: { bytes: number } = { bytes: 0 }): DiskFullState {
  const disk = diskState(room);
  disk.noteRefused();
  return disk;
}

const refusal = (answer: { status: number; json: Record<string, unknown> }) => ({
  status: answer.status,
  json: answer.json,
});

function count(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)} where ${where}`,
  );
  return row!.n;
}

function nextNumbers(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select coalesce(sum((select coalesce(max(sales.invoice_number), 0) + 1 from sales where sales.series_id = invoice_series.id)), 0) as n from invoice_series`,
  );
  return row!.n;
}

function statusOfOrder(id: string): string | undefined {
  const [row] = venue.db.all<{ status: string }>(
    sql`select status from working_orders where id = ${id}`,
  );
  return row?.status;
}

function sale(app: Hono, id: string, method: "cash" | "card" = "cash") {
  return send(app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: id,
    dining: "eat_in",
    kind: "share",
    shareOf: 1,
    method,
    ...(method === "cash" ? { tendered: "3.00" } : { entry: "manual" }),
    basket: {
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    },
  });
}

function collect(app: Hono, id: string) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: id,
    kind: "share",
    shareOf: 1,
    method: "cash",
    tendered: "12.00",
    applied: "12.00",
    tip: "0.00",
  });
}

function invoiceNumber(answer: Awaited<ReturnType<typeof send>>) {
  return (answer.json.invoice as { invoiceNumber: string }).invoiceNumber;
}

async function placedOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    zoneId: venue.zoneId,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    operatorId: venue.operatorId,
  });
  await placeOrder({ ...deps, admission: testTradingAdmission() }, venue.cfg, id, venue.operatorId);
  return id;
}

/** Records a corrective for the bill's whole issued invoice of one Tarta, so it owes nothing. */
async function creditWholeInvoice(billId: string): Promise<void> {
  const [issued] = venue.db.all<{ id: string }>(
    sql`select id from sales where working_order_id = ${billId}`,
  );
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "corrective")),
      );
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    await recordCorrection(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(issued!.id),
      total: "-18.00",
      lines: [
        {
          lineNo: 1,
          name: "Discount",
          descriptions: { [venue.cfg.locale]: "Discount" },
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

function contribution(billId: string, method: "cash" | "card", submissionId = randomUUID()) {
  return (app: Hono) =>
    send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      kind: "contribution",
      amount: "5.00",
      method,
      ...(method === "cash" ? { tendered: "5.00" } : { entry: "manual" }),
      applied: "5.00",
      tip: "0.00",
      submissionId,
    });
}

describe("the sale routes while the full-disk stop holds", () => {
  it("refuses a cash sale while the stop holds, and keeps nothing", async () => {
    const id = randomUUID();
    const sales = count("sales");
    const numbers = nextNumbers();

    const refused = await sale(venue.appWith({ disk: notedState() }), id);

    expect(refusal(refused)).toEqual(REFUSED);
    expect(statusOfOrder(id)).toBeUndefined();
    expect(count("sales")).toBe(sales);
    expect(nextNumbers()).toBe(numbers);

    const sold = await sale(venue.appWith({ disk: diskState() }), randomUUID());
    expect(sold.status).toBe(200);
    expect(count("sales")).toBe(sales + 1);
    expect(nextNumbers()).toBe(numbers + 1);
  });

  it("refuses a manual card sale", async () => {
    const id = randomUUID();

    const refused = await sale(venue.appWith({ disk: notedState() }), id, "card");

    expect(refusal(refused)).toEqual(REFUSED);
    expect(statusOfOrder(id)).toBeUndefined();
    expect(count("payments", sql`working_order_id = ${id}`)).toBe(0);
  });

  it("answers a resend of a cash sale already recorded", async () => {
    const id = randomUUID();
    const first = await sale(venue.appWith({ disk: diskState() }), id);
    expect(first.status).toBe(200);
    const sales = count("sales");

    const resent = await sale(venue.appWith({ disk: notedState() }), id);

    expect(resent.status).toBe(200);
    expect(invoiceNumber(resent)).toBe(invoiceNumber(first));
    expect(count("sales")).toBe(sales);
  });

  it("refuses to collect a placed order, and answers a collect already made", async () => {
    const id = await placedOrder("House salad");

    const refused = await collect(venue.appWith({ disk: notedState() }), id);
    expect(refusal(refused)).toEqual(REFUSED);
    expect(statusOfOrder(id)).toBe("placed");

    const collected = await collect(venue.appWith({ disk: diskState() }), id);
    expect(collected.status).toBe(200);
    const sales = count("sales");

    const resent = await collect(venue.appWith({ disk: notedState() }), id);
    expect(resent.status).toBe(200);
    expect(invoiceNumber(resent)).toBe(invoiceNumber(collected));
    expect(count("sales")).toBe(sales);
  });

  it("refuses a bill's cash and manual card payments, and answers one already taken", async () => {
    const billId = await tabWith(venue, "Paella");
    const noted = venue.appWith({ disk: notedState() });

    expect(refusal(await contribution(billId, "cash")(noted))).toEqual(REFUSED);
    expect(refusal(await contribution(billId, "card")(noted))).toEqual(REFUSED);
    expect(count("bill_payments", sql`working_order_id = ${billId}`)).toBe(0);

    const taken = contribution(billId, "cash");
    const first = await taken(venue.appWith({ disk: diskState() }));
    expect(first.status).toBe(200);

    const resent = await taken(venue.appWith({ disk: notedState() }));
    expect(resent.status).toBe(200);
    expect((resent.json.payment as { id: string }).id).toBe(
      (first.json.payment as { id: string }).id,
    );
    expect(count("bill_payments", sql`working_order_id = ${billId}`)).toBe(1);
  });

  it("refuses a card sale that owes nothing", async () => {
    const id = randomUUID();
    const before = venue.card.collectCalls.length;

    const payByReader = (app: Hono, billId: string) =>
      send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
        submissionId: billId,
        dining: "eat_in",
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        basket: {
          zoneId: free.zoneId,
          lines: [{ menuItemId: free.offerFor(freeId), quantity: "1" }],
        },
      });
    const refused = await payByReader(venue.appWith({ disk: notedState() }), id);

    expect(refusal(refused)).toEqual(REFUSED);
    expect(venue.card.collectCalls.length).toBe(before);
    expect(statusOfOrder(id)).toBeUndefined();

    const control = await payByReader(venue.appWith({ disk: diskState() }), randomUUID());
    expect(control.status).toBe(200);
    expect(venue.card.collectCalls.length).toBe(before);
  });

  it("refuses settling an issued order that owes nothing", async () => {
    const settle = async (disk: DiskFullState) => {
      const id = await placedOrder("Tarta");
      await issueOrderInvoice(
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        id,
        venue.operatorId,
      );
      await creditWholeInvoice(id);
      const answer = await send(
        venue.appWith({ disk }),
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/payments`,
        {
          submissionId: id,
          kind: "contribution",
          amount: "0.00",
          method: "card",
          entry: "reader",
          applied: "0.00",
          tip: "0.00",
        },
      );
      return { id, answer };
    };

    const refused = await settle(notedState());
    expect(refusal(refused.answer)).toEqual(REFUSED);
    expect(statusOfOrder(refused.id)).toBe("placed");

    const control = await settle(diskState());
    expect(control.answer.status).toBe(200);
    expect(statusOfOrder(control.id)).toBe("settled");
  });

  describe("a refusal noted while the sale waits for the write queue", () => {
    /**
     * Wraps a real state holding a refusal its free space has outgrown, so the sale's pre-read
     * forgets it; its `full()` queues a write body, ahead of the sale's, that runs `queued`.
     */
    function queuingState(queued: (state: DiskFullState) => void) {
      const state = diskState({ bytes: FULL_DISK_BYTES });
      state.noteRefused();
      let pending: Promise<void> = Promise.resolve();
      const disk: DiskFullState = {
        noteRefused: () => state.noteRefused(),
        noted: () => state.noted(),
        since: () => state.since(),
        async full() {
          const answer = await state.full();
          pending = withTransaction(venue.db, () => {
            queued(state);
            return Promise.resolve();
          });
          return answer;
        },
      };
      return { disk, queuedBody: () => pending };
    }

    it("refuses a cash sale noted while it waits for the write queue", async () => {
      const { disk, queuedBody } = queuingState((state) => state.noteRefused());
      const id = randomUUID();

      const answer = await sale(venue.appWith({ disk }), id);
      await queuedBody();

      expect(refusal(answer)).toEqual(REFUSED);
      expect(statusOfOrder(id)).toBeUndefined();
    });

    it("sells when the queued write notes nothing", async () => {
      const { disk, queuedBody } = queuingState(() => {});

      const answer = await sale(venue.appWith({ disk }), randomUUID());
      await queuedBody();

      expect(answer.status).toBe(200);
    });
  });

  it("sells again once the folder has 16 MiB free", async () => {
    const disk = notedState({ bytes: FULL_DISK_BYTES });

    const answer = await sale(venue.appWith({ disk }), randomUUID());

    expect(answer.status).toBe(200);
    expect(disk.noted()).toBe(false);
  });

  it("refuses a cash sale with 1 GiB free while the spare's marker exists, and sells once it is gone", async () => {
    const marker = { present: true };
    const spareReleased = async () => marker.present;
    const statfs = () => Promise.resolve({ bavail: 1024 ** 3, frsize: 1 });
    const disk = createDiskFullState({
      dir: "/unused",
      now: () => new Date(),
      log: quiet,
      statfs,
      spareReleased,
    });
    await noteFullAtStart(disk, { dir: "/unused", log: quiet, statfs, spareReleased });
    const id = randomUUID();

    expect(refusal(await sale(venue.appWith({ disk }), id))).toEqual(REFUSED);
    expect(statusOfOrder(id)).toBeUndefined();

    marker.present = false;
    expect((await sale(venue.appWith({ disk }), id)).status).toBe(200);
    expect(statusOfOrder(id)).toBeDefined();
  });

  it("collects a placed order again once the folder has 16 MiB free", async () => {
    const disk = notedState({ bytes: FULL_DISK_BYTES });
    const id = await placedOrder("House salad");

    const answer = await collect(venue.appWith({ disk }), id);

    expect(answer.status).toBe(200);
    expect(disk.noted()).toBe(false);
  });

  it("takes a bill's cash payment again once the folder has 16 MiB free", async () => {
    const disk = notedState({ bytes: FULL_DISK_BYTES });
    const billId = await tabWith(venue, "Paella");

    const answer = await contribution(billId, "cash")(venue.appWith({ disk }));

    expect(answer.status).toBe(200);
    expect(disk.noted()).toBe(false);
  });
});
