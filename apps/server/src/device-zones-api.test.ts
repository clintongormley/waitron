import { locationId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  floorZones,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin, persons, sessions, setProfileAdmission } from "@waitron/identity";
import { payments } from "@waitron/payments";
import type { DeviceZoneSelectionInput } from "@waitron/module";
import { VENUE_SERVICE } from "@waitron/venue-service";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import * as tillSession from "./till-session.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const venue = await setupVenue(suite.db);
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Display preferences only", formFactor: "till", capabilities: [] })
    .returning();
  const device = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Zone till",
    profileId: profile!.id,
  });
  const other = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Other till",
    profileId: profile!.id,
  });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Viewer", role: "staff", pinHash: hashPin("4321") })
    .returning();
  const session = await run((tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: person!.id, pin: "4321" }),
  );
  const app = new Hono();
  mountDeviceApi(
    app,
    { db: suite.db, cfg: venue.cfg, secureCookies: false, pairingMode: createPairingMode() },
    () => {},
  );
  const request = async (
    method: "GET" | "PUT",
    body?: unknown,
    cookie: string | null = `${tillSession.SESSION_COOKIE}=${session.token}`,
  ) => {
    const response = await app.request("http://localhost/api/device/zones", {
      method,
      headers: {
        ...(cookie === null ? {} : { cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      json: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : await response.text(),
    };
  };
  const current = await run((tx) =>
    VENUE_SERVICE.readDeviceZoneSelection(tx, venue.cfg, device.deviceId),
  );
  expect(current.startingZoneId).not.toBeNull();
  const input: DeviceZoneSelectionInput = {
    profileId: current.profileId,
    snapshot: current.snapshot,
    selectedZoneIds: current.selectedZoneIds,
    startingZoneId: current.startingZoneId!,
  };
  return {
    venue,
    profileId: profile!.id,
    deviceId: device.deviceId,
    otherDeviceId: other.deviceId,
    personId: person!.id,
    session,
    app,
    request,
    current,
    input,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const count = (f: Fixture, deviceId = f.deviceId) =>
  run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, deviceId));

describe("the device's zone preferences", () => {
  it.each(["GET", "PUT"] as const)("requires an open session for %s", async (method) => {
    const f = await fixture();
    expect(await f.request(method, method === "PUT" ? f.input : undefined, null)).toEqual({
      status: 401,
      json: { error: { code: "session.required", params: {} } },
    });
    expect(await count(f)).toBe(0);
  });

  it("serves admitted staff without a selling action and keeps automatic reads passive", async () => {
    const f = await fixture();
    const lastSeenAt = "2026-01-01T00:00:00.000Z";
    await suite.db.update(devices).set({ lastSeenAt }).where(eq(devices.id, f.deviceId));
    expect(await f.request("GET")).toEqual({ status: 200, json: f.current });
    expect(
      (await suite.db.select().from(devices).where(eq(devices.id, f.deviceId)))[0]!.lastSeenAt,
    ).toBe(lastSeenAt);
    const saved = await f.request("PUT", { ...f.input, deviceId: f.otherDeviceId });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      selectedZoneIds: f.input.selectedZoneIds,
      startingZoneId: f.input.startingZoneId,
      adjusted: false,
    });
    expect(await count(f)).toBe(1);
    expect(await count(f, f.otherDeviceId)).toBe(0);
  });

  it.each(["GET", "PUT"] as const)("refuses a changed profile admission for %s", async (method) => {
    const f = await fixture();
    await run((tx) =>
      setProfileAdmission(tx, f.profileId, {
        personExceptions: [{ personId: f.personId, admitted: false }],
      }),
    );
    expect(await f.request(method, method === "PUT" ? f.input : undefined)).toEqual({
      status: 403,
      json: { error: { code: "device_profile.not_admitted", params: {} } },
    });
    expect(await count(f)).toBe(0);
  });

  it("refuses a foreign zone or profile and a stale selection without writing", async () => {
    const f = await fixture();
    for (const [input, code, status] of [
      [{ ...f.input, selectedZoneIds: [randomUUID()] }, "device_zones.invalid", 400],
      [{ ...f.input, profileId: randomUUID() }, "device_zones.changed", 409],
      [{ ...f.input, snapshot: "a".repeat(64) }, "device_zones.changed", 409],
      [{ ...f.input, selectedZoneIds: [] }, "device_zones.invalid", 400],
      [{ ...f.input, startingZoneId: randomUUID() }, "device_zones.invalid", 400],
    ] as const) {
      const response = await f.request("PUT", input);
      expect(response.status).toBe(status);
      expect(response.json).toMatchObject({ error: { code } });
      expect(await count(f)).toBe(0);
    }
    expect((await f.request("PUT", f.input)).status).toBe(200);
    expect((await f.request("PUT", f.input)).status).toBe(409);
    expect(await count(f)).toBe(1);
  });

  it.each([null, [], 42, { selectedZoneIds: null }, { selectedZoneIds: "all" }])(
    "rejects malformed settings %j",
    async (body) => {
      const f = await fixture();
      expect(await f.request("PUT", body)).toMatchObject({
        status: 400,
        json: { error: { code: "device_zones.invalid" } },
      });
      expect(await count(f)).toBe(0);
    },
  );

  it.each([
    ["PUT", "payment"],
    ["PUT", "session"],
    ["PUT", "device"],
    ["PUT", "profile"],
    ["PUT", "profile-admission"],
    ["PUT", "admission"],
    ["PUT", "selection"],
    ["PUT", "scope"],
    ["GET", "session"],
    ["GET", "device"],
    ["GET", "admission"],
  ] as const)(
    "rechecks %s %s after authentication and before the settings transaction",
    async (method, change) => {
      const f = await fixture();
      const checked = gate();
      const proceed = gate();
      const original = tillSession.requireSession;
      const spy = vi.spyOn(tillSession, "requireSession").mockImplementation(async (...args) => {
        const session = await original(...args);
        checked.resolve();
        await proceed.promise;
        return session;
      });
      const pending = f.request(method, method === "PUT" ? f.input : undefined);
      try {
        await checked.promise;
        if (change === "session")
          await suite.db
            .update(sessions)
            .set({ endedAt: new Date().toISOString() })
            .where(eq(sessions.id, f.session.id));
        if (change === "device")
          await suite.db.update(devices).set({ active: false }).where(eq(devices.id, f.deviceId));
        if (change === "profile" || change === "profile-admission") {
          const [profile] = await suite.db
            .insert(deviceProfiles)
            .values({ name: "Replacement", formFactor: "till" })
            .returning();
          await suite.db
            .update(devices)
            .set({ deviceProfileId: profile!.id })
            .where(eq(devices.id, f.deviceId));
          if (change === "profile-admission")
            await run((tx) =>
              setProfileAdmission(tx, profile!.id, {
                personExceptions: [{ personId: f.personId, admitted: false }],
              }),
            );
        }
        if (change === "admission")
          await run((tx) =>
            setProfileAdmission(tx, f.profileId, {
              personExceptions: [{ personId: f.personId, admitted: false }],
            }),
          );
        if (change === "selection")
          await run((tx) =>
            VENUE_SERVICE.setDeviceZoneSelection(tx, f.venue.cfg, f.deviceId, f.input),
          );
        if (change === "scope")
          await suite.db
            .update(floorZones)
            .set({ active: false })
            .where(eq(floorZones.id, f.current.startingZoneId!));
        if (change === "payment") {
          const offers = await run((tx) => offerProducts(tx, f.venue.cfg));
          const orderId = randomUUID();
          await parkOrder({ db: suite.db }, f.venue.cfg, {
            id: orderId,
            zoneId: offers.zoneId,
            lines: offers.toOfferLines([{ productId: f.venue.cafeId, quantity: "1" }]),
          });
          await suite.db.insert(payments).values({
            workingOrderId: orderId,
            source: "device",
            deviceId: f.deviceId,
            provider: "stripe",
            paymentRef: randomUUID(),
            amount: 150,
            state: "attempting",
          });
        }
        const paymentsBefore = await suite.db.select().from(payments);
        const ordersBefore = await suite.db.select().from(workingOrders);
        proceed.resolve();
        const response = await pending;
        expect(response.status).toBe(
          change === "session" || change === "device"
            ? 401
            : change === "admission" || change === "profile-admission"
              ? 403
              : 409,
        );
        expect(response.json).toMatchObject({
          error: {
            code:
              change === "session"
                ? "session.required"
                : change === "device"
                  ? "device.unauthorized"
                  : change === "payment"
                    ? "device.payment_in_progress"
                    : change === "admission" || change === "profile-admission"
                      ? "device_profile.not_admitted"
                      : "device_zones.changed",
          },
        });
        expect(await count(f)).toBe(change === "selection" ? 1 : 0);
        expect(await suite.db.select().from(payments)).toEqual(paymentsBefore);
        expect(await suite.db.select().from(workingOrders)).toEqual(ordersBefore);
      } finally {
        proceed.resolve();
        await pending;
        spy.mockRestore();
      }
    },
  );

  it("refuses a settings write while the device's payment is in progress", async () => {
    const f = await fixture();
    const offers = await run((tx) => offerProducts(tx, f.venue.cfg));
    const orderId = randomUUID();
    await parkOrder({ db: suite.db }, f.venue.cfg, {
      id: orderId,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([{ productId: f.venue.cafeId, quantity: "1" }]),
    });
    await suite.db.insert(payments).values({
      workingOrderId: orderId,
      source: "device",
      deviceId: f.deviceId,
      provider: "stripe",
      paymentRef: randomUUID(),
      amount: 150,
      state: "attempting",
    });
    const before = await suite.db.select().from(payments);
    expect(await f.request("PUT", f.input)).toEqual({
      status: 409,
      json: { error: { code: "device.payment_in_progress", params: {} } },
    });
    expect(await count(f)).toBe(0);
    expect(await suite.db.select().from(payments)).toEqual(before);
    expect((await f.request("GET")).status).toBe(200);
  });
});

it("refuses a session belonging to another venue location on both preference routes", async () => {
  const f = await fixture();
  const foreign = new Hono();
  mountDeviceApi(
    foreign,
    {
      db: suite.db,
      cfg: { ...f.venue.cfg, locationId: locationId(randomUUID()) },
      secureCookies: false,
      pairingMode: createPairingMode(),
    },
    () => {},
  );
  for (const method of ["GET", "PUT"]) {
    const response = await foreign.request("http://localhost/api/device/zones", {
      method,
      headers: {
        cookie: `${tillSession.SESSION_COOKIE}=${f.session.token}`,
        "content-type": "application/json",
      },
      ...(method === "PUT" ? { body: JSON.stringify(f.input) } : {}),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "device.unauthorized", params: {} } });
  }
  expect(await count(f)).toBe(0);
});
