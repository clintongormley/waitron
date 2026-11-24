import { deleteCourse } from "./course-delete.js";
import { deleteStation } from "./station-delete.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenCourses,
  kitchenStations,
  products,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  AppError,
  DEFAULT_READY_WARNING_AFTER_MINUTES,
  DEFAULT_STATION_THRESHOLDS,
  STATION_COLOURS,
} from "@waitron/shared";

import {
  createCourse,
  createStation,
  listCourses,
  listStations,
  moveCourse,
  setDefaultStation,
  setProductCourse,
  updateCourse,
  updateStation,
} from "./kitchen.js";
import "./errors.js";

// The one-default partial unique is pinned in packages/db/src/schema/kitchen-stations.test.ts.
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<void> {
  await seedVenue(db, {
    name: "Main bar",
    invoiceLocales: [LOCALE],
  });
  await seedNode(db);
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("kitchen-station config", () => {
  it("A725 lower-case accents and enyes use Spanish alphabetical station order", async () => {
    await setupVenue();
    for (const name of ["Ñandú", "barra", "Cocina", "Ásador", "Níspero", "Naranja"])
      await asApp((tx) => createStation(tx, { name }));
    expect((await listStations(db)).map(({ name }) => name)).toEqual([
      "Ásador",
      "barra",
      "Cocina",
      "Naranja",
      "Níspero",
      "Ñandú",
    ]);
  });

  it("A725 backend station lists use names and keep the default among them", async () => {
    await setupVenue();
    await asApp(async (tx) => {
      await createStation(tx, { name: "Zulu", isDefault: true });
      await createStation(tx, { name: "Bar" });
      await createStation(tx, { name: "Alpha" });
    });
    await db.execute(sql`pragma reverse_unordered_selects = on`);
    try {
      const stations = await listStations(db);
      expect(stations.map(({ name }) => name)).toEqual(["Alpha", "Bar", "Zulu"]);
      expect(stations.map(({ isDefault }) => isDefault)).toEqual([false, false, true]);
      expect(stations.every((station) => !Object.hasOwn(station, "displayOrder"))).toBe(true);
    } finally {
      await db.execute(sql`pragma reverse_unordered_selects = off`);
    }
  });

  it("A725 gives sequential omitted colours the first unused choices", async () => {
    await setupVenue();
    const ids = await asApp(async (tx) => {
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      const bar = await createStation(tx, { name: "Bar" });
      return [kitchen.id, bar.id];
    });
    const rows = await listStations(db);
    expect(ids.map((id) => rows.find((station) => station.id === id)!.colour)).toEqual([
      "red",
      "orange",
    ]);
  });

  it("A725 concurrent station creates reserve different unused colours", async () => {
    await setupVenue();
    const ids = await Promise.all([
      asApp((tx) => createStation(tx, { name: "Kitchen" })),
      asApp((tx) => createStation(tx, { name: "Bar" })),
    ]);
    const rows = await listStations(db);
    expect(ids.map(({ id }) => rows.find((station) => station.id === id)!.colour).sort()).toEqual([
      "orange",
      "red",
    ]);
  });

  it("A725 keeps explicit shared colours and fills the first unused gap", async () => {
    await setupVenue();
    const ids = await asApp(async (tx) => {
      await createStation(tx, { name: "Kitchen", colour: "red" });
      const blue = await createStation(tx, { name: "Bar", colour: "blue" });
      const duplicate = await createStation(tx, { name: "Coffee", colour: "blue" });
      const missing = await createStation(tx, { name: "Desserts" });
      return [blue.id, duplicate.id, missing.id];
    });
    const rows = await listStations(db);
    expect(ids.map((id) => rows.find((station) => station.id === id)!.colour)).toEqual([
      "blue",
      "blue",
      "orange",
    ]);
  });

  it("A725 does not reserve colours used by inactive stations", async () => {
    await setupVenue();
    await asApp((tx) => createStation(tx, { name: "Kitchen", colour: "red" }));
    const old = await asApp((tx) => createStation(tx, { name: "Old bar", colour: "orange" }));
    await asApp((tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, old.id)),
    );
    const created = await asApp((tx) => createStation(tx, { name: "Bar" }));
    expect((await listStations(db)).find((station) => station.id === created.id)!.colour).toBe(
      "orange",
    );
  });

  it("A725 reuses red when every station colour is occupied", async () => {
    await setupVenue();
    await asApp(async (tx) => {
      for (const colour of STATION_COLOURS)
        await createStation(tx, { name: `Station ${colour}`, colour });
    });
    const last = await asApp((tx) => createStation(tx, { name: "Extra station" }));
    expect((await listStations(db)).find((station) => station.id === last.id)!.colour).toBe("red");
  });

  it("creates/lists stations and flips the default atomically", async () => {
    await setupVenue();
    const { id: a } = await asApp((tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
    const { id: b } = await asApp((tx) => createStation(tx, { name: "Bar" }));
    await asApp((tx) => setDefaultStation(tx, b)); // must clear a's default in the same tx
    const list = await asApp((tx) => listStations(tx));
    expect(list.find((s) => s.id === b)!.isDefault).toBe(true);
    expect(list.find((s) => s.id === a)!.isDefault).toBe(false);
    await expect(asApp((tx) => createStation(tx, { name: "Kitchen" }))).rejects.toMatchObject({
      code: "station.name_taken",
    });
  });

  it("defaults isDefault to false and lists active stations by name", async () => {
    await setupVenue();
    await asApp((tx) => createStation(tx, { name: "Zebra" }));
    await asApp((tx) => createStation(tx, { name: "Alpha" }));
    await asApp((tx) => createStation(tx, { name: "Bar" }));
    const list = await asApp((tx) => listStations(tx));
    const defaultThresholds = {
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      readyWarningAfterMinutes: 3,
    };
    expect(list).toEqual([
      {
        id: expect.any(String),
        name: "Alpha",
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        printMovedSlips: true,
        colour: "orange",
        ticketGrouping: "combined",
        printHeldWork: false,
        bumpMode: "line",
        changesAfterSending: "held-or-waiting",
        waitsForPass: false,
        ...defaultThresholds,
        whenClosedSendsTo: null,
      },
      {
        id: expect.any(String),
        name: "Bar",
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        printMovedSlips: true,
        colour: "amber",
        ticketGrouping: "combined",
        printHeldWork: false,
        bumpMode: "line",
        changesAfterSending: "held-or-waiting",
        waitsForPass: false,
        ...defaultThresholds,
        whenClosedSendsTo: null,
      },
      {
        id: expect.any(String),
        name: "Zebra",
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        printMovedSlips: true,
        colour: "red",
        ticketGrouping: "combined",
        printHeldWork: false,
        bumpMode: "line",
        changesAfterSending: "held-or-waiting",
        waitsForPass: false,
        ...defaultThresholds,
        whenClosedSendsTo: null,
      },
    ]);
  });

  it("a new station groups identical dishes, prints no held work in advance and prints MOVED slips", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Griddle" }));
    const [row] = await db
      .select({
        ticketGrouping: kitchenStations.ticketGrouping,
        printHeldWork: kitchenStations.printHeldWork,
        printMovedSlips: kitchenStations.printMovedSlips,
      })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(row).toEqual({
      ticketGrouping: "combined",
      printHeldWork: false,
      printMovedSlips: true,
    });
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject({
      ticketGrouping: "combined",
      printHeldWork: false,
      printMovedSlips: true,
    });
  });

  it("a new station is done one item at a time", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject({
      bumpMode: "line",
    });
  });

  it("updateStation writes a station's bump mode and leaves the others", async () => {
    await setupVenue();
    const { id: bar } = await asApp((tx) => createStation(tx, { name: "Bar" }));
    const { id: grill } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    const before = await asApp((tx) => listStations(tx));
    await asApp((tx) => updateStation(tx, bar, { bumpMode: "ticket" }));
    const after = await asApp((tx) => listStations(tx));
    expect(after.find((s) => s.id === bar)).toEqual({
      ...before.find((s) => s.id === bar),
      bumpMode: "ticket",
    });
    expect(after.find((s) => s.id === grill)).toEqual(before.find((s) => s.id === grill));
    expect(after.find((s) => s.id === grill)!.bumpMode).toBe("line");
  });

  it("a new station allows changes while held or waiting", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject({
      changesAfterSending: "held-or-waiting",
    });
  });

  it("updateStation writes a station's changes after sending and leaves the others", async () => {
    await setupVenue();
    const { id: bar } = await asApp((tx) => createStation(tx, { name: "Bar" }));
    const { id: grill } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    const before = await asApp((tx) => listStations(tx));
    await asApp((tx) => updateStation(tx, bar, { changesAfterSending: "never" }));
    const after = await asApp((tx) => listStations(tx));
    expect(after.find((s) => s.id === bar)).toEqual({
      ...before.find((s) => s.id === bar),
      changesAfterSending: "never",
    });
    expect(after.find((s) => s.id === grill)).toEqual(before.find((s) => s.id === grill));
    expect(after.find((s) => s.id === grill)!.changesAfterSending).toBe("held-or-waiting");
  });

  it("a station stored with no MOVED slips choice answers that it prints them", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Griddle" }));
    await db.execute(sql`update kitchen_stations set print_moved_slips = null where id = ${id}`);
    const [row] = await db
      .select({ printMovedSlips: kitchenStations.printMovedSlips })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(row!.printMovedSlips).toBeNull();
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject({
      printMovedSlips: true,
    });
  });

  it("updateStation writes a station's three printing choices and leaves the others", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Griddle" }));
    const { id: other } = await asApp((tx) => createStation(tx, { name: "Bar" }));
    const before = await asApp((tx) => listStations(tx));
    await asApp((tx) =>
      updateStation(tx, id, {
        ticketGrouping: "separate",
        printHeldWork: true,
        printMovedSlips: false,
      }),
    );
    const after = await asApp((tx) => listStations(tx));
    expect(after.find((s) => s.id === id)).toEqual({
      ...before.find((s) => s.id === id),
      ticketGrouping: "separate",
      printHeldWork: true,
      printMovedSlips: false,
    });
    expect(after.find((s) => s.id === other)).toEqual(before.find((s) => s.id === other));
    await asApp((tx) => updateStation(tx, id, { printHeldWork: false }));
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toEqual({
      ...before.find((s) => s.id === id),
      ticketGrouping: "separate",
      printHeldWork: false,
      printMovedSlips: false,
    });
  });

  it("createStation with isDefault adopts the station as THE default, clearing any prior (single default kept)", async () => {
    await setupVenue();
    const { id: a } = await asApp((tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
    const { id: c } = await asApp((tx) => createStation(tx, { name: "Griddle", isDefault: true }));
    const list = await asApp((tx) => listStations(tx));
    expect(list.find((s) => s.id === a)!.isDefault).toBe(false);
    expect(list.find((s) => s.id === c)!.isDefault).toBe(true);
    expect(list.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("updateStation renames but cannot reactivate a removed station", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Griddle" }));
    await asApp((tx) => updateStation(tx, id, { name: "Grill" }));
    expect((await asApp((tx) => listStations(tx))).map((s) => s.name)).toEqual(["Grill"]);
    expect(await asApp((tx) => listStations(tx))).toEqual([
      {
        id,
        name: "Grill",
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        printMovedSlips: true,
        colour: "red",
        ticketGrouping: "combined",
        printHeldWork: false,
        bumpMode: "line",
        changesAfterSending: "held-or-waiting",
        waitsForPass: false,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
        readyWarningAfterMinutes: 3,
        whenClosedSendsTo: null,
      },
    ]);
    await asApp((tx) => deleteStation(tx, id));
    expect(await asApp((tx) => listStations(tx))).toEqual([]);
    await expect(
      asApp((tx) => updateStation(tx, id, { active: true } as never)),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "active" } });
    await expect(asApp((tx) => updateStation(tx, id, {}))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: id },
    });
  });

  it("A773 station policy: a station starts not waiting, and a patch switches it on and off", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    const waits = async () =>
      (await asApp((tx) => listStations(tx))).find((s) => s.id === id)!.waitsForPass;
    expect(await waits()).toBe(false);
    await asApp((tx) => updateStation(tx, id, { waitsForPass: true }));
    expect(await waits()).toBe(true);
    await asApp((tx) => updateStation(tx, id, { name: "Grill two" }));
    expect(await waits()).toBe(true);
    await asApp((tx) => updateStation(tx, id, { waitsForPass: false }));
    expect(await waits()).toBe(false);
    await asApp((tx) => updateStation(tx, id, { name: "Grill three" }));
    expect(await waits()).toBe(false);
  });

  it("A773 station policy: create stores a given waitsForPass", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill", waitsForPass: true }));
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)!.waitsForPass).toBe(
      true,
    );
  });

  it("updateStation surfaces a name collision as station.name_taken", async () => {
    await setupVenue();
    await asApp((tx) => createStation(tx, { name: "Kitchen" }));
    const { id } = await asApp((tx) => createStation(tx, { name: "Bar" }));
    await expect(asApp((tx) => updateStation(tx, id, { name: "Kitchen" }))).rejects.toMatchObject({
      code: "station.name_taken",
      params: { name: "Kitchen" },
    });
  });

  it("updateStation and deleteStation throw station.not_found for an unknown id", async () => {
    await setupVenue();
    const missing = randomUUID();
    await expect(asApp((tx) => updateStation(tx, missing, { name: "X" }))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: missing },
    });
    await expect(asApp((tx) => deleteStation(tx, missing))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: missing },
    });
  });

  it("createStation preserves a database error and updateStation names an invalid effective threshold", async () => {
    await setupVenue();
    await db.execute(sql`
      create trigger kitchen_stations_refuse_insert before insert on kitchen_stations
      begin select raise(abort, 'station insert refused'); end`);
    let createErr: unknown;
    try {
      createErr = await asApp((tx) => createStation(tx, { name: "Big" })).catch((e: unknown) => e);
    } finally {
      await db.execute(sql`drop trigger kitchen_stations_refuse_insert`);
    }
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);
    expect(String(createErr)).toMatch(/station insert refused/);

    const { id } = await asApp((tx) => createStation(tx, { name: "Ord" }));
    const updateErr = await asApp((tx) => updateStation(tx, id, { warmAfterMinutes: 99 })).catch(
      (e: unknown) => e,
    );
    expect(updateErr).toMatchObject({
      code: "station.thresholds_invalid",
      params: { field: "overdueAfterMinutes", stationId: id, name: "Ord" },
    });
  });

  async function storedMinutes(id: string) {
    return (
      await db
        .select({
          warmAfterMinutes: kitchenStations.warmAfterMinutes,
          overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
          forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
        })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id))
    )[0];
  }

  it("a station made with no minutes starts at the default late flags, on its own row", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Plain" }));
    expect(await storedMinutes(id)).toEqual(DEFAULT_STATION_THRESHOLDS);
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject(
      DEFAULT_STATION_THRESHOLDS,
    );
  });

  it("a station row given no minutes takes the schema's defaults, equal to DEFAULT_STATION_THRESHOLDS", async () => {
    await setupVenue();
    const id = randomUUID();
    await db.insert(kitchenStations).values({ id, name: "Bare" });
    expect(await storedMinutes(id)).toEqual(DEFAULT_STATION_THRESHOLDS);
  });

  it("a station row given no ready warning takes the schema's default, equal to DEFAULT_READY_WARNING_AFTER_MINUTES", async () => {
    await setupVenue();
    const id = randomUUID();
    await db.insert(kitchenStations).values({ id, name: "Bare" });
    const [row] = await db
      .select({ readyWarningAfterMinutes: kitchenStations.readyWarningAfterMinutes })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(row!.readyWarningAfterMinutes).toBe(DEFAULT_READY_WARNING_AFTER_MINUTES);
  });

  it("createStation and updateStation write the station's own row, and an omitted field keeps its value", async () => {
    await setupVenue();
    const { id } = await asApp((tx) =>
      createStation(tx, {
        name: "Own",
        thresholds: { warmAfterMinutes: 3, overdueAfterMinutes: 8 },
      }),
    );
    expect(await storedMinutes(id)).toEqual({
      warmAfterMinutes: 3,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 15,
    });
    await asApp((tx) => updateStation(tx, id, { name: "Renamed", overdueAfterMinutes: 7 }));
    expect(await storedMinutes(id)).toEqual({
      warmAfterMinutes: 3,
      overdueAfterMinutes: 7,
      forgottenAfterMinutes: 15,
    });
    expect((await asApp((tx) => listStations(tx))).find((s) => s.id === id)).toMatchObject({
      name: "Renamed",
      warmAfterMinutes: 3,
      overdueAfterMinutes: 7,
      forgottenAfterMinutes: 15,
    });
  });

  it("a station's answer carries only its own minutes", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Only own" }));
    const station = (await asApp((tx) => listStations(tx))).find((s) => s.id === id);
    expect(station).not.toHaveProperty("timingDefaults");
    expect(station).not.toHaveProperty("timingOverrides");
  });

  async function storedReadyWarning(id: string) {
    return (
      await db
        .select({ readyWarningAfterMinutes: kitchenStations.readyWarningAfterMinutes })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id))
    )[0]!.readyWarningAfterMinutes;
  }

  it("createStation stores a given ready warning, and 3 when none is given; listStations reads it", async () => {
    await setupVenue();
    const { id: given } = await asApp((tx) =>
      createStation(tx, { name: "Given", thresholds: { readyWarningAfterMinutes: 6 } }),
    );
    const { id: plain } = await asApp((tx) => createStation(tx, { name: "Plain" }));
    expect(await storedReadyWarning(given)).toBe(6);
    expect(await storedReadyWarning(plain)).toBe(3);
    const list = await asApp((tx) => listStations(tx));
    expect(list.find((s) => s.id === given)!.readyWarningAfterMinutes).toBe(6);
    expect(list.find((s) => s.id === plain)!.readyWarningAfterMinutes).toBe(3);
  });

  it("updateStation saves a ready warning of 20 beside Forgotten after 15, and leaves the late flags", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Pass" }));
    await asApp((tx) => updateStation(tx, id, { readyWarningAfterMinutes: 20 }));
    expect(await storedReadyWarning(id)).toBe(20);
    expect(await storedMinutes(id)).toEqual({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    });
    await asApp((tx) => updateStation(tx, id, { warmAfterMinutes: 4 }));
    expect(await storedReadyWarning(id)).toBe(20);
    expect(await storedMinutes(id)).toEqual({
      warmAfterMinutes: 4,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    });
  });

  it("updateStation refuses a ready warning of 0, naming it, and writes nothing", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Pass" }));
    await expect(
      asApp((tx) => updateStation(tx, id, { name: "Renamed", readyWarningAfterMinutes: 0 })),
    ).rejects.toMatchObject({
      code: "station.thresholds_invalid",
      params: { field: "readyWarningAfterMinutes", stationId: id, name: "Pass" },
    });
    expect(await storedReadyWarning(id)).toBe(3);
    expect((await asApp((tx) => listStations(tx))).map((s) => s.name)).toEqual(["Pass"]);
  });

  it("createStation refuses a ready warning of 0, naming it, and creates no station", async () => {
    await setupVenue();
    await expect(
      asApp((tx) =>
        createStation(tx, { name: "Pass", thresholds: { readyWarningAfterMinutes: 0 } }),
      ),
    ).rejects.toMatchObject({
      code: "station.thresholds_invalid",
      params: { field: "readyWarningAfterMinutes", name: "Pass" },
    });
    expect(await db.select({ id: kitchenStations.id }).from(kitchenStations)).toEqual([]);
  });

  it("A1510 updateStation saves where a station's dishes go when it is closed, and null clears it", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    const { id: other } = await asApp((tx) => createStation(tx, { name: "Fryer" }));
    const setting = async () =>
      (await asApp((tx) => listStations(tx))).find((s) => s.id === id)!.whenClosedSendsTo;
    expect(await setting()).toBeNull();
    await asApp((tx) => updateStation(tx, id, { whenClosedSendsTo: other }));
    expect(await setting()).toBe(other);
    await asApp((tx) => updateStation(tx, id, { name: "Grill two" }));
    expect(await setting()).toBe(other);
    await asApp((tx) => updateStation(tx, id, { whenClosedSendsTo: null }));
    expect(await setting()).toBeNull();
  });

  it("A1510 updateStation refuses a when-closed station that is itself, unknown or deleted, and writes nothing", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createStation(tx, { name: "Grill" }));
    const { id: gone } = await asApp((tx) => createStation(tx, { name: "Old" }));
    await asApp((tx) => deleteStation(tx, gone));
    const missing = randomUUID();
    for (const [sendsToStationId, reason] of [
      [id, "self"],
      [missing, "unknown"],
      [gone, "inactive"],
    ] as const) {
      await expect(
        asApp((tx) =>
          updateStation(tx, id, { name: "Renamed", whenClosedSendsTo: sendsToStationId }),
        ),
      ).rejects.toMatchObject({
        code: "station.destination_invalid",
        params: { stationId: id, sendsToStationId, reason },
      });
    }
    const [row] = await db
      .select({ name: kitchenStations.name, to: kitchenStations.whenClosedSendsToStationId })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(row).toEqual({ name: "Grill", to: null });
  });

  it("setDefaultStation throws station.not_found for an absent OR a deleted station", async () => {
    await setupVenue();
    const missing = randomUUID();
    await expect(asApp((tx) => setDefaultStation(tx, missing))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: missing },
    });
    const { id } = await asApp((tx) => createStation(tx, { name: "Old" }));
    await asApp((tx) => deleteStation(tx, id));
    await expect(asApp((tx) => setDefaultStation(tx, id))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: id },
    });
  });
});

async function productCourse(productId: string): Promise<string | null> {
  const { rows } = await db.execute<{ course_id: string | null }>(
    sql`select course_id from products where id = ${productId}`,
  );
  return rows[0]!.course_id;
}
async function seedProduct(): Promise<string> {
  // `unit_price` counts whole cents: 1.00 EUR.
  const [row] = await db
    .insert(products)
    .values({
      name: "Routed product",

      unitPrice: 100,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

/** A variant of `parentId`: a `products` row with a parent, inheriting every routing column. */
async function seedVariant(parentId: string): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({ parentId, name: "Routed variant" })
    .returning({ id: products.id });
  return row!.id;
}

describe("kitchen-course config", () => {
  it("new courses have no department Fire-now exceptions", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createCourse(tx, { name: "Mains" }));
    expect(await asApp((tx) => listCourses(tx))).toMatchObject([{ id, fireNowZoneIds: [] }]);
  });

  it("creates/lists/updates/deletes a course and orders by display_order then name", async () => {
    await setupVenue();
    const { id: a } = await asApp((tx) => createCourse(tx, { name: "Mains", displayOrder: 1 }));
    await asApp((tx) => createCourse(tx, { name: "Starters", displayOrder: 0 }));
    await asApp((tx) => createCourse(tx, { name: "Zebra", displayOrder: 0 }));
    await asApp((tx) => createCourse(tx, { name: "Alpha", displayOrder: 0 }));
    const list = await asApp((tx) => listCourses(tx));
    expect(list.map((c) => c.name)).toEqual(["Alpha", "Starters", "Zebra", "Mains"]);
    expect(list[3]).toEqual({
      id: a,
      name: "Mains",
      displayOrder: 1,
      active: true,
      fireNowZoneIds: [],
    });
    await asApp((tx) => updateCourse(tx, a, { name: "Seconds", displayOrder: 9 }));
    const productId = await seedProduct();
    await asApp((tx) => setProductCourse(tx, productId, a));
    await asApp((tx) => deleteCourse(tx, a));
    expect((await asApp((tx) => listCourses(tx))).some((c) => c.id === a)).toBe(false);
    expect(await productCourse(productId)).toBeNull();
    expect(
      await asApp((tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, a))),
    ).toMatchObject([{ id: a, name: "Seconds", displayOrder: 9, active: false }]);
    await expect(asApp((tx) => updateCourse(tx, a, {}))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: a },
    });
  });

  it("createCourse defaults displayOrder to 0", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createCourse(tx, { name: "Desserts" }));
    const [only] = await asApp((tx) => listCourses(tx));
    expect(only).toEqual({
      id,
      name: "Desserts",
      displayOrder: 0,
      active: true,
      fireNowZoneIds: [],
    });
  });

  it("createCourse and updateCourse surface a duplicate name as course.name_taken", async () => {
    await setupVenue();
    await asApp((tx) => createCourse(tx, { name: "Starters" }));
    await expect(asApp((tx) => createCourse(tx, { name: "Starters" }))).rejects.toMatchObject({
      code: "course.name_taken",
      params: { name: "Starters" },
    });
    const { id } = await asApp((tx) => createCourse(tx, { name: "Mains" }));
    await expect(asApp((tx) => updateCourse(tx, id, { name: "Starters" }))).rejects.toMatchObject({
      code: "course.name_taken",
      params: { name: "Starters" },
    });
  });

  it("updateCourse and deleteCourse throw course.not_found for an unknown id", async () => {
    await setupVenue();
    const missing = randomUUID();
    await expect(asApp((tx) => updateCourse(tx, missing, { name: "X" }))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
    await expect(asApp((tx) => deleteCourse(tx, missing))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
  });

  it("createCourse rethrows a NON-unique DB error raw, not as course.name_taken", async () => {
    // The `updateCourse` half is the last suite in this file.
    await setupVenue();
    await db.execute(sql`
      create trigger kitchen_courses_refuse_insert before insert on kitchen_courses
      begin select raise(abort, 'course insert refused'); end`);
    let createErr: unknown;
    try {
      createErr = await asApp((tx) => createCourse(tx, { name: "Big" })).catch((e: unknown) => e);
    } finally {
      await db.execute(sql`drop trigger kitchen_courses_refuse_insert`);
    }
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);
    expect(String(createErr)).toMatch(/course insert refused/);
  });
});

describe("moveCourse", () => {
  /** Four courses created out of name order, so their firing order is A, B, C, D. */
  async function fourCourses(): Promise<string[]> {
    const ids: string[] = [];
    for (const [name, displayOrder] of [
      ["A", 0],
      ["B", 5],
      ["C", 5],
      ["D", 20],
    ] as const) {
      ids.push((await asApp((tx) => createCourse(tx, { name, displayOrder }))).id);
    }
    return ids;
  }

  async function storedOrders(ids: string[]): Promise<number[]> {
    const orders: number[] = [];
    for (const id of ids) {
      const { rows } = await db.execute<{ display_order: number }>(
        sql`select display_order from kitchen_courses where id = ${id}`,
      );
      orders.push(Number(rows[0]!.display_order));
    }
    return orders;
  }

  it("moves a course down, renumbers every active course 0..n-1 and returns the list", async () => {
    await setupVenue();
    const [a, b, c, d] = await fourCourses();
    const moved = await asApp((tx) => moveCourse(tx, a!, 2));
    expect(moved).toEqual([
      { id: b, name: "B", displayOrder: 0, active: true, fireNowZoneIds: [] },
      { id: c, name: "C", displayOrder: 1, active: true, fireNowZoneIds: [] },
      { id: a, name: "A", displayOrder: 2, active: true, fireNowZoneIds: [] },
      { id: d, name: "D", displayOrder: 3, active: true, fireNowZoneIds: [] },
    ]);
    expect(await storedOrders([b!, c!, a!, d!])).toEqual([0, 1, 2, 3]);
    expect(await asApp((tx) => listCourses(tx))).toEqual(moved);
  });

  it("moves a course up", async () => {
    await setupVenue();
    const [a, b, c, d] = await fourCourses();
    const moved = await asApp((tx) => moveCourse(tx, d!, 1));
    expect(moved.map((x) => x.id)).toEqual([a, d, b, c]);
    expect(moved.map((x) => x.displayOrder)).toEqual([0, 1, 2, 3]);
    expect(await storedOrders([a!, d!, b!, c!])).toEqual([0, 1, 2, 3]);
  });

  it("treats a position past the end as last", async () => {
    await setupVenue();
    const [a, b, c, d] = await fourCourses();
    const moved = await asApp((tx) => moveCourse(tx, b!, 99));
    expect(moved.map((x) => x.id)).toEqual([a, c, d, b]);
    expect(await storedOrders([a!, c!, d!, b!])).toEqual([0, 1, 2, 3]);
  });

  it("counts only active courses and leaves an inactive one's stored order alone", async () => {
    await setupVenue();
    const [a, b, c, d] = await fourCourses();
    await asApp((tx) =>
      tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, b!)),
    );
    const moved = await asApp((tx) => moveCourse(tx, a!, 1));
    expect(moved.map((x) => x.id)).toEqual([c, a, d]);
    expect(moved.map((x) => x.displayOrder)).toEqual([0, 1, 2]);
    expect(await storedOrders([b!])).toEqual([5]);
  });

  it("refuses an inactive course with course.not_found and changes nothing", async () => {
    await setupVenue();
    const [a, b, c, d] = await fourCourses();
    await asApp((tx) =>
      tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, b!)),
    );
    await expect(asApp((tx) => moveCourse(tx, b!, 0))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: b },
    });
    expect(await storedOrders([a!, b!, c!, d!])).toEqual([0, 5, 5, 20]);
  });

  it("refuses an unknown id with course.not_found", async () => {
    await setupVenue();
    await fourCourses();
    const missing = randomUUID();
    await expect(asApp((tx) => moveCourse(tx, missing, 0))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
  });
});

describe("product-course config", () => {
  it("setProductCourse sets then clears the product's default course", async () => {
    await setupVenue();
    const productId = await seedProduct();
    const { id: courseId } = await asApp((tx) => createCourse(tx, { name: "Mains" }));
    await asApp((tx) => setProductCourse(tx, productId, courseId));
    expect(await productCourse(productId)).toBe(courseId);
    await asApp((tx) => setProductCourse(tx, productId, null));
    expect(await productCourse(productId)).toBeNull();
  });

  it("setProductCourse refuses a variant's id, as it does an id naming no product, with product.not_found", async () => {
    await setupVenue();
    const productId = await seedProduct();
    const variantId = await seedVariant(productId);
    const missing = randomUUID();
    const { id: courseId } = await asApp((tx) => createCourse(tx, { name: "Desserts" }));
    await expect(asApp((tx) => setProductCourse(tx, variantId, courseId))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: variantId },
    });
    expect(await productCourse(variantId)).toBeNull();
    await expect(asApp((tx) => setProductCourse(tx, missing, courseId))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: missing },
    });
    await asApp((tx) => setProductCourse(tx, productId, courseId));
    expect(await productCourse(productId)).toBe(courseId);
  });

  it('setProductCourse writes to a variant under scope "any"', async () => {
    await setupVenue();
    const variantId = await seedVariant(await seedProduct());
    const { id: courseId } = await asApp((tx) => createCourse(tx, { name: "Desserts" }));
    await asApp((tx) => setProductCourse(tx, variantId, courseId, "any"));
    expect(await productCourse(variantId)).toBe(courseId);
  });

  it.each(["variant", "parent"] as const)(
    'setProductCourse under scope "any" refuses an archived %s without changing the variant course',
    async (archived) => {
      await setupVenue();
      const productId = await seedProduct();
      const variantId = await seedVariant(productId);
      const { id: courseId } = await asApp((tx) => createCourse(tx, { name: "Desserts" }));
      await asApp((tx) => setProductCourse(tx, variantId, courseId, "any"));
      await db
        .update(products)
        .set({ active: false })
        .where(eq(products.id, archived === "parent" ? productId : variantId));
      await expect(
        asApp((tx) => setProductCourse(tx, variantId, null, "any")),
      ).rejects.toMatchObject({
        code: "product.archived",
        params: { productId: variantId },
      });
      expect(await productCourse(variantId)).toBe(courseId);
    },
  );

  it("the top-level course path refuses an archived family before its variant scope", async () => {
    await setupVenue();
    const productId = await seedProduct();
    const variantId = await seedVariant(productId);
    await db.update(products).set({ active: false }).where(eq(products.id, productId));
    const before = await db.select().from(products).where(eq(products.id, variantId));
    await expect(asApp((tx) => setProductCourse(tx, variantId, null))).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: variantId },
    });
    expect(await db.select().from(products).where(eq(products.id, variantId))).toEqual(before);
  });

  it("setProductCourse names the product before an unknown course", async () => {
    await setupVenue();
    const missing = randomUUID();
    await expect(asApp((tx) => setProductCourse(tx, missing, randomUUID()))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: missing },
    });
  });

  it("setProductCourse rejects an inactive or absent course with course.not_found", async () => {
    await setupVenue();
    const productId = await seedProduct();
    const missing = randomUUID();
    await expect(asApp((tx) => setProductCourse(tx, productId, missing))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
    const { id: dead } = await asApp((tx) => createCourse(tx, { name: "Retired" }));
    await asApp((tx) =>
      tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, dead)),
    );
    await expect(asApp((tx) => setProductCourse(tx, productId, dead))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: dead },
    });
  });
});

describe("updateCourse with a refusal that is not the name unique", () => {
  it("rethrows it raw rather than relabelling it course.name_taken", async () => {
    await setupVenue();
    const { id } = await asApp((tx) => createCourse(tx, { name: "Starters" }));
    // `kitchen_courses` declares no CHECK, so a temporary trigger supplies the non-unique refusal.
    await db.execute(sql`
      create trigger kitchen_courses_refuse_update before update on kitchen_courses
      begin select raise(abort, 'course update refused'); end`);
    try {
      const refusal = await asApp((tx) => updateCourse(tx, id, { name: "First courses" })).catch(
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toBeInstanceOf(AppError);
      expect(String(refusal)).toMatch(/course update refused/);
    } finally {
      await db.execute(sql`drop trigger kitchen_courses_refuse_update`);
    }
  });
});
