import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { devices, locations, nowIso, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { assertStillSignedIn } from "./till-session.js";
import { openTillSession, seedSessionDevice } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let locationId: string;
let deviceId: string;
let personId: string;
let sessionId: string;

beforeEach(async () => {
  const [loc] = await suite.db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es"], operationDescription: "Venta" })
    .returning({ id: locations.id });
  locationId = loc!.id;
  deviceId = await seedSessionDevice(suite.db, { locationId });
  personId = randomUUID();
  sessionId = await openTillSession(suite.db, { deviceId, personId });
});

function check(over: Partial<{ deviceId: string; sessionId: string; personId: string }> = {}) {
  return withTransaction(suite.db, (tx) =>
    assertStillSignedIn(tx, { deviceId, sessionId, personId, ...over }),
  );
}

describe("assertStillSignedIn", () => {
  it("passes an open session of that person on an active device", async () => {
    await expect(check()).resolves.toBeUndefined();
  });

  it("refuses device.unauthorized when the device was switched off with its session open", async () => {
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    await expect(check()).rejects.toMatchObject({ code: "device.unauthorized" });
  });

  it("refuses device.unauthorized when the device was deleted while still marked active", async () => {
    await suite.db.update(devices).set({ deletedAt: nowIso() }).where(eq(devices.id, deviceId));
    await expect(check()).rejects.toMatchObject({ code: "device.unauthorized" });
  });

  it("refuses session.required when the session has ended", async () => {
    await suite.db.update(sessions).set({ endedAt: nowIso() }).where(eq(sessions.id, sessionId));
    await expect(check()).rejects.toMatchObject({ code: "session.required" });
  });

  it("refuses session.required when the session is open on another device", async () => {
    const other = await seedSessionDevice(suite.db, { locationId });
    const elsewhere = await openTillSession(suite.db, { deviceId: other, personId });
    await expect(check({ sessionId: elsewhere })).rejects.toMatchObject({
      code: "session.required",
    });
  });

  it("refuses session.required when the session on this device is another person's", async () => {
    await expect(check({ personId: randomUUID() })).rejects.toMatchObject({
      code: "session.required",
    });
  });

  it("refuses session.required for an unknown session id", async () => {
    await expect(check({ sessionId: randomUUID() })).rejects.toMatchObject({
      code: "session.required",
    });
  });
});
