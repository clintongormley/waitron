import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import * as service from "./index.js";

import { readDepartmentLogoRasters } from "./department-receipts.js";
import { saveZoneClosedDate } from "./zone-closed-times.js";
import { placeOpenPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { menuPeriods } from "./schema/menus.js";
import { specialDates } from "./schema/hours.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, service.VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const at = new Date("2026-10-11T12:00:00Z");
async function fixture() {
  return run(async (tx) => {
    const [place] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
      })
      .returning();
    const cfg = { locationId: locationId(place!.id), receiptLanguages: ["en-GB"] };
    const live = await service.createDepartment(tx, cfg, { name: "Live" });
    const gone = await service.createDepartment(tx, cfg, { name: "Gone" });
    const zone = await service.createServiceZone(tx, cfg, {
      name: "Gone zone",
      departmentId: live.id,
    });
    const liveZone = await service.createServiceZone(tx, cfg, {
      name: "Live zone",
      departmentId: live.id,
    });
    const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
    const period = await service.saveMenuPeriod(
      tx,
      cfg,
      gone.id,
      {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      },
      0,
    );
    const [day] = await tx
      .insert(specialDates)
      .values({ ...cfg, name: "Event", date: "2026-10-12", ownHours: true })
      .returning();
    await service.writeDepartmentReceipt(tx, cfg, gone.id, { email: "history@example.com" });
    await tx.update(departments).set({ active: false }).where(eq(departments.id, gone.id));
    await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, zone.id));
    return {
      cfg,
      live: live.id,
      gone: gone.id,
      zone: zone.id,
      liveZone: liveZone.id,
      menu: menu!.id,
      period: period.id,
      day: day!.id,
    };
  });
}
async function snapshot() {
  return run(async (tx) => {
    const tables = await tx.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
    );
    const rows: Record<string, unknown[]> = {};
    for (const { name } of tables.rows)
      rows[name] = (
        await tx.execute(sql`select * from ${sql.identifier(name)} order by rowid`)
      ).rows;
    return rows;
  });
}
const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] }));
const closedWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] }));
type Fixture = Awaited<ReturnType<typeof fixture>>;
const actions: [string, string, (tx: Transaction, f: Fixture) => Promise<unknown>][] = [
  [
    "department rename",
    "department.not_found",
    (tx, f) => service.updateDepartment(tx, f.cfg, f.gone, { name: "Reborn" }),
  ],
  [
    "department policy",
    "department.not_found",
    (tx, f) =>
      service.setDepartmentSalePolicyField(tx, f.cfg, f.gone, "paidWhen", "ticket_then_pay"),
  ],
  [
    "department settings",
    "department.not_found",
    (tx, f) =>
      service.saveDepartmentSettings(tx, f.cfg, f.gone, {
        name: "Reborn",
        tradingName: "Reborn",
        orderStart: "counter",
        paidWhen: "prepay",
        printTradingName: true,
        collectionNumber: "none",
        receiptPrintMode: "auto",
      }),
  ],
  [
    "transfer settings read",
    "department.not_found",
    (tx, f) => service.readDepartmentTransferSettings(tx, f.cfg, f.gone),
  ],
  [
    "transfer settings write",
    "department.not_found",
    (tx, f) =>
      service.setDepartmentTransferSettings(tx, f.cfg, f.gone, {
        receivingProfileId: null,
        destinationDepartmentIds: [],
      }),
  ],
  [
    "menu period create",
    "department.not_found",
    (tx, f) =>
      service.saveMenuPeriod(
        tx,
        f.cfg,
        f.gone,
        {
          name: "Dinner",
          menuId: f.menu,
          staffMenuIds: [],
        },
        0,
      ),
  ],
  [
    "menu period update derived department",
    "department.not_found",
    (tx, f) => service.updateMenuPeriod(tx, f.cfg, f.period, { name: "Dinner" }, 0),
  ],
  [
    "menu period delete derived department",
    "department.not_found",
    (tx, f) => service.deleteMenuPeriod(tx, f.cfg, f.period),
  ],
  [
    "default period existing fast path",
    "department.not_found",
    (tx, f) => placeOpenPeriod(tx, f.cfg, f.gone, f.menu),
  ],
  [
    "menu week",
    "department.not_found",
    (tx, f) => service.replaceMenuWeek(tx, f.cfg, f.gone, week, at, 0),
  ],
  [
    "menu date",
    "department.not_found",
    (tx, f) => service.saveSpecialDateMenus(tx, f.cfg, f.day, f.gone, [], at, 0),
  ],
  [
    "receipt read",
    "department.not_found",
    (tx, f) => service.readDepartmentReceipt(tx, f.cfg, f.gone),
  ],
  [
    "receipt logo read",
    "department.not_found",
    (tx, f) => readDepartmentLogoRasters(tx, f.cfg, f.gone),
  ],
  [
    "receipt write",
    "department.not_found",
    (tx, f) => service.writeDepartmentReceipt(tx, f.cfg, f.gone, { email: "changed@example.com" }),
  ],
  [
    "zone context",
    "service_zone.not_found",
    (tx, f) => service.resolveZoneContext(tx, f.cfg, f.zone),
  ],
  [
    "zone reassignment",
    "service_zone.not_found",
    (tx, f) => service.configureZone(tx, f.cfg, { zoneId: f.zone, departmentId: f.live }),
  ],
  [
    "department reassignment",
    "department.not_found",
    (tx, f) => service.configureZone(tx, f.cfg, { zoneId: f.liveZone, departmentId: f.gone }),
  ],
  [
    "zone policy",
    "service_zone.not_found",
    (tx, f) => service.setZoneSalePolicyOverride(tx, f.cfg, f.zone, "paidWhen", "ticket_then_pay"),
  ],
  [
    "zone settings",
    "service_zone.not_found",
    (tx, f) =>
      service.saveZoneServiceSettings(tx, f.cfg, f.zone, {
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      }),
  ],
  [
    "zone closed week",
    "service_zone.not_found",
    (tx, f) => service.replaceZoneClosedWeek(tx, f.cfg, f.zone, closedWeek, 0, at),
  ],
  [
    "zone closed date",
    "service_zone.not_found",
    (tx, f) => saveZoneClosedDate(tx, f.cfg, f.day, f.zone, [], 0, at),
  ],
];
describe("deleted service targets", () => {
  it.each(actions)("refuses %s without changing any row", async (_name, code, action) => {
    const f = await fixture();
    const before = await snapshot();
    await expect(run((tx) => action(tx, f))).rejects.toMatchObject({ code });
    expect(await snapshot()).toEqual(before);
  });
  it("hides deleted targets even when inactive entries are requested", async () => {
    const f = await fixture();
    expect(await run((tx) => service.listDepartments(tx, f.cfg))).toEqual([
      expect.objectContaining({ id: f.live }),
    ]);
    expect(
      await run((tx) => service.listServiceZones(tx, f.cfg, { includeInactive: true })),
    ).toEqual([expect.objectContaining({ id: f.liveZone })]);
    const model = await run((tx) => service.readOpeningHoursModel(tx, f.cfg, at));
    expect(model.departments.map((row) => row.id)).toEqual([f.live]);
    expect(model.departments.flatMap((row) => row.periods)).toEqual([]);
  });
  it("hides deleted zones from the service list with the old include flag", async () => {
    const f = await fixture();
    expect(
      await run((tx) => service.listServiceZones(tx, f.cfg, { includeInactive: true })),
    ).toEqual([expect.objectContaining({ id: f.liveZone })]);
  });
  it("hides deleted departments from opening-hours configuration", async () => {
    const f = await fixture();
    const model = await run((tx) => service.readOpeningHoursModel(tx, f.cfg, at));
    expect(model.departments.map((row) => row.id)).toEqual([f.live]);
    expect(model.departments.flatMap((row) => row.periods)).toEqual([]);
  });
  it("allows live edits and retains internal receipt history", async () => {
    const f = await fixture();
    await run(async (tx) => {
      await service.updateDepartment(tx, f.cfg, f.live, { tradingName: "Edited" });
      await service.configureZone(tx, f.cfg, { zoneId: f.liveZone, departmentId: f.live });
      await service.replaceZoneClosedWeek(tx, f.cfg, f.liveZone, closedWeek, 0, at);
      await service.writeDepartmentReceipt(tx, f.cfg, f.live, { email: "live@example.com" });
    });
    expect(await run((tx) => service.readDepartmentReceipt(tx, f.cfg, f.live))).toEqual({
      email: "live@example.com",
    });
    expect(
      await run((tx) => service.readPrintedDepartmentReceipt(tx, f.cfg, f.gone, "80mm")),
    ).toEqual({ receipt: { email: "history@example.com" }, logo: null });
  });
  it("provisions active defaults without adopting retained defaults or another location", async () => {
    const f = await fixture();
    const other = await fixture();
    await run(async (tx) => {
      await tx.update(departments).set({ isDefault: true }).where(eq(departments.id, f.gone));
      await tx.update(floorZones).set({ name: "Counter" }).where(eq(floorZones.id, f.zone));
      await tx
        .update(zoneServicePolicies)
        .set({ isCounterDefault: true })
        .where(eq(zoneServicePolicies.zoneId, f.zone));
      await tx.update(departments).set({ isDefault: true }).where(eq(departments.id, other.live));
    });
    const beforeOther = await run((tx) =>
      tx.select().from(departments).where(eq(departments.locationId, other.cfg.locationId)),
    );
    const beforeClash = await snapshot();
    await expect(
      run((tx) =>
        tx.insert(departments).values({
          ...f.cfg,
          name: "Default collision",
          tradingName: "Collision",
          isDefault: true,
        }),
      ),
    ).rejects.toThrow(/UNIQUE constraint failed: departments.location_id/);
    expect(await snapshot()).toEqual(beforeClash);
    const nodeId = await seedNode(suite.db, f.cfg.locationId);
    await run((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, { ...f.cfg, nodeId }));
    const ds = await run((tx) =>
      tx.select().from(departments).where(eq(departments.locationId, f.cfg.locationId)),
    );
    const zs = await run((tx) =>
      tx.select().from(floorZones).where(eq(floorZones.locationId, f.cfg.locationId)),
    );
    expect(ds.find((row) => row.id === f.gone)).toMatchObject({
      active: false,
      name: "Gone",
      isDefault: false,
    });
    expect(ds.filter((row) => row.isDefault)).toEqual([expect.objectContaining({ active: true })]);
    expect(zs.find((row) => row.id === f.zone)).toMatchObject({ active: false, name: "Counter" });
    const policy = await run((tx) =>
      tx
        .select()
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.locationId, f.cfg.locationId)),
    );
    expect(policy.filter((row) => row.isCounterDefault)).toEqual([
      expect.objectContaining({ zoneId: expect.any(String) }),
    ]);
    expect(policy.find((row) => row.isCounterDefault)?.zoneId).not.toBe(f.zone);
    expect(
      await run((tx) =>
        tx.select().from(departments).where(eq(departments.locationId, other.cfg.locationId)),
      ),
    ).toEqual(beforeOther);
    expect(
      await run((tx) => tx.select().from(menuPeriods).where(eq(menuPeriods.departmentId, f.gone))),
    ).toHaveLength(1);
  });
});
