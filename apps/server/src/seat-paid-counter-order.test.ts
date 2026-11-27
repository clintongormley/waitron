import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IssuanceRefusal } from "@waitron/core";
import {
  billAdvances,
  billPayments,
  incidents,
  partyTables,
  refunds,
  sales,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSessionToken, tillSessions } from "@waitron/identity";
import { addProducts, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decimal } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { keepOverpaidAsTip } from "./bill-overpaid.js";
import { getBillBalance } from "./bill-balance.js";
import { switchOrderDining } from "./order-dining.js";
import { holderOf } from "./parties.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { mountTillApi } from "./till-api.js";
import { TradingAdmission } from "./trading-admission.js";
import { parkOrder } from "./working-order-open.js";
import { billRefundFields, takeBillPayment } from "./testing/bill-payment-fixture.js";
import { filedTotalsOf } from "./testing/fiscal-fixtures.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import {
  cashContribution,
  inTx,
  OPERATOR,
  paymentsOf,
  revisionOf,
  seatWithNoAllergies,
  statusOf,
  type PartyVenue,
} from "./testing/party-venue.js";
import { setTipsForTest } from "./testing/payment-settings.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { capturedCardPayment } from "./testing/set-menu-bill-fixture.js";
import {
  setupSetMenuSpecVenue,
  specDeps,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";

// An eat-in Counter order holds no set menus: Soup 6.00 and Hake 16.00 are 22.00 there, and one
// Daily menu at 14.00 once seated.
let spec: SpecVenue;
let venue: PartyVenue;
let ordinary: Record<SpecDish, string>;
let zoneId: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await setTipsForTest(db, true);
    await inTx(venue, async (tx) => {
      const shop = await createDepartment(tx, { name: "Counter", orderStart: "counter" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "till_choice");
      await setDepartmentSalePolicyField(tx, shop.id, "diningStartsAs", "eat_in");
      await tx.execute(
        sql`update departments set operation_description = ${"Restaurante"} where id = ${shop.id}`,
      );
      const zone = await createServiceZone(tx, { name: "Counter", departmentId: shop.id });
      zoneId = (await offerProducts(tx, { zone: { zoneId: zone.id } })).zoneId;
      const productIds = Object.values(spec.productIds);
      await addProducts(tx, await requireMenuRoot(tx, venue.tables.menuId), productIds);
      spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(
        tx,
        venue.tables.menuId,
      );
      const rows = await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(
          and(eq(menuItems.menuId, venue.tables.menuId), inArray(menuItems.productId, productIds)),
        );
      ordinary = Object.fromEntries(
        (Object.keys(spec.productIds) as SpecDish[]).map((dish) => [
          dish,
          rows.find(({ productId }) => productId === spec.productIds[dish])!.id,
        ]),
      ) as Record<SpecDish, string>;
    });
  },
});

async function counterOrder(...dishes: SpecDish[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId,
    lines: dishes.map((dish) => ({ menuItemId: ordinary[dish], quantity: "1" })),
    operatorId: OPERATOR,
    dining: "eat_in",
  });
  return id;
}

const DESTINATIONS = ["a free table", "a table whose party already has a bill"] as const;

async function tableFor(destination: (typeof DESTINATIONS)[number]): Promise<string> {
  const tableId = await venue.table(randomUUID());
  if (destination !== "a free table") await seatWithNoAllergies(venue, tableId);
  return tableId;
}

/** The seating's party fields: a new party's allergy answer goes with it, as the till sends it. */
async function seatingAt(tableId: string) {
  const holding = await inTx(venue, (tx) => holderOf(tx, tableId));
  return holding === null
    ? {
        partyId: null,
        otherPartyId: null,
        submissionId: randomUUID(),
        allergy: { party: { answer: "none" as const, guests: [] }, ticks: [] },
      }
    : {
        partyId: null,
        otherPartyId: holding,
        expectedOtherPartyRevision: await revisionOf(venue, holding),
      };
}

async function seat(billId: string, tableId: string) {
  const at = await seatingAt(tableId);
  return inTx(venue, (tx) =>
    moveBill(tx, venue.cfg, billId, { tableId }, { operatorId: OPERATOR, ...at }),
  );
}

const totalOf = (billId: string) => inTx(venue, (tx) => storedOrderTotal(tx, billId));

/** Everything a refused seating must leave as it was. */
async function before(billId: string, tableId: string) {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return {
    order,
    rows: await specRows(spec, billId),
    payments: await paymentsOf(venue, billId),
    held: await venue.db
      .select()
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt))),
    parties: venue.db.all(sql`select id, revision from parties order by id`),
  };
}

async function refusesSeating(billId: string, tableId: string, refusal: object) {
  const was = await before(billId, tableId);
  await expect(seat(billId, tableId)).rejects.toMatchObject(refusal);
  expect(await before(billId, tableId)).toEqual(was);
}

async function pendingCard(billId: string, applied: number): Promise<void> {
  await venue.db.insert(billPayments).values({
    workingOrderId: billId,
    submissionId: randomUUID(),
    fingerprint: "on the reader",
    kind: "contribution",
    method: "card",
    applied,
    tip: 0,
    state: "pending",
    requestedBy: OPERATOR,
    source: "device",
    deviceId: venue.cfg.origin.deviceId,
  });
}

/** A received card payment of `amount` with 1.00 of it being given back at the provider. */
async function pendingCardRefund(billId: string, amount: string): Promise<void> {
  await inTx(venue, async (tx) => {
    const paymentId = await capturedCardPayment(tx, venue, billId, amount);
    await tx
      .update(billPayments)
      .set({ state: "received", receivedAt: new Date().toISOString() })
      .where(eq(billPayments.id, paymentId));
    await tx.insert(refunds).values({
      billPaymentId: paymentId,
      ...billRefundFields(tx, venue.cfg.nodeId, paymentId),
      submissionId: randomUUID(),
      fingerprint: "refund",
      appliedAmount: 100,
      reason: "error",
      authorizedBy: OPERATOR,
      requestedBy: OPERATOR,
      source: "device",
      deviceId: venue.cfg.origin.deviceId,
      state: "pending",
    });
  });
}

/** Takes `amount` in cash towards the order with its own receipt. */
async function advance(billId: string, amount: string): Promise<void> {
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      ownReceipt: true,
    },
    venue.operator,
  );
}

async function keepAsTip(billId: string, amount: string): Promise<void> {
  await inTx(venue, (tx) =>
    keepOverpaidAsTip(
      tx,
      specDeps(spec),
      venue.cfg,
      billId,
      randomUUID(),
      decimal(amount),
      venue.operator,
    ),
  );
}

describe.each(DESTINATIONS)("a Counter order whose dishes make a set menu, seated at %s", (to) => {
  it("may be left holding more than it comes to, which staff can keep as a tip", async () => {
    const id = await counterOrder("Soup", "Hake");
    await cashContribution(venue, id, "20.00");
    const paid = await paymentsOf(venue, id);

    const seated = await seat(id, await tableFor(to));

    expect(seated).toEqual({ partyId: expect.any(String), billId: id, overpaid: "6.00" });
    expect(await inTx(venue, (tx) => readPartyBillIds(tx, [seated.partyId!]))).toContain(id);
    expect(await totalOf(id)).toBe("14.00");
    expect(await paymentsOf(venue, id)).toEqual(paid);
    expect(await getBillBalance(specDeps(spec), id)).toMatchObject({
      total: "14.00",
      received: "20.00",
      overpaid: "6.00",
    });

    await keepAsTip(id, "6.00");
    expect(await paymentsOf(venue, id)).toMatchObject([{ applied: 1400, tip: 600 }]);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("is refused while a card payment for it is pending, changing nothing", async () => {
    const id = await counterOrder("Soup", "Hake");
    await pendingCard(id, 2200);

    await refusesSeating(id, await tableFor(to), {
      code: "order.payment_in_flight",
      params: { workingOrderId: id },
    });
    expect(await totalOf(id)).toBe("22.00");
  });

  it("is refused while a card refund on it is pending, changing nothing", async () => {
    const id = await counterOrder("Soup", "Hake");
    await pendingCardRefund(id, "10.00");

    await refusesSeating(id, await tableFor(to), {
      code: "bill.refund_in_progress",
      params: { workingOrderId: id },
    });
    expect(await totalOf(id)).toBe("22.00");
  });

  it("is refused when that would take it below its advances, changing nothing", async () => {
    const id = await counterOrder("Soup", "Hake");
    await advance(id, "20.00");

    await refusesSeating(id, await tableFor(to), {
      code: "bill.below_advances",
      params: { workingOrderId: id, advances: "20.00", excess: "6.00" },
    });
    expect(await totalOf(id)).toBe("22.00");
  });

  it("is seated when it still comes to more than its advances", async () => {
    const id = await counterOrder("Soup", "Hake");
    await advance(id, "10.00");

    await seat(id, await tableFor(to));

    expect(await totalOf(id)).toBe("14.00");
    expect(await getBillBalance(specDeps(spec), id)).toMatchObject({ outstanding: "4.00" });
  });

  it.each(["card payment", "card refund"])(
    "is seated with a %s pending when its dishes make no set menu",
    async (pending) => {
      const id = await counterOrder("Soup");
      if (pending === "card payment") await pendingCard(id, 600);
      else await pendingCardRefund(id, "3.00");

      const { partyId } = await seat(id, await tableFor(to));

      expect(await inTx(venue, (tx) => readPartyBillIds(tx, [partyId!]))).toContain(id);
      expect(await totalOf(id)).toBe("6.00");
    },
  );
});

describe("POST /api/bills/:id/move seating a Counter order", () => {
  let cookie: string;

  beforeAll(async () => {
    const token = randomUUID();
    await venue.db.insert(tillSessions).values({
      deviceId: venue.cfg.origin.deviceId!,
      personId: OPERATOR,
      tokenHash: hashSessionToken(token),
    });
    cookie = await sessionCookieForTest(venue.db, token);
  });

  function appWith(admission: TradingAdmission): Hono {
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: "es-ES",
        secureCookies: false,
        admission,
      },
      () => {},
    );
    return app;
  }

  async function seatBody(billId: string, tableId: string) {
    const holding = await inTx(venue, (tx) => holderOf(tx, tableId));
    const bills =
      holding === null ? [] : await inTx(venue, (tx) => readPartyBillIds(tx, [holding]));
    const expectedEdits = [];
    for (const id of [billId, ...bills].sort())
      expectedEdits.push(await inTx(venue, (tx) => readBillEditState(tx, id)));
    return { to: { tableId }, ...(await seatingAt(tableId)), expectedEdits };
  }

  async function move(billId: string, body: object, admission = testTradingAdmission()) {
    const response = await appWith(admission).request(`/api/bills/${billId}/move`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  /** The totals of the order's sales, those of its payments on account included, in cents. */
  async function salesOf(billId: string): Promise<number[]> {
    const rows = await venue.db
      .select({ total: sales.total })
      .from(sales)
      .where(
        or(
          eq(sales.workingOrderId, billId),
          inArray(
            sales.id,
            venue.db
              .select({ id: billAdvances.advanceSaleId })
              .from(billAdvances)
              .where(eq(billAdvances.workingOrderId, billId)),
          ),
        ),
      )
      .orderBy(sql`${sales}.rowid`);
    return rows.map(({ total }) => total);
  }

  /** {@link salesOf}, and each total filed for them. */
  async function invoicedOf(billId: string) {
    return { sales: await salesOf(billId), filed: filedTotalsOf(venue.db, billId) };
  }

  /** Every row of the orders, parties, money, printing and filing a refused seating could change. */
  function economicRows() {
    const tables = venue.db
      .all<{ name: string }>(sql`select name from sqlite_schema where type = 'table' order by name`)
      .map(({ name }) => name)
      .filter((name) =>
        /^(working_|order_|bill_|ticket_|kitchen_|service_commands$|parties$|party_|sales$|sale_|tenders$|print_jobs$|invoice_series$|verifactu_records$|verifactu_submissions$|attendance_)/.test(
          name,
        ),
      );
    return Object.fromEntries(
      tables.map((name) => [name, venue.db.all(sql.raw(`select * from "${name}"`))]),
    );
  }

  it.each(DESTINATIONS)(
    "issues an order exactly paid at its set-menu price, at %s",
    async (destination) => {
      const id = await counterOrder("Soup", "Hake");
      await cashContribution(venue, id, "14.00");

      const moved = await move(id, await seatBody(id, await tableFor(destination)));

      expect(moved).toMatchObject({
        status: 200,
        json: {
          partyId: expect.any(String),
          billId: id,
          invoice: { total: "14.00", invoiceNumber: expect.any(String) },
        },
      });
      expect(Object.keys(moved.json).sort()).toEqual(["billId", "invoice", "partyId"]);
      expect(await totalOf(id)).toBe("14.00");
      expect(await statusOf(venue, id)).toBe("settled");
      expect(await invoicedOf(id)).toEqual({ sales: [1400], filed: ["14.00"] });
    },
  );

  it("issues an order its own-receipt payment covers exactly, which it does not refuse", async () => {
    const id = await counterOrder("Soup", "Hake");
    await advance(id, "14.00");
    expect(await invoicedOf(id)).toEqual({ sales: [1400], filed: ["14.00"] });

    const moved = await move(id, await seatBody(id, await tableFor("a free table")));

    expect(moved).toMatchObject({ status: 200, json: { invoice: { total: "0.00" } } });
    expect(moved.json.overpaid).toBeUndefined();
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await invoicedOf(id)).toEqual({ sales: [1400, 0], filed: ["14.00", "0.00"] });
  });

  it("issues the rest of an order part paid with its own receipt, once", async () => {
    const id = await counterOrder("Soup", "Hake");
    await advance(id, "10.00");
    await cashContribution(venue, id, "4.00");

    const moved = await move(id, await seatBody(id, await tableFor("a free table")));

    expect(moved).toMatchObject({ status: 200, json: { invoice: { total: "4.00" } } });
    expect(moved.json.overpaid).toBeUndefined();
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await invoicedOf(id)).toEqual({ sales: [1000, 400], filed: ["10.00", "4.00"] });
  });

  it("is rolled back whole when its invoice is refused, and goes through once it is not", async () => {
    const id = await counterOrder("Soup", "Hake");
    await cashContribution(venue, id, "14.00");
    const body = await seatBody(id, await tableFor("a free table"));
    const was = economicRows();
    const reported = await venue.db.select({ id: incidents.id }).from(incidents);

    const record = venue.backend.recordSale.bind(venue.backend);
    const recorded: number[] = [];
    const refusing = vi
      .spyOn(venue.backend, "recordSale")
      .mockImplementation(async (tx, ...sale) => {
        await record(tx, ...sale);
        recorded.push(filedTotalsOf(tx, id).length);
        throw new IssuanceRefusal(new AppError("fiscal.fingerprint_mismatch", {}), {
          origin: venue.cfg.origin,
          detectedAt: new Date(),
        });
      });
    const refused = await move(id, body).finally(() => refusing.mockRestore());

    expect(recorded).toEqual([1]);
    expect(refused).toMatchObject({
      status: 409,
      json: { error: { code: "fiscal.fingerprint_mismatch" } },
    });
    expect(economicRows()).toEqual(was);
    expect(
      (await venue.db.select().from(incidents)).slice(reported.length).map(({ code }) => code),
    ).toEqual(["fiscal.fingerprint_mismatch"]);

    expect(await move(id, body)).toMatchObject({
      status: 200,
      json: { invoice: { total: "14.00" } },
    });
    expect(await invoicedOf(id)).toEqual({ sales: [1400], filed: ["14.00"] });
  });

  it("answers a repeat of the seating with the same invoice, issuing nothing more", async () => {
    const id = await counterOrder("Soup", "Hake");
    await cashContribution(venue, id, "14.00");
    const body = await seatBody(id, await tableFor("a free table"));

    const first = await move(id, body);
    const again = await move(id, body);

    expect(first).toMatchObject({ status: 200, json: { invoice: { total: "14.00" } } });
    expect(again).toEqual(first);
    expect(await salesOf(id)).toHaveLength(1);
  });

  it("answers a repeat of the seating with the same overpayment", async () => {
    const id = await counterOrder("Soup", "Hake");
    await cashContribution(venue, id, "20.00");
    const body = await seatBody(id, await tableFor("a free table"));

    const first = await move(id, body);
    await keepAsTip(id, "6.00");
    const again = await move(id, body);

    expect(first).toMatchObject({ status: 200, json: { overpaid: "6.00" } });
    expect(again).toEqual(first);
  });

  it.each([
    ["20.00", { overpaid: "6.00" }],
    ["10.00", {}],
  ])("issues nothing for an order paid %s of 14.00", async (received, over) => {
    const id = await counterOrder("Soup", "Hake");
    await cashContribution(venue, id, received);

    const moved = await move(id, await seatBody(id, await tableFor("a free table")));

    expect(moved).toEqual({
      status: 200,
      json: { partyId: expect.any(String), billId: id, ...over },
    });
    expect(await totalOf(id)).toBe("14.00");
    expect(await statusOf(venue, id)).toBe("open");
    expect(await salesOf(id)).toEqual([]);
  });

  it("says what an order with its own receipt and more was paid over", async () => {
    const id = await counterOrder("Soup", "Hake");
    await advance(id, "10.00");
    await cashContribution(venue, id, "7.00");

    const moved = await move(id, await seatBody(id, await tableFor("a free table")));

    expect(moved).toEqual({
      status: 200,
      json: { partyId: expect.any(String), billId: id, overpaid: "3.00" },
    });
    expect(await salesOf(id)).toEqual([1000]);
  });

  it("moves a part-paid order whose amount seating leaves alone, issuing nothing, while the box may not write sales", async () => {
    const id = await counterOrder("Soup");
    await cashContribution(venue, id, "3.00");

    const moved = await move(
      id,
      await seatBody(id, await tableFor("a free table")),
      new TradingAdmission(),
    );

    expect(moved).toEqual({ status: 200, json: { partyId: expect.any(String), billId: id } });
    expect(await statusOf(venue, id)).toBe("open");
    expect(await salesOf(id)).toEqual([]);
  });

  it("refuses to change the amount while the box may not write sales, changing nothing", async () => {
    const id = await counterOrder("Soup", "Hake");
    const tableId = await tableFor("a free table");
    const was = await before(id, tableId);

    const moved = await move(id, await seatBody(id, tableId), new TradingAdmission());

    expect(moved.json).toMatchObject({ error: { code: "venue.time_zone_not_ready" } });
    expect(await before(id, tableId)).toEqual(was);
  });
});

it("refuses to switch a Counter order holding money to takeaway, so a switch never changes its total", async () => {
  const id = await counterOrder("Soup", "Hake");
  await cashContribution(venue, id, "20.00");
  const [order] = await venue.db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));

  await expect(
    inTx(venue, (tx) =>
      switchOrderDining(tx, id, "takeaway", order!.revision, {
        operatorId: OPERATOR,
        expectedEdit: null,
      }),
    ),
  ).rejects.toMatchObject({ code: "order.dining_locked", params: { reason: "paid" } });

  expect(await totalOf(id)).toBe("22.00");
});
