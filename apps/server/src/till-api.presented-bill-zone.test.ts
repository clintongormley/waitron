import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  orderServiceContexts,
  setProfileServiceAccess,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { DEVICE_COOKIE } from "./device-session.js";
import { issuancePass } from "./issuance-pass.js";
import { VENUE_SERVICE } from "./modules.js";
import { createTable } from "./tables.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { offerProducts } from "./testing/zone-offers.js";
import { SESSION_COOKIE } from "./till-session.js";
import { priceStoredOrderForIssuance } from "./working-order.js";
import "./errors.js";

// A presented bill that moves with its party, or on its own to another table, takes the zone it
// now sits in, so a till limited to that zone may take its payment.
let venue: BillVenue;
/** The tables zone the venue seats at, in its own department. */
let terrace: string;
/** Another tables zone, in a department of its own. */
let indoor: string;
let indoorDepartment: string;
/** Tills whose profiles allow only the one zone. */
let terraceTill: string;
let indoorTill: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

beforeAll(async () => {
  terrace = venue.zoneId;
  ({ indoor, indoorDepartment } = await inTx(venue, async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: "Interior",
      orderStart: "table",
    });
    const zone = await createServiceZone(tx, venue.cfg, {
      name: "Interior",
      departmentId: department.id,
    });
    await offerProducts(tx, venue.cfg, { zone: { zoneId: zone.id }, orderStart: "table" });
    return { indoor: zone.id, indoorDepartment: department.id };
  }));
  terraceTill = await zoneTill(terrace);
  indoorTill = await zoneTill(indoor);
});

async function departmentOf(zoneId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, zoneId)),
  );
  return row!.departmentId;
}

/** A signed-in till whose profile serves `zoneId` alone and takes cash. */
async function zoneTill(zoneId: string): Promise<string> {
  const departmentId = await departmentOf(zoneId);
  const profileId = await inTx(venue, async (tx) => {
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: `Solo ${randomUUID()}`,
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "take-cash"],
      })
      .returning({ id: deviceProfiles.id });
    await setProfileServiceAccess(tx, venue.cfg, profile!.id, {
      departmentId,
      allowedZoneIds: [zoneId],
      startingZoneId: zoneId,
    });
    return profile!.id;
  });
  const device = await enrolDeviceForTest(venue.db, venue.cfg, {
    name: `Till ${randomUUID()}`,
    profileId,
  });
  const session = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: venue.operatorId, pin: "5555" }),
  );
  return `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
}

function post(path: string, body: unknown, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", path, body);
}

function revisionOf(partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

function partyOf(billId: string): string {
  return venue.db.all<{ party_id: string }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
}

async function freeTable(zoneId: string): Promise<string> {
  return (
    await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `M-${randomUUID().slice(0, 8)}`, zoneId }),
    )
  ).id;
}

async function contextOf(billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({
        zoneId: orderServiceContexts.zoneId,
        departmentId: orderServiceContexts.departmentId,
        serviceMode: orderServiceContexts.serviceMode,
      })
      .from(orderServiceContexts)
      .where(eq(orderServiceContexts.workingOrderId, billId)),
  );
  return row;
}

async function indoorContext() {
  const context = await inTx(venue, (tx) =>
    VENUE_SERVICE.resolveZoneContext(tx, venue.cfg, indoor),
  );
  return { zoneId: indoor, departmentId: indoorDepartment, serviceMode: context.serviceMode };
}

/** Ana's party on the terrace, with `names` split off her main bill and presented. */
async function presentedSplit(...names: string[]) {
  const ana = await seatedWith(venue, "Caña", ...names);
  const split = await post(`/api/bills/${ana.tabId}/split`, {
    transfers: names.map((_, i) => ({ lineNo: i + 2 })),
    expectedPartyRevision: ana.revision,
  });
  expect(split.status).toBe(200);
  const presented = split.json.billId as string;
  const placed = await post(`/api/working-orders/${presented}/place`, {});
  expect(placed).toMatchObject({ status: 200, json: { status: "placed" } });
  return { ana, presented };
}

function moveParty(partyId: string, toTableId: string) {
  return post(`/api/parties/${partyId}/move`, {
    toTableId,
    expectedPartyRevision: revisionOf(partyId),
    otherPartyId: null,
  });
}

function moveBill(billId: string, tableId: string) {
  const from = partyOf(billId);
  const holder = venue.db.all<{ party_id: string }>(
    sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
  )[0]?.party_id;
  return post(`/api/bills/${billId}/move`, {
    to: { tableId },
    expectedPartyRevision: revisionOf(from),
    ...(holder === undefined
      ? { otherPartyId: null }
      : { otherPartyId: holder, expectedOtherPartyRevision: revisionOf(holder) }),
    bills: "separate",
  });
}

/** A presented bill is paid by collecting it. */
function payInCash(billId: string, amount: string, cookie = venue.cookie) {
  return post(
    `/api/working-orders/${billId}/collect`,
    { tender: { method: "cash", amount } },
    cookie,
  );
}

const notAllowed = (zoneId: string) => ({
  status: 403,
  json: { code: "service_zone.not_allowed", params: { zoneId } },
});

describe("a presented bill moving with its party", () => {
  it("takes the new zone, its department and its service mode, so the new zone's till takes its payment and the old one's is refused", async () => {
    const { ana, presented } = await presentedSplit("Tarta");
    expect(await contextOf(presented)).toMatchObject({ zoneId: terrace });

    const moved = await moveParty(ana.partyId, await freeTable(indoor));

    expect(moved.status).toBe(200);
    expect(await contextOf(presented)).toEqual(await indoorContext());
    expect(await statusOf(venue, presented)).toBe("placed");
    expect(await payInCash(presented, "18.00", terraceTill)).toMatchObject(notAllowed(indoor));
    expect(await payInCash(presented, "18.00", indoorTill)).toMatchObject({ status: 200 });
    expect(await statusOf(venue, presented)).toBe("settled");
  });

  it("moves the open main bill with it as before, while a settled bill keeps the zone it was paid in", async () => {
    const { ana, presented } = await presentedSplit("Tarta");
    expect((await payInCash(presented, "18.00")).status).toBe(200);
    expect(await statusOf(venue, presented)).toBe("settled");

    const moved = await moveParty(ana.partyId, await freeTable(indoor));

    expect(moved.status).toBe(200);
    expect(await contextOf(ana.tabId)).toEqual(await indoorContext());
    expect(await contextOf(presented)).toMatchObject({
      zoneId: terrace,
      departmentId: await departmentOf(terrace),
    });
  });

  it("files the same lines, total and VAT after the move as an unmoved presented bill", async () => {
    const { ana, presented } = await presentedSplit("Tarta", "Pulpo");
    const control = await presentedSplit("Tarta", "Pulpo");
    const priced = () =>
      inTx(venue, async (tx) =>
        issuancePass(tx, venue.cfg, presented, await priceStoredOrderForIssuance(tx, presented)),
      );
    const before = await priced();

    expect((await moveParty(ana.partyId, await freeTable(indoor))).status).toBe(200);

    expect(await contextOf(presented)).toMatchObject({ zoneId: indoor });
    expect(await priced()).toEqual(before);
    expect((await payInCash(presented, "38.00", indoorTill)).status).toBe(200);
    expect((await payInCash(control.presented, "38.00")).status).toBe(200);
    const filed = async (billId: string) => {
      const [sale] = await inTx(venue, (tx) =>
        tx
          .select({ total: sales.total, vatBreakdown: sales.vatBreakdown })
          .from(sales)
          .where(eq(sales.workingOrderId, billId)),
      );
      return sale;
    };
    expect(await filed(presented)).toEqual(await filed(control.presented));
    expect((await filed(presented))!.total).toBe(3800);
    expect((await filed(presented))!.vatBreakdown).toHaveLength(1);
  });
});

describe("a presented bill moved on its own", () => {
  it("takes the zone of another party's table it joins", async () => {
    const { presented } = await presentedSplit("Tarta");
    const luisTable = await freeTable(indoor);
    expect((await post(`/api/tables/${luisTable}/seat`, {})).status).toBe(200);

    const moved = await moveBill(presented, luisTable);

    expect(moved.status).toBe(200);
    expect(await statusOf(venue, presented)).toBe("placed");
    expect(await contextOf(presented)).toEqual(await indoorContext());
    expect(await payInCash(presented, "18.00", indoorTill)).toMatchObject({ status: 200 });
  });

  it("takes the zone of a free table it opens a party at", async () => {
    const { presented } = await presentedSplit("Tarta");

    const moved = await moveBill(presented, await freeTable(indoor));

    expect(moved.status).toBe(200);
    expect(await statusOf(venue, presented)).toBe("placed");
    expect(await contextOf(presented)).toEqual(await indoorContext());
    expect(await payInCash(presented, "18.00", terraceTill)).toMatchObject(notAllowed(indoor));
  });
});
