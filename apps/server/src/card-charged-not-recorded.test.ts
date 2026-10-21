import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { insertCapturedPayment } from "@waitron/payments";
import { AppError, decimal } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import type { Logger } from "./logger.js";
import "./errors.js";

const settleFault = vi.hoisted(() => ({ armed: false }));

// `finalizeSettle` calls core's `settleSale`, which takes no backend, so a backend spy cannot reach it.
vi.mock("@waitron/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/core")>();
  return {
    ...real,
    settleSale: (...args: Parameters<typeof real.settleSale>) => {
      if (settleFault.armed) {
        settleFault.armed = false;
        return Promise.reject(new AppError("storage.disk_full", {}));
      }
      return real.settleSale(...args);
    },
  };
});

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const dish = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      dishId = dish.id;
      await assignCatalogueToLocation(tx, venue.cfg.locationId, cat.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId] });
    });
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  settleFault.armed = false;
});

const lines = (n = 1) =>
  Array.from({ length: n }, () => ({ menuItemId: counter.offerFor(dishId), quantity: "1" }));
const collects = () => venue.card.collectCalls.length;
const diskFull = () => new AppError("storage.disk_full", {});

function capturingLog() {
  const entries: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const log: Logger = (level, event, fields) => {
    entries.push({ level, event, fields: fields ?? {} });
  };
  // The error boundary also logs every refusal it answers, at `warn`; this reads the helper's line.
  return {
    log,
    charged: () =>
      entries.filter((e) => e.event === "sale.charged_not_recorded" && e.level === "error"),
  };
}

function walkUpPay(id: string, log?: Logger, lineCount = 1) {
  return send(venue.appWith(log === undefined ? {} : { log }), venue.cookie, "POST", "/api/pay", {
    id,
    lines: lines(lineCount),
    zoneId: counter.zoneId,
  });
}

function payAgain(id: string, log?: Logger) {
  return send(venue.appWith(log === undefined ? {} : { log }), venue.cookie, "POST", "/api/pay", {
    id,
    lines: [],
    zoneId: counter.zoneId,
  });
}

function count(table: string, column: string, id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`,
  );
  return row!.n;
}

function capturedPayments(id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from payments where working_order_id = ${id} and state = 'captured'`,
  );
  return row!.n;
}

function capturedUnlinked(id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from payments
        where working_order_id = ${id} and state = 'captured' and sale_id is null`,
  );
  return row!.n;
}

async function placedIssuedOrder(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: lines(),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  await placeOrder(deps, venue.cfg, id, venue.operatorId);
  return id;
}

function strandCapturedPayment(id: string) {
  return withTransaction(venue.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: id,
      provider: "fake",
      paymentRef: `fake-${randomUUID()}`,
      amount: decimal("10.00"),
      settledAt: new Date(),
    }),
  );
}

/**
 * Inside the next card collect, arms the next write transaction to fail for a full disk after its
 * body has run, where `withTransaction`'s own drain and the commit run: a fault no wrap inside the
 * body can see.
 */
function fullDiskAfterNextBody() {
  const collect = venue.card.collect.bind(venue.card);
  vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
    const result = await collect(params);
    const real = venue.db.withWriteLock.bind(venue.db);
    vi.spyOn(venue.db, "withWriteLock").mockImplementationOnce(<T>(body: () => Promise<T>) =>
      real(async () => {
        await body();
        throw new AppError("storage.disk_full", {});
      }),
    );
    return result;
  });
}

const chargedNotRecorded = (workingOrderId: string) => ({
  code: "sale.charged_not_recorded",
  params: { workingOrderId, reason: "disk_full" },
});

describe("POST /api/pay when the sale fails for a full disk after the card was charged", () => {
  it("says a card was charged when its sale then fails for a full disk", async () => {
    const { log, charged } = capturingLog();
    const spy = vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(diskFull());
    const id = randomUUID();
    const before = collects();

    const answer = await walkUpPay(id, log);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(id));
    expect(collects()).toBe(before + 1);
    expect(capturedPayments(id)).toBe(1);
    expect(count("sales", "working_order_id", id)).toBe(0);
    expect(charged()).toEqual([
      { level: "error", event: "sale.charged_not_recorded", fields: { workingOrderId: id } },
    ]);

    spy.mockRestore();
    const again = await payAgain(id);

    expect(again.status).toBe(200);
    expect(again.json.outcome).toBe("captured");
    expect(collects()).toBe(before + 1);
    expect(count("sales", "working_order_id", id)).toBe(1);
    expect(registroCount(venue, id)).toBe(1);
  });

  it("says so when a placed order's settlement fails after the charge", async () => {
    const { log, charged } = capturingLog();
    const id = await placedIssuedOrder();
    settleFault.armed = true;
    const before = collects();

    const answer = await payAgain(id, log);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(id));
    expect(collects()).toBe(before + 1);
    expect(capturedUnlinked(id)).toBe(1);
    expect(charged()).toEqual([
      { level: "error", event: "sale.charged_not_recorded", fields: { workingOrderId: id } },
    ]);
  });

  it("says so when Pay again settles a charged card for a placed order on a still-full disk", async () => {
    const id = await placedIssuedOrder();
    await strandCapturedPayment(id);
    settleFault.armed = true;
    const before = collects();

    const answer = await payAgain(id);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(id));
    expect(collects()).toBe(before);
    expect(capturedUnlinked(id)).toBe(1);
  });

  it("says so when Pay again recovers a charged card on a still-full disk", async () => {
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, { id, lines: lines(), zoneId: counter.zoneId });
    await strandCapturedPayment(id);
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(diskFull());
    const before = collects();

    const answer = await payAgain(id);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(id));
    expect(collects()).toBe(before);
  });

  it("passes any other failure after the charge through unchanged", async () => {
    const { log, charged } = capturingLog();
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new Error("boom"));

    const answer = await walkUpPay(randomUUID(), log);

    expect(answer.status).toBe(500);
    expect(answer.json.code).toBe("server.internal");
    expect(charged()).toEqual([]);
  });
});

/** Lets the next card collect run, then fills the database to a page limit, as a full disk does. */
function fillAfterCollect(): { lift: () => void } {
  const collect = venue.card.collect.bind(venue.card);
  vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
    const result = await collect(params);
    venue.db.run(sql`create table if not exists ballast (id integer primary key, pad blob)`);
    const [{ page_count: pages }] = venue.db.all<{ page_count: number }>(
      sql`pragma page_count`,
    ) as [{ page_count: number }];
    venue.db.all(sql.raw(`pragma max_page_count = ${pages + 2}`));
    for (;;) {
      try {
        venue.db.run(sql`insert into ballast (pad) values (zeroblob(16))`);
      } catch {
        break;
      }
    }
    return result;
  });
  return { lift: () => venue.db.all(sql.raw(`pragma max_page_count = 4294967294`)) };
}

describe("a real full database after the charge", () => {
  it("says a card was charged when the database is full when its sale is recorded", async () => {
    const id = randomUUID();
    const before = collects();
    const disk = fillAfterCollect();
    try {
      // Twenty lines, so the sale needs pages the limit no longer allows.
      const answer = await walkUpPay(id, undefined, 20);

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual(chargedNotRecorded(id));
      expect(collects()).toBe(before + 1);
      expect(count("sales", "working_order_id", id)).toBe(0);
    } finally {
      disk.lift();
    }
  });

  it("says so when a full disk fails a sale's transaction after its body has run", async () => {
    const id = randomUUID();
    const before = collects();
    fullDiskAfterNextBody();

    const answer = await walkUpPay(id);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(id));
    expect(collects()).toBe(before + 1);
    expect(count("sales", "working_order_id", id)).toBe(0);
  });

  it("says so when a full disk fails a bill payment's transaction after its body has run", async () => {
    const billId = await tabWith(venue, "Paella");
    const before = collects();
    fullDiskAfterNextBody();

    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "35.00",
        method: "card",
        entry: "reader",
        applied: "35.00",
        tip: "0.00",
      },
    );

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(billId));
    expect(collects()).toBe(before + 1);
    expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["pending"]);
  });

  it("says so on a bill's reader payment when the database is full when it completes the bill", async () => {
    const billId = await tabWith(venue, ...Array.from({ length: 20 }, () => "Paella"));
    const before = collects();
    const disk = fillAfterCollect();
    try {
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "700.00",
          method: "card",
          entry: "reader",
          applied: "700.00",
          tip: "0.00",
        },
      );

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual(chargedNotRecorded(billId));
      expect(collects()).toBe(before + 1);
      expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["pending"]);
    } finally {
      disk.lift();
    }
  });
});

describe("a bill's reader payment when the bill's sale fails for a full disk after the charge", () => {
  const wholeBill = () => ({
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "35.00",
    method: "card",
    entry: "reader",
    applied: "35.00",
    tip: "0.00",
  });

  function pay(billId: string, log?: Logger) {
    return send(
      venue.appWith(log === undefined ? {} : { log }),
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      wholeBill(),
    );
  }

  it("says so on a bill's reader payment that would complete the bill", async () => {
    const { log, charged } = capturingLog();
    const billId = await tabWith(venue, "Paella");
    const spy = vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(diskFull());
    const before = collects();

    const answer = await pay(billId, log);

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual(chargedNotRecorded(billId));
    expect(collects()).toBe(before + 1);
    expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["pending"]);
    expect(charged()).toEqual([
      {
        level: "error",
        event: "sale.charged_not_recorded",
        fields: { workingOrderId: billId },
      },
    ]);

    spy.mockRestore();
    await settlePendingBillPayments({
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });

    expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["received"]);
    expect(registroCount(venue, billId)).toBe(1);
    expect(collects()).toBe(before + 1);
  });

  it("passes any other failure on a bill's reader payment through unchanged", async () => {
    const billId = await tabWith(venue, "Paella");
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new Error("boom"));

    const answer = await pay(billId);

    expect(answer.status).toBe(500);
    expect(answer.json.code).toBe("server.internal");
  });
});
