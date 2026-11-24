import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

// A walk-up counter sale is filed in the request that prices it, from the gross lines its pricing
// answered, so those lines must already carry the class of the way the order is sold: a
// €1.80 cola is served here at 10% and taken away at 21%.
let venue: BillVenue;
let counter: ZoneOffers;
let cola: string;
let menu: Awaited<ReturnType<typeof seedTakeawayProducts>>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      menu = await seedTakeawayProducts(tx);
      cola = menu.cola;
      counter = await offerProducts(tx);
    });
  },
});

beforeAll(() =>
  inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
      await setDepartmentSalePolicyField(tx, id, "dining", "till_choice");
    }
  }),
);

/** What the order's sale filed for its one line: the rate in basis points and the net base. */
function filedLine(workingOrderId: string): { vatRate: number; base: string }[] {
  return venue.db
    .all<{ vat_rate: number; line_total: number }>(
      sql`select sl.vat_rate, sl.line_total from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}`,
    )
    .map((row) => ({ vatRate: row.vat_rate, base: (row.line_total / 100).toFixed(2) }));
}

function filedRates(workingOrderId: string): number[] {
  return venue.db
    .all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}
          order by sl.line_no`,
    )
    .map((row) => row.vat_rate);
}

const colaLine = () => [{ menuItemId: counter.offerFor(cola), quantity: "1" }];

const EXPECTED: Record<Dining, { vatRate: number; base: string }> = {
  takeaway: { vatRate: 2100, base: "1.49" },
  eat_in: { vatRate: 1000, base: "1.64" },
};

function counterPayment(
  id: string,
  lines: ReturnType<typeof colaLine>,
  dining: Dining,
  payment: { method: "cash"; tendered: string } | { method: "card"; entry: "reader" },
) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "share",
    shareOf: 1,
    ...payment,
    dining,
    basket: { lines, zoneId: counter.zoneId },
  });
}

describe("a walk-up cola filed in one request", () => {
  it.each(["takeaway", "eat_in"] as const)("files a cash sale %s at its class", async (dining) => {
    const workingOrderId = randomUUID();
    const sold = await counterPayment(workingOrderId, colaLine(), dining, {
      method: "cash",
      tendered: "1.80",
    });
    expect(sold.status).toBe(200);
    expect(filedLine(workingOrderId)).toEqual([EXPECTED[dining]]);
  });

  it.each(["takeaway", "eat_in"] as const)("files a card sale %s at its class", async (dining) => {
    const id = randomUUID();
    const paid = await counterPayment(id, colaLine(), dining, {
      method: "card",
      entry: "reader",
    });
    expect(paid.status).toBe(200);
    expect(filedLine(id)).toEqual([EXPECTED[dining]]);
  });

  // Taken away, the burger files at its 21% and its lemon soda extra at its own 0%; eaten here,
  // both file at the dine-in rate.
  const burgerWithSoda = () => [
    {
      menuItemId: counter.offerFor(menu.burger),
      quantity: "1",
      extras: [{ listId: menu.burgerExtras, picks: [{ productId: menu.lemonSoda, quantity: 1 }] }],
    },
  ];
  const EXTRA_RATES: Record<Dining, number[]> = { takeaway: [2100, 0], eat_in: [1000, 1000] };

  it.each(["takeaway", "eat_in"] as const)(
    "files a cash sale's dish and its extra %s at that way's rates",
    async (dining) => {
      const workingOrderId = randomUUID();
      const sold = await counterPayment(workingOrderId, burgerWithSoda(), dining, {
        method: "cash",
        tendered: "12.00",
      });
      expect(sold.status).toBe(200);
      expect(filedRates(workingOrderId)).toEqual(EXTRA_RATES[dining]);
    },
  );

  it.each(["takeaway", "eat_in"] as const)(
    "files a card sale's dish and its extra %s at that way's rates",
    async (dining) => {
      const id = randomUUID();
      const paid = await counterPayment(id, burgerWithSoda(), dining, {
        method: "card",
        entry: "reader",
      });
      expect(paid.status).toBe(200);
      expect(filedRates(id)).toEqual(EXTRA_RATES[dining]);
    },
  );
});
