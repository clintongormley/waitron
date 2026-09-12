import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";

// PostgreSQL exercises the route as app_user and two tenants, including its configuration grant.
const suite = useTemplateDb({ template: "manifest" });
let venue: Venue;
let other: Venue;
beforeAll(async () => {
  venue = await setupVenue(suite.admin);
  other = await setupVenue(suite.admin);
});
function app(locationId?: string) {
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.admin,
      cfg: { ...venue.cfg, locationId: locationId ?? venue.cfg.locationId },
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  return app;
}
const request = (cookie: string, operationDescription: unknown) => ({
  method: "PUT",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ operationDescription }),
});
describe("location invoice settings", () => {
  it("requires a session and configuration permission for reads and writes", async () => {
    for (const method of ["GET", "PUT"]) {
      const headers = { "content-type": "application/json" };
      expect(
        (
          await app().request("/management-api/location-settings", {
            method,
            headers,
            ...(method === "PUT"
              ? { body: JSON.stringify({ operationDescription: "Venta" }) }
              : {}),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app().request("/management-api/location-settings", {
            method,
            headers: { ...headers, cookie: venue.staffCookie },
            ...(method === "PUT"
              ? { body: JSON.stringify({ operationDescription: "Venta" }) }
              : {}),
          })
        ).status,
      ).toBe(403);
    }
  });
  it("reads and updates the deployed location under app_user", async () => {
    const response = await app().request("/management-api/location-settings", {
      headers: { cookie: venue.managerCookie },
    });
    expect(await response.json()).toEqual({
      name: "Sala principal",
      operationDescription: "Venta en establecimiento",
    });
    try {
      expect(
        (
          await app().request(
            "/management-api/location-settings",
            request(venue.managerCookie, "Venta de comidas"),
          )
        ).status,
      ).toBe(204);
      const read = await app().request("/management-api/location-settings", {
        headers: { cookie: venue.managerCookie },
      });
      expect(await read.json()).toEqual({
        name: "Sala principal",
        operationDescription: "Venta de comidas",
      });
    } finally {
      await suite.admin.execute(
        sql`update locations set operation_description = 'Venta en establecimiento' where id = ${venue.cfg.locationId}`,
      );
    }
  });
  it.each(["", "   ", null, 12, "Venta\u0001aqui", "a".repeat(501)])(
    "refuses invalid descriptions without writing: %j",
    async (description) => {
      const response = await app().request(
        "/management-api/location-settings",
        request(venue.managerCookie, description),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "operationDescription" } },
      });
      const read = await app().request("/management-api/location-settings", {
        headers: { cookie: venue.managerCookie },
      });
      expect((await read.json()).operationDescription).toBe("Venta en establecimiento");
    },
  );
  it("does not read or update another tenant's location even if configured with its id", async () => {
    const mismatched = app(other.cfg.locationId);
    const response = await mismatched.request("/management-api/location-settings", {
      headers: { cookie: venue.managerCookie },
    });
    expect(response.status).toBe(400);
    expect(
      (
        await mismatched.request(
          "/management-api/location-settings",
          request(venue.managerCookie, "Cross tenant"),
        )
      ).status,
    ).toBe(400);
    const row = await suite.admin.execute<{ description: string }>(
      sql`select operation_description as description from locations where id = ${other.cfg.locationId}`,
    );
    expect(row.rows[0]!.description).toBe("Venta en establecimiento");
  });
});

it("refuses a manager session belonging to another tenant", async () => {
  const response = await app().request("/management-api/location-settings", {
    headers: { cookie: other.managerCookie },
  });
  expect(response.status).toBe(403);
  expect(
    (
      await app().request(
        "/management-api/location-settings",
        request(other.managerCookie, "Other tenant"),
      )
    ).status,
  ).toBe(403);
});
