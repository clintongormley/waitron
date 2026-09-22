import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { recordTillSale } from "./till-sale.js";

/**
 * The venue's invoice operation description, over the route.
 *
 * ## Two blockers this header used to declare are fixed
 *
 * 1. The shared fixture seeded `persons` with a raw statement, which reaches no `$defaultFn`
 *    generator, so `beforeAll` never got past `setupVenue`
 *    (`NOT NULL constraint failed: persons.id`). `apps/server/src/testing/venue-fixtures.ts` writes
 *    those rows through the table definition now.
 *
 * 2. `filedReceiptFor` read `registros_facturacion` with a raw select, which skips drizzle's JSON
 *    decoding, so `desglose` arrived as text and the edited-description case died in
 *    `desglose.map`. `packages/fiscal-verifactu/src/backend.ts` decodes the row it read
 *    (`decodeRegistroRow`).
 *
 * The file is green — run on its own, 2026-09-22.
 */
// The full manifest, because the first case files a real fiscal record through `recordTillSale`.
// `resetPerTest: false`: the venue set up once in `beforeAll` is read by every case, and each case
// that writes the description restores it in a `finally`.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
let venue: Venue;
beforeAll(async () => {
  venue = await setupVenue(suite.db);
});
function app(locationId?: string) {
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
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
  it("uses an edited description for the next fiscal record while retaining the earlier record", async () => {
    const clock: TrustedClock = {
      now: () => ({
        instant: new Date(),
        offsetMinutes: 0,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw new Error("This test supplies an anchored clock");
      },
      currentAnchor: () => null,
    };
    const backend = new VerifactuBackend({
      clock,
      db: suite.db,
      environment: "preproduction",
      deploymentEnvironment: "preproduction",
      resolveClient: () => Promise.reject(new Error("A local sale must not contact AEAT")),
    });
    const sell = () =>
      recordTillSale({ db: suite.db, backend, clock }, venue.cfg, {
        lines: [{ productId: venue.cafeId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      });
    await sell();
    try {
      expect(
        (
          await app().request(
            "/management-api/location-settings",
            request(venue.managerCookie, "  Venta de comidas  "),
          )
        ).status,
      ).toBe(204);
      await sell();
      const descriptions = await suite.db.execute<{ description: string }>(sql`
        select descripcion_operacion as description from registros_facturacion
        order by secuencia`);
      expect(descriptions.rows).toEqual([
        { description: "Venta en establecimiento" },
        { description: "  Venta de comidas  " },
      ]);
    } finally {
      await suite.db.execute(
        sql`update locations set operation_description = 'Venta en establecimiento' where id = ${venue.cfg.locationId}`,
      );
    }
  });
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
  it("reads and updates the deployed location", async () => {
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
      await suite.db.execute(
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
});
