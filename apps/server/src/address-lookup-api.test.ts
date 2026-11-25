import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { endManagementSession, endSession, loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { venueFiscalSelection } from "@waitron/provisioning";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { setupPartyVenue } from "./testing/party-venue.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { mountTillApi } from "./till-api.js";
import { ALL_MODULES } from "./modules.js";
import type { CloudConnection } from "./cloud-client.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";

const venue = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const path = "/management-api/address-lookup";
const available = { kind: "available" };

it("checks venue permission, the primary and the exact body before calling Cloud", async () => {
  const { managerCookie, staffCookie } = await setupVenue(venue.db);
  const addressLookup = vi.fn<CloudConnection["addressLookup"]>(async () => ({ available: true }));
  const app = new Hono();
  let primary = true;
  mountVenueSettingsApi(
    app,
    {
      db: venue.db,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
      addressLookup: { connection: { addressLookup }, isPrimary: () => primary },
    },
    () => {},
  );
  const post = (body: object, cookie = managerCookie) =>
    app.request(path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const refused = await post(available, staffCookie);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  primary = false;
  expect((await post(available)).status).toBe(409);
  primary = true;
  expect((await post({ ...available, query: "Do not send" })).status).toBe(400);
  expect(addressLookup).not.toHaveBeenCalled();
  const response = await post(available);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ available: true });
  expect(addressLookup).toHaveBeenCalledExactlyOnceWith(
    available,
    expect.any(Function),
    expect.any(AbortSignal),
  );

  addressLookup.mockImplementationOnce(async (_input, authorize) => {
    primary = false;
    await authorize();
    return { available: true };
  });
  const steppedDown = await post(available);
  expect(steppedDown.status).toBe(409);
  expect(await steppedDown.json()).toEqual({ error: { code: "cloud.not_primary", params: {} } });

  primary = true;
  addressLookup.mockImplementationOnce(async (_input, authorize) => {
    const token = managerCookie.split("=")[1]!;
    await withTransaction(venue.db, (tx) => endManagementSession(tx, token, "signed_out"));
    await authorize();
    return { available: true };
  });
  const signedOut = await post(available);
  expect(signedOut.status).toBe(401);
  expect(await signedOut.json()).toEqual({
    error: { code: "management_session.required", params: {} },
  });
});

it("offers manual entry without a Cloud connection and still validates requests", async () => {
  const { managerCookie, staffCookie } = await setupVenue(venue.db);
  const app = new Hono();
  mountVenueSettingsApi(
    app,
    {
      db: venue.db,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
      addressLookup: { isPrimary: () => true },
    },
    () => {},
  );
  const post = (body: unknown, contentType = "application/json", cookie = managerCookie) =>
    app.request(path, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body: JSON.stringify(body),
    });
  const refused = await post(available, "application/json", staffCookie);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  const status = await post(available);
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({ available: false });
  const search = {
    kind: "suggest",
    workflowId: randomUUID(),
    query: "Main Street",
    language: "en",
  };
  const unavailable = await post(search);
  expect(unavailable.status).toBe(409);
  expect(await unavailable.json()).toEqual({ error: { code: "cloud.not_configured", params: {} } });
  for (const invalid of [await post(null), await post(available, "text/plain")]) {
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: "cloud.request_invalid", params: {} } });
  }
});

it("lets a signed-in till ask Cloud and refuses the reply after sign-out", async () => {
  const { backend, clock, cfg } = await setupPartyVenue(venue.db);
  const [person] = await seedPersons(venue.db, {
    displayName: "Cashier",
    role: "staff",
    pinHash: fixturePinHash("1234"),
  });
  const { token } = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: cfg.origin.deviceId, personId: person!.id, pin: "1234" }),
  );
  const cookie = await sessionCookieForTest(venue.db, token);
  const addressLookup = vi.fn<CloudConnection["addressLookup"]>(async () => ({ available: true }));
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: venue.db,
      backend,
      clock,
      cfg,
      admission: testTradingAdmission(),
      secureCookies: false,
      venueLocale: cfg.locale,
      addressLookup: { connection: { addressLookup }, isPrimary: () => true },
    },
    () => {},
  );
  const post = () =>
    app.request("/api/address-lookup", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(available),
    });

  const caller = new AbortController();
  const search = {
    kind: "suggest",
    workflowId: randomUUID(),
    query: "Main Street",
    language: "en",
  };
  let stopReceived: boolean | undefined;
  addressLookup.mockImplementationOnce(async (_input, _authorize, signal) => {
    caller.abort();
    stopReceived = signal?.aborted;
    return { candidates: [{ text: "Main Street 2" }] };
  });
  const response = await app.request("/api/address-lookup", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(search),
    signal: caller.signal,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ candidates: [{ text: "Main Street 2" }] });
  expect(addressLookup.mock.calls[0]?.[0]).toEqual(search);
  expect(stopReceived).toBe(true);
  addressLookup.mockImplementationOnce(async (_input, authorize) => {
    await withTransaction(venue.db, (tx) => endSession(tx, token));
    await authorize();
    return { available: true };
  });
  const signedOut = await post();
  expect(signedOut.status).toBe(401);
  expect(await signedOut.json()).toEqual({ error: { code: "session.required", params: {} } });
});
