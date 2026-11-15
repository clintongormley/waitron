import { seedDeviceProfiles, seedZone } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLE_KEYS } from "@waitron/identity";
import { roleHasPermission } from "@waitron/identity/src/permissions.js";
import { withTransaction } from "@waitron/db";
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
    for (const role of BUILT_IN_ROLE_KEYS) {
      expect(roleHasPermission(role, "hardware.manage")).toBe(expected[role]);
    }
  });
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

it("approves a device with its profile's screen, zones and display policy", async () => {
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
    name: "Pass",
    formFactor: "kds",
    capabilities: [],
  });
  const zone = await seedZone(suite.db, { name: "Terrace" });
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
      pass: {
        stationIds: [venue.defaultStationId],
        zoneIds: [zone!.id],
        showNonPassStations: false,
      },
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
  const refused = await send("accept", { name: "Pass", profileId: randomUUID() });
  expect(await refused.json()).toMatchObject({ error: { code: "device_profile.not_found" } });
  const accepted = await send("accept", { name: "Pass", profileId: profile!.id });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ deviceId: made.joinId, name: "Pass", formFactor: "kds" });
  const [screen] = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.readDeviceKitchenScreens(tx, made.joinId),
  );
  expect(screen!.kind).toBe("pass");
  expect(screen!.stations.map((slot) => slot.id)).toEqual([venue.defaultStationId]);
  expect(screen!.zones?.map((slot) => slot.id)).toEqual([zone!.id]);
  expect(screen!.showNonPassStations).toBe(false);
});
