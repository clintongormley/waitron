import { deviceId as brandDeviceId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorZones, withTransaction } from "@waitron/db";
import { captureAttempting, failAttempting } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, statusOf, type BillVenue } from "./testing/bill-venue.js";
import {
  paymentAttemptIsLive,
  payWorkingOrderIntegratedOrchestration,
} from "./testing/whole-payment-fixture.js";
import "./errors.js";

let venue: BillVenue;
const zoneOf = {} as Record<Kind, { zoneId: string; offerFor: (productId: string) => string }>;
let canaId: string;

type Kind = "invoiced" | "uninvoiced";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "invoiced", label: "with an issued invoice" },
  { kind: "uninvoiced", label: "with no invoice" },
];

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    canaId = db.all<{ id: string }>(sql`select id from products where name = 'Caña'`)[0]!.id;
    zoneOf.invoiced = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    zoneOf.uninvoiced = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra ticket" })
        .returning({ id: floorZones.id });
      return offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "counter" });
    });
  },
});

/** One Caña (3.00), parked and placed through the routes; `invoiced` issues its invoice between. */
async function placed(kind: Kind): Promise<string> {
  const id = randomUUID();
  const zone = zoneOf[kind];
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    id,
    zoneId: zone.zoneId,
    lines: [{ menuItemId: zone.offerFor(canaId), quantity: "1" }],
  });
  expect(parked.status).toBe(200);
  if (kind === "invoiced") {
    await issueOrderInvoice(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      id,
      venue.operatorId,
    );
  }
  const place = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`);
  expect(place.status).toBe(200);
  return id;
}

function pay(id: string, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", "/api/pay", { id, lines: [] });
}

function collect(id: string, tender: { method: "cash" | "card"; amount: string }) {
  return send(venue.app, venue.cookie2, "POST", `/api/working-orders/${id}/collect`, { tender });
}

function snapshot() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from registros_facturacion) as registros,
      (select count(*) from tenders) as tenders,
      (select count(*) from sale_settlements) as settlements,
      (select count(*) from payments) as payments,
      (select count(*) from print_jobs) as printJobs
  `)[0];
}

function salesOf(id: string) {
  return venue.db.all<{ id: string }>(sql`select id from sales where working_order_id = ${id}`);
}

function tendersOf(id: string) {
  return venue.db.all<{ method: string; amount: number }>(sql`
    select t.method, t.amount from tenders t join sales s on s.id = t.sale_id
    where s.working_order_id = ${id}`);
}

function paymentsOf(id: string) {
  return venue.db.all<{ provider: string; state: string; saleId: string | null }>(sql`
    select provider, state, sale_id as saleId from payments
    where working_order_id = ${id} order by created_at`);
}

const refusedInFlight = (id: string) => ({
  status: 409,
  json: { code: "order.payment_in_flight", params: { workingOrderId: id } },
});

describe("a placed order's collect while its card is in flight", () => {
  describe.each(KINDS)("$label", ({ kind }) => {
    it.each([
      { tender: "cash", body: { method: "cash", amount: "50.00" } },
      { tender: "hand-keyed card", body: { method: "card", amount: "3.00" } },
    ] as const)(
      "refuses a $tender collect while the first till's card is at the reader, writing nothing, and the card then pays it",
      async ({ body }) => {
        const id = await placed(kind);
        const calls = venue.card.collectCalls.length;
        const release = venue.card.holdNextCollect();
        let paying: ReturnType<typeof pay> | undefined;
        let observed;
        try {
          paying = pay(id);
          await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
          const before = snapshot();
          const collected = await collect(id, body);
          observed = { collected, before, after: snapshot(), status: await statusOf(venue, id) };
        } finally {
          release();
        }
        const paid = await paying;

        expect(observed.collected).toEqual(refusedInFlight(id));
        expect(observed.after).toEqual(observed.before);
        expect(observed.status).toBe("placed");
        expect(paid.status).toBe(200);
        expect(paid.json.outcome).toBe("captured");
        const sales = salesOf(id);
        expect(sales).toHaveLength(1);
        expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
        expect(paymentsOf(id)).toEqual([
          { provider: "fake", state: "captured", saleId: sales[0]!.id },
        ]);
      },
    );

    it("refuses a cash collect while a card captured for it is not yet on a sale, and Pay again files that card asking no reader", async () => {
      const id = await placed(kind);
      venue.card.crashNextCollect("captured");
      expect((await pay(id)).status).toBe(500);
      const before = snapshot();

      const collected = await collect(id, { method: "cash", amount: "50.00" });

      expect(collected).toEqual(refusedInFlight(id));
      expect(snapshot()).toEqual(before);
      expect(await statusOf(venue, id)).toBe("placed");

      const calls = venue.card.collectCalls.length;
      const recovered = await pay(id);
      expect(recovered.status).toBe(200);
      expect(recovered.json.outcome).toBe("captured");
      expect(venue.card.collectCalls.length).toBe(calls);
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("refuses a cash collect while a reader that timed out leaves its payment unresolved, and takes it once the payment fails", async () => {
      const id = await placed(kind);
      venue.card.stallNextCollect();
      const timedOut = await pay(id);
      expect(timedOut).toEqual({ status: 200, json: { outcome: "timeout" } });
      const before = snapshot();

      const refused = await collect(id, { method: "cash", amount: "50.00" });

      expect(refused).toEqual(refusedInFlight(id));
      expect(snapshot()).toEqual(before);
      expect(await statusOf(venue, id)).toBe("placed");

      expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "attempting", saleId: null }]);
      const [attempt] = venue.db.all<{ ref: string }>(
        sql`select payment_ref as ref from payments where working_order_id = ${id}`,
      );
      await inTx(venue, (tx) => failAttempting(tx, { provider: "fake", paymentRef: attempt!.ref }));
      const collected = await collect(id, { method: "cash", amount: "50.00" });
      expect(collected.status).toBe(200);
      expect(salesOf(id)).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "cash", amount: 300 }]);
      expect(await statusOf(venue, id)).toBe("settled");
    });

    it("releases the card's hold when the pay throws after its reader wrote an attempting payment, so cash is taken once that payment fails", async () => {
      const id = await placed(kind);
      venue.card.crashNextCollect("attempting");
      expect((await pay(id)).status).toBe(500);
      expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "attempting", saleId: null }]);
      expect(await collect(id, { method: "cash", amount: "50.00" })).toEqual(refusedInFlight(id));

      const [attempt] = venue.db.all<{ ref: string }>(
        sql`select payment_ref as ref from payments where working_order_id = ${id}`,
      );
      await inTx(venue, (tx) => failAttempting(tx, { provider: "fake", paymentRef: attempt!.ref }));
      const collected = await collect(id, { method: "cash", amount: "50.00" });

      expect(collected.status).toBe(200);
      expect(salesOf(id)).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "cash", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "failed", saleId: null }]);
      expect(await statusOf(venue, id)).toBe("settled");
    });

    it("takes cash after a declined card", async () => {
      const id = await placed(kind);
      venue.card.failNextCollect();
      const declined = await pay(id);
      expect(declined).toEqual({ status: 200, json: { outcome: "declined" } });

      const collected = await collect(id, { method: "cash", amount: "50.00" });

      expect(collected.status).toBe(200);
      expect(salesOf(id)).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "cash", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "failed", saleId: null }]);
      expect(await statusOf(venue, id)).toBe("settled");
    });

    it("takes cash with no card involved", async () => {
      const id = await placed(kind);

      const collected = await collect(id, { method: "cash", amount: "50.00" });

      expect(collected.status).toBe(200);
      expect(salesOf(id)).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "cash", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([]);
      expect(await statusOf(venue, id)).toBe("settled");
    });
  });
});

/** A card payment of `id` through the orchestration, with `provider` as its reader. */
function payWith(provider: FakePaymentProvider, id: string) {
  return payWorkingOrderIntegratedOrchestration(
    { db: venue.db, backend: venue.backend, clock: venue.clock, provider },
    venue.cfg,
    { id, lines: [] },
  );
}

/** A reader that charges the card and writes its captured row, then holds its answer until
 * `release`, so the pay that asked it has not yet filed the sale. */
class ChargedThenHeld extends FakePaymentProvider {
  readonly charged: Promise<void>;
  release!: () => void;
  private signal!: () => void;
  private readonly gate: Promise<void>;

  constructor() {
    super(venue.db);
    this.charged = new Promise((resolve) => (this.signal = resolve));
    this.gate = new Promise((resolve) => (this.release = resolve));
  }

  override async collect(params: Parameters<FakePaymentProvider["collect"]>[0]) {
    const result = await super.collect(params);
    this.signal();
    await this.gate;
    return result;
  }
}

describe("a second card payment of a placed order while the first is in flight", () => {
  describe.each(KINDS)("$label", ({ kind }) => {
    it("refuses till 2's card while till 1's is at the reader, asking no second reader, and keeps refusing cash after", async () => {
      const id = await placed(kind);
      const calls = venue.card.collectCalls.length;
      const release = venue.card.holdNextCollect();
      let paying: ReturnType<typeof pay> | undefined;
      let observed;
      try {
        paying = pay(id);
        await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
        const second = await pay(id, venue.cookie2);
        const callsAfterSecond = venue.card.collectCalls.length;
        const cash = await collect(id, { method: "cash", amount: "50.00" });
        observed = { second, callsAfterSecond, cash };
      } finally {
        release();
      }
      const paid = await paying;

      expect(observed.second).toEqual(refusedInFlight(id));
      expect(observed.callsAfterSecond).toBe(calls + 1);
      expect(observed.cash).toEqual(refusedInFlight(id));
      expect(paid.status).toBe(200);
      expect(paid.json.outcome).toBe("captured");
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("refuses a second card while a reader that timed out leaves the first unresolved", async () => {
      const id = await placed(kind);
      venue.card.stallNextCollect();
      expect(await pay(id)).toEqual({ status: 200, json: { outcome: "timeout" } });
      const calls = venue.card.collectCalls.length;

      const second = await pay(id, venue.cookie2);

      expect(second).toEqual(refusedInFlight(id));
      expect(venue.card.collectCalls.length).toBe(calls);
      expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "attempting", saleId: null }]);
    });

    it("never refuses Pay again after a crash: it files the captured card asking no reader", async () => {
      const id = await placed(kind);
      venue.card.crashNextCollect("captured");
      expect((await pay(id)).status).toBe(500);
      const calls = venue.card.collectCalls.length;

      const recovered = await pay(id);

      expect(recovered.status).toBe(200);
      expect(recovered.json.outcome).toBe("captured");
      expect(venue.card.collectCalls.length).toBe(calls);
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("lets a Pay from another till file a charge the sweep found captured after its reader timed out, asking no reader", async () => {
      const id = await placed(kind);
      venue.card.stallNextCollect();
      expect(await pay(id)).toEqual({ status: 200, json: { outcome: "timeout" } });
      const [attempt] = venue.db.all<{ ref: string }>(
        sql`select payment_ref as ref from payments where working_order_id = ${id}`,
      );
      await inTx(venue, (tx) =>
        captureAttempting(tx, {
          provider: "fake",
          paymentRef: attempt!.ref,
          settledAt: new Date(),
          externalRef: `swept-${attempt!.ref}`,
        }),
      );
      const calls = venue.card.collectCalls.length;

      const filed = await pay(id, venue.cookie2);

      expect(filed.status).toBe(200);
      expect(filed.json.outcome).toBe("captured");
      expect(venue.card.collectCalls.length).toBe(calls);
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("takes a normal card payment", async () => {
      const id = await placed(kind);

      const paid = await pay(id);

      expect(paid.status).toBe(200);
      expect(paid.json.outcome).toBe("captured");
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("takes a card after a declined card", async () => {
      const id = await placed(kind);
      venue.card.failNextCollect();
      expect(await pay(id)).toEqual({ status: 200, json: { outcome: "declined" } });

      const paid = await pay(id, venue.cookie2);

      expect(paid.status).toBe(200);
      expect(paid.json.outcome).toBe("captured");
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "failed", saleId: null },
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("lets a second Pay file the first card's charge while the first has not yet filed it, asking no reader", async () => {
      const id = await placed(kind);
      const reader = new ChargedThenHeld();
      const first = payWith(reader, id);
      let second;
      try {
        await reader.charged;
        const calls = venue.card.collectCalls.length;
        second = await pay(id, venue.cookie2);
        expect(venue.card.collectCalls.length).toBe(calls);
      } finally {
        reader.release();
      }
      const firstPaid = await first;

      expect(second.status).toBe(200);
      expect(second.json.outcome).toBe("captured");
      expect(firstPaid.outcome).toBe("captured");
      if (firstPaid.outcome !== "captured") throw new Error("unreachable");
      expect(firstPaid.ticket.invoiceNumber).toBe(
        (second.json.ticket as { invoiceNumber: string }).invoiceNumber,
      );
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("lets one of two card payments started in the same tick reach its reader, and refuses the other before it asks", async () => {
      const id = await placed(kind);
      const readers = [new FakePaymentProvider(venue.db), new FakePaymentProvider(venue.db)];
      const releases = readers.map((reader) => reader.holdNextCollect());
      const settled: (PromiseSettledResult<unknown> | undefined)[] = [undefined, undefined];
      const paying = readers.map((reader, i) =>
        payWith(reader, id)
          .then(
            (value): PromiseSettledResult<unknown> => ({ status: "fulfilled", value }),
            (reason: unknown): PromiseSettledResult<unknown> => ({ status: "rejected", reason }),
          )
          .then((outcome) => (settled[i] = outcome)),
      );
      let whileHeld;
      try {
        await expect.poll(() => settled.filter((s) => s !== undefined).length).toBe(1);
        whileHeld = {
          calls: readers.map((reader) => reader.collectCalls.length),
          settled: [...settled],
        };
      } finally {
        releases.forEach((release) => release());
      }
      const outcomes = await Promise.all(paying);

      const loser = whileHeld.settled.findIndex((s) => s !== undefined);
      const winner = 1 - loser;
      expect(whileHeld.calls[loser]).toBe(0);
      expect(whileHeld.calls[winner]).toBe(1);
      expect(outcomes[loser]).toMatchObject({
        status: "rejected",
        reason: { code: "order.payment_in_flight", params: { workingOrderId: id } },
      });
      expect(outcomes[winner]).toMatchObject({
        status: "fulfilled",
        value: { outcome: "captured" },
      });
      expect(readers[loser]!.collectCalls).toHaveLength(0);
      const sales = salesOf(id);
      expect(sales).toHaveLength(1);
      expect(paymentsOf(id)).toEqual([
        { provider: "fake", state: "captured", saleId: sales[0]!.id },
      ]);
    });

    it("answers a card payment after a cash collect settled the order with the cash ticket, asking no reader and dispensing no change again", async () => {
      const id = await placed(kind);
      const collected = await collect(id, { method: "cash", amount: "5.00" });
      expect(collected.status).toBe(200);
      expect(collected.json.tender).toEqual({ method: "cash", change: "2.00" });
      const calls = venue.card.collectCalls.length;

      const paid = await pay(id);

      expect(paid.status).toBe(200);
      expect(paid.json.outcome).toBe("captured");
      expect((paid.json.ticket as { tender: unknown }).tender).toEqual({
        method: "cash",
        change: "2.00",
      });
      expect(venue.card.collectCalls.length).toBe(calls);
      expect(salesOf(id)).toHaveLength(1);
      expect(tendersOf(id)).toEqual([{ method: "cash", amount: 300 }]);
      expect(paymentsOf(id)).toEqual([]);
    });
  });
});

describe("where a placed order's card registers itself as in flight", () => {
  it.each(KINDS)(
    "$label: the card's first transaction registers it before any later transaction runs (database-level probe: relies on the queue running the pay's first transaction first)",
    async ({ kind }) => {
      const id = await placed(kind);
      const reader = new FakePaymentProvider(venue.db);
      const release = reader.holdNextCollect();
      let paying: ReturnType<typeof payWith> | undefined;
      let live: boolean | undefined;
      try {
        paying = payWith(reader, id);
        live = await withTransaction(venue.db, async () => paymentAttemptIsLive(venue.db, id));
      } finally {
        release();
      }
      const paid = await paying;

      expect(live).toBe(true);
      expect(paid).toMatchObject({ outcome: "captured" });
    },
  );
});
