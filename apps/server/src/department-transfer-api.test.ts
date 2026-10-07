import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  workingOrders,
  workingOrderLines,
  ticketItems,
  sales,
  saleLines,
  withTransaction,
  installChangeFeed,
  subscribeToChanges,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons, setProfileAdmission, sessions } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import {
  createDepartment,
  createServiceZone,
  recordOrderServiceContext,
  retargetOrderServiceContext,
  getOrderServiceContext,
  setProfileServiceScope,
  setDepartmentTransferSettings,
  departmentTransferRequests,
  workingLineContexts,
} from "@waitron/venue-service";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { issueUnpaidInvoice, priceForIssuance, placeOrder } from "./working-order.js";
import { LiveEvents, changeSubscriber } from "./live-api.js";
import { requestCfg } from "./request-config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupPartyVenue, counterOrder, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});
let v: PartyVenue;
let app: Hono;
const liveEvents = new LiveEvents();
let personId: string;
let nextOrderNumber = 0;

async function login(profileId: string) {
  const d = await enrolDeviceForTest(suite.db, v.cfg, { name: randomUUID(), profileId });
  const response = await app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${DEVICE_COOKIE}=${d.deviceId}.${d.token}`,
    },
    body: JSON.stringify({ personId, pin: "5555" }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.split(";")[0]!, deviceId: d.deviceId };
}

async function ready() {
  const f = await withTransaction(suite.db, async (tx) => {
    const a = await createDepartment(tx, v.cfg, {
      name: randomUUID(),
      defaultServiceMode: "table_tab",
    });
    const b = await createDepartment(tx, v.cfg, {
      name: randomUUID(),
      defaultServiceMode: "table_tab",
    });
    const az = await createServiceZone(tx, v.cfg, { name: randomUUID(), departmentId: a.id });
    const hidden = await createServiceZone(tx, v.cfg, { name: randomUUID(), departmentId: a.id });
    const bz = await createServiceZone(tx, v.cfg, { name: randomUUID(), departmentId: b.id });
    const profiles = [];
    for (const [departmentId, zoneId] of [
      [a.id, az.id],
      [b.id, bz.id],
      [b.id, bz.id],
    ]) {
      const [p] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till", capabilities: [...CAPABILITY_FLAGS] })
        .returning();
      await setProfileServiceScope(tx, v.cfg, p!.id, {
        departmentId: departmentId!,
        allowedZoneIds: [zoneId!],
        startingZoneId: zoneId!,
      });
      profiles.push(p!.id);
    }
    await setDepartmentTransferSettings(tx, v.cfg, a.id, {
      receivingProfileId: null,
      destinationDepartmentIds: [b.id],
    });
    await setDepartmentTransferSettings(tx, v.cfg, b.id, {
      receivingProfileId: profiles[1]!,
      destinationDepartmentIds: [],
    });
    const [tab] = await tx
      .insert(workingOrders)
      .values({
        locationId: v.cfg.locationId,
        source: "operator_script",
        orderNumber: ++nextOrderNumber,
      })
      .returning();
    await recordOrderServiceContext(tx, v.cfg, tab!.id, az.id);
    return {
      a: a.id,
      b: b.id,
      az: az.id,
      bz: bz.id,
      hidden: hidden.id,
      tab: tab!.id,
      sourceProfile: profiles[0]!,
      deskProfile: profiles[1]!,
      otherProfile: profiles[2]!,
    };
  });
  return {
    ...f,
    source: await login(f.sourceProfile),
    desk: await login(f.deskProfile),
    other: await login(f.otherProfile),
  };
}

async function post(cookie: string, path: string, body: unknown = {}) {
  const response = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}
async function whileReadingBody(
  cookie: string,
  path: string,
  body: unknown,
  change: () => Promise<unknown>,
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: () => void;
  const reading = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        signal();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const response = app.request(request);
  await reading;
  try {
    await change();
  } finally {
    controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
    controller.close();
  }
  const result = await response;
  return { status: result.status, body: await result.json() };
}
const requestPath = (tab: string) => `/api/working-orders/${tab}/department-transfers`;
const resolutionPath = (id: string, action: string) => `/api/department-transfers/${id}/${action}`;
async function pending(f: Awaited<ReturnType<typeof ready>>) {
  const result = await post(f.source.cookie, requestPath(f.tab), { destinationDepartmentId: f.b });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    tabId: f.tab,
    sourceDepartmentId: f.a,
    destinationDepartmentId: f.b,
    senderId: personId,
    status: "pending",
  });
  return result.body.id as string;
}
async function state(tab: string) {
  return withTransaction(suite.db, async (tx) => {
    const [row] = await tx.select().from(workingOrders).where(eq(workingOrders.id, tab));
    const requests = await tx
      .select()
      .from(departmentTransferRequests)
      .where(eq(departmentTransferRequests.tabId, tab));
    return { tab: row, requests, context: await getOrderServiceContext(tx, v.cfg, tab) };
  });
}

beforeAll(async () => {
  v = await setupPartyVenue(suite.db);
  const [p] = await suite.db
    .insert(persons)
    .values({ displayName: "Transfer operator", pinHash: hashPin("5555"), role: "staff" })
    .returning();
  personId = p!.id;
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      liveEvents,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
});

describe("department transfer till writes", () => {
  it("creates a request without moving responsibility and lets the source withdraw", async () => {
    const f = await ready();
    const id = await pending(f);
    expect((await state(f.tab)).context.zoneId).toBe(f.az);
    const withdrawal = await post(f.source.cookie, resolutionPath(id, "withdraw"));
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body).toMatchObject({
      id,
      status: "withdrawn",
      resolvedBy: personId,
      revision: 1,
    });
    expect((await state(f.tab)).context.zoneId).toBe(f.az);
  });
  it("lets the designated desk accept once and moves only future ownership", async () => {
    const f = await ready();
    const id = await pending(f);
    const accepted = await post(f.desk.cookie, resolutionPath(id, "accept"), {
      revision: 0,
      zoneId: f.bz,
      tableId: null,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      id,
      status: "accepted",
      destinationZoneId: f.bz,
      resolvedBy: personId,
    });
    expect((await state(f.tab)).context).toEqual({
      zoneId: f.bz,
      departmentId: f.b,
      serviceMode: "table_tab",
    });
    expect((await state(f.tab)).tab!.revision).toBe(1);
    const duplicate = await post(f.desk.cookie, resolutionPath(id, "accept"), {
      revision: 0,
      zoneId: f.bz,
      tableId: null,
    });
    expect(duplicate).toMatchObject({
      status: 409,
      body: { error: { code: "department_transfer.not_pending" } },
    });
  });
  it("declines with the receiver's reason while keeping source responsibility", async () => {
    const f = await ready();
    const id = await pending(f);
    const result = await post(f.desk.cookie, resolutionPath(id, "decline"), {
      reason: "  Desk closing  ",
    });
    expect(result).toMatchObject({
      status: 200,
      body: { id, status: "declined", reason: "Desk closing", resolvedBy: personId },
    });
    expect((await state(f.tab)).context.zoneId).toBe(f.az);
  });
  it("refuses a source zone outside the sender profile", async () => {
    const f = await ready();
    await withTransaction(suite.db, (tx) =>
      retargetOrderServiceContext(tx, v.cfg, f.tab, f.hidden),
    );
    const result = await post(f.source.cookie, requestPath(f.tab), {
      destinationDepartmentId: f.b,
    });
    expect(result).toMatchObject({
      status: 403,
      body: { error: { code: "service_zone.not_allowed" } },
    });
    expect((await state(f.tab)).requests).toEqual([]);
  });
  for (const action of ["accept", "decline"] as const)
    it(`refuses ${action} from an undesignated profile in the destination`, async () => {
      const f = await ready();
      const id = await pending(f);
      const result = await post(
        f.other.cookie,
        resolutionPath(id, action),
        action === "accept" ? { revision: 0, zoneId: f.bz, tableId: null } : { reason: "No" },
      );
      expect(result).toMatchObject({
        status: 403,
        body: { error: { code: "department_transfer.not_allowed" } },
      });
      expect((await state(f.tab)).requests[0]!.status).toBe("pending");
    });
  it("refuses withdrawal from the receiving department", async () => {
    const f = await ready();
    const id = await pending(f);
    expect(await post(f.desk.cookie, resolutionPath(id, "withdraw"))).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  for (const action of ["request", "withdraw", "accept", "decline"] as const)
    it(`refuses ${action} without the take-orders profile action`, async () => {
      const f = await ready();
      const id = action === "request" ? null : await pending(f);
      const actor = action === "request" || action === "withdraw" ? f.source : f.desk;
      await suite.db
        .update(deviceProfiles)
        .set({ capabilities: CAPABILITY_FLAGS.filter((x) => x !== "take-orders") })
        .where(
          eq(
            deviceProfiles.id,
            action === "request" || action === "withdraw" ? f.sourceProfile : f.deskProfile,
          ),
        );
      const result = await post(
        actor.cookie,
        action === "request" ? requestPath(f.tab) : resolutionPath(id!, action),
        action === "request"
          ? { destinationDepartmentId: f.b }
          : action === "accept"
            ? { revision: 0, zoneId: f.bz, tableId: null }
            : { reason: "No" },
      );
      expect(result).toMatchObject({
        status: 403,
        body: { error: { code: "device.forbidden_action", params: { action: "take-orders" } } },
      });
      expect((await state(f.tab)).requests).toHaveLength(action === "request" ? 0 : 1);
      if (id !== null) expect((await state(f.tab)).requests[0]!.status).toBe("pending");
    });
  it("refuses a suspended operator and a revoked device", async () => {
    const f = await ready();
    await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
    try {
      expect(
        await post(f.source.cookie, requestPath(f.tab), { destinationDepartmentId: f.b }),
      ).toMatchObject({ status: 403, body: { error: { code: "person.suspended" } } });
    } finally {
      await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
    }
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, f.source.deviceId));
    expect(
      await post(f.source.cookie, requestPath(f.tab), { destinationDepartmentId: f.b }),
    ).toMatchObject({ status: 401, body: { error: { code: "device.unauthorized" } } });
    expect((await state(f.tab)).requests).toEqual([]);
  });
  it("refuses every write without a session", async () => {
    const f = await ready();
    for (const path of [
      requestPath(f.tab),
      ...["withdraw", "accept", "decline"].map((action) => resolutionPath(randomUUID(), action)),
    ])
      expect(await post("", path)).toMatchObject({
        status: 401,
        body: { error: { code: "session.required" } },
      });
  });
  it("refuses stale acceptance and a payment started after the request", async () => {
    const f = await ready();
    const id = await pending(f);
    await suite.db.update(workingOrders).set({ revision: 1 }).where(eq(workingOrders.id, f.tab));
    expect(
      await post(f.desk.cookie, resolutionPath(id, "accept"), {
        revision: 0,
        zoneId: f.bz,
        tableId: null,
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "working_order.out_of_date" } } });
    await suite.db
      .update(workingOrders)
      .set({ paymentAttemptAt: "2026-10-07T09:00:00.000Z" })
      .where(eq(workingOrders.id, f.tab));
    expect(
      await post(f.desk.cookie, resolutionPath(id, "accept"), {
        revision: 1,
        zoneId: f.bz,
        tableId: null,
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "order.payment_in_flight" } } });
    expect((await state(f.tab)).context.zoneId).toBe(f.az);
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  it("accepts exactly once when two authenticated receiving devices race", async () => {
    const f = await ready();
    const second = await login(f.deskProfile);
    const id = await pending(f);
    const results = await Promise.all(
      [f.desk, second].map((actor) =>
        post(actor.cookie, resolutionPath(id, "accept"), {
          revision: 0,
          zoneId: f.bz,
          tableId: null,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      "department_transfer.not_pending",
    );
    expect((await state(f.tab)).tab!.revision).toBe(1);
    expect((await state(f.tab)).requests[0]!.status).toBe("accepted");
  });
  it("refuses a receiving zone outside the designated profile", async () => {
    const f = await ready();
    const id = await pending(f);
    expect(
      await post(f.desk.cookie, resolutionPath(id, "accept"), {
        revision: 0,
        zoneId: f.az,
        tableId: null,
      }),
    ).toMatchObject({ status: 403, body: { error: { code: "service_zone.not_allowed" } } });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  for (const value of [null, [], 4, "", "bad-id"])
    it(`refuses malformed destination ${JSON.stringify(value)}`, async () => {
      const f = await ready();
      expect(
        await post(f.source.cookie, requestPath(f.tab), { destinationDepartmentId: value }),
      ).toMatchObject({
        status: 400,
        body: {
          error: {
            code: "management.request_invalid",
            params: { field: "destinationDepartmentId" },
          },
        },
      });
      expect((await state(f.tab)).requests).toEqual([]);
    });
  for (const revision of [null, "0", -1, 0.5])
    it(`refuses malformed revision ${JSON.stringify(revision)}`, async () => {
      const f = await ready();
      const id = await pending(f);
      expect(
        await post(f.desk.cookie, resolutionPath(id, "accept"), {
          revision,
          zoneId: f.bz,
          tableId: null,
        }),
      ).toMatchObject({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "revision" } } },
      });
      expect((await state(f.tab)).requests[0]!.status).toBe("pending");
    });
  it("refuses an absent decline reason", async () => {
    const f = await ready();
    const id = await pending(f);
    expect(await post(f.desk.cookie, resolutionPath(id, "decline"), { reason: " " })).toMatchObject(
      { status: 400, body: { error: { code: "department_transfer.reason_required" } } },
    );
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  it("refuses a malformed request id and missing request", async () => {
    const f = await ready();
    expect(await post(f.source.cookie, resolutionPath("not-an-id", "withdraw"))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "requestId" } } },
    });
    expect(await post(f.source.cookie, resolutionPath(randomUUID(), "withdraw"))).toMatchObject({
      status: 404,
      body: { error: { code: "department_transfer.not_found" } },
    });
  });

  it("refuses a person excluded from the receiving profile after signing in", async () => {
    const f = await ready();
    const id = await pending(f);
    await withTransaction(suite.db, (tx) =>
      setProfileAdmission(tx, f.deskProfile, { personExceptions: [{ personId, admitted: false }] }),
    );
    expect(
      await post(f.desk.cookie, resolutionPath(id, "accept"), {
        revision: 0,
        zoneId: f.bz,
        tableId: null,
      }),
    ).toMatchObject({ status: 403, body: { error: { code: "device_profile.not_admitted" } } });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });

  it("refuses withdrawal outside the sender zone", async () => {
    const f = await ready();
    const id = await pending(f);
    await withTransaction(suite.db, (tx) =>
      retargetOrderServiceContext(tx, v.cfg, f.tab, f.hidden),
    );
    expect(await post(f.source.cookie, resolutionPath(id, "withdraw"))).toMatchObject({
      status: 403,
      body: { error: { code: "service_zone.not_allowed" } },
    });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });

  it("preserves issued fiscal rows, recorded line contexts and outstanding kitchen work", async () => {
    const f = await ready();
    f.tab = await counterOrder(v, "Burger");
    await withTransaction(suite.db, (tx) => retargetOrderServiceContext(tx, v.cfg, f.tab, f.az));
    const cfg = requestCfg(v.cfg, f.source);
    const invoice = await withTransaction(suite.db, async (tx) => {
      const priced = await priceForIssuance(tx, v.clock, cfg, f.tab);
      return issueUnpaidInvoice(tx, v.backend, cfg, priced, personId);
    });
    await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, cfg, f.tab, personId);
    async function history() {
      return withTransaction(suite.db, async (tx) => {
        const lineRows = await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, f.tab));
        const contexts = await tx
          .select()
          .from(workingLineContexts)
          .where(eq(workingLineContexts.workingOrderLineId, lineRows[0]!.id));
        const kitchen = await tx
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, f.tab));
        const recordedSales = await tx.select().from(sales).where(eq(sales.workingOrderId, f.tab));
        const recordedLines = await tx
          .select()
          .from(saleLines)
          .where(eq(saleLines.saleId, invoice.saleId));
        const fiscal = await tx.select().from(registrosFacturacion);
        return { lineRows, contexts, kitchen, recordedSales, recordedLines, fiscal };
      });
    }
    const before = await history();
    expect(before.lineRows).toHaveLength(1);
    expect(before.contexts).toHaveLength(1);
    expect(before.kitchen.length).toBeGreaterThan(0);
    expect(before.kitchen[0]).toMatchObject({ state: "queued", awayAt: null });
    expect(before.recordedSales).toHaveLength(1);
    expect(before.recordedLines).toHaveLength(1);
    expect(before.fiscal.length).toBeGreaterThan(0);
    const current = await state(f.tab);
    const id = await pending(f);
    expect(
      await post(f.desk.cookie, resolutionPath(id, "accept"), {
        revision: current.tab!.revision,
        zoneId: f.bz,
        tableId: null,
      }),
    ).toMatchObject({ status: 200, body: { status: "accepted" } });
    expect((await state(f.tab)).tab).toMatchObject({
      status: "placed",
      revision: current.tab!.revision + 1,
    });
    expect((await state(f.tab)).context.zoneId).toBe(f.bz);
    expect(await history()).toEqual(before);
  });
  it("rechecks the device action after the session check and before acceptance", async () => {
    const f = await ready();
    const id = await pending(f);
    const result = await whileReadingBody(
      f.desk.cookie,
      resolutionPath(id, "accept"),
      { revision: 0, zoneId: f.bz, tableId: null },
      () =>
        suite.db
          .update(deviceProfiles)
          .set({ capabilities: CAPABILITY_FLAGS.filter((x) => x !== "take-orders") })
          .where(eq(deviceProfiles.id, f.deskProfile)),
    );
    expect(result).toMatchObject({
      status: 403,
      body: { error: { code: "device.forbidden_action" } },
    });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  it("rechecks device revocation before acceptance", async () => {
    const f = await ready();
    const id = await pending(f);
    const result = await whileReadingBody(
      f.desk.cookie,
      resolutionPath(id, "accept"),
      { revision: 0, zoneId: f.bz, tableId: null },
      () => suite.db.update(devices).set({ active: false }).where(eq(devices.id, f.desk.deviceId)),
    );
    expect(result).toMatchObject({ status: 401, body: { error: { code: "device.unauthorized" } } });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  it("rechecks an ended session before acceptance", async () => {
    const f = await ready();
    const id = await pending(f);
    const result = await whileReadingBody(
      f.desk.cookie,
      resolutionPath(id, "accept"),
      { revision: 0, zoneId: f.bz, tableId: null },
      () =>
        suite.db
          .update(sessions)
          .set({ endedAt: new Date().toISOString() })
          .where(eq(sessions.deviceId, f.desk.deviceId)),
    );
    expect(result).toMatchObject({ status: 401, body: { error: { code: "session.not_open" } } });
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
});

async function get(cookie: string, path: string) {
  const response = await app.request(path, { headers: { cookie } });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text,
  };
}

describe("department transfer durable reads", () => {
  it("shows only configured usable destinations without granting destination browsing", async () => {
    const f = await ready();
    const choices = await get(f.source.cookie, "/api/department-transfers/destinations");
    expect(choices.status).toBe(200);
    expect(choices.body.destinations).toEqual([{ id: f.b, name: expect.any(String) }]);
    expect(await get(f.desk.cookie, "/api/department-transfers/destinations")).toEqual({
      status: 200,
      body: { destinations: [] },
    });
    const id = await pending(f);
    expect(await get(f.source.cookie, `/api/department-transfers/${id}`)).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
    expect(await get(f.desk.cookie, `/api/working-orders/${f.tab}/lines`)).toMatchObject({
      status: 403,
      body: { error: { code: "service_zone.not_allowed" } },
    });
  });
  it("rebuilds the same pending queue for two receiving devices and after a new login", async () => {
    const f = await ready();
    const id = await pending(f);
    for (const desk of [f.desk, await login(f.deskProfile), await login(f.deskProfile)]) {
      const result = await get(desk.cookie, "/api/department-transfers/incoming");
      expect(result).toMatchObject({
        status: 200,
        body: { count: 1, requests: [{ id, tabId: f.tab, status: "pending" }] },
      });
      expect(result.body.requests).toHaveLength(1);
    }
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });
  for (const who of ["source", "other"] as const)
    it(`refuses the incoming queue and detail to the ${who} profile`, async () => {
      const f = await ready();
      const id = await pending(f);
      for (const path of ["/api/department-transfers/incoming", `/api/department-transfers/${id}`])
        expect(await get(f[who].cookie, path)).toMatchObject({
          status: 403,
          body: { error: { code: "department_transfer.not_allowed" } },
        });
    });
  it("reads the latest placed tab and outstanding kitchen instructions without resolving it", async () => {
    const f = await ready();
    f.tab = await counterOrder(v, "Burger");
    await withTransaction(suite.db, (tx) => retargetOrderServiceContext(tx, v.cfg, f.tab, f.az));
    await placeOrder(
      { db: suite.db, backend: v.backend, clock: v.clock },
      requestCfg(v.cfg, f.source),
      f.tab,
      personId,
    );
    const id = await pending(f);
    const [line] = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, f.tab));
    const [ticket] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, f.tab));
    await suite.db.update(workingOrders).set({ revision: 7 }).where(eq(workingOrders.id, f.tab));
    await suite.db
      .update(ticketItems)
      .set({ note: "Keep pickup at the deli", state: "preparing" })
      .where(eq(ticketItems.id, ticket!.id));
    const before = await state(f.tab);
    for (let i = 0; i < 2; i++) {
      const detail = await get(f.desk.cookie, `/api/department-transfers/${id}`);
      expect(detail).toMatchObject({
        status: 200,
        body: {
          request: { id, status: "pending" },
          tab: { id: f.tab, revision: 7, status: "placed" },
          lines: [{ id: line!.id, name: "Burger", quantity: "1.000", unitPriceGross: "12.00" }],
          outstandingWork: [
            {
              id: ticket!.id,
              lineId: line!.id,
              stationId: ticket!.stationId,
              state: "preparing",
              note: "Keep pickup at the deli",
              firedAt: ticket!.firedAt,
              awayAt: null,
            },
          ],
        },
      });
    }
    expect(await state(f.tab)).toEqual(before);
    expect(await get(f.desk.cookie, `/api/working-orders/${f.tab}/lines`)).toMatchObject({
      status: 403,
    });
  });
  for (const action of ["accept", "decline", "withdraw"] as const)
    it(`updates every receiver and the sender after ${action}`, async () => {
      const f = await ready();
      const id = await pending(f);
      const second = await login(f.deskProfile);
      expect(await get(f.source.cookie, requestPath(f.tab))).toMatchObject({
        status: 200,
        body: { requests: [{ id, status: "pending" }] },
      });
      await post(
        action === "withdraw" ? f.source.cookie : f.desk.cookie,
        resolutionPath(id, action),
        action === "accept" ? { revision: 0, zoneId: f.bz } : { reason: "Closing" },
      );
      const status = { accept: "accepted", decline: "declined", withdraw: "withdrawn" }[action];
      expect(await get(f.source.cookie, requestPath(f.tab))).toMatchObject({
        status: 200,
        body: {
          requests: [
            { id, status, resolvedBy: personId, reason: action === "decline" ? "Closing" : null },
          ],
        },
      });
      for (const desk of [f.desk, second]) {
        expect(await get(desk.cookie, "/api/department-transfers/incoming")).toEqual({
          status: 200,
          body: { count: 0, requests: [] },
        });
        expect(await get(desk.cookie, `/api/department-transfers/${id}`)).toMatchObject({
          status: 409,
          body: { error: { code: "department_transfer.not_pending" } },
        });
      }
    });
  it("does not expose another source department's status", async () => {
    const f = await ready();
    await pending(f);
    expect(await get(f.other.cookie, requestPath(f.tab))).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
  });
  it("refuses source reads outside its zone before acceptance", async () => {
    const f = await ready();
    await pending(f);
    await withTransaction(suite.db, (tx) =>
      retargetOrderServiceContext(tx, v.cfg, f.tab, f.hidden),
    );
    expect(await get(f.source.cookie, requestPath(f.tab))).toMatchObject({
      status: 403,
      body: { error: { code: "service_zone.not_allowed" } },
    });
  });
  it("hides a destination once its receiving profile is retired", async () => {
    const f = await ready();
    await suite.db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, f.deskProfile));
    expect(await get(f.source.cookie, "/api/department-transfers/destinations")).toEqual({
      status: 200,
      body: { destinations: [] },
    });
  });
  it("rechecks receiving admission on reads", async () => {
    const f = await ready();
    const id = await pending(f);
    await withTransaction(suite.db, (tx) =>
      setProfileAdmission(tx, f.deskProfile, { personExceptions: [{ personId, admitted: false }] }),
    );
    for (const path of ["/api/department-transfers/incoming", `/api/department-transfers/${id}`])
      expect(await get(f.desk.cookie, path)).toMatchObject({
        status: 403,
        body: { error: { code: "device_profile.not_admitted" } },
      });
  });
});

describe("department transfer read boundaries", () => {
  it("returns empty source history for an eligible tab before its first request", async () => {
    const f = await ready();
    expect(await get(f.source.cookie, requestPath(f.tab))).toEqual({
      status: 200,
      body: { requests: [] },
    });
    expect(await get(f.other.cookie, requestPath(f.tab))).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
  });
  it("does not include another department's incoming request", async () => {
    const f = await ready();
    const unrelated = await ready();
    const id = await pending(f);
    await pending(unrelated);
    const queue = await get(f.desk.cookie, "/api/department-transfers/incoming");
    expect(queue).toMatchObject({ status: 200, body: { count: 1, requests: [{ id }] } });
    expect(queue.body.requests).toHaveLength(1);
  });
  it("uses the currently designated desk rather than the desk at request time", async () => {
    const f = await ready();
    const id = await pending(f);
    await withTransaction(suite.db, (tx) =>
      setDepartmentTransferSettings(tx, v.cfg, f.b, {
        receivingProfileId: f.otherProfile,
        destinationDepartmentIds: [],
      }),
    );
    expect(await get(f.desk.cookie, "/api/department-transfers/incoming")).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
    expect(await get(f.desk.cookie, `/api/department-transfers/${id}`)).toMatchObject({
      status: 403,
      body: { error: { code: "department_transfer.not_allowed" } },
    });
    expect(await get(f.other.cookie, "/api/department-transfers/incoming")).toMatchObject({
      status: 200,
      body: { count: 1, requests: [{ id }] },
    });
  });
  it("does not label away or made-here kitchen work outstanding", async () => {
    const f = await ready();
    f.tab = await counterOrder(v, "Burger");
    await withTransaction(suite.db, (tx) => retargetOrderServiceContext(tx, v.cfg, f.tab, f.az));
    await placeOrder(
      { db: suite.db, backend: v.backend, clock: v.clock },
      requestCfg(v.cfg, f.source),
      f.tab,
      personId,
    );
    const id = await pending(f);
    const [ticket] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, f.tab));
    expect(
      (await get(f.desk.cookie, `/api/department-transfers/${id}`)).body.outstandingWork,
    ).toHaveLength(1);
    for (const patch of [{ awayAt: new Date().toISOString() }, { awayAt: null, madeHere: true }]) {
      await suite.db.update(ticketItems).set(patch).where(eq(ticketItems.id, ticket!.id));
      expect(
        (await get(f.desk.cookie, `/api/department-transfers/${id}`)).body.outstandingWork,
      ).toEqual([]);
    }
  });
  for (const kind of ["revoked", "suspended", "action"] as const)
    it(`refuses reads after the receiver is ${kind}`, async () => {
      const f = await ready();
      const id = await pending(f);
      if (kind === "revoked")
        await suite.db
          .update(devices)
          .set({ active: false })
          .where(eq(devices.id, f.desk.deviceId));
      if (kind === "suspended")
        await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
      if (kind === "action")
        await suite.db
          .update(deviceProfiles)
          .set({ capabilities: CAPABILITY_FLAGS.filter((x) => x !== "take-orders") })
          .where(eq(deviceProfiles.id, f.deskProfile));
      try {
        for (const path of [
          "/api/department-transfers/incoming",
          `/api/department-transfers/${id}`,
        ])
          expect(await get(f.desk.cookie, path)).toMatchObject({
            status: kind === "revoked" ? 401 : 403,
            body: {
              error: {
                code:
                  kind === "revoked"
                    ? "device.unauthorized"
                    : kind === "suspended"
                      ? "person.suspended"
                      : "device.forbidden_action",
              },
            },
          });
      } finally {
        if (kind === "suspended")
          await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
      }
    });
  it("refuses unknown and malformed request ids", async () => {
    const f = await ready();
    expect(await get(f.desk.cookie, `/api/department-transfers/${randomUUID()}`)).toMatchObject({
      status: 404,
      body: { error: { code: "department_transfer.not_found" } },
    });
    expect(await get(f.desk.cookie, "/api/department-transfers/bad-id")).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "requestId" } } },
    });
  });
});

describe("department transfer live invalidation", () => {
  const path = "/api/department-transfers/events";
  const text = (value: Uint8Array | undefined) => new TextDecoder().decode(value);

  it("requires a till session before subscribing", async () => {
    const response = await app.request(path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
    expect(liveEvents.subscriberCount).toBe(0);
  });

  for (const resolution of ["decline", "withdraw", "accept"] as const)
    it(`invalidates both receiving devices and sender from committed ${resolution} without exposing ids`, async () => {
      const f = await ready();
      const anotherDesk = await login(f.deskProfile);
      await installChangeFeed(suite.db, [
        { table: "department_transfer_requests", type: "department_transfer_requests" },
      ]);
      const stop = subscribeToChanges(changeSubscriber(liveEvents, () => {}));
      const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
      try {
        for (const login of [f.source, f.desk, anotherDesk]) {
          const response = await app.request(path, { headers: { cookie: login.cookie } });
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          const reader = response.body!.getReader();
          readers.push(reader);
          expect(text((await reader.read()).value)).toBe("event: ready\ndata: {}\n\n");
        }
        const id = await pending(f);
        for (const reader of readers)
          expect(text((await reader.read()).value)).toBe("event: change\ndata: {}\n\n");
        expect((await state(f.tab)).requests[0]!.status).toBe("pending");
        expect(
          await post(
            resolution === "withdraw" ? f.source.cookie : f.desk.cookie,
            resolutionPath(id, resolution),
            resolution === "accept"
              ? { revision: 0, zoneId: f.bz, tableId: null }
              : { reason: "Desk busy" },
          ),
        ).toMatchObject({ status: 200 });
        for (const reader of readers)
          expect(text((await reader.read()).value)).toBe("event: change\ndata: {}\n\n");
        expect(await get(anotherDesk.cookie, "/api/department-transfers/incoming")).toEqual({
          status: 200,
          body: { count: 0, requests: [] },
        });
      } finally {
        for (const reader of readers) await reader.cancel();
        stop();
      }
      await vi.waitFor(() => expect(liveEvents.subscriberCount).toBe(0));
    });

  it("rebuilds a pending queue after disconnect without resolving its request", async () => {
    const f = await ready();
    const id = await pending(f);
    for (let reconnect = 0; reconnect < 2; reconnect++) {
      const response = await app.request(path, { headers: { cookie: f.desk.cookie } });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      try {
        expect(text((await reader.read()).value)).toContain("event: ready");
        expect(await get(f.desk.cookie, "/api/department-transfers/incoming")).toMatchObject({
          status: 200,
          body: { count: 1, requests: [{ id, status: "pending" }] },
        });
      } finally {
        await reader.cancel();
      }
    }
    expect((await state(f.tab)).requests[0]!.status).toBe("pending");
  });

  it("does not forward unrelated resources or retain an identity burst", async () => {
    const f = await ready();
    const response = await app.request(path, { headers: { cookie: f.desk.cookie } });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      await reader.read();
      liveEvents.publish({ resources: [{ type: "printers", id: "secret-printer" }] });
      for (let i = 0; i < 300; i++)
        liveEvents.publish({
          resources: [{ type: "department_transfer_requests", id: `secret-${i}` }],
        });
      expect(text((await reader.read()).value)).toBe("event: change\ndata: {}\n\n");
      liveEvents.publish({ resources: [{ type: "department_transfer_desks" }] });
      expect(text((await reader.read()).value)).toBe("event: change\ndata: {}\n\n");
    } finally {
      await reader.cancel();
    }
  });

  for (const change of ["logout", "suspend", "revoke", "action", "admission"] as const)
    it(`closes the stream when ${change} removes authorisation`, async () => {
      const f = await ready();
      const response = await app.request(path, { headers: { cookie: f.desk.cookie } });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const codes = {
        logout: "session.required",
        suspend: "person.suspended",
        revoke: "device.unauthorized",
        action: "device.forbidden_action",
        admission: "device_profile.not_admitted",
      };
      try {
        await reader.read();
        await withTransaction(suite.db, async (tx) => {
          if (change === "logout")
            await tx
              .update(sessions)
              .set({ endedAt: new Date().toISOString() })
              .where(eq(sessions.deviceId, f.desk.deviceId));
          if (change === "suspend")
            await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
          if (change === "revoke")
            await tx.update(devices).set({ active: false }).where(eq(devices.id, f.desk.deviceId));
          if (change === "action")
            await tx
              .update(deviceProfiles)
              .set({ capabilities: CAPABILITY_FLAGS.filter((flag) => flag !== "take-orders") })
              .where(eq(deviceProfiles.id, f.deskProfile));
          if (change === "admission")
            await setProfileAdmission(tx, f.deskProfile, {
              personExceptions: [{ personId, admitted: false }],
            });
        });
        liveEvents.publish({ resources: [{ type: "department_transfer_requests" }] });
        expect(text((await reader.read()).value)).toBe(
          `event: session-invalid\ndata: ${JSON.stringify({ code: codes[change] })}\n\n`,
        );
        expect((await reader.read()).done).toBe(true);
      } finally {
        await reader.cancel();
        if (change === "suspend")
          await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
      }
    });

  it("checks an idle stream on heartbeat without refreshing the device sighting", async () => {
    const f = await ready();
    const earlier = new Date(Date.now() - 600_000).toISOString();
    await suite.db
      .update(devices)
      .set({ lastSeenAt: earlier })
      .where(eq(devices.id, f.desk.deviceId));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await app.request(path, { headers: { cookie: f.desk.cookie } });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      await reader.read();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(text((await reader.read()).value)).toBe("event: keepalive\ndata: {}\n\n");
      expect(
        (
          await suite.db
            .select({ lastSeenAt: devices.lastSeenAt })
            .from(devices)
            .where(eq(devices.id, f.desk.deviceId))
        )[0]!.lastSeenAt,
      ).toBe(earlier);
      await suite.db
        .update(sessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(sessions.deviceId, f.desk.deviceId));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(text((await reader.read()).value)).toContain('"code":"session.required"');
      expect((await reader.read()).done).toBe(true);
    } finally {
      await reader?.cancel();
      vi.useRealTimers();
    }
  });
});

it("releases transfer streams when their server bus shuts down", async () => {
  const f = await ready();
  const bus = new LiveEvents();
  const isolated = new Hono();
  mountTillApi(
    isolated,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      liveEvents: bus,
    },
    () => {},
  );
  const response = await isolated.request("/api/department-transfers/events", {
    headers: { cookie: f.desk.cookie },
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    expect(bus.subscriberCount).toBe(1);
    bus.close();
    expect((await reader.read()).done).toBe(true);
    expect(bus.subscriberCount).toBe(0);
  } finally {
    await reader.cancel();
  }
});
