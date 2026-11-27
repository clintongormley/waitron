import { cancelItemHttp } from "./testing/cancel-line.js";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createDepartment, createServiceZone } from "@waitron/venue-service";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import type { PaymentProvider } from "@waitron/payments";
import { createTable } from "./testing/live-table.js";
import { fireDishesAtPayment } from "./till-sale.js";
import { mountTillApi } from "./till-api.js";
import { offerProducts } from "./testing/zone-offers.js";
import { provisionBillVenue, send as sendBillRequest } from "./testing/bill-venue.js";
import { parkOrder } from "./working-order-open.js";
import { readBillEditState } from "./bill-editing.js";
import { workingOrderLines, workingOrders } from "@waitron/db";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";
import {
  cfg,
  waterProduct,
  waterOfferId,
  sessionDeviceCookie,
  suite,
  collect,
  deps,
  openSession,
} from "./testing/till-api.test-support.js";

describe("reader bill payments", () => {
  it("refuses a malformed bill id before a reader payment", async () => {
    const token = await openSession(suite.db);
    const app = new Hono();
    // The route screen refuses the malformed id 400 before the empty stub provider is invoked.
    mountTillApi(app, { ...deps(suite.db), cardProvider: {} as PaymentProvider }, collect([]));

    const res = await app.request("/api/working-orders/not-a-uuid/payments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
      },
      body: JSON.stringify({
        dining: "eat_in",
        submissionId: randomUUID(),
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        basket: { lines: [{ menuItemId: waterOfferId, quantity: "1" }] },
      }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("malformed zone ids and simulation outcomes on the sale routes", () => {
  it("refuses a bill payment basket naming a malformed zone before writing it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const id = randomUUID();
    const res = await app.request(`/api/working-orders/${id}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
      },
      body: JSON.stringify({
        dining: "eat_in",
        kind: "share",
        shareOf: 1,
        method: "cash",
        tendered: "10.00",
        submissionId: id,
        basket: { lines: [{ menuItemId: waterOfferId, quantity: "1" }], zoneId: "not-a-zone" },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "ServiceZoneId", value: "not-a-zone" } },
    });
  });
});

describe("sale-policy order flow routes", () => {
  it.each([false, true])(
    "counter service refuses seating and stays in the counter list (zone override: %s)",
    async (zoneOverride) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
      const zone = await withTransaction(suite.db, async (tx) => {
        const department = await createDepartment(tx, {
          name: `Counter flow ${randomUUID()}`,
          orderStart: "table",
        });
        const zone = await createServiceZone(tx, {
          name: `Counter flow ${randomUUID()}`,
          departmentId: department.id,
        });
        await tx.execute(
          sql`update departments set order_start = ${zoneOverride ? "table" : "counter"} where id = (select department_id from floor_zones where id = ${zone.id})`,
        );
        await tx.execute(
          sql`update floor_zones set order_start = ${zoneOverride ? "counter" : null} where id = ${zone.id}`,
        );
        return zone;
      });
      const table = await withTransaction(suite.db, (tx) =>
        createTable(tx, { label: `Counter ${randomUUID()}`, zoneId: zone.id }),
      );
      const seated = await app.request(`/api/tables/${table.id}/seat`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(seated.status).toBe(409);
      expect(await seated.json()).toMatchObject({
        error: { code: "service_zone.mode_incompatible" },
      });
      const list = await app.request("/api/default-service-zone/offers", { headers: { cookie } });
      expect(list.status).toBe(200);
      expect(
        ((await list.json()) as { zones: { id: string; serviceMode: string }[] }).zones,
      ).toContainEqual(expect.objectContaining({ id: zone.id, serviceMode: "prepay" }));
    },
  );

  it.each([
    { start: "counter", paidWhen: "prepay", want: "prepay", sends: true },
    { start: "counter", paidWhen: "ticket_then_pay", want: "ticket_then_pay", sends: true },
    { start: "table", paidWhen: "prepay", want: "table_tab", sends: false },
  ] as const)(
    "parked $start / $paidWhen and the pay question agree that payment sends: $sends",
    async ({ start, paidWhen, want, sends }) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
      const zoneId = await withTransaction(suite.db, async (tx) => {
        const department = await createDepartment(tx, {
          name: `Pay flow ${randomUUID()}`,
          orderStart: "counter",
        });
        const zone = await createServiceZone(tx, {
          name: `Pay flow ${randomUUID()}`,
          departmentId: department.id,
        });
        await tx.execute(
          sql`update departments set order_start = ${start} where id = (select department_id from floor_zones where id = ${zone.id})`,
        );
        await tx.execute(
          sql`update floor_zones set order_start = null, paid_when = ${paidWhen} where id = ${zone.id}`,
        );
        await offerMenuThroughZone(tx, zone.id, waterProduct.menuId, {
          makeDefault: true,
        });
        return zone.id;
      });
      const id = randomUUID();
      const lines = [{ menuItemId: waterOfferId, quantity: "1" }];
      const question = await app.request("/api/dead-ends/sale", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ step: "pay", zoneId, lines }),
      });
      expect(question.status).toBe(200);
      expect(await question.json()).toMatchObject({ sends });
      const parked = await app.request("/api/working-orders", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ dining: "eat_in", id, zoneId, lines }),
      });
      expect(parked.status).toBe(200);
      expect(
        (await suite.db.execute(sql`select service_mode from working_orders where id = ${id}`))
          .rows,
      ).toEqual([{ service_mode: want }]);
      await withTransaction(suite.db, (tx) => fireDishesAtPayment(tx, cfg, id));
      expect(
        (
          await suite.db.execute(
            sql`select state from ticket_items where working_order_line_id in (select id from working_order_lines where working_order_id = ${id})`,
          )
        ).rows,
      ).toEqual(sends ? [{ state: "queued" }] : []);
    },
  );
});

describe("settling edit answers", () => {
  const edits = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  it.each(["held", "line"] as const)(
    "returns the invoice from a settling %s change",
    async (kind) => {
      const venue = await provisionBillVenue(edits.db);
      const id = randomUUID();
      const menuItemId =
        kind === "held"
          ? venue.offerFor("Red wine bottle")
          : await withTransaction(edits.db, async (tx) => {
              const menu = await createMenu(tx, { name: "Weighed dishes" });
              const category = await createCategory(tx, { name: "Fish dishes" });
              const product = await createProduct(tx, {
                categoryId: category.id,
                name: "Fish",
                pricingUnit: "each",
                unitPrice: "30.00",
              });
              await assignMenuToVenue(tx, menu.id);
              const offers = await offerProducts(tx, {
                zone: "tables",
                productIds: [product.id],
              });
              return offers.offerFor(product.id);
            });
      await parkOrder({ db: edits.db }, venue.cfg, {
        id,
        zoneId: venue.zoneId,
        operatorId: venue.operatorId,
        lines: [{ menuItemId, quantity: "2" }],
      });
      const expectedEdit = await withTransaction(edits.db, (tx) => readBillEditState(tx, id));
      const paid = await sendBillRequest(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "30.00",
          method: "cash",
          tendered: "30.00",
          applied: "30.00",
          tip: "0.00",
          expectedEdit,
        },
      );
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      const [line] = await edits.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      const [order] = await edits.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      const answer =
        kind === "line"
          ? await cancelItemHttp(edits.db, venue.app, venue.cookie, id, line!.lineNo, "1")
          : await sendBillRequest(venue.app, venue.cookie, "PUT", `/api/working-orders/${id}`, {
              dining: "eat_in",
              revision: order!.revision,
              expectedEdit,
              lines: [{ workingOrderLineId: line!.id, menuItemId, quantity: "1" }],
            });
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(answer.json).toMatchObject({
        revision: order!.revision + 1,
        invoice: { total: "30.00" },
      });
    },
  );
});
