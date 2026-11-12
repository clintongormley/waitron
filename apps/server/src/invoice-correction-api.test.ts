import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deviceProfiles, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { readBillEditState } from "./bill-editing.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let venue: BillVenue;
/** A till of its own, signed in, whose profile `serveOnly` limits to one zone. */
let zonedTill: { cookie: string; profileId: string };
/** A zone in a department of its own, where no test sells. */
let otherZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const profileId = await inTx(venue, async (tx) => {
      const department = await createDepartment(tx, { name: "Interior", orderStart: "table" });
      otherZone = (await createServiceZone(tx, { name: "Interior", departmentId: department.id }))
        .id;
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({
          name: "Zoned till",
          formFactor: "till",
          capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
        })
        .returning({ id: deviceProfiles.id });
      return profile!.id;
    });
    const device = await enrolDeviceForTest(db, venue.cfg, { name: "Zoned till", profileId });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId: device.deviceId, personId: venue.operatorId, pin: "5555" }),
    );
    zonedTill = {
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      profileId,
    };
  },
});

async function serveOnly(zoneId: string) {
  await inTx(venue, async (tx) => {
    const [policy] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId));
    await setProfileServiceAccess(tx, zonedTill.profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [zoneId],
      startingZoneId: zoneId,
    });
  });
}

/** A €10.00 croquettes order paid through the till in `parts`; issued unpaid when `parts` is empty. */
async function sold(parts: readonly (string | { card: string })[]) {
  const id = randomUUID();
  const deps = {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  if (parts.length === 0) await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  for (const part of parts) {
    const amount = typeof part === "string" ? part : part.card;
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      ...(typeof part === "string"
        ? { method: "cash", tendered: amount }
        : { method: "card", entry: "manual" }),
      applied: amount,
      tip: "0.00",
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
    });
    expect(paid.status).toBe(200);
  }
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
  return brandSaleId(sale!.id);
}

const SPLIT = [{ rate: "21.00", base: "4.13", tax: "0.87" }];
const preview = (saleId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/transactions/${saleId}/corrections/preview`, payload);

const ZONE_REFUSED = () => ({
  status: 403,
  json: { code: "service_zone.not_allowed", params: { zoneId: venue.zoneId } },
});

describe("POST /api/transactions/:saleId/corrections/preview", () => {
  it("answers the split and the cash still refundable, and refuses malformed line ids", async () => {
    const saleId = await sold(["10.00"]);
    expect(await preview(saleId, { gross: "5.00" })).toMatchObject({
      status: 200,
      json: { gross: "5.00", vatBreakdown: SPLIT, moneyRefundable: "10.00" },
    });
    for (const lineIds of [null, "x", ["not-a-uuid"]])
      expect(await preview(saleId, { gross: "5.00", lineIds })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "lineIds" } },
      });
    for (const gross of [5, "06.05", "00.50"])
      expect(await preview(saleId, { gross })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "gross" } },
      });
    expect(await preview(saleId, { gross: "0.50" })).toMatchObject({
      status: 200,
      json: { gross: "0.50" },
    });
  });

  it("refuses a till outside the invoice's zone, and answers it once the zone is its own", async () => {
    const saleId = await sold(["10.00"]);
    await serveOnly(otherZone);
    expect(await preview(saleId, { gross: "5.00" }, zonedTill.cookie)).toEqual(ZONE_REFUSED());
    await serveOnly(venue.zoneId);
    expect(await preview(saleId, { gross: "5.00" }, zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { gross: "5.00", vatBreakdown: SPLIT, moneyRefundable: "10.00" },
    });
  });
});
