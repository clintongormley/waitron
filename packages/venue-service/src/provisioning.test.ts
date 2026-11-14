import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
  floorZones,
  withTransaction,
  catalogues,
  kitchenStations,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles, seedNode, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { readHolidays, readHolidayAreaModel } from "./holidays.js";
import { calendarDays } from "./hours.js";
import { saveSpecialDay } from "./special-days.js";
import { readSeasons } from "./seasons.js";
import { createServiceZone } from "./operations.js";
import { readProfileKitchenScreens } from "./kitchen-screens.js";
import { readProfileServiceAccess, setProfileServiceAccess } from "./profile-access.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";
import { STARTER_STEPS } from "./service-steps.js";
import {
  STARTER_COURSE_NAMES,
  STARTER_PERIOD_NAMES,
  STARTER_SEASON_NAMES,
  STARTER_STEP_NAMES,
  STARTER_ZONE_NAMES,
} from "./starter-content.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("VENUE_SERVICE_PROVISIONING", () => {
  it.each(["en", "es"] as const)(
    "uses the chosen %s names for fresh service starters",
    async (staffLanguage) => {
      const [menu] = await db
        .insert(catalogues)
        .values({ name: "House menu" })
        .returning({ id: catalogues.id });
      await seedVenue(db, {
        invoiceLocales: [staffLanguage === "en" ? "es-ES" : "en-GB"],
        defaultCatalogueId: menu!.id,
      });
      const node = { nodeId: await seedNode(db) };
      await withTransaction(db, (tx) =>
        VENUE_SERVICE_PROVISIONING.seed!.run(tx, node, undefined, { staffLanguage }),
      );
      const rows = (query: Parameters<typeof db.all>[0]) => db.all(query);
      const names = (english: string, translations: Record<string, { es: string }>) => ({
        name: staffLanguage === "en" ? english : translations[english]!.es,
      });
      expect(rows(sql`select name from service_steps order by position`)).toEqual(
        ["Set up", "Take order", "Anything else?"].map((name) => names(name, STARTER_STEP_NAMES)),
      );
      expect(rows(sql`select name from floor_zones`)).toEqual([
        names("Counter", STARTER_ZONE_NAMES),
      ]);
      expect(rows(sql`select name from seasons order by starts_on`)).toEqual(
        ["Spring", "Summer", "Autumn", "Winter"].map((name) => names(name, STARTER_SEASON_NAMES)),
      );
      expect(rows(sql`select name from menu_periods`)).toEqual([
        names("Open", STARTER_PERIOD_NAMES),
      ]);
      expect(rows(sql`select name from kitchen_courses order by display_order`)).toEqual(
        ["Sharing plates", "Starters", "Mains", "Desserts"].map((name) =>
          names(name, STARTER_COURSE_NAMES),
        ),
      );
    },
  );

  describe("country starter courses", () => {
    it.each([
      [
        "ES",
        "en-GB",
        ["Sharing plates", "Starters", "Mains", "Desserts"],
        [false, false, true, true],
      ],
      ["ES", "es-ES", null, [false, false, true, true]],
      ["GB", "en-GB", ["Starters", "Mains", "Desserts"], [false, true, true]],
      ["ZZ", "en-GB", [], []],
    ] as const)(
      "seeds %s courses in %s with their firing defaults",
      async (country, locale, english, held) => {
        await seedVenue(db, { invoiceLocales: [locale] });
        await db.execute(sql`update tenants set country = ${country}`);
        const node = { nodeId: await seedNode(db) };
        await withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
        const rows = await db.execute(sql`
        select name, display_order, held_until_fired, active from kitchen_courses order by display_order`);
        const names = english ?? [
          STARTER_COURSE_NAMES["Sharing plates"].es,
          STARTER_COURSE_NAMES.Starters.es,
          STARTER_COURSE_NAMES.Mains.es,
          STARTER_COURSE_NAMES.Desserts.es,
        ];
        expect(rows.rows).toEqual(
          names.map((name, display_order) => ({
            name,
            display_order,
            held_until_fired: Number(held[display_order]),
            active: 1,
          })),
        );
      },
    );

    it("keeps authored courses and does not put deleted starters back on a retry", async () => {
      await seedVenue(db, { invoiceLocales: ["en-GB"] });
      const node = { nodeId: await seedNode(db) };
      const seed = () =>
        withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
      const rows = async () =>
        (
          await db.execute(sql`
        select id, name, display_order, held_until_fired, active from kitchen_courses order by display_order`)
        ).rows;
      await seed();
      expect(await rows()).toHaveLength(4);
      await db.execute(
        sql`update kitchen_courses set name = 'House mains', held_until_fired = 0 where display_order = 2`,
      );
      await db.execute(sql`delete from kitchen_courses where display_order = 0`);
      await db.execute(sql`update kitchen_courses set active = 0 where display_order = 3`);
      const authored = await rows();
      await seed();
      expect(await rows()).toEqual(authored);
      await db.execute(sql`delete from kitchen_courses`);
      await seed();
      expect(await rows()).toEqual([]);
    });

    it("adds no courses when promoting a department already authored by the venue", async () => {
      await seedVenue(db, { invoiceLocales: ["en-GB"] });

      await db.insert(departments).values({ name: "Dining", tradingName: "Dining" });
      const node = { nodeId: await seedNode(db) };
      await withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
      expect((await db.execute(sql`select name from kitchen_courses`)).rows).toEqual([]);
    });
  });

  it("places Open once and preserves its authored ranges on a second seed", async () => {
    const [menu] = await db
      .insert(catalogues)
      .values({ name: "First menu" })
      .returning({ id: catalogues.id });
    await seedVenue(db, {
      name: "First venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      defaultCatalogueId: menu!.id,
    });
    const node = { nodeId: await seedNode(db) };
    const seed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const rows = () =>
      db.execute(
        sql`select p.name, p.menu_id, d.weekday, s.starts_at, s.ends_at from menu_periods p join departments dep on dep.id = p.department_id join department_day_ranges s on s.period_id = p.id join department_days d on d.id = s.day_id join seasons se on se.id = d.season_id and se.starts_on = '12-01'  order by d.weekday`,
      );
    await seed();
    expect((await rows()).rows).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({
        name: "Open",
        menu_id: menu!.id,
        weekday,
        starts_at: "09:00:00",
        ends_at: "17:00:00",
      })),
    );
    await db.execute(
      sql`update department_day_ranges set ends_at = '16:00:00' where period_id = (select p.id from menu_periods p join departments d on d.id = p.department_id )`,
    );
    await seed();
    expect((await rows()).rows).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({
        name: "Open",
        menu_id: menu!.id,
        weekday,
        starts_at: "09:00:00",
        ends_at: "16:00:00",
      })),
    );
  });

  it("names the default department after the venue", async () => {
    const [menu] = await db
      .insert(catalogues)
      .values({ name: "First menu" })
      .returning({ id: catalogues.id });
    await seedVenue(db, {
      name: "The Square",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      defaultCatalogueId: menu!.id,
    });
    const node = { nodeId: await seedNode(db) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const rows = await db.execute<{ name: string; trading_name: string }>(sql`
      select name, trading_name from departments `);
    expect(rows.rows).toEqual([{ name: "The Square", trading_name: "The Square" }]);
    const zones = await db.execute<{ name: string }>(sql`
      select name from floor_zones where is_counter_default = 1`);
    expect(zones.rows).toEqual([{ name: STARTER_ZONE_NAMES.Counter.es }]);
    const periods = await db.execute<{ name: string }>(sql`
      select p.name from menu_periods p join departments d on d.id = p.department_id
      `);
    expect(periods.rows).toEqual([{ name: STARTER_PERIOD_NAMES.Open.es }]);
    const steps = await db.execute<{ name: string }>(sql`
      select s.name from service_steps s join departments d on d.id = s.department_id
       order by s.position`);
    expect(steps.rows).toEqual(
      STARTER_STEPS.map((step) => ({ name: STARTER_STEP_NAMES[step.name].es })),
    );
    const seasons = await db.transaction((tx) => readSeasons(tx));
    expect(seasons.map(({ name }) => name)).toEqual(
      (["Spring", "Summer", "Autumn", "Winter"] as const).map(
        (season) => STARTER_SEASON_NAMES[season].es,
      ),
    );
  });

  describe("the starter service steps", () => {
    async function venue(name: string) {
      await seedVenue(db, { name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" });
      const node = { nodeId: await seedNode(db) };
      return {
        seed: () => withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node)),
        steps: async () =>
          (
            await db.execute<{
              name: string;
              start: string;
              minutes: number;
              position: number;
            }>(sql`
              select s.name, s.start, s.minutes, s.position from service_steps s
              join departments d on d.id = s.department_id
               order by s.position`)
          ).rows,
      };
    }

    it("the seed gives the department it creates the starter steps", async () => {
      const { seed, steps } = await venue("Starter seed");
      await seed();
      expect(await steps()).toEqual([
        { name: "Set up", start: "seated", minutes: 0, position: 0 },
        { name: "Take order", start: "after_previous", minutes: 2, position: 1 },
        { name: "Anything else?", start: "all_served", minutes: 10, position: 2 },
      ]);
    });

    it("a second run of the seed puts back no step the venue deleted", async () => {
      const { seed, steps } = await venue("Starter re-run");
      await seed();
      expect(await steps()).toHaveLength(3);
      await db.execute(
        sql`delete from service_steps where department_id in (select id from departments )`,
      );
      await seed();
      expect(await steps()).toEqual([]);
    });

    it("the seed adds no steps to the department it promotes to default", async () => {
      const { seed, steps } = await venue("Starter promote");
      const [department] = await db
        .insert(departments)
        .values({ name: "Bar", tradingName: "Bar", active: true })
        .returning({ id: departments.id });
      await seed();
      const [promoted] = await db
        .select({ id: departments.id, isDefault: departments.isDefault })
        .from(departments);
      expect(promoted).toEqual({ id: department!.id, isDefault: true });
      expect(await steps()).toEqual([]);
    });
  });

  it("gives the venue the four default seasons", async () => {
    await seedVenue(db, {
      name: "Seasonal",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const node = { nodeId: await seedNode(db) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const read = await db.transaction((tx) => readSeasons(tx));
    expect(read.map(({ name, startsOn }) => ({ name, startsOn }))).toEqual([
      { name: "Spring", startsOn: "03-01" },
      { name: "Summer", startsOn: "06-01" },
      { name: "Autumn", startsOn: "09-01" },
      { name: "Winter", startsOn: "12-01" },
    ]);
  });

  it("seeds quick-sale and receipt defaults without a zone override", async () => {
    await seedVenue(db, {
      name: "Corner Kitchen",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const node = { nodeId: await seedNode(db) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const department = await db.execute<{
      paid_when: string;
      collection_number: string;
      print_trading_name: number;
    }>(sql`
      select order_start, paid_when, collection_number, print_trading_name
      from department_sale_policies
      where department_id = (
        select id from departments where is_default = 1
      )`);
    expect(department.rows).toEqual([
      {
        order_start: "counter",
        paid_when: "prepay",
        collection_number: "none",
        print_trading_name: 1,
      },
    ]);
    const zone = await db.execute<{
      paid_when: string | null;
      collection_number: string | null;
    }>(sql`
      select paid_when, collection_number
      from floor_zones where is_counter_default = 1`);
    expect(zone.rows).toEqual([{ paid_when: null, collection_number: null }]);
  });

  it("seeds one counter policy idempotently without resetting authored mode", async () => {
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const nodeId = await seedNode(db);
    const node = { nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe("default department and counter zone ready");
    const menus = await db
      .insert(catalogues)
      .values([{ name: "Provisioned" }, { name: "Authored" }])
      .returning({ id: catalogues.id });
    await db.execute(sql`
      update catalogues set is_default = (id = ${menus[0]!.id})`);
    await db.execute(sql`
      insert into menu_periods (id, department_id, name, menu_id)
      select ${randomUUID()}, department_id, 'Authored', ${menus[1]!.id}
      from floor_zones`);
    await db.execute(
      sql`update floor_zones set order_start = 'counter', paid_when = 'ticket_then_pay'`,
    );
    await runSeed();

    const departments = await db.execute<{ count: number }>(sql`
      select count(*) as count from departments`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*) as count from floor_zones`);
    const policies = await db.execute<{ order_start: string | null; paid_when: string | null }>(sql`
      select order_start, paid_when from floor_zones`);
    const periods = await db.execute<{ menu_id: string }>(sql`
      select menu_id from menu_periods`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([{ order_start: "counter", paid_when: "ticket_then_pay" }]);
    expect(periods.rows).toEqual([{ menu_id: menus[1]!.id }]);
  });

  it("seeds the venue's Open period and preserves authored name, colour and staff order on a re-run", async () => {
    const [menu] = await db
      .insert(catalogues)
      .values({ name: "Carta" })
      .returning({ id: catalogues.id });
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      defaultCatalogueId: menu!.id,
    });
    const node = { nodeId: await seedNode(db) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const listed = async () =>
      (
        await db.execute(sql`
      select p.id, p.menu_id, p.name, p.colour
      from menu_periods p join departments d on d.id = p.department_id
      `)
      ).rows;
    await runSeed();
    const original = await listed();
    expect(original).toEqual([
      { id: expect.any(String), menu_id: menu!.id, name: "Open", colour: "red" },
    ]);
    const periodId = original[0]!.id as string;
    await db.execute(
      sql`update menu_periods set name = 'Authored hours', colour = 'blue' where id = ${periodId}`,
    );
    const [staff] = await db
      .insert(catalogues)
      .values({ name: "Staff" })
      .returning({ id: catalogues.id });
    await db.execute(sql`insert into menu_period_staff_menus (period_id, department_id, menu_id, display_order)
      select id, department_id, ${staff!.id}, 5 from menu_periods where id = ${periodId}`);
    await runSeed();
    expect(await listed()).toEqual([
      { id: periodId, menu_id: menu!.id, name: "Authored hours", colour: "blue" },
    ]);
    expect(
      (
        await db.execute(
          sql`select period_id, menu_id, display_order from menu_period_staff_menus where period_id = ${periodId}`,
        )
      ).rows,
    ).toEqual([{ period_id: periodId, menu_id: staff!.id, display_order: 5 }]);
  });

  it("leaves no service settings table", async () => {
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const node = { nodeId: await seedNode(db) };
    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    expect(
      (
        await db.execute(
          sql`select name from sqlite_master where type = 'table' and name = 'service_settings'`,
        )
      ).rows,
    ).toEqual([]);
  });
  it("leaves a fresh Spanish venue's holiday storage empty while its address reads the shipped holidays, and a re-run keeps entries made later", async () => {
    await seedVenue(db, {
      name: "Holiday Venue",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
      province: "Sevilla",
      city: "Sevilla",
    });
    const node = { nodeId: await seedNode(db) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const stored = async () =>
      (
        await db.execute(sql`
          select
            (select count(*) from settings where module = 'venue' and json_type(doc, '$.holidayArea') = 'object') as geographies,
            (select count(*) from special_days) as entries`)
      ).rows[0];

    await runSeed();
    expect(await stored()).toEqual({ geographies: 0, entries: 0 });
    const fresh = await db.transaction(async (tx) => ({
      read: await readHolidays(tx, "2026-01-01", "2026-01-31"),
      model: await readHolidayAreaModel(tx),
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
    expect(fresh.model).toMatchObject({ chosen: null });

    const entry = await db.transaction((tx) =>
      saveSpecialDay(
        tx,
        null,
        {
          name: "Corpus Christi",
          repeatsYearly: false,
          dates: [{ date: "2026-06-04", closedAllDay: false }],
        },
        new Date("2026-01-01T12:00:00Z"),
        1,
      ),
    );
    const readDays = () =>
      db.transaction((tx) => calendarDays(tx, ["2026-06-04"], []).then(({ days }) => days));
    const before = await readDays();
    await runSeed();
    expect(await readDays()).toEqual(before);
    expect(before[0]!.specialDay).toEqual({ id: entry.id, name: "Corpus Christi" });
    expect(await stored()).toEqual({ geographies: 0, entries: 1 });
  });

  describe("the venue's ordering profiles", () => {
    async function venue() {
      await seedVenue(db, {
        name: "Sun Bar",
        invoiceLocales: ["es-ES"],
        operationDescription: "Bar",
      });
      const node = { nodeId: await seedNode(db) };
      const profile = async (
        formFactor: "till" | "phone-portrait" | "tablet-landscape" | "kds",
        capabilities: string[],
      ) =>
        (
          await seedDeviceProfiles(db, {
            name: `${formFactor} ${randomUUID()}`,
            formFactor,
            capabilities,
          })
        )[0]!.id;
      const profiles = {
        till: await profile("till", ["take-orders", "take-cash"]),
        phone: await profile("phone-portrait", ["take-orders"]),
        kitchen: await profile("kds", ["act-as-kds", "prepare-orders"]),
        pass: await profile("tablet-landscape", ["show-expo", "hand-over-orders"]),
      };
      const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
      const access = (id: string) => db.transaction((tx) => readProfileServiceAccess(tx, id));
      const defaults = async () => {
        const rows = await db.execute<{ department_id: string; zone_id: string }>(sql`
          select department_id, id as zone_id from floor_zones
          where is_counter_default = 1`);
        return rows.rows[0]!;
      };
      return { profiles, runSeed, access, defaults };
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
        });
      }
      expect((await access(profiles.kitchen)).departmentId).toBeNull();
      expect((await access(profiles.pass)).departmentId).toBeNull();
    });

    it("keeps stored kitchen screen bindings while hiding deleted stations from scoped profile choices", async () => {
      const { profiles, runSeed } = await venue();
      const [grill] = await db
        .insert(kitchenStations)
        .values({ name: `Grill ${randomUUID()}`, active: false })
        .returning({ id: kitchenStations.id });
      const [bar] = await db
        .insert(kitchenStations)
        .values({ name: `Bar ${randomUUID()}` })
        .returning({ id: kitchenStations.id });
      await db
        .insert(deviceProfileKitchenScreens)
        .values({ deviceProfileId: profiles.till, screen: "pass", everyZone: true });
      await db.insert(deviceProfileKitchenScreenStations).values([
        { deviceProfileId: profiles.till, screen: "pass", stationId: grill!.id },
        { deviceProfileId: profiles.till, screen: "pass", stationId: bar!.id },
      ]);

      const bindings = () =>
        db
          .select()
          .from(deviceProfileKitchenScreenStations)
          .where(eq(deviceProfileKitchenScreenStations.deviceProfileId, profiles.till))
          .orderBy(deviceProfileKitchenScreenStations.stationId);
      const before = await bindings();
      expect(before.map((row) => row.stationId)).toEqual([grill!.id, bar!.id].sort());

      await runSeed();

      expect(await bindings()).toEqual(before);
      const screens = await db.transaction((tx) => readProfileKitchenScreens(tx));
      const till = screens.find((entry) => entry.profileId === profiles.till)?.screens;
      expect({ ...till?.pass, stationIds: [...(till?.pass?.stationIds ?? [])].sort() }).toEqual({
        stationIds: [bar!.id],
        zoneIds: null,
        showNonPassStations: true,
      });
    });

    it("leaves a profile's scope alone on a re-run", async () => {
      const { profiles, runSeed, access, defaults } = await venue();
      await runSeed();
      const { department_id } = await defaults();
      const terrace = await db.transaction((tx) =>
        createServiceZone(tx, { name: "Terrace", departmentId: department_id }),
      );
      await db.transaction((tx) =>
        setProfileServiceAccess(tx, profiles.till, {
          departmentId: department_id,
          allowedZoneIds: [terrace.id],
          startingZoneId: terrace.id,
        }),
      );
      const before = await access(profiles.till);

      await runSeed();

      expect(await access(profiles.till)).toEqual(before);
      expect(before.allowedZoneIds).toEqual([terrace.id]);
    });
  });
});

it("seeds a new Counter id while retaining a deleted Counter", async () => {
  await seedVenue(db, {
    name: "Venue",
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
  });
  const node = { nodeId: await seedNode(db) };
  const seeded = await seedZone(db, { name: "Counter", active: false });
  const [old] = await db.select().from(floorZones).where(eq(floorZones.id, seeded.id));
  await withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
  const rows = await db
    .select()
    .from(floorZones)
    .where(sql`true`);
  expect(rows).toHaveLength(2);
  expect(rows).toContainEqual(old);
  const replacement = rows.find((row) => row.active)!;
  expect(replacement.name).toBe("Counter");
  expect(replacement.id).not.toBe(old!.id);
  expect(
    (
      await db.execute<{ zone_id: string }>(
        sql`select id as zone_id from floor_zones where is_counter_default = 1`,
      )
    ).rows,
  ).toEqual([{ zone_id: replacement.id }]);
  await withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
  expect(
    await db
      .select()
      .from(floorZones)
      .where(sql`true`),
  ).toEqual(rows);
});
