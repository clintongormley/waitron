import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { personRole, roleHasPermission } from "@waitron/identity";
import { deviceProfiles, floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mountJoinApi } from "./join-api.js";
import { createJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { VENUE_SERVICE } from "./modules.js";

/**
 * The role-map fact `join-api.ts` is built on, pinned where it is consumed. Two things there break
 * silently the day `device.manage` and `printer.manage` stop being held by the same roles:
 *
 *  1. The pairing-mode routes gate on `device.manage` ALONE, so a `printer.manage`-only holder could
 *     not open the window to enrol a print agent.
 *  2. `MISSING_ROW_PERMISSION` becomes an existence oracle: a `device.manage`-only holder would get
 *     404 for an unknown id and 403 for a live `print_agent` row.
 *
 * No route test can catch either while the map holds, so the map itself is asserted.
 */
describe("the role map join-api.ts depends on", () => {
  it("grants device.manage and printer.manage to exactly the same roles", () => {
    for (const role of personRole.enumValues) {
      expect({ role, printer: roleHasPermission(role, "printer.manage") }).toEqual({
        role,
        printer: roleHasPermission(role, "device.manage"),
      });
    }
  });
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

it("join approval gives a kitchen display its pass screen and rejects a second screen", async () => {
  const venue = await setupVenue(suite.db);
  const app = new Hono();
  // Opened before the request is made, so the gate keeps it.
  const pairingMode = createPairingMode();
  const { holdId } = pairingMode.open();
  mountJoinApi(
    app,
    { db: suite.db, cfg: venue.cfg, pairingMode, deviceAddress: "https://waitron.local" },
    () => {},
  );
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Watcher KDS", formFactor: "kds", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, venue.cfg, profile!.id, {
      station: { stationIds: null, zoneIds: null },
      pass: { stationIds: null, zoneIds: null },
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Pass screen" }),
  );
  const send = (verb: "check" | "accept", body: unknown) =>
    app.request(`/management-api/device-join-requests/${made.joinId}/${verb}`, {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await send("check", { choice: made.verificationNumber, holdId, createdAt: made.createdAt }))
      .status,
  ).toBe(204);
  const pass = { kind: "pass", stationIds: null, zoneIds: null };
  const both = await send("accept", {
    name: "Pass screen",
    profileId: profile!.id,
    kitchenScreens: [
      { kind: "station", stationIds: [venue.defaultStationId], zoneIds: null },
      pass,
    ],
  });
  expect(both.status).toBe(400);
  expect(await both.json()).toMatchObject({
    error: { code: "kitchen_screen.invalid", params: { field: "screens", reason: "one_only" } },
  });
  const accepted = await send("accept", {
    name: "Pass screen",
    profileId: profile!.id,
    kitchenScreens: [pass],
  });
  expect(accepted.status).toBe(200);
  expect(
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, made.joinId),
    ),
  ).toMatchObject([{ kind: "pass", available: true, zones: null }]);
});

it("join approval gives a device the kitchen screens the accept names, refusing a malformed list", async () => {
  const venue = await setupVenue(suite.db);
  const app = new Hono();
  const pairingMode = createPairingMode();
  const { holdId } = pairingMode.open();
  mountJoinApi(
    app,
    { db: suite.db, cfg: venue.cfg, pairingMode, deviceAddress: "https://waitron.local" },
    () => {},
  );
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Pass KDS", formFactor: "kds", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, venue.cfg, profile!.id, {
      station: { stationIds: null, zoneIds: null },
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Cocina" }),
  );
  const send = (verb: "check" | "accept", body: unknown) =>
    app.request(`/management-api/device-join-requests/${made.joinId}/${verb}`, {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await send("check", { choice: made.verificationNumber, holdId, createdAt: made.createdAt }))
      .status,
  ).toBe(204);
  const malformed = await send("accept", {
    name: "Cocina",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "station", stationIds: "all", zoneIds: null }],
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "kitchenScreens" } },
  });
  const notOffered = await send("accept", {
    name: "Cocina",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: null }],
  });
  expect(notOffered.status).toBe(400);
  expect(await notOffered.json()).toMatchObject({
    error: { code: "kitchen_screen.not_allowed", params: { screen: "pass" } },
  });
  const accepted = await send("accept", {
    name: "Cocina",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "station", stationIds: [venue.defaultStationId], zoneIds: null }],
  });
  expect(accepted.status).toBe(200);
  const shown = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, made.joinId),
  );
  expect(shown).toMatchObject([
    { kind: "station", stations: [{ id: venue.defaultStationId, available: true }] },
  ]);
});

it("join approval refuses a zone the profile's pass screen does not offer with kitchen_screen.zone_not_allowed 400", async () => {
  const venue = await setupVenue(suite.db);
  const app = new Hono();
  const pairingMode = createPairingMode();
  const { holdId } = pairingMode.open();
  mountJoinApi(
    app,
    { db: suite.db, cfg: venue.cfg, pairingMode, deviceAddress: "https://waitron.local" },
    () => {},
  );
  const [offered, other] = await suite.db
    .insert(floorZones)
    .values([
      { locationId: venue.cfg.locationId, name: "Terraza" },
      { locationId: venue.cfg.locationId, name: "Barra" },
    ])
    .returning({ id: floorZones.id });
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Pass KDS", formFactor: "kds", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, venue.cfg, profile!.id, {
      pass: { stationIds: null, zoneIds: [offered!.id] },
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Pase" }),
  );
  const send = (verb: "check" | "accept", body: unknown) =>
    app.request(`/management-api/device-join-requests/${made.joinId}/${verb}`, {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await send("check", { choice: made.verificationNumber, holdId, createdAt: made.createdAt }))
      .status,
  ).toBe(204);

  const refused = await send("accept", {
    name: "Pase",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: [other!.id] }],
  });

  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: { code: "kitchen_screen.zone_not_allowed", params: { zoneId: other!.id } },
  });
});
