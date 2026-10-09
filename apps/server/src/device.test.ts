/**
 * Device join-and-accept, plus direct cases over `resolveDeviceKitchenScreens` and `insertDevice`.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, locations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { FormFactor } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { insertDevice, resolveDeviceKitchenScreens } from "./device.js";
import { acceptDeviceJoinRequest, createJoinRequest, readJoinStatus } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { VENUE_SERVICE } from "./modules.js";
import type { DeviceKitchenScreen } from "@waitron/module";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface SeededVenue {
  cfg: TillConfig;
  stationId: string;
}

/** A fresh tenant + venue + one station. Every test calls it, and `useVenueDb` empties the data
 * tables between tests, so the counts each case reads are its own. */
async function setupVenue(): Promise<SeededVenue> {
  const admin = suite.db;
  await seedTenant(admin);
  // Through the table definition: `locations.id` is a `$defaultFn` generator raw SQL never reaches.
  const [loc] = await admin
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const nodeId = await seedNode(admin, brandLocationId(locationId));
  const cfg: TillConfig = {
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const st = await withTransaction(admin, async (tx) => {
    return createStation(tx, cfg, { name: "Cocina", isDefault: true });
  });
  return { cfg, stationId: st.id };
}

/** `name` is unique among profiles that are not retired (`device_profiles_live_name_key`), so a
 * test seeding two profiles passes two distinct names. */
async function seedProfile(formFactor: FormFactor, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name, formFactor })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** Rows per table, so a case can say which tables an accept wrote to. */
async function rowCounts(): Promise<Record<string, number>> {
  const { rows: tables } = await suite.db.execute<{ name: string }>(sql`
    select name from sqlite_master
    where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`);
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from ${sql.identifier(name)}`,
    );
    counts[name] = rows[0]!.n;
  }
  return counts;
}

function changedCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after)
      .map(([name, n]) => [name, n - (before[name] ?? 0)] as const)
      .filter(([, delta]) => delta !== 0),
  );
}

async function activeNamed(locationId: string, label: string): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(sql`
    select count(*) as n from devices
    where location_id = ${locationId} and label = ${label} and active = 1`);
  return rows[0]!.n;
}

function deviceValues(locationId: string, deviceProfileId: string, label: string) {
  return { id: randomUUID(), locationId, deviceProfileId, label, tokenHash: "x", active: true };
}

/** The enrolled device's profile and label, read straight off the table rather than out of the
 * verb's return value. */
async function deviceRow(deviceId: string): Promise<{ device_profile_id: string; label: string }> {
  const { rows } = await suite.db.execute<{ device_profile_id: string; label: string }>(sql`
    select device_profile_id, label from devices where id = ${deviceId}`);
  return rows[0]!;
}

describe("device join-and-accept binds the device by its profile's form factor", () => {
  it("accepting a till profile writes the device row and nothing else", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    const before = await rowCounts();

    const dev = await enrolDeviceForTest(suite.db, cfg, { name: "Caja Nueva", profileId });

    expect(changedCounts(before, await rowCounts())).toEqual({ devices: 1 });
    expect(await deviceRow(dev.deviceId)).toEqual({
      device_profile_id: profileId,
      label: "Caja Nueva",
    });
  });

  it("accepting a handheld needs no till and stores no binding beyond its profile", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("phone-portrait", "Perfil Móvil");
    const before = await rowCounts();

    const dev = await enrolDeviceForTest(suite.db, cfg, { name: "Camarero 1", profileId });

    expect(changedCounts(before, await rowCounts())).toEqual({ devices: 1 });
    expect(await deviceRow(dev.deviceId)).toEqual({
      device_profile_id: profileId,
      label: "Camarero 1",
    });
  });

  it("a kds profile shows the named station on its station screen", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile("kds", "Perfil KDS");

    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: "Pantalla Cocina",
      profileId,
      stationId,
    });

    expect(
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.readDeviceKitchenScreens(tx, cfg, dev.deviceId),
      ),
    ).toMatchObject([{ kind: "station", stations: [{ id: stationId, available: true }] }]);
  });

  it("accepting a kds device refuses a station its profile does not list, and the request survives", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile("kds", "Perfil KDS");
    const grill = await withTransaction(suite.db, (tx) =>
      createStation(tx, cfg, { name: "Grill" }),
    );
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, cfg, profileId, {
        station: { stationIds: [grill.id], zoneIds: null },
      }),
    );
    const window = createPairingMode();
    window.open();
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, cfg, { kind: "device", label: "Pantalla" }),
    );
    const accept = (kitchenScreens: readonly DeviceKitchenScreen[]) =>
      withTransaction(suite.db, (tx) =>
        acceptDeviceJoinRequest(tx, cfg, made.joinId, {
          label: "Pantalla",
          profileId,
          kitchenScreens,
        }),
      );

    await expect(
      accept([{ kind: "station", stationIds: [stationId], zoneIds: null }]),
    ).rejects.toMatchObject({
      code: "station.not_allowed",
      params: { stationId },
    });
    expect(await readJoinStatus(suite.db, cfg, made.joinId, made.token, window)).toBe("pending");
  });

  it("a kitchen display accepted with no kitchen screen is kitchen_screen.required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("kds", "Perfil KDS");
    await expect(
      enrolDeviceForTest(suite.db, cfg, { name: "Pantalla", profileId }),
    ).rejects.toMatchObject({ code: "kitchen_screen.required" });
  });
});

describe("accepting a device writes its kitchen screens", () => {
  async function offering(cfg: TillConfig, formFactor: FormFactor, name: string) {
    const profileId = await seedProfile(formFactor, name);
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, cfg, profileId, {
        station: { stationIds: null, zoneIds: null },
        pass: { stationIds: null, zoneIds: null },
      }),
    );
    return profileId;
  }

  async function accept(
    cfg: TillConfig,
    profileId: string,
    kitchenScreens: readonly DeviceKitchenScreen[],
  ) {
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, cfg, { kind: "device", label: "Pantalla" }),
    );
    return withTransaction(suite.db, (tx) =>
      acceptDeviceJoinRequest(tx, cfg, made.joinId, {
        label: "Pantalla",
        profileId,
        kitchenScreens,
      }),
    );
  }

  const shown = (cfg: TillConfig, deviceId: string) =>
    withTransaction(suite.db, (tx) => VENUE_SERVICE.readDeviceKitchenScreens(tx, cfg, deviceId));

  it("a kitchen display's station screen on two stations is stored", async () => {
    const { cfg, stationId } = await setupVenue();
    const grill = await withTransaction(suite.db, (tx) =>
      createStation(tx, cfg, { name: "Plancha" }),
    );
    const profileId = await offering(cfg, "kds", "Perfil KDS");
    const { deviceId } = await accept(cfg, profileId, [
      { kind: "station", stationIds: [stationId, grill.id], zoneIds: null },
    ]);
    expect(await shown(cfg, deviceId)).toEqual([
      {
        kind: "station",
        available: true,
        stations: [
          { id: stationId, name: "Cocina", available: true, switchedOff: false },
          { id: grill.id, name: "Plancha", available: true, switchedOff: false },
        ],
        zones: null,
      },
    ]);
  });

  it("a kitchen display's station screen on one station is stored", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await offering(cfg, "kds", "Perfil KDS");
    const { deviceId } = await accept(cfg, profileId, [
      { kind: "station", stationIds: [stationId], zoneIds: null },
    ]);
    expect(await shown(cfg, deviceId)).toMatchObject([
      { kind: "station", stations: [{ id: stationId, available: true }] },
    ]);
  });

  it("a kitchen display accepted with no kitchen screen is kitchen_screen.required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await offering(cfg, "kds", "Perfil KDS");
    await expect(accept(cfg, profileId, [])).rejects.toMatchObject({
      code: "kitchen_screen.required",
    });
  });

  it("a till accepted with a station screen and a pass screen stores both", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await offering(cfg, "till", "Perfil Caja");
    const { deviceId } = await accept(cfg, profileId, [
      { kind: "station", stationIds: [stationId], zoneIds: null },
      { kind: "pass", stationIds: null, zoneIds: null },
    ]);
    expect((await shown(cfg, deviceId)).map((screen) => screen.kind)).toEqual(["station", "pass"]);
  });

  it("the enrol helper adds each station it is given to the profile's station screen, and the device shows it", async () => {
    const { cfg, stationId } = await setupVenue();
    const grill = await withTransaction(suite.db, (tx) =>
      createStation(tx, cfg, { name: "Plancha" }),
    );
    const profileId = await seedProfile("kds", "Perfil KDS");
    const first = await enrolDeviceForTest(suite.db, cfg, {
      name: "Cocina 1",
      profileId,
      stationId,
    });
    const second = await enrolDeviceForTest(suite.db, cfg, {
      name: "Plancha 1",
      profileId,
      stationId: grill.id,
    });
    const offered = await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readProfileKitchenScreens(tx, cfg),
    );
    expect(offered.find((row) => row.profileId === profileId)?.screens).toEqual({
      station: { stationIds: [stationId, grill.id], zoneIds: null },
    });
    expect(await shown(cfg, first.deviceId)).toEqual([
      {
        kind: "station",
        available: true,
        stations: [{ id: stationId, name: "Cocina", available: true, switchedOff: false }],
        zones: null,
      },
    ]);
    expect((await shown(cfg, second.deviceId))[0]?.stations).toEqual([
      { id: grill.id, name: "Plancha", available: true, switchedOff: false },
    ]);
  });

  it("the enrol helper gives a kitchen screen it is handed, offered on the profile first", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    const { deviceId } = await enrolDeviceForTest(suite.db, cfg, {
      name: "Caja",
      profileId,
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
    });
    expect(await shown(cfg, deviceId)).toEqual([
      {
        kind: "pass",
        available: true,
        stations: [{ id: expect.any(String), name: "Cocina", available: true, switchedOff: false }],
        zones: null,
      },
    ]);
  });

  it("a till accepted with a pass monitor is kitchen_screen.not_allowed", async () => {
    const { cfg } = await setupVenue();
    const profileId = await offering(cfg, "till", "Perfil Caja");
    await expect(
      accept(cfg, profileId, [{ kind: "pass_monitor", stationIds: null, zoneIds: null }]),
    ).rejects.toMatchObject({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass_monitor" },
    });
  });
});

describe("device names among a location's active devices", () => {
  it("refuses a second active device of the same name there as device.name_taken, and the request survives", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    await enrolDeviceForTest(suite.db, cfg, { name: "Barra", profileId });
    // Opened before the request, or the status read discards it as made while the window was shut.
    const window = createPairingMode();
    window.open();
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, cfg, { kind: "device", label: "Barra" }),
    );

    await expect(
      withTransaction(suite.db, (tx) =>
        acceptDeviceJoinRequest(tx, cfg, made.joinId, { label: "Barra", profileId }),
      ),
    ).rejects.toMatchObject({ code: "device.name_taken" });

    expect(await readJoinStatus(suite.db, cfg, made.joinId, made.token, window)).toBe("pending");
    expect(await activeNamed(cfg.locationId, "Barra")).toBe(1);
  });

  it("accepts the same name at another location", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    await enrolDeviceForTest(suite.db, cfg, { name: "Barra", profileId });
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Terraza",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const otherCfg: TillConfig = { ...cfg, locationId: brandLocationId(other!.id) };

    await enrolDeviceForTest(suite.db, otherCfg, { name: "Barra", profileId });

    expect(await activeNamed(cfg.locationId, "Barra")).toBe(1);
    expect(await activeNamed(other!.id, "Barra")).toBe(1);
  });

  it("accepts the name of a revoked device there", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    const first = await enrolDeviceForTest(suite.db, cfg, { name: "Barra", profileId });
    await suite.db.execute(sql`update devices set active = 0 where id = ${first.deviceId}`);

    const second = await enrolDeviceForTest(suite.db, cfg, { name: "Barra", profileId });

    expect(second.deviceId).not.toBe(first.deviceId);
    expect(await activeNamed(cfg.locationId, "Barra")).toBe(1);
  });
});

describe("resolveDeviceKitchenScreens and insertDevice, called directly", () => {
  it("refuses a profile id that names no profile as device_profile.not_found", async () => {
    const { cfg } = await setupVenue();
    await expect(
      withTransaction(suite.db, (tx) =>
        resolveDeviceKitchenScreens(tx, cfg, { profileId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "device_profile.not_found" });
  });

  it("rethrows a device insert that fails for a reason other than a duplicate name, untranslated", async () => {
    await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    // A location id no `locations` row carries, so the insert breaks its foreign key.
    const refusal = await withTransaction(suite.db, (tx) =>
      insertDevice(tx, deviceValues(randomUUID(), profileId, "Caja 9")),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toHaveProperty("code", "device.name_taken");
    expect(String(refusal)).toMatch(/FOREIGN KEY constraint failed/);
  });

  it("rethrows a duplicate on a unique index other than the device name, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    await enrolDeviceForTest(suite.db, cfg, { name: "Caja 1", profileId });
    // One device per location makes a differently named device collide on a key that is not the
    // name key.
    await suite.db.execute(
      sql`create unique index devices_one_per_location on devices (location_id)`,
    );
    try {
      const refusal = await withTransaction(suite.db, (tx) =>
        insertDevice(tx, deviceValues(cfg.locationId, profileId, "Caja 2")),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toHaveProperty("code", "device.name_taken");
      expect(String(refusal)).toMatch(/UNIQUE constraint failed: devices\.location_id/);
    } finally {
      await suite.db.execute(sql`drop index devices_one_per_location`);
    }
  });

  it("rethrows a duplicate on a unique index that names no key, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    await enrolDeviceForTest(suite.db, cfg, { name: "Caja 1", profileId });
    // An index over an expression: its refusal names the index, not a table and columns.
    await suite.db.execute(
      sql`create unique index devices_one_per_location_expr on devices (lower(location_id))`,
    );
    try {
      const refusal = await withTransaction(suite.db, (tx) =>
        insertDevice(tx, deviceValues(cfg.locationId, profileId, "Caja 2")),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toHaveProperty("code", "device.name_taken");
      expect(String(refusal)).toMatch(
        /UNIQUE constraint failed: index 'devices_one_per_location_expr'/,
      );
    } finally {
      await suite.db.execute(sql`drop index devices_one_per_location_expr`);
    }
  });
});
