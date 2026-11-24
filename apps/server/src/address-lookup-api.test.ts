import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";

const venue = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const path = "/management-api/address-lookup";
const available = { kind: "available" };

it("checks venue permission, the primary and the exact body before calling Cloud", async () => {
  const { managerCookie, staffCookie } = await setupVenue(venue.db);
  const addressLookup = vi.fn(async () => ({ available: true }));
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
});
