import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
// Sale writes and receipt reads through the real device-authenticated sale route, against a real
// migrated venue database.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, sales, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  addProductToMenu,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { routingCells } from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { DEV_DEVICE_HEADER, DEVICE_COOKIE } from "./device-session.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";

/**
 * Exercise device authentication through the sale route to a fiscal record.
 * device_id comes from the enrolled device; node_id and series_id remain the configured chain keys.
 */
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

const noopLog: Logger = () => {};

/** An already-anchored wall clock; `recordSale` reads `now()` once and never anchors. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored" as const,
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("sale-till-source.receipt: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// A fresh NIF per provisioned venue. `tenants_country_tax_id_key` is unique, and a case that
// provisions twice inside one test keeps its own rows distinct — the per-test reset empties the
// data between tests, so the counter is what keeps a repeated call inside one test apart.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(61_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

/** Provision a fresh chained venue, seed a catalogue + an `each` product and a login person with a
 *  known PIN. Returns the cfg, the venue's `locationId`,
 *  the sellable product, and the operator to attribute the sale to. */
async function setupVenue(): Promise<{
  cfg: TillConfig;
  locationId: string;
  product: AvailableProduct & { menuItemId: string };
  operatorId: string;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const { product, operatorId } = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const created = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const menuItem = await addProductToMenu(tx, {
      menuId: cat.id,
      productId: created.id,
      grossPrice: "1.50",
    });
    const counter = await tx.execute<{ zone_id: string }>(sql`
      select zone_id from zone_service_policies
      where location_id=${cfg.locationId} and is_counter_default`);
    await offerMenuThroughZone(tx, cfg, counter.rows[0]!.zone_id, cat.id, { makeDefault: true });
    await publishWorkingMenu(tx, cat.id);
    // Through the table definition: `routingCells.id`
    // (`packages/venue-service/src/schema/routing.ts`) is a `$defaultFn` generator, which a raw
    // statement never reaches.
    await tx.insert(routingCells).values({
      locationId: cfg.locationId,
      categoryId: bebidas.id,
      stationId: null,
      noPreparation: true,
    });
    // Through the table definition: `persons.id` and `persons.created_at` are `$defaultFn`
    // generators (`persons` in `packages/identity/src/schema/persons.ts`), which a raw statement
    // never reaches.
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    return {
      product: {
        ...available.find((p) => p.pricingUnit === "each")!,
        menuItemId: menuItem.id,
      },
      operatorId: person!.id,
    };
  });
  return { cfg, locationId: venue.locationId, product, operatorId };
}

/** Seed a `phone-portrait` (handheld) `device_profiles` row. A per-call counter keeps the
 *  venue-unique name apart. */
let profileCounter = 0;
async function seedHandheldProfile(): Promise<string> {
  profileCounter += 1;
  // Through the table definition: `device_profiles.id` and `.created_at` are `$defaultFn`
  // generators (`deviceProfiles` in `packages/db/src/schema/device-profiles.ts`), unreachable from
  // raw SQL.
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Handheld ${profileCounter}`,
      formFactor: "phone-portrait",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
    })
    .returning({ id: deviceProfiles.id });
  return profile!.id;
}

/**
 * Enrol a REAL sale-capable device named `name` through the production join-and-accept path, and
 * return its `waitron_device=<id>.<token>` cookie.
 */
async function enrolTillCookie(cfg: TillConfig, name: string): Promise<string> {
  const profileId = await seedHandheldProfile();
  const dev = await enrolDeviceForTest(suite.db, cfg, { name, profileId });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/**
 * Enrol a REAL device named `name` and return its raw `deviceId` — the id the dev-override header
 * (`x-waitron-dev-device`) carries in place of the cookie.
 */
async function enrolTillDeviceId(cfg: TillConfig, name: string): Promise<string> {
  const profileId = await seedHandheldProfile();
  const dev = await enrolDeviceForTest(suite.db, cfg, { name, profileId });
  return dev.deviceId;
}

function apiDeps(cfg: TillConfig): TillApiDeps {
  return {
    db: suite.db,
    backend,
    clock,
    cfg,
    secureCookies: false,
    venueLocale: cfg.locale,
  };
}

/** Log in through the HTTP surface on the device `device` names (a cookie, or the dev-override
 *  header) and return the session cookie the route sets. */
async function login(
  app: Hono,
  operatorId: string,
  device: { cookie: string } | { devHeader: string },
): Promise<string> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...("cookie" in device
        ? { cookie: device.cookie }
        : { [DEV_DEVICE_HEADER]: device.devHeader }),
    },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!;
}

/** Ring one cash sale of two units of `menuItemId`, carrying the session + device cookies, and assert
 *  the route returned a ticket (200). */
async function ringSale(
  app: Hono,
  sessionCookie: string,
  deviceCookie: string,
  menuItemId: string,
): Promise<void> {
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${sessionCookie}; ${deviceCookie}` },
    body: JSON.stringify({
      lines: [{ menuItemId, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    }),
  });
  expect(res.status).toBe(200);
}

interface Registro {
  deviceId: string | null;
  nodeId: string;
  secuencia: number;
  huella: string;
  anteriorHuella: string | null;
  entorno: string | null;
  numSerieFactura: string;
}

/** Every fiscal record filed for the tenant, oldest first — one per sale, this tenant's alone. */
async function registrosFor(cfg: TillConfig): Promise<Registro[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx
      .select({
        deviceId: registrosFacturacion.deviceId,
        nodeId: registrosFacturacion.nodeId,
        secuencia: registrosFacturacion.secuencia,
        huella: registrosFacturacion.huella,
        anteriorHuella: registrosFacturacion.anteriorHuella,
        entorno: registrosFacturacion.entorno,
        numSerieFactura: registrosFacturacion.numSerieFactura,
      })
      .from(registrosFacturacion);
    return rows.sort((a, b) => a.secuencia - b.secuencia);
  });
}

/** Each sale's stored `sales.device_id`, ordered by the per-series `invoice_number` (1, 2, …) so it
 *  lines up with the registros ordered by `secuencia`. */
async function saleDeviceIds(cfg: TillConfig): Promise<(string | null)[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx
      .select({ deviceId: sales.deviceId, invoiceNumber: sales.invoiceNumber })
      .from(sales);
    return rows.sort((a, b) => a.invoiceNumber - b.invoiceNumber).map((r) => r.deviceId);
  });
}

const deviceIdOf = (cookie: string) => cookie.slice(`${DEVICE_COOKIE}=`.length).split(".")[0];

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("sale-till-source.receipt: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("H2 receipt: a sale's device resolves from the request, the chain does not (SP-A.2 §16.4)", () => {
  it("files each sale under the AUTHENTICATED device, changing ONLY device_id — node/series/chain untouched", async () => {
    // Two `till`-kind devices on ONE node. Ringing a sale via device-X then device-Y files two
    // records on the SAME chain (secuencia 1, 2) whose ONLY difference is the `device_id` snapshot:
    // nothing device-derived touches `node_id`, the series or the hash chain.
    const { cfg, product, operatorId } = await setupVenue();

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    // Sale 1 via device X, signed in on it.
    const deviceX = await enrolTillCookie(cfg, "Caja 1");
    await ringSale(
      app,
      await login(app, operatorId, { cookie: deviceX }),
      deviceX,
      product.menuItemId,
    );

    // Sale 2 via device Y — same tenant, same node, same operator, same basket.
    const deviceY = await enrolTillCookie(cfg, "Caja 2");
    await ringSale(
      app,
      await login(app, operatorId, { cookie: deviceY }),
      deviceY,
      product.menuItemId,
    );

    const registros = await registrosFor(cfg);
    expect(registros).toHaveLength(2);
    const [first, second] = registros;

    // Each record names its ringing DEVICE — X then Y.
    expect(first!.deviceId).toBe(deviceIdOf(deviceX));
    expect(second!.deviceId).toBe(deviceIdOf(deviceY));
    expect(first!.deviceId).not.toBe(second!.deviceId);
    // The same movement on the `sales` row itself.
    expect(await saleDeviceIds(cfg)).toEqual([deviceIdOf(deviceX), deviceIdOf(deviceY)]);

    // BOTH records file under `cfg.nodeId` — the SIF anchor — whichever device rang them; a device
    // that influenced `nodeId` would silently fork the SIF.
    expect(first!.nodeId).toBe(cfg.nodeId);
    expect(second!.nodeId).toBe(cfg.nodeId);

    // ONE continuous chain under the same node: the second's predecessor IS the first's huella,
    // sequence 1 -> 2, both in series A. Only the device_id moved.
    expect(first!.secuencia).toBe(1);
    expect(first!.anteriorHuella).toBeNull();
    expect(second!.secuencia).toBe(2);
    expect(second!.anteriorHuella).toBe(first!.huella);
    expect(first!.numSerieFactura).toBe("A/1");
    expect(second!.numSerieFactura).toBe("A/2");
    expect(second!.entorno).toBe(first!.entorno);
  });
});

describe("SP-C: a sale posted with the dev-override header files under THAT device (devMode)", () => {
  it("resolves the sale's device from the x-waitron-dev-device header", async () => {
    // Under `devMode`, a session signed in with the `x-waitron-dev-device: <id>` header (no
    // `waitron_device` cookie) is that device's, and its `POST /api/sales` files under THAT device;
    // were the header ignored the sign-in would answer `device.unauthorized` (401).
    const { cfg, product, operatorId } = await setupVenue();

    // devMode ON makes the override header live.
    const app = new Hono();
    mountTillApi(app, { ...apiDeps(cfg), devMode: true }, noopLog);
    const deviceY = await enrolTillDeviceId(cfg, "Caja override");
    // Signed in through the same header, as a dev tab running that device does.
    const sessionCookie = await login(app, operatorId, { devHeader: deviceY });
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
        [DEV_DEVICE_HEADER]: deviceY,
      },
      body: JSON.stringify({
        lines: [{ menuItemId: product.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(200);

    // The one sale filed under the overridden device.
    expect(await saleDeviceIds(cfg)).toEqual([deviceY]);
  });
});

describe("a sale names the device it was rung on", () => {
  it("files the sale and its fiscal record under the ringing device's source and device", async () => {
    // Two devices at one location, so only the device can tell the two sales apart.
    const { cfg, product, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const deviceX = await enrolTillCookie(cfg, "Caja 1");
    const deviceY = await enrolTillCookie(cfg, "Caja 2");
    for (const cookie of [deviceX, deviceY]) {
      await ringSale(app, await login(app, operatorId, { cookie }), cookie, product.menuItemId);
    }
    const expected = [deviceX, deviceY].map((cookie) => ({
      source: "device",
      device_id: deviceIdOf(cookie),
    }));

    const saleRows = await suite.db.execute<{ source: string | null; device_id: string | null }>(
      sql`select source, device_id from sales order by invoice_number`,
    );
    expect(saleRows.rows).toEqual(expected);
    const registroRows = await suite.db.execute<{
      source: string | null;
      device_id: string | null;
    }>(sql`select source, device_id from registros_facturacion order by secuencia`);
    expect(registroRows.rows).toEqual(expected);
  });
});
