import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings } from "@waitron/bookings";
import {
  deviceProfiles,
  diningTables,
  floorTodayTables,
  floorPlanPlacements,
  floorPlanSets,
  floorPlans,
  floorPlanTables,
  floorZones,
  locations,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  persons,
  startManagementSession,
  managementSessions,
  registerModulePermissions,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  createDepartment,
  createServiceZone,
  departments,
  departmentTransferRequests,
  orderServiceContexts,
  setProfileServiceScope,
  VENUE_SERVICE_ROUTES,
  VENUE_SERVICE_PERMISSIONS,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { readLayout, saveLayout } from "./floor-plan.js";
import {
  resetZone,
  catchUpZone,
  moveToday,
  rotateToday,
  takeOffToday,
  putBackToday,
  seatsToday,
  backToSaved,
  placeSpareToday,
  ensureToday,
} from "./floor-today-store.js";
import { listTables, listZones, updateZone } from "./tables.js";
import { seatTable } from "./parties.js";
import { jobOrigin } from "@waitron/shared";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { moduleCoreServices } from "./parties.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue;
let app: Hono;
let manager: string;
let staff: string;
let expired: string;
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(v.db, body);
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  [manager, staff, expired] = await run(async (tx) => {
    const result: string[] = [];
    for (const role of ["manager", "staff", "manager"] as const) {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: randomUUID(), role })
        .returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      result.push(`${MANAGEMENT_COOKIE}=${session.token}`);
      if (result.length === 3)
        await tx
          .update(managementSessions)
          .set({ lastSeenAt: "2000-01-01T00:00:00.000Z" })
          .where(eq(managementSessions.personId, person!.id));
    }
    return result as [string, string, string];
  });
  app = new Hono();
  const removals = enabledTableRemovals(ALL_MODULES);
  mountManagementApi(
    app,
    {
      db: v.db,
      cfg: v.cfg,
      venueCfg: v.cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
      tableRemovals: removals,
    },
    () => {},
  );
  VENUE_SERVICE_ROUTES.mount(
    app,
    { db: v.db, cfg: v.cfg, core: moduleCoreServices(v.cfg, removals) },
    () => {},
  );
});
async function target() {
  return run(async (tx) => {
    const department = await createDepartment(tx, v.cfg, { name: "Events", orderStart: "table" });
    const zone = await createServiceZone(tx, v.cfg, {
      name: "Garden",
      departmentId: department.id,
    });
    return { departmentId: department.id, zoneId: zone.id };
  });
}
function path(kind: "zone" | "department", id: string) {
  return kind === "zone"
    ? `/management-api/zones/${id}`
    : `/management-api/venue-service/departments/${id}`;
}
function send(method: string, url: string, cookie: string | undefined = manager, body?: unknown) {
  return app.request(url, {
    method,
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function rows(tx: Transaction) {
  const tables = await tx.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != 'management_sessions' order by name`,
  );
  const allTables: Record<string, unknown[]> = {};
  for (const { name } of tables.rows)
    allTables[name] = (
      await tx.execute(sql`select * from ${sql.identifier(name)} order by rowid`)
    ).rows;
  return {
    allTables,
    zones: await tx.select().from(floorZones),
    departments: await tx.select().from(departments),
    policies: await tx.select().from(zoneServicePolicies),
    tables: await tx.select().from(diningTables),
    orders: await tx.select().from(workingOrders),
    contexts: await tx.select().from(orderServiceContexts),
    transfers: await tx.select().from(departmentTransferRequests),
    bookings: await tx.select().from(bookings),
  };
}
async function error(
  response: Response,
  status: number,
  code: string,
  params?: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({
    error: { code, ...(params === undefined ? {} : { params }) },
  });
}
describe("permanent service delete HTTP contracts", () => {
  it.each(["zone", "department"] as const)(
    "returns the exact full %s preview and recomputed delete impact",
    async (kind) => {
      const f = await target();
      const id = kind === "zone" ? f.zoneId : f.departmentId;
      const expected = {
        target: { id, name: kind === "zone" ? "Garden" : "Events" },
        refusals: [],
        ends: [],
        removes: [
          { key: "zone_policies", count: 2, targets: [] },
          ...(kind === "department"
            ? [
                { key: "department_periods", count: 1, targets: [] },
                { key: "seasons", count: 4, targets: [] },
                { key: "department_policy", count: 1, targets: [] },
                { key: "service_steps", count: 3, targets: [] },
                { key: "zones", count: 1, targets: [{ id: f.zoneId, name: "Garden" }] },
              ]
            : []),
        ],
      };
      const preview = await send("GET", `${path(kind, id)}/delete-impact`);
      expect(preview.status).toBe(200);
      expect(await preview.json()).toEqual(expected);
      const removed = await send("DELETE", path(kind, id));
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual(expected);
      const code = kind === "zone" ? "zone.not_found" : "department.not_found";
      await error(await send("GET", `${path(kind, id)}/delete-impact`), 404, code);
      await error(await send("DELETE", path(kind, id)), 404, code);
      await error(await send("PATCH", path(kind, id), manager, { name: "Reborn" }), 404, code);
      const stored = await run(rows);
      expect(stored.zones.find((z) => z.id === f.zoneId)).toMatchObject({
        active: false,
        name: "Garden",
      });
      if (kind === "department")
        expect(stored.departments.find((d) => d.id === id)).toMatchObject({
          active: false,
          name: "Events",
        });
      const listed = await send("GET", "/management-api/zones?includeInactive=true");
      expect(await listed.json()).not.toContainEqual(expect.objectContaining({ id: f.zoneId }));
    },
  );
  it.each(["zone", "department"] as const)(
    "refuses every active presence on %s PATCH without even renaming",
    async (kind) => {
      const f = await target();
      const url = path(kind, kind === "zone" ? f.zoneId : f.departmentId);
      const before = await run(rows);
      for (const active of [true, false, null, "false", [], 0])
        for (const name of [undefined, "Changed"]) {
          await error(
            await send("PATCH", url, manager, { active, ...(name === undefined ? {} : { name }) }),
            400,
            "management.request_invalid",
            { field: "active" },
          );
          expect(await run(rows)).toEqual(before);
        }
    },
  );
  it.each(["zone", "department"] as const)("refuses any nonempty %s DELETE body", async (kind) => {
    const f = await target();
    const url = path(kind, kind === "zone" ? f.zoneId : f.departmentId);
    const before = await run(rows);
    for (const body of [{}, null, [], { count: 0 }, ""]) {
      await error(await send("DELETE", url, manager, body), 400, "management.request_invalid", {
        field: "body",
      });
      expect(await run(rows)).toEqual(before);
    }
    await error(
      await app.request(url, { method: "DELETE", headers: { cookie: manager }, body: " " }),
      400,
      "management.request_invalid",
      { field: "body" },
    );
    expect(await run(rows)).toEqual(before);
  });
  it.each(["zone", "department"] as const)(
    "requires a live permitted session for %s preview and deletion",
    async (kind) => {
      const f = await target();
      const url = path(kind, kind === "zone" ? f.zoneId : f.departmentId);
      const before = await run(rows);
      for (const [method, endpoint] of [
        ["GET", `${url}/delete-impact`],
        ["DELETE", url],
      ]) {
        await error(await app.request(endpoint!, { method }), 401, "management_session.required");
        await error(await send(method!, endpoint!, expired), 401, "management_session.expired");
        await error(await send(method!, endpoint!, staff), 403, "authorization.not_permitted");
      }
      expect(await run(rows)).toEqual(before);
    },
  );
  it.each(["zone", "department"] as const)(
    "keeps %s malformed/unknown/wrong-location not-found contracts",
    async (kind) => {
      const [other] = await run((tx) =>
        tx
          .insert(locations)
          .values({ name: "Other", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
          .returning(),
      );
      const outside = await run((tx) =>
        kind === "zone"
          ? tx
              .insert(floorZones)
              .values({ locationId: other!.id, name: "Outside" })
              .returning({ id: floorZones.id })
          : tx
              .insert(departments)
              .values({ locationId: other!.id, name: "Outside", tradingName: "Outside" })
              .returning({ id: departments.id }),
      );
      for (const id of ["bad-id", randomUUID(), outside[0]!.id])
        for (const method of ["GET", "DELETE"]) {
          await error(
            await send(method, `${path(kind, id)}${method === "GET" ? "/delete-impact" : ""}`),
            kind === "department" && id === "bad-id" ? 400 : 404,
            kind === "department" && id === "bad-id"
              ? "shared.invalid_id"
              : kind === "zone"
                ? "zone.not_found"
                : "department.not_found",
          );
        }
    },
  );
  it("authenticates and validates an empty zone PATCH before returning 204", async () => {
    const f = await target();
    const url = path("zone", f.zoneId);
    await error(
      await app.request(url, { method: "PATCH", body: "{}" }),
      401,
      "management_session.required",
    );
    await error(await send("PATCH", url, expired, {}), 401, "management_session.expired");
    await error(await send("PATCH", url, staff, {}), 403, "authorization.not_permitted");
    expect((await send("PATCH", url, manager, {})).status).toBe(204);
    await error(
      await send("PATCH", path("zone", randomUUID()), manager, {}),
      404,
      "zone.not_found",
    );
    await send("DELETE", url);
    await error(await send("PATCH", url, manager, {}), 404, "zone.not_found");
    await error(
      await send("PATCH", path("department", f.departmentId), manager, {}),
      400,
      "management.request_invalid",
      { field: "name" },
    );
  });
  it("keeps retired table writes and both removal-impact routes at 404", async () => {
    const f = await target();
    for (const url of [
      `/management-api/venue-service/departments/${f.departmentId}/removal-impact`,
      `/management-api/venue-service/zones/${f.zoneId}/removal-impact`,
    ])
      expect((await send("GET", url)).status).toBe(404);
    for (const method of ["POST", "PATCH", "DELETE"])
      expect(
        (
          await send(
            method,
            method === "POST" ? "/management-api/tables" : `/management-api/tables/${randomUUID()}`,
            manager,
            { active: true },
          )
        ).status,
      ).toBe(404);
  });
});

it.each([
  ["zone", "zone.order_in_progress"],
  ["department", "department.order_in_progress"],
  ["zone", "zone.transfer_pending"],
  ["department", "department.transfer_pending"],
  ["zone", "zone.profile_in_use"],
  ["department", "department.profile_in_use"],
  ["department", "department.last_active"],
  ["zone", "zone.table_in_use"],
  ["department", "zone.table_in_use"],
  ["department", "zone.order_in_progress"],
  ["department", "zone.transfer_pending"],
  ["zone", "table.booked"],
  ["department", "table.booked"],
  ["zone", "table.delivery_in_progress"],
  ["department", "table.delivery_in_progress"],
] as const)("%s delete maps %s to 409 and rolls back all target rows", async (kind, code) => {
  const f = await target();
  await run(async (tx) => {
    if (code.endsWith("profile_in_use")) {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Only garden", formFactor: "till" })
        .returning();
      await setProfileServiceScope(tx, v.cfg, profile!.id, {
        departmentId: f.departmentId,
        allowedZoneIds: [f.zoneId],
        startingZoneId: f.zoneId,
      });
    } else if (code === "department.last_active") {
      const others = await tx.select().from(departments);
      for (const department of others)
        if (department.id !== f.departmentId)
          await tx
            .update(departments)
            .set({ active: false })
            .where(eq(departments.id, department.id));
    } else if (code.endsWith("order_in_progress")) {
      const [order] = await tx
        .insert(workingOrders)
        .values({ source: "operator_script", locationId: v.cfg.locationId, orderNumber: 99 })
        .returning();
      await tx.insert(orderServiceContexts).values({
        workingOrderId: order!.id,
        locationId: v.cfg.locationId,
        zoneId: code === "zone.order_in_progress" ? f.zoneId : v.counter.zoneId,
        departmentId: f.departmentId,
        serviceMode: "prepay",
      });
    } else if (code.endsWith("transfer_pending")) {
      const [order] = await tx
        .insert(workingOrders)
        .values({ source: "operator_script", locationId: v.cfg.locationId, orderNumber: 99 })
        .returning();
      const [source] = await tx
        .select()
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, v.counter.zoneId));
      await tx.insert(departmentTransferRequests).values({
        tabId: order!.id,
        sourceDepartmentId: source!.departmentId,
        destinationDepartmentId: f.departmentId,
        destinationZoneId: code === "zone.transfer_pending" ? f.zoneId : null,
        senderId: v.operator.personId,
      });
    } else {
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: v.cfg.locationId, zoneId: f.zoneId, label: "Garden table" })
        .returning();
      if (code === "zone.table_in_use")
        await tx.insert(floorTodayTables).values({ tableId: table!.id });
      if (code === "zone.table_in_use")
        await moduleCoreServices(v.cfg, enabledTableRemovals(ALL_MODULES)).seatTable(tx, {
          tableId: table!.id,
          guestCount: 2,
          operatorId: v.operator.personId,
        });
      if (code === "table.booked")
        await tx.insert(bookings).values({
          locationId: v.cfg.locationId,
          bookingDate: "2026-01-01",
          bookingTime: "20:00:00",
          contactName: "Guest",
          partySize: 2,
          tableId: table!.id,
          createdBy: v.operator.personId,
        });
      if (code === "table.delivery_in_progress")
        await tx.insert(workingOrders).values({
          source: "operator_script",
          locationId: v.cfg.locationId,
          orderNumber: 99,
          deliveryTableId: table!.id,
          label: "Garden delivery",
        });
    }
  });
  const url = path(kind, kind === "zone" ? f.zoneId : f.departmentId);
  const before = await run(rows);
  const preview = await send("GET", `${url}/delete-impact`);
  expect(preview.status).toBe(200);
  expect((await preview.json()).refusals).toContainEqual(expect.objectContaining({ code }));
  await error(await send("DELETE", url), 409, code);
  expect(await run(rows)).toEqual(before);
});

describe("stale floor identifiers", () => {
  async function floorTarget(deleted = true) {
    const f = await run(async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: randomUUID(),
        orderStart: "table",
      });
      const zone = await createServiceZone(tx, v.cfg, {
        name: randomUUID(),
        departmentId: department.id,
      });
      return { departmentId: department.id, zoneId: zone.id };
    });
    return run(async (tx) => {
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: v.cfg.locationId, zoneId: f.zoneId, label: randomUUID() })
        .returning();
      await tx.insert(floorTodayTables).values({
        tableId: table!.id,
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        shape: "rect",
        rotation: 0,
      });
      const [set] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning();
      const [plan] = await tx
        .insert(floorPlans)
        .values({ zoneId: f.zoneId, setId: set!.id, savedAt: now.toISOString() })
        .returning();
      const [master] = await tx
        .insert(floorPlanTables)
        .values({ zoneId: f.zoneId, label: table!.label })
        .returning();
      await tx.insert(floorPlanPlacements).values({
        planId: plan!.id,
        planTableId: master!.id,
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        shape: "rect",
        rotation: 0,
      });
      if (deleted)
        await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.zoneId));
      return { ...f, tableId: table!.id };
    });
  }
  const now = new Date("2026-10-11T12:00:00Z");
  const actions: [
    string,
    string,
    (tx: Transaction, f: Awaited<ReturnType<typeof floorTarget>>) => Promise<unknown>,
  ][] = [
    [
      "zone rename",
      "zone.not_found",
      (tx, f) => updateZone(tx, v.cfg, f.zoneId, { name: "Reborn" }),
    ],
    [
      "zone activate",
      "zone.not_found",
      (tx, f) =>
        updateZone(tx, v.cfg, f.zoneId, { active: true } as unknown as Parameters<
          typeof updateZone
        >[3]),
    ],
    [
      "floor read",
      "zone.not_found",
      (tx, f) => readLayout(tx, v.cfg, { setId: randomUUID(), zoneId: f.zoneId }),
    ],
    [
      "floor save",
      "zone.not_found",
      (tx, f) =>
        saveLayout(
          tx,
          v.cfg,
          [],
          { setId: randomUUID(), zoneId: f.zoneId },
          { revision: 1, tables: [] },
          now,
        ),
    ],
    ["floor reset", "zone.not_found", (tx, f) => resetZone(tx, v.cfg, [], f.zoneId, now, "due")],
    ["floor catch-up", "zone.not_found", (tx, f) => catchUpZone(tx, v.cfg, [], f.zoneId, now)],
    ["table move", "table.not_found", (tx, f) => moveToday(tx, v.cfg, f.tableId, { x: 2, y: 2 })],
    ["table rotate", "table.not_found", (tx, f) => rotateToday(tx, v.cfg, f.tableId)],
    ["table take off", "table.not_found", (tx, f) => takeOffToday(tx, v.cfg, f.tableId)],
    ["table put back", "table.not_found", (tx, f) => putBackToday(tx, v.cfg, f.tableId)],
    ["table seats", "table.not_found", (tx, f) => seatsToday(tx, v.cfg, f.tableId, 4)],
    [
      "table back to saved",
      "table.not_found",
      (tx, f) => backToSaved(tx, v.cfg, [], f.tableId, new Date()),
    ],
    [
      "table spare placement",
      "table.not_found",
      (tx, f) => placeSpareToday(tx, v.cfg, f.tableId, { x: 2, y: 2 }),
    ],
    [
      "table seat",
      "table.inactive",
      (tx, f) =>
        seatTable(
          tx,
          { ...v.cfg, origin: jobOrigin("dashboard") },
          { tableId: f.tableId, guestCount: 2, operatorId: v.operator.personId },
        ),
    ],
  ];
  it.each(actions)("refuses stale %s without changing rows", async (_name, code, action) => {
    const f = await floorTarget();
    const before = await run(rows);
    await expect(run((tx) => action(tx, f))).rejects.toMatchObject({ code });
    expect(await run(rows)).toEqual(before);
  });
  it("keeps management spare/taken-off tables but hides deleted zones with old list flags", async () => {
    const deleted = await floorTarget();
    const live = await floorTarget(false);
    await run((tx) => takeOffToday(tx, v.cfg, live.tableId));
    const tables = await run((tx) => listTables(tx, v.cfg, new Date(), { includeDisabled: true }));
    expect(tables).not.toContainEqual(expect.objectContaining({ id: deleted.tableId }));
    expect(tables).toContainEqual(expect.objectContaining({ id: live.tableId }));
    expect(await run((tx) => listZones(tx, v.cfg, { includeInactive: true }))).not.toContainEqual(
      expect.objectContaining({ id: deleted.zoneId }),
    );
    await expect(
      run((tx) => moveToday(tx, v.cfg, live.tableId, { x: 3, y: 3 })),
    ).rejects.toMatchObject({ code: "table.taken_off" });
    await run((tx) => putBackToday(tx, v.cfg, live.tableId));
    await run((tx) => moveToday(tx, v.cfg, live.tableId, { x: 3, y: 3 }));
    expect(
      (
        await run((tx) =>
          tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, live.tableId)),
        )
      )[0],
    ).toMatchObject({ x: 3, y: 3, takenOff: false });
    const before = await run(rows);
    await run((tx) => ensureToday(tx, v.cfg, [], now));
    expect(
      (await run(rows)).allTables.floor_plans.filter(
        (row: unknown) => (row as { zone_id: string }).zone_id === deleted.zoneId,
      ),
    ).toEqual(
      before.allTables.floor_plans.filter(
        (row: unknown) => (row as { zone_id: string }).zone_id === deleted.zoneId,
      ),
    );
  });
});
