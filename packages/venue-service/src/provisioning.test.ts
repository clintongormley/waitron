import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  deviceProfiles,
  kitchenStations,
  locations,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { readHolidays, readLocalHolidayModel, saveLocalHoliday } from "./holidays.js";
import { readSpecialDate, readWeekHours, replaceWeekHours, saveSpecialDate } from "./hours.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createServiceZone } from "./operations.js";
import {
  readProfileKitchenLists,
  readProfileServiceAccess,
  setProfileServiceAccess,
} from "./profile-access.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";
import { deviceProfileStations } from "./schema/service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("VENUE_SERVICE_PROVISIONING", () => {
  it("names the default department after the venue", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "La Plaza",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const rows = await db.execute<{ name: string; trading_name: string }>(sql`
      select name, trading_name from departments where location_id = ${locationId}`);
    expect(rows.rows).toEqual([{ name: "La Plaza", trading_name: "La Plaza" }]);
  });

  it("seeds quick-sale and receipt defaults without a zone override", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Corner Kitchen",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const department = await db.execute<{
      paid_when: string;
      collection_number: string;
      receipt_print_mode: string;
      print_trading_name: number;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode, print_trading_name
      from department_sale_policies
      where department_id = (
        select id from departments where location_id = ${locationId} and is_default = 1
      )`);
    expect(department.rows).toEqual([
      {
        paid_when: "prepay",
        collection_number: "none",
        receipt_print_mode: "auto",
        print_trading_name: 1,
      },
    ]);
    const zone = await db.execute<{
      paid_when: string | null;
      collection_number: string | null;
      receipt_print_mode: string | null;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode
      from zone_sale_policies
      where zone_id = (
        select zone_id from zone_service_policies
        where location_id = ${locationId} and is_counter_default = 1
      )`);
    expect(zone.rows).toEqual([
      { paid_when: null, collection_number: null, receipt_print_mode: null },
    ]);
  });

  it("seeds one counter policy idempotently without resetting authored mode", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const nodeId = await seedNode(db, locationId);
    const node = { locationId, nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe(
      "default department, counter zone and service settings ready",
    );
    const menus = await db
      .insert(catalogues)
      .values([{ name: "Provisioned" }, { name: "Authored" }])
      .returning({ id: catalogues.id });
    await db.execute(sql`
      update locations set catalogue_id = ${menus[0]!.id} where id = ${locationId}`);
    await db.execute(sql`
      insert into department_menus (department_id, menu_id, display_order)
      select department_id, ${menus[1]!.id}, 1
      from zone_service_policies`);
    await db.execute(sql`
      insert into department_all_day_menus (department_id, menu_id)
      select department_id, ${menus[1]!.id}
      from zone_service_policies`);
    await db.execute(sql`
      update zone_service_policies
      set service_mode = 'ticket_then_pay'`);
    await runSeed();

    const departments = await db.execute<{ count: number }>(sql`
      select count(*) as count from departments`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*) as count from floor_zones`);
    const policies = await db.execute<{ service_mode: string | null }>(sql`
      select service_mode from zone_service_policies`);
    const allDay = await db.execute<{ menu_id: string }>(sql`
      select menu_id from department_all_day_menus`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([{ service_mode: "ticket_then_pay" }]);
    expect(allDay.rows).toEqual([{ menu_id: menus[1]!.id }]);
  });

  it("lists the location's menu on the counter department, makes it the default, and keeps a manager's order on a re-run", async () => {
    await seedTenant(db);
    const [menu] = await db
      .insert(catalogues)
      .values({ name: "Carta" })
      .returning({ id: catalogues.id });
    const [location] = await db
      .insert(locations)
      .values({
        name: "Venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        catalogueId: menu!.id,
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const listed = async () =>
      (
        await db.execute<{ menu_id: string; display_order: number; all_day: string | null }>(sql`
          select m.menu_id, m.display_order, a.menu_id as all_day
          from department_menus m
          join departments d on d.id = m.department_id
          left join department_all_day_menus a on a.department_id = m.department_id
          where d.location_id = ${locationId}`)
      ).rows;

    await runSeed();
    expect(await listed()).toEqual([{ menu_id: menu!.id, display_order: 0, all_day: menu!.id }]);
    await db.execute(
      sql`update department_menus set display_order = 5 where menu_id = ${menu!.id}`,
    );
    await runSeed();
    expect(await listed()).toEqual([{ menu_id: menu!.id, display_order: 5, all_day: menu!.id }]);
  });

  it("seeds the service settings row with changes to sent items allowed, and keeps a later choice", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const settings = async () =>
      (await db.execute(sql`select id, edit_sent_lines from service_settings`)).rows;

    await runSeed();
    expect(await settings()).toEqual([{ id: 1, edit_sent_lines: 1 }]);
    await db.execute(sql`update service_settings set edit_sent_lines = 0`);
    await runSeed();
    expect(await settings()).toEqual([{ id: 1, edit_sent_lines: 0 }]);
  });
  it("leaves a fresh venue with no hours set and no special dates, and a re-run keeps hours set later", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Hours Venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const cfg = { locationId };
    const node = { locationId, nodeId: await seedNode(db, locationId) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const counts = async () =>
      (
        await db.execute(sql`
          select
            (select count(*) from hours_week_cells) as week_cells,
            (select count(*) from hours_week_periods) as week_periods,
            (select count(*) from special_dates) as special_dates,
            (select count(*) from special_date_hours) as date_cells,
            (select count(*) from special_date_hours_periods) as date_periods`)
      ).rows[0];
    const departmentId = async () =>
      (
        await db.execute<{ id: string }>(sql`
          select id from departments where location_id = ${locationId} and is_default = 1`)
      ).rows[0]!.id;

    await runSeed();
    const subject = { kind: "department" as const, id: await departmentId() };
    expect(await db.transaction((tx) => readWeekHours(tx, cfg, subject))).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        cell: { mode: "not_set", periods: [] },
      })),
    );
    expect(await counts()).toEqual({
      week_cells: 0,
      week_periods: 0,
      special_dates: 0,
      date_cells: 0,
      date_periods: 0,
    });

    const at = new Date("2026-10-06T10:00:00Z");
    const lunch = { id: randomUUID(), opensAt: "12:00", closesAt: "16:00" };
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      cell:
        weekday === 1
          ? { mode: "closed" as const, periods: [] as [] }
          : { mode: "periods" as const, periods: [lunch].map((p) => ({ ...p, id: randomUUID() })) },
    }));
    const saved = await db.transaction(async (tx) => {
      await replaceWeekHours(tx, cfg, subject, week, at);
      return saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2026-12-25",
          name: "Christmas",
          colour: "red",
          closeWholeVenue: false,
          cells: [{ subject, cell: { mode: "closed", periods: [] } }],
        },
        at,
      );
    });
    const before = await db.transaction(async (tx) => ({
      week: await readWeekHours(tx, cfg, subject),
      date: await readSpecialDate(tx, cfg, saved.id),
    }));

    await runSeed();

    expect(
      await db.transaction(async (tx) => ({
        week: await readWeekHours(tx, cfg, subject),
        date: await readSpecialDate(tx, cfg, saved.id),
      })),
    ).toEqual(before);
    expect(before.week[1]!.cell).toEqual({ mode: "closed", periods: [] });
    expect(await counts()).toEqual({
      week_cells: 7,
      week_periods: 6,
      special_dates: 1,
      date_cells: 1,
      date_periods: 0,
    });
  });

  it("leaves a fresh Spanish venue's holiday storage empty while its address reads the shipped holidays, and a re-run keeps entries made later", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Holiday Venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
        province: "Sevilla",
        city: "Sevilla",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const cfg = { locationId };
    const node = { locationId, nodeId: await seedNode(db, locationId) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const stored = async () =>
      (
        await db.execute(sql`
          select
            (select count(*) from holiday_geographies) as geographies,
            (select count(*) from local_holidays) as entries`)
      ).rows[0];

    await runSeed();
    expect(await stored()).toEqual({ geographies: 0, entries: 0 });
    const fresh = await db.transaction(async (tx) => ({
      read: await readHolidays(tx, cfg, "2026-01-01", "2026-01-31"),
      model: await readLocalHolidayModel(tx, cfg),
    }));
    expect(fresh.read.facts.map(({ date, scope }) => ({ date, scope }))).toEqual([
      { date: "2026-01-01", scope: "national" },
      { date: "2026-01-06", scope: "national" },
    ]);
    expect(fresh.read.coverage).toEqual([
      expect.objectContaining({
        year: 2026,
        provinceCode: "41",
        nationalRegional: "complete",
        local: "none_entered",
      }),
    ]);
    expect(fresh.model).toMatchObject({ geographies: [], entries: [] });

    const entry = await db.transaction((tx) =>
      saveLocalHoliday(tx, cfg, null, { date: "2026-06-04", name: "Corpus Christi" }),
    );
    const before = await db.transaction((tx) => readLocalHolidayModel(tx, cfg));
    await runSeed();
    expect(await db.transaction((tx) => readLocalHolidayModel(tx, cfg))).toEqual(before);
    expect(before.entries).toEqual([entry]);
    expect(await stored()).toEqual({ geographies: 1, entries: 1 });
  });

  describe("the venue's ordering profiles", () => {
    async function venue() {
      await seedTenant(db);
      const [location] = await db
        .insert(locations)
        .values({ name: "Bar Sol", invoiceLocales: ["es-ES"], operationDescription: "Bar" })
        .returning({ id: locations.id });
      const locationId = brandLocationId(location!.id);
      const node = { locationId, nodeId: await seedNode(db, locationId) };
      const profile = async (
        formFactor: "till" | "phone-portrait" | "tablet-landscape" | "kds",
        capabilities: string[],
      ) =>
        (
          await db
            .insert(deviceProfiles)
            .values({ name: `${formFactor} ${randomUUID()}`, formFactor, capabilities })
            .returning({ id: deviceProfiles.id })
        )[0]!.id;
      const profiles = {
        till: await profile("till", ["take-orders", "take-cash"]),
        phone: await profile("phone-portrait", ["take-orders"]),
        kitchen: await profile("kds", ["act-as-kds", "prepare-orders"]),
        pass: await profile("tablet-landscape", ["show-expo", "hand-over-orders"]),
      };
      const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
      const access = (id: string) =>
        db.transaction((tx) => readProfileServiceAccess(tx, { locationId }, id));
      const defaults = async () => {
        const rows = await db.execute<{ department_id: string; zone_id: string }>(sql`
          select department_id, zone_id from zone_service_policies
          where location_id = ${locationId} and is_counter_default = 1`);
        return rows.rows[0]!;
      };
      return { locationId, profiles, runSeed, access, defaults };
    }

    it("puts each profile that takes orders in the counter's department, every zone, starting at the counter, and leaves the kitchen display and a profile that takes no orders without one", async () => {
      const { profiles, runSeed, access, defaults } = await venue();

      await runSeed();

      const { department_id, zone_id } = await defaults();
      for (const id of [profiles.till, profiles.phone]) {
        expect(await access(id)).toEqual({
          departmentId: department_id,
          allowedZoneIds: [zone_id],
          startingZoneId: zone_id,
          stationIds: [],
          watcherIds: [],
        });
      }
      expect((await access(profiles.kitchen)).departmentId).toBeNull();
      expect((await access(profiles.pass)).departmentId).toBeNull();
    });

    it("keeps the kitchen lists of a profile it gives a scope, switched-off entries included", async () => {
      const { locationId, profiles, runSeed } = await venue();
      const [grill] = await db
        .insert(kitchenStations)
        .values({ locationId, name: `Grill ${randomUUID()}`, active: false })
        .returning({ id: kitchenStations.id });
      const [bar] = await db
        .insert(kitchenStations)
        .values({ locationId, name: `Bar ${randomUUID()}` })
        .returning({ id: kitchenStations.id });
      await db.insert(deviceProfileStations).values([
        { deviceProfileId: profiles.till, stationId: grill!.id },
        { deviceProfileId: profiles.till, stationId: bar!.id },
      ]);

      await runSeed();

      const lists = await db.transaction((tx) => readProfileKitchenLists(tx, { locationId }));
      expect(lists.find((entry) => entry.profileId === profiles.till)?.stationIds.sort()).toEqual(
        [grill!.id, bar!.id].sort(),
      );
    });

    it("leaves a profile's scope alone on a re-run", async () => {
      const { locationId, profiles, runSeed, access, defaults } = await venue();
      await runSeed();
      const { department_id } = await defaults();
      const terrace = await db.transaction((tx) =>
        createServiceZone(tx, { locationId }, { name: "Terrace", departmentId: department_id }),
      );
      await db.transaction((tx) =>
        setProfileServiceAccess(tx, { locationId }, profiles.till, {
          departmentId: department_id,
          allowedZoneIds: [terrace.id],
          startingZoneId: terrace.id,
          stationIds: [],
          watcherIds: [],
        }),
      );
      const before = await access(profiles.till);

      await runSeed();

      expect(await access(profiles.till)).toEqual(before);
      expect(before.allowedZoneIds).toEqual([terrace.id]);
    });
  });
});
