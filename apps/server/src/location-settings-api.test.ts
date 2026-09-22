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
 * ## This file is CONVERTED and RED, and neither reason is in this file
 *
 * 1. **`beforeAll` cannot get past `setupVenue`.** `apps/server/src/testing/venue-fixtures.ts:137`
 *    and `:140` insert `persons` with a raw statement, and `persons.id` / `persons.created_at` are
 *    `$defaultFn` generators filling NOT NULL columns
 *    (`packages/identity/src/schema/persons.ts:26,:67`) that a statement never reaches. Measured
 *    2026-09-22: `NOT NULL constraint failed: persons.id`. That fixture is shared with five other
 *    suites and is nobody's to edit from here; the fix is the same `tx.insert(persons)` swap every
 *    sibling took.
 *
 * 2. **One case is then red on a PRODUCT defect.** Measured 2026-09-22 with that fixture patched
 *    locally and the patch reverted: 8 of the 9 cases pass, and
 *    `uses an edited description for the next fiscal record while retaining the earlier record`
 *    fails with `TypeError: desglose.map is not a function` at
 *    `packages/fiscal-verifactu/src/backend.ts:360`. `filedReceiptFor` reads the row at `:332`
 *    with a raw select over `registros_facturacion`, and a raw read skips drizzle's JSON decoding,
 *    so `desglose` arrives as TEXT. Same shape as the drainer's `facturas_sustituidas` read the
 *    branch ledger already records.
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
