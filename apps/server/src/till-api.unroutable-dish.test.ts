import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  floorZones,
  incidents,
  kitchenStations,
  sales,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/catalogue";
import { hashPin, persons } from "@waitron/identity";
import { SimulatorPaymentProvider, insertCapturedPayment, payments } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { createException } from "@waitron/venue-service";
import { takeBillPayment } from "./bill-payments.js";
import { DEVICE_COOKIE } from "./device-session.js";
import type { Logger } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { placeGroups } from "./order-groups.js";
import { payWorkingOrderIntegrated } from "./till-sale.js";
import { OPERATOR, inTx, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { markCollected, parkOrder } from "./working-order.js";

// A pay-first order, or an open counter order in a zone that sends before payment, is sent to the
// kitchen when it is paid. A dish no rule or active default station can take does not refuse the
// payment: the money is taken and filed, that dish is not sent, and one `route.dish_not_sent` alert per sale names it and the order
// — or, if the database refuses that alert, a log line under that code does.

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};

let v: PartyVenue;
let app: Hono;
let session: string;
let catalogueId: string;

async function enrolTill(): Promise<string> {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Till ${randomUUID()}`, formFactor: "till", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const dev = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Counter till ${randomUUID()}`,
    profileId: profile!.id,
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  await inTx(v, async (tx) =>
    tx.run(
      sql`update kitchen_stations set active = 0 where location_id = ${v.cfg.locationId} and is_default`,
    ),
  );
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    noopLog,
  );
  const operatorId = await inTx(v, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return person!.id;
  });
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await enrolTill() },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  session = login.headers.get("set-cookie")!;
  const [burger] = await inTx(v, (tx) =>
    tx
      .select({ catalogueId: products.catalogueId })
      .from(products)
      .where(eq(products.id, v.productId("Burger"))),
  );
  catalogueId = burger!.catalogueId;
});

async function station(name: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .insert(kitchenStations)
      .values({ locationId: v.cfg.locationId, name: `${name} ${randomUUID()}` })
      .returning({ id: kitchenStations.id }),
  );
  return row!.id;
}

async function switchOff(stationId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, stationId)),
  );
}

interface Dish {
  productId: string;
  /** The staff name; the customer-facing and kitchen names differ from it. */
  name: string;
  counterOffer: string;
  tablesOffer: string;
}

/** A new product with three different names, offered in both zones with no route of its own. */
async function dish(name: string): Promise<Dish> {
  return inTx(v, async (tx) => {
    const staffName = `${name} ${randomUUID().slice(0, 8)}`;
    const product = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: staffName,
      customerName: { [v.cfg.locale]: `Customer ${name}` },
      kitchenName: `KITCHEN ${name}`,
      pricingUnit: "each",
      unitPrice: "4.00",
      vatClass: "general",
    });
    const counter = await offerProducts(tx, v.cfg, {
      zone: "counter",
      productIds: [product.id],
    });
    const tables = await offerProducts(tx, v.cfg, {
      zone: "tables",
      productIds: [product.id],
    });
    return {
      productId: product.id,
      name: staffName,
      counterOffer: counter.offerFor(product.id),
      tablesOffer: tables.offerFor(product.id),
    };
  });
}

async function routeTo(productId: string, stationId: string, zoneId?: string): Promise<void> {
  await inTx(v, (tx) =>
    createException(tx, v.cfg, {
      productId,
      zoneId: zoneId ?? null,
      categoryId: null,
      target: { kind: "station", stationId },
    }),
  );
}

/** A dish whose only route's station is switched off. */
async function strandedDish(name: string): Promise<Dish> {
  const made = await dish(name);
  const closed = await station("Closed grill");
  await routeTo(made.productId, closed);
  await switchOff(closed);
  return made;
}

async function routedDish(name: string): Promise<{ dish: Dish; stationId: string }> {
  const made = await dish(name);
  const stationId = await station("Grill");
  await routeTo(made.productId, stationId);
  return { dish: made, stationId };
}

async function park(id: string, dishes: Dish[], label = "Mesa 3"): Promise<void> {
  const res = await app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify({
      id,
      lines: dishes.map((d) => ({ menuItemId: d.counterOffer, quantity: "1" })),
      label,
    }),
  });
  expect(res.status).toBe(200);
}

async function payCash(
  deviceCookie: string,
  workingOrderId: string,
  walkUpLines: Dish[] = [],
): Promise<Response> {
  return app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${session}; ${deviceCookie}` },
    body: JSON.stringify({
      workingOrderId,
      lines: walkUpLines.map((d) => ({ menuItemId: d.counterOffer, quantity: "1" })),
      tender: { method: "cash", amount: "50.00" },
    }),
  });
}

async function saleOf(workingOrderId: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, workingOrderId)),
  );
  return row!.id;
}

async function kitchenItems(workingOrderId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ productId: workingOrderLines.productId, stationId: ticketItems.stationId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, workingOrderId))
      .orderBy(workingOrderLines.lineNo),
  );
}

async function filedFor(workingOrderId: string): Promise<number> {
  const saleId = await saleOf(workingOrderId);
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from registros_facturacion where sale_id = ${saleId}`,
  );
  return Number(rows[0]!.n);
}

async function alertsFor(saleId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        code: incidents.code,
        tillId: incidents.tillId,
        params: incidents.params,
        severity: incidents.severity,
      })
      .from(incidents)
      .where(eq(incidents.saleId, saleId)),
  );
}

async function statusOf(workingOrderId: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, workingOrderId)),
  );
  return row!.status;
}

async function orderNumberOf(workingOrderId: string): Promise<number> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(eq(workingOrders.id, workingOrderId)),
  );
  return row!.orderNumber;
}

function dishNotSent(workingOrderId: string, dishes: string, orderNumber: number, label: unknown) {
  return {
    code: "route.dish_not_sent",
    severity: "error",
    params: {
      dishes,
      workingOrderId,
      orderNumber,
      orderLabel: label,
    },
  };
}

describe("paying a pay-first order, or an open counter order in a zone that sends before payment, whose dish no kitchen station can take", () => {
  it("alerts for a switched-off station instead of using a later matching rule", async () => {
    const made = await dish("Steak");
    const closed = await station("Closed grill");
    const open = await station("Kitchen");
    await routeTo(made.productId, closed, v.counter.zoneId);
    await routeTo(made.productId, open);
    await switchOff(closed);
    const id = randomUUID();
    await park(id, [made]);

    const res = await payCash(await enrolTill(), id);

    expect(res.status).toBe(200);
    expect(await kitchenItems(id)).toEqual([]);
    expect(await filedFor(id)).toBe(1);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Mesa 3")),
    ]);
  });

  it("takes a cash payment, files it, sends nothing for the dish and raises one alert naming it", async () => {
    const made = await strandedDish("Soup");
    const till = await enrolTill();
    const id = randomUUID();
    await park(id, [made]);

    const res = await payCash(till, id);

    expect(res.status).toBe(200);
    expect(await filedFor(id)).toBe(1);
    expect(await statusOf(id)).toBe("settled");
    expect(await kitchenItems(id)).toEqual([]);
    const saleId = await saleOf(id);
    const [saleTill] = await inTx(v, (tx) =>
      tx.select({ tillId: sales.tillId }).from(sales).where(eq(sales.id, saleId)),
    );
    const expected = dishNotSent(id, made.name, await orderNumberOf(id), "Mesa 3");
    expect(await alertsFor(saleId)).toEqual([{ ...expected, tillId: saleTill!.tillId }]);

    const replay = await payCash(till, id);
    expect(replay.status).toBe(200);
    expect(await filedFor(id)).toBe(1);
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(saleId)).toHaveLength(1);
  });

  it("does the same for a dish with no route at all", async () => {
    const made = await dish("Mystery");
    const id = randomUUID();
    await park(id, [made]);

    const res = await payCash(await enrolTill(), id);

    expect(res.status).toBe(200);
    expect(await filedFor(id)).toBe(1);
    expect(await statusOf(id)).toBe("settled");
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Mesa 3")),
    ]);
  });

  it("settles a paid order with no service zone and leaves its unroutable dish unstamped, with no zone in the alert", async () => {
    const made = await dish("Unzoned soup");
    const id = randomUUID();
    await park(id, [made]);
    await inTx(v, async (tx) =>
      tx.run(sql`delete from order_service_contexts where working_order_id = ${id}`),
    );
    const res = await payCash(await enrolTill(), id);
    expect(res.status).toBe(200);
    expect(await filedFor(id)).toBe(1);
    expect(await statusOf(id)).toBe("settled");
    expect(await kitchenItems(id)).toEqual([]);
    const [line] = await inTx(v, (tx) =>
      tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(line!.sentAt).toBeNull();
    const alerts = await alertsFor(await saleOf(id));
    expect(alerts).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Mesa 3")),
    ]);
    expect(alerts[0]!.params).not.toHaveProperty("zoneId");
    expect(alerts[0]!.params).not.toHaveProperty("zoneName");
  });

  it("does the same for a walk-up cash sale", async () => {
    const made = await strandedDish("Tortilla");
    const id = randomUUID();

    const res = await payCash(await enrolTill(), id, [made]);

    expect(res.status).toBe(200);
    expect(await filedFor(id)).toBe(1);
    expect(await statusOf(id)).toBe("settled");
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), null)),
    ]);
  });

  it("does the same for a counter order never sent in a zone that sends before payment, which then has nothing to hand over", async () => {
    const made = await strandedDish("Croqueta");
    const zoneId = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: `Barra ticket ${randomUUID()}` })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, v.cfg, {
          zone: { zoneId: zone!.id },
          serviceMode: "ticket_then_pay",
          productIds: [made.productId],
        })
      ).zoneId;
    });
    const id = randomUUID();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: made.counterOffer, quantity: "1" }],
      operatorId: OPERATOR,
    });

    const res = await payCash(await enrolTill(), id);

    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("settled");
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), null)),
    ]);
    await expect(markCollected({ db: suite.db }, v.cfg, id)).rejects.toMatchObject({
      code: "ticket.not_fired",
    });
  });

  it("sends the dishes a station can take and names only the others", async () => {
    const { dish: routed, stationId } = await routedDish("Salad");
    const stranded = await strandedDish("Paella");
    const missing = await dish("Crema");
    const id = randomUUID();
    await park(id, [stranded, routed, missing]);

    const res = await payCash(await enrolTill(), id);

    expect(res.status).toBe(200);
    expect(await kitchenItems(id)).toEqual([{ productId: routed.productId, stationId }]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(
        dishNotSent(id, `${stranded.name}, ${missing.name}`, await orderNumberOf(id), "Mesa 3"),
      ),
    ]);
  });

  it("raises a separate alert for each sale on one till", async () => {
    const made = await strandedDish("Gazpacho");
    const till = await enrolTill();
    const first = randomUUID();
    const second = randomUUID();
    await park(first, [made], "Uno");
    await park(second, [made], "Dos");

    expect((await payCash(till, first)).status).toBe(200);
    expect((await payCash(till, second)).status).toBe(200);

    const firstSale = await saleOf(first);
    const secondSale = await saleOf(second);
    const open = await inTx(v, (tx) =>
      tx
        .select({ saleId: incidents.saleId })
        .from(incidents)
        .where(
          sql`${incidents.code} = 'route.dish_not_sent' and ${incidents.saleId} in (${firstSale}, ${secondSale}) and ${incidents.acknowledgedAt} is null`,
        ),
    );
    expect(open.map((row) => row.saleId).sort()).toEqual([firstSale, secondSale].sort());
  });

  it("takes a bill payment that pays the order off, and raises the alert", async () => {
    const made = await strandedDish("Croquetas");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      lines: [{ menuItemId: made.counterOffer, quantity: "1" }],
      label: "Barra",
      zoneId: v.counter.zoneId,
    });

    await takeBillPayment(
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      id,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "4.00",
        method: "cash",
        tendered: "4.00",
        applied: "4.00",
        tip: "0.00",
      },
      OPERATOR,
    );

    expect(await statusOf(id)).toBe("settled");
    expect(await filedFor(id)).toBe(1);
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Barra")),
    ]);
  });

  it("takes a card-reader payment of a parked order, and raises the alert", async () => {
    const made = await strandedDish("Pimientos");
    const id = randomUUID();
    await park(id, [made], "Terraza");

    const out = await payWorkingOrderIntegrated(
      {
        db: suite.db,
        backend: v.backend,
        clock: v.clock,
        provider: new SimulatorPaymentProvider(suite.db),
      },
      v.cfg,
      { id, lines: [], simulationOutcome: "captured" },
    );

    expect(out.outcome).toBe("captured");
    expect(await statusOf(id)).toBe("settled");
    expect(await filedFor(id)).toBe(1);
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Terraza")),
    ]);
  });

  it("recovers a card payment captured before its sale was filed, and raises the alert", async () => {
    const made = await strandedDish("Boquerones");
    const id = randomUUID();
    await park(id, [made], "Barra");
    const provider = new SimulatorPaymentProvider(suite.db);
    await inTx(v, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: id,
        provider: provider.provider,
        paymentRef: `sim-${randomUUID()}`,
        amount: decimal("4.00"),
        settledAt: new Date(),
        externalRef: `sim-${randomUUID()}`,
      }),
    );

    const out = await payWorkingOrderIntegrated(
      { db: suite.db, backend: v.backend, clock: v.clock, provider },
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    expect(await statusOf(id)).toBe("settled");
    expect(await filedFor(id)).toBe(1);
    expect(await kitchenItems(id)).toEqual([]);
    expect(await alertsFor(await saleOf(id))).toEqual([
      expect.objectContaining(dishNotSent(id, made.name, await orderNumberOf(id), "Barra")),
    ]);
  });

  it("names a dish whose staff name is blank by its id", async () => {
    const made = await strandedDish("Nameless");
    await inTx(v, (tx) =>
      tx.update(products).set({ name: "" }).where(eq(products.id, made.productId)),
    );
    const id = randomUUID();
    await park(id, [made]);

    expect((await payCash(await enrolTill(), id)).status).toBe(200);

    const [alert] = await alertsFor(await saleOf(id));
    expect(alert!.params).toMatchObject({ dishes: made.productId });
  });

  describe("when the alert cannot be written", () => {
    /**
     * Runs `pay` while a trigger runs `body` on every `route.dish_not_sent` incident. The default
     * refuses the insert with `raise(abort)`, which backs out that statement alone.
     */
    async function withAlertRefused<T>(
      pay: () => Promise<T>,
      body = "select raise(abort, 'alert refused')",
    ): Promise<T> {
      await suite.db.execute(
        sql.raw(`
          create trigger refuse_dish_not_sent before insert on incidents
          when new.code = 'route.dish_not_sent'
          begin ${body}; end
        `),
      );
      try {
        return await pay();
      } finally {
        await suite.db.execute(sql`drop trigger refuse_dish_not_sent`);
      }
    }

    async function expectSettledWithoutAlert(workingOrderId: string): Promise<void> {
      expect(await statusOf(workingOrderId)).toBe("settled");
      expect(await filedFor(workingOrderId)).toBe(1);
      expect(await kitchenItems(workingOrderId)).toEqual([]);
      expect(await alertsFor(await saleOf(workingOrderId))).toEqual([]);
    }

    async function filedTotal(): Promise<number> {
      const { rows } = await suite.db.execute<{ n: number }>(
        sql`select count(*) as n from registros_facturacion`,
      );
      return Number(rows[0]!.n);
    }

    async function expectNothingSold(workingOrderId: string, filedBefore: number): Promise<void> {
      expect(await statusOf(workingOrderId)).toBe("open");
      const sold = await inTx(v, (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, workingOrderId)),
      );
      expect(sold).toEqual([]);
      expect(await filedTotal()).toBe(filedBefore);
      expect(await kitchenItems(workingOrderId)).toEqual([]);
    }

    async function paymentSaleIds(workingOrderId: string) {
      return inTx(v, (tx) =>
        tx
          .select({ state: payments.state, saleId: payments.saleId })
          .from(payments)
          .where(eq(payments.workingOrderId, workingOrderId)),
      );
    }

    it("still takes and files a cash payment", async () => {
      const made = await strandedDish("Refused cash");
      const till = await enrolTill();
      const id = randomUUID();
      await park(id, [made]);

      const res = await withAlertRefused(() => payCash(till, id));

      expect(res.status).toBe(200);
      await expectSettledWithoutAlert(id);
    });

    it("refuses a cash payment when writing the alert ends the transaction", async () => {
      const made = await strandedDish("Rolled back cash");
      const till = await enrolTill();
      const id = randomUUID();
      await park(id, [made]);
      const filedBefore = await filedTotal();

      const res = await withAlertRefused(
        () => payCash(till, id),
        "select raise(rollback, 'alert refused')",
      );

      expect(res.status).toBe(500);
      await expectNothingSold(id, filedBefore);
    });

    it("refuses a cash payment when the alert fails for a reason other than a refusal", async () => {
      const made = await strandedDish("Broken alert cash");
      const till = await enrolTill();
      const id = randomUUID();
      await park(id, [made]);
      const filedBefore = await filedTotal();

      // Naming a missing table fails when the trigger fires, and is not a refusal.
      const res = await withAlertRefused(
        () => payCash(till, id),
        "insert into no_such_table values (1)",
      );

      expect(res.status).toBe(500);
      await expectNothingSold(id, filedBefore);
    });

    it("still records a card-reader capture against its sale, and logs the failure", async () => {
      const made = await strandedDish("Refused card");
      const id = randomUUID();
      await park(id, [made]);
      const log = vi.fn<Logger>();

      const out = await withAlertRefused(() =>
        payWorkingOrderIntegrated(
          {
            db: suite.db,
            backend: v.backend,
            clock: v.clock,
            log,
            provider: new SimulatorPaymentProvider(suite.db),
          },
          v.cfg,
          { id, lines: [], simulationOutcome: "captured" },
        ),
      );

      expect(out.outcome).toBe("captured");
      await expectSettledWithoutAlert(id);
      expect(await paymentSaleIds(id)).toEqual([{ state: "captured", saleId: await saleOf(id) }]);
      expect(log).toHaveBeenCalledWith(
        "error",
        "route.dish_not_sent",
        expect.objectContaining({
          workingOrderId: id,
          saleId: await saleOf(id),
          productIds: [made.productId],
          error: expect.stringContaining("alert refused"),
        }),
      );
    });

    it("still recovers a card payment captured before its sale was filed", async () => {
      const made = await strandedDish("Refused recovery");
      const id = randomUUID();
      await park(id, [made], "Barra");
      const provider = new SimulatorPaymentProvider(suite.db);
      await inTx(v, (tx) =>
        insertCapturedPayment(tx, {
          workingOrderId: id,
          provider: provider.provider,
          paymentRef: `sim-${randomUUID()}`,
          amount: decimal("4.00"),
          settledAt: new Date(),
          externalRef: `sim-${randomUUID()}`,
        }),
      );

      const out = await withAlertRefused(() =>
        payWorkingOrderIntegrated(
          { db: suite.db, backend: v.backend, clock: v.clock, provider },
          v.cfg,
          { id, lines: [] },
        ),
      );

      expect(out.outcome).toBe("captured");
      await expectSettledWithoutAlert(id);
      expect(await paymentSaleIds(id)).toEqual([{ state: "captured", saleId: await saleOf(id) }]);
    });

    it("still takes a bill payment that pays the order off", async () => {
      const made = await strandedDish("Refused bill");
      const id = randomUUID();
      await parkOrder({ db: suite.db }, v.cfg, {
        id,
        lines: [{ menuItemId: made.counterOffer, quantity: "1" }],
        label: "Barra",
        zoneId: v.counter.zoneId,
      });

      await withAlertRefused(() =>
        takeBillPayment(
          { db: v.db, backend: v.backend, clock: v.clock },
          v.cfg,
          id,
          {
            submissionId: randomUUID(),
            kind: "contribution",
            amount: "4.00",
            method: "cash",
            tendered: "4.00",
            applied: "4.00",
            tip: "0.00",
          },
          OPERATOR,
        ),
      );

      await expectSettledWithoutAlert(id);
    });
  });

  it("still refuses a table round with a dish no station can take", async () => {
    const stranded = await strandedDish("Pulpo");
    const missing = await dish("Navajas");
    const { partyId } = await seat(v, await v.table(`T-${randomUUID().slice(0, 8)}`));
    const round = (d: Dish) =>
      inTx(v, (tx) =>
        placeGroups(tx, v.cfg, partyId, {
          groups: [{ lines: [{ menuItemId: d.tablesOffer, quantity: "1" }], release: "fire" }],
          operatorId: OPERATOR,
        }),
      );

    await expect(round(stranded)).rejects.toMatchObject({ code: "station.no_replacement" });
    await expect(round(missing)).rejects.toMatchObject({ code: "station.no_default" });
  });
});
