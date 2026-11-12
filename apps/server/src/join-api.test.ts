import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { personRole, roleHasPermission } from "@waitron/identity";
import { floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mountJoinApi } from "./join-api.js";
import { createJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { VENUE_SERVICE } from "./modules.js";

describe("the role map join-api.ts depends on", () => {
  it("grants hardware administration to managers and admins only", () => {
    const expected = { staff: false, supervisor: false, manager: true, admin: true };
    for (const role of personRole.enumValues) {
      expect(roleHasPermission(role, "hardware.manage")).toBe(expected[role]);
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
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: "Watcher KDS",
    formFactor: "kds",
    capabilities: [],
  });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
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
      VENUE_SERVICE.readDeviceKitchenScreens(tx, made.joinId),
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
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: "Pass KDS",
    formFactor: "kds",
    capabilities: [],
  });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
      station: { stationIds: null, zoneIds: null },
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Kitchen" }),
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
    name: "Kitchen",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "station", stationIds: "all", zoneIds: null }],
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "kitchenScreens" } },
  });
  const notOffered = await send("accept", {
    name: "Kitchen",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: null }],
  });
  expect(notOffered.status).toBe(400);
  expect(await notOffered.json()).toMatchObject({
    error: { code: "kitchen_screen.not_allowed", params: { screen: "pass" } },
  });
  const accepted = await send("accept", {
    name: "Kitchen",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "station", stationIds: [venue.defaultStationId], zoneIds: null }],
  });
  expect(accepted.status).toBe(200);
  const shown = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.readDeviceKitchenScreens(tx, made.joinId),
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
    .values([{ name: "Terrace" }, { name: "Bar" }])
    .returning({ id: floorZones.id });
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: "Pass KDS",
    formFactor: "kds",
    capabilities: [],
  });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
      pass: { stationIds: null, zoneIds: [offered!.id] },
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Pass" }),
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
    name: "Pass",
    profileId: profile!.id,
    kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: [other!.id] }],
  });

  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: { code: "kitchen_screen.zone_not_allowed", params: { zoneId: other!.id } },
  });
});

describe("A773 pass display policy", () => {
  it("join approval cannot set a pass's display: a value in the body or inside a screen entry stores null", async () => {
    const venue = await setupVenue(suite.db);
    const app = new Hono();
    const pairingMode = createPairingMode();
    const { holdId } = pairingMode.open();
    mountJoinApi(
      app,
      { db: suite.db, cfg: venue.cfg, pairingMode, deviceAddress: "https://waitron.local" },
      () => {},
    );
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "Pass KDS",
      formFactor: "kds",
      capabilities: [],
    });
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
        pass: { stationIds: null, zoneIds: null, showNonPassStations: false },
      }),
    );
    const pass = { kind: "pass", stationIds: null, zoneIds: null };
    for (const [label, extra] of [
      ["Body value", { kitchenScreens: [pass], kitchenScreenDisplay: { pass: true } }],
      ["Entry value", { kitchenScreens: [{ ...pass, showNonPassStations: true }] }],
    ] as const) {
      const made = await withTransaction(suite.db, (tx) =>
        createJoinRequest(tx, venue.cfg, { kind: "device", label }),
      );
      const send = (verb: "check" | "accept", body: unknown) =>
        app.request(`/management-api/device-join-requests/${made.joinId}/${verb}`, {
          method: "POST",
          headers: { cookie: venue.managerCookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect(
        (
          await send("check", {
            choice: made.verificationNumber,
            holdId,
            createdAt: made.createdAt,
          })
        ).status,
      ).toBe(204);
      const accepted = await send("accept", { name: label, profileId: profile!.id, ...extra });
      expect(accepted.status).toBe(200);
      const { rows } = await suite.db.execute<{ screen: string; value: number | null }>(
        sql`select screen, show_non_pass_stations as value from device_kitchen_screens where device_id = ${made.joinId}`,
      );
      expect({ label, rows }).toEqual({ label, rows: [{ screen: "pass", value: null }] });
      expect(
        await withTransaction(suite.db, (tx) =>
          VENUE_SERVICE.readDeviceKitchenScreens(tx, made.joinId),
        ),
      ).toMatchObject([
        { kind: "pass", showNonPassStations: false, nonPassStationsOverride: null },
      ]);
    }
  });
});
