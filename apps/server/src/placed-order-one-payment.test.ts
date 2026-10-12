import { deviceId as brandDeviceId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorZones } from "@waitron/db";
import { failAttempting } from "@waitron/payments";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, statusOf, type BillVenue } from "./testing/bill-venue.js";
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

/** Everything a payment could write, across the venue, so a refusal can be shown to write none. */
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
