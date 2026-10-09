import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  kitchenStations,
  ticketItems,
  locations,
  devices,
  deviceProfiles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createPinThrottle,
  hashPin,
  loginWithPin,
  persons,
  registerModulePermissions,
} from "@waitron/identity";
import { locationId } from "@waitron/shared";
import {
  setRoutingCell,
  setStationFallback,
  setStationToday,
  stationDayStates,
  VENUE_SERVICE_PERMISSIONS,
} from "@waitron/venue-service";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { createPairingMode } from "./pairing-mode.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { send } from "./testing/bill-venue.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let app: Hono;
let manager: string;
let staff: string;
let managerCookie: string;
let staffCookie: string;
let bar: string;
let grill: string;
let pastry: string;
let staffDevice: string;

beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const fixture = await inTx(v, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const [operator] = await tx
      .insert(persons)
      .values({ displayName: "Waiter", role: "staff", pinHash: hashPin("5555") })
      .returning({ id: persons.id });
    const [fallback] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.isDefault, true));
    await tx
      .update(kitchenStations)
      .set({ name: "Bar" })
      .where(eq(kitchenStations.id, fallback!.id));
    return {
      manager: admin!.id,
      staff: operator!.id,
      bar: fallback!.id,
      grill: (await createStation(tx, v.cfg, { name: "Grill" })).id,
      pastry: (await createStation(tx, v.cfg, { name: "Pastry" })).id,
    };
  });
  ({ manager, staff, bar, grill, pastry } = fixture);
  const managerDevice = await seedDevice(suite.db, {
    locationId: locationId(v.cfg.locationId),
    capabilities: [],
  });
  const waiterDevice = await seedDevice(suite.db, {
    locationId: locationId(v.cfg.locationId),
    capabilities: ["take-orders", "open-cash-drawer"],
  });
  staffDevice = waiterDevice.deviceId;
  const cookies = await withTransaction(suite.db, async (tx) => {
    const a = await loginWithPin(tx, {
      deviceId: managerDevice.deviceId,
      personId: manager,
      pin: "1234",
    });
    const b = await loginWithPin(tx, { deviceId: staffDevice, personId: staff, pin: "5555" });
    return [`${SESSION_COOKIE}=${a.token}`, `${SESSION_COOKIE}=${b.token}`];
  });
  [managerCookie, staffCookie] = cookies as [string, string];
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      pinThrottle: createPinThrottle({ now: () => 1000 }),
    },
    () => {},
  );
});
const today = () => `/api/stations/${grill}/today`;
const close = () => ({ state: "closed", sendsToStationId: bar });
const rows = () => suite.db.select().from(stationDayStates);
const call = (method: string, path: string, body?: unknown, cookie = managerCookie) =>
  send(app, cookie, method, path, body);

describe("the till's station day", () => {
  it("stores the chosen destination and reports why Grill is closed", async () => {
    expect((await call("PUT", today(), close())).status).toBe(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ stationId: grill, open: false, sendsToStationId: bar }),
    ]);
    const listed = await call("GET", "/api/stations");
    expect(listed.status).toBe(200);
    expect(listed.json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: grill,
          open: false,
          byHand: "closed",
          sendsTo: bar,
          why: "closed_by_hand",
        }),
        expect.objectContaining({
          id: bar,
          open: true,
          byHand: null,
          sendsTo: null,
          why: "default",
        }),
      ]),
    );
  });
  it("refuses an operator without permission without storing a close", async () => {
    const answer = await call("PUT", today(), close(), staffCookie);
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toEqual([]);
  });
  it("accepts a manager's PIN for the operator", async () => {
    const answer = await call(
      "PUT",
      today(),
      { ...close(), override: { personId: manager, pin: "1234" } },
      staffCookie,
    );
    expect(answer.status).toBe(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ stationId: grill, sendsToStationId: bar, open: false }),
    ]);
  });
  it("refuses a correct PIN belonging to someone without permission", async () => {
    const answer = await call(
      "PUT",
      today(),
      { ...close(), override: { personId: staff, pin: "5555" } },
      staffCookie,
    );
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toEqual([]);
  });
  it("counts wrong PINs in the shared device override throttle", async () => {
    for (let i = 0; i < 4; i++) {
      const answer = await call(
        "PUT",
        today(),
        { ...close(), override: { personId: manager, pin: "9999" } },
        staffCookie,
      );
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "pin.invalid" });
    }
    const blocked = await call(
      "PUT",
      today(),
      { ...close(), override: { personId: manager, pin: "1234" } },
      staffCookie,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ code: "pin.throttled" });
    const shared = await call(
      "POST",
      "/api/drawer/open",
      { override: { personId: manager, pin: "1234" } },
      staffCookie,
    );
    expect(shared.status).toBe(429);
    expect(shared.json).toMatchObject({ code: "pin.throttled" });
    expect(await rows()).toEqual([]);
  });
  it("refuses closing the default station", async () => {
    const answer = await call("PUT", `/api/stations/${bar}/today`, {
      state: "closed",
      sendsToStationId: grill,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "station.always_open" });
    expect(await rows()).toEqual([]);
  });
  it("refuses a destination closed since the choices were read", async () => {
    await inTx(v, (tx) => setStationToday(tx, v.cfg, pastry, "closed", new Date(), bar));
    const before = await rows();
    const answer = await call("PUT", today(), { state: "closed", sendsToStationId: pastry });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "station.destination_invalid" });
    expect(await rows()).toEqual(before);
  });
  it("opens a closed station and clears its manual destination", async () => {
    await inTx(v, (tx) => setStationToday(tx, v.cfg, grill, "closed", new Date(), bar));
    expect((await call("PUT", today(), { state: "open" })).status).toBe(204);
    expect(await rows()).toEqual([]);
    const listed = await call("GET", "/api/stations");
    expect(listed.json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: grill,
          open: true,
          byHand: null,
          sendsTo: null,
          why: "open",
        }),
      ]),
    );
  });
  it("lets staff read open destinations and the managers who can authorize", async () => {
    const choices = await call("GET", today(), undefined, staffCookie);
    expect(choices.status).toBe(200);
    expect(choices.json).toEqual({
      destinations: [
        { id: bar, name: "Bar", isDefault: true },
        { id: pastry, name: "Pastry", isDefault: false },
      ],
    });
    const authorizers = await call("GET", "/api/service-day/authorizers", undefined, staffCookie);
    expect(authorizers.status).toBe(200);
    expect(authorizers.json).toEqual([{ personId: manager, displayName: "Administradora" }]);
  });
  it.each([
    ["GET", "/api/service-day/authorizers"],
    ["GET", "/api/stations/id/today"],
    ["PUT", "/api/stations/id/today"],
  ])("requires a session for %s %s", async (method, path) => {
    const answer = await call(method!, path!, method === "PUT" ? close() : undefined, "");
    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });
  it("refuses a revoked session device", async () => {
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, staffDevice));
    const answer = await call("PUT", today(), close(), staffCookie);
    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "device.unauthorized" });
    expect(await rows()).toEqual([]);
  });
  it.each([
    null,
    [],
    {},
    { state: null },
    { state: ["open"] },
    { state: "default" },
    { state: "closed" },
    { state: "closed", sendsToStationId: null },
    { state: "closed", sendsToStationId: "bad" },
    { state: "open", override: [] },
  ])("refuses malformed request %j without storing it", async (body) => {
    const answer = await call("PUT", today(), body);
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid" });
    expect(await rows()).toEqual([]);
  });
  it.each(["GET", "PUT"])("refuses a malformed station id for %s", async (method) => {
    const answer = await call(
      method,
      "/api/stations/bad/today",
      method === "PUT" ? close() : undefined,
    );
    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({ code: "station.not_found" });
  });
  it("refuses an inactive source and an unreadable location clock without changing rows", async () => {
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, grill));
    const inactive = await call("PUT", today(), close());
    expect(inactive.status).toBe(409);
    expect(inactive.json).toMatchObject({ code: "route.station_inactive" });
    await suite.db
      .update(kitchenStations)
      .set({ active: true })
      .where(eq(kitchenStations.id, grill));
    await suite.db
      .update(locations)
      .set({ timeZone: "Invalid/Clock" })
      .where(eq(locations.id, v.cfg.locationId));
    const clock = await call("PUT", today(), close());
    expect(clock.status).toBe(409);
    expect(clock.json).toMatchObject({ code: "time_zone.unreadable" });
    expect(await rows()).toEqual([]);
  });
  it("routes a dish sent from the till to the chosen station", async () => {
    await inTx(v, (tx) => setStationFallback(tx, v.cfg, grill, pastry));
    await inTx(v, (tx) =>
      setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Burger") }, zoneId: null },
        { kind: "station", stationId: grill },
      ),
    );
    expect((await call("PUT", today(), close())).status).toBe(204);
    const table = await v.table("Station routing");
    const seated = await call("POST", `/api/tables/${table}/seat`, {}, staffCookie);
    expect(seated.status).toBe(200);
    const placed = await call(
      "POST",
      `/api/parties/${String(seated.json.partyId)}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: seated.json.revision,
        groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      },
      staffCookie,
    );
    expect(placed.status).toBe(200);
    expect(
      await suite.db
        .select({ stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, String(placed.json.tabId))),
    ).toEqual([{ stationId: bar }]);
  });
});

describe("the kitchen display's station day", () => {
  let deviceCookie: string;
  let profileId: string;
  let deviceId: string;
  const path = () => `/api/device/stations/${grill}/today`;
  const authorizedClose = () => ({ ...close(), authorizer: { personId: manager, pin: "1234" } });
  const deviceCall = (method: string, route: string, body?: unknown, cookie = deviceCookie) =>
    call(method, route, body, cookie);

  beforeEach(async () => {
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: "Kitchen controls",
        formFactor: "kds",
        capabilities: ["prepare-orders"],
      })
      .returning({ id: deviceProfiles.id });
    profileId = profile!.id;
    const enrolled = await enrolDeviceForTest(suite.db, v.cfg, {
      name: "Grill display",
      profileId,
      stationId: grill,
    });
    deviceId = enrolled.deviceId;
    deviceCookie = `${DEVICE_COOKIE}=${deviceId}.${enrolled.token}`;
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: v.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
      },
      () => {},
    );
  });

  it("closes its station with a manager PIN and reports the destination and reason", async () => {
    expect((await deviceCall("PUT", path(), authorizedClose())).status).toBe(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ stationId: grill, open: false, sendsToStationId: bar }),
    ]);
    const answer = await deviceCall("GET", "/api/device/station-screen");
    expect(answer.status).toBe(200);
    expect((answer.json.stations as unknown[])[0]).toMatchObject({
      id: grill,
      name: "Grill",
      today: {
        open: false,
        isDefault: false,
        byHand: "closed",
        sendsTo: { id: bar, name: "Bar" },
        why: "closed_by_hand",
      },
    });
  });
  it("reopens its station with a manager PIN and clears the destination", async () => {
    await inTx(v, (tx) => setStationToday(tx, v.cfg, grill, "closed", new Date(), bar));
    expect(
      (
        await deviceCall("PUT", path(), {
          state: "open",
          authorizer: { personId: manager, pin: "1234" },
        })
      ).status,
    ).toBe(204);
    expect(await rows()).toEqual([]);
    const answer = await deviceCall("GET", "/api/device/station-screen");
    expect((answer.json.stations as unknown[])[0]).toMatchObject({
      name: "Grill",
      today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" },
    });
  });
  it("shows an assigned station switched off since enrollment", async () => {
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, grill));
    const answer = await deviceCall("GET", "/api/device/station-screen");
    expect(answer.status).toBe(200);
    expect((answer.json.stations as unknown[])[0]).toMatchObject({
      id: grill,
      name: "Grill",
      today: {
        open: false,
        isDefault: false,
        byHand: null,
        sendsTo: null,
        why: "switched_off",
      },
    });
  });
  it("reads only open destinations and managers without needing a staff session", async () => {
    const answer = await deviceCall("GET", path());
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      destinations: [
        { id: bar, name: "Bar", isDefault: true },
        { id: pastry, name: "Pastry", isDefault: false },
      ],
      authorizers: [{ personId: manager, displayName: "Administradora" }],
    });
  });
  it.each([undefined, null])(
    "requires an authorizer (%j) even with a manager session",
    async (authorizer) => {
      const answer = await deviceCall(
        "PUT",
        path(),
        { ...close(), authorizer },
        `${deviceCookie}; ${managerCookie}`,
      );
      expect(answer.status).toBe(403);
      expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
      expect(await rows()).toEqual([]);
    },
  );
  it("refuses a correct staff PIN without writing a close", async () => {
    const answer = await deviceCall("PUT", path(), {
      ...close(),
      authorizer: { personId: staff, pin: "5555" },
    });
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toEqual([]);
  });
  it.each(["GET", "PUT"])("refuses another station for %s", async (method) => {
    const answer = await deviceCall(
      method,
      `/api/device/stations/${bar}/today`,
      method === "PUT" ? authorizedClose() : undefined,
    );
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({
      code: "device.forbidden_station",
      params: { stationId: bar },
    });
    expect(await rows()).toEqual([]);
  });
  it.each(["GET", "PUT"])("requires prepare-orders for %s", async (method) => {
    await suite.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, profileId));
    const answer = await deviceCall(
      method,
      path(),
      method === "PUT" ? authorizedClose() : undefined,
    );
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({
      code: "device.forbidden_action",
      params: { action: "prepare-orders" },
    });
    expect(await rows()).toEqual([]);
  });
  it.each(["GET", "PUT"])("requires a live device cookie for %s", async (method) => {
    const body = method === "PUT" ? authorizedClose() : undefined;
    const absent = await deviceCall(method, path(), body, "");
    expect(absent.status).toBe(401);
    expect(absent.json).toMatchObject({ code: "device.unauthorized" });
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    const revoked = await deviceCall(method, path(), body);
    expect(revoked.status).toBe(401);
    expect(revoked.json).toMatchObject({ code: "device.unauthorized" });
    expect(await rows()).toEqual([]);
  });
  it("shares the device's override PIN limit with a signed-in till", async () => {
    for (let i = 0; i < 4; i++) {
      const answer = await deviceCall("PUT", path(), {
        ...close(),
        authorizer: { personId: manager, pin: "9999" },
      });
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "pin.invalid" });
    }
    const blocked = await deviceCall("PUT", path(), authorizedClose());
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ code: "pin.throttled" });
    const login = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, {
        deviceId,
        personId: staff,
        pin: "5555",
      }),
    );
    const till = await call(
      "PUT",
      today(),
      {
        ...close(),
        override: { personId: manager, pin: "1234" },
      },
      `${SESSION_COOKIE}=${login.token}`,
    );
    expect(till.status).toBe(429);
    expect(till.json).toMatchObject({ code: "pin.throttled" });
    expect(await rows()).toEqual([]);
  });
  it("refuses an incomplete PIN credential as pin.invalid", async () => {
    const answer = await deviceCall("PUT", path(), {
      state: "open",
      authorizer: { personId: manager },
    });
    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "pin.invalid" });
    expect(await rows()).toEqual([]);
  });
  it.each([
    { state: "invalid" },
    { state: "closed", sendsToStationId: null },
    { state: "open", authorizer: [] },
  ])("rejects malformed input %j", async (body) => {
    const answer = await deviceCall("PUT", path(), body);
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid" });
    expect(await rows()).toEqual([]);
  });
});
