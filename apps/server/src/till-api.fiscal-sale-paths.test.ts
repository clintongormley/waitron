import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  drawerOpens,
  orderAmendments,
  printJobs,
  saleLines,
  sales,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  addProductToMenu,
  createProduct,
  createExtraList,
  createOptionList,
  listAvailableProducts,
  readContentLanguages,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  hashPassword,
  hashPin,
  loginWithPin,
  permissionsForRole,
  persons,
} from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { MANUAL_PROVIDER, SimulatorPaymentProvider, cardReaders } from "@waitron/payments";
import { stationClaims } from "@waitron/venue-service";
import { createPrinter } from "@waitron/printing";
import { CARD_PROVIDERS } from "@waitron/composition";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import type { TillSaleResult } from "./till-sale.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";
import { DRAWER_KICK } from "./receipt-print.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { createStation } from "./kitchen.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";

// `POST /api/sales`, `POST /api/pay` and the `/api/working-orders` routes driven over HTTP to a
// GENUINE chained fiscal record, including the lost-response pay retry that must replay the ticket
// and file no second record. Route logic that needs no real fiscal write lives in the
// hermetic `till-api.test.ts`, whose fiscal seat is an empty object.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** A no-op logger: the routes emit structured lines the hermetic suite already asserts; here only
 * the HTTP responses and the database matter. */
const noopLog: Logger = () => {};

/** The wall clock, reported as already confident and anchored. */
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
      throw new Error("till-api.fiscal-sale-paths.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(60_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow: "prepay",
  };
}

/**
 * Stand up a fresh chained venue + registered SIF, seed a catalogue and a staff
 * person with a known PIN, and read back the sellable products — one unit product
 * (1.50 gross, general/21%) and one kg product (24.90 €/kg, reduced/10%).
 */
async function setupVenue(): Promise<{
  cfg: TillConfig;
  catalogueId: string;
  available: (AvailableProduct & { menuItemId: string })[];
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
  const { catalogueId, available, operatorId } = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: "Comida" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const seededUnits = await tx.execute<{ id: string; seed_key: string }>(sql`
      select id, seed_key from units where seed_key = 'kg'`);
    const kgId = seededUnits.rows.find((unit) => unit.seed_key === "kg")!.id;
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      name: "Jamón cortado",
      unitId: kgId,
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      unitId: null, // Each (no unit).
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const jamonItem = await addProductToMenu(tx, {
      menuId: cat.id,
      productId: jamon.id,
      grossPrice: "24.90",
    });
    const aguaItem = await addProductToMenu(tx, {
      menuId: cat.id,
      productId: agua.id,
      grossPrice: "1.50",
    });
    await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id, display_order)
      select zone_id, ${cat.id}, 0
      from zone_service_policies
      where location_id = ${cfg.locationId}
        and is_counter_default`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${cat.id}
      where location_id = ${cfg.locationId}
        and is_counter_default`);
    await publishWorkingMenu(tx, cat.id);
    const defaultStation = sql`(select id from kitchen_stations
           where location_id = ${cfg.locationId} and is_default)`;
    await tx.insert(stationClaims).values([
      { locationId: cfg.locationId, categoryId: comida.id, stationId: defaultStation },
      { locationId: cfg.locationId, categoryId: bebidas.id, stationId: defaultStation },
    ]);
    // A staff person with a KNOWN PIN ("5555"), so the login route can verify their credential and
    // the sale is attributed to them.
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const menuItems = new Map([
      [jamon.id, jamonItem.id],
      [agua.id, aguaItem.id],
    ]);
    return {
      catalogueId: cat.id,
      available: (await listAvailableProducts(tx, cfg.locationId)).products.map((product) => ({
        ...product,
        menuItemId: menuItems.get(product.id)!,
      })),
      operatorId: person!.id,
    };
  });
  return { cfg, catalogueId, available, operatorId };
}

/** The till API's deps for a provisioned venue: the suite's one database handle, the real fiscal
 * backend + system clock the sale path files through, and `secureCookies:false` so the session
 * cookie rides the non-TLS `app.request`. */
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

/** The vault key ring the seeded `payments.*` credentials are sealed under (a fixed test key). */
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

/**
 * A fake `CardProviderPool` shaped like production's: one cached `StripeTerminalProvider` over
 * `FakeStripe` per provider id, and `get` takes no reader — the reader is a per-collect input
 * (`CollectParams.readerRef`). The caching is what lets the two-readers-one-provider case prove
 * the ref is not baked in.
 */
function fakePool(_cfg: TillConfig, client: FakeStripe): CardProviderPool {
  const cache = new Map<string, StripeTerminalProvider>();
  return {
    get: (providerId) => {
      let provider = cache.get(providerId);
      if (provider === undefined) {
        provider = new StripeTerminalProvider({
          client,
          db: suite.db,
          // No real waiting: FakeStripe resolves synchronously, so a poll never actually stalls.
          poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
        });
        cache.set(providerId, provider);
      }
      return Promise.resolve(provider);
    },
    evict: (providerId) => {
      cache.delete(providerId);
    },
  };
}

/** `apiDeps` plus a `CardProviderPool`, for the `POST /api/pay` reader-routing tests. Threads the
 * real composition list so the pay path resolves a reader's provider `credentialPurpose` from its
 * seat, exactly as boot does. */
function apiDepsWithPool(cfg: TillConfig, pool: CardProviderPool): TillApiDeps {
  return {
    db: suite.db,
    backend,
    clock,
    cfg,
    secureCookies: false,
    venueLocale: cfg.locale,
    pool,
    providers: CARD_PROVIDERS,
  };
}

/** Seed an ACTIVE `card_readers` row (default provider `stripe`) and return its id + `providerRef`. */
async function seedReader(
  opts: { provider?: string; providerRef?: string; name?: string } = {},
): Promise<{ id: string; providerRef: string }> {
  const providerRef = opts.providerRef ?? `reader_${randomUUID()}`;
  const [r] = await suite.db
    .insert(cardReaders)
    .values({
      provider: opts.provider ?? "stripe",
      providerRef,
      name: opts.name ?? "Front counter",
    })
    .returning({ id: cardReaders.id });
  return { id: r!.id, providerRef };
}

/** Point a device at its DEFAULT reader (`device_card_readers`). */
async function setDefaultReader(deviceId: string, readerId: string): Promise<void> {
  await suite.db.execute(sql`
    insert into device_card_readers (device_id, reader_id) values (${deviceId}, ${readerId})`);
}

/** Seal the `payments.stripe` credential so the provider counts as CONNECTED (the pay
 * path's pre-check reads only its presence). */
async function connectStripe(): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    putCredential(tx, RING, {
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_x",
        webhookSecret: "whsec_x",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
}

/** The `deviceId` embedded in a `waitron_device=<id>.<token>` cookie. */
function deviceIdOf(cookie: string): string {
  return cookie.split("=")[1]!.split(".")[0]!;
}

/** The stamped `payments.reader_id` for a working order (NULL when none). */
async function readerIdOnPayment(workingOrderId: string): Promise<string | null> {
  const rows = await suite.db.execute<{ reader_id: string | null }>(sql`
    select reader_id from payments where working_order_id = ${workingOrderId}`);
  return rows.rows[0]?.reader_id ?? null;
}

/**
 * Enrol a `till` device and return its `waitron_device=<id>.<token>` cookie. Its default profile
 * takes cash; the `/api/pay` cases pass a profile declaring `integrated-card-payment`.
 */
let tillDeviceCounter = 0;
async function enrolTillCookie(
  cfg: TillConfig,
  deviceProfileId: string | null = null,
): Promise<string> {
  tillDeviceCounter += 1;
  const profileId = deviceProfileId ?? (await seedProfileFF("till", ["take-cash"]));
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: `Counter till ${tillDeviceCounter}`,
    profileId,
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Log the operator (PIN "5555") in on `deviceCookie`'s device and return the Set-Cookie session
 *  cookie. The login is device-gated, so without one it enrols a throwaway `till` device. */
async function loginSession(
  app: Hono,
  cfg: TillConfig,
  operatorId: string,
  deviceCookie?: string,
): Promise<string> {
  deviceCookie ??= await enrolTillCookie(cfg);
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return login.headers.get("set-cookie")!;
}

/** Create a till profile with the reader, drawer and cash capabilities needed by payment tests. */
async function createTillProfile(): Promise<string> {
  // Through the table definition, not raw SQL: `device_profiles.id` is a `$defaultFn` generator,
  // which a raw insert never runs.
  const [prof] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: "Counter till",
      formFactor: "till",
      capabilities: ["integrated-card-payment", "open-cash-drawer", "take-cash"],
    })
    .returning({ id: deviceProfiles.id });
  return prof!.id;
}

/** Seed a `device_profiles` row of a given form factor; the counter keeps its unique `name` fresh. */
let profileCounter = 0;
async function seedProfileFF(
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
  capabilities: string[] = [],
): Promise<string> {
  profileCounter += 1;
  const [prof] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${formFactor} ${profileCounter}`, formFactor, capabilities })
    .returning({ id: deviceProfiles.id });
  return prof!.id;
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error(
          "till-api.fiscal-sale-paths.test: resolveClient must never be called by recordSale",
        ),
      ),
  });
});

describe("POST /api/session (PIN login body handling)", () => {
  it("an empty (unparseable) request body is a clean 401 pin.invalid, never an opaque 500", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // An empty POST body is invalid JSON: a bare `c.req.json()` throws a SyntaxError that escapes to
    // the error boundary as `server.internal` (500). Reading it through `readJsonBody` coerces it to
    // `{}`, so the route's own `personId` validation refuses it with `pin.invalid` (401) — the
    // same code+status a well-formed-but-unknown id gets — instead of a 500.
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
  });
});

describe("POST /api/sales (the fiscal sale path over HTTP)", () => {
  it("logs in, rings a cash sale, returns the ticket, and writes a chained fiscal record", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);
    // 1. Log in through the HTTP surface and capture the session cookie the route sets.
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    expect(cookie).toMatch(/waitron_till_session=/);

    // 2. Ring a sale with that cookie: 2 × 1.50 = 3.00 total, 5.00 tendered → 2.00 change.
    const saleRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });

    expect(saleRes.status).toBe(200);
    // The sale route neither opens nor rotates the session, so it emits NO Set-Cookie — the cookie
    // the login set is the one that stays in force.
    expect(saleRes.headers.get("set-cookie")).toBeNull();

    // 3. The ticket payload the till prints.
    const ticket = await saleRes.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(ticket.total).toBe("3.00");
    expect(ticket.tender).toEqual({ method: "cash", change: "2.00" });
    expect(ticket.vatBreakdown).toEqual([{ rate: "21.00", base: "2.48", tax: "0.52" }]);
    expect(ticket.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO-8601 instant
    // VerifactuBackend always sets a verification URL, so the QR is a non-empty string.
    expect(typeof ticket.qr).toBe("string");
    expect(ticket.qr.length).toBeGreaterThan(0);

    // 4. A GENUINE chained fiscal record exists for this node — one, hashed.
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion);
    });
    expect(registros.length).toBe(1);
    expect(registros[0]!.nodeId).toBe(cfg.nodeId);
    expect(registros[0]!.huella).toMatch(/^[0-9A-F]{64}$/);

    // 5. The sale is attributed to the logged-in operator — the whole point of the session guard.
    const saleRows = await withTransaction(suite.db, async (tx) => {
      return tx.select({ operatorId: sales.operatorId }).from(sales);
    });
    expect(saleRows).toEqual([{ operatorId }]);
  });

  // The operator's whole server-side journey — log in, read the menu, ring a MIXED-rate basket built
  // from it — held to the legal ticket standard (findings §14) and an intact hash chain across two
  // sales.
  it("walks the full journey: login → menu → mixed-rate sale → legal ticket + an intact fiscal chain", async () => {
    const { cfg, operatorId } = await setupVenue();

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);
    // 1. Log in through the HTTP surface and capture the session cookie.
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    expect(cookie).toMatch(/waitron_till_session=/);

    // 2. The operator sees the default zone's menu offers. The sale lines are built from those offers,
    // exactly as the real till does (it never invents menu-item ids).
    const productsRes = await app.request("/api/default-service-zone/offers", {
      headers: { cookie },
    });
    expect(productsRes.status).toBe(200);
    const { offers } = (await productsRes.json()) as {
      offers: {
        id: string;
        unit: {
          name: Record<string, string>;
          precision: number;
          hardwareUnit: "kg" | "g" | "mg" | null;
        };
        name: string;
      }[];
    };
    const products = offers.map((offer) => ({ ...offer, menuItemId: offer.id }));
    // The two seeded, sellable products come back — the reduced-rate weighed one and the
    // general-rate each one — so the basket below genuinely mixes VAT rates.
    expect(products.map((p) => p.name).sort()).toEqual(["Agua mineral", "Jamón cortado"]);
    const jamon = products.find((p) => p.unit.hardwareUnit === "kg")!; // 24.90 €/kg reduced(10%)
    const agua = products.find((p) => p.unit.hardwareUnit === null)!; // 1.50 per unit general(21%)

    const invalidQuantity = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: jamon.menuItemId, quantity: "0.2001" }],
        tender: { method: "cash", amount: "10.00" },
      }),
    });
    expect(invalidQuantity.status).toBe(400);
    expect(await invalidQuantity.json()).toMatchObject({
      error: { code: "quantity.invalid", params: { reason: "precision" } },
    });

    // 3. Ring a MIXED basket: 0.200 kg jamón (4.98 gross @10%) + 2 × agua (3.00 gross @21%) = 7.98,
    // tendered 10.00 → 2.02 change. Two rate groups, so the vatBreakdown must carry a per-rate base
    // for each (findings §14: the base imponible split per rate is mandatory once rates mix).
    const saleRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [
          { menuItemId: jamon.menuItemId, quantity: "0.200" },
          { menuItemId: agua.menuItemId, quantity: "2" },
        ],
        tender: { method: "cash", amount: "10.00" },
      }),
    });
    expect(saleRes.status).toBe(200);

    // 4. Every legally-required ticket field (findings §14).
    const ticket = await saleRes.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/); // número + serie
    expect(ticket.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/); // fecha de expedición, ISO-8601…
    expect(Number.isNaN(Date.parse(ticket.issuedAt))).toBe(false); // …and a real instant
    expect(ticket.total).toBe("7.98"); // contraprestación total
    // base imponible per rate — ≥2 rate groups, asserted order-independently.
    expect(ticket.vatBreakdown).toHaveLength(2);
    expect(ticket.vatBreakdown).toEqual(
      expect.arrayContaining([
        { rate: "10.00", base: "4.53", tax: "0.45" },
        { rate: "21.00", base: "2.48", tax: "0.52" },
      ]),
    );
    expect(ticket.tender).toEqual({ method: "cash", change: "2.02" }); // operational efectivo/cambio line
    // The QR is the AEAT verification URL — required on every RRSIF invoice, so a non-empty string.
    expect(typeof ticket.qr).toBe("string");
    expect(ticket.qr.length).toBeGreaterThan(0);
    // Read through the table definition, not a raw `select`: `unit_name` is a `json` column over
    // text (`saleLines.unitName`), and a raw read hands back the stored JSON TEXT. `quantity` counts
    // whole thousandths, so the weighed 0.200 kg line holds 200.
    const snapshottedLine = await suite.db
      .select({
        quantity: sql<string>`cast(${saleLines.quantity} as text)`,
        unit_name: saleLines.unitName,
        unit_precision: saleLines.unitPrecision,
      })
      .from(saleLines)
      .where(sql`${saleLines.quantity} = 200`);
    expect(snapshottedLine).toEqual([
      {
        quantity: "200",
        unit_name: { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" },
        unit_precision: 3,
      },
    ]);

    // 5. Ring a SECOND identical mixed sale so the chain has a predecessor to link to. Same cookie,
    // same app — invoice A/2.
    const secondRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [
          { menuItemId: jamon.menuItemId, quantity: "0.200" },
          { menuItemId: agua.menuItemId, quantity: "2" },
        ],
        tender: { method: "cash", amount: "10.00" },
      }),
    });
    expect(secondRes.status).toBe(200);

    // 6. Two chained fiscal records: the first opens the chain (`primerRegistro`, no predecessor
    // pointer), and the second increments `secuencia` and carries the first's huella as
    // `anteriorHuella`.
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(2);

    const [first, second] = registros;
    expect(first!.nodeId).toBe(cfg.nodeId);
    expect(first!.secuencia).toBe(1);
    expect(first!.primerRegistro).toBe(true);
    expect(first!.anteriorHuella).toBeNull();
    expect(first!.huella).toMatch(/^[0-9A-F]{64}$/);
    expect(second!.nodeId).toBe(cfg.nodeId);
    expect(second!.secuencia).toBe(2); // the per-node sequence increments
    expect(second!.primerRegistro).toBe(false);
    expect(second!.huella).toMatch(/^[0-9A-F]{64}$/);
    // …and the chain links: the second's predecessor pointer IS the first's actual huella.
    expect(second!.anteriorHuella).toBe(first!.huella);
    expect(second!.anteriorNumSerieFactura).toBe("A/1");
  });
});

describe("sale-time device from the authenticated session (SP-A.2 cutover)", () => {
  it("refuses POST /api/sales from a session whose device has been revoked — 401 device.unauthorized, filing nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await suite.db.execute(
      sql`update devices set active = 0 where id = ${deviceIdOf(deviceCookie)}`,
    );

    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    // Refused before the fiscal write — the unrecoverable record is never touched (CLAUDE.md §5).
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion);
    });
    expect(registros).toHaveLength(0);
  });

  it("refuses a cash sale from a kitchen display, whose profile does not take cash — 403 device.cash_not_allowed", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // A `kds_station` device's profile carries no `take-cash`. Provisioning already seeds "Cocina".
    const station = await withTransaction(suite.db, async (tx) => {
      return createStation(tx, cfg, { name: "Pase", isDefault: false });
    });
    const profileId = await seedProfileFF("kds");
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: "Pantalla",
      profileId,
      stationId: station.id,
    });
    const deviceCookie = `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
    // Opened directly: the sign-in route refuses a till-less device itself.
    const session = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: dev.deviceId, personId: operatorId, pin: "5555" }),
    );
    const cookie = `${SESSION_COOKIE}=${session.token}`;

    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device.cash_not_allowed" } });
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion);
    });
    expect(registros).toHaveLength(0);
  });
});

describe("/api/working-orders → pay (park & retrieve, idempotent over HTTP)", () => {
  it("parks an order, retrieves it, pays it via POST /api/sales, and a replay refiles nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // 1. Log in and capture the session cookie.
    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    // 2. Park an order (client-minted id, its own idempotency key) with 2 × 1.50.
    const workingOrderId = randomUUID();
    const parkRes = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        label: "Mesa 3",
      }),
    });
    expect(parkRes.status).toBe(200);
    expect(await parkRes.json()).toEqual({ id: workingOrderId, orderNumber: 1 });

    // 3. Retrieve it — the held list carries it, and GET /:id rebuilds its basket inputs.
    const list = await app.request("/api/working-orders", { headers: { cookie } });
    expect(((await list.json()) as { id: string }[]).map((o) => o.id)).toContain(workingOrderId);
    const got = await app.request(`/api/working-orders/${workingOrderId}`, { headers: { cookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ id: workingOrderId, orderNumber: 1, label: "Mesa 3" });

    // 4. Pay it: POST /api/sales carrying the SAME workingOrderId, so the settle lands on THIS parked
    //    order (not a fresh walk-up). 2 × 1.50 = 3.00 total, 5.00 tendered → 2.00 change.
    const pay = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(pay.status).toBe(200);
    const ticket = await pay.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(ticket.total).toBe("3.00");
    expect(ticket.tender).toEqual({ method: "cash", change: "2.00" });
    expect(ticket.qr.length).toBeGreaterThan(0); // a genuine first filing carries the AEAT QR

    // 5. Exactly ONE chained fiscal record; the working order is now `settled` and the sale is filed
    //    under its id and attributed to the logged-in operator.
    const after = await withTransaction(suite.db, async (tx) => {
      return {
        registros: await tx.select().from(registrosFacturacion),
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
        saleRows: await tx
          .select({ workingOrderId: sales.workingOrderId, operatorId: sales.operatorId })
          .from(sales),
      };
    });
    expect(after.registros).toHaveLength(1);
    expect(after.wo).toEqual([{ status: "settled" }]);
    expect(after.saleRows).toEqual([{ workingOrderId, operatorId }]);

    // 6. REPLAY: the till lost the response and re-sends the identical pay. It must REPLAY the ticket
    //    (same invoice number, same total) and file NO second chained record — the crux of park &
    //    retrieve: invoice numbers are never reused, so a double filing is unrepairable.
    const replay = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(replay.status).toBe(200);
    const replayTicket = await replay.json();
    expect(replayTicket.invoiceNumber).toBe(ticket.invoiceNumber);
    expect(replayTicket.total).toBe("3.00");
    // A retry describes the same filed invoice and cash payment without dispensing change again.
    expect(replayTicket.qr).toBe(ticket.qr);
    expect(replayTicket.qr.length).toBeGreaterThan(0);
    expect(replayTicket.vatBreakdown).toEqual(ticket.vatBreakdown);
    expect(replayTicket.tender).toEqual({ method: "cash", change: "2.00" });

    // Still exactly ONE record — the replay filed nothing.
    const stillOne = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion);
    });
    expect(stillOne).toHaveLength(1);
  });
});

describe("paying a parked pay-first order over POST /api/sales sends its dishes to the kitchen", () => {
  it.each(["cash", "card"] as const)(
    "a %s payment sends its dish once, and a replay sends nothing more",
    async (method) => {
      const { cfg, available, operatorId } = await setupVenue(); // default mode: prepay
      const each = available.find((p) => p.pricingUnit === "each")!;
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const deviceCookie = await enrolTillCookie(cfg);
      const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
      const kitchenItems = async (id: string) =>
        (
          await suite.db.execute<{ items: number; fired: number }>(
            sql`select count(*) as items, count(fired_at) as fired from ticket_items
                where working_order_id = ${id}`,
          )
        ).rows[0];

      const workingOrderId = randomUUID();
      const filed = () =>
        withTransaction(suite.db, async (tx) => ({
          registros: await tx.select().from(registrosFacturacion),
          wo: await tx
            .select({ status: workingOrders.status })
            .from(workingOrders)
            .where(eq(workingOrders.id, workingOrderId)),
        }));
      const park = await app.request("/api/working-orders", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: workingOrderId,
          lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
          label: "Mesa 3",
        }),
      });
      expect(park.status).toBe(200);
      expect(await kitchenItems(workingOrderId)).toEqual({ items: 0, fired: 0 });

      const pay = () =>
        app.request("/api/sales", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
          body: JSON.stringify({
            workingOrderId,
            lines: [],
            tender: { method, amount: "5.00" },
          }),
        });
      expect((await pay()).status).toBe(200);
      expect(await kitchenItems(workingOrderId)).toEqual({ items: 1, fired: 1 });
      const afterPay = await filed();
      expect(afterPay.registros).toHaveLength(1);
      expect(afterPay.wo).toEqual([{ status: "settled" }]);

      expect((await pay()).status).toBe(200);
      expect(await kitchenItems(workingOrderId)).toEqual({ items: 1, fired: 1 });
      const afterReplay = await filed();
      expect(afterReplay.registros).toHaveLength(1);
      expect(afterReplay.wo).toEqual([{ status: "settled" }]);
    },
  );
});

// POST /api/pay resolves the reader (request `readerId`, else the paying device's default in
// `device_card_readers`), pre-checks its provider is connected, and drives it through
// `payWorkingOrderIntegrated` over a `FakeStripe`-backed provider. These cases pin the reader
// ROUTING: which reader a collect drives, and which id lands on `payments.reader_id`.
describe("POST /api/pay (integrated card terminal, over HTTP)", () => {
  it("routes to the device's DEFAULT reader, captures, and STAMPS payments.reader_id", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(200);
    const outcome = (await payRes.json()) as { outcome: string; ticket?: { total: string } };
    expect(outcome.outcome).toBe("captured");
    expect(outcome.ticket?.total).toBe("1.50");
    // The payment records the reader it settled on — the default.
    expect(await readerIdOnPayment(workingOrderId)).toBe(reader.id);
  });

  it("records the card payment and its sale under the device that paid", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(200);
    const expected = [{ source: "device", device_id: deviceIdOf(deviceCookie) }];
    for (const table of ["payments", "sales"]) {
      expect(
        suite.db.all(
          sql`select source, device_id from ${sql.raw(table)} where working_order_id = ${workingOrderId}`,
        ),
      ).toEqual(expected);
    }
  });

  it("a request readerId OVERRIDES the device default, and stamps that reader", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const dflt = await seedReader({ name: "Default" });
    const other = await seedReader({ name: "Other" });
    await setDefaultReader(deviceIdOf(deviceCookie), dflt.id);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        readerId: other.id,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(200);
    expect((await payRes.json()).outcome).toBe("captured");
    // The OVERRIDE reader was charged and stamped, not the default.
    expect(await readerIdOnPayment(workingOrderId)).toBe(other.id);
  });

  it("two active readers on ONE provider: two sales route each to its OWN providerRef (not the first)", async () => {
    // The reader ref is a per-collect input, so one cached provider must drive each sale's own
    // reader. `FakeStripe` records the reader id each collect drove, in order.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const client = new FakeStripe();
    const app = new Hono();
    // One pool, one FakeStripe: the pay path calls `pool.get("stripe")` for BOTH sales and must get
    // the SAME cached provider, so the only thing distinguishing the two collects is `readerRef`.
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, client)), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const readerA = await seedReader({ name: "Reader A" });
    const readerB = await seedReader({ name: "Reader B" });

    const pay = async (readerId: string): Promise<void> => {
      const res = await app.request("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
        body: JSON.stringify({
          id: randomUUID(),
          readerId,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).outcome).toBe("captured");
    };

    await pay(readerA.id);
    await pay(readerB.id);

    // Each sale drove ITS reader's vendor ref — not readerA's twice (the bug's signature).
    expect(client.processedReaders).toEqual([readerA.providerRef, readerB.providerRef]);
  });

  it("a resolvePending sweep tick BEFORE the first sale does not break the subsequent sale (no 500)", async () => {
    // The boot sweep fetches each provider through `pool.get` and runs `resolvePending`; the pay path
    // then gets the SAME cached instance, which the sweep must leave usable.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const pool = fakePool(cfg, new FakeStripe());
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, pool), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    // The sweep tick: fetch the provider (no reader) and resolve pending — exactly what
    // `connectedCardProviderSweep` does. This caches the provider; it must NOT poison it.
    const swept = await pool.get("stripe");
    await swept.resolvePending(new Date());

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(200); // not a 500
    expect((await payRes.json()).outcome).toBe("captured");
    expect(await readerIdOnPayment(workingOrderId)).toBe(reader.id);
  });

  it("a device with no default reader and no request readerId is reader.not_found", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    // No `device_card_readers` row and no `readerId` in the body → nothing resolves.

    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: randomUUID(),
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(404);
    expect(await payRes.json()).toMatchObject({ error: { code: "reader.not_found" } });
  });

  it("a reader whose provider has NO sealed credential is reader.provider_disconnected (not a decline)", async () => {
    // The provider is NOT connected (no `connectStripe`).
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    const reader = await seedReader(); // active reader, but provider not connected
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: randomUUID(),
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(409);
    expect(await payRes.json()).toMatchObject({
      error: { code: "reader.provider_disconnected" },
    });
  });

  it("returns 200 { outcome: 'declined' } on a decline — NOT a 4xx, and files nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const client = new FakeStripe();
    client.declineNext();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, client)), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });

    expect(payRes.status).toBe(200);
    expect(await payRes.json()).toEqual({ outcome: "declined" });

    const after = await withTransaction(suite.db, async (tx) => {
      return {
        registros: await tx.select().from(registrosFacturacion),
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
      };
    });
    expect(after.registros).toHaveLength(0);
    expect(after.wo).toEqual([{ status: "open" }]);
  });

  describe("a decline whose in-flight mark cannot be cleared is still a decline, and is logged", () => {
    /** Refuse, until dropped, any write that clears order `id`'s in-flight mark. */
    function refuseRelease(id: string): () => void {
      const name = `test_refuse_release_${id.replaceAll("-", "_")}`;
      suite.db.run(
        sql.raw(`create trigger ${name} before update of payment_attempt_at on working_orders
          when old.id = '${id}' and new.payment_attempt_at is null
          begin select raise(abort, 'release refused'); end`),
      );
      return () => suite.db.run(sql.raw(`drop trigger ${name}`));
    }

    async function declinedPay(
      mount: (cfg: TillConfig, log: Logger) => Hono,
      prepare: (deviceCookie: string) => Promise<void>,
      body: Record<string, unknown>,
    ) {
      const { cfg, available, operatorId } = await setupVenue();
      const each = available.find((p) => p.pricingUnit === "each")!;
      const logged: string[] = [];
      const app = mount(cfg, (_level, event) => void logged.push(event));
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
      const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
      await prepare(deviceCookie);
      const workingOrderId = randomUUID();
      const drop = refuseRelease(workingOrderId);
      try {
        const payRes = await app.request("/api/pay", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
          body: JSON.stringify({
            id: workingOrderId,
            lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
            ...body,
          }),
        });
        expect(payRes.status).toBe(200);
        expect(await payRes.json()).toEqual({ outcome: "declined" });
      } finally {
        drop();
      }
      expect(logged).toContain("payment_attempt.release_failed");
    }

    it("through a reader", async () => {
      const client = new FakeStripe();
      client.declineNext();
      await declinedPay(
        (cfg, log) => {
          const app = new Hono();
          mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, client)), log);
          return app;
        },
        async (deviceCookie) => {
          await connectStripe();
          const reader = await seedReader();
          await setDefaultReader(deviceIdOf(deviceCookie), reader.id);
        },
        {},
      );
    });

    it("through the practice simulator", async () => {
      await declinedPay(
        (cfg, log) => {
          const app = new Hono();
          mountTillApi(
            app,
            {
              db: suite.db,
              backend,
              clock,
              cfg,
              secureCookies: false,
              venueLocale: cfg.locale,
              cardProvider: new SimulatorPaymentProvider(suite.db),
            },
            log,
          );
          return app;
        },
        () => Promise.resolve(),
        { simulationOutcome: "declined" },
      );
    });
  });

  it("demo/prepare drives the local simulator and stamps NO reader", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    // The demo/prepare shape: `deps.cardProvider` is the local simulator (no pool, no reader row).
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: suite.db,
        backend,
        clock,
        cfg,
        secureCookies: false,
        venueLocale: cfg.locale,
        cardProvider: new SimulatorPaymentProvider(suite.db),
      },
      noopLog,
    );
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        simulationOutcome: "captured",
      }),
    });

    expect(payRes.status).toBe(200);
    expect((await payRes.json()).outcome).toBe("captured");
    // A practice sale touches no real reader, so `payments.reader_id` stays NULL.
    expect(await readerIdOnPayment(workingOrderId)).toBeNull();
  });

  it("still 400s an empty walk-up basket — a genuine fault, mapped through run, not a payment outcome", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({ id: randomUUID(), lines: [] }),
    });

    expect(payRes.status).toBe(400);
    expect(await payRes.json()).toMatchObject({ error: { code: "sale.empty_basket" } });
  });
});

// GET /api/till: the paying device's default reader's provider, mapped to the till's union, and the
// `activeReaders` list the reader picker reads.
describe("GET /api/till (per-device card provider, over HTTP)", () => {
  it("maps the device's default reader provider to the till union and lists active readers", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const reader = await seedReader(); // provider "stripe"
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cardProvider: string;
      defaultReaderId: string;
      activeReaders: { id: string; name: string; provider: string }[];
    };
    // "stripe" → "stripe_terminal" (the till's closed union), never the raw seat id.
    expect(body.cardProvider).toBe("stripe_terminal");
    // `cardProvider` names only the provider TYPE, so the default reader is named by id.
    expect(body.defaultReaderId).toBe(reader.id);
    expect(body.activeReaders).toEqual([
      { id: reader.id, name: "Front counter", provider: "stripe_terminal" },
    ]);
  });

  it("a device with no default reader gets cardProvider 'none'", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());

    const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cardProvider).toBe("none");
    expect(body.defaultReaderId).toBeUndefined();
  });

  it("a demo/prepare till surfaces the simulator regardless of any reader", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: suite.db,
        backend,
        clock,
        cfg,
        secureCookies: false,
        venueLocale: cfg.locale,
        cardProvider: new SimulatorPaymentProvider(suite.db),
      },
      noopLog,
    );
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Practice mode wins over any configured reader.
    expect(body.cardProvider).toBe("simulator");
    // The real reader's id stays hidden too — there is no reader behind the local simulator.
    expect(body.defaultReaderId).toBeUndefined();
  });
});

// Drive place, prep, advance and collect through the same venue.
// In ticket_then_pay mode, collect files the sale through the real fiscal backend.
describe("place → station queue → per-line advance → collect (KDS-1 ticket model, over HTTP)", () => {
  it("Mode T: place files no fiscal doc; the prep queue tracks it; collect files the sale at collect", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // Flip to `ticket_then_pay` (Mode T) in both the DB column and the in-memory cfg.
    await suite.db.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);

    // 1. Log in.
    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    // 2. Park then PLACE: 2 × 1.50 = 3.00. Mode T files NO fiscal doc at placing.
    const workingOrderId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        label: "Mesa 9",
      }),
    });
    expect(park.status).toBe(200);
    const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${deviceCookie}` },
    });
    expect(placed.status).toBe(200);
    expect(await placed.json()).toEqual({ id: workingOrderId, status: "placed" });

    const noSaleYet = await withTransaction(suite.db, async (tx) => {
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(noSaleYet).toEqual([]); // Mode T: nothing filed at placing

    // 3. The per-station kitchen queue shows the fired line `queued` — placing fires the order's lines
    //    to the kitchen (KDS-1, `placeOrder` → `fireLines`), routed to the venue's DEFAULT station
    //    (provisioning seeds one). The display picker reads its stations, then that station's queue,
    //    grouped by order.
    const stations = (await (
      await app.request("/api/stations", { headers: { cookie } })
    ).json()) as { id: string; isDefault: boolean }[];
    const defaultStation = stations.find((s) => s.isDefault)!;
    const queueUrl = `/api/stations/${defaultStation.id}/queue`;
    const queue1 = await app.request(queueUrl, { headers: { cookie } });
    expect(queue1.status).toBe(200);
    const groups1 = ((await queue1.json()) as { items: unknown }).items as {
      orderId: string;
      orderNumber: number;
      label: string | null;
      queuedAt: string;
      status: string;
      thresholds: {
        warmAfterMinutes: number;
        overdueAfterMinutes: number;
        forgottenAfterMinutes: number;
      };
      items: {
        id: string;
        workingOrderLineId: string;
        state: string;
        name: string;
        quantity: string;
        course: { id: string; name: string; displayOrder: number } | null;
        firedAt: string | null;
        queuedAt: string;
        band: string;
      }[];
    }[];
    expect(groups1).toEqual([
      {
        orderId: workingOrderId,
        orderNumber: expect.any(Number),
        label: "Mesa 9",
        queuedAt: expect.any(String),
        // A fired-at-PLACING order (Modes I/T) is on the queue as `placed`; the station queue offers
        // Collect on a settled order alone. This one is paid by the fiscal
        // `POST /api/working-orders/:id/collect` below.
        status: "placed",
        // KDS order-timing alerts (design §3/§6/§11): the venue's DEFAULT station carries the schema's
        // default thresholds — provisioning never overrides them.
        thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        items: [
          {
            id: expect.any(String),
            workingOrderLineId: expect.any(String),
            state: "queued",
            // The kitchen name, falling back to the staff name because this product carries none.
            name: "Agua mineral",
            quantity: "2.000",
            unitName: {
              ca: "u",
              en: "ea",
              es: "ud",
              eu: "u",
              gl: "u",
            },
            unitPrecision: 0,
            soldInEach: true,
            // No course, so the item fires immediately: a null course is treated as earliest.
            course: null,
            firedAt: expect.any(String),
            note: null,
            // No extras picked on this line → an empty modifier sub-item list, and no options list
            // answered → an empty frozen-answer list.
            modifiers: [],
            optionSnapshots: [],
            // Just fired — nowhere near the default station's 5-minute warm threshold.
            queuedAt: expect.any(String),
            band: "fresh",
            // This dish's own allergens are unreviewed, so the profile is empty and flagged pending.
            asServed: { allergens: {}, pending: true },
            // No recipe, so the diet reads "unknown": an unreviewed plate asserts no positive claim.
            asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
          },
        ],
      },
    ]);

    // 4. Advance the ticket item over HTTP, per line: queued → preparing → ready.
    const itemId = groups1[0]!.items[0]!.id;
    for (const to of ["preparing", "ready"]) {
      const advance = await app.request(`/api/ticket-items/${itemId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });
      expect(advance.status).toBe(200);
    }
    // A `ready` line stays on the queue until its order is handed over.
    const groupsReady = (
      (await (await app.request(queueUrl, { headers: { cookie } })).json()) as { items: unknown }
    ).items as {
      orderId: string;
      items: { state: string }[];
    }[];
    expect(groupsReady.find((g) => g.orderId === workingOrderId)!.items[0]!.state).toBe("ready");

    // 5. COLLECT: Mode T files `recordSale` IMMEDIATE here, placed → settled — the genuine chained
    // fiscal write this suite exists to prove.
    const collect = await app.request(`/api/working-orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
    });
    expect(collect.status).toBe(200);
    const ticket = await collect.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(ticket.total).toBe("3.00");
    expect(ticket.tender).toEqual({ method: "cash", change: "2.00" });
    expect(ticket.qr.length).toBeGreaterThan(0); // a genuine fresh filing carries the AEAT QR

    const after = await withTransaction(suite.db, async (tx) => {
      return {
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
        registros: await tx.select().from(registrosFacturacion),
      };
    });
    expect(after.wo).toEqual([{ status: "settled" }]);
    expect(after.registros).toHaveLength(1); // exactly one chained record, filed at collect

    // 6. Collect records the payment, not the handover, so the paid order stays on the station's
    //    display.
    const queueAfterCollect = await app.request(queueUrl, { headers: { cookie } });
    const groupsAfterCollect = ((await queueAfterCollect.json()) as { items: unknown }).items as {
      orderId: string;
      status: string;
    }[];
    expect(groupsAfterCollect.map(({ orderId, status }) => ({ orderId, status }))).toEqual([
      { orderId: workingOrderId, status: "settled" },
    ]);
  });
});

// Mode P fires preparation in the sale transaction. The retained `sendToPrep` endpoint therefore
// rejects a second fire, while still refusing an unpaid order before any write.
describe("POST /api/working-orders/:id/prep — Mode P's send-to-prep route", () => {
  it("finds a prepay sale already fired and refuses a still-open parked order", async () => {
    const { cfg, available, operatorId } = await setupVenue(); // default mode: prepay
    const each = available.find((p) => p.pricingUnit === "each")!;

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);

    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    // A genuine Mode-P walk-up: `POST /api/sales` settles it immediately (open → settled) — no
    // `place` step at all, since Mode P never places.
    const workingOrderId = randomUUID();
    const sale = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(sale.status).toBe(200);

    // Preparation was committed with the sale, so an explicit send is a duplicate.
    const sent = await app.request(`/api/working-orders/${workingOrderId}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe(409);
    expect(await sent.json()).toMatchObject({
      error: { code: "ticket.already_fired", params: { workingOrderId } },
    });

    // It appears on that station's kitchen queue, queued.
    const stations = (await (
      await app.request("/api/stations", { headers: { cookie } })
    ).json()) as { id: string; isDefault: boolean }[];
    const defaultStation = stations.find((s) => s.isDefault)!;
    const queue = await app.request(`/api/stations/${defaultStation.id}/queue`, {
      headers: { cookie },
    });
    expect(((await queue.json()) as { items: unknown }).items).toEqual([
      expect.objectContaining({
        orderId: workingOrderId,
        items: [expect.objectContaining({ state: "queued" })],
      }),
    ]);

    // A SEPARATE, still-OPEN (parked, unpaid) order is refused — the other half of the guard, over the
    // real route rather than the library function directly.
    const openId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: openId, lines: [{ menuItemId: each.menuItemId, quantity: "1" }] }),
    });
    expect(park.status).toBe(200);
    const refused = await app.request(`/api/working-orders/${openId}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: "working_order.not_settled", params: { workingOrderId: openId } },
    });
    // Refused before any write — never appears on the kitchen queue.
    const queueAfterRefusal = (
      (await (
        await app.request(`/api/stations/${defaultStation.id}/queue`, { headers: { cookie } })
      ).json()) as { items: { orderId: string }[] }
    ).items;
    expect(queueAfterRefusal.find((g) => g.orderId === openId)).toBeUndefined();
  });
});

// The Mode-P counter handover. A settled walk-up fired to the kitchen and walked to `ready` is handed
// over via POST /api/orders/:id/collect — the NON-FISCAL marker that stamps `collected_at` and drops
// the order off the station display. It needs a genuine fiscal settle, which the hermetic suite's
// stub backend cannot make.
describe("POST /api/orders/:id/collect — Mode P's counter handover", () => {
  it("hands over a fired, ready order: 200, collected_at stamped, off the station queue; a still-OPEN order is refused working_order.not_settled", async () => {
    const { cfg, available, operatorId } = await setupVenue(); // default mode: prepay
    const each = available.find((p) => p.pricingUnit === "each")!;

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    // Walk-up settle and preparation fire happen in one transaction.
    const workingOrderId = randomUUID();
    await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    const stations = (await (
      await app.request("/api/stations", { headers: { cookie } })
    ).json()) as { id: string; isDefault: boolean }[];
    const station = stations.find((s) => s.isDefault)!;
    const queueUrl = `/api/stations/${station.id}/queue`;

    // The group carries the order's `status` — the till reads COLLECTABLE off it (settled = Mode-P pickup).
    const queued = (
      (await (await app.request(queueUrl, { headers: { cookie } })).json()) as { items: unknown }
    ).items as {
      orderId: string;
      status: string;
      items: { id: string }[];
    }[];
    expect(queued[0]!.status).toBe("settled");
    const itemId = queued[0]!.items[0]!.id;

    // Walk it queued → preparing → ready over the per-line advance route. A ready-but-uncollected order
    // STAYS on the queue.
    for (const to of ["preparing", "ready"] as const) {
      const bump = await app.request(`/api/ticket-items/${itemId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });
      expect(bump.status).toBe(200);
    }
    const readyQueue = (
      (await (await app.request(queueUrl, { headers: { cookie } })).json()) as { items: unknown }
    ).items as {
      orderId: string;
    }[];
    expect(readyQueue.map((g) => g.orderId)).toEqual([workingOrderId]);

    // Hand it over — the non-fiscal collect route (an empty body; it needs only the id).
    const collect = await app.request(`/api/orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(collect.status).toBe(200);

    // collected_at is stamped (direct witness) AND the order is GONE from the station queue.
    const [wo] = await withTransaction(suite.db, async (tx) => {
      return tx
        .select({
          // `.mapWith(Boolean)` because `sql<boolean>` is a TypeScript cast and not a read mapping:
          // without it this expression arrives as the number 1, which `toEqual` separates from
          // `true`.
          collected: sql`collected_at is not null`.mapWith(Boolean),
          status: workingOrders.status,
        })
        .from(workingOrders)
        .where(eq(workingOrders.id, workingOrderId));
    });
    expect(wo).toEqual({ collected: true, status: "settled" }); // fiscal state untouched; only the marker moved
    const afterCollect = await app.request(queueUrl, { headers: { cookie } });
    expect(((await afterCollect.json()) as { items: unknown }).items).toEqual([]);

    // A still-OPEN (parked, unpaid) order is refused — not settled, so there is no handover to mark.
    const openId = randomUUID();
    await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: openId, lines: [{ menuItemId: each.menuItemId, quantity: "1" }] }),
    });
    const refused = await app.request(`/api/orders/${openId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: "working_order.not_settled", params: { workingOrderId: openId } },
    });
  });
});

describe("handheld sales and device capability gates", () => {
  /** Enrol a handheld device and return its `waitron_device=<id>.<token>` cookie. Its default
   * profile takes cash and nothing else. */
  async function enrolHandheldCookie(
    cfg: TillConfig,
    capabilities: string[] = ["take-cash"],
  ): Promise<string> {
    const profileId = await seedProfileFF("phone-portrait", capabilities);
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: `Waiter phone ${randomUUID()}`,
      profileId,
    });
    return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
  }

  /** Log in on `deviceCookie`'s device and return just the `name=value` session cookie pair, to
   * combine with that device cookie in one `Cookie` header. Without one it presents a throwaway
   * `till` device. */
  async function loginOperator(
    app: Hono,
    cfg: TillConfig,
    operatorId: string,
    deviceCookie?: string,
  ): Promise<string> {
    const loginDeviceCookie = deviceCookie ?? (await enrolTillCookie(cfg));
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginDeviceCookie },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    return login.headers.get("set-cookie")!.split(";")[0]!;
  }

  it.each(["receipt", "reprint", "payment-slip"])(
    "requires print-receipt of the session's device for handheld %s requests, with or without its device cookie",
    async (action) => {
      const { cfg, available, operatorId } = await setupVenue();
      const each = available.find((p) => p.pricingUnit === "each")!;
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const blockedDevice = await enrolHandheldCookie(cfg);
      const allowedDevice = await enrolHandheldCookie(cfg, ["print-receipt"]);
      const blockedSession = await loginOperator(app, cfg, operatorId, blockedDevice);
      const allowedSession = await loginOperator(app, cfg, operatorId, allowedDevice);
      const workingOrderId = randomUUID();
      const sale = await app.request("/api/sales", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${blockedSession}; ${blockedDevice}`,
        },
        body: JSON.stringify({
          workingOrderId,
          lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
        }),
      });
      expect(sale.status).toBe(200);
      const route = `/api/sales/${workingOrderId}/${action}`;
      const refused = await app.request(route, {
        method: "POST",
        headers: { cookie: `${blockedSession}; ${blockedDevice}` },
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "device.forbidden_action" } });
      for (const cookie of [`${allowedSession}; ${allowedDevice}`, allowedSession]) {
        const accepted = await app.request(route, { method: "POST", headers: { cookie } });
        expect(accepted.status).toBe(200);
      }
    },
  );

  it("allows a handheld CASH sale (200) and files exactly one chained registro under the node/SIF — parity with a counter cash sale", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);
    // The handheld's own receipt printer has a drawer; only its profile keeps that drawer shut.
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Counter",
        transport: "network_tcp",
        host: "192.0.2.1",
        hasCashDrawer: true,
      });
      await tx.execute(
        sql`update devices set receipt_printer_id = ${printer.id} where id = ${deviceIdOf(deviceCookie)}`,
      );
      await tx.execute(
        sql`update locations set receipt_print_mode = 'auto' where id = ${cfg.locationId}`,
      );
    });

    // A handheld may settle a cash sale: the fiscal chain is keyed by the submitting node (`nodeId`),
    // not the device, so a handheld files under its node's SIF exactly like a till.
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(200);
    const opens = await suite.db.execute(sql`select id from drawer_opens `);
    expect(opens.rows).toHaveLength(0);

    const ticket = await res.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/); // NumSerieFactura-shaped, e.g. "A/1"

    // Exactly one chained record, the same chain-opening shape a counter cash sale files, under
    // `cfg.nodeId`: the SIF is the node, not the device.
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(1);
    const [only] = registros;
    expect(only!.nodeId).toBe(cfg.nodeId);
    expect(only!.secuencia).toBe(1);
    expect(only!.primerRegistro).toBe(true);
    expect(only!.anteriorHuella).toBeNull();
    expect(only!.huella).toMatch(/^[0-9A-F]{64}$/);
    expect(only!.entorno).toBe(deploymentEnvironment(process.env));
  });

  it("allows a handheld MANUAL CARD sale (200) and files one chained registro under the node/SIF plus one captured payment — parity with a counter card sale", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);

    // The `card` tender on `POST /api/sales` is charged on a separate bank terminal the POS never
    // talks to, so it files the same chained record as cash plus one captured `payments` row.
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "card", amount: "3.00" },
      }),
    });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/); // NumSerieFactura-shaped, e.g. "A/1"

    // Exactly one chained record, the same chain-opening shape as the handheld cash case above.
    const registros = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(1);
    const [only] = registros;
    expect(only!.nodeId).toBe(cfg.nodeId);
    expect(only!.secuencia).toBe(1);
    expect(only!.primerRegistro).toBe(true);
    expect(only!.anteriorHuella).toBeNull();
    expect(only!.huella).toMatch(/^[0-9A-F]{64}$/);
    expect(only!.entorno).toBe(deploymentEnvironment(process.env));

    // The manual-card side effect a cash sale does NOT have: exactly one CAPTURED `payments` row for the
    // sale, under the sentinel `manual` provider with a freshly minted `manual-…` ref — no reader, no
    // network call (`recordManualCardPayment` commits inline in the sale transaction). Every column
    // read here is text, so the raw read needs no drizzle mapper.
    const paymentRows = await suite.db.execute<{
      provider: string;
      state: string;
      payment_ref: string;
    }>(sql`select provider, state, payment_ref from payments`);
    expect(paymentRows.rows).toHaveLength(1);
    expect(paymentRows.rows[0]!.provider).toBe(MANUAL_PROVIDER);
    expect(paymentRows.rows[0]!.state).toBe("captured");
    expect(paymentRows.rows[0]!.payment_ref).toMatch(/^manual-/);
  });

  it("allows a sale from an enrolled TILL device (not a handheld) — operator session + till-device cookie — 200", async () => {
    // The counterpart to the handheld cases: a `till`-kind device is not refused.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(200);
  });

  // Each device capability gate runs after requireSession and before provider, id, or printer checks.
  // A handheld profile without the corresponding capability is refused regardless of card
  // config, order existence, or printer state. Plain `apiDeps(cfg)` (no card provider) suffices for the
  // pay case precisely because the guard short-circuits ahead of the provider check.
  it.each([
    ["POST /api/pay", "/api/pay", { id: randomUUID() }],
    ["POST /api/sales/:id/reprint", `/api/sales/${randomUUID()}/reprint`, {}],
    ["POST /api/drawer/open", "/api/drawer/open", {}],
  ])(
    "refuses %s from a handheld with 403 device.forbidden_action even with a valid operator session",
    async (_label, path, body) => {
      const { cfg, operatorId } = await setupVenue();
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);

      const deviceCookie = await enrolHandheldCookie(cfg);
      const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);

      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("device.forbidden_action");
    },
  );

  // The firewall on `/api/pay` is capability-based: a device is refused unless its profile declares
  // `integrated-card-payment`, whatever its kind.
  it("refuses /api/pay from a device whose assigned PROFILE LACKS integrated-card-payment (403 device.forbidden_action)", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // Author a capability-less handheld device profile and enrol a device bound to it.
    const [prof] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `Waiter phone ${randomUUID()}`,
        formFactor: "phone-portrait",
        capabilities: [],
      })
      .returning({ id: deviceProfiles.id });
    const deviceProfileId = prof!.id;
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: `Waiter phone ${randomUUID()}`,
      profileId: deviceProfileId,
    });
    const deviceCookie = `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
    const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({ id: randomUUID() }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("device.forbidden_action");
  });

  /** Park a two-item order with `cookie` and return its id. */
  async function parkOrder(app: Hono, cookie: string, menuItemId: string): Promise<string> {
    const id = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id, lines: [{ menuItemId, quantity: "2" }] }),
    });
    expect(park.status).toBe(200);
    return id;
  }

  /** The device the sale filed for `workingOrderId` names. */
  async function saleDeviceOf(workingOrderId: string): Promise<string | null> {
    const [sale] = await withTransaction(suite.db, (tx) =>
      tx
        .select({ deviceId: sales.deviceId })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId)),
    );
    return sale!.deviceId;
  }

  async function amendmentsOf(workingOrderId: string) {
    return withTransaction(suite.db, (tx) =>
      tx
        .select({
          kind: orderAmendments.kind,
          actorId: orderAmendments.actorId,
          reason: orderAmendments.reason,
        })
        .from(orderAmendments)
        .where(eq(orderAmendments.workingOrderId, workingOrderId))
        .orderBy(orderAmendments.sequenceNo),
    );
  }

  async function statusOf(workingOrderId: string): Promise<string> {
    const [order] = await withTransaction(suite.db, (tx) =>
      tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, workingOrderId)),
    );
    return order!.status;
  }

  it("a handheld places a Mode-I order for an operator holding only the payment permission, filing one deferred invoice under itself, as a till does", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    await suite.db.execute(
      sql`update locations set order_flow = 'invoice_first' where id = ${cfg.locationId}`,
    );
    await suite.db.execute(sql`
      update departments set default_service_mode = 'invoice_first'
      where location_id = ${cfg.locationId}`);
    const modeCfg: TillConfig = { ...cfg, orderFlow: "invoice_first" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);
    expect(permissionsForRole("staff")).toEqual(["sale.take_payment"]);

    const handheldCookie = await enrolHandheldCookie(cfg);
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);
    const byHandheld = await parkOrder(app, sessionPair, each.menuItemId);
    const byTill = await parkOrder(app, sessionPair, each.menuItemId);

    for (const [id, deviceCookie] of [
      [byHandheld, handheldCookie],
      [byTill, tillDeviceCookie],
    ] as const) {
      const placed = await app.request(`/api/working-orders/${id}/place`, {
        method: "POST",
        headers: {
          cookie: `${await loginOperator(app, cfg, operatorId, deviceCookie)}; ${deviceCookie}`,
        },
      });
      expect(placed.status).toBe(200);
      expect(await placed.json()).toMatchObject({
        id,
        status: "placed",
        invoiceNumber: expect.stringMatching(/^A\/\d+$/),
      });
      expect(await statusOf(id)).toBe("placed");
      expect(await amendmentsOf(id)).toEqual([
        { kind: "order_placed", actorId: operatorId, reason: null },
      ]);
    }

    const registros = await withTransaction(suite.db, (tx) =>
      tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia),
    );
    expect(registros.map((r) => [r.nodeId, r.secuencia])).toEqual([
      [cfg.nodeId, 1],
      [cfg.nodeId, 2],
    ]);
    expect(await saleDeviceOf(byHandheld)).toBe(deviceIdOf(handheldCookie));
    expect(await saleDeviceOf(byTill)).toBe(deviceIdOf(tillDeviceCookie));
  });

  it("a handheld collects a placed Mode-T order in cash for an operator holding only the payment permission, settling it and filing one record under itself, as a till does", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    await suite.db.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);
    expect(permissionsForRole("staff")).toEqual(["sale.take_payment"]);

    const handheldCookie = await enrolHandheldCookie(cfg);
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);
    const byHandheld = await parkOrder(app, sessionPair, each.menuItemId);
    const byTill = await parkOrder(app, sessionPair, each.menuItemId);

    for (const [id, deviceCookie] of [
      [byHandheld, handheldCookie],
      [byTill, tillDeviceCookie],
    ] as const) {
      const both = `${await loginOperator(app, cfg, operatorId, deviceCookie)}; ${deviceCookie}`;
      const placed = await app.request(`/api/working-orders/${id}/place`, {
        method: "POST",
        headers: { cookie: both },
      });
      expect(placed.status).toBe(200);
      const collect = await app.request(`/api/working-orders/${id}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: both },
        body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
      });
      expect(collect.status).toBe(200);
      expect((await collect.json()).invoiceNumber).toMatch(/^A\/\d+$/);
      expect(await statusOf(id)).toBe("settled");
    }

    const registros = await withTransaction(suite.db, (tx) =>
      tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia),
    );
    expect(registros.map((r) => [r.nodeId, r.secuencia])).toEqual([
      [cfg.nodeId, 1],
      [cfg.nodeId, 2],
    ]);
    expect(await saleDeviceOf(byHandheld)).toBe(deviceIdOf(handheldCookie));
    expect(await saleDeviceOf(byTill)).toBe(deviceIdOf(tillDeviceCookie));
  });

  describe("a device takes cash only when its profile says so", () => {
    async function saleCount(): Promise<number> {
      const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from sales`);
      return Number(rows.rows[0]!.n);
    }

    async function postSale(app: Hono, cookie: string, menuItemId: string, method: string) {
      return app.request("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          lines: [{ menuItemId, quantity: "2" }],
          tender: { method, amount: "5.00" },
        }),
      });
    }

    it("refuses a cash sale from a device whose profile lacks take-cash, filing nothing, and takes its card sale", async () => {
      const { cfg, available, operatorId } = await setupVenue();
      const each = available.find((p) => p.pricingUnit === "each")!;
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const deviceCookie = await enrolTillCookie(cfg, await seedProfileFF("till"));
      const both = `${await loginOperator(app, cfg, operatorId, deviceCookie)}; ${deviceCookie}`;

      const before = await saleCount();
      const refused = await postSale(app, both, each.menuItemId, "cash");
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "device.cash_not_allowed" } });
      expect(await saleCount()).toBe(before);

      const card = await postSale(app, both, each.menuItemId, "card");
      expect(card.status).toBe(200);
      expect(await saleCount()).toBe(before + 1);
    });

    it("takes a cash sale from a handheld whose profile has take-cash", async () => {
      const { cfg, available, operatorId } = await setupVenue();
      const each = available.find((p) => p.pricingUnit === "each")!;
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const deviceCookie = await enrolHandheldCookie(cfg, ["take-cash"]);
      const both = `${await loginOperator(app, cfg, operatorId, deviceCookie)}; ${deviceCookie}`;

      const before = await saleCount();
      const res = await postSale(app, both, each.menuItemId, "cash");
      expect(res.status).toBe(200);
      expect(await saleCount()).toBe(before + 1);
    });

    it("refuses a cash collect from a device whose profile lacks take-cash, leaving the order placed", async () => {
      const { cfg, available, operatorId } = await setupVenue();
      await suite.db.execute(
        sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
      );
      const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
      const each = available.find((p) => p.pricingUnit === "each")!;
      const app = new Hono();
      mountTillApi(app, apiDeps(modeCfg), noopLog);
      const deviceCookie = await enrolHandheldCookie(cfg, []);
      const sessionPair = await loginOperator(app, cfg, operatorId, deviceCookie);
      const both = `${sessionPair}; ${deviceCookie}`;
      const id = await parkOrder(app, sessionPair, each.menuItemId);
      const placed = await app.request(`/api/working-orders/${id}/place`, {
        method: "POST",
        headers: { cookie: both },
      });
      expect(placed.status).toBe(200);

      const collect = await app.request(`/api/working-orders/${id}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: both },
        body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
      });
      expect(collect.status).toBe(403);
      expect(await collect.json()).toMatchObject({ error: { code: "device.cash_not_allowed" } });
      expect(await statusOf(id)).toBe("placed");
    });
  });

  it("a handheld cancels a placed order for an operator holding only the payment permission, appending the reasoned amendment, as a till does", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    expect(permissionsForRole("staff")).toEqual(["sale.take_payment"]);

    const handheldCookie = await enrolHandheldCookie(cfg);
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);

    for (const deviceCookie of [handheldCookie, tillDeviceCookie]) {
      const both = `${await loginOperator(app, cfg, operatorId, deviceCookie)}; ${deviceCookie}`;
      const id = await parkOrder(app, sessionPair, each.menuItemId);
      const placed = await app.request(`/api/working-orders/${id}/place`, {
        method: "POST",
        headers: { cookie: both },
      });
      expect(placed.status).toBe(200);
      const cancelled = await app.request(`/api/working-orders/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: both },
        body: JSON.stringify({ reason: "customer left" }),
      });
      expect(cancelled.status).toBe(200);
      expect(await statusOf(id)).toBe("abandoned");
      expect(await amendmentsOf(id)).toEqual([
        { kind: "order_placed", actorId: operatorId, reason: null },
        { kind: "order_cancelled", actorId: operatorId, reason: "customer left" },
      ]);
    }
  });

  // Place, and cancel of an order with no invoice, check no permission; collect's
  // `sale.take_payment` and an invoiced cancel's `sale.rectify` are checked only once the session
  // is found, so the refusal tested here is the missing session, which a handheld meets with the
  // same answer as a till.
  it.each(["place", "collect", "cancel"] as const)(
    "refuses %s without an operator session with the same answer on a handheld as on a till",
    async (action) => {
      const { cfg } = await setupVenue();
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const answers = [];
      for (const deviceCookie of [await enrolHandheldCookie(cfg), await enrolTillCookie(cfg)]) {
        const res = await app.request(`/api/working-orders/${randomUUID()}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: deviceCookie },
          body: JSON.stringify({ tender: { method: "cash", amount: "5.00" }, reason: "x" }),
        });
        answers.push({ status: res.status, code: (await res.json()).error.code });
      }
      expect(answers[0]).toEqual({ status: 401, code: "session.required" });
      expect(answers[1]).toEqual(answers[0]);
    },
  );
});

it("files an extras pick and an options answer through cash checkout and reprints their saved facts", async () => {
  const { cfg, catalogueId, available, operatorId } = await setupVenue();
  const product = available.find((item) => item.pricingUnit === "each")!;
  const { extraListId, quesoId, optionListId, labelId } = await withTransaction(
    suite.db,
    async (tx) => {
      // The extra is a PRODUCT of its own, taxed at its OWN class — `reduced`, where the dish is
      // `general`, so the filed desglose has to carry two bands.
      const queso = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Queso",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "reduced",
      });
      const extras = await createExtraList(
        tx,
        {
          name: "Extras",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          // Two of one product, which is what this sale picks: `maxPicks` counts the quantities.
          maxPicks: 2,
          active: true,
          items: [{ productId: queso.id, maxQuantity: 2, preselected: false, price: "0.35" }],
        },
        LOCALE,
      );
      const options = await createOptionList(
        tx,
        {
          name: "Preparación",
          customerName: null,
          kitchenName: null,
          defaultLabelId: null,
          active: true,
          labels: [{ name: "Frío", customerName: null, kitchenName: null, available: true }],
        },
        LOCALE,
      );
      await writeProductModifiers(tx, product.id, [
        { kind: "extras", id: extras.id },
        { kind: "options", id: options.id },
      ]);

      await publishWorkingMenu(tx, catalogueId);
      return {
        extraListId: extras.id,
        quesoId: queso.id,
        optionListId: options.id,
        labelId: options.labels[0]!.id,
      };
    },
  );
  const extras = [{ listId: extraListId, picks: [{ productId: quesoId, quantity: 2 }] }];
  const options = [{ listId: optionListId, labelId }];
  const app = new Hono();
  mountTillApi(app, apiDeps(cfg), noopLog);
  const profileId = await seedProfileFF("till", ["print-receipt", "take-cash"]);
  const deviceCookie = await enrolTillCookie(cfg, profileId);
  const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
  const headers = { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` };
  const printerId = await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, cfg, {
      name: "Modifier receipts",
      transport: "cloud_poll",
      pollId: `modifiers-${randomUUID()}`,
    });
    await tx.execute(sql`update devices set receipt_printer_id=${printer.id} `);
    await tx.execute(
      sql`update locations set receipt_print_mode='never' where id=${cfg.locationId}`,
    );
    return printer.id;
  });
  const workingOrderId = randomUUID();
  const request = {
    workingOrderId,
    lines: [{ menuItemId: product.menuItemId, quantity: "2", extras, options }],
    tender: { method: "cash", amount: "10.00" },
  };
  const response = await app.request("/api/sales", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const ticket = (await response.json()) as TillSaleResult;
  expect(ticket.total).toBe("4.40");
  expect(ticket.tender).toEqual({ method: "cash", change: "5.60" });
  // The dish's line carries the answer it froze; the extras pick is a child line of its own and
  // answers nothing. The default content language keys the staff-name maps, so it is read back from
  // the venue rather than assumed.
  const { defaultLanguage } = await withTransaction(suite.db, async (tx) => {
    return readContentLanguages(tx, cfg.locale);
  });
  const frozenAnswer = {
    listName: { [defaultLanguage]: "Preparación" },
    listCustomerName: null,
    listKitchenName: null,
    labelName: { [defaultLanguage]: "Frío" },
    labelCustomerName: null,
    labelKitchenName: null,
  };
  expect(ticket.lines).toEqual([
    {
      descriptions: { [LOCALE]: "Agua mineral" },
      quantity: "2",
      gross: "3.00",
      parentLineNo: null,
      optionSnapshots: [frozenAnswer],
      unitName: { ca: "u", en: "ea", es: "ud", eu: "u", gl: "u" },
      unitPrecision: 0,
    },
    {
      descriptions: { [LOCALE]: "Queso" },
      quantity: "4",
      gross: "1.40",
      parentLineNo: 1,
      optionSnapshots: [],
      unitName: null,
      unitPrecision: null,
    },
  ]);
  expect(ticket.vatBreakdown).toEqual([
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "1.27", tax: "0.13" },
  ]);
  const stored = await withTransaction(suite.db, async (tx) => {
    // `quantity` and `vat_rate` are whole numbers at their own scales — thousandths and basis
    // points — read as text so the assertion pins the stored counts. `unit_name` comes off the
    // table definition rather than a raw `select` for the reason the weighed-line read above
    // states: a raw read of a `json` column returns the stored TEXT.
    const rows = await tx
      .select({
        quantity: sql<string>`cast(${saleLines.quantity} as text)`,
        vat_rate: sql<string>`cast(${saleLines.vatRate} as text)`,
        unit_name: saleLines.unitName,
        unit_precision: saleLines.unitPrecision,
      })
      .from(saleLines)
      .orderBy(saleLines.lineNo);
    const records = await tx.select().from(registrosFacturacion);
    return { rows, records };
  });
  expect(stored.rows).toEqual([
    {
      quantity: "2000",
      vat_rate: "2100",
      unit_name: { ca: "u", en: "ea", es: "ud", eu: "u", gl: "u" },
      unit_precision: 0,
    },
    {
      quantity: "4000",
      vat_rate: "1000",
      unit_name: null,
      unit_precision: null,
    },
  ]);
  expect(stored.records).toHaveLength(1);
  expect(stored.records[0]!.huella).toMatch(/^[0-9A-F]{64}$/);
  // The options answer IS frozen, on the DISH's working-order line, with the list's and the label's
  // names copied by value; the child line answers nothing of its own.
  const frozen = await withTransaction(suite.db, async (tx) => {
    return tx
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, workingOrderId))
      .orderBy(workingOrderLines.lineNo);
  });
  expect(frozen).toEqual([{ optionSnapshots: [frozenAnswer] }, { optionSnapshots: [] }]);
  // Rename the extra's product AFTER the sale: what a replay and a reprint read must be the names the
  // sale froze, never the catalogue's current ones.
  await withTransaction(suite.db, async (tx) => {
    await updateProduct(tx, quesoId, { name: "Manchego" });
  });
  const replay = await app.request("/api/sales", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  expect(replay.status).toBe(200);
  const replayTicket = (await replay.json()) as TillSaleResult;
  expect(replayTicket.lines).toEqual(ticket.lines);
  expect(replayTicket.total).toBe("4.40");
  expect(replayTicket.invoiceNumber).toBe(ticket.invoiceNumber);
  const reprint = await app.request(`/api/sales/${workingOrderId}/reprint`, {
    method: "POST",
    headers,
  });
  expect(reprint.status, await reprint.clone().text()).toBe(200);
  const printed = await withTransaction(suite.db, async (tx) => {
    return tx.execute<{ payload: Buffer }>(
      sql`select payload from print_jobs where printer_id=${printerId} and kind='document'`,
    );
  });
  expect(printed.rows).toHaveLength(1);
  const text = decodeTicket(new Uint8Array(printed.rows[0]!.payload));
  // The child line's frozen name proves immutability directly: the extra's original "Queso" appears
  // and the renamed "Manchego" does not.
  expect(text).toContain("Queso");
  expect(text).not.toContain("Manchego");
  // The dish's options answer reached the paper. This list and label stored no customer text, so the
  // staff names are what a diner reads.
  expect(text).toContain("Preparación: Frío");
  expect(text).toContain("DUPLICADO");
  const recordCount = await withTransaction(suite.db, async (tx) => {
    return tx.select({ id: registrosFacturacion.id }).from(registrosFacturacion);
  });
  expect(recordCount).toHaveLength(1);
});

describe("card readers the till cannot drive, and readers named by id", () => {
  it("GET /api/till maps a SumUp default reader and leaves out a reader whose provider it does not know", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const sumup = await seedReader({ provider: "sumup", name: "SumUp Solo" });
    await seedReader({ provider: "carrier_pigeon", name: "Unknown" });
    await setDefaultReader(deviceIdOf(deviceCookie), sumup.id);

    const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cardProvider).toBe("sumup_cloud");
    expect(body.defaultReaderId).toBe(sumup.id);
    expect(body.activeReaders).toEqual([
      { id: sumup.id, name: "SumUp Solo", provider: "sumup_cloud" },
    ]);
  });

  it("GET /api/till reports no card provider for a device whose default reader's provider is unknown", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const unknown = await seedReader({ provider: "carrier_pigeon", name: "Unknown" });
    await setDefaultReader(deviceIdOf(deviceCookie), unknown.id);

    const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cardProvider).toBe("none");
    expect(body.defaultReaderId).toBeUndefined();
    expect(body.activeReaders).toEqual([]);
  });

  it("POST /api/pay naming a reader id that matches no active reader is reader.not_found", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())), noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    await connectStripe();
    const readerId = randomUUID();

    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: randomUUID(),
        readerId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });
    expect(payRes.status).toBe(404);
    expect(await payRes.json()).toMatchObject({
      error: { code: "reader.not_found", params: { id: readerId } },
    });
  });

  it("POST /api/pay without the provider seat list skips the sealed-credential pre-check", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    const withoutSeats: TillApiDeps = {
      ...apiDepsWithPool(cfg, fakePool(cfg, new FakeStripe())),
      providers: undefined,
    };
    mountTillApi(app, withoutSeats, noopLog);
    const deviceCookie = await enrolTillCookie(cfg, await createTillProfile());
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    // No `connectStripe()`: with the seat list present this reader answers reader.provider_disconnected.
    const reader = await seedReader();
    await setDefaultReader(deviceIdOf(deviceCookie), reader.id);

    const workingOrderId = randomUUID();
    const payRes = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      }),
    });
    expect(payRes.status).toBe(200);
    expect((await payRes.json()).outcome).toBe("captured");
    expect(await readerIdOnPayment(workingOrderId)).toBe(reader.id);
  });
});

describe("POST /api/session by device kind", () => {
  it("refuses a kitchen display as device.forbidden_action naming sign_in", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const station = await withTransaction(suite.db, (tx) =>
      createStation(tx, cfg, { name: "Pase", isDefault: false }),
    );
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: "Pantalla",
      profileId: await seedProfileFF("kds"),
      stationId: station.id,
    });

    const res = await app.request("/api/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`,
      },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "device.forbidden_action", params: { action: "sign_in" } },
    });
  });

  it.each(["till", "phone-portrait"] as const)("signs a person in on a %s device", async (ff) => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: `Signs in ${ff}`,
      profileId: await seedProfileFF(ff),
    });

    const res = await app.request("/api/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`,
      },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/working-orders/:id/prep for a settled order nothing fired yet", () => {
  it("fires the order to its station queue and answers 200 with an empty body", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // A ticket_then_pay venue settles a walk-up sale without firing it, which leaves prep to do.
    await suite.db.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    await suite.db.execute(sql`
      update departments set default_service_mode = 'ticket_then_pay'
      where location_id = ${cfg.locationId}`);
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);
    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);

    const workingOrderId = randomUUID();
    const stations = (await (
      await app.request("/api/stations", { headers: { cookie } })
    ).json()) as { id: string; isDefault: boolean }[];
    const defaultStation = stations.find((s) => s.isDefault)!;
    // With the default station off, the sale leaves the dish unsent; turning it back on before
    // the prep call lets that call send the same stored dish.
    await suite.db.execute(sql`
      update kitchen_stations set active = 0
      where location_id = ${cfg.locationId} and is_default`);
    const sale = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(sale.status).toBe(200);
    const queue = async () =>
      (
        (await (
          await app.request(`/api/stations/${defaultStation.id}/queue`, { headers: { cookie } })
        ).json()) as { items: { orderId: string }[] }
      ).items;
    expect((await queue()).find((g) => g.orderId === workingOrderId)).toBeUndefined();

    await suite.db.execute(sql`
      update kitchen_stations set active = 1
      where location_id = ${cfg.locationId} and is_default`);
    const sent = await app.request(`/api/working-orders/${workingOrderId}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe(200);
    expect(await sent.text()).toBe("");
    expect((await queue()).find((g) => g.orderId === workingOrderId)).toBeDefined();
  });
  it("fires a paid order whose product has since sold out: a settled order's lines cannot be removed", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    await suite.db.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    await suite.db.execute(sql`
      update departments set default_service_mode = 'ticket_then_pay'
      where location_id = ${cfg.locationId}`);
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);
    const deviceCookie = await enrolTillCookie(cfg);
    const cookie = await loginSession(app, cfg, operatorId, deviceCookie);
    const workingOrderId = randomUUID();
    // With the default station off, the sale leaves the dish unsent; turning it back on before
    // the prep call lets that call send the same stored dish.
    await suite.db.execute(sql`
      update kitchen_stations set active = 0
      where location_id = ${cfg.locationId} and is_default`);
    const sale = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(sale.status).toBe(200);
    await suite.db.execute(sql`update products set available = 0 where id = ${each.id}`);

    await suite.db.execute(sql`
      update kitchen_stations set active = 1
      where location_id = ${cfg.locationId} and is_default`);
    const sent = await app.request(`/api/working-orders/${workingOrderId}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });

    expect(sent.status).toBe(200);
    const fired = await suite.db.execute(
      sql`select 1 from ticket_items where working_order_id = ${workingOrderId}`,
    );
    expect(fired.rows).toHaveLength(1);
  });
});

// Owner decision 2026-10-01 (B30): card slips are kept in the cash drawer.
describe("a hand-keyed card payment opens the drawer of the device that took it, for the slip", () => {
  /** A new receipt printer, with or without a drawer, set as `deviceCookie`'s device's own, printing
   *  receipts automatically. */
  async function deviceReceiptPrinter(
    cfg: TillConfig,
    deviceCookie: string,
    hasCashDrawer: boolean,
  ): Promise<string> {
    return withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: `Recibos ${randomUUID().slice(0, 8)}`,
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer,
      });
      await tx.execute(
        sql`update devices set receipt_printer_id = ${printer.id} where id = ${deviceIdOf(deviceCookie)}`,
      );
      await tx.execute(
        sql`update locations set receipt_print_mode = 'auto' where id = ${cfg.locationId}`,
      );
      return printer.id;
    });
  }

  /** Another device's receipt printer here, with a drawer that device may open: the printer a lookup
   *  by location rather than by device would pick. */
  const otherDevicesDrawerPrinter = async (cfg: TillConfig) =>
    deviceReceiptPrinter(cfg, await enrolDrawerTill(cfg), true);

  /** A till device whose profile allows the drawer. */
  async function enrolDrawerTill(cfg: TillConfig): Promise<string> {
    return enrolTillCookie(cfg, await seedProfileFF("till", ["open-cash-drawer", "take-cash"]));
  }

  async function drawerOpenRows() {
    return withTransaction(suite.db, (tx) =>
      tx
        .select({
          reason: drawerOpens.reason,
          deviceId: drawerOpens.deviceId,
          printerId: drawerOpens.printerId,
          personId: drawerOpens.personId,
          saleId: drawerOpens.saleId,
          billPaymentId: drawerOpens.billPaymentId,
        })
        .from(drawerOpens),
    );
  }

  /** Every print job's kind and bytes, split into drawer kicks and documents. */
  async function jobs(): Promise<{ drawer: Uint8Array[]; documents: Uint8Array[] }> {
    const rows = await withTransaction(suite.db, (tx) =>
      tx.select({ kind: printJobs.kind, payload: printJobs.payload }).from(printJobs),
    );
    return {
      drawer: rows.filter((row) => row.kind === "drawer").map((row) => row.payload),
      documents: rows.filter((row) => row.kind === "document").map((row) => row.payload),
    };
  }

  async function saleIdOf(workingOrderId: string): Promise<string> {
    const [sale] = await withTransaction(suite.db, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, workingOrderId)),
    );
    return sale!.id;
  }

  async function venueWithTill(orderFlow: OrderFlow = "prepay") {
    const venue = await setupVenue();
    await suite.db.execute(
      sql`update locations set order_flow = ${orderFlow} where id = ${venue.cfg.locationId}`,
    );
    const cfg: TillConfig = { ...venue.cfg, orderFlow };
    const { available, operatorId } = venue;
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = (await loginSession(app, cfg, operatorId)).split(";")[0]!;
    // The operator signed in on `deviceCookie`'s device, with that cookie beside the session.
    const on = async (deviceCookie: string) =>
      `${(await loginSession(app, cfg, operatorId, deviceCookie)).split(";")[0]!}; ${deviceCookie}`;
    return { cfg, each, app, cookie, on, operatorId };
  }

  async function cardSale(
    app: Hono,
    cookie: string,
    body: { workingOrderId: string; menuItemId: string },
  ): Promise<Response> {
    return await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        workingOrderId: body.workingOrderId,
        lines: [{ menuItemId: body.menuItemId, quantity: "2" }],
        tender: { method: "card", amount: "3.00" },
      }),
    });
  }

  it("a card sale at the device with the drawer opens it once, audited as a card slip naming the sale, and a replay opens nothing more", async () => {
    const { cfg, each, app, on, operatorId } = await venueWithTill();
    const deviceCookie = await enrolDrawerTill(cfg);
    const deviceId = deviceIdOf(deviceCookie);
    const printerId = await deviceReceiptPrinter(cfg, deviceCookie, true);
    const workingOrderId = randomUUID();

    const first = await cardSale(app, await on(deviceCookie), {
      workingOrderId,
      menuItemId: each.menuItemId,
    });
    expect(first.status).toBe(200);

    const saleId = await saleIdOf(workingOrderId);
    expect(await drawerOpenRows()).toEqual([
      {
        reason: "card_slip",
        deviceId,
        printerId,
        personId: operatorId,
        saleId,
        billPaymentId: null,
      },
    ]);
    const printed = await jobs();
    expect(printed.drawer.map((payload) => [...payload])).toEqual([[...DRAWER_KICK]]);
    expect(printed.documents).toHaveLength(1);
    expect(decodeTicket(new Uint8Array(printed.documents[0]!))).toContain("VERI*FACTU");
    expect(opensDrawer(new Uint8Array(printed.documents[0]!))).toBe(false);

    const replay = await cardSale(app, await on(deviceCookie), {
      workingOrderId,
      menuItemId: each.menuItemId,
    });
    expect(replay.status).toBe(200);
    expect(await drawerOpenRows()).toHaveLength(1);
    expect((await jobs()).drawer).toHaveLength(1);
  });

  it("a card sale on a handheld whose profile does not allow the drawer opens none, although its receipt printer and another printer here have one", async () => {
    const { cfg, each, app, on } = await venueWithTill();
    await otherDevicesDrawerPrinter(cfg);
    const profileId = await seedProfileFF("phone-portrait");
    const handheld = await enrolDeviceForTest(suite.db, cfg, {
      name: `Waiter phone ${randomUUID()}`,
      profileId,
    });
    const handheldCookie = `${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`;
    await deviceReceiptPrinter(cfg, handheldCookie, true);

    const res = await cardSale(app, await on(handheldCookie), {
      workingOrderId: randomUUID(),
      menuItemId: each.menuItemId,
    });

    expect(res.status).toBe(200);
    expect(await drawerOpenRows()).toEqual([]);
    expect((await jobs()).drawer).toEqual([]);
  });

  it.each(["cash", "card"] as const)(
    "a handheld whose profile allows the drawer prints a %s sale's receipt on its own printer and opens the drawer, for the sale and by hand",
    async (method) => {
      const { cfg, each, app } = await venueWithTill();
      const [supervisor] = await suite.db
        .insert(persons)
        .values({ displayName: "Responsable", pinHash: hashPin("5555"), role: "supervisor" })
        .returning({ id: persons.id });
      expect(permissionsForRole("supervisor")).toContain("cash.drawer");
      const profileId = await seedProfileFF("phone-portrait", [
        "open-cash-drawer",
        "print-receipt",
        "take-cash",
      ]);
      const handheld = await enrolDeviceForTest(suite.db, cfg, {
        name: `Waiter phone ${randomUUID()}`,
        profileId,
      });
      const handheldCookie = `${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`;
      const printerId = await deviceReceiptPrinter(cfg, handheldCookie, true);
      const session = (await loginSession(app, cfg, supervisor!.id, handheldCookie)).split(";")[0]!;
      const cookie = `${session}; ${handheldCookie}`;

      const res = await app.request("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          workingOrderId: randomUUID(),
          lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
          tender: { method, amount: "5.00" },
        }),
      });
      const manual = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });

      expect(res.status).toBe(200);
      expect(manual.status).toBe(200);
      expect((await drawerOpenRows()).map((row) => [row.reason, row.printerId])).toEqual([
        [method === "cash" ? "cash_sale" : "card_slip", printerId],
        ["manual", printerId],
      ]);
      const printed = await jobs();
      expect(printed.drawer.map((payload) => [...payload])).toEqual([
        [...DRAWER_KICK],
        [...DRAWER_KICK],
      ]);
      expect(printed.documents).toHaveLength(1);
      expect(decodeTicket(new Uint8Array(printed.documents[0]!))).toContain("VERI*FACTU");
    },
  );

  it("a card sale at a device whose receipt printer has no drawer opens nothing, while another printer here has one", async () => {
    const { cfg, each, app, on } = await venueWithTill();
    await otherDevicesDrawerPrinter(cfg);
    const deviceCookie = await enrolDrawerTill(cfg);
    await deviceReceiptPrinter(cfg, deviceCookie, false);

    const res = await cardSale(app, await on(deviceCookie), {
      workingOrderId: randomUUID(),
      menuItemId: each.menuItemId,
    });

    expect(res.status).toBe(200);
    expect(await drawerOpenRows()).toEqual([]);
    const printed = await jobs();
    expect(printed.drawer).toEqual([]);
    expect(printed.documents).toHaveLength(1);
  });

  it.each(["ticket_then_pay", "invoice_first"] as const)(
    "collecting a placed %s order by hand-keyed card opens the device's drawer once for the slip, and a replay opens nothing more",
    async (orderFlow) => {
      const { cfg, each, app, cookie, on, operatorId } = await venueWithTill(orderFlow);
      const deviceCookie = await enrolDrawerTill(cfg);
      const deviceId = deviceIdOf(deviceCookie);
      const printerId = await deviceReceiptPrinter(cfg, deviceCookie, true);
      const both = await on(deviceCookie);

      const workingOrderId = randomUUID();
      const park = await app.request("/api/working-orders", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: workingOrderId,
          lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        }),
      });
      expect(park.status).toBe(200);
      const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
        method: "POST",
        headers: { cookie: both },
      });
      expect(placed.status).toBe(200);
      expect(await drawerOpenRows()).toEqual([]);

      const collect = () =>
        app.request(`/api/working-orders/${workingOrderId}/collect`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: both },
          body: JSON.stringify({ tender: { method: "card", amount: "3.00" } }),
        });
      expect((await collect()).status).toBe(200);

      const saleId = await saleIdOf(workingOrderId);
      expect(await drawerOpenRows()).toEqual([
        {
          reason: "card_slip",
          deviceId,
          printerId,
          personId: operatorId,
          saleId,
          billPaymentId: null,
        },
      ]);
      const printed = await jobs();
      expect(printed.drawer.map((payload) => [...payload])).toEqual([[...DRAWER_KICK]]);
      for (const document of printed.documents) {
        expect(opensDrawer(new Uint8Array(document))).toBe(false);
      }

      expect((await collect()).status).toBe(200);
      expect(await drawerOpenRows()).toHaveLength(1);
      expect((await jobs()).drawer).toHaveLength(1);
    },
  );

  it.each([
    ["ticket_then_pay", "cash"],
    ["ticket_then_pay", "card"],
    ["invoice_first", "cash"],
    ["invoice_first", "card"],
  ] as const)(
    "a handheld whose profile does not allow the drawer collecting a placed %s order by %s opens none, although its receipt printer and another printer here have one",
    async (orderFlow, method) => {
      const { cfg, each, app, cookie, on } = await venueWithTill(orderFlow);
      await otherDevicesDrawerPrinter(cfg);
      const profileId = await seedProfileFF("phone-portrait", ["take-cash"]);
      const handheld = await enrolDeviceForTest(suite.db, cfg, {
        name: `Waiter phone ${randomUUID()}`,
        profileId,
      });
      const handheldCookie = `${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`;
      await deviceReceiptPrinter(cfg, handheldCookie, true);
      const both = await on(handheldCookie);

      const workingOrderId = randomUUID();
      const park = await app.request("/api/working-orders", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: workingOrderId,
          lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        }),
      });
      expect(park.status).toBe(200);
      const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
        method: "POST",
        headers: { cookie: both },
      });
      expect(placed.status).toBe(200);
      expect(await drawerOpenRows()).toEqual([]);
      const collect = await app.request(`/api/working-orders/${workingOrderId}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: both },
        body: JSON.stringify({ tender: { method, amount: "3.00" } }),
      });

      expect(collect.status).toBe(200);
      expect(await saleIdOf(workingOrderId)).toBeDefined();
      expect(await drawerOpenRows()).toEqual([]);
      expect((await jobs()).drawer).toEqual([]);
    },
  );

  it("a cash sale at the device with the drawer still opens it as a cash sale", async () => {
    const { cfg, each, app, on } = await venueWithTill();
    const deviceCookie = await enrolDrawerTill(cfg);
    await deviceReceiptPrinter(cfg, deviceCookie, true);
    const workingOrderId = randomUUID();

    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await on(deviceCookie) },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });

    expect(res.status).toBe(200);
    expect((await drawerOpenRows()).map((row) => [row.reason, row.saleId])).toEqual([
      ["cash_sale", await saleIdOf(workingOrderId)],
    ]);
    expect((await jobs()).drawer).toHaveLength(1);
  });
});
