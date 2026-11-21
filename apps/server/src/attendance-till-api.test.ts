import { billShare } from "./testing/bill-payment-fixture.js";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { devices, persons, newId, withTransaction, withFoldedPersonChanges } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { tillSessions } from "@waitron/identity";
import { fixturePinHash } from "./testing/known-secret-hashes.js";

import { SimulatorPaymentProvider } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { staffActivity } from "@waitron/workforce";

import { issueOrderInvoice } from "./testing/issue-order.js";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";

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
    .update(persons)
    .set(withFoldedPersonChanges({ displayName: "Worker", pinHash: fixturePinHash("1234") }))
    .where(eq(persons.id, OPERATOR));
  await setBuiltInRoleForTest(suite.db, OPERATOR, "admin");
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
    admission: testTradingAdmission(),
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
    "explicit disposal before %s retains the admitted draft actor",
    async (path) => {
      const { partyId, tabId } = await seat(v, await v.table("Closing attendance"));
      const draft = await withTransaction(suite.db, (tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          billId: tabId,
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

      const api = app();
      const opened = await login(api);
      expect(opened.status).toBe(200);
      const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
      vi.setSystemTime(new Date("2026-10-14T13:00:00.987Z"));
      const discarded = await api.request(`/api/parties/${partyId}/drafts`, {
        method: "PUT",
        headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          billId: tabId,
          draftId: draft.id,
          revision: draft.revision,
          expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
          lines: [],
          at: "2026-10-15T20:00:00Z",
        }),
      });
      expect(discarded.status).toBe(200);
      expect(await discarded.json()).toMatchObject({ draft: null });
      if (path === "unpaid-departure") {
        await order(v, tabId, "Burger");
        await placeByHand(v, tabId);
        await issueOrderInvoice(
          { admission: testTradingAdmission(), db: suite.db, backend: v.backend, clock: v.clock },
          v.cfg,
          tabId,
          OPERATOR,
        );
      }
      const response = await api.request(`/api/parties/${partyId}/${path}`, {
        method: "POST",
        headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          billId: tabId,
          expectedPartyRevision: 0,
          expectedEdits: await withTransaction(suite.db, (tx) => closingEditsForTest(tx, partyId)),
          reason: "Guests left",
          personId: "untrusted person",
          at: "2026-10-15T20:00:00Z",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ state: "closed" });
      expect(
        (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
      ).toEqual([[OPERATOR, "2026-10-14T13:00:00.000Z"]]);
    },
  );

  it.each(["counter", "collection"] as const)(
    "passes the admitted %s collector to payment capture",
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
      const paid = await api.request(`/api/working-orders/${id}/payments`, {
        method: "POST",
        headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...(path === "counter"
            ? {
                submissionId: id,
                kind: "share",
                shareOf: 1,
                method: "cash",
                tendered: "20.00",
                basket: {
                  zoneId: v.counter.zoneId,
                  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
                },
                dining: "eat_in",
              }
            : {
                expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, id)),
                ...billShare("cash", "12.00", { tendered: "20.00" }),
              }),
          personId: "untrusted person",
          at: "2026-10-15T20:00:00Z",
        }),
      });
      expect(paid.status).toBe(200);
      const result = await paid.json();
      expect(result.invoice).toMatchObject({
        total: "12.00",
        tender: { method: "cash", change: "8.00" },
      });
      expect(
        (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
      ).toEqual([[OPERATOR, "2026-10-14T13:00:00.000Z"]]);
    },
  );

  it("passes the admitted integrated collector without trusting submitted attribution", async () => {
    const api = app(recordAttendanceFact, new SimulatorPaymentProvider(suite.db));
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00.987Z"));
    const id = newId();
    const paid = await api.request(`/api/working-orders/${id}/payments`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        dining: "eat_in",
        submissionId: id,
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        basket: {
          zoneId: v.counter.zoneId,
          lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        },
        personId: "untrusted person",
        at: "2026-10-15T20:00:00Z",
      }),
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ outcome: "received", invoice: { total: "12.00" } });
    expect(
      (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
    ).toEqual([[OPERATOR, "2026-10-14T13:00:00.000Z"]]);
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
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
        kind: "contribution",
        amount: "1.00",
        method: "cash",
        tendered: "1.00",
        applied: "1.00",
        tip: "0.00",
        personId: "untrusted person",
        at: "2026-10-15T20:00:00Z",
      }),
    });
    expect(paid.status).toBe(200);

    expect(
      (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
    ).toEqual([[OPERATOR, "2026-10-14T13:00:00.000Z"]]);
  });
  it("captures only the admitted successful PIN session at its stored opening time", async () => {
    const api = app();
    const denied = await login(api, "0000");
    expect(denied.status).toBe(401);
    expect(await suite.db.select().from(staffActivity)).toEqual([]);
    const opened = await login(api);
    expect(opened.status).toBe(200);
    await suite.db.select().from(tillSessions).where(eq(tillSessions.deviceId, deviceId));
    expect(await suite.db.select().from(staffActivity)).toMatchObject([
      { personId: OPERATOR, lastAt: "2026-10-14T12:00:00.000Z" },
    ]);
  });
  it("passes the recorder to the actual draft save route after its admission checks", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Draft attendance"));
    const api = app();
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const saved = await api.request(`/api/parties/${partyId}/drafts`, {
      method: "PUT",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        billId: tabId,
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
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

    expect(
      (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
    ).toEqual([[OPERATOR, "2026-10-14T13:00:00.000Z"]]);
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
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
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
    const [worker] = await seedPersons(suite.db, {
      displayName: "Refund initiator",
      pinHash: fixturePinHash("2468"),
      role: "staff",
    });
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
      const moneyFacts = await suite.db.select().from(staffActivity);
      expect(moneyFacts.map((row) => [row.personId, row.lastAt])).toEqual([
        [OPERATOR, "2026-10-14T13:00:00.000Z"],
        [paid.workerId, "2026-10-14T15:00:00.000Z"],
      ]);
      vi.setSystemTime(new Date("2026-10-14T18:00:00Z"));
      const before = await suite.db.select().from(staffActivity);
      expect((await submit()).status).toBe(200);
      expect(await suite.db.select().from(staffActivity)).toEqual(before);
    },
  );
});
