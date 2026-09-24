import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createProduct,
  setProductVariants,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// A venue with NO service zones, so each of the three line-carrying routes prices from the plain
// product path (`resolveHttpOrderZone` answers no zone). A parent with an Active variant is never
// sold as itself there either (spec §15.1): a variant can only be picked from a zone's menu offer.
// The fiscal seat is an empty object, so a case that reached a filing would fail rather than file.
let cfg: TillConfig;
let personId: string;
let payDeviceCookie: string;
// A parent with an Active, Available variant; a parent whose only variant is Active but Unavailable;
// a parent whose only variant is Inactive; and a product with no variant at all.
let wine: string;
let beer: string;
let coffee: string;
let water: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    await seedKitchenStation(db, { locationId: brandLocationId(loc!.id) });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Till 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    personId = person!.id;
    cfg = {
      tillId: brandTillId(till!.id),
      nodeId: brandNodeId(nodeId),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(loc!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      orderFlow: "prepay",
    };
    const ids = await withTransaction(db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Carta" });
      await assignCatalogueToLocation(tx, loc!.id, menu.id);
      const product = (name: string, unitPrice: string) =>
        createProduct(tx, {
          catalogueId: menu.id,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        });
      const variant = (name: string, available: boolean, active: boolean) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.00",
        available,
        active,
      });
      const wine = await product("Vino", "4.00");
      await setProductVariants(tx, wine.id, [variant("Vino copa", true, true)], "es");
      const beer = await product("Cerveza", "2.50");
      await setProductVariants(tx, beer.id, [variant("Cerveza tercio", false, true)], "es");
      const coffee = await product("Café", "1.20");
      await setProductVariants(tx, coffee.id, [variant("Café doble", true, false)], "es");
      const water = await product("Agua", "1.50");
      return { wine: wine.id, beer: beer.id, coffee: coffee.id, water: water.id };
    });
    ({ wine, beer, coffee, water } = ids);
    const [profile] = await db
      .insert(deviceProfiles)
      .values({
        name: "Card till",
        formFactor: "till",
        canvasId: null,
        capabilities: ["integrated-card-payment"],
      })
      .returning({ id: deviceProfiles.id });
    const device = await enrolDeviceForTest(db, cfg, { name: "Card till", profileId: profile!.id });
    payDeviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  },
});

function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("anchor() is not used here");
    },
    currentAnchor: () => null,
  };
}

function app(db: Database): Hono {
  const deps: TillApiDeps = {
    db,
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
    cardProvider: { provider: "simulator" } as PaymentProvider,
  };
  const hono = new Hono();
  mountTillApi(hono, deps, () => {});
  return hono;
}

async function cookies(): Promise<string> {
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId, pin: "5555" }),
  );
  return `${SESSION_COOKIE}=${session.id}; ${payDeviceCookie}`;
}

async function post(path: string, body: object): Promise<Response> {
  return app(suite.db).request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await cookies() },
    body: JSON.stringify(body),
  });
}

const park = (productId: string, id = randomUUID()) =>
  post("/api/working-orders", { id, lines: [{ productId, quantity: "1" }] });

async function orderLines(id: string): Promise<string[]> {
  return (
    await suite.db.execute<{ product_id: string }>(
      sql`select product_id from working_order_lines where working_order_id = ${id}`,
    )
  ).rows.map((row) => row.product_id);
}

describe("a venue with no service zones never sells a parent with Active variants as itself", () => {
  it("has no service zone, so the routes below take the plain product path", async () => {
    const zones = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from zone_service_policies`,
    );
    expect(zones.rows[0]!.n).toBe(0);
  });

  for (const [route, body] of [
    [
      "/api/working-orders",
      (productId: string) => ({ id: randomUUID(), lines: [{ productId, quantity: "1" }] }),
    ],
    [
      "/api/sales",
      (productId: string) => ({
        lines: [{ productId, quantity: "1" }],
        tender: { method: "cash", amount: "10.00" },
      }),
    ],
    [
      "/api/pay",
      (productId: string) => ({
        id: randomUUID(),
        lines: [{ productId, quantity: "1" }],
        simulationOutcome: "captured",
      }),
    ],
  ] as const) {
    it(`POST ${route} refuses a parent with an Active variant, Available or not`, async () => {
      for (const parent of [wine, beer]) {
        const res = await post(route, body(parent));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: { code: "product.variant_required", params: { productId: parent } },
        });
      }
    });
  }

  it("parks nothing when the refused parent shares the basket with a product that sells", async () => {
    const id = randomUUID();
    const res = await post("/api/working-orders", {
      id,
      lines: [
        { productId: water, quantity: "1" },
        { productId: wine, quantity: "1" },
      ],
    });
    expect(res.status).toBe(400);
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from working_orders where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("still sells a product with no variant, and a parent whose only variant is Inactive, as itself", async () => {
    for (const productId of [water, coffee]) {
      const id = randomUUID();
      const res = await park(productId, id);
      expect(res.status).toBe(200);
      expect(await orderLines(id)).toEqual([productId]);
    }
  });
});
