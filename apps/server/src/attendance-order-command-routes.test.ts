import { testTradingAdmission } from "./testing/trading-admission.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  floorZones,
  newId,
  orderAmendments,
  parties,
  sales,
  ticketItems,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { setDepartmentSalePolicyField } from "@waitron/venue-service";
import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
import { parkOrder } from "./working-order-open.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({
    ...reading,
    instant: new Date("2026-01-05T16:40:00.987Z"),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function api(attendance?: AttendanceRecorder) {
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es",
      attendance,
    },
    () => {},
  );
  return app;
}
const actions = ["place", "cancel", "invoice-choice", "receipt-language", "dining"] as const;
type Action = (typeof actions)[number];
async function prepare(action: Action) {
  const id = newId();
  await parkOrder({ db: suite.db }, v.cfg, {
    id,
    operatorId: v.adminId,
    zoneId: v.zoneId,
    lines: [{ menuItemId: v.offerFor("House salad"), quantity: "1" }],
  });
  if (action === "dining")
    await inTx(v, async (tx) => {
      const [zone] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, v.zoneId));
      await setDepartmentSalePolicyField(tx, zone!.departmentId!, "dining", "till_choice");
    });
  if (action === "cancel")
    await placeOrder(
      { admission: testTradingAdmission(), db: suite.db, backend: v.backend, clock: v.clock },
      v.cfg,
      id,
      v.adminId,
    );
  return id;
}
function command(app: Hono, id: string, action: Action) {
  const extra = {
    personId: v.adminId,
    operatorId: v.adminId,
    at: "2026-01-06T22:00:00Z",
    offsetMinutes: -600,
  };
  const body =
    action === "cancel"
      ? { reason: "Guest left" }
      : action === "invoice-choice"
        ? { revision: 0, invoiceType: "F2", recipient: null, delivery: { medium: "receipt" } }
        : action === "receipt-language"
          ? { revision: 0, language: "es-ES" }
          : action === "dining"
            ? { revision: 0, dining: "takeaway", expectedEdit: null }
            : {};
  return send(
    app,
    v.cookie,
    action === "place" || action === "cancel" ? "POST" : "PUT",
    `/api/working-orders/${id}/${action}`,
    { ...body, ...extra },
  );
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    amendments: await suite.db.select().from(orderAmendments),
    tickets: await suite.db.select().from(ticketItems),
    sales: await suite.db.select().from(sales),
    parties: await suite.db.select().from(parties),
    departures: await suite.db.select().from(unpaidDepartures),
    facts: await suite.db.select().from(staffActivity),
    days: await suite.db.select().from(attendanceDays),
  };
}

describe("accepted till order command attendance", () => {
  it.each(actions)(
    "%s captures the admitted actor and trusted instant in the command transaction",
    async (action) => {
      const id = await prepare(action);
      expect(await command(api(recordAttendanceFact), id, action)).toMatchObject({ status: 200 });

      if (action === "place" || action === "cancel") {
        const rows = await suite.db
          .select()
          .from(orderAmendments)
          .where(eq(orderAmendments.workingOrderId, id));
        const amendment = rows.find(
          (row) => row.kind === (action === "place" ? "order_placed" : "order_cancelled"),
        )!;
        expect(amendment.actorId).toBe(v.operatorId);
      }
      expect((await state()).facts.map((row) => [row.personId, row.lastAt])).toEqual([
        [v.operatorId, "2026-01-05T16:40:00.000Z"],
      ]);
      expect((await state()).days.map((r) => [r.businessDay, r.dirtyRevision])).toEqual([
        ["2026-01-05", 1],
      ]);
      const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect([order!.status, order!.revision]).toEqual([
        action === "place" ? "placed" : action === "cancel" ? "abandoned" : "open",
        ["invoice-choice", "receipt-language", "dining"].includes(action) ? 1 : 0,
      ]);
      if (action === "invoice-choice")
        expect(order!.invoiceDelivery).toEqual({ medium: "receipt" });
      if (action === "receipt-language") expect(order!.receiptLocale).toBe("es-ES");
      if (action === "dining") expect(order!.dining).toBe("takeaway");
    },
  );
  it.each([false, true])(
    "the real unpaid-departure route captures its admitted placement atomically (recorder refused: %s)",
    async (refused) => {
      const party = await seatedWith(v, "House salad"),
        before = await state();
      const recorder: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (refused)
          throw new AppError("attendance.invalid", { reason: "departure capture refused" });
      };
      const response = await send(
        api(recorder),
        v.cookie,
        "POST",
        `/api/parties/${party.partyId}/unpaid-departure`,
        {
          billId: party.tabId,
          expectedEdits: await closingEditsForTest(suite.db, party.partyId),
          expectedPartyRevision: party.revision,
          reason: "Guests left",
          operatorId: v.adminId,
          at: "2026-01-06T22:00:00Z",
          override: { personId: v.adminId, pin: "1234" },
        },
      );
      if (refused) {
        expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
        expect(await state()).toEqual(before);
      } else {
        expect(response).toMatchObject({
          status: 200,
          json: { state: "closed", departures: [{ workingOrderId: party.tabId, amount: "12.00" }] },
        });
        const [amendment] = (await state()).amendments.filter(
          (row) => row.workingOrderId === party.tabId && row.kind === "order_placed",
        );
        expect(amendment!.actorId).toBe(v.operatorId);
        expect((await state()).facts.map((row) => [row.personId, row.lastAt])).toEqual([
          [v.operatorId, "2026-01-05T16:40:00.000Z"],
        ]);
      }
    },
  );
});
