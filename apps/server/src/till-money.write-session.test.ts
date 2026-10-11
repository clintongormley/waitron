import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devices, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { jobOrigin } from "@waitron/shared";
import { resumeCardRefund } from "./bill-refunds.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { loginWithPin, sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder, placeOrder } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let offerId: string;
let cookie: string;
let sessionId: string;
const controlId = randomUUID();
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await withTransaction(db, (tx) => offerProducts(tx, venue.cfg));
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, "Ensalada"));
    offerId = counter.offerFor(product!.id);
    await parkOrder({ db }, venue.cfg, {
      id: controlId,
      zoneId: counter.zoneId,
      lines: [{ menuItemId: offerId, quantity: "1" }],
    });
  },
});
afterEach(() => yieldTurn());
beforeEach(async () => {
  await suite.db
    .update(devices)
    .set({ active: true, deletedAt: null })
    .where(eq(devices.id, venue.deviceId));
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    }),
  );
  sessionId = session.id;
  cookie = venue.cookie.replace(
    /waitron_till_session=[^;]+/,
    `waitron_till_session=${session.token}`,
  );
});

const lines = () => [{ menuItemId: offerId, quantity: "1" }];
const cash = { method: "cash", amount: "12.00" };
type Path = "counter sale" | "integrated pay" | "collection" | "refund";

async function requestFor(path: Path, cardRefund = false) {
  const id = randomUUID();
  if (path === "counter sale")
    return {
      id,
      path: "/api/sales",
      body: { workingOrderId: id, zoneId: counter.zoneId, lines: lines(), tender: cash },
    };
  if (path === "integrated pay")
    return { id, path: "/api/pay", body: { id, zoneId: counter.zoneId, lines: lines() } };
  if (path === "collection") {
    const deps = { db: suite.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, { id, zoneId: counter.zoneId, lines: lines() });
    await placeOrder(deps, venue.cfg, id, venue.adminId);
    return { id, path: `/api/working-orders/${id}/collect`, body: { tender: cash } };
  }
  const billId = await tabWith(venue, "Ensalada");
  const paid = await send(venue.app, cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "0.50",
    applied: "0.50",
    tip: "0.00",
    method: cardRefund ? "card" : "cash",
    ...(cardRefund ? { entry: "reader" } : { tendered: "0.50" }),
  });
  expect(paid.status).toBe(200);
  const payment = paid.json.payment as { id: string };
  return {
    id: billId,
    path: `/api/working-orders/${billId}/payments/${payment.id}/refunds`,
    body: {
      submissionId: randomUUID(),
      appliedAmount: "0.50",
      tipAmount: "0.00",
      reason: "Correction",
    },
  };
}

function contentHash(rows: unknown) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function effects(id: string) {
  return {
    orders: suite.db.all(sql`select * from working_orders where id = ${id}`),
    lines: suite.db.all(sql`select * from working_order_lines where working_order_id = ${id}`),
    sales: suite.db.all(sql`select * from sales where working_order_id = ${id}`),
    payments: suite.db.all(sql`select * from payments where working_order_id = ${id}`),
    billPayments: suite.db.all(sql`select * from bill_payments where working_order_id = ${id}`),
    refunds: suite.db.all(
      sql`select * from bill_payment_refunds where bill_payment_id in (select id from bill_payments where working_order_id = ${id})`,
    ),
    tenders: suite.db.all(
      sql`select * from tenders where sale_id in (select id from sales where working_order_id = ${id})`,
    ),
    series: suite.db.all(sql`select id, next_number from invoice_series order by id`),
    settlements: suite.db.all(
      sql`select * from sale_settlements where sale_id in (select id from sales where working_order_id = ${id})`,
    ),
    fiscal: contentHash(suite.db.all(sql`select * from registros_facturacion order by id`)),
    outbox: suite.db.all(sql`select * from envios order by registro_id`),
    chains: suite.db.all(sql`select * from cadenas order by node_id`),
    controlOrder: suite.db.all(sql`select * from working_orders where id = ${controlId}`),
    controlLines: suite.db.all(
      sql`select * from working_order_lines where working_order_id = ${controlId}`,
    ),
    jobs: contentHash(suite.db.all(sql`select * from print_jobs order by id`)),
    drawers: suite.db.all(sql`select * from drawer_opens order by id`),
  };
}

async function pausedRequest(request: Awaited<ReturnType<typeof requestFor>>) {
  let reached!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reached();
        await hold;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(request.body)));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const response = venue.app.request(
    new Request(`http://localhost${request.path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: string }),
  );
  await reading;
  return { response, release };
}

const changes = [
  "switched off",
  "signed out",
  "deleted",
  "wrong person",
  "other device",
  "missing session",
] as const;
type Revocation = (typeof changes)[number];
function refusalFor(change: Revocation) {
  return change === "switched off" || change === "deleted"
    ? "device.unauthorized"
    : "session.required";
}
async function revoke(change: Revocation) {
  if (change === "missing session")
    await suite.db.delete(sessions).where(eq(sessions.id, sessionId));
  else if (change === "wrong person")
    await suite.db
      .update(sessions)
      .set({ personId: venue.operatorId })
      .where(eq(sessions.id, sessionId));
  else if (change === "other device")
    await suite.db
      .update(sessions)
      .set({ deviceId: venue.device2Id })
      .where(eq(sessions.id, sessionId));
  else if (change === "signed out")
    await suite.db
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
  else
    await suite.db
      .update(devices)
      .set(change === "deleted" ? { deletedAt: new Date().toISOString() } : { active: false })
      .where(eq(devices.id, venue.deviceId));
}

const paths: Path[] = ["counter sale", "integrated pay", "collection", "refund"];
describe.each(paths)("%s checks its sign-in in the money write", (path) => {
  it.each(changes)(
    "refuses after the body read starts and the till is %s, with no money effects",
    async (change) => {
      const request = await requestFor(path);
      const before = effects(request.id);
      const calls = venue.card.collectCalls.length;
      const pending = await pausedRequest(request);
      try {
        await revoke(change);
      } finally {
        pending.release();
      }
      const res = await pending.response;
      const answer = await res.json();
      expect.soft(answer).toMatchObject({
        error: {
          code: refusalFor(change),
        },
      });
      expect.soft(effects(request.id)).toEqual(before);
      expect(venue.card.collectCalls).toHaveLength(calls);
    },
  );

  it("refuses a request queued behind the transaction that switches its till off", async () => {
    const request = await requestFor(path);
    const before = effects(request.id);
    const calls = venue.card.collectCalls.length;
    const pending = await pausedRequest(request);
    let entered!: () => void;
    let releaseWrite!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const revocation = withTransaction(suite.db, async (tx) => {
      await tx.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
      entered();
      await hold;
    });
    await inside;
    const queued = vi.spyOn(suite.db, "withWriteLock");
    try {
      pending.release();
      await vi.waitFor(() => expect(queued).toHaveBeenCalled());
    } finally {
      queued.mockRestore();
      releaseWrite();
      pending.release();
    }
    await revocation;
    expect(await (await pending.response).json()).toMatchObject({
      error: { code: "device.unauthorized" },
    });
    expect(effects(request.id)).toEqual(before);
    expect(venue.card.collectCalls).toHaveLength(calls);
  });

  it.each(changes)(
    "refuses a completed-id retry after the initial sign-in check when %s",
    async (change) => {
      const request = await requestFor(path);
      expect((await send(venue.app, cookie, "POST", request.path, request.body)).status).toBe(200);
      const written = effects(request.id);
      const calls = venue.card.collectCalls.length;
      const pending = await pausedRequest(request);
      try {
        await revoke(change);
      } finally {
        pending.release();
      }
      expect(await (await pending.response).json()).toMatchObject({
        error: { code: refusalFor(change) },
      });
      expect(effects(request.id)).toEqual(written);
      expect(venue.card.collectCalls).toHaveLength(calls);
    },
  );

  it("allows an active signed-in till and replays the original result without another money effect", async () => {
    const request = await requestFor(path);
    const calls = venue.card.collectCalls.length;
    const first = await send(venue.app, cookie, "POST", request.path, request.body);
    expect(first.status).toBe(200);
    expect(first.json.code).toBeUndefined();
    const written = effects(request.id);
    if (path === "refund")
      expect(written.refunds).toMatchObject([{ state: "completed", applied_amount: 50 }]);
    else {
      expect(written.sales).toHaveLength(1);
      expect(written.orders).toMatchObject([{ status: "settled" }]);
    }
    const retry = await send(venue.app, cookie, "POST", request.path, request.body);
    expect(retry).toEqual(first);
    expect(effects(request.id)).toEqual(written);
    expect(venue.card.collectCalls).toHaveLength(calls + (path === "integrated pay" ? 1 : 0));
  });
});

it.each(
  (["captured", "accepted_offline"] as const).flatMap((state) =>
    ([false, true] as const).flatMap((issued) =>
      (["signed out", "switched off", "deleted"] as const).map((change) => ({
        state,
        issued,
        change,
      })),
    ),
  ),
)(
  "finishes an admitted $state card charge (issued: $issued) after $change",
  async ({ state, issued, change }) => {
    if (state === "accepted_offline") {
      venue.card.offlineNextCollect();
      const stamp = new Date().toISOString();
      await suite.db
        .execute(sql`insert into payment_policy (id, offline_mode, offline_amount_cap, created_at, updated_at)
        values (1, 'accept_offline', 5000, ${stamp}, ${stamp})
        on conflict(id) do update set offline_mode = 'accept_offline', offline_amount_cap = 5000`);
    }
    const request = await requestFor(issued ? "collection" : "integrated pay");
    if (issued) {
      await issueOrderInvoice(
        { db: suite.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        request.id,
        venue.adminId,
      );
    }
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const answer = send(venue.app, cookie, "POST", "/api/pay", {
      ...(issued ? { id: request.id, lines: [] } : request.body),
      allowOffline: state === "accepted_offline",
    });
    try {
      await vi.waitFor(() => expect(venue.card.collectCalls).toHaveLength(calls + 1));
      await revoke(change);
    } finally {
      release();
    }
    expect(await answer).toMatchObject({
      status: 200,
      json: { outcome: "captured" },
    });
    expect(effects(request.id).sales).toHaveLength(1);
    expect(effects(request.id).payments).toMatchObject([{ state }]);
    expect(venue.card.collectCalls).toHaveLength(calls + 1);
  },
);

it.each(changes)(
  "refuses a new reader-card refund after %s without sending a provider refund",
  async (change) => {
    const request = await requestFor("refund", true);
    const written = effects(request.id);
    const calls = venue.card.refundCalls.length;
    const pending = await pausedRequest(request);
    try {
      await revoke(change);
    } finally {
      pending.release();
    }
    expect(await (await pending.response).json()).toMatchObject({
      error: { code: refusalFor(change) },
    });
    expect(effects(request.id)).toEqual(written);
    expect(venue.card.refundCalls).toHaveLength(calls);
  },
);

it("finishes an admitted reader-card refund after the till is switched off", async () => {
  const request = await requestFor("refund", true);
  const calls = venue.card.refundCalls.length;
  const release = venue.card.holdNextRefund();
  const answer = send(venue.app, cookie, "POST", request.path, request.body);
  try {
    await vi.waitFor(() => expect(venue.card.refundCalls).toHaveLength(calls + 1));
    await revoke("switched off");
  } finally {
    release();
  }
  expect(await answer).toMatchObject({ status: 200, json: { refund: { state: "completed" } } });
  expect(effects(request.id).refunds).toMatchObject([{ state: "completed", applied_amount: 50 }]);
  expect(venue.card.refundCalls).toHaveLength(calls + 1);
});

it("recovers a pending reader-card refund after sign-out and deactivation without sending twice", async () => {
  const request = await requestFor("refund", true);
  const calls = venue.card.refundCalls.length;
  venue.card.scriptNextRefund({ made: "completed", answer: "throw" });
  await send(venue.app, cookie, "POST", request.path, request.body);
  const [pending] = effects(request.id).refunds as {
    id: string;
    state: string;
    applied_amount: number;
  }[];
  expect(pending).toMatchObject({ state: "pending", applied_amount: 50 });
  await revoke("signed out");
  await revoke("switched off");
  const recovered = await resumeCardRefund(
    { db: suite.db, clock: venue.clock, refundProviderFor: () => Promise.resolve(venue.card) },
    pending!.id,
    "loop",
    jobOrigin("payment_check"),
  );
  expect(recovered).toMatchObject({ claimed: true, refund: { state: "completed" }, resent: false });
  expect(effects(request.id).refunds).toMatchObject([
    { id: pending!.id, state: "completed", applied_amount: 50 },
  ]);
  expect(venue.card.refundCalls).toHaveLength(calls + 1);
});
