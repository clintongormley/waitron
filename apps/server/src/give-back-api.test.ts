import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, invoiceCorrections, refunds, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { DEVICE_COOKIE } from "./device-session.js";
import type { GiveBackView } from "./give-back.js";
import { advanceBills, provisionAdvanceVenue, type AdvanceVenue } from "./testing/advance-bills.js";
import { inTx, send } from "./testing/bill-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { SESSION_COOKIE } from "./till-session.js";

let advanceVenue: AdvanceVenue;
/** A till of its own, signed in, whose profile serves only a zone where no test sells. */
let zonedTill: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
    const profileId = await withTransaction(db, async (tx) => {
      const department = await createDepartment(tx, { name: "Interior", orderStart: "table" });
      const zone = await createServiceZone(tx, { name: "Interior", departmentId: department.id });
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Zoned till",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      });
      const [policy] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, zone.id));
      await setProfileServiceAccess(tx, profile!.id, {
        departmentId: policy!.departmentId,
        allowedZoneIds: [zone.id],
        startingZoneId: zone.id,
      });
      return profile!.id;
    });
    const device = await enrolDeviceForTest(db, advanceVenue.venue.cfg, {
      name: "Zoned till",
      profileId,
    });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, {
        deviceId: device.deviceId,
        personId: advanceVenue.venue.operatorId,
        pin: "5555",
      }),
    );
    zonedTill = `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  },
});

const venue = () => advanceVenue.venue;
const { seated, advance, payRest, restId } = advanceBills(() => advanceVenue);

const read = (saleId: string, cookie = venue().cookie) =>
  send(venue().app, cookie, "GET", `/api/transactions/${saleId}/give-back`);
const preview = (saleId: string, body: Record<string, unknown>, cookie = venue().cookie) =>
  send(venue().app, cookie, "POST", `/api/transactions/${saleId}/give-back/preview`, {
    extra: "0.00",
    way: "cash",
    ...body,
  });

/** Rows a give-back could write: refunds, corrections and sales. */
async function rowCount(): Promise<number> {
  return inTx(venue(), async (tx) => {
    const counts = await Promise.all([
      tx.select({ id: refunds.id }).from(refunds),
      tx.select({ id: invoiceCorrections.id }).from(invoiceCorrections),
      tx.select({ id: sales.id }).from(sales),
    ]);
    return counts.reduce((total, rows) => total + rows.length, 0);
  });
}

describe("GET /api/transactions/:saleId/give-back and its preview", () => {
  it("answers the read and a preview, writing nothing", async () => {
    const billId = await seated("Salad bowl");
    await payRest(billId, "20.00");
    const saleId = await restId(billId);
    const before = await rowCount();
    const view = await read(saleId);
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    expect(view.json).toMatchObject({
      ways: [{ way: "cash", moneyLeft: "20.00" }],
      choices: { goodwill: { available: true, reason: null } },
      underWay: null,
    });
    expect(await preview(saleId, { purpose: "goodwill", amount: "5.00" })).toEqual({
      status: 200,
      json: {
        parts: [{ kind: "correction", amount: "5.00", way: "cash", lineIds: [] }],
        leftUnderWay: "0.00",
        needs: ["sale.refund", "sale.rectify"],
        manual: false,
      },
    });
    expect(await rowCount()).toBe(before);
  });

  it("answers a wait with 409 and its code, as the read shows it", async () => {
    const billId = await seated("Salad bowl");
    await payRest(billId, "20.00");
    const saleId = await restId(billId);
    await inTx(venue(), (tx) => refusedByAeat(tx, saleId));
    const reason = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
    expect((await read(saleId)).json).toMatchObject({
      choices: { goodwill: { available: false, reason } },
    });
    expect(await preview(saleId, { purpose: "goodwill", amount: "5.00" })).toEqual({
      status: 409,
      json: reason,
    });
  });

  it("refuses a till whose profile does not serve the receipt's zone", async () => {
    const billId = await seated("Salad bowl");
    await payRest(billId, "20.00");
    const saleId = await restId(billId);
    const refusal = {
      status: 403,
      json: { code: "service_zone.not_allowed", params: { zoneId: venue().zoneId } },
    };
    expect(await read(saleId, zonedTill)).toEqual(refusal);
    expect(await preview(saleId, { purpose: "goodwill", amount: "5.00" }, zonedTill)).toEqual(
      refusal,
    );
  });

  it("refuses a malformed request naming its field", async () => {
    const billId = await seated("Salad bowl");
    await payRest(billId, "20.00");
    const saleId = await restId(billId);
    for (const [body, field] of [
      [{ purpose: "tip", amount: "5.00" }, "purpose"],
      [{ purpose: "goodwill", amount: "0.00" }, "amount"],
      [{ purpose: "goodwill", amount: "5.00", way: "card" }, "way"],
      [{ purpose: "dishes", amount: "5.00" }, "lineIds"],
      [{ purpose: "extra", amount: "1.00", extra: "1.00" }, "extra"],
    ] as const)
      expect(await preview(saleId, body)).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field } },
      });
  });
});

describe("POST …/give-back/preview on a part payment's ticket", () => {
  it("corrects goodwill before the table's receipt exists, and refuses it once that receipt took the payment off with money left there", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    expect(await preview(advanceId, { purpose: "goodwill", amount: "10.00" })).toMatchObject({
      status: 200,
      json: { parts: [{ kind: "correction", amount: "10.00", way: "cash", lineIds: [] }] },
    });
    await payRest(billId, "90.00");
    const finalSaleId = await restId(billId);
    const view = (await read(advanceId)).json as unknown as GiveBackView;
    const reason = view.choices.goodwill.reason!;
    expect(reason).toMatchObject({
      code: "advance.taken_off_final_invoice",
      params: { saleId: advanceId, finalSaleId, finalMoneyLeft: "90.00" },
    });
    expect(view.choices.dishes).toEqual({ available: false, reason });
    expect(view.choices.goodwill.available).toBe(false);
    expect(view.lines.map((line) => line.reason)).toEqual(view.lines.map(() => reason));
    expect(await preview(advanceId, { purpose: "goodwill", amount: "10.00" })).toEqual({
      status: 409,
      json: reason,
    });
  });
});
