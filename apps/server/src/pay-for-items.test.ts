import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { billPayments, sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { placeGrouped } from "./testing/adjustment-venue.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { TabRoundLine } from "./working-order.js";
import {
  payForItems,
  previewPayForItems,
  type ItemPick,
  type PayForItemsRequest,
} from "./pay-for-items.js";
import "./errors.js";

let v: PartyVenue;
let offers: ZoneOffers;
let ids: Record<"soup" | "hake" | "beer" | "ham", string>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      const category = (
        await tx.all<{ categoryId: string }>(
          sql`select category_id as categoryId from products where id = ${v.productId("Burger")}`,
        )
      )[0]!.categoryId;
      const product = async (
        name: string,
        unitPrice: string,
        pricingUnit: "each" | "weight" = "each",
      ) =>
        (
          await createProduct(tx, {
            categoryId: category,
            name,
            customerName: { [v.cfg.locale]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit,
            unitPrice,
            vatClass: "general",
          })
        ).id;
      ids = {
        soup: await product("Soup", "6.00"),
        hake: await product("Hake", "15.00"),
        beer: await product("Beer", "2.50"),
        // By the kilo: 0.050 kg is 1.01, and its halves would come to 0.51 each.
        ham: await product("Ham", "20.20", "weight"),
      };
      offers = await offerProducts(tx, { zone: "tables" });
    });
  },
});

type Line = { product: keyof typeof ids; quantity?: string };

async function seatedBill(...lines: Line[]): Promise<{ partyId: string; billId: string }> {
  const seated = await seat(v, await v.table(`Pay ${randomUUID().slice(0, 8)}`));
  const round: TabRoundLine[] = offers.toOfferLines(
    lines.map((line) => ({ productId: ids[line.product], quantity: line.quantity ?? "1" })),
  );
  await inTx(v, (tx) => placeGrouped(tx, v.cfg, seated, round, "fire", OPERATOR));
  return { partyId: seated.partyId, billId: seated.tabId };
}

async function lineOf(billId: string, product: keyof typeof ids): Promise<string> {
  const [row] = await v.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        eq(workingOrderLines.productId, ids[product]),
      ),
    );
  return row!.id;
}

const deps = () => ({
  admission: testTradingAdmission(),
  db: v.db,
  backend: v.backend,
  clock: v.clock,
});

async function request(
  partyId: string,
  billId: string,
  picks: ItemPick[],
  pay: Pick<PayForItemsRequest, "method" | "applied" | "tip" | "tendered">,
): Promise<PayForItemsRequest> {
  return {
    submissionId: randomUUID(),
    picks,
    ...(await commandFor(v, partyId)),
    partyId,
    expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
    ...pay,
  };
}

function billsNaming(sourceId: string) {
  return v.db
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.itemsPaidFrom, sourceId));
}

async function invoicesOf(billId: string): Promise<string[]> {
  const rows = await v.db
    .select({ total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
  return rows.map(({ total }) => centsToDecimal(total));
}

async function statusOf(billId: string) {
  const [row] = await v.db
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return row!.status;
}

async function paymentsOf(billId: string) {
  return v.db
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, billId));
}

async function lineTotals(billId: string): Promise<string[]> {
  const rows = await v.db
    .select({ lineTotal: workingOrderLines.lineTotal })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
  return rows.map(({ lineTotal }) => centsToDecimal(lineTotal));
}

describe("A1515 pay for items: cash and hand-keyed card", () => {
  it("cash pays the chosen items on their own bill and issues its ticket", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "cash",
      applied: "15.00",
      tip: "0.00",
      tendered: "20.00",
    });

    const paid = await payForItems(deps(), v.cfg, billId, req, v.operator);

    expect(await billsNaming(billId)).toEqual([{ id: paid.billId, status: "settled" }]);
    expect(await invoicesOf(paid.billId)).toEqual(["15.00"]);
    expect(paid.payment.outcome).toBe("received");
    expect(paid.payment.payment.change).toBe("5.00");
    expect(paid.payment.invoice).toBeDefined();
    expect(await statusOf(billId)).toBe("open");
    expect(await lineTotals(billId)).toEqual(["6.00"]);
    expect(await paymentsOf(billId)).toEqual([]);
  });

  it("a hand-keyed card does the same", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "card",
      applied: "15.00",
      tip: "0.00",
    });

    const paid = await payForItems(deps(), v.cfg, billId, req, v.operator);

    expect(await billsNaming(billId)).toEqual([{ id: paid.billId, status: "settled" }]);
    expect(await invoicesOf(paid.billId)).toEqual(["15.00"]);
    expect(paid.payment.payment).toMatchObject({ method: "card", entry: "manual" });
    expect(await statusOf(billId)).toBe("open");
    expect(await lineTotals(billId)).toEqual(["6.00"]);
    expect(await paymentsOf(billId)).toEqual([]);
  });

  it.each([
    ["cash", { method: "cash", tendered: "15.00" }],
    ["a hand-keyed card", { method: "card" }],
  ] as const)("%s issues a source the move left paid in the same request", async (_, pay) => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    await takeBillPayment(
      deps(),
      v.cfg,
      billId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "6.00",
        method: "cash",
        tendered: "6.00",
        applied: "6.00",
        tip: "0.00",
      },
      v.operator,
    );
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      ...pay,
      applied: "15.00",
      tip: "0.00",
    });

    const paid = await payForItems(deps(), v.cfg, billId, req, v.operator);

    expect(await invoicesOf(billId)).toEqual(["6.00"]);
    expect(await statusOf(billId)).toBe("settled");
    expect(await invoicesOf(paid.billId)).toEqual(["15.00"]);
  });

  it("the same submission twice makes one bill", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "cash",
      applied: "15.00",
      tip: "0.00",
      tendered: "20.00",
    });

    const first = await payForItems(deps(), v.cfg, billId, req, v.operator);
    const second = await payForItems(deps(), v.cfg, billId, req, v.operator);

    expect(second).toEqual(first);
    expect(await billsNaming(billId)).toEqual([{ id: first.billId, status: "settled" }]);
    expect(await invoicesOf(first.billId)).toEqual(["15.00"]);
    expect(await paymentsOf(first.billId)).toHaveLength(1);
  });

  it("the same submission id for another request is refused", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "cash",
      applied: "15.00",
      tip: "0.00",
      tendered: "20.00",
    });
    await payForItems(deps(), v.cfg, billId, req, v.operator);

    await expect(
      payForItems(deps(), v.cfg, billId, { ...req, tendered: "50.00" }, v.operator),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
  });

  it("too little cash leaves both bills as they were", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "cash",
      applied: "15.00",
      tip: "0.00",
      tendered: "10.00",
    });

    await expect(payForItems(deps(), v.cfg, billId, req, v.operator)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "tendered" },
    });
    expect(await billsNaming(billId)).toEqual([]);
    expect(await lineTotals(billId)).toEqual(["6.00", "15.00"]);
  });

  it("a stale preview is refused", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const req = await request(partyId, billId, [{ lineId: await lineOf(billId, "hake") }], {
      method: "cash",
      applied: "14.00",
      tip: "0.00",
      tendered: "20.00",
    });

    await expect(payForItems(deps(), v.cfg, billId, req, v.operator)).rejects.toMatchObject({
      code: "bill.allocation_changed",
    });
    expect(await billsNaming(billId)).toEqual([]);
    expect(await lineTotals(billId)).toEqual(["6.00", "15.00"]);
  });

  it("the preview prices the chosen items as their own bill would", async () => {
    const { billId } = await seatedBill(
      { product: "beer", quantity: "3" },
      { product: "hake" },
      { product: "soup" },
    );
    const picks = [
      { lineId: await lineOf(billId, "beer"), quantity: "1" },
      { lineId: await lineOf(billId, "hake") },
    ];

    expect(
      await previewPayForItems(v.db, billId, { picks, method: "cash", tendered: "20.00" }),
    ).toEqual({ total: "17.50", applied: "17.50", tip: "0.00", change: "2.50" });
    expect(await billsNaming(billId)).toEqual([]);
    expect(await lineTotals(billId)).toEqual(["7.50", "15.00", "6.00"]);
  });

  it.each([
    ["half of a dish sold by the unit", { product: "beer" }, "beer", "0.5"],
    [
      "part of a weighed line whose part and rest would cost more than it",
      { product: "ham", quantity: "0.050" },
      "ham",
      "0.025",
    ],
  ] as const)(
    "the preview refuses %s, as paying for it does",
    async (_, line, product, quantity) => {
      const { partyId, billId } = await seatedBill({ product: "soup" }, line);
      const picks = [{ lineId: await lineOf(billId, product), quantity }];

      const paying = await payForItems(
        deps(),
        v.cfg,
        billId,
        await request(partyId, billId, picks, { method: "card", applied: "1.25", tip: "0.00" }),
        v.operator,
      ).catch((error: unknown) => error);
      const previewing = await previewPayForItems(v.db, billId, { picks, method: "card" }).catch(
        (error: unknown) => error,
      );

      expect(paying).toMatchObject({
        code: "tab.transfer_quantity_invalid",
        params: { tabId: billId, lineNo: 2, quantity },
      });
      expect(previewing).toMatchObject({
        code: (paying as { code: string }).code,
        params: (paying as { params: unknown }).params,
      });
      expect(await billsNaming(billId)).toEqual([]);
    },
  );
});
