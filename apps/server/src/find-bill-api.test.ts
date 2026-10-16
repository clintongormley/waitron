import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  floorZones,
  locations,
  sales,
  workingOrders,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, sessions, setProfileAdmission } from "@waitron/identity";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
import { endSessionsNotAdmitted } from "./device.js";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";
import {
  collect,
  parked,
  parkedBy,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
});
const get = (path: string, cookie = venue.cookie) => send(venue.app, cookie, "GET", path);
const paths = ["/api/bills", "/api/transactions?preset=any", "/api/find-bill/options"];
async function profileId() {
  const [device] = await inTx(venue, (tx) =>
    tx.select({ id: devices.deviceProfileId }).from(devices).where(eq(devices.id, venue.deviceId)),
  );
  return device!.id;
}
async function restrict(allowed: string[]) {
  const profile = await profileId();
  await inTx(venue, async (tx) => {
    const [zone] = await tx
      .select({ id: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counterZone));
    await setProfileServiceAccess(tx, venue.cfg, profile, {
      departmentId: zone!.id,
      allowedZoneIds: allowed.length ? allowed : [venue.counterZone],
      startingZoneId: allowed[0] ?? venue.counterZone,
    });
    if (allowed.length === 0)
      await tx
        .update(floorZones)
        .set({ active: false })
        .where(eq(floorZones.id, venue.counterZone));
  });
}
type Options = {
  zones: { id: string; name: string }[];
  billStaff: { id: string; name: string }[];
  transactionStaff: { id: string; name: string }[];
};

describe("Find a bill list routes", () => {
  it("returns the venue time zone for formatting both lists", async () => {
    await inTx(venue, (tx) =>
      tx
        .update(locations)
        .set({ timeZone: "Pacific/Honolulu" })
        .where(eq(locations.id, venue.cfg.locationId)),
    );
    expect(await get("/api/find-bill/options")).toMatchObject({
      status: 200,
      json: { timeZone: "Pacific/Honolulu" },
    });
  });
  it("serves authenticated pages and fresh selection while the legacy lookup remains static", async () => {
    const id = await parked(venue, "Caña");
    const result = await get("/api/bills");
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      page: 0,
      pageSize: 50,
      total: 1,
      openCount: 1,
      rows: [{ workingOrderId: id }],
    });
    const selected = await get(`/api/bills/${id.toUpperCase()}`);
    expect(selected.status).toBe(200);
    expect(selected.json).toMatchObject({ workingOrderId: id, total: "3.00" });
    const legacy = await get("/api/bills/lookup?q=absent");
    expect(legacy).toMatchObject({ status: 200, json: { bills: [] } });
    expect(await get(`/api/bills/${randomUUID()}`)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await get("/api/bills/not-an-id")).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    const order = await placedIssuedBill(venue, "Croquetas");
    expect((await collect(venue, order, "10.00")).status).toBe(200);
    const transactions = await get("/api/transactions?preset=any");
    expect(transactions.status).toBe(200);
    expect(transactions.json).toMatchObject({
      total: 1,
      rows: [{ workingOrderId: order, amount: "10.00" }],
      dates: null,
    });
    expect((await get("/api/find-bill/options")).status).toBe(200);
  });

  it("requires an open session on every list, options and by-ID route", async () => {
    const id = await parked(venue, "Caña");
    const raw = await venue.app.request("/api/bills");
    expect(raw.status).toBe(401);
    expect(await raw.json()).toEqual({ error: { code: "session.required", params: {} } });
    for (const path of [...paths, `/api/bills/${id}`]) {
      expect(await get(path, "")).toMatchObject({
        status: 401,
        json: { code: "session.required" },
      });
    }
    await inTx(venue, (tx) =>
      tx
        .update(sessions)
        .set({ endedAt: "2026-10-15T22:00:00.000Z" })
        .where(eq(sessions.deviceId, venue.deviceId)),
    );
    for (const path of [...paths, `/api/bills/${id}`])
      expect(await get(path)).toMatchObject({
        status: 401,
        json: { code: "session.required" },
      });
  });

  it("refuses a revoked device on every read", async () => {
    const id = await parked(venue, "Caña");
    await inTx(venue, (tx) =>
      tx.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId)),
    );
    for (const path of [...paths, `/api/bills/${id}`])
      expect(await get(path)).toMatchObject({
        status: 401,
        json: { code: "device.unauthorized" },
      });
  });

  it("refuses sessions ended by a changed profile admission", async () => {
    const id = await parked(venue, "Caña");
    const profile = await profileId();
    await inTx(venue, async (tx) => {
      await setProfileAdmission(tx, profile, { admittedRoles: ["admin"] });
      await endSessionsNotAdmitted(tx, venue.deviceId, profile);
    });
    for (const path of [...paths, `/api/bills/${id}`])
      expect(await get(path)).toMatchObject({
        status: 401,
        json: { code: "session.required" },
      });
  });

  it("allows admitted staff reads without any ordering, payment or print capability", async () => {
    const id = await parked(venue, "Caña");
    const profile = await profileId();
    await inTx(venue, (tx) =>
      tx.update(deviceProfiles).set({ capabilities: [] }).where(eq(deviceProfiles.id, profile)),
    );
    for (const path of [...paths, `/api/bills/${id}`]) expect((await get(path)).status).toBe(200);
  });

  it("refuses a requested foreign zone and hides out-of-scope bills, counts, transactions and options", async () => {
    const own = await parked(venue, "Caña");
    const foreign = await seatedWith(venue, "Tarta");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ creditedTo: venue.supervisorId })
        .where(eq(workingOrderLines.workingOrderId, foreign.tabId)),
    );
    await inTx(venue, (tx) =>
      tx.insert(sales).values({
        workingOrderId: foreign.tabId,
        source: "device",
        deviceId: venue.deviceId,
        seriesId: venue.seriesId,
        nodeId: venue.cfg.nodeId,
        invoiceNumber: 900001,
        issuedAt: "2026-10-01T12:00:00.000Z",
        issuedOffsetMinutes: 120,
        total: 1800,
        vatBreakdown: [],
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        fiscalBackend: "verifactu",
        fiscalState: "not_applicable",
        counterpartyTaxId: "B12345674",
        counterpartyLegalName: "Foreign party",
        operatorId: venue.supervisorId,
      }),
    );
    const issued = await placedIssuedBill(venue, "Croquetas");
    expect((await collect(venue, issued, "10.00")).status).toBe(200);
    await restrict([venue.counterZone]);
    const ownPage = await get("/api/bills");
    expect(ownPage).toMatchObject({ status: 200, json: { total: 2, openCount: 2 } });
    expect(
      (ownPage.json as { rows: { workingOrderId: string }[] }).rows
        .map((r) => r.workingOrderId)
        .sort(),
    ).toEqual([own, issued].sort());
    expect(await get(`/api/bills?zoneId=${venue.zoneId}`)).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
    expect(await get(`/api/bills/${foreign.tabId}`)).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
    expect(await get(`/api/bills/${own}`)).toMatchObject({
      status: 200,
      json: { workingOrderId: own },
    });
    const options = await get("/api/find-bill/options");
    expect(options.status).toBe(200);
    expect((options.json as Options).zones.map((z) => z.id)).toEqual([venue.counterZone]);
    expect((options.json as Options).billStaff.map((p) => p.id)).not.toContain(venue.supervisorId);
    expect((options.json as Options).transactionStaff.map((p) => p.id)).not.toContain(
      venue.supervisorId,
    );
    const transactions = await get("/api/transactions?preset=any");
    expect(transactions).toMatchObject({
      status: 200,
      json: { total: 1, openCount: 2, rows: [{ workingOrderId: issued }] },
    });
    await restrict([]);
    expect(await get("/api/bills")).toMatchObject({
      status: 200,
      json: { rows: [], total: 0, openCount: 0 },
    });
    expect(await get("/api/transactions?preset=any")).toMatchObject({
      status: 200,
      json: { rows: [], total: 0, openCount: 0 },
    });
    expect(await get("/api/find-bill/options")).toMatchObject({
      status: 200,
      json: { zones: [], billStaff: [], transactionStaff: [] },
    });
  });

  it("allows a legitimate bill with no recorded zone even when the permitted-zone set is empty", async () => {
    const id = await inTx(venue, async (tx) => {
      const [row] = await tx
        .insert(workingOrders)
        .values({
          source: "operator_script",
          locationId: venue.cfg.locationId,
          nodeId: venue.cfg.nodeId,
          orderNumber: 5000,
          label: "No zone",
        })
        .returning({ id: workingOrders.id });
      return row!.id;
    });
    await restrict([]);
    expect(await get("/api/bills")).toMatchObject({
      status: 200,
      json: { total: 1, openCount: 1, rows: [{ workingOrderId: id, zoneId: null }] },
    });
    expect(await get(`/api/bills/${id}`)).toMatchObject({
      status: 200,
      json: { workingOrderId: id },
    });
  });

  it("offers historical staff represented beyond the current page, including suspended staff", async () => {
    const old = await parkedBy(venue, venue.supervisorId, "Caña");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ openedAt: "2026-10-01T00:00:00.000Z" })
        .where(eq(workingOrders.id, old)),
    );
    for (let i = 0; i < 51; i++) await parked(venue, "Tarta");
    const issued = await placedIssuedBill(venue, "Croquetas");
    expect((await collect(venue, issued, "10.00")).status).toBe(200);
    await inTx(venue, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, venue.supervisorId)),
    );
    const page = await get("/api/bills");
    expect(page.status).toBe(200);
    expect(
      (page.json as { rows: { workingOrderId: string }[] }).rows.some(
        (r) => r.workingOrderId === old,
      ),
    ).toBe(false);
    const options = await get("/api/find-bill/options");
    expect(options.status).toBe(200);
    expect((options.json as Options).billStaff).toContainEqual({
      id: venue.supervisorId,
      name: "Sofía",
    });
    expect((options.json as Options).transactionStaff).toContainEqual({
      id: venue.operatorId,
      name: "Ana",
    });
    const filtered = await get(`/api/bills?staffId=${venue.supervisorId}`);
    expect(filtered).toMatchObject({
      status: 200,
      json: { total: 1, rows: [{ workingOrderId: old }] },
    });
    expect((await inTx(venue, (tx) => tx.select().from(sales))).length).toBe(1);
  });

  it.each([
    ["/api/bills?page=-1", "page"],
    ["/api/bills?limit=99999", "limit"],
    ["/api/bills?staffId=bad", "staffId"],
    ["/api/bills?q=x&q=y", "q"],
    ["/api/transactions?zoneId=bad", "zoneId"],
    ["/api/transactions?type=credit-note", "type"],
    ["/api/transactions?preset=custom&from=2026-10-15&to=2026-10-14", "to"],
  ])("rejects invalid list query %s", async (path, field) => {
    expect(await get(path)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
  });
});
