import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { saveSpecialDate } from "./hours.js";
import { readOpeningHoursModel, saveMenuPeriod } from "./menu-timetable.js";
import type { MenuSlot, OpeningHoursModel } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
  ],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

async function routed() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
    })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const cfg = { locationId };
  await db.insert(kitchenStations).values({ locationId, name: "Cocina", isDefault: true });
  const zone = async (name: string) =>
    (await db.insert(floorZones).values({ locationId, name }).returning({ id: floorZones.id }))[0]!
      .id;
  const barra = await zone("Barra");
  const mostrador = await zone("Mostrador deli");
  const made = await scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", defaultServiceMode: "table_tab" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" }))
      .id;
    await configureZone(tx, cfg, { zoneId: barra, departmentId: restaurant });
    await configureZone(tx, cfg, { zoneId: mostrador, departmentId: deli });
    const menu = async (name: string) => {
      const id = (await createCatalogue(tx, { name })).id;
      const { document } = await buildMenuDocument(tx, id);
      await publishMenu(tx, id, menuDocumentHash(document), "person-1");
      return id;
    };
    const desayunos = await menu("Desayunos");
    const almuerzo = await menu("Almuerzo");
    const cafe = await menu("Café");
    const deliParaLlevar = await menu("Deli para llevar");
    const mananas = (
      await saveMenuPeriod(tx, cfg, restaurant, {
        name: "Mañanas",
        menuId: desayunos,
        staffMenuIds: [],
      })
    ).id;
    const christmas = (
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2030-12-25",
          name: "Navidad",
          closeWholeVenue: false,
          ownHours: true,
          cells: [],
        },
        new Date(),
      )
    ).id;
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      deli,
      desayunos,
      almuerzo,
      cafe,
      deliParaLlevar,
      mananas,
      christmas,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
      staff: await person("staff"),
    };
  });
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg, core: {} as ModuleRouteContext["core"] }, noopLog);
  const send = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const model = () => scoped((tx) => readOpeningHoursModel(tx, cfg, new Date()));
  return { ...made, cfg, barra, mostrador, app, send, model };
}

type Routed = Awaited<ReturnType<typeof routed>>;
const restaurantOf = (model: OpeningHoursModel, r: Routed) =>
  model.departments.find((department) => department.id === r.restaurant)!;
const week = (slots: MenuSlot[]) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: weekday === 1 ? slots : [] }));

async function answers(response: Response, status: number, error?: Record<string, unknown>) {
  expect(response.status).toBe(status);
  if (error !== undefined) expect(await response.json()).toEqual({ error });
}

describe("the opening-hours routes", () => {
  it("accepts a signed end offset on create and PATCH, and retains it on a name-only edit", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      menuId: r.almuerzo,
      staffMenuIds: [],
      endOffsetMinutes: -15,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const saved = async () => restaurantOf(await r.model(), r).periods.find((p) => p.id === id)!;
    expect(await saved()).toMatchObject({ endOffsetMinutes: -15 });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { name: "Afternoon" }),
      204,
    );
    expect(await saved()).toMatchObject({ name: "Afternoon", endOffsetMinutes: -15 });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { endOffsetMinutes: 14 }),
      204,
    );
    expect(await saved()).toMatchObject({ endOffsetMinutes: 14 });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { endOffsetMinutes: 0 }),
      204,
    );
    expect(await saved()).toMatchObject({ endOffsetMinutes: 0 });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { endOffsetMinutes: null }),
      400,
      {
        code: "menu_period.invalid",
        params: { field: "endOffsetMinutes", reason: "whole_minutes" },
      },
    );
    expect(await saved()).toMatchObject({ endOffsetMinutes: 0 });
  });

  it("show the model to anyone who may view the venue's settings", async () => {
    const r = await routed();
    const read = await r.send("GET", "/opening-hours", r.supervisor);
    expect(read.status).toBe(200);
    const body = (await read.json()) as OpeningHoursModel;
    expect(body).toEqual(JSON.parse(JSON.stringify(await r.model())));
    expect(restaurantOf(body, r).periods.map((period) => period.name)).toEqual(["Mañanas"]);
    await answers(await r.send("GET", "/opening-hours", r.staff), 403);
  });

  it("create, rename and delete a named period, and save the week, a special date's timetable", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      staffMenuIds: [],
      name: "Mediodía",
      menuId: r.almuerzo,
    });
    expect(created.status).toBe(201);
    const mediodia = (await created.json()) as { id: string };
    expect(mediodia).toEqual({ id: expect.any(String) });
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === mediodia.id),
    ).toMatchObject({ name: "Mediodía", menuId: r.almuerzo });

    const renamed = await r.send("PATCH", `/menu-periods/${mediodia.id}`, r.manager, {
      name: "Comidas",
      menuId: r.cafe,
    });
    expect(renamed.status).toBe(204);
    expect(await renamed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === mediodia.id),
    ).toMatchObject({ name: "Comidas", menuId: r.cafe });

    const monday = [{ periodId: r.mananas, startsAt: "09:00", endsAt: "12:00" }];
    await answers(
      await r.send("PUT", `/departments/${r.restaurant}/menu-week`, r.manager, {
        days: week(monday),
      }),
      204,
    );
    const christmas = [{ periodId: r.mananas, startsAt: "10:00", endsAt: "13:00" }];
    const dateTimetable = `/special-dates/${r.christmas}/menu-timetables/${r.restaurant}`;
    await answers(await r.send("PUT", dateTimetable, r.manager, { slots: christmas }), 204);
    await answers(
      await r.send("PUT", `/zones/${r.barra}/period-menus/${r.mananas}`, r.manager, {
        menuId: r.cafe,
      }),
      404,
    );
    let model = await r.model();
    const restaurant = restaurantOf(model, r);
    expect(restaurant.week.find((day) => day.weekday === 1)!.slots).toEqual(monday);
    expect(restaurant.dates).toEqual([{ specialDateId: r.christmas, slots: christmas }]);
    expect(model.namedDays.find((date) => date.id === r.christmas)!.name).toBe("Navidad");

    await answers(
      await r.send("PUT", `/zones/${r.barra}/period-menus/${r.mananas}`, r.manager, {
        menuId: null,
      }),
      404,
    );
    await answers(await r.send("DELETE", dateTimetable, r.manager), 404);
    await answers(
      await r.send("PUT", `/special-dates/${r.christmas}`, r.manager, {
        date: "2030-12-25",
        name: "Navidad",
        colour: "red",
        closeWholeVenue: false,
        ownHours: false,
        cells: [],
      }),
      200,
    );
    await answers(await r.send("DELETE", `/menu-periods/${mediodia.id}`, r.manager), 204);
    model = await r.model();
    expect(restaurantOf(model, r).dates).toEqual([]);
    expect(restaurantOf(model, r).periods.map((period) => period.id)).toEqual([r.mananas]);
    expect(model.namedDays.find((date) => date.id === r.christmas)!.name).toBe("Navidad");
  });

  it("change only what a period update sends, keeping a rename made in the meantime", async () => {
    const r = await routed();
    await answers(
      await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, {
        name: "Desayunos tempranos",
        menuId: r.desayunos,
      }),
      204,
    );
    const pointed = await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, {
      menuId: r.cafe,
    });
    expect(pointed.status).toBe(204);
    expect(await pointed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === r.mananas),
    ).toMatchObject({ name: "Desayunos tempranos", menuId: r.cafe });
    const renamed = await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, {
      name: "Mañanas",
    });
    expect(renamed.status).toBe(204);
    expect(await renamed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === r.mananas),
    ).toMatchObject({ name: "Mañanas", menuId: r.cafe });
    await answers(await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, {}), 400, {
      code: "management.request_invalid",
      params: { field: "body" },
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, { menuId: r.cafe, name: 7 }),
      400,
      { code: "management.request_invalid", params: { field: "name" } },
    );
  });

  it("update a period only by PATCH: a PUT to its address finds no route and changes nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const put = await r.send("PUT", `/menu-periods/${r.mananas}`, r.manager, {
      name: "Desayunos tempranos",
      menuId: r.cafe,
    });
    expect(put.status).toBe(404);
    expect(await r.model()).toEqual(before);
  });

  it("tell a period name another period has apart from a name refused for itself", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      staffMenuIds: [],
      name: "Tardes",
      menuId: r.cafe,
    });
    const tardes = ((await created.json()) as { id: string }).id;
    await answers(
      await r.send("PATCH", `/menu-periods/${tardes}`, r.manager, { name: " Mañanas " }),
      409,
      { code: "menu_period.name_taken", params: { departmentId: r.restaurant, name: "Mañanas" } },
    );
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "  ",
        menuId: r.cafe,
      }),
      400,
      { code: "menu_timetable.invalid", params: { field: "name" } },
    );
    expect(restaurantOf(await r.model(), r).periods.map((period) => period.name)).toEqual([
      "Mañanas",
      "Tardes",
    ]);
  });

  it("refuse every write to anyone who may not manage venue service, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const writes: ["POST" | "PUT" | "PATCH" | "DELETE", string, unknown][] = [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "Tardes", menuId: r.cafe, staffMenuIds: [] },
      ],
      ["PATCH", `/menu-periods/${r.mananas}`, { name: "Tardes", menuId: r.cafe, staffMenuIds: [] }],
      ["DELETE", `/menu-periods/${r.mananas}`, undefined],
      ["PUT", `/departments/${r.restaurant}/menu-week`, { days: week([]) }],
      ["PUT", `/special-dates/${r.christmas}/menu-timetables/${r.restaurant}`, { slots: [] }],
    ];
    for (const [method, path, body] of writes) {
      const response = await r.send(method, path, r.supervisor, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect(await r.model()).toEqual(before);
  });

  it("answer each refusal with its status and params", async () => {
    const r = await routed();
    const unknown = randomUUID();
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "Para llevar",
        menuId: unknown,
      }),
      404,
      {
        code: "catalogue.not_found",
        params: { catalogueId: unknown },
      },
    );
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "Mañanas",
        menuId: r.cafe,
      }),
      409,
      { code: "menu_period.name_taken", params: { departmentId: r.restaurant, name: "Mañanas" } },
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${unknown}`, r.manager, { name: "X", menuId: r.cafe }),
      404,
      { code: "menu_period.not_found", params: { periodId: unknown } },
    );
    await answers(
      await r.send("PUT", `/zones/${r.barra}/period-menus/${unknown}`, r.manager, { menuId: null }),
      404,
    );
    await answers(
      await r.send("PUT", `/zones/${r.mostrador}/period-menus/${r.mananas}`, r.manager, {
        menuId: r.deliParaLlevar,
      }),
      404,
    );
    await answers(
      await r.send("PUT", `/departments/${r.restaurant}/menu-week`, r.manager, {
        days: week([{ periodId: r.mananas, startsAt: "09:00", endsAt: "09:00" }]),
      }),
      400,
      { code: "menu_timetable.invalid", params: { field: "days.1.slots", reason: "empty" } },
    );
    await answers(
      await r.send("PUT", `/special-dates/${unknown}/menu-timetables/${r.restaurant}`, r.manager, {
        slots: [],
      }),
      404,
      { code: "special_date.not_found", params: { specialDateId: unknown } },
    );
    await answers(
      await r.send("PUT", `/departments/${r.restaurant}/menu-week`, r.manager, {
        days: week([{ periodId: r.mananas, startsAt: "09:00", endsAt: "12:00" }]),
      }),
      204,
    );
    await answers(await r.send("DELETE", `/menu-periods/${r.mananas}`, r.manager), 409, {
      code: "menu_period.in_use",
      params: { periodId: r.mananas, uses: [{ kind: "week", weekday: 1 }] },
    });
    await answers(
      await r.send("PUT", `/departments/${r.restaurant}/menus`, r.manager, {
        menuIds: [r.almuerzo, r.cafe],
      }),
      404,
    );
  });

  it("refuse a malformed id or body naming the field", async () => {
    const r = await routed();
    for (const [method, path, body, field] of [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: 7, menuId: r.cafe, staffMenuIds: [] },
        "name",
      ],
      ["POST", `/departments/${r.restaurant}/menu-periods`, { name: "X", menuId: "x" }, "menuId"],
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "X", menuId: r.cafe, departmentId: r.deli },
        "departmentId",
      ],
      ["PATCH", `/menu-periods/${r.mananas}`, { name: "X", menuId: "x" }, "menuId"],
      ["PUT", `/departments/${r.restaurant}/menu-week`, { days: [], extra: 1 }, "extra"],
      ["PUT", `/special-dates/${r.christmas}/menu-timetables/${r.restaurant}`, { at: 1 }, "at"],
    ] as const)
      await answers(await r.send(method, path, r.manager, body), 400, {
        code: "management.request_invalid",
        params: { field },
      });
    for (const [method, path] of [
      ["POST", "/departments/x/menu-periods"],
      ["PATCH", "/menu-periods/x"],
      ["DELETE", "/menu-periods/x"],
      ["PUT", "/departments/x/menu-week"],
      ["PUT", `/special-dates/x/menu-timetables/${r.restaurant}`],
    ] as const) {
      const response = await r.send(method, path, r.manager, method === "DELETE" ? undefined : {});
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "shared.invalid_id",
      );
    }
  });
});

describe("the opening-hours period API", () => {
  it("reads the opening-hours model with venue-view permission", async () => {
    const r = await routed();
    const response = await r.send("GET", "/opening-hours", r.supervisor);
    expect(response.status).toBe(200);
    const model = (await response.json()) as OpeningHoursModel;
    expect(model).toEqual(
      JSON.parse(
        JSON.stringify(await scoped((tx) => readOpeningHoursModel(tx, r.cfg, new Date()))),
      ),
    );
    expect(model.departments.find((department) => department.id === r.restaurant)!.periods).toEqual(
      [
        {
          id: r.mananas,
          name: "Mañanas",
          menuId: r.desayunos,
          colour: "red",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [],
        },
      ],
    );
    await answers(await r.send("GET", "/opening-hours", r.staff), 403);
  });

  it("creates colour and ordered staff menus, then updates each without losing omitted fields", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      colour: "blue",
      menuId: r.almuerzo,
      staffMenuIds: [r.cafe, r.deliParaLlevar],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const period = async () =>
      (await scoped((tx) => readOpeningHoursModel(tx, r.cfg, new Date()))).departments
        .find((department) => department.id === r.restaurant)!
        .periods.find((value) => value.id === id)!;
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "blue",
      menuId: r.almuerzo,
      staffMenuIds: [r.cafe, r.deliParaLlevar],
      endOffsetMinutes: 0,
      weekdays: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { colour: "green" }),
      204,
    );
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "green",
      menuId: r.almuerzo,
      staffMenuIds: [r.cafe, r.deliParaLlevar],
      endOffsetMinutes: 0,
      weekdays: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, {
        staffMenuIds: [r.deliParaLlevar, r.cafe],
      }),
      204,
    );
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "green",
      menuId: r.almuerzo,
      staffMenuIds: [r.deliParaLlevar, r.cafe],
      endOffsetMinutes: 0,
      weekdays: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { staffMenuIds: [] }),
      204,
    );
    expect((await period()).staffMenuIds).toEqual([]);
  });

  it("takes the next unused colour only when it is absent", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      menuId: r.almuerzo,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const model = await scoped((tx) => readOpeningHoursModel(tx, r.cfg, new Date()));
    expect(
      model.departments
        .find((department) => department.id === r.restaurant)!
        .periods.find((value) => value.id === id)!.colour,
    ).toBe("amber");
  });

  for (const method of ["POST", "PATCH"] as const) {
    for (const [field, value] of [
      ["colour", null],
      ["colour", ["blue"]],
      ["colour", "orange"],
      ["colour", 1],
      ["staffMenuIds", null],
      ["staffMenuIds", "x"],
      ["staffMenuIds", [null]],
      ["staffMenuIds", ["not-a-uuid"]],
    ] as const) {
      it(`${method} refuses malformed ${field} ${JSON.stringify(value)} without writing`, async () => {
        const r = await routed();
        const before = await r.model();
        const path =
          method === "POST"
            ? `/departments/${r.restaurant}/menu-periods`
            : `/menu-periods/${r.mananas}`;
        await answers(
          await r.send(method, path, r.manager, {
            name: "Lunch",
            menuId: r.almuerzo,
            staffMenuIds: [],
            [field]: value,
          }),
          400,
          { code: "management.request_invalid", params: { field } },
        );
        expect(await r.model()).toEqual(before);
      });
    }
  }

  it("requires staffMenuIds on creation", async () => {
    const r = await routed();
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        name: "Lunch",
        menuId: r.almuerzo,
      }),
      400,
      { code: "management.request_invalid", params: { field: "staffMenuIds" } },
    );
  });

  it("rejects duplicate and customer staff menus with the domain refusal", async () => {
    const r = await routed();
    for (const method of ["POST", "PATCH"] as const) {
      const path =
        method === "POST"
          ? `/departments/${r.restaurant}/menu-periods`
          : `/menu-periods/${r.mananas}`;
      for (const staffMenuIds of [[r.almuerzo], [r.cafe, r.cafe]]) {
        await answers(
          await r.send(method, path, r.manager, {
            name: "Lunch",
            menuId: r.almuerzo,
            staffMenuIds,
          }),
          400,
          { code: "menu_period.invalid", params: { field: "staffMenuIds" } },
        );
      }
    }
  });
});

describe("retired menu timetable routes", () => {
  it("answers 404 for each old endpoint and leaves opening hours unchanged", async () => {
    const r = await routed();
    const before = await r.model();
    for (const [method, path, body] of [
      ["GET", "/menu-timetable", undefined],
      ["PUT", `/departments/${r.restaurant}/menus`, { menuIds: [r.cafe] }],
      ["PUT", `/departments/${r.restaurant}/all-day-menu`, { menuId: r.cafe }],
      ["PUT", `/zones/${r.barra}/all-day-menu`, { menuId: r.cafe }],
      ["PUT", `/zones/${r.barra}/period-menus/${r.mananas}`, { menuId: r.cafe }],
    ] as const) {
      await answers(await r.send(method, path, r.manager, body), 404);
      expect(await r.model()).toEqual(before);
    }
  });

  it("chooses any active catalogue as a period's customer menu", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      menuId: r.deliParaLlevar,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === id)!.menuId,
    ).toBe(r.deliParaLlevar);
  });
});

it("reports offset placement refusals on the submitted field and retains the complete model", async () => {
  const r = await routed();
  const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
    name: "Dinner",
    menuId: r.almuerzo,
    staffMenuIds: [],
  });
  expect(created.status).toBe(201);
  const dinner = ((await created.json()) as { id: string }).id;
  const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    slots: [
      { periodId: r.mananas, startsAt: "12:00", endsAt: "14:00" },
      { periodId: dinner, startsAt: "14:15", endsAt: "18:00" },
    ],
  }));
  expect(
    (await r.send("PUT", `/departments/${r.restaurant}/menu-week`, r.manager, { days })).status,
  ).toBe(204);
  const before = await r.model();
  await answers(
    await r.send("PATCH", `/menu-periods/${r.mananas}`, r.manager, { endOffsetMinutes: 15 }),
    400,
    {
      code: "menu_period.invalid",
      params: {
        field: "endOffsetMinutes",
        reason: "placement",
        periodId: r.mananas,
        departmentId: r.restaurant,
        weekday: 0,
      },
    },
  );
  expect(await r.model()).toEqual(before);
});

it("refuses dated writes on a day keeping the week and no longer offers per-department clearing", async () => {
  const r = await routed();
  await answers(
    await r.send("PUT", `/special-dates/${r.christmas}`, r.manager, {
      date: "2030-12-25",
      name: "Navidad",
      colour: "red",
      closeWholeVenue: false,
      ownHours: false,
      cells: [],
    }),
    200,
  );
  const path = `/special-dates/${r.christmas}/menu-timetables/${r.restaurant}`;
  await answers(await r.send("PUT", path, r.manager, { slots: [] }), 409, {
    code: "special_date.keeps_week",
    params: { specialDateId: r.christmas },
  });
  await answers(await r.send("DELETE", path, r.manager), 404);
});

describe("zone closed-time routes", () => {
  it("writes a week and a named day and reads their zone ranges", async () => {
    const r = await routed();
    const ranges = [{ startsAt: "23:00", endsAt: "06:00" }];
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      ranges: weekday === 1 ? ranges : [],
    }));
    await answers(await r.send("PUT", `/zones/${r.barra}/closed-week`, r.manager, { days }), 204);
    await answers(
      await r.send("PUT", `/special-dates/${r.christmas}/zone-closed-times/${r.barra}`, r.manager, {
        ranges: [{ startsAt: "06:00", endsAt: "06:00" }],
      }),
      204,
    );
    const response = await r.send("GET", "/opening-hours", r.supervisor);
    expect(response.status).toBe(200);
    const saved = (await response.json()) as OpeningHoursModel;
    expect(restaurantOf(saved, r).zones).toEqual([
      {
        id: r.barra,
        name: "Barra",
        week: days,
        dates: [{ specialDateId: r.christmas, ranges: [{ startsAt: "06:00", endsAt: "06:00" }] }],
      },
    ]);
    await answers(await r.send("PUT", `/zones/${r.barra}/closed-week`, r.staff, { days }), 403);
    await answers(
      await r.send("PUT", `/special-dates/${r.christmas}/zone-closed-times/${r.barra}`, r.staff, {
        ranges: [],
      }),
      403,
    );
    await answers(
      await r.send("PUT", `/zones/${r.barra}/closed-week`, r.manager, {
        days: [
          ...days.slice(0, 6),
          { weekday: 6, ranges: [{ startsAt: "12:10", endsAt: "14:00" }] },
        ],
      }),
      400,
      { code: "zone_closed_time.invalid", params: { field: "days.6.ranges", reason: "step" } },
    );
    expect(restaurantOf(await r.model(), r).zones[0]!.week).toEqual(days);
  });
});
