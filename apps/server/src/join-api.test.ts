import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { personRole, roleHasPermission } from "@waitron/identity";
import { deviceProfiles, devices, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mountJoinApi } from "./join-api.js";
import { createJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { createWatcher } from "./watchers.js";
import { setupVenue } from "./testing/venue-fixtures.js";

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

it("join approval binds a kitchen screen to its watcher and rejects a second target", async () => {
  const venue = await setupVenue(suite.db);
  const app = new Hono();
  mountJoinApi(app, { db: suite.db, cfg: venue.cfg, pairingMode: createPairingMode() }, () => {});
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Watcher KDS", formFactor: "kds", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const watcher = await withTransaction(suite.db, (tx) =>
    createWatcher(tx, venue.cfg, {
      name: "Pass",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: false,
    }),
  );
  const made = await withTransaction(suite.db, (tx) =>
    createJoinRequest(tx, venue.cfg, { kind: "device", label: "Pass screen" }),
  );
  const path = `/management-api/device-join-requests/${made.joinId}/accept`;
  const send = (body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const both = await send({
    choice: made.verificationNumber,
    profileId: profile!.id,
    stationId: venue.defaultStationId,
    watcherId: watcher.id,
  });
  expect(both.status).toBe(400);
  expect(await both.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "watcherId" } },
  });
  const accepted = await send({
    choice: made.verificationNumber,
    profileId: profile!.id,
    watcherId: watcher.id,
  });
  expect(accepted.status).toBe(200);
  const [device] = await suite.db
    .select({ stationId: devices.stationId, watcherId: devices.watcherId })
    .from(devices);
  expect(device).toEqual({ stationId: null, watcherId: watcher.id });
});
