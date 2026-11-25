import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { endManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { venueFiscalSelection } from "@waitron/provisioning";
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
  const { managerCookie } = await setupVenue(venue.db);
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
  const post = (body: unknown, contentType = "application/json") =>
    app.request(path, {
      method: "POST",
      headers: { cookie: managerCookie, "content-type": contentType },
      body: JSON.stringify(body),
    });
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
