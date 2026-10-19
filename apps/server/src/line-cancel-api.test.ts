import { observedPaymentSender } from "./testing/bill-payment-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import {
  billPayments,
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  lineServiceCancellations,
  parties,
  printJobs,
  saleLines,
  sales,
  serviceCommands,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPinThrottle, sessions, persons, setProfileAdmission } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listDepartments, setProfileServiceAccess, setRoutingCell } from "@waitron/venue-service";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancellationRefundValue } from "./cancellation-refund-value.js";
import { AppError } from "@waitron/shared";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { createStation } from "./kitchen.js";
import { storePrepayMadeHere } from "./made-here.js";
import { advanceTicketItem } from "./working-order.js";
import {
  billWith,
  inTx,
  PINS,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { send as rawPaymentSend } from "./testing/bill-venue.js";
import { createZone } from "./testing/service-zone.js";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra preparation" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    });
  },
});
afterEach(async () => {
  await watchedOrder();
  vi.restoreAllMocks();
});

async function fixture(release: "hold" | "fire" = "hold", madeHere = false) {
  const p = await billWith(
    madeHere ? { ...venue, cfg: { ...venue.cfg, sendingDeviceId: venue.deviceId } } : venue,
    [{ name: "Pizza", quantity: "2", olives: 2 }, { name: "Water" }],
    { release },
  );
  const [parent, extra, water] = await rowsOf(venue, p.billId);
  return { ...p, parent: parent!, extra: extra!, water: water! };
}
async function startedFixture() {
  const p = await fixture("fire");
  const [extra] = await venue.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, p.extra.id));
  await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, extra!.id, "preparing"));
  return p;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const path = (p: Fixture, read = false) =>
  `/api/parties/${p.partyId}/lines/${p.parent.id}/${read ? "cancellation" : "cancel-item"}`;
async function bodyFor(p: Fixture, overrides: Record<string, unknown> = {}) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  return {
    quantity: "2",
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
    outcome: "remove_charge",
    expectedPartyRevision: party!.revision,
    expectedBillRevision: bill!.revision,
    expectedContext: await readCancellationContext(venue.db, p.partyId, p.parent.id),
    submissionId: randomUUID(),
    reasonId: venue.reasonId.house,
    ...overrides,
  };
}
function post(p: Fixture, body: unknown, cookie = venue.cookie.staff, app = venue.app) {
  return send(app, cookie, "POST", path(p), body);
}
async function frozen() {
  return {
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    tickets: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    cancellations: await venue.db
      .select()
      .from(lineServiceCancellations)
      .orderBy(lineServiceCancellations.lineId),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    sales: await venue.db.select().from(sales).orderBy(sales.id),
    saleLines: await venue.db.select().from(saleLines).orderBy(saleLines.id),
    tenders: await venue.db.select().from(tenders).orderBy(tenders.id),
    payments: await venue.db.select().from(billPayments).orderBy(billPayments.id),
  };
}
async function managerReason() {
  return inTx(venue, (tx) =>
    createAdjustmentReason(tx, {
      name: `Cancel-key-${randomUUID()}`,
      names: { en: "Manager reason", es: "Motivo gerente" },
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "manager",
      approverRole: "manager",
      noteRequired: true,
    }),
  );
}

describe("the public cancellation read and command", () => {
  it.each([
    { reasonId: undefined, code: "management.request_invalid", status: 400 },
    { reasonId: "", code: "management.request_invalid", status: 400 },
    { reasonId: "wrong-action", code: "adjustment.action_not_allowed", status: 409 },
    { reasonId: "note-required", code: "adjustment.note_required", status: 400 },
  ])(
    "refuses charged cancellation with invalid reason $reasonId before any write",
    async ({ reasonId, code, status }) => {
      const p = await startedFixture();
      const body = await bodyFor(p, {
        outcome: "keep_charge",
        reasonId:
          reasonId === "wrong-action"
            ? venue.reasonId.complaint
            : reasonId === "note-required"
              ? venue.reasonId.mistake
              : reasonId,
      });
      const before = await frozen();
      const result = await post(p, body);
      expect(result.status).toBe(status);
      expect(result.json).toMatchObject({ code });
      expect(await frozen()).toEqual(before);
    },
  );

  it("carries preparation Yes through HTTP and records started service cancellation", async () => {
    const p = await fixture("fire");
    const body = await bodyFor(p, { outcome: "keep_charge", preparationStarted: true });
    const before = await frozen();
    const answer = await post(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    expect(await rowsOf(venue, p.billId)).toEqual([p.parent, p.extra, p.water]);
    expect(after.cancellations.find((row) => row.lineId === p.parent.id)).toMatchObject({
      quantity: 2000,
      wasStarted: true,
    });
    for (const key of ["sales", "saleLines", "payments", "tenders"] as const)
      expect(after[key]).toEqual(before[key]);
    expect((await post(p, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
    const conflict = await post(p, { ...body, preparationStarted: false });
    expect(conflict.status).toBe(409);
    expect(conflict.json).toMatchObject({ code: "submission.id_reused" });
    expect(await frozen()).toEqual(after);
  });

  it("checks the reason's PIN before the write lock after preparation Yes", async () => {
    const p = await fixture("fire");
    const reason = await managerReason();
    const body = await bodyFor(p, {
      preparationStarted: true,
      reasonId: reason.id,
      note: "guest changed their mind",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      withTransaction(venue.db, (tx) => tx.execute(sql`select 1`)),
    );
    const answer = await post(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(watchedDerivationCount()).toBe(1);
    expect(
      (await frozen()).adjustments.filter((row) => row.workingOrderId === p.billId),
    ).toMatchObject([{ approvedBy: venue.managerId, note: "guest changed their mind" }]);
    expect(await rowsOf(venue, p.billId)).toEqual([p.water]);
    expect(JSON.stringify((await frozen()).commands)).not.toContain(`"${PINS.manager}"`);
  });

  it("removes fired food without a reason after preparation No", async () => {
    const p = await fixture("fire");
    const answer = await post(
      p,
      await bodyFor(p, { preparationStarted: false, reasonId: undefined }),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await rowsOf(venue, p.billId)).toEqual([p.water]);
    expect((await frozen()).adjustments.filter((row) => row.workingOrderId === p.billId)).toEqual(
      [],
    );
  });

  it.each([[null], ["yes"], [1], [[]], [{}]])(
    "refuses malformed preparation answer %j without writes",
    async (preparationStarted) => {
      const p = await fixture("fire");
      const body = await bodyFor(p, { preparationStarted });
      const before = await frozen();
      const refused = await post(p, body);
      expect(refused.status).toBe(400);
      expect(refused.json).toEqual({
        code: "management.request_invalid",
        params: { field: "preparationStarted" },
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it("refuses preparation Yes on held food through HTTP without writes", async () => {
    const p = await fixture("hold");
    const body = await bodyFor(p, { preparationStarted: true });
    const before = await frozen();
    const refused = await post(p, body);
    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({
      code: "management.request_invalid",
      params: { field: "preparationStarted" },
    });
    expect(await frozen()).toEqual(before);
  });

  it.each(["hold", "fire"] as const)(
    "removes unpaid unstarted %s food through HTTP with no reason and no adjustment",
    async (release) => {
      const p = await fixture(release);
      const body = await bodyFor(p, { reasonId: undefined });
      const result = await post(p, body);
      expect(result.status, JSON.stringify(result.json)).toBe(200);
      expect(await rowsOf(venue, p.billId)).toEqual([p.water]);
      const after = await frozen();
      expect(after.adjustments.filter((a) => a.workingOrderId === p.billId)).toEqual([]);
      expect((await post(p, body)).json).toEqual(result.json);
      expect(await frozen()).toEqual(after);
    },
  );

  it("does not check a supplied reason's PIN for removing unpaid unstarted food", async () => {
    const p = await fixture();
    const reason = await managerReason();
    watchDerivationsAndLock(venue.db, "9999", async () => {});
    const answer = await post(
      p,
      await bodyFor(p, {
        reasonId: reason.id,
        approver: { personId: venue.managerId, pin: "9999" },
      }),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(watchedDerivationCount()).toBe(0);
    expect(await rowsOf(venue, p.billId)).toEqual([p.water]);
    expect((await frozen()).adjustments.filter((a) => a.workingOrderId === p.billId)).toEqual([]);
  });

  it("refuses removing an unstarted dish quantity already paid for", async () => {
    const p = await fixture();
    const paid = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/working-orders/${p.billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: p.parent.lineNo }],
        method: "cash",
        tendered: "24.00",
        applied: "24.00",
        tip: "0.00",
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const body = await bodyFor(p, { reasonId: undefined });
    const before = await frozen();
    const refused = await post(p, body);
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "bill.line_paid",
      params: { workingOrderId: p.billId, lineNo: p.parent.lineNo },
    });
    expect(await frozen()).toEqual(before);
  });

  it("identifies the cancelled dish's own filed sale among paid party bills without writing", async () => {
    const first = await fixture();
    const second = await fixture("fire");
    for (const p of [first, second])
      await payWorkingOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        { id: p.billId, tender: { method: "cash", amount: "26.00" }, lines: [] },
      );
    const before = await frozen();
    const firstSale = before.sales.find((sale) => sale.workingOrderId === first.billId)!;
    const secondSale = before.sales.find((sale) => sale.workingOrderId === second.billId)!;
    expect(firstSale.id).not.toBe(secondSale.id);
    for (const [p, sale] of [
      [first, firstSale],
      [second, secondSale],
    ] as const) {
      const read = await send(venue.app, venue.cookie.staff, "GET", path(p, true));
      expect(read.status).toBe(200);
      expect(read.json).toMatchObject({ billId: p.billId, saleId: sale.id });
    }
    expect(await frozen()).toEqual(before);
  });

  it("reads the filed family value through stored-number gaps, excluding another dish and without writes", async () => {
    const p = await fixture();
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ lineNo: sql`${workingOrderLines.lineNo} + 10` })
        .where(eq(workingOrderLines.workingOrderId, p.billId)),
    );
    await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
      id: p.billId,
      tender: { method: "cash", amount: "26.00" },
      lines: [],
    });
    const before = await frozen();
    const result = await send(venue.app, venue.cookie.staff, "GET", path(p, true));
    expect(result.status).toBe(200);
    expect(result.json.refundValue).toEqual({ quantity: "2.000", gross: "24.00" });
    expect(await frozen()).toEqual(before);
  });

  it.each(["quantity", "length"] as const)(
    "does not value mismatched %s compositions",
    async (shape) => {
      const p = await fixture();
      const other = await billWith(
        venue,
        shape === "length"
          ? [{ name: "Water" }]
          : [{ name: "Pizza", olives: 2 }, { name: "Water" }],
      );
      await payWorkingOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        { id: other.billId, tender: { method: "cash", amount: "26.00" }, lines: [] },
      );
      const [sale] = await venue.db
        .select()
        .from(sales)
        .where(eq(sales.workingOrderId, other.billId));
      const before = await frozen();
      expect(
        await inTx(venue, (tx) => cancellationRefundValue(tx, p.billId, sale!.id, p.parent.id)),
      ).toBeUndefined();
      expect(await frozen()).toEqual(before);
    },
  );

  it("reads every component and both revisions without updating device activity", async () => {
    const p = await fixture();
    const body = await bodyFor(p);
    await inTx(venue, (tx) =>
      tx
        .update(devices)
        .set({ lastSeenAt: "2026-01-01T00:00:00.000Z" })
        .where(eq(devices.id, venue.deviceId)),
    );
    const before = await frozen();
    const result = await send(venue.app, venue.cookie.staff, "GET", path(p, true));
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      context: body.expectedContext,
      revision: body.expectedPartyRevision,
      billRevision: body.expectedBillRevision,
      billId: p.billId,
    });
    expect(
      (await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!.lastSeenAt,
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(await frozen()).toEqual(before);
  });

  it("cancels an unpaid dish once and replays after its bill row has gone", async () => {
    const p = await fixture();
    const body = await bodyFor(p);
    const first = await post(p, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toEqual({ revision: body.expectedPartyRevision + 1 });
    expect(await rowsOf(venue, p.billId)).toEqual([p.water]);
    const after = await frozen();
    expect(after.adjustments.filter((a) => a.workingOrderId === p.billId)).toHaveLength(0);
    expect((await post(p, body)).json).toEqual(first.json);
    expect(await frozen()).toEqual(after);
  });

  it.each(["hold", "fire"] as const)(
    "reads and keeps the payment of a genuinely paid %s dish",
    async (release) => {
      const p = await fixture(release);
      await payWorkingOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        {
          id: p.billId,
          tender: { method: "cash", amount: "26.00" },
          lines: [],
        },
      );
      const before = await frozen();
      const ordinary = await send(
        venue.app,
        venue.cookie.staff,
        "GET",
        `/api/working-orders/${p.billId}/lines`,
      );
      expect(ordinary.status).toBe(409);
      expect(ordinary.json).toEqual({ code: "tab.not_open", params: { tabId: p.billId } });
      const read = await send(venue.app, venue.cookie.staff, "GET", path(p, true));
      expect(read.status).toBe(200);
      expect(read.json).toMatchObject({ context: { billStatus: "settled" }, billId: p.billId });
      const body = await bodyFor(p, { outcome: "keep_charge" });
      const kept = await post(p, body);
      expect(kept.status, JSON.stringify(kept.json)).toBe(200);
      const after = await frozen();
      for (const key of ["bills", "lines", "sales", "saleLines", "tenders", "payments"] as const)
        expect(after[key]).toEqual(before[key]);
      expect(after.adjustments.filter((row) => row.workingOrderId === p.billId)).toMatchObject([
        {
          lineId: p.parent.id,
          reasonId: venue.reasonId.house,
          action: "cancel",
          reduction: 0,
          beforeAmount: 2400,
          afterAmount: 2400,
          nominalValue: 2400,
          quantity: 2000,
          approvedBy: null,
        },
      ]);
      expect(after.adjustments).toHaveLength(before.adjustments.length + 1);
      expect(after.cancellations.find((c) => c.lineId === p.parent.id)?.quantity).toBe(2000);
      expect((await post(p, body)).json).toEqual(kept.json);
      expect(await frozen()).toEqual(after);
    },
  );

  it("returns fresh context when an extra starts without either revision changing", async () => {
    const p = await fixture("fire");
    const body = await bodyFor(p);
    const [item] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.extra.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, item!.id, "preparing"));
    const before = await frozen();
    const refused = await post(p, body);
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "tab.cancel_context_changed",
      params: { context: await readCancellationContext(venue.db, p.partyId, p.parent.id) },
    });
    expect(await frozen()).toEqual(before);
    expect((await post(p, await bodyFor(p))).status).toBe(200);
  });

  it.each(["GET", "POST"])("requires a session for %s", async (method) => {
    const p = await fixture();
    const before = await frozen();
    const result = await send(
      venue.app,
      "",
      method,
      path(p, method === "GET"),
      method === "GET" ? undefined : await bodyFor(p),
    );
    expect(result.status).toBe(401);
    expect(result.json).toEqual({ code: "session.required", params: {} });
    expect(await frozen()).toEqual(before);
  });

  it.each(["GET", "POST"])(
    "requires take-orders for %s and permits it once restored",
    async (method) => {
      const p = await fixture();
      const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
      const [profile] = await venue.db
        .select()
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, device!.deviceProfileId));
      const capabilities = profile!.capabilities;
      const body = await bodyFor(p);
      const call = () =>
        send(
          venue.app,
          venue.cookie.staff,
          method,
          path(p, method === "GET"),
          method === "GET" ? undefined : body,
        );
      try {
        await inTx(venue, (tx) =>
          tx
            .update(deviceProfiles)
            .set({ capabilities: [] })
            .where(eq(deviceProfiles.id, profile!.id)),
        );
        const before = await frozen();
        const result = await call();
        expect(result.status).toBe(403);
        expect(result.json).toMatchObject({
          code: "device.forbidden_action",
          params: { action: "take-orders" },
        });
        expect(await frozen()).toEqual(before);
      } finally {
        await inTx(venue, (tx) =>
          tx.update(deviceProfiles).set({ capabilities }).where(eq(deviceProfiles.id, profile!.id)),
        );
      }
      expect((await call()).status).toBe(200);
    },
  );

  it.each(["GET", "POST"])(
    "checks the party zone for %s and admits it once allowed",
    async (method) => {
      const p = await fixture();
      const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
      const profileId = device!.deviceProfileId;
      const elsewhere = await inTx(venue, (tx) =>
        createZone(tx, venue.cfg, { name: `Elsewhere-${randomUUID()}` }),
      );
      const [department] = await listDepartments(venue.db, venue.cfg);
      const body = await bodyFor(p);
      const call = () =>
        send(
          venue.app,
          venue.cookie.staff,
          method,
          path(p, method === "GET"),
          method === "GET" ? undefined : body,
        );
      try {
        await inTx(venue, (tx) =>
          setProfileServiceAccess(tx, venue.cfg, profileId, {
            departmentId: department!.id,
            allowedZoneIds: [elsewhere.id],
            startingZoneId: elsewhere.id,
          }),
        );
        const before = await frozen();
        const result = await call();
        expect(result.status).toBe(403);
        expect(result.json).toMatchObject({ code: "service_zone.not_allowed" });
        expect(await frozen()).toEqual(before);
      } finally {
        await inTx(venue, (tx) =>
          setProfileServiceAccess(tx, venue.cfg, profileId, {
            departmentId: null,
            allowedZoneIds: null,
            startingZoneId: null,
          }),
        );
      }
      expect((await call()).status).toBe(200);
    },
  );

  it("derives a required manager PIN once outside the write lock", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const body = await bodyFor(p, {
      reasonId: reason.id,
      note: "guest changed their mind",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      withTransaction(venue.db, (tx) => tx.execute(sql`select 1`)),
    );
    const answer = await post(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(watchedDerivationCount()).toBe(1);
    const rows = (await frozen()).adjustments.filter((a) => a.workingOrderId === p.billId);
    expect(rows).toMatchObject([{ approvedBy: venue.managerId, note: "guest changed their mind" }]);
    expect(JSON.stringify((await frozen()).commands)).not.toContain(`"${PINS.manager}"`);
  });

  it("counts wrong manager PINs on the existing device throttle", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const throttle = createPinThrottle({ now: () => 1_000_000 });
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: venue.venueLocale,
        secureCookies: false,
        pinThrottle: throttle,
      },
      () => {},
    );
    const body = await bodyFor(p, {
      reasonId: reason.id,
      note: "test",
      approver: { personId: venue.managerId, pin: "9999" },
    });
    const before = await frozen();
    for (let i = 0; i < 4; i++) {
      const answer = await post(p, body, venue.cookie.staff, app);
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "pin.invalid" });
    }
    const refused = await post(
      p,
      { ...body, approver: { personId: venue.managerId, pin: PINS.manager } },
      venue.cookie.staff,
      app,
    );
    expect(refused.status).toBe(429);
    expect(refused.json).toMatchObject({ code: "pin.throttled" });
    expect(await frozen()).toEqual(before);
  });

  it("files and replays an off-bill cancellation that leaves a partial payment exactly sufficient", async () => {
    const p = await fixture();
    const paid = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/working-orders/${p.billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: p.water.lineNo, quantity: "1" }],
        method: "cash",
        tendered: "2.00",
        applied: "2.00",
        tip: "0.00",
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const body = await bodyFor(p);
    const before = await frozen();
    const answer = await post(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    const issued = after.sales.filter((s) => s.workingOrderId === p.billId);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ total: 200 });
    expect(after.saleLines.filter((l) => l.saleId === issued[0]!.id)).toMatchObject([
      { quantity: 1000, lineGross: 200 },
    ]);
    expect(after.tenders.filter((t) => t.saleId === issued[0]!.id)).toMatchObject([
      { amount: 200, method: "cash" },
    ]);
    expect(after.bills.find((b) => b.id === p.billId)?.status).toBe("settled");
    expect(after.payments).toEqual(before.payments);
    expect((await post(p, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
  });

  it("replays the made-here answer after cancellation deletes its subject line", async () => {
    await inTx(venue, (tx) =>
      tx
        .insert(deviceMadeHereStations)
        .values({ deviceId: venue.deviceId, stationId: venue.stationId }),
    );
    try {
      const p = await fixture("hold", true);
      await inTx(venue, (tx) => storePrepayMadeHere(tx, p.billId, [p.water.id]));
      const [waterTicket] = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, p.water.id));
      expect(waterTicket).toMatchObject({ madeHere: true, state: "ready" });
      const payment = await send(
        venue.app,
        venue.cookie.staff,
        "POST",
        `/api/working-orders/${p.billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "items",
          lines: [{ lineNo: p.water.lineNo, quantity: "1" }],
          method: "cash",
          tendered: "2.00",
          applied: "2.00",
          tip: "0.00",
        },
      );
      expect(payment.status).toBe(200);
      const body = await bodyFor(p);
      const first = await post(p, body);
      expect(first.status).toBe(200);
      expect(first.json).toMatchObject({
        madeHere: [{ lineId: p.water.id, quantity: "1.000", name: "Water" }],
      });
      const beforeReplay = await frozen();
      const second = await post(p, body);
      expect(second.status).toBe(200);
      expect(second.json).toEqual(first.json);
      expect(await frozen()).toEqual(beforeReplay);
    } finally {
      await inTx(venue, (tx) =>
        tx
          .delete(deviceMadeHereStations)
          .where(eq(deviceMadeHereStations.deviceId, venue.deviceId)),
      );
    }
  });

  it("rolls back cancellation, kitchen corrections and commands when filing refuses", async () => {
    const p = await fixture();
    const paid = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/working-orders/${p.billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: p.water.lineNo, quantity: "1" }],
        method: "cash",
        tendered: "2.00",
        applied: "2.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    const body = await bodyFor(p);
    const before = await frozen();
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(
      new AppError("series.not_found", { seriesId: venue.seriesId }),
    );
    const answer = await post(p, body);
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({ code: "series.not_found", params: { seriesId: venue.seriesId } });
    expect(await frozen()).toEqual(before);
    expect((await post(p, body)).status).toBe(200);
  });

  it("uses the venue language for the recorded reason when the request configuration differs", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: "en-GB",
        secureCookies: false,
      },
      () => {},
    );
    const answer = await post(
      p,
      await bodyFor(p, {
        reasonId: reason.id,
        note: "test",
        approver: { personId: venue.managerId, pin: PINS.manager },
      }),
      venue.cookie.staff,
      app,
    );
    expect(answer.status).toBe(200);
    expect(
      (await frozen()).adjustments.find((a) => a.workingOrderId === p.billId)?.reasonName,
    ).toBe("Manager reason");
  });

  it("refuses a session ended while its manager PIN is being checked", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const body = await bodyFor(p, {
      reasonId: reason.id,
      note: "test",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    const before = await frozen();
    const sessionRows = await venue.db
      .select()
      .from(sessions)
      .where(eq(sessions.personId, venue.staffId));
    const endedAt = "2026-10-17T00:00:00.000Z";
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      inTx(venue, (tx) =>
        tx.update(sessions).set({ endedAt }).where(eq(sessions.id, sessionRows[0]!.id)),
      ),
    );
    try {
      const answer = await post(p, body);
      expect(answer.status).toBe(401);
      expect(answer.json).toEqual({ code: "session.required", params: {} });
      expect(await watchedOrder()).toEqual(["writer", "derived"]);
      expect(await frozen()).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        tx.update(sessions).set({ endedAt: null }).where(eq(sessions.id, sessionRows[0]!.id)),
      );
    }
  });

  it("checks the new profile's zones when the device changes profile during its PIN check", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const body = await bodyFor(p, {
      reasonId: reason.id,
      note: "test",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    const elsewhere = await inTx(venue, (tx) =>
      createZone(tx, venue.cfg, { name: `Other-${randomUUID()}` }),
    );
    const [department] = await listDepartments(venue.db, venue.cfg);
    const profile = await inTx(venue, async (tx) => {
      const [created] = await tx
        .insert(deviceProfiles)
        .values({
          name: `Other-${randomUUID()}`,
          formFactor: "till",
          capabilities: ["take-orders"],
        })
        .returning();
      await setProfileServiceAccess(tx, venue.cfg, created!.id, {
        departmentId: department!.id,
        allowedZoneIds: [elsewhere.id],
        startingZoneId: elsewhere.id,
      });
      return created!;
    });
    const before = await frozen();
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      inTx(venue, (tx) =>
        tx
          .update(devices)
          .set({ deviceProfileId: profile.id })
          .where(eq(devices.id, venue.deviceId)),
      ),
    );
    try {
      const result = await post(p, body);
      expect(result.status).toBe(403);
      expect(result.json).toMatchObject({ code: "service_zone.not_allowed" });
      expect(await watchedOrder()).toEqual(["writer", "derived"]);
      expect(await frozen()).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(devices)
          .set({ deviceProfileId: device!.deviceProfileId })
          .where(eq(devices.id, venue.deviceId)),
      );
    }
  });

  it.each(["GET", "POST"])("checks current profile admission for %s", async (method) => {
    const p = await fixture();
    const body = await bodyFor(p);
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    const before = await frozen();
    try {
      await inTx(venue, (tx) =>
        setProfileAdmission(tx, device!.deviceProfileId, {
          personExceptions: [{ personId: venue.staffId, admitted: false }],
        }),
      );
      const result = await send(
        venue.app,
        venue.cookie.staff,
        method,
        path(p, method === "GET"),
        method === "GET" ? undefined : body,
      );
      expect(result.status).toBe(403);
      expect(result.json).toEqual({ code: "device_profile.not_admitted", params: {} });
      expect(await frozen()).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        setProfileAdmission(tx, device!.deviceProfileId, { personExceptions: [] }),
      );
    }
  });

  it("keeps a started dish charged without deriving an irrelevant approver PIN", async () => {
    const p = await fixture("fire");
    const [item] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.parent.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, item!.id, "preparing"));
    const body = await bodyFor(p, {
      outcome: "keep_charge",
      approver: { personId: venue.managerId, pin: "9999" },
    });
    watchDerivationsAndLock(venue.db, "9999");
    const result = await post(p, body);
    expect(result.status).toBe(200);
    expect(await watchedOrder()).toEqual([]);
    expect(watchedDerivationCount()).toBe(0);
    expect((await frozen()).cancellations.find((c) => c.lineId === p.parent.id)?.quantity).toBe(
      2000,
    );
  });

  it("records the admitted actor's attendance once through the public command", async () => {
    const p = await fixture("fire");
    const [item] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.parent.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, item!.id, "preparing"));
    const body = await bodyFor(p, { outcome: "keep_charge" });
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: venue.venueLocale,
        secureCookies: false,
        attendance: recordAttendanceFact,
      },
      () => {},
    );
    const first = await post(p, body, venue.cookie.staff, app);
    expect(first.status).toBe(200);
    const key = `service:${p.billId}:party:${p.partyId}:${body.submissionId}`;
    const facts = await venue.db
      .select()
      .from(attendanceOperationFacts)
      .where(eq(attendanceOperationFacts.key, key));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      source: "order",
      personId: venue.staffId,
      locationId: venue.cfg.locationId,
      kind: "order",
    });
    expect((await post(p, body, venue.cookie.staff, app)).json).toEqual(first.json);
    expect(
      await venue.db
        .select()
        .from(attendanceOperationFacts)
        .where(eq(attendanceOperationFacts.key, key)),
    ).toEqual(facts);
  });

  it("refuses take-orders revoked during a manager PIN check", async () => {
    const p = await startedFixture();
    const reason = await managerReason();
    const body = await bodyFor(p, {
      reasonId: reason.id,
      note: "test",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    const [profile] = await venue.db
      .select()
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, device!.deviceProfileId));
    const before = await frozen();
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      inTx(venue, (tx) =>
        tx
          .update(deviceProfiles)
          .set({ capabilities: [] })
          .where(eq(deviceProfiles.id, profile!.id)),
      ),
    );
    try {
      const result = await post(p, body);
      expect(result.status).toBe(403);
      expect(result.json).toEqual({
        code: "device.forbidden_action",
        params: { action: "take-orders" },
      });
      expect(await watchedOrder()).toEqual(["writer", "derived"]);
      expect(await frozen()).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(deviceProfiles)
          .set({ capabilities: profile!.capabilities })
          .where(eq(deviceProfiles.id, profile!.id)),
      );
    }
  });

  it.each(["GET", "POST"])("refuses a suspended operator on %s", async (method) => {
    const p = await fixture();
    const body = await bodyFor(p);
    const before = await frozen();
    try {
      await inTx(venue, (tx) =>
        tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, venue.staffId)),
      );
      const answer = await send(
        venue.app,
        venue.cookie.staff,
        method,
        path(p, method === "GET"),
        method === "GET" ? undefined : body,
      );
      expect(answer.status).toBe(403);
      expect(answer.json).toEqual({ code: "device_profile.not_admitted", params: {} });
      expect(await frozen()).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        tx.update(persons).set({ status: "active" }).where(eq(persons.id, venue.staffId)),
      );
    }
  });

  it.each([
    ["outcome", null],
    ["outcome", ["remove_charge"]],
    ["outcome", "refund"],
    ["quantity", null],
    ["quantity", 2],
    ["quantity", ["2"]],
    ["expectedPartyRevision", "1"],
    ["expectedPartyRevision", -1],
    ["expectedBillRevision", null],
    ["expectedBillRevision", 1.5],
    ["reasonId", null],
    ["note", null],
    ["note", 3],
    ["note", "x".repeat(501)],
    ["approver", null],
    ["approver", []],
    ["approver", "person"],
    ["expectedContext", null],
    ["expectedContext", []],
  ])("refuses malformed %s (%j) without a write", async (field, value) => {
    const p = await fixture();
    const body = await bodyFor(p, { [field as string]: value });
    const before = await frozen();
    const result = await post(p, body);
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ code: "management.request_invalid", params: { field } });
    expect(await frozen()).toEqual(before);
  });

  it.each([
    ["billStatus", ["open"]],
    ["billStatus", "unknown"],
    ["stage", null],
    ["stage", ["not_started"]],
    ["components", null],
    ["components", []],
    ["components", [null]],
    ["components", [[]]],
  ])("refuses malformed context %s (%j) without a write", async (field, value) => {
    const p = await fixture();
    const body = await bodyFor(p);
    const before = await frozen();
    const result = await post(p, {
      ...body,
      expectedContext: { ...body.expectedContext, [field as string]: value },
    });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      code: "management.request_invalid",
      params: { field: "expectedContext" },
    });
    expect(await frozen()).toEqual(before);
  });

  it.each([
    ["id", undefined],
    ["lineId", null],
    ["state", ["queued"]],
    ["firedAt", undefined],
    ["firedAt", "not-a-date"],
    ["quantity", 2],
    ["quantity", "2"],
    ["kitchenQuantity", undefined],
    ["servedQuantity", "-1.000"],
    ["cancelledQuantity", null],
  ])("refuses malformed component %s (%j) without a write", async (field, value) => {
    const p = await fixture();
    const body = await bodyFor(p);
    const context = body.expectedContext;
    const before = await frozen();
    const result = await post(p, {
      ...body,
      expectedContext: {
        ...context,
        components: [
          { ...context.components[0], [field as string]: value },
          ...context.components.slice(1),
        ],
      },
    });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      code: "management.request_invalid",
      params: { field: "expectedContext" },
    });
    expect(await frozen()).toEqual(before);
  });

  it.each(["GET", "POST"])(
    "refuses a different party or an extra as the %s subject",
    async (method) => {
      const p = await fixture();
      const other = await fixture();
      const before = await frozen();
      const wrongParty = await send(
        venue.app,
        venue.cookie.staff,
        method,
        path({ ...p, partyId: other.partyId }, method === "GET"),
        method === "GET" ? undefined : await bodyFor(p),
      );
      expect(wrongParty.status).toBe(409);
      expect(wrongParty.json).toMatchObject({ code: "bill.other_party" });
      const extra = await send(
        venue.app,
        venue.cookie.staff,
        method,
        path({ ...p, parent: p.extra }, method === "GET"),
        method === "GET" ? undefined : await bodyFor(p),
      );
      expect(extra.status).toBe(400);
      expect(extra.json).toEqual({
        code: "management.request_invalid",
        params: { field: "lineId" },
      });
      expect(await frozen()).toEqual(before);
    },
  );
});

const send = observedPaymentSender(() => venue.db, rawPaymentSend);
