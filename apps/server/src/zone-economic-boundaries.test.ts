import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { withTransaction, workingOrderLines, billPayments, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCategory, createProduct } from "@waitron/catalogue";
import { createPinThrottle, loginWithPin } from "@waitron/identity";
import { decimal, deviceOrigin, locationId } from "@waitron/shared";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { TradingAdmission } from "./trading-admission.js";
import { zoneRepairGate } from "./zone-repair-serving.js";
import { overridePinAttempts, mountTillApi } from "./till-api.js";
import {
  updateHeldOrder,
  updateOrderLine,
  parkOrder,
  priceForIssuance,
  issueUnpaidInvoice,
  cancelPlacedOrder,
  markOrderPlaced,
} from "./working-order.js";
import { splitBill } from "./bill-actions.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { recordUnpaidDeparture } from "./unpaid-departure.js";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab, fireAll } from "./testing/serve-line.js";
import { readBillEditState } from "./bill-editing.js";
import { recordTillSale } from "./till-sale.js";
import { issueIfFullyPaid } from "./bill-payments.js";

let venue: BillVenue;
let offer: string;
let tableOffer: string;
let ready: TradingAdmission;
const quiet = () => {};
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T23:30:00Z") });
    venue = await provisionBillVenue(db);
    ready = new TradingAdmission();
    ready.admit();
    offer = await withTransaction(db, async (tx) => {
      const category = await createCategory(tx, { name: "Zone boundary dishes" });
      const product = await createProduct(tx, {
        catalogueId: tx.all<{ id: string }>(sql`select id from catalogues limit 1`)[0]!.id,
        categoryId: category.id,
        name: "Boundary dish",
        customerName: { "en-GB": "Customer dish" },
        kitchenName: "Kitchen dish",
        vatClass: "general",
        pricingUnit: "each",
        unitPrice: decimal("12.10"),
      });
      const offers = await offerProducts(tx, venue.cfg, { productIds: [product.id] });
      tableOffer = (
        await offerProducts(tx, venue.cfg, {
          zone: { zoneId: venue.zoneId },
          orderStart: "table",
          productIds: [product.id],
        })
      ).offerFor(product.id);
      return offers.offerFor(product.id);
    });
  },
});
afterAll(() => vi.useRealTimers());
const closedStates = ["unchecked", "missing", "invalid", "restart_required"] as const;
function closed(state: (typeof closedStates)[number]) {
  const admission = new TradingAdmission();
  if (state === "restart_required") admission.requireRestart();
  else if (state !== "unchecked") admission.repairOnly(state);
  return admission;
}
function fiscal(admission: TradingAdmission) {
  return { ...venue, admission, log: quiet };
}
async function held() {
  const id: string = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    operatorId: venue.operatorId,
    lines: [{ menuItemId: offer, quantity: "2" }],
  });
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  return { id, line: line! };
}

async function tableBill() {
  return withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Boundary ${randomUUID()}`,
      zoneId: venue.zoneId,
    });
    const party = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      operatorId: venue.operatorId,
      lines: [{ menuItemId: tableOffer, quantity: "2" }],
    });
    await fireAll(tx, venue.cfg, party.tabId);
    return party;
  });
}
async function issued(id: string) {
  await withTransaction(venue.db, async (tx) => {
    await issueUnpaidInvoice(
      tx,
      venue.backend,
      venue.cfg,
      await priceForIssuance(tx, venue.clock, venue.backend, venue.cfg, id),
      venue.operatorId,
      ready,
    );
    await markOrderPlaced(tx, venue.clock, venue.cfg, id, venue.operatorId);
  });
}
async function received(id: string, amount: number) {
  await withTransaction(venue.db, async (tx) => {
    await fireAll(tx, venue.cfg, id);
    await tx.insert(billPayments).values({
      workingOrderId: id,
      submissionId: randomUUID(),
      fingerprint: "boundary-fixture",
      kind: "contribution",
      method: "cash",
      applied: amount,
      tendered: amount,
      state: "received",
      requestedBy: venue.operatorId,
      ...venue.cfg.origin,
      receivedAt: "2026-10-14T23:29:00.000Z",
    });
  });
}

function snapshot() {
  const tables = [
    "working_orders",
    "working_order_lines",
    "bill_payments",
    "payments",
    "sales",
    "tenders",
    "invoice_series",
    "registros_facturacion",
    "order_amendments",
    "unpaid_departures",
    "adjustments",
    "sale_settlements",
  ];
  return Object.fromEntries(
    tables.map((name) => [
      name,
      venue.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
}
async function operator() {
  const session = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
  );
  return {
    personId: venue.adminId,
    sessionId: session.id,
    token: session.token,
    attempts: overridePinAttempts(createPinThrottle(), venue.deviceId),
  };
}

describe("direct economic orchestration before startup admission", () => {
  for (const state of closedStates) {
    it.each([
      "save",
      "line",
      "split",
      "adjustment",
      "departure",
      "cancel",
      "auto-issue",
      "unpaid-issue",
      "credit",
    ] as const)(`${state} blocks %s before economic writes`, async (operation) => {
      let { id, line } = await held();
      let partyId = "";
      if (operation === "departure") {
        const table = await tableBill();
        id = table.tabId;
        partyId = table.partyId;
        line = (
          await venue.db
            .select()
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, id))
        )[0]!;
      }
      if (operation === "cancel" || operation === "credit") await issued(id);
      if (operation === "auto-issue") await received(id, 2420);
      const admission = closed(state);
      const deps = fiscal(admission);
      const authority = { admission, operatorId: venue.operatorId, expectedEdit: null };
      const actor = await operator();
      const command = {
        ...authority,
        submissionId: randomUUID(),
        expectedPartyRevision: 0,
        expectedRevision: 0,
        orderId: id,
        lineId: line.id,
        reasonId: venue.db.all<{ id: string }>(
          sql`select id from adjustment_reasons where kind = 'void' limit 1`,
        )[0]!.id,
        action: "cancel" as const,
        note: null,
      };
      const invoice = await withTransaction(venue.db, (tx) =>
        priceForIssuance(tx, venue.clock, venue.backend, venue.cfg, id),
      );
      const before = snapshot();
      const write = () => {
        if (operation === "save")
          return updateHeldOrder(deps, venue.cfg, id, {
            ...authority,
            revision: 0,
            lines: [{ workingOrderLineId: line.id, menuItemId: offer, quantity: "1" }],
          });
        if (operation === "cancel")
          return cancelPlacedOrder(deps, venue.cfg, id, "Guest request", actor);
        return withTransaction(venue.db, async (tx) => {
          if (operation === "line")
            return updateOrderLine(tx, venue.cfg, id, 1, { quantity: "1" }, 0, authority);
          if (operation === "split")
            return splitBill(tx, venue.cfg, id, [{ lineNo: 1, quantity: "1" }], {
              ...authority,
              expectedEdit: await readBillEditState(tx, id),
            });
          if (operation === "adjustment") return applyAdjustment(tx, venue.cfg, command, "en-GB");
          if (operation === "departure")
            return recordUnpaidDeparture(
              tx,
              deps,
              venue.cfg,
              partyId,
              {
                expectedPartyRevision: 0,
                expectedEdits: [await readBillEditState(tx, id)],
                reason: "Guest left",
              },
              actor,
            );
          if (operation === "auto-issue")
            return issueIfFullyPaid(tx, deps, venue.cfg, id, venue.operatorId);
          if (operation === "unpaid-issue")
            return issueUnpaidInvoice(
              tx,
              venue.backend,
              venue.cfg,
              invoice,
              venue.operatorId,
              admission,
            );
          return creditWholeInvoice(tx, deps, venue.cfg, (await readOrderInvoice(tx, id))!, {
            sessionId: actor.sessionId,
          });
        });
      };
      const outcome = await write().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      expect({ outcome, rows: snapshot() }).toEqual({
        outcome: {
          error: expect.objectContaining({
            code: "venue.time_zone_not_ready",
            params: { reason: state },
          }),
        },
        rows: before,
      });
    });
  }
});

it.each(closedStates)(
  "%s prevents route save and safe-verb mutations before terminal writes",
  async (state) => {
    const admission = closed(state);
    for (const [method, path] of [
      ["PUT", "/api/working-orders/example"],
      ["GET", "/management-api/future-write"],
      ["POST", "/api/bills/example/split"],
      ["POST", "/management-api/payments/resolve"],
    ]) {
      let writes = 0;
      const app = new Hono();
      app.use("*", zoneRepairGate(admission));
      app.all("*", (c) => {
        writes++;
        return c.json({ written: true });
      });
      const response = await app.request(path!, { method });
      expect({ status: response.status, writes }).toEqual({ status: 409, writes: 0 });
      expect(await response.json()).toEqual({
        error: { code: "venue.time_zone_not_ready", params: { reason: state } },
      });
      expect(writes).toBe(0);
    }
  },
);

it("an admitted direct issue uses the writing location's calendar and preserves old invoices", async () => {
  const { id } = await held();
  const reading = venue.clock.now();
  const clock = {
    ...venue.clock,
    now: () => ({ ...reading, instant: new Date("2026-10-14T23:30:00Z"), offsetMinutes: 0 }),
  };
  const before = venue.db.all(sql`select * from registros_facturacion order by rowid`);
  await withTransaction(venue.db, async (tx) => {
    const invoice = await priceForIssuance(tx, clock, venue.backend, venue.cfg, id);
    await issueUnpaidInvoice(tx, venue.backend, venue.cfg, invoice, venue.operatorId, ready);
  });
  const [sale] = venue.db.all(
    sql`select issued_offset_minutes, issued_at from sales where working_order_id = ${id}`,
  );
  expect(sale).toEqual({ issued_offset_minutes: 120, issued_at: "2026-10-14T23:30:00.000Z" });
  const after = venue.db.all(sql`select * from registros_facturacion order by rowid`);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
});

it("returns an authenticated settled replay without reading a current issue clock", async () => {
  const { id } = await held();
  const actor = await operator();
  const request = {
    workingOrderId: id,
    expectedEdit: null,
    lines: [],
    tender: { method: "cash" as const, amount: "24.20" },
  };
  const original = await recordTillSale(
    fiscal(ready),
    { ...venue.cfg, origin: deviceOrigin(venue.deviceId) },
    request,
    actor,
  );
  const before = snapshot();
  const deps = {
    ...fiscal(closed("invalid")),
    clock: {
      ...venue.clock,
      now: () => {
        throw new Error("replay acquired an issue clock");
      },
    },
  };
  expect(
    await recordTillSale(
      deps,
      { ...venue.cfg, origin: deviceOrigin(venue.deviceId) },
      request,
      actor,
    ),
  ).toEqual(original);
  await expect(
    recordTillSale(deps, { ...venue.cfg, origin: deviceOrigin(venue.deviceId) }, request, {
      ...actor,
      sessionId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "session.required" });
  expect(snapshot()).toEqual(before);
});

it.each(["save", "line", "split", "adjustment"] as const)(
  "the actual closed till route refuses %s and changes no economic rows",
  async (operation) => {
    const { id } = await held();
    const admission = closed("invalid");
    const app = new Hono();
    mountTillApi(
      app,
      {
        ...fiscal(admission),
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: "en-GB",
        pool: venue.pool,
      },
      quiet,
    );
    const expectedEdit = await withTransaction(venue.db, (tx) => readBillEditState(tx, id));
    const body =
      operation === "save"
        ? { revision: 0, expectedEdit, lines: [{ menuItemId: offer, quantity: "1" }] }
        : operation === "line"
          ? { revision: 0, expectedEdit, quantity: "1" }
          : operation === "split"
            ? { expectedEdit, transfers: [{ lineNo: 1, quantity: "1" }] }
            : {
                expectedEdit,
                expectedRevision: 0,
                submissionId: randomUUID(),
                lineId: null,
                action: "discount_percent",
                reasonId: randomUUID(),
                percentBp: 5000,
              };
    const method = operation === "save" || operation === "line" ? "PUT" : "POST";
    const path =
      operation === "save"
        ? `/api/working-orders/${id}`
        : operation === "line"
          ? `/api/working-orders/${id}/lines/1`
          : operation === "split"
            ? `/api/bills/${id}/split`
            : `/api/working-orders/${id}/adjustments`;
    const before = snapshot();
    const response = await app.request(path, {
      method,
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.time_zone_not_ready", params: { reason: "invalid" } },
    });
    expect(snapshot()).toEqual(before);
  },
);

it.each(["save", "line", "split", "adjustment", "auto-issue", "departure", "credit"] as const)(
  "%s dates one new fiscal record in the venue zone at night",
  async (operation) => {
    const { id: originalId, line } = await held();
    let id = originalId;
    const reading = venue.clock.now();
    const clock = {
      ...venue.clock,
      now: () => ({ ...reading, instant: new Date("2026-10-14T23:30:00Z"), offsetMinutes: 0 }),
    };
    const deps = { ...fiscal(ready), clock };
    let partyId = "";
    if (operation === "departure") {
      const party = await tableBill();
      id = party.tabId;
      partyId = party.partyId;
    } else if (operation === "credit") await issued(id);
    else await received(id, operation === "auto-issue" || operation === "line" ? 2420 : 1210);
    const actor = await operator();
    const before = venue.db.all(sql`select * from registros_facturacion order by rowid`);
    const authority = { admission: ready, operatorId: venue.adminId, expectedEdit: null };
    if (operation === "save") {
      await updateHeldOrder(
        deps,
        venue.cfg,
        id,
        {
          ...authority,
          revision: 0,
          lines: [{ workingOrderLineId: line.id, menuItemId: offer, quantity: "1" }],
        },
        { fiscal: deps, saleCfg: venue.cfg },
      );
    } else
      await withTransaction(venue.db, async (tx) => {
        if (operation === "departure") {
          await recordUnpaidDeparture(
            tx,
            deps,
            venue.cfg,
            partyId,
            {
              expectedPartyRevision: 0,
              expectedEdits: [await readBillEditState(tx, id)],
              reason: "Guest left",
            },
            actor,
          );
          return;
        }
        if (operation === "credit") {
          await creditWholeInvoice(tx, deps, venue.cfg, (await readOrderInvoice(tx, id))!, {
            sessionId: actor.sessionId,
          });
          return;
        }
        if (operation === "line")
          await updateOrderLine(tx, venue.cfg, id, 1, { note: "No salt" }, 0, authority);
        if (operation === "split")
          await splitBill(tx, venue.cfg, id, [{ lineNo: 1, quantity: "1" }], {
            ...authority,
            expectedEdit: await readBillEditState(tx, id),
          });
        if (operation === "adjustment")
          await applyAdjustment(
            tx,
            venue.cfg,
            {
              ...authority,
              submissionId: randomUUID(),
              orderId: id,
              expectedRevision: 0,
              lineId: line.id,
              reasonId: venue.db.all<{ id: string }>(
                sql`select id from adjustment_reasons where kind = 'void' limit 1`,
              )[0]!.id,
              action: "cancel",
              quantity: "1",
              note: null,
            },
            "en-GB",
          );
        await issueIfFullyPaid(tx, deps, venue.cfg, id, actor.personId);
      });
    const after = venue.db.all<{ fecha_expedicion_factura: string }>(
      sql`select * from registros_facturacion order by rowid`,
    );
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.fecha_expedicion_factura).toBe("2026-10-15");
    const [sale] = venue.db.all(
      sql`select issued_at, issued_offset_minutes from sales where id = (select sale_id from registros_facturacion order by rowid desc limit 1)`,
    );
    expect(sale).toEqual({ issued_at: "2026-10-14T23:30:00.000Z", issued_offset_minutes: 120 });
  },
);

it("refuses draft-save admission before attempting its first insert", async () => {
  const party = await tableBill();
  const app = new Hono();
  mountTillApi(
    app,
    {
      ...fiscal(closed("invalid")),
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: "en-GB",
      pool: venue.pool,
    },
    quiet,
  );
  const expectedEdit = await withTransaction(venue.db, (tx) => readBillEditState(tx, party.tabId));
  venue.db.run(
    sql`create trigger zone_admission_write_witness before insert on order_drafts begin select raise(abort, 'admission-write-witness'); end`,
  );
  try {
    const response = await app.request(`/api/parties/${party.partyId}/drafts`, {
      method: "PUT",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        personId: venue.operatorId,
        billId: party.tabId,
        draftId: null,
        revision: 0,
        expectedEdit,
        lines: [{ menuItemId: tableOffer, quantity: "1" }],
      }),
    });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 409,
      body: { error: { code: "venue.time_zone_not_ready", params: { reason: "invalid" } } },
    });
  } finally {
    venue.db.run(sql`drop trigger zone_admission_write_witness`);
  }
});

it.each([
  ["Europe/Madrid", "Invalid/Zone", true],
  ["Invalid/Zone", "Europe/Madrid", false],
] as const)(
  "a direct line edit checks node zone %s rather than unrelated config zone %s",
  async (nodeZone, configZone, accepted) => {
    const { id } = await held();
    const [other] = await venue.db
      .insert(locations)
      .values({
        name: "Unrelated configuration venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Restaurant service",
        timeZone: configZone,
      })
      .returning({ id: locations.id });
    const [saved] = await venue.db
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(eq(locations.id, venue.cfg.locationId));
    await venue.db
      .update(locations)
      .set({ timeZone: nodeZone })
      .where(eq(locations.id, venue.cfg.locationId));
    const before = snapshot();
    const cfg = { ...venue.cfg, locationId: locationId(other!.id) };
    const edit = () =>
      withTransaction(venue.db, (tx) =>
        updateOrderLine(tx, cfg, id, 1, { note: "No salt" }, 0, {
          admission: ready,
          operatorId: venue.operatorId,
          expectedEdit: null,
        }),
      );
    try {
      if (accepted) {
        expect(await edit()).toBe(1);
        const [changed] = await venue.db
          .select({ note: workingOrderLines.note })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id))
          .orderBy(workingOrderLines.lineNo);
        expect(changed).toEqual({ note: "No salt" });
      } else {
        await expect(edit()).rejects.toMatchObject({
          code: "venue.time_zone_invalid",
          params: { reason: "invalid" },
        });
        expect(snapshot()).toEqual(before);
      }
    } finally {
      await venue.db
        .update(locations)
        .set({ timeZone: saved!.timeZone })
        .where(eq(locations.id, venue.cfg.locationId));
      await venue.db.delete(locations).where(eq(locations.id, other!.id));
    }
  },
);
