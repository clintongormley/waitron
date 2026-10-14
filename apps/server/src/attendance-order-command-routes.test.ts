import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  locations,
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
import { AppError, locationId } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
import {
  parkOrder,
  placeOrder,
  setOrderInvoiceChoice,
  setOrderReceiptLanguage,
} from "./working-order.js";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";

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
const actions = ["place", "cancel", "invoice-choice", "receipt-language"] as const;
type Action = (typeof actions)[number];
async function prepare(action: Action) {
  const id = newId();
  await parkOrder({ db: suite.db }, v.cfg, {
    id,
    operatorId: v.adminId,
    zoneId: v.zoneId,
    lines: [{ menuItemId: v.offerFor("Ensalada"), quantity: "1" }],
  });
  if (action === "cancel")
    await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, v.cfg, id, v.adminId);
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
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}

describe("accepted till order command attendance", () => {
  it.each(actions)(
    "%s captures the admitted actor and trusted instant in the command transaction",
    async (action) => {
      const id = await prepare(action);
      expect(await command(api(recordAttendanceFact), id, action)).toMatchObject({ status: 200 });
      let key = `${id}:1:${action}`;
      if (action === "place" || action === "cancel") {
        const rows = await suite.db
          .select()
          .from(orderAmendments)
          .where(eq(orderAmendments.workingOrderId, id));
        const amendment = rows.find(
          (row) => row.kind === (action === "place" ? "order_placed" : "order_cancelled"),
        )!;
        expect(amendment.actorId).toBe(v.operatorId);
        key = amendment.id;
      }
      expect(
        (await state()).facts.map((r) => [
          r.source,
          r.key,
          r.personId,
          r.locationId,
          r.kind,
          r.at,
          r.offsetMinutes,
          r.outcome,
        ]),
      ).toEqual([
        [
          "order",
          key,
          v.operatorId,
          v.cfg.locationId,
          "order",
          "2026-01-05T16:40:00.000Z",
          60,
          "qualifying",
        ],
      ]);
      expect(
        (await state()).days.map((r) => [r.locationId, r.businessDay, r.dirtyRevision]),
      ).toEqual([[v.cfg.locationId, "2026-01-05", 1]]);
      const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect([order!.status, order!.revision]).toEqual([
        action === "place" ? "placed" : action === "cancel" ? "abandoned" : "open",
        action === "invoice-choice" || action === "receipt-language" ? 1 : 0,
      ]);
      if (action === "invoice-choice")
        expect(order!.invoiceDelivery).toEqual({ medium: "receipt" });
      if (action === "receipt-language") expect(order!.receiptLocale).toBe("es-ES");
    },
  );
  it.each(actions)(
    "%s rolls back its write and evidence when the recorder refuses",
    async (action) => {
      const id = await prepare(action),
        before = await state();
      const response = await command(
        api(async (tx, fact) => {
          await recordAttendanceFact(tx, fact);
          throw new AppError("attendance.invalid", { reason: "command capture refused" });
        }),
        id,
        action,
      );
      expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
      expect(await state()).toEqual(before);
    },
  );
  it.each(actions)("a repeated %s has no new clock reading or evidence", async (action) => {
    const id = await prepare(action),
      app = api(recordAttendanceFact);
    expect(await command(app, id, action)).toMatchObject({ status: 200 });
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replayed command clock");
    });
    expect(await command(app, id, action)).toMatchObject({
      status: 409,
      json: {
        code:
          action === "place"
            ? "working_order.not_open"
            : action === "cancel"
              ? "working_order.not_placed"
              : "working_order.out_of_date",
      },
    });
    expect(await state()).toEqual(before);
  });
  it.each(actions)("%s with attendance disabled creates no attendance state", async (action) => {
    const id = await prepare(action);
    expect(await command(api(), id, action)).toMatchObject({ status: 200 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
  });
  it.each(["invoice-choice", "receipt-language"] as const)(
    "%s uses the stored order location rather than the caller's config",
    async (action) => {
      const id = await prepare(action);
      const [other] = await suite.db
        .insert(locations)
        .values({
          name: "Another location",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurant",
        })
        .returning({ id: locations.id });
      const cfg = { ...v.cfg, locationId: locationId(other!.id) };
      const attendance = { recorder: recordAttendanceFact, clock: v.clock, personId: v.operatorId };
      if (action === "invoice-choice")
        await setOrderInvoiceChoice(
          suite.db,
          v.backend,
          cfg,
          id,
          { revision: 0, invoiceType: "F2", recipient: null, delivery: { medium: "receipt" } },
          undefined,
          attendance,
        );
      else
        await setOrderReceiptLanguage(
          suite.db,
          cfg,
          id,
          { revision: 0, language: "es-ES" },
          attendance,
        );
      expect((await state()).facts.map((r) => [r.personId, r.locationId, r.at])).toEqual([
        [v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"],
      ]);
      expect((await state()).days.map((r) => r.locationId)).toEqual([v.cfg.locationId]);
    },
  );
  it.each([false, true])(
    "the real unpaid-departure route captures its admitted placement atomically (recorder refused: %s)",
    async (refused) => {
      const party = await seatedWith(v, "Ensalada"),
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
        expect((await state()).facts.map((r) => [r.key, r.personId, r.locationId, r.at])).toEqual([
          [amendment!.id, v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"],
        ]);
      }
    },
  );
});
