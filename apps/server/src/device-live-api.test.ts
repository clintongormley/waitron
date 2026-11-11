import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, devices } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant, seedVenue } from "@waitron/db/testing/seed.js";
import { hashDeviceToken } from "@waitron/identity";
import { LiveEvents } from "./live-api.js";
import { mountDeviceLiveApi } from "./device-live-api.js";
import { deviceCookieForTest } from "./testing/enrol.js";
import { createHandoverGate } from "./handover-gate.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const path = '/api/live/events?resources=[{"type":"printers"}]';
async function fixture() {
  await seedTenant(suite.db);
  await seedVenue(suite.db);
  const { deviceId } = await seedDevice(suite.db);
  const cookie = await deviceCookieForTest(suite.db, deviceId);
  const bus = new LiveEvents();
  const gate = createHandoverGate();
  const app = new Hono();
  app.use("*", gate.middleware);
  mountDeviceLiveApi(app, { db: suite.db, bus, resourceTypes: ["printers"] }, () => {});
  return { app, bus, gate, deviceId, cookie };
}

it("an enrolled device without a person hears types only and does not hold up stepdown", async () => {
  const { app, bus, gate, cookie } = await fixture();
  const response = await app.request(path, { headers: { cookie } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "event: ready\ndata: {}\n\n",
    );
    gate.close({ allowed: () => false });
    expect(await gate.settled(50)).toEqual({ remaining: [] });
    expect(bus.subscriberCount).toBe(1);
    bus.publish({ resources: [{ type: "printers", id: "secret" }] });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: change\ndata: [{"type":"printers"}]\n\n',
    );
  } finally {
    await reader.cancel();
  }
});

it("refuses missing device proof", async () => {
  const { app, bus } = await fixture();
  const response = await app.request(path);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  expect(bus.subscriberCount).toBe(0);
});

it("a device interest naming one id still hears another id of that type", async () => {
  const { app, bus, cookie } = await fixture();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const response = await app.request(
    '/api/live/events?resources=[{"type":"printers","id":"known"}]',
    {
      headers: { cookie },
    },
  );
  const reader = response.body!.getReader();
  try {
    await reader.read();
    bus.publish({ resources: [{ type: "printers", id: "another" }] });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: change\ndata: [{"type":"printers"}]\n\n',
    );
  } finally {
    await reader.cancel();
    vi.useRealTimers();
  }
});

it("refuses an unknown interest type", async () => {
  const { app, cookie } = await fixture();
  const response = await app.request('/api/live/events?resources=[{"type":"unknown"}]', {
    headers: { cookie },
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
});

it.each(["revoked", "token replaced"])(
  "invalidates a device at the next heartbeat when %s",
  async (change) => {
    const { app, bus, cookie, deviceId } = await fixture();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const response = await app.request(path, { headers: { cookie } });
    const reader = response.body!.getReader();
    try {
      await reader.read();
      await suite.db
        .update(devices)
        .set(
          change === "revoked" ? { active: false } : { tokenHash: hashDeviceToken("replacement") },
        )
        .where(eq(devices.id, deviceId));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(
        'event: session-invalid\ndata: {"code":"device.unauthorized"}\n\n',
      );
      expect((await reader.read()).done).toBe(true);
      expect(bus.subscriberCount).toBe(0);
    } finally {
      await reader.cancel();
      vi.useRealTimers();
    }
  },
);
