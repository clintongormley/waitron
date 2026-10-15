import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  billPaymentRefunds,
  billPayments,
  devices,
  newId,
  orderDraftEvents,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, persons, sessions, startManagementSession } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SimulatorPaymentProvider } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { attendanceOperationFacts } from "@waitron/workforce";
import { saveDraft } from "./order-drafts.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountPaymentsApi } from "./payments-api.js";
import {
  setupPartyVenue,
  seat,
  order,
  placeByHand,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, cookie: string, deviceId: string;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Worker", pinHash: hashPin("1234"), role: "admin" });
  const [device] = await suite.db
    .select()
    .from(devices)
    .where(eq(devices.id, v.cfg.origin.deviceId));
  const enrolled = await enrolDeviceForTest(suite.db, v.cfg, {
    name: "Attendance till",
    profileId: device!.deviceProfileId,
  });
  deviceId = enrolled.deviceId;
  cookie = `${DEVICE_COOKIE}=${deviceId}.${enrolled.token}`;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.987Z"));
});
afterEach(() => vi.useRealTimers());
function app(
  recorder: AttendanceRecorder | undefined = recordAttendanceFact,
  cardProvider?: PaymentProvider,
) {
  const app = new Hono();
  const deps: TillApiDeps = {
    db: suite.db,
    backend: v.backend,
    clock: v.clock,
    cfg: v.cfg,
    secureCookies: false,
    venueLocale: "es",
    workforceEnabled: true,
    attendance: recorder,
    cardProvider,
  };
  mountTillApi(app, deps, () => {});
  return app;
}
function login(app: Hono, pin = "1234", personId = OPERATOR) {
  return app.request("/api/session", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ personId, pin }),
  });
}
describe("till attendance recorder admission", () => {
  it.each(["finish", "unpaid-departure"] as const)(
    "passes the admitted %s actor to discarded draft capture",
    async (path) => {
      const { partyId, tabId } = await seat(v, await v.table("Closing attendance"));
      const draft = await withTransaction(suite.db, (tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          draftId: null,
          revision: 0,
          lines: [
            {
              menuItemId: v.item("Burger"),
              quantity: "1",
              variantId: null,
              menuVersionId: null,
              options: [],
              extras: [],
              note: null,
              courseId: null,
              noMerge: false,
            },
          ],
        }),
      );
      if (path === "unpaid-departure") {
        await order(v, tabId, "Burger");
        await placeByHand(v, tabId);
        await issueOrderInvoice(
          { db: suite.db, backend: v.backend, clock: v.clock },
          v.cfg,
          tabId,
          OPERATOR,
        );
      }
      const api = app();
      const opened = await login(api);
      expect(opened.status).toBe(200);
      const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
      vi.setSystemTime(new Date("2026-10-14T13:00:00.987Z"));
      const response = await api.request(`/api/parties/${partyId}/${path}`, {
        method: "POST",
        headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          expectedPartyRevision: 0,
          reason: "Guests left",
          personId: "untrusted person",
          at: "2026-10-15T20:00:00Z",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ state: "closed" });
      expect(
        (await suite.db.select().from(attendanceOperationFacts))
          .filter((r) => r.source === "draft")
          .map((r) => [r.key, r.personId, r.locationId, r.at, r.outcome]),
      ).toEqual([
        [
          `event:${(await suite.db.select().from(orderDraftEvents).where(eq(orderDraftEvents.draftId, draft.id))).find((event) => event.kind === "discarded")!.id}`,
          OPERATOR,
          v.cfg.locationId,
          "2026-10-14T13:00:00.000Z",
          "qualifying",
        ],
        [
          `${draft.id}:${draft.revision + 1}:discard`,
          OPERATOR,
          v.cfg.locationId,
          "2026-10-14T13:00:00.000Z",
          "qualifying",
        ],
      ]);
    },
  );

  it.each(["counter", "collection"] as const)(
    "passes the admitted %s collector to whole-payment capture",
    async (path) => {
      const api = app();
      const opened = await login(api);
      expect(opened.status).toBe(200);
      const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
      let id: string = newId();
      if (path === "collection") {
        const seated = await seat(v, await v.table("Whole collection"));
        id = seated.tabId;
        await order(v, id, "Burger");
        await placeByHand(v, id);
      }
      vi.setSystemTime(new Date("2026-10-14T13:00:00.987Z"));
      const paid = await api.request(
        path === "counter" ? "/api/sales" : `/api/working-orders/${id}/collect`,
        {
          method: "POST",
          headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
          body: JSON.stringify({
            ...(path === "counter"
              ? {
                  workingOrderId: id,
                  zoneId: v.counter.zoneId,
                  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
                }
              : {}),
            tender: { method: "cash", amount: "20.00" },
            personId: "untrusted person",
            at: "2026-10-15T20:00:00Z",
            locationId: "untrusted location",
          }),
        },
      );
      expect(paid.status).toBe(200);
      expect(await paid.json()).toMatchObject({
        total: "12.00",
        tender: { method: "cash", change: "8.00" },
      });
      expect(
        (await suite.db.select().from(attendanceOperationFacts))
          .filter((r) => r.source === "whole-payment")
          .map((r) => [r.key, r.personId, r.locationId, r.at, r.outcome]),
      ).toEqual([[id, OPERATOR, v.cfg.locationId, "2026-10-14T13:00:00.000Z", "qualifying"]]);
    },
  );

  it("passes the admitted integrated collector without trusting submitted attribution", async () => {
    const api = app(recordAttendanceFact, new SimulatorPaymentProvider(suite.db));
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00.987Z"));
    const paid = await api.request("/api/pay", {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: newId(),
        zoneId: v.counter.zoneId,
        lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        personId: "untrusted person",
        at: "2026-10-15T20:00:00Z",
        locationId: "untrusted location",
      }),
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ outcome: "captured", ticket: { total: "12.00" } });
    expect(
      (await suite.db.select().from(attendanceOperationFacts))
        .filter((r) => r.source === "whole-payment")
        .map((r) => [r.personId, r.locationId, r.at, r.outcome]),
    ).toEqual([[OPERATOR, v.cfg.locationId, "2026-10-14T13:00:00.000Z", "qualifying"]]);
  });

  it("passes the admitted bill payment to the recorder without trusting body attribution", async () => {
    const { tabId } = await seat(v, await v.table("Payment attendance"));
    await order(v, tabId, "Burger");
    const api = app();
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const paid = await api.request(`/api/working-orders/${tabId}/payments`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: "attendance-payment",
        kind: "contribution",
        amount: "1.00",
        method: "cash",
        tendered: "1.00",
        applied: "1.00",
        tip: "0.00",
        personId: "untrusted person",
        at: "2026-10-15T20:00:00Z",
        locationId: "untrusted location",
      }),
    });
    expect(paid.status).toBe(200);
    const body = (await paid.json()) as { payment: { id: string } };
    expect(
      (await suite.db.select().from(attendanceOperationFacts)).map((r) => [
        r.source,
        r.key,
        r.personId,
        r.locationId,
        r.at,
        r.outcome,
      ]),
    ).toEqual([
      [
        "session",
        expect.any(String),
        OPERATOR,
        v.cfg.locationId,
        "2026-10-14T12:00:00.000Z",
        "qualifying",
      ],
      [
        "bill-payment",
        body.payment.id,
        OPERATOR,
        v.cfg.locationId,
        "2026-10-14T13:00:00.000Z",
        "qualifying",
      ],
    ]);
  });

  it("bill payment capture refusal reaches the route after rolling back its payment", async () => {
    const { tabId } = await seat(v, await v.table("Payment rollback"));
    await order(v, tabId, "Burger");
    const api = app(async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      if (fact.source === "bill-payment")
        throw new AppError("attendance.invalid", { reason: "payment capture refused" });
    });
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    const paid = await api.request(`/api/working-orders/${tabId}/payments`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: "payment-rollback",
        kind: "contribution",
        amount: "1.00",
        method: "cash",
        tendered: "1.00",
        applied: "1.00",
        tip: "0.00",
      }),
    });
    expect(paid.status).toBe(400);
    expect(await paid.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(await suite.db.select().from(billPayments)).toEqual([]);
    expect((await suite.db.select().from(attendanceOperationFacts)).map((r) => r.source)).toEqual([
      "session",
    ]);
  });
  it("captures only the admitted successful PIN session at its stored opening time", async () => {
    const api = app();
    const denied = await login(api, "0000");
    expect(denied.status).toBe(401);
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([]);
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const [session] = await suite.db.select().from(sessions).where(eq(sessions.deviceId, deviceId));
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([
      {
        sequence: 1,
        source: "session",
        key: session!.id,
        personId: OPERATOR,
        locationId: v.cfg.locationId,
        kind: "sign-in",
        at: "2026-10-14T12:00:00.000Z",
        offsetMinutes: 120,
        businessDay: "2026-10-14",
        outcome: "qualifying",
      },
    ]);
  });
  it("an evidence refusal rolls back sign-in and returns no session cookie", async () => {
    const api = app(async () => {
      throw new AppError("attendance.invalid", { reason: "capture refused" });
    });
    const opened = await login(api);
    expect(opened.status).toBe(400);
    expect(await opened.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(opened.headers.get("set-cookie")).toBeNull();
    expect(await suite.db.select().from(sessions).where(eq(sessions.deviceId, deviceId))).toEqual(
      [],
    );
  });
  it("passes the recorder to the actual draft save route after its admission checks", async () => {
    const { partyId } = await seat(v, await v.table("Draft attendance"));
    const api = app();
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const saved = await api.request(`/api/parties/${partyId}/drafts`, {
      method: "PUT",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: v.item("Burger"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: false,
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const draft = (await saved.json()) as { id: string; revision: number };
    expect(
      (await suite.db.select().from(attendanceOperationFacts)).map((r) => [
        r.source,
        r.key,
        r.personId,
        r.at,
      ]),
    ).toEqual([
      ["session", expect.any(String), OPERATOR, "2026-10-14T12:00:00.000Z"],
      [
        "draft",
        `event:${(await suite.db.select().from(orderDraftEvents).where(eq(orderDraftEvents.draftId, draft.id)))[0]!.id}`,
        OPERATOR,
        "2026-10-14T13:00:00.000Z",
      ],
      ["draft", `${draft.id}:${draft.revision}:save`, OPERATOR, "2026-10-14T13:00:00.000Z"],
    ]);
  });
});

describe("till refund attendance", () => {
  async function paidBill(api: Hono, method: "cash" | "manual" | "reader") {
    const { tabId } = await seat(v, await v.table("Refund attendance"));
    await order(v, tabId, "Burger");
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const paid = await api.request(`/api/working-orders/${tabId}/payments`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: "refund-source",
        kind: "contribution",
        amount: "1.00",
        applied: "1.00",
        tip: "0.00",
        method: method === "cash" ? "cash" : "card",
        ...(method === "cash" ? { tendered: "1.00" } : { entry: method }),
      }),
    });
    expect(paid.status).toBe(200);
    const body = (await paid.json()) as { payment: { id: string } };
    const [worker] = await suite.db
      .insert(persons)
      .values({ displayName: "Refund initiator", pinHash: hashPin("2468"), role: "staff" })
      .returning({ id: persons.id });
    const signed = await login(api, "2468", worker!.id);
    expect(signed.status).toBe(200);
    const workerCookie = signed.headers.get("set-cookie")!.split(";")[0]!;
    return { tabId, paymentId: body.payment.id, workerId: worker!.id, workerCookie };
  }

  it.each(["cash", "manual", "reader"] as const)(
    "a %s refund captures its initiator separately from its approving manager and preserves the original payment",
    async (method) => {
      const api = app(recordAttendanceFact, new SimulatorPaymentProvider(suite.db));
      const paid = await paidBill(api, method);
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const request = {
        submissionId: "attendance-refund",
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Customer paid too much",
        override: { personId: OPERATOR, pin: "1234" },
        ...(method === "manual" ? { manualConfirmed: true } : {}),
      };
      const submit = () =>
        api.request(`/api/working-orders/${paid.tabId}/payments/${paid.paymentId}/refunds`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; ${paid.workerCookie}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
        });
      const refunded = await submit();
      expect(refunded.status).toBe(200);
      const body = (await refunded.json()) as { refund: { id: string; state: string } };
      expect(body.refund.state).toBe("completed");
      const moneyFacts = (await suite.db.select().from(attendanceOperationFacts)).filter(
        (r) => r.kind === "payment",
      );
      expect(moneyFacts.map((r) => [r.source, r.key, r.personId, r.at, r.outcome])).toEqual([
        ["bill-payment", paid.paymentId, OPERATOR, "2026-10-14T13:00:00.000Z", "qualifying"],
        ["refund", body.refund.id, paid.workerId, "2026-10-14T15:00:00.000Z", "qualifying"],
      ]);
      vi.setSystemTime(new Date("2026-10-14T18:00:00Z"));
      const before = await suite.db.select().from(attendanceOperationFacts);
      expect((await submit()).status).toBe(200);
      expect(await suite.db.select().from(attendanceOperationFacts)).toEqual(before);
    },
  );

  it("an attendance refusal rolls back a cash refund", async () => {
    const api = app(async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      if (fact.source === "refund")
        throw new AppError("attendance.invalid", { reason: "refund capture refused" });
    });
    const paid = await paidBill(api, "cash");
    const before = await suite.db.select().from(attendanceOperationFacts);
    const res = await api.request(
      `/api/working-orders/${paid.tabId}/payments/${paid.paymentId}/refunds`,
      {
        method: "POST",
        headers: { cookie: `${cookie}; ${paid.workerCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: "refused-refund",
          appliedAmount: "1.00",
          tipAmount: "0.00",
          reason: "Customer paid too much",
          override: { personId: OPERATOR, pin: "1234" },
        }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(await suite.db.select().from(billPaymentRefunds)).toEqual([]);
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual(before);
  });

  it.each(["completed", "failed", "pending"] as const)(
    "a delayed reader refund keeps its request instant when its outcome is %s",
    async (outcome) => {
      const provider = new SimulatorPaymentProvider(suite.db);
      let seen: { personId: string; at: string; outcome: string }[] = [];
      vi.spyOn(provider, "sendRefund").mockImplementation(async () => {
        seen = (await suite.db.select().from(attendanceOperationFacts))
          .filter((r) => r.source === "refund")
          .map((r) => ({ personId: r.personId, at: r.at, outcome: r.outcome }));
        vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
        return outcome === "pending"
          ? { kind: "uncertain", reason: "network" }
          : {
              kind: "outcome",
              outcome,
              providerRefundRef: "refund-receipt",
              providerStatus: outcome,
            };
      });
      const api = app(recordAttendanceFact, provider);
      const paid = await paidBill(api, "reader");
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const res = await api.request(
        `/api/working-orders/${paid.tabId}/payments/${paid.paymentId}/refunds`,
        {
          method: "POST",
          headers: {
            cookie: `${cookie}; ${paid.workerCookie}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            submissionId: "delayed-refund",
            appliedAmount: "1.00",
            tipAmount: "0.00",
            reason: "Customer paid too much",
            override: { personId: OPERATOR, pin: "1234" },
          }),
        },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { refund: { state: string } }).refund.state).toBe(outcome);
      expect(seen).toEqual([
        { personId: paid.workerId, at: "2026-10-14T15:00:00.000Z", outcome: "pending" },
      ]);
      const [fact] = (await suite.db.select().from(attendanceOperationFacts)).filter(
        (r) => r.source === "refund",
      );
      expect(fact).toMatchObject({
        personId: paid.workerId,
        locationId: v.cfg.locationId,
        at: "2026-10-14T15:00:00.000Z",
        businessDay: "2026-10-14",
        outcome:
          outcome === "completed" ? "qualifying" : outcome === "failed" ? "refused" : "pending",
      });
    },
  );

  it.each([
    { route: "resolve", outcome: "completed" },
    { route: "attest", outcome: "completed" },
    { route: "attest", outcome: "failed" },
  ] as const)(
    "manager $route/$outcome settles the requesting worker's refund evidence",
    async ({ route, outcome }) => {
      const provider = new SimulatorPaymentProvider(suite.db);
      vi.spyOn(provider, "sendRefund").mockResolvedValue({ kind: "uncertain", reason: "network" });
      const api = app(recordAttendanceFact, provider);
      const paid = await paidBill(api, "reader");
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const res = await api.request(
        `/api/working-orders/${paid.tabId}/payments/${paid.paymentId}/refunds`,
        {
          method: "POST",
          headers: {
            cookie: `${cookie}; ${paid.workerCookie}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            submissionId: "manager-refund",
            appliedAmount: "1.00",
            tipAmount: "0.00",
            reason: "Customer paid too much",
            override: { personId: OPERATOR, pin: "1234" },
          }),
        },
      );
      expect(res.status).toBe(200);
      const refund = ((await res.json()) as { refund: { id: string; state: string } }).refund;
      expect(refund.state).toBe("pending");
      const management = new Hono();
      mountPaymentsApi(
        management,
        {
          db: suite.db,
          backend: v.backend,
          clock: v.clock,
          cfg: v.cfg,
          ring: loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
          environment: "preproduction",
          providers: [],
          simulator: provider,
          pool: { get: async () => provider, evict: () => {} },
          attendance: recordAttendanceFact,
        },
        () => {},
      );
      vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: OPERATOR }),
      );
      if (route === "resolve")
        vi.spyOn(provider, "lookupRefund").mockResolvedValue({
          kind: "match",
          outcome: "completed",
          providerRefundRef: "managed-refund",
          providerStatus: "completed",
        });
      const settled = await management.request(
        `/management-api/payments/bill-refunds/${refund.id}/${route}`,
        {
          method: "POST",
          headers: {
            cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
            "content-type": "application/json",
          },
          ...(route === "attest"
            ? { body: JSON.stringify({ outcome, note: "Provider outcome checked", pin: "1234" }) }
            : {}),
        },
      );
      expect(settled.status).toBe(200);
      expect(await settled.json()).toEqual({ outcome });
      const [fact] = (await suite.db.select().from(attendanceOperationFacts)).filter(
        (r) => r.source === "refund",
      );
      expect(fact).toMatchObject({
        personId: paid.workerId,
        locationId: v.cfg.locationId,
        at: "2026-10-14T15:00:00.000Z",
        businessDay: "2026-10-14",
        outcome: outcome === "completed" ? "qualifying" : "refused",
      });
    },
  );
});
