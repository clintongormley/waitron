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
import type { CollectParams, PaymentProvider } from "@waitron/payments";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { AppError, decimal } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { createDiskFullState, watchForDiskFull } from "./disk-full-state.js";
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

/** A real provider over its fake processor, and what the processor says of every charge begun. */
interface RealProvider {
  provider: PaymentProvider;
  /** The processor's own status of each charge this provider began, in order. */
  charges: () => Promise<string[]>;
}

const noWait = { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() };

function realSumUp(): RealProvider {
  const client = new FakeSumUp();
  const begun: string[] = [];
  const create = client.createCheckout.bind(client);
  vi.spyOn(client, "createCheckout").mockImplementation((params) => {
    begun.push(params.foreignTransactionId);
    return create(params);
  });
  return {
    provider: new SumUpCloudProvider({
      db: venue.db,
      client,
      incidents: () => Promise.resolve(true),
      poll: noWait,
    }),
    charges: async () =>
      Promise.all(
        begun.map(
          async (foreignTransactionId) =>
            (await client.findTransaction({ foreignTransactionId }))?.status ?? "none",
        ),
      ),
  };
}

function realStripe(): RealProvider {
  const client = new FakeStripe();
  const begun: string[] = [];
  const create = client.createPaymentIntent.bind(client);
  vi.spyOn(client, "createPaymentIntent").mockImplementation(async (params) => {
    const intent = await create(params);
    begun.push(intent.id);
    return intent;
  });
  return {
    provider: new StripeTerminalProvider({ db: venue.db, client, poll: noWait }),
    charges: async () =>
      Promise.all(begun.map(async (id) => (await client.retrievePaymentIntent(id)).status)),
  };
}

const REAL_PROVIDERS = [
  { name: "SumUp", make: realSumUp, charged: "SUCCESSFUL" },
  { name: "Stripe", make: realStripe, charged: "succeeded" },
] as const;

/**
 * Makes the one `payments` write `when` matches fail for a real full disk: a trigger makes that
 * write need far more pages than the page limit leaves, while every smaller write still fits.
 */
function fullDiskOn(when: "insert attempting" | "save capture"): { lift: () => void } {
  const clause =
    when === "insert attempting"
      ? "before insert on payments when new.state = 'attempting'"
      : "before update on payments when old.state = 'attempting' and new.state = 'captured'";
  venue.db.run(sql.raw("create table if not exists full_disk_pad (body blob)"));
  venue.db.run(
    sql.raw(
      `create trigger full_disk_on_payments ${clause} begin insert into full_disk_pad values (zeroblob(16777216)); end`,
    ),
  );
  const [{ page_count: pages }] = venue.db.all<{ page_count: number }>(sql`pragma page_count`) as [
    { page_count: number },
  ];
  venue.db.all(sql.raw(`pragma max_page_count = ${pages + 128}`));
  return {
    lift: () => {
      venue.db.all(sql.raw("pragma max_page_count = 4294967294"));
      venue.db.run(sql.raw("drop trigger full_disk_on_payments"));
    },
  };
}

function providerRows(workingOrderId: string) {
  return venue.db.all<{ provider: string; state: string; saleId: string | null }>(
    sql`select provider, state, sale_id as saleId from payments
        where working_order_id = ${workingOrderId}`,
  );
}

describe.each(REAL_PROVIDERS)(
  "$name: a full disk while saving a charge the processor made",
  ({ make, charged }) => {
    /** The till's two card routes, through the real provider and a store-watching stop. */
    function tillWith(real: RealProvider) {
      // The venue's reader is the test provider's, which has no vendor reference to pass on.
      const routed: PaymentProvider = Object.assign(
        Object.create(real.provider) as PaymentProvider,
        {
          collect: (params: CollectParams) =>
            real.provider.collect({ ...params, readerRef: "rdr_1" }),
        },
      );
      vi.spyOn(venue.pool, "get").mockResolvedValue(routed);
      const disk = createDiskFullState({
        dir: "/unused",
        now: () => new Date(),
        log: () => {},
        statfs: () => Promise.resolve({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
      });
      const unwatch = watchForDiskFull(disk, [venue.db]);
      const { log, charged: chargedLines } = capturingLog();
      const app = venue.appWith({ disk, log });
      return {
        disk,
        unwatch,
        chargedLines,
        walkUp: (id: string) =>
          send(app, venue.cookie, "POST", "/api/pay", {
            id,
            lines: lines(),
            zoneId: counter.zoneId,
          }),
        payAgain: (id: string) =>
          send(app, venue.cookie, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId }),
        payBill: (billId: string) =>
          send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
            submissionId: randomUUID(),
            kind: "contribution",
            amount: "35.00",
            method: "card",
            entry: "reader",
            applied: "35.00",
            tip: "0.00",
          }),
      };
    }

    it("says the card was charged on POST /api/pay, and files it later without charging again", async () => {
      const real = make();
      const till = tillWith(real);
      const id = randomUUID();
      const disk = fullDiskOn("save capture");
      let answer;
      try {
        answer = await till.walkUp(id);
      } finally {
        disk.lift();
        till.unwatch();
      }

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual(chargedNotRecorded(id));
      expect(await real.charges()).toEqual([charged]);
      expect(till.disk.noted()).toBe(true);
      expect(providerRows(id)).toEqual([
        { provider: real.provider.provider, state: "attempting", saleId: null },
      ]);
      expect(till.chargedLines()).toEqual([
        { level: "error", event: "sale.charged_not_recorded", fields: { workingOrderId: id } },
      ]);

      await real.provider.resolvePending(new Date());
      const again = await till.payAgain(id);

      expect(again.status).toBe(200);
      expect(again.json.outcome).toBe("captured");
      expect(await real.charges()).toEqual([charged]);
      expect(registroCount(venue, id)).toBe(1);
    });

    it("says the card was charged on a bill's reader payment, and the pending pass completes it", async () => {
      const real = make();
      const till = tillWith(real);
      const billId = await tabWith(venue, "Paella");
      const disk = fullDiskOn("save capture");
      let answer;
      try {
        answer = await till.payBill(billId);
      } finally {
        disk.lift();
        till.unwatch();
      }

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual(chargedNotRecorded(billId));
      expect(await real.charges()).toEqual([charged]);
      expect(till.disk.noted()).toBe(true);
      expect(providerRows(billId)).toEqual([
        { provider: real.provider.provider, state: "attempting", saleId: null },
      ]);
      expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["pending"]);

      await real.provider.resolvePending(new Date());
      await settlePendingBillPayments({
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
      });

      expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["received"]);
      expect(await real.charges()).toEqual([charged]);
      expect(registroCount(venue, billId)).toBe(1);
    });

    it("still says the sale is not recorded when the attempt cannot be saved, before any charge", async () => {
      const real = make();
      const till = tillWith(real);
      const id = randomUUID();
      const disk = fullDiskOn("insert attempting");
      let answer;
      try {
        answer = await till.walkUp(id);
      } finally {
        disk.lift();
        till.unwatch();
      }

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual({ code: "storage.disk_full", params: {} });
      expect(await real.charges()).toEqual([]);
      expect(till.disk.noted()).toBe(true);
      expect(providerRows(id)).toEqual([]);
      expect(till.chargedLines()).toEqual([]);
    });

    it("still says the bill's payment is not recorded when the attempt cannot be saved, before any charge", async () => {
      const real = make();
      const till = tillWith(real);
      const billId = await tabWith(venue, "Paella");
      const disk = fullDiskOn("insert attempting");
      let answer;
      try {
        answer = await till.payBill(billId);
      } finally {
        disk.lift();
        till.unwatch();
      }

      expect(answer.status).toBe(507);
      expect(answer.json).toEqual({ code: "storage.disk_full", params: {} });
      expect(await real.charges()).toEqual([]);
      expect(till.disk.noted()).toBe(true);
      expect(providerRows(billId)).toEqual([]);
      expect(till.chargedLines()).toEqual([]);
    });
  },
);
