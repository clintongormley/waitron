import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
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
import { decimal } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState, watchForDiskFull, type DiskFullState } from "./disk-full-state.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import type { Logger } from "./logger.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let freeId = "";

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
      // Task 12c's owes-nothing case reuses this offer.
      const free = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: category.id,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      dishId = dish.id;
      freeId = free.id;
      await assignCatalogueToLocation(tx, venue.cfg.locationId, cat.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId, freeId] });
    });
  },
});

const quiet = () => {};

function diskState(free: { bytes: number }): DiskFullState {
  return createDiskFullState({
    dir: "/unused",
    now: () => new Date(),
    log: quiet,
    statfs: () => Promise.resolve({ bavail: free.bytes, frsize: 1 }),
  });
}

const lines = (count: number) =>
  Array.from({ length: count }, () => ({ menuItemId: counter.offerFor(dishId), quantity: "1" }));

function walkUpPay(disk: DiskFullState, id = randomUUID()) {
  return send(venue.appWith({ disk }), venue.cookie, "POST", "/api/pay", {
    id,
    lines: lines(1),
    zoneId: counter.zoneId,
  });
}

function payAgain(disk: DiskFullState, id: string) {
  return send(venue.appWith({ disk }), venue.cookie, "POST", "/api/pay", {
    id,
    lines: [],
    zoneId: counter.zoneId,
  });
}

const collects = () => venue.card.collectCalls.length;

function count(table: string, column: string, id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`,
  );
  return row!.n;
}

function orderRow(id: string): { status: string; attemptAt: string | null } {
  const [row] = venue.db.all<{ status: string; attemptAt: string | null }>(
    sql`select status, payment_attempt_at as attemptAt from working_orders where id = ${id}`,
  );
  return row!;
}

async function placedIssuedOrder(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: lines(1),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  await placeOrder(deps, venue.cfg, id, venue.operatorId);
  return id;
}

async function openOrder(): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, { id, lines: lines(1), zoneId: counter.zoneId });
  return id;
}

describe("POST /api/pay while the full-disk stop holds", () => {
  it("refuses a walk-up card sale while a refused write is noted, and never asks the reader", async () => {
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const id = randomUUID();
    const before = collects();

    const answer = await walkUpPay(disk, id);

    expect(answer.status).toBe(507);
    expect(answer.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);
    expect(count("working_orders", "id", id)).toBe(0);
    expect(count("payments", "working_order_id", id)).toBe(0);
  });

  it("asks the reader when nothing is noted", async () => {
    const disk = diskState({ bytes: 0 });
    const before = collects();

    const answer = await walkUpPay(disk);

    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("captured");
    expect(collects()).toBe(before + 1);
  });

  it("sells again once the folder has 16 MiB free", async () => {
    const free = { bytes: FULL_DISK_BYTES - 1 };
    const disk = diskState(free);
    disk.noteRefused();
    const before = collects();

    const short = await walkUpPay(disk);
    expect(short.status).toBe(507);
    expect(short.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);

    free.bytes = FULL_DISK_BYTES;
    const answer = await walkUpPay(disk);
    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("captured");
    expect(collects()).toBe(before + 1);
    expect(disk.since()).toBeNull();
  });

  it("refuses a placed order whose invoice is filed, before the reader", async () => {
    const id = await placedIssuedOrder();
    const was = orderRow(id);
    expect(was.status).toBe("placed");
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const before = collects();

    const answer = await payAgain(disk, id);

    expect(answer.status).toBe(507);
    expect(answer.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);
    expect(orderRow(id)).toEqual(was);
  });

  it("asks the reader for a placed order whose invoice is filed when nothing is noted", async () => {
    const id = await placedIssuedOrder();
    const before = collects();

    const answer = await payAgain(diskState({ bytes: 0 }), id);

    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("captured");
    expect(collects()).toBe(before + 1);
  });

  it("logs the refusal with the order it refused", async () => {
    const entries: { level: string; event: string; fields: Record<string, unknown> }[] = [];
    const log: Logger = (level, event, fields) => {
      entries.push({ level, event, fields: fields ?? {} });
    };
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const id = randomUUID();

    const answer = await send(venue.appWith({ disk, log }), venue.cookie, "POST", "/api/pay", {
      id,
      lines: lines(1),
      zoneId: counter.zoneId,
    });

    expect(answer.status).toBe(507);
    expect(entries.filter((entry) => entry.event === "storage.disk_full_stop_refused")).toEqual([
      { level: "warn", event: "storage.disk_full_stop_refused", fields: { workingOrderId: id } },
    ]);
  });

  it("files a card already charged while the stop holds, without asking the reader again", async () => {
    const id = await openOrder();
    await withTransaction(venue.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        workingOrderId: id,
        provider: "fake",
        paymentRef: `fake-${randomUUID()}`,
        amount: decimal("10.00"),
        settledAt: new Date(),
      }),
    );
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const before = collects();

    const answer = await payAgain(disk, id);

    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("captured");
    expect(disk.since()).not.toBeNull();
    expect(collects()).toBe(before);
    expect(count("sales", "working_order_id", id)).toBe(1);
    expect(registroCount(venue, id)).toBe(1);
  });

  describe("a refusal noted while the payment waits for the write queue", () => {
    /** Wraps a real state; its `full()` queues a write body, ahead of the payment's, that runs `queued`. */
    function queuingState(queued: (state: DiskFullState) => void) {
      const state = diskState({ bytes: 0 });
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

    it("refuses before the reader when a refusal is noted while the payment waits for the write queue", async () => {
      const { disk, queuedBody } = queuingState((state) => state.noteRefused());
      const id = randomUUID();
      const before = collects();

      const answer = await walkUpPay(disk, id);
      await queuedBody();

      expect(answer.status).toBe(507);
      expect(answer.json.code).toBe("storage.disk_full");
      expect(collects()).toBe(before);
      expect(count("working_orders", "id", id)).toBe(0);
    });

    it("asks the reader when the queued write notes nothing", async () => {
      const { disk, queuedBody } = queuingState(() => {});
      const before = collects();

      const answer = await walkUpPay(disk);
      await queuedBody();

      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("captured");
      expect(collects()).toBe(before + 1);
    });
  });

  describe("a refusal noted after the first transaction", () => {
    function scriptedState(notedFromCall: number): DiskFullState & { calls: () => number } {
      let calls = 0;
      return {
        noteRefused: () => {},
        noted: () => {
          calls += 1;
          return calls >= notedFromCall;
        },
        since: () => null,
        full: () => Promise.resolve(false),
        calls: () => calls,
      };
    }

    it("refuses before the reader when a refusal is noted after the first transaction, and releases the order", async () => {
      const id = await openOrder();
      const disk = scriptedState(2);
      const before = collects();

      const answer = await payAgain(disk, id);

      expect(answer.status).toBe(507);
      expect(answer.json.code).toBe("storage.disk_full");
      expect(collects()).toBe(before);
      expect(disk.calls()).toBe(2);
      expect(orderRow(id)).toEqual({ status: "open", attemptAt: null });
    });

    it("asks the reader when nothing is noted after the first transaction", async () => {
      const id = await openOrder();
      const disk = scriptedState(Number.POSITIVE_INFINITY);
      const before = collects();

      const answer = await payAgain(disk, id);

      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("captured");
      expect(collects()).toBe(before + 1);
    });
  });

  it("after a big sale fails on a full database, the next card sale is refused before the reader", async () => {
    const free = { bytes: FULL_DISK_BYTES };
    const disk = diskState(free);
    const unwatch = watchForDiskFull(disk, [venue.db]);
    try {
      venue.db.run(sql`create table ballast (id integer primary key, pad blob)`);
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

      const cash = await send(venue.appWith({ disk }), venue.cookie, "POST", "/api/sales", {
        workingOrderId: randomUUID(),
        lines: lines(20),
        zoneId: counter.zoneId,
        tender: { method: "cash", amount: "200.00" },
      });
      expect(cash.status).toBe(507);
      expect(disk.since()).not.toBeNull();

      free.bytes = 0;
      const before = collects();
      const refused = await walkUpPay(disk);
      expect(refused.status).toBe(507);
      expect(refused.json.code).toBe("storage.disk_full");
      expect(collects()).toBe(before);

      venue.db.all(sql.raw(`pragma max_page_count = 4294967294`));
      free.bytes = FULL_DISK_BYTES;
      const id = randomUUID();
      const answer = await walkUpPay(disk, id);
      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("captured");
      expect(collects()).toBe(before + 1);
      expect(count("sales", "working_order_id", id)).toBe(1);
    } finally {
      venue.db.all(sql.raw(`pragma max_page_count = 4294967294`));
      unwatch();
    }
  });
});
