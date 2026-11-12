import { randomUUID } from "node:crypto";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, deviceProfilePrinters, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { freePorts } from "./testing/free-ports.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

let venue: PartyVenue;
let server: ServerType | undefined;
let origin: string;
let sessionCookie: string;
let deviceCookie: string;
let otherDeviceCookie: string;

afterAll(async () => {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

beforeAll(async () => {
  venue = await setupPartyVenue(suite.db);
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: venue.cfg.locale,
      workforceEnabled: true,
      cardProvider: new SimulatorPaymentProvider(suite.db),
    },
    () => {},
  );
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Order profile", formFactor: "till", capabilities: [...CAPABILITY_FLAGS] })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Order till",
    profileId: profile!.id,
  });
  const other = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Other till",
    profileId: profile!.id,
  });
  deviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  otherDeviceCookie = `${DEVICE_COOKIE}=${other.deviceId}.${other.token}`;
  await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Device proof printer",
      transport: "network_tcp",
      host: "127.0.0.1",
      hasCashDrawer: true,
    });
    await tx.insert(deviceProfilePrinters).values(
      (["receipt", "payment_slip", "cash_drawer"] as const).map((role) => ({
        deviceProfileId: profile!.id,
        printerId: printer.id,
        role,
        position: 0,
        isDefault: true,
      })),
    );
  });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Order administrator", role: "admin", pinHash: hashPin("5555") })
    .returning({ id: persons.id });
  const [port] = await freePorts(1);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: port! }, () => resolve());
  });
  origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: person!.id, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  await login.arrayBuffer();
}, 120_000);

async function place(cookie: string, id: string): Promise<Response> {
  return fetch(`${origin}/api/working-orders`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      id,
      zoneId: venue.counter.zoneId,
      lines: [{ menuItemId: venue.counterItem("Burger"), quantity: "1" }],
    }),
  });
}

describe("till action device proof over HTTP", () => {
  it("keeps session-only order reads available without a device cookie", async () => {
    const answer = await fetch(`${origin}/api/working-orders`, {
      headers: { cookie: sessionCookie },
    });
    expect(answer.status).toBe(200);
    await answer.arrayBuffer();
  });

  it("serves a real PIN session with its matching enrolled device", async () => {
    const id = randomUUID();
    const answer = await place(`${sessionCookie}; ${deviceCookie}`, id);
    expect(answer.status).toBe(200);
    await answer.arrayBuffer();
    expect(
      await suite.db.all<{ id: string }>(sql`select id from working_orders where id = ${id}`),
    ).toEqual([{ id }]);
  });

  it.each(["missing", "malformed", "other-device", "wrong-token"] as const)(
    "refuses %s device proof before creating an order",
    async (kind) => {
      const id = randomUUID();
      const cookies = {
        missing: sessionCookie,
        malformed: `${sessionCookie}; ${DEVICE_COOKIE}=invalid`,
        "other-device": `${sessionCookie}; ${otherDeviceCookie}`,
        "wrong-token": `${sessionCookie}; ${deviceCookie.slice(0, deviceCookie.lastIndexOf(".") + 1)}wrong`,
      };
      const cookie = cookies[kind];
      const answer = await place(cookie, id);
      const body = (await answer.json()) as { error?: { code: string } };
      expect({ status: answer.status, code: body.error?.code }).toEqual({
        status: 401,
        code: "device.unauthorized",
      });
      expect(
        await suite.db.all<{ id: string }>(sql`select id from working_orders where id = ${id}`),
      ).toEqual([]);
    },
  );
});

type PaymentRoute = "sale" | "reader" | "collect" | "bill-cash" | "bill-manual" | "bill-reader";

async function paymentRequest(kind: PaymentRoute) {
  const id = randomUUID();
  const lines = [{ menuItemId: venue.counterItem("Burger"), quantity: "1" }];
  if (kind === "sale")
    return {
      id,
      path: "/api/sales",
      body: {
        workingOrderId: id,
        expectedEdit: null,
        zoneId: venue.counter.zoneId,
        lines,
        tender: { method: "cash", amount: "12.00" },
      },
    };
  if (kind === "reader")
    return {
      id,
      path: "/api/pay",
      body: {
        id,
        expectedEdit: null,
        zoneId: venue.counter.zoneId,
        lines,
        simulationOutcome: "captured",
      },
    };
  const order = await place(`${sessionCookie}; ${deviceCookie}`, id);
  expect(order.status).toBe(200);
  await order.arrayBuffer();
  if (kind === "collect") {
    const placed = await post(
      `/api/working-orders/${id}/place`,
      `${sessionCookie}; ${deviceCookie}`,
      { expectedEdit: null },
    );
    expect(placed.status).toBe(200);
    await placed.arrayBuffer();
    return {
      id,
      path: `/api/working-orders/${id}/collect`,
      body: {
        expectedEdit: null,
        tender: { method: "cash", amount: "12.00" },
      },
    };
  }
  return {
    id,
    path: `/api/working-orders/${id}/payments`,
    body: {
      expectedEdit: null,
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "12.00",
      applied: "12.00",
      tip: "0.00",
      ...(kind === "bill-cash"
        ? { method: "cash", tendered: "12.00" }
        : {
            method: "card",
            entry: kind === "bill-manual" ? "manual" : "reader",
          }),
    },
  };
}

const paymentRoutes: PaymentRoute[] = [
  "sale",
  "reader",
  "collect",
  "bill-cash",
  "bill-manual",
  "bill-reader",
];

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("till payment device proof over HTTP", () => {
  it.each(paymentRoutes)("refuses %s without request device proof", async (kind) => {
    const request = await paymentRequest(kind);
    const answer = await post(request.path, sessionCookie, request.body);
    const body = (await answer.json()) as { error?: { code: string } };
    expect({ status: answer.status, code: body.error?.code }).toEqual({
      status: 401,
      code: "device.unauthorized",
    });
    expect(
      await suite.db.all(sql`select id from sales where working_order_id = ${request.id}`),
    ).toEqual([]);
    expect(
      await suite.db.all(sql`select id from bill_payments where working_order_id = ${request.id}`),
    ).toEqual([]);
  });

  it.each(paymentRoutes)("serves %s with the matching enrolled device", async (kind) => {
    const request = await paymentRequest(kind);
    const answer = await post(request.path, `${sessionCookie}; ${deviceCookie}`, request.body);
    const body = (await answer.json()) as { error?: unknown; outcome?: string };
    expect({ status: answer.status, error: body.error }).toEqual({ status: 200, error: undefined });
    if (kind === "reader") expect(body.outcome).toBe("captured");
    expect(
      await suite.db.all(sql`select total from sales where working_order_id = ${request.id}`),
    ).toEqual([{ total: 1200 }]);
  });
});

type RefundRoute = "bill-refund" | "tender-refund" | "tender-retry";
async function refundRequest(kind: RefundRoute) {
  if (kind === "bill-refund") {
    const payment = await paymentRequest("bill-cash");
    const answer = await post(payment.path, `${sessionCookie}; ${deviceCookie}`, {
      ...payment.body,
      amount: "6.00",
      applied: "6.00",
      tendered: "6.00",
    });
    const body = (await answer.json()) as { payment: { id: string } };
    expect(answer.status).toBe(200);
    return {
      path: `${payment.path}/${body.payment.id}/refunds`,
      body: {
        submissionId: randomUUID(),
        appliedAmount: "2.00",
        tipAmount: "0.00",
        reason: "Guest request",
      },
    };
  }
  const payment = await paymentRequest("sale");
  const answer = await post(payment.path, `${sessionCookie}; ${deviceCookie}`, payment.body);
  expect(answer.status).toBe(200);
  await answer.arrayBuffer();
  const [tender] = await suite.db.all<{ tenderId: string; saleId: string }>(sql`
    select t.id as tenderId, t.sale_id as saleId from tenders t
    join sales s on s.id = t.sale_id where s.working_order_id = ${payment.id}`);
  const request = {
    path: `/api/transactions/${tender!.saleId}/refunds`,
    body: {
      submissionId: randomUUID(),
      tenderId: tender!.tenderId,
      appliedAmount: "2.00",
      tipAmount: "0.00",
      reason: "Guest request",
    },
  };
  if (kind === "tender-refund") return request;
  const refunded = await post(request.path, `${sessionCookie}; ${deviceCookie}`, request.body);
  const result = (await refunded.json()) as { id: string; state: string };
  expect({ status: refunded.status, state: result.state }).toEqual({
    status: 200,
    state: "completed",
  });
  return { path: `/api/tender-refunds/${result.id}/retry`, body: {} };
}

const refundRoutes: RefundRoute[] = ["bill-refund", "tender-refund", "tender-retry"];
function refundEffects() {
  return {
    billRefunds: suite.db.all(sql`select * from bill_payment_refunds order by id`),
    tenderRefunds: suite.db.all(sql`select * from tender_refunds order by id`),
    drawers: suite.db.all(sql`select * from drawer_opens order by id`),
    prints: suite.db.all(sql`select * from print_jobs order by id`),
  };
}

describe("till refund device proof over HTTP", () => {
  it.each(refundRoutes)("refuses %s without device proof", async (kind) => {
    const request = await refundRequest(kind);
    const before = refundEffects();
    const answer = await post(request.path, sessionCookie, request.body);
    const body = (await answer.json()) as { error?: { code: string } };
    expect({ status: answer.status, code: body.error?.code }).toEqual({
      status: 401,
      code: "device.unauthorized",
    });
    expect(refundEffects()).toEqual(before);
  });

  it.each(refundRoutes)("serves %s with the matching enrolled device", async (kind) => {
    const request = await refundRequest(kind);
    const answer = await post(request.path, `${sessionCookie}; ${deviceCookie}`, request.body);
    const body = (await answer.json()) as { error?: unknown; state?: string };
    expect({ status: answer.status, error: body.error }).toEqual({ status: 200, error: undefined });
    if (kind !== "bill-refund") expect(body.state).toBe("completed");
  });
});

type DocumentRoute =
  | "bill-slip-copy"
  | "receipt"
  | "payment-slip"
  | "reprint"
  | "transaction-reprint"
  | "refund-reprint"
  | "drawer";
const documentRoutes: DocumentRoute[] = [
  "bill-slip-copy",
  "receipt",
  "payment-slip",
  "reprint",
  "transaction-reprint",
  "refund-reprint",
  "drawer",
];
async function documentRequest(kind: DocumentRoute) {
  if (kind === "drawer") return { path: "/api/drawer/open", body: {} };
  if (kind === "refund-reprint") {
    const refund = await refundRequest("tender-refund");
    const answer = await post(refund.path, `${sessionCookie}; ${deviceCookie}`, refund.body);
    const body = (await answer.json()) as { id: string };
    expect(answer.status).toBe(200);
    return { path: `/api/tender-refunds/${body.id}/reprint`, body: {} };
  }
  if (kind === "bill-slip-copy") {
    const request = await paymentRequest("bill-reader");
    const response = await post(request.path, `${sessionCookie}; ${deviceCookie}`, request.body);
    const result = (await response.json()) as { payment: { id: string } };
    expect(response.status).toBe(200);
    return {
      path: `/api/working-orders/${request.id}/payments/${result.payment.id}/slip-copy`,
      body: {},
    };
  }
  const payment = await paymentRequest(kind === "payment-slip" ? "reader" : "sale");
  const answer = await post(payment.path, `${sessionCookie}; ${deviceCookie}`, payment.body);
  expect(answer.status).toBe(200);
  await answer.arrayBuffer();
  if (kind === "transaction-reprint") {
    const [sale] = await suite.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${payment.id}`,
    );
    return { path: `/api/transactions/${sale!.id}/reprint`, body: {} };
  }
  return { path: `/api/sales/${payment.id}/${kind}`, body: {} };
}

describe("till document and drawer device proof over HTTP", () => {
  it.each(documentRoutes)("refuses %s without device proof", async (kind) => {
    const request = await documentRequest(kind);
    const before = refundEffects();
    const answer = await post(request.path, sessionCookie, request.body);
    expect(answer.status).toBe(401);
    const body = (await answer.json()) as { error?: { code: string } };
    expect({ status: answer.status, code: body.error?.code }).toEqual({
      status: 401,
      code: "device.unauthorized",
    });
    expect(refundEffects()).toEqual(before);
  });

  it.each(documentRoutes)("serves %s with the matching enrolled device", async (kind) => {
    const request = await documentRequest(kind);
    const before = refundEffects();
    const answer = await post(request.path, `${sessionCookie}; ${deviceCookie}`, request.body);
    const body = await answer.text();
    expect({ status: answer.status, body }).toEqual({ status: 200, body: "" });
    const after = refundEffects();
    if (kind === "drawer") {
      expect(after.drawers).toHaveLength(before.drawers.length + 1);
      expect(after.prints).toHaveLength(before.prints.length + 1);
    } else {
      expect(after.drawers).toEqual(before.drawers);
      if (kind !== "receipt") expect(after.prints).toHaveLength(before.prints.length + 1);
    }
  });
});

const actionRoutes = [
  ["GET", "/api/clock/state", 403],
  ["POST", "/api/clock/in", 403],
  ["POST", "/api/clock/out", 403],
  ["POST", "/api/clock/break-start", 403],
  ["POST", "/api/clock/break-end", 403],
  ["GET", "/api/attendance/hours", 403],
  ["GET", "/api/attendance/inbox", 403],
  ["GET", "/api/attendance/day", 403],
  ["GET", "/api/attendance/commands/:commandId", 403],
  ["GET", "/api/attendance/items/:itemId/approvers", 403],
  ["POST", "/api/attendance/commands", 403],
  ["POST", "/api/parties/:id/drafts/:did/discard", 401],
  ["POST", "/api/working-orders/:id/adjustments", 401],
  ["GET", "/api/parties/:id/lines/:lineId/cancellation", 401],
  ["POST", "/api/parties/:id/lines/:lineId/cancel-item", 401],
  ["POST", "/api/parties/:id/unpaid-departure", 401],
  ["GET", "/api/working-orders/:id/kitchen-note", 401],
  ["PUT", "/api/working-orders/:id/kitchen-note", 401],
  ["GET", "/api/parties/:id/kitchen-note", 401],
  ["PUT", "/api/parties/:id/kitchen-note", 401],
  ["GET", "/api/parties/:id/allergy", 401],
  ["PUT", "/api/parties/:id/allergy", 401],
  ["POST", "/api/parties/:id/allergy/send-preview", 401],
  ["GET", "/api/department-transfers/destinations", 401],
  ["GET", "/api/department-transfers/incoming", 401],
  ["GET", "/api/working-orders/:id/department-transfers", 401],
  ["GET", "/api/department-transfers/sent", 401],
  ["GET", "/api/department-transfers/:id", 401],
  ["POST", "/api/working-orders/:id/department-transfers", 401],
  ["POST", "/api/department-transfers/:id/withdraw", 401],
  ["POST", "/api/department-transfers/:id/accept", 401],
  ["POST", "/api/department-transfers/:id/decline", 401],
  ["POST", "/api/tables/:id/today/move", 401],
  ["POST", "/api/tables/:id/today/rotate", 401],
  ["POST", "/api/tables/:id/today/take-off", 401],
  ["POST", "/api/tables/:id/today/put-back", 401],
  ["POST", "/api/tables/:id/today/place", 401],
  ["POST", "/api/tables/:id/today/seats", 401],
  ["POST", "/api/tables/:id/today/back", 401],
  ["POST", "/api/tables/:id/today/mark-moved", 401],
  ["POST", "/api/tables/:id/today/leave-here", 401],
  ["POST", "/api/tables/:id/today/name", 401],
  ["POST", "/api/tables/:id/today/merge", 401],
  ["POST", "/api/tables/:id/today/split-off", 401],
  ["POST", "/api/tables/:id/today/reset", 401],
  ["POST", "/api/zones/:id/today/reset", 401],
  ["POST", "/api/zones/:id/today/update-layout", 401],
  ["POST", "/api/working-orders", 401],
  ["PUT", "/api/working-orders/:id", 401],
  ["PUT", "/api/working-orders/:id/label", 401],
  ["PUT", "/api/working-orders/:id/invoice-choice", 401],
  ["PUT", "/api/working-orders/:id/receipt-language", 401],
  ["DELETE", "/api/working-orders/:id", 401],
  ["POST", "/api/working-orders/:id/place", 401],
  ["POST", "/api/working-orders/:id/prep", 401],
  ["POST", "/api/kitchen-notices/:id/acknowledge", 401],
  ["POST", "/api/ticket-items/:id/advance", 401],
  ["POST", "/api/orders/:id/stations/:sid/advance", 401],
  ["POST", "/api/orders/:id/courses/:courseId/ready", 401],
  ["POST", "/api/orders/:id/collect", 401],
  ["POST", "/api/orders/:id/reprint", 401],
  ["POST", "/api/working-orders/:id/cancel", 401],
  ["POST", "/api/tables/:id/seat", 401],
  ["POST", "/api/parties/:id/finish", 401],
  ["POST", "/api/parties/:id/bill-request", 401],
  ["POST", "/api/parties/:id/service-steps/:stepId/done", 401],
  ["PUT", "/api/parties/:id/name", 401],
  ["PUT", "/api/parties/:id/guests", 401],
  ["POST", "/api/parties/:id/move", 401],
  ["POST", "/api/parties/:id/join", 401],
  ["POST", "/api/parties/:id/split-table", 401],
  ["POST", "/api/parties/:id/bills", 401],
  ["POST", "/api/parties/:id/groups", 401],
  ["POST", "/api/parties/:id/groups/:gid/fire", 401],
  ["POST", "/api/parties/:id/served", 401],
  ["POST", "/api/parties/:id/unserved", 401],
  ["POST", "/api/parties/:id/groups/:gid/served", 401],
  ["POST", "/api/parties/:id/groups/:gid/snooze", 401],
  ["POST", "/api/parties/:id/groups/:gid/unsnooze", 401],
  ["PUT", "/api/parties/:id/groups/order", 401],
  ["POST", "/api/parties/:id/groups/fire-line", 401],
  ["POST", "/api/parties/:id/groups/split-line", 401],
  ["POST", "/api/parties/:id/groups/move", 401],
  ["PUT", "/api/parties/:id/drafts", 401],
  ["POST", "/api/parties/:id/drafts/:did/split", 401],
  ["POST", "/api/parties/:id/drafts/:did/take-over", 401],
  ["POST", "/api/parties/:id/drafts/:did/submit", 401],
  ["PUT", "/api/working-orders/:id/make-at", 401],
  ["POST", "/api/working-orders/:id/lines/move-station", 401],
  ["PUT", "/api/working-orders/:id/lines/:lineNo", 401],
  ["PATCH", "/api/working-orders/:id/lines/:lineNo/course", 401],
  ["POST", "/api/working-orders/:id/lines/send", 401],
  ["POST", "/api/bills/:id/move-dishes", 401],
  ["PUT", "/api/bills/:id/name", 401],
  ["POST", "/api/bills/:id/merge", 401],
  ["POST", "/api/bills/:id/move/allergy-preview", 401],
  ["POST", "/api/bills/:id/move", 401],
] as const;

describe("action route request device proof over HTTP", () => {
  it.each(actionRoutes)(
    "refuses %s %s without request device proof",
    async (method, template, status) => {
      const path = template.replace(/:[A-Za-z]+/g, randomUUID());
      const answer = await fetch(`${origin}${path}`, {
        method,
        headers: { "content-type": "application/json", cookie: sessionCookie },
        ...(method === "GET" ? {} : { body: JSON.stringify({ reason: "Guest request" }) }),
      });
      const body = (await answer.json()) as { error?: { code: string } };
      expect({ status: answer.status, code: body.error?.code }).toEqual({
        status,
        code: "device.unauthorized",
      });
    },
  );

  it.each(actionRoutes)(
    "admits %s %s to its next check with matching device proof",
    async (method, template) => {
      const path = template.replace(/:[A-Za-z]+/g, randomUUID());
      const answer = await fetch(`${origin}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          cookie: `${sessionCookie}; ${deviceCookie}`,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify({ reason: "Guest request" }) }),
      });
      const text = await answer.text();
      const body = text === "" ? null : (JSON.parse(text) as { error?: { code: string } } | null);
      expect(body?.error?.code).not.toBe("device.unauthorized");
      expect(answer.status).toBeLessThan(500);
    },
  );
});
