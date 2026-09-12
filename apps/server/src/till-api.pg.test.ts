import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, sales, withTenant, workingOrders } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createMenuItem,
  createMenuSection,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANUAL_PROVIDER, SimulatorPaymentProvider } from "@waitron/payments";
import { CARD_PROVIDERS } from "@waitron/composition";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { createStation } from "./kitchen.js";

// Real Postgres, not PGlite: this drives `POST /api/sales` and the `/api/working-orders` routes
// through the HTTP surface to a GENUINE chained fiscal record written by the app role.
// PGlite runs every connection as a superuser, which holds every privilege and so cannot prove the
// deployment role is permitted to write `registros_facturacion` (CLAUDE.md §4). The 401-without-session guards,
// the products list and the park/list/retrieve/update/abandon route LOGIC live in the hermetic
// `till-api.test.ts`; what needs a container is the chained-write happy path AND the pay-idempotency
// crux (a lost-response pay retry must REPLAY the ticket, filing no second chained record — spec §3),
// which only a real fiscal write proves. Setup mirrors `till-sale.test.ts` (Task 3) — a provisioned
// venue + a seeded catalogue, a real `VerifactuBackend` and the system clock — plus a login person.
const LOCALE = "es-ES";

// A non-superuser LOGIN role that inherits `app_user`'s grants, for Task 7's `/api/pay` tests: the
// `StripeTerminalProvider` this file wires in for those tests does NOT run its own writes through
// `withTenant` + `asAppUser` (`insertAttempting`/`captureAttempting`/`failAttempting` execute at
// whatever role its `db` handle carries — see that class's own "Present because…" doc comment), so
// `suite.admin` there would write the `payments` ledger as a superuser holding every privilege — the
// same reasoning `till-sale-integrated.pg.test.ts`'s `integratedDeps` documents for its own
// identically-named probe role (a different container, so no name collision).
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

// A clone of the full-manifest template; the provider connections below authenticate as the
// cluster-wide `rls_probe` role the package globalSetup creates (shared with till-sale-integrated),
// in place of the per-file `probeRole` this suite used before the shared container.
const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

/** A no-op logger: the routes emit structured lines the hermetic suite already asserts; here only
 * the HTTP responses and the database matter. */
const noopLog: Logger = () => {};

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `till-sale.test.ts`/`catalogue-demo.ts` document. `recordSale` reads `now()`
 * once and touches neither `anchor` nor `currentAnchor`.
 */
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
      throw new Error("till-api.pg.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF. A local counter, the same shape
// `till-sale.test.ts`'s `nextNif` uses for the same reason.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    // These API tests exercise routes that do not dispatch on the mode; the venue defaults to prepay.
    orderFlow: "prepay",
  };
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), seed a catalogue and a staff
 * person with a known PIN (as the app role), and read back the sellable products — one `each`
 * product (1.50 gross, general/21%) and one `weight` product (24.90 €/kg, reduced/10%). Each test
 * gets its OWN tenant so the `registros_facturacion`/`sales` counts are that test's alone,
 * order-independent (CLAUDE.md §4). Returns the login person's id so the test can log in as them and
 * assert the sale is attributed to them.
 */
async function setupVenue(): Promise<{
  cfg: TillConfig;
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
        tillName: "Caja 1",
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
    { db: suite.admin, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const { available, operatorId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
    const comida = await createCategory(tx, cfg.tenantId, { name: "Comida" });
    const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
    const jamon = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: comida.id,
      descriptions: { es: "Jamón cortado" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const agua = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { es: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const section = await createMenuSection(tx, cfg.tenantId, {
      menuId: cat.id,
      name: { es: "Carta" },
    });
    const jamonItem = await createMenuItem(tx, cfg.tenantId, {
      menuId: cat.id,
      productId: jamon.id,
      sectionId: section.id,
      grossPrice: "24.90",
    });
    const aguaItem = await createMenuItem(tx, cfg.tenantId, {
      menuId: cat.id,
      productId: agua.id,
      sectionId: section.id,
      grossPrice: "1.50",
    });
    await tx.execute(sql`
      insert into zone_menus (tenant_id, zone_id, menu_id, display_order)
      select ${cfg.tenantId}, zone_id, ${cat.id}, 0
      from zone_service_policies
      where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId}
        and is_counter_default`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${cat.id}
      where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId}
        and is_counter_default`);
    await tx.execute(sql`
      insert into preparation_routes (tenant_id, location_id, category_id, station_id)
      values
        (${cfg.tenantId}, ${cfg.locationId}, ${comida.id},
          (select id from kitchen_stations
           where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId} and is_default)),
        (${cfg.tenantId}, ${cfg.locationId}, ${bebidas.id},
          (select id from kitchen_stations
           where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId} and is_default))`);
    // A staff person with a KNOWN PIN ("5555"), inserted on the app role (which holds INSERT on
    // `persons`), so the login route can verify their credential and the sale is attributed to them.
    const person = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'Cajera', ${hashPin("5555")}, 'staff') returning id`);
    const menuItems = new Map([
      [jamon.id, jamonItem.id],
      [agua.id, aguaItem.id],
    ]);
    return {
      available: (await listAvailableProducts(tx, cfg.locationId)).products.map((product) => ({
        ...product,
        menuItemId: menuItems.get(product.id)!,
      })),
      operatorId: person.rows[0]!.id,
    };
  });
  return { cfg, available, operatorId };
}

/** The till API's deps for a provisioned venue: the owner connection (routes drop to `app_user`
 * themselves via `withTenant` + `asAppUser`), the real fiscal backend + system clock the sale path
 * files through, and `secureCookies:false` so the session cookie rides the non-TLS `app.request`. */
function apiDeps(cfg: TillConfig): TillApiDeps {
  // No integrated card provider built for these suites (`cfg.tipsEnabled` is `false` — see
  // `tillConfigFromVenue`). `cardProvider` (the built PaymentProvider) is optional and left undefined.
  // `venueLocale` is the display default `GET /api/till`/`GET /api/locales` echo; mirror the cfg's
  // locale so it is internally consistent (these API suites assert no locale field).
  return {
    db: suite.admin,
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
 * A FAKE `CardProviderPool` matching the PRODUCTION pool's shape: ONE cached `StripeTerminalProvider`
 * over `FakeStripe` per provider id, and `get` takes only a provider id — no reader. The reader a sale
 * charges is a per-collect input (`CollectParams.readerRef`), so one cached provider serves every
 * reader on the vendor; caching here (rather than a fresh provider per `get`) is what lets the
 * two-readers-one-provider regression below prove the ref is not baked in. The provider is given its
 * OWN `providerDb` handle (a `PROBE_ROLE` connection the test opens/closes), since the provider's
 * `payments`-ledger writes run at whatever role THAT handle carries (see `PROBE_ROLE` above) — the
 * routes' own DB ops still run through `withTenant` + `asAppUser` off `suite.admin`. This stands in for
 * the boot pool (which would build the real seat from a sealed credential) so a capture/decline
 * genuinely round-trips the adapter without a network.
 */
function fakePool(cfg: TillConfig, providerDb: Database, client: FakeStripe): CardProviderPool {
  const cache = new Map<string, StripeTerminalProvider>();
  return {
    get: (providerId) => {
      let provider = cache.get(providerId);
      if (provider === undefined) {
        provider = new StripeTerminalProvider({
          client,
          db: providerDb,
          tenantId: cfg.tenantId,
          nodeId: cfg.nodeId,
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
    db: suite.admin,
    backend,
    clock,
    cfg,
    secureCookies: false,
    venueLocale: cfg.locale,
    pool,
    providers: CARD_PROVIDERS,
  };
}

/** Seed an ACTIVE `card_readers` row (default provider `stripe`) and return its id + `providerRef`.
 * `tenantId` can be overridden to seed ANOTHER tenant's reader (the by-id isolation probe). */
async function seedReader(
  cfg: TillConfig,
  opts: { provider?: string; providerRef?: string; tenantId?: string; name?: string } = {},
): Promise<{ id: string; providerRef: string }> {
  const providerRef = opts.providerRef ?? `reader_${randomUUID()}`;
  const r = await suite.admin.execute<{ id: string }>(sql`
    insert into card_readers (tenant_id, provider, provider_ref, name)
    values (${opts.tenantId ?? cfg.tenantId}, ${opts.provider ?? "stripe"}, ${providerRef}, ${opts.name ?? "Front counter"})
    returning id`);
  return { id: r.rows[0]!.id, providerRef };
}

/** Point a device at its DEFAULT reader (`device_card_readers`). */
async function setDefaultReader(
  cfg: TillConfig,
  deviceId: string,
  readerId: string,
): Promise<void> {
  await suite.admin.execute(sql`
    insert into device_card_readers (tenant_id, device_id, reader_id)
    values (${cfg.tenantId}, ${deviceId}, ${readerId})`);
}

/** Seal this tenant's `payments.stripe` credential so the provider counts as CONNECTED (the pay
 * path's pre-check reads only its presence). */
async function connectStripe(cfg: TillConfig): Promise<void> {
  await withTenant(suite.admin, cfg.tenantId, (tx) =>
    putCredential(tx, RING, {
      tenantId: cfg.tenantId,
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

/** The stamped `payments.reader_id` for a working order (NULL when none), read as app_user. */
async function readerIdOnPayment(cfg: TillConfig, workingOrderId: string): Promise<string | null> {
  const rows = await suite.admin.execute<{ reader_id: string | null }>(sql`
    select reader_id from payments where tenant_id = ${cfg.tenantId} and working_order_id = ${workingOrderId}`);
  return rows.rows[0]?.reader_id ?? null;
}

/**
 * Enrol a REAL `till`-kind device in `cfg`'s tenant, BOUND TO THE VENUE'S OWN TILL (`cfg.tillId`), and
 * return the `waitron_device=<id>.<token>` cookie a booting till device carries. SP-A.2 cutover: a sale
 * route now resolves `till_id` from THIS device (`requireSaleTillId`), so the device's till IS the venue
 * till and every sale's fiscal record is byte-identical to the pre-cutover env-till (the same `till_id`,
 * and `nodeId`/`seriesId` still come from cfg). An optional `deviceProfileId` binds a device profile —
 * the `/api/pay` tests need one declaring `integrated-card-payment` so `assertDeviceCapability` passes
 * (capabilities relocated onto the profile, Task 9). Join-and-accept runs on the app role under the
 * tenant (the production accept path), so the scrypt hash actually verifies and `tryReadDevice` resolves
 * a genuine binding rather than a miss.
 */
let tillDeviceCounter = 0;
async function enrolTillCookie(
  cfg: TillConfig,
  deviceProfileId: string | null = null,
): Promise<string> {
  tillDeviceCounter += 1;
  // A `till` device is DEFINED by a `till`-form-factor profile (Task 7): the device describes itself
  // at accept, and `resolveDeviceBinding` AUTO-CREATES the register it rings against (named after the
  // device). Each call names the device uniquely so its auto-created register cannot collide.
  const profileId = deviceProfileId ?? (await seedProfileFF(cfg, "till"));
  const dev = await enrolDeviceForTest(suite.admin, cfg, {
    name: `Counter till ${tillDeviceCounter}`,
    profileId,
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Log the operator (PIN "5555") in through the HTTP surface and return the Set-Cookie session cookie.
 *  The login is DEVICE-GATED (§5/§6), so it enrols a throwaway `till` device and presents its cookie;
 *  each sale/pay test enrols its OWN device (bound to the till/profile the case needs) for the sale call
 *  itself. */
async function loginSession(app: Hono, cfg: TillConfig, operatorId: string): Promise<string> {
  const deviceCookie = await enrolTillCookie(cfg);
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return login.headers.get("set-cookie")!;
}

/** Insert a `device_profiles` row declaring both fenced flags (`integrated-card-payment` +
 *  `open-cash-drawer`, the `DEFAULT_PROFILE_CAPABILITIES.till` set) for the tenant and return its id, so
 *  a pay-capable till device can bind it and `assertDeviceCapability` reads the flag THROUGH the profile
 *  (Task 9). */
async function createTillProfile(cfg: TillConfig): Promise<string> {
  const prof = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor, capabilities)
    values (${cfg.tenantId}, 'Counter till', 'till', ${JSON.stringify(["integrated-card-payment", "open-cash-drawer"])}::jsonb)
    returning id`);
  return prof.rows[0]!.id;
}

/** Seed a `device_profiles` row of a given FORM FACTOR (a device is DEFINED by its profile since Task
 *  7). A per-suite counter keeps the tenant-unique name from colliding across repeated seeds. */
let profileCounter = 0;
async function seedProfileFF(
  cfg: TillConfig,
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
  capabilities: string[] = [],
): Promise<string> {
  profileCounter += 1;
  const prof = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor, capabilities)
    values (${cfg.tenantId}, ${`Profile ${formFactor} ${profileCounter}`}, ${formFactor}, ${JSON.stringify(capabilities)}::jsonb)
    returning id`);
  return prof.rows[0]!.id;
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("till-api.pg.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("POST /api/sales (the fiscal sale path over HTTP)", () => {
  it("logs in, rings a cash sale, returns the ticket, and writes a chained fiscal record", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // 1. Log in through the HTTP surface and capture the session cookie the route sets.
    const cookie = await loginSession(app, cfg, operatorId);
    expect(cookie).toMatch(/waitron_till_session=/);
    // SP-A.2 cutover: the sale resolves its till from the enrolled device, so the box carries a
    // `waitron_device` cookie for a till bound to THIS venue's own till — the resolved till equals the
    // env `cfg.tillId`, keeping the fiscal record below byte-identical to the pre-cutover sale.
    const deviceCookie = await enrolTillCookie(cfg);

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

    // 4. A GENUINE chained fiscal record exists for this tenant/node — one, hashed (own tenant, so
    // the count is order-independent).
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(registros.length).toBe(1);
    expect(registros[0]!.tenantId).toBe(cfg.tenantId);
    expect(registros[0]!.nodeId).toBe(cfg.nodeId);
    expect(registros[0]!.huella).toMatch(/^[0-9A-F]{64}$/);

    // 5. The sale is attributed to the logged-in operator — the whole point of the session guard.
    const saleRows = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ operatorId: sales.operatorId })
        .from(sales)
        .where(eq(sales.tenantId, cfg.tenantId));
    });
    expect(saleRows).toEqual([{ operatorId }]);
  });

  // The definitive "ring up a sandwich" proof (Task 20). The test above rings a single-rate cash
  // sale; this one drives the operator's WHOLE server-side journey — log in, read the menu, ring a
  // MIXED-rate basket built from that menu — and then holds the response to the legal ticket
  // standard (findings §14) AND the database to an intact hash chain across two sales. Nothing here
  // touches production code; it is pure end-to-end verification over the same real-Postgres harness.
  it("walks the full journey: login → menu → mixed-rate sale → legal ticket + an intact fiscal chain", async () => {
    const { cfg, operatorId } = await setupVenue();

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // 1. Log in through the HTTP surface and capture the session cookie.
    const cookie = await loginSession(app, cfg, operatorId);
    expect(cookie).toMatch(/waitron_till_session=/);
    // SP-A.2 cutover: an enrolled till device bound to the venue's own till (resolved till == env
    // `cfg.tillId`), so both sales below file the same chain the pre-cutover env-till would.
    const deviceCookie = await enrolTillCookie(cfg);

    // 2. The operator sees the default zone's menu offers. The sale lines are built from those offers,
    // exactly as the real till does (it never invents menu-item ids).
    const productsRes = await app.request("/api/default-service-zone/offers", {
      headers: { cookie },
    });
    expect(productsRes.status).toBe(200);
    const { offers } = (await productsRes.json()) as {
      offers: {
        id: string;
        pricingUnit: "each" | "weight";
        descriptions: Record<string, string>;
      }[];
    };
    const products = offers.map((offer) => ({ ...offer, menuItemId: offer.id }));
    // The two seeded, sellable products come back — the reduced-rate weighed one and the
    // general-rate each one — so the basket below genuinely mixes VAT rates.
    expect(products.map((p) => p.descriptions.es).sort()).toEqual([
      "Agua mineral",
      "Jamón cortado",
    ]);
    const jamon = products.find((p) => p.pricingUnit === "weight")!; // 24.90 €/kg reduced(10%)
    const agua = products.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

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

    // 6. Two GENUINE, chained fiscal records exist for this tenant/node (own tenant, so the count is
    // this test's alone). The chain-integrity assertions follow `write-path.e2e.test.ts`'s pattern:
    // the first record opens the chain (`primerRegistro`, no predecessor pointer), and the second
    // increments `secuencia` and carries the first record's ACTUAL huella as its predecessor
    // (`anteriorHuella`) — the four-part Encadenamiento link (schema/registros.ts). Both hashes are
    // the stored 64-hex huella the append-only table pins.
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId))
        .orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(2);

    const [first, second] = registros;
    expect(first!.tenantId).toBe(cfg.tenantId);
    expect(first!.nodeId).toBe(cfg.nodeId);
    expect(first!.secuencia).toBe(1);
    expect(first!.primerRegistro).toBe(true);
    expect(first!.anteriorHuella).toBeNull();
    expect(first!.huella).toMatch(/^[0-9A-F]{64}$/);

    expect(second!.tenantId).toBe(cfg.tenantId);
    expect(second!.nodeId).toBe(cfg.nodeId);
    expect(second!.secuencia).toBe(2); // the per-node sequence increments
    expect(second!.primerRegistro).toBe(false);
    expect(second!.huella).toMatch(/^[0-9A-F]{64}$/);
    // …and the chain links: the second's predecessor pointer IS the first's actual huella.
    expect(second!.anteriorHuella).toBe(first!.huella);
    expect(second!.anteriorNumSerieFactura).toBe("A/1");
  });
});

// The H2 fiscal cutover (SP-A.2 §16.4/§16.5): a sale's `till_id` now resolves from the AUTHENTICATED
// enrolled device (`requireSaleTillId`), not env. These two negatives pin the fail-closed setup
// preconditions; every happy-path sale test in this file carries a till-device cookie so the resolved
// till equals the venue till and the fiscal record is unchanged.
describe("sale-time till_id from the authenticated device (SP-A.2 cutover)", () => {
  it("refuses POST /api/sales with NO device cookie — 401 device.unauthorized, filing nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // A valid operator session, but the SALE below carries NO `waitron_device` cookie — an ordinary
    // env-only till, which after the cutover is no longer a sellable box on its own. (The login itself
    // is device-gated now, §5/§6, so `loginSession` presents a device to obtain the session; the SALE
    // request deliberately omits it.) Prove-by-deletion: revert `saleCfg` → `deps.cfg` at
    // `POST /api/sales` (drop the `requireSaleTillId` resolve) and this same request 200s + files one.
    const cookie = await loginSession(app, cfg, operatorId);

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
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(registros).toHaveLength(0);
  });

  it("refuses POST /api/sales from a device with no till (a kds_station) — 400 device.till_required", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // A `kds_station` binds a live station and NO till (a kds device rings no sale), so its
    // `devices.till_id` is null — `requireSaleTillId` refuses it `device.till_required`: a till-less
    // device (a kitchen screen) cannot ring a sale. The device authenticates (a real enrolled binding),
    // so this proves the SECOND branch, distinct from the no-cookie `device.unauthorized` above.
    // A distinct, non-default station name — provisioning already seeds the venue's default "Cocina".
    const station = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createStation(tx, cfg, { name: "Pase", isDefault: false });
    });
    const profileId = await seedProfileFF(cfg, "kds");
    const dev = await enrolDeviceForTest(suite.admin, cfg, {
      name: "Pantalla",
      profileId,
      stationId: station.id,
    });
    const deviceCookie = `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;

    const cookie = await loginSession(app, cfg, operatorId);

    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "device.till_required" } });
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
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
    const cookie = await loginSession(app, cfg, operatorId);
    // SP-A.2 cutover: the pay + replay below resolve their till from this enrolled till device (bound to
    // the venue's own till), so the filed record and the replay are byte-identical to the pre-cutover sale.
    const deviceCookie = await enrolTillCookie(cfg);

    // 2. Park an order (client-minted id, its own idempotency key) with 2 × 1.50. Fresh tenant+node
    //    per test, so the allocated order number is deterministically 1.
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
    const after = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return {
        registros: await tx
          .select()
          .from(registrosFacturacion)
          .where(eq(registrosFacturacion.tenantId, cfg.tenantId)),
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
        saleRows: await tx
          .select({ workingOrderId: sales.workingOrderId, operatorId: sales.operatorId })
          .from(sales)
          .where(eq(sales.tenantId, cfg.tenantId)),
      };
    });
    expect(after.registros).toHaveLength(1);
    expect(after.wo).toEqual([{ status: "settled" }]);
    expect(after.saleRows).toEqual([{ workingOrderId, operatorId }]);

    // 6. REPLAY: the till lost the response and re-sends the identical pay. It must REPLAY the ticket
    //    (same invoice number, same total) and file NO second chained record — the crux of park &
    //    retrieve (spec §3): invoice numbers are never reused, so a double filing is unrepairable.
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
    // Task 14: the replay reads the filed record back, so the reprinted ticket now carries the SAME
    // mandatory Veri*Factu QR and the SAME authoritative desglose as the original — no longer a
    // QR-less, recomputed ticket. `change` stays "0.00", still a documented limitation: the tendered
    // cash is not persisted and the drawer change was handed over at the ORIGINAL sale. See
    // `readSettledTicket`.
    expect(replayTicket.qr).toBe(ticket.qr);
    expect(replayTicket.qr.length).toBeGreaterThan(0);
    expect(replayTicket.vatBreakdown).toEqual(ticket.vatBreakdown);
    expect(replayTicket.tender).toEqual({ method: "cash", change: "0.00" });

    // Still exactly ONE record — the replay filed nothing.
    const stillOne = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(stillOne).toHaveLength(1);
  });
});

// POST /api/pay (Task 12 cutover): the integrated-card-terminal pay route now RESOLVES the reader
// (request `readerId`, else the paying device's default in `device_card_readers`), loads the reader
// row tenant-scoped by id, PRE-CHECKS the provider is connected, then drives the reader's provider
// (from the pool) through the real `payWorkingOrderIntegrated` split-transaction flow (P1 commit →
// network collect → P3 file/settle) over a `FakeStripe`-backed `StripeTerminalProvider` — so a
// capture/decline genuinely round-trips the adapter rather than being stubbed. Real Postgres for the
// same reason every suite here is (the split flow + the provider's FK-before-attempting ordering +
// the by-id tenant-isolation probe need a real multi-backend, non-superuser Postgres, CLAUDE.md §4);
// the cookieless refusal is hermetic, in `till-api.test.ts`.
describe("POST /api/pay (integrated card terminal, over HTTP)", () => {
  it("routes to the device's DEFAULT reader, captures, and STAMPS payments.reader_id", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const reader = await seedReader(cfg);
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

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
      // The payment records the reader it settled on (Task 12) — proof the pay routed to the default.
      expect(await readerIdOnPayment(cfg, workingOrderId)).toBe(reader.id);
    } finally {
      await providerDb.close();
    }
  });

  it("a request readerId OVERRIDES the device default, and stamps that reader", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const dflt = await seedReader(cfg, { name: "Default" });
      const other = await seedReader(cfg, { name: "Other" });
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), dflt.id);

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
      expect(await readerIdOnPayment(cfg, workingOrderId)).toBe(other.id);
    } finally {
      await providerDb.close();
    }
  });

  it("two active readers on ONE provider: two sales route each to its OWN providerRef (not the first)", async () => {
    // The reader-ref-per-collect guard. Before the fix, the pool cached ONE provider per id and baked
    // the FIRST sale's reader resolver into it, discarding every later sale's reader — so a venue with
    // two readers on one provider charged every sale after the first on the first reader. Now the ref
    // is a per-collect input, so one shared cached provider drives each sale's own reader. `FakeStripe`
    // records the reader id `processPaymentIntent` drove, in order — assert the two DISTINCT refs.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const client = new FakeStripe();
      const app = new Hono();
      // One pool, one FakeStripe: the pay path calls `pool.get("stripe")` for BOTH sales and must get
      // the SAME cached provider, so the only thing distinguishing the two collects is `readerRef`.
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, client)), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const readerA = await seedReader(cfg, { name: "Reader A" });
      const readerB = await seedReader(cfg, { name: "Reader B" });

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
    } finally {
      await providerDb.close();
    }
  });

  it("a resolvePending sweep tick BEFORE the first sale does not break the subsequent sale (no 500)", async () => {
    // Regression for the sweep-poisons-the-pool defect: the boot sweep fetches each provider via
    // `pool.get(providerId)` and runs `resolvePending`. The pay path then fetches the SAME cached
    // instance. Before the fix, the sweep baked a THROWING reader resolver into that instance, so the
    // next card sale 500'd (`collect` called the resolver before its own try). With the reader now a
    // per-collect input, the swept instance and the pay instance are one and the same and the sale
    // captures cleanly.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const pool = fakePool(cfg, providerDb, new FakeStripe());
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, pool), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const reader = await seedReader(cfg);
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

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
      expect(await readerIdOnPayment(cfg, workingOrderId)).toBe(reader.id);
    } finally {
      await providerDb.close();
    }
  });

  it("naming ANOTHER tenant's reader is reader.not_found (by-id isolation, never chargeable)", async () => {
    // The by-id read scopes to the till's tenant (CLAUDE.md §3), so a reader id that belongs to a
    // different tenant is not readable here — refused `reader.not_found`, never charged. Proven by
    // deleting the `eq(card_readers.tenantId, cfg.tenantId)` predicate in `resolvePayReader` locally
    // and running this test: the read then LEAKS the foreign reader, the isolation assertion fails,
    // and the request returns 500 (the payment's composite FK to `card_readers` rejects the
    // cross-tenant reader) rather than the 404 asserted here — restoring the predicate turns it back
    // to 404. (Observed 2026-09-12, re-running the run-it probe.)
    const { cfg: a, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const { cfg: b } = await setupVenue(); // a SECOND tenant, whose reader tenant A must not reach
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(a, fakePool(a, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, a, operatorId);
      const deviceCookie = await enrolTillCookie(a, await createTillProfile(a));
      await connectStripe(a);
      const foreign = await seedReader(b, { tenantId: b.tenantId });

      const payRes = await app.request("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
        body: JSON.stringify({
          id: randomUUID(),
          readerId: foreign.id,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        }),
      });

      expect(payRes.status).toBe(404);
      expect(await payRes.json()).toMatchObject({ error: { code: "reader.not_found" } });
    } finally {
      await providerDb.close();
    }
  });

  it("a device with no default reader and no request readerId is reader.not_found", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
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
    } finally {
      await providerDb.close();
    }
  });

  it("a reader whose provider has NO sealed credential is reader.provider_disconnected (not a decline)", async () => {
    // The provider is NOT connected (no `connectStripe`). Both adapters swallow a deferred
    // credential-read failure into a DECLINE, so the pay path PRE-CHECKS the credential and answers the
    // actionable `reader.provider_disconnected` (409) instead of a misleading 200 declined.
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      const reader = await seedReader(cfg); // active reader, but provider not connected
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

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
    } finally {
      await providerDb.close();
    }
  });

  it("returns 200 { outcome: 'declined' } on a decline — NOT a 4xx, and files nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const client = new FakeStripe();
      client.declineNext();
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, client)), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const reader = await seedReader(cfg);
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

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

      const after = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return {
          registros: await tx
            .select()
            .from(registrosFacturacion)
            .where(eq(registrosFacturacion.tenantId, cfg.tenantId)),
          wo: await tx
            .select({ status: workingOrders.status })
            .from(workingOrders)
            .where(eq(workingOrders.id, workingOrderId)),
        };
      });
      expect(after.registros).toHaveLength(0);
      expect(after.wo).toEqual([{ status: "open" }]);
    } finally {
      await providerDb.close();
    }
  });

  it("demo/prepare drives the local simulator and stamps NO reader", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The demo/prepare shape: `deps.cardProvider` is the local simulator (no pool, no reader row).
      const app = new Hono();
      mountTillApi(
        app,
        {
          db: suite.admin,
          backend,
          clock,
          cfg,
          secureCookies: false,
          venueLocale: cfg.locale,
          cardProvider: new SimulatorPaymentProvider(providerDb, cfg.tenantId),
        },
        noopLog,
      );
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));

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
      expect(await readerIdOnPayment(cfg, workingOrderId)).toBeNull();
    } finally {
      await providerDb.close();
    }
  });

  it("still 400s an empty walk-up basket — a genuine fault, mapped through run, not a payment outcome", async () => {
    const { cfg, operatorId } = await setupVenue();
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const cookie = await loginSession(app, cfg, operatorId);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      await connectStripe(cfg);
      const reader = await seedReader(cfg);
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);
      const payRes = await app.request("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
        body: JSON.stringify({ id: randomUUID(), lines: [] }),
      });

      expect(payRes.status).toBe(400);
      expect(await payRes.json()).toMatchObject({ error: { code: "sale.empty_basket" } });
    } finally {
      await providerDb.close();
    }
  });
});

// GET /api/till: the per-device card provider string (Task 12) — the paying device's default reader's
// provider, mapped to the till's union — and the `activeReaders` list Task 17's picker reads.
describe("GET /api/till (per-device card provider, over HTTP)", () => {
  it("maps the device's default reader provider to the till union and lists active readers", async () => {
    const { cfg } = await setupVenue();
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      const reader = await seedReader(cfg); // provider "stripe"
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

      const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        cardProvider: string;
        defaultReaderId: string;
        activeReaders: { id: string; name: string; provider: string }[];
      };
      // "stripe" → "stripe_terminal" (the till's closed union), never the raw seat id.
      expect(body.cardProvider).toBe("stripe_terminal");
      // The default reader's OWN id (Task 17) — needed to name it in `activeReaders` below, since
      // `cardProvider` alone only names the provider TYPE, not which reader on it is the default.
      expect(body.defaultReaderId).toBe(reader.id);
      expect(body.activeReaders).toEqual([
        { id: reader.id, name: "Front counter", provider: "stripe_terminal" },
      ]);
    } finally {
      await providerDb.close();
    }
  });

  it("a device with no default reader gets cardProvider 'none'", async () => {
    const { cfg } = await setupVenue();
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(app, apiDepsWithPool(cfg, fakePool(cfg, providerDb, new FakeStripe())), noopLog);
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));

      const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cardProvider).toBe("none");
      expect(body.defaultReaderId).toBeUndefined();
    } finally {
      await providerDb.close();
    }
  });

  it("a demo/prepare till surfaces the simulator regardless of any reader", async () => {
    const { cfg } = await setupVenue();
    const providerDb = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountTillApi(
        app,
        {
          db: suite.admin,
          backend,
          clock,
          cfg,
          secureCookies: false,
          venueLocale: cfg.locale,
          cardProvider: new SimulatorPaymentProvider(providerDb, cfg.tenantId),
        },
        noopLog,
      );
      const deviceCookie = await enrolTillCookie(cfg, await createTillProfile(cfg));
      const reader = await seedReader(cfg);
      await setDefaultReader(cfg, deviceIdOf(deviceCookie), reader.id);

      const res = await app.request("/api/till", { headers: { cookie: deviceCookie } });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Practice mode wins over any configured reader.
      expect(body.cardProvider).toBe("simulator");
      // The real reader's id stays hidden too — there is no reader behind the local simulator.
      expect(body.defaultReaderId).toBeUndefined();
    } finally {
      await providerDb.close();
    }
  });
});

// Drive place, prep, advance and collect through the same venue on PostgreSQL.
// In ticket_then_pay mode, collect files the sale through the real fiscal backend.
describe("place → station queue → per-line advance → collect (KDS-1 ticket model, over HTTP)", () => {
  it("Mode T: place files no fiscal doc; the prep queue tracks it; collect files the sale at collect", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // Flip this venue's location to `ticket_then_pay` (Mode T) — `setupVenue` provisions the DEFAULT
    // `prepay`, so both the DB column and the in-memory cfg are updated together, the same two-part
    // flip `working-order.pg.test.ts`'s `modeVenue` makes.
    await suite.admin.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);

    // 1. Log in.
    const cookie = await loginSession(app, cfg, operatorId);
    // SP-A.2 cutover: place + collect are sale routes now, so the box is an enrolled till device bound to
    // the venue's own till (resolved till == env `cfg.tillId`, so the record filed at collect is unchanged).
    const deviceCookie = await enrolTillCookie(cfg);

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

    const noSaleYet = await withTenant(suite.admin, modeCfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales).where(eq(sales.tenantId, modeCfg.tenantId));
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
    const groups1 = (await queue1.json()) as {
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
        descriptions: Record<string, string>;
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
        // A fired-at-PLACING order (Modes I/T) is on the queue as `placed` — not collectable via the
        // Mode-P handover route; its collect is the fiscal `POST /api/working-orders/:id/collect` below.
        status: "placed",
        // KDS order-timing alerts (design §3/§6/§11): the venue's DEFAULT station carries the schema's
        // default thresholds — provisioning never overrides them.
        thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        items: [
          {
            id: expect.any(String),
            workingOrderLineId: expect.any(String),
            state: "queued",
            // The dish name + quantity the kitchen display renders, carried end to end from the fired
            // working-order line's snapshot through the HTTP route (KDS-1 Gap 2): "2× Agua mineral".
            // Full-tag `es-ES`: the line snapshot is re-keyed from the bare-`es` catalogue content to
            // the location's `invoice_locales` at `priceOrderLines` before the working-order line insert.
            descriptions: { "es-ES": "Agua mineral" },
            quantity: "2.000",
            // KDS-2: this product carries no course, so the item serialises `course: null` and fires
            // IMMEDIATELY (a null course is treated as earliest, §2b) — `firedAt` is a timestamp, not null.
            course: null,
            firedAt: expect.any(String),
            // Order-line customisation (spec §2/§3): this line carried no note/doneness, so the
            // snapshotted fields the KDS reads serialise null.
            note: null,
            doneness: null,
            // No options selected on this line → an empty modifier sub-item list (ordering modifiers).
            modifiers: [],
            // Just fired — nowhere near the default station's 5-minute warm threshold.
            queuedAt: expect.any(String),
            band: "fresh",
            // Modifier↔allergen: this dish carries no options and its allergens are unreviewed, so the
            // as-served fold is an empty set flagged pending — the KDS surfaces "not reviewed" for it
            // (the Cautious policy: a modifier-less unreviewed dish still warns the kitchen). `removed`
            // is empty (nothing was stripped from an unknown base).
            asServed: { allergens: {}, pending: true },
            // Task 5 — the as-served DIET twin. This dish carries no recipe (null `diet_derivation`),
            // which folds as "no recipe": empty origins but PENDING (the same default
            // `republishProductDiet` uses at product level), so an option-less unreviewed dish reads
            // vegan/vegetarian "unknown" — the CAUTIOUS posture, matching the allergen `pending` above
            // and the product's own published diet. An unreviewed plate asserts no positive diet claim.
            asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
            removed: [],
          },
        ],
      },
    ]);

    // 4. Advance the ticket item over HTTP, per line: queued → preparing → ready. (`collected` is no
    //    longer a kitchen state — the handover is order-level `collected_at`, set at collect below.)
    const itemId = groups1[0]!.items[0]!.id;
    for (const to of ["preparing", "ready"]) {
      const advance = await app.request(`/api/ticket-items/${itemId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });
      expect(advance.status).toBe(200);
    }
    // A `ready` line stays on the queue until its order collects — the display drops it on handover.
    const groupsReady = (await (await app.request(queueUrl, { headers: { cookie } })).json()) as {
      orderId: string;
      items: { state: string }[];
    }[];
    expect(groupsReady.find((g) => g.orderId === workingOrderId)!.items[0]!.state).toBe("ready");

    // 5. COLLECT: Mode T files `recordSale` IMMEDIATE here, placed → settled — the genuine chained
    // fiscal write this real-Postgres suite exists to prove.
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

    const after = await withTenant(suite.admin, modeCfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return {
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
        registros: await tx
          .select()
          .from(registrosFacturacion)
          .where(eq(registrosFacturacion.tenantId, cfg.tenantId)),
      };
    });
    expect(after.wo).toEqual([{ status: "settled" }]);
    expect(after.registros).toHaveLength(1); // exactly one chained record, filed at collect

    // 6. Collect stamped `collected_at`, so the handed-over order drops off the station's display —
    //    `listStationQueue` filters `collected_at IS NULL` (the KDS-1 successor to the old `collected`
    //    prep state).
    const queueAfterCollect = await app.request(queueUrl, { headers: { cookie } });
    expect(await queueAfterCollect.json()).toEqual([]);
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

    const cookie = await loginSession(app, cfg, operatorId);

    // SP-A.2 cutover: the walk-up sale resolves its till from an enrolled till device (venue's own till).
    const deviceCookie = await enrolTillCookie(cfg);

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
    expect(await queue.json()).toEqual([
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
    const queueAfterRefusal = (await (
      await app.request(`/api/stations/${defaultStation.id}/queue`, { headers: { cookie } })
    ).json()) as { orderId: string }[];
    expect(queueAfterRefusal.find((g) => g.orderId === openId)).toBeUndefined();
  });
});

// KDS-1 collect fix — the Mode-P counter handover. A settled walk-up fired to the kitchen and walked to
// `ready` is handed to the customer via POST /api/orders/:id/collect — the NON-FISCAL marker that stamps
// `collected_at` and drops the order off the station display (the very thing the regression made
// impossible: a settled order was immutable, so a fired Mode-P order lingered forever). Real Postgres,
// because it needs a genuine fiscal settle (`POST /api/sales`, Mode P's walk-up) plus the 0056
// enforce_transition relaxation — neither of which the hermetic stub `FiscalBackend` can exercise.
describe("POST /api/orders/:id/collect — Mode P's counter handover", () => {
  it("hands over a fired, ready order: 200, collected_at stamped, off the station queue; a still-OPEN order is refused working_order.not_settled", async () => {
    const { cfg, available, operatorId } = await setupVenue(); // default mode: prepay
    const each = available.find((p) => p.pricingUnit === "each")!;

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginSession(app, cfg, operatorId);
    // SP-A.2 cutover: the walk-up sale resolves its till from an enrolled till device (venue's own till).
    const deviceCookie = await enrolTillCookie(cfg);

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
    const queued = (await (await app.request(queueUrl, { headers: { cookie } })).json()) as {
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
    const readyQueue = (await (await app.request(queueUrl, { headers: { cookie } })).json()) as {
      orderId: string;
    }[];
    expect(readyQueue.map((g) => g.orderId)).toEqual([workingOrderId]);

    // Hand it over — the new non-fiscal collect route (an empty body; it needs only the id).
    const collect = await app.request(`/api/orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(collect.status).toBe(200);

    // collected_at is stamped (direct witness) AND the order is GONE from the station queue.
    const [wo] = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ collected: sql<boolean>`collected_at is not null`, status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, workingOrderId));
    });
    expect(wo).toEqual({ collected: true, status: "settled" }); // fiscal state untouched; only the marker moved
    const afterCollect = await app.request(queueUrl, { headers: { cookie } });
    expect(await afterCollect.json()).toEqual([]);

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

// A handheld can file node-keyed cash and manual-card sales. Integrated payment, reprint,
// drawer and prep mutation routes remain fenced even with a valid device cookie and operator session.
// Real PostgreSQL exercises device lookup and fiscal writes as app_user; PGlite's default
// superuser cannot establish that the deployment role holds the required grants.
describe("handheld firewall (a handheld may settle a cash or manual-card sale, but not integrated pay, reprint, open the drawer, place, collect, or cancel)", () => {
  /** Enrol a REAL handheld device in `cfg`'s tenant (no station — a handheld form factor binds none — it is
   * false, Task 2), returning the `waitron_device=<id>.<token>` cookie pair a handheld carries. The
   * token's scrypt hash actually verifies, so `tryReadDevice` resolves it to a genuine `handheld`
   * binding rather than folding into a miss. */
  async function enrolHandheldCookie(cfg: TillConfig): Promise<string> {
    // A handheld is DEFINED by a `phone-portrait`/`tablet-landscape` profile (Task 7) and, being
    // sale-capable, binds an EXISTING register at enrol — the venue's own till (SP-A.2 §16.4).
    const profileId = await seedProfileFF(cfg, "phone-portrait");
    const dev = await enrolDeviceForTest(suite.admin, cfg, {
      name: "Waiter phone",
      profileId,
      registerId: cfg.tillId,
    });
    return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
  }

  /** Log in through the HTTP surface and return just the `name=value` session cookie pair (stripping
   * the Set-Cookie attributes), so it can be combined with a device cookie in one `Cookie` header. The
   * login is DEVICE-GATED (§5/§6), so it enrols a throwaway `till` device for the login itself; each
   * handheld test then carries its OWN handheld/till device cookie on the sale/pay call. */
  async function loginOperator(app: Hono, cfg: TillConfig, operatorId: string): Promise<string> {
    const loginDeviceCookie = await enrolTillCookie(cfg);
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginDeviceCookie },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    return login.headers.get("set-cookie")!.split(";")[0]!;
  }

  it("allows a handheld CASH sale (200) and files exactly one chained registro under the node/SIF — parity with a counter cash sale", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);

    // The owner reversed the order-only firewall for the CASH tender (2026-08-30): a handheld may SETTLE a
    // cash sale because the fiscal chain is keyed by the submitting NODE (`nodeId`), not the till
    // (record-sale.ts:79-82 — "Which node processes and chains the sale — the SIF/chain/series key"), so a
    // handheld files under its node's SIF exactly like a till. The handheld holds BOTH a valid operator
    // session AND a real handheld cookie. Prove-by-deletion: add an `assertNotHandheld` back onto
    // `POST /api/sales` and this same request 403s instead.
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/); // NumSerieFactura-shaped, e.g. "A/1"

    // Exactly ONE chained fiscal record for this (own) tenant, INDISTINGUISHABLE from a counter cash
    // record: the same chain-opening shape the "ordinary till" mixed-cash test above asserts (own tenant,
    // node = cfg.nodeId — the SIF is the node, not the till — secuencia 1, primerRegistro, no predecessor
    // pointer, a 64-hex huella), plus the deployment `entorno` this test additionally pins. `tillId` is
    // separate device metadata; it never keys the chain.
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId))
        .orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(1);
    const [only] = registros;
    expect(only!.tenantId).toBe(cfg.tenantId);
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
    const sessionPair = await loginOperator(app, cfg, operatorId);

    // The reversal was widened (2026-08-30) from cash to cash OR a MANUAL card tender: the `card` tender
    // on `POST /api/sales` is the datáfono / unintegrated tender — the operator charges the card on a
    // SEPARATE bank terminal the POS never talks to (`recordManualCardPayment` makes NO network call), so
    // it is fiscally identical to a cash sale: the SAME chained registro under the node's SIF (`nodeId`,
    // record-sale.ts:79-82), differing only by the one captured `payments` row it adds. `/api/sales` is
    // therefore no longer fenced against a handheld at all — only the INTEGRATED reader (`POST /api/pay`)
    // stays fenced. The handheld holds BOTH a valid operator session AND a real handheld cookie.
    // Prove-by-deletion: re-add an `assertNotHandheld(deps, c, "record_sale_card")` on `POST /api/sales`
    // and this same request 403s instead.
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

    // Exactly ONE chained fiscal record, INDISTINGUISHABLE from a counter card record: the SAME
    // chain-opening shape the handheld cash parity test above asserts (own tenant, node = cfg.nodeId — the
    // SIF is the node, not the till — secuencia 1, primerRegistro, no predecessor pointer, a 64-hex
    // huella), plus the deployment `entorno`. `tillId` is separate device metadata; it never keys the chain.
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId))
        .orderBy(registrosFacturacion.secuencia);
    });
    expect(registros).toHaveLength(1);
    const [only] = registros;
    expect(only!.tenantId).toBe(cfg.tenantId);
    expect(only!.nodeId).toBe(cfg.nodeId);
    expect(only!.secuencia).toBe(1);
    expect(only!.primerRegistro).toBe(true);
    expect(only!.anteriorHuella).toBeNull();
    expect(only!.huella).toMatch(/^[0-9A-F]{64}$/);
    expect(only!.entorno).toBe(deploymentEnvironment(process.env));

    // The manual-card side effect a cash sale does NOT have: exactly one CAPTURED `payments` row for the
    // sale, under the sentinel `manual` provider with a freshly minted `manual-…` ref — no reader, no
    // network call (`recordManualCardPayment` commits inline in the sale transaction). Read on the
    // superuser admin — the `paymentsFor`/`paymentCount` shape in `working-order.pg.test.ts`.
    const paymentRows = await suite.admin.execute<{
      provider: string;
      state: string;
      payment_ref: string;
    }>(sql`select provider, state, payment_ref from payments where tenant_id = ${cfg.tenantId}`);
    expect(paymentRows.rows).toHaveLength(1);
    expect(paymentRows.rows[0]!.provider).toBe(MANUAL_PROVIDER);
    expect(paymentRows.rows[0]!.state).toBe("captured");
    expect(paymentRows.rows[0]!.payment_ref).toMatch(/^manual-/);
  });

  it("allows a sale from an enrolled TILL device (not a handheld) — operator session + till-device cookie — 200", async () => {
    // The counterpart to the handheld cases: a `till`-kind device is NOT refused, and post-cutover its
    // enrolled `till_id` (the venue's own till) is what the sale files under. (Pre-cutover this was an
    // ordinary env-till with no device cookie; the cutover retires that path — the no-cookie sale is now
    // refused `device.unauthorized`, pinned by the cutover negative test near the top of this file.)
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);
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

  // The SAME firewall fences the other fiscal/cash routes a handheld must never reach: paying over the
  // integrated terminal, reprinting a filed sale's ticket, and opening the cash drawer. Each guard runs
  // immediately after the route's `requireSession` — BEFORE the pay provider guard, the reprint id parse,
  // and the drawer printer resolution — so an active handheld binding is refused 403 regardless of card
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
      const sessionPair = await loginOperator(app, cfg, operatorId);

      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("device.forbidden_action");
    },
  );

  // SP-A.2 §16 (Task 14) + device-profile §5.3 (Task 9): the handheld firewall on `/api/pay` and
  // `/api/drawer/open` is the GENERALISED capability firewall — a device is refused unless its assigned
  // device PROFILE declares the required flag, not merely because its kind is `handheld`. This drives the
  // capability path directly: a device whose profile declares `capabilities: []` is refused `/api/pay`
  // even though its kind is not consulted. Prove-by-deletion: remove
  // `assertDeviceCapability(deps, c, "integrated-card-payment", "pay")` from `/api/pay` and this request
  // proceeds past the fence (a `card.*`/id error, never the 403 the fence exists to raise).
  it("refuses /api/pay from a device whose assigned PROFILE LACKS integrated-card-payment (403 device.forbidden_action)", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // Author a capability-less handheld device profile and enrol a device bound to it.
    const prof = await suite.admin.execute<{ id: string }>(sql`
      insert into device_profiles (tenant_id, name, form_factor, capabilities)
      values (${cfg.tenantId}, 'Waiter phone', 'phone-portrait', ${JSON.stringify([])}::jsonb)
      returning id`);
    const deviceProfileId = prof.rows[0]!.id;
    const dev = await enrolDeviceForTest(suite.admin, cfg, {
      name: "Waiter phone",
      profileId: deviceProfileId,
      registerId: cfg.tillId,
    });
    const deviceCookie = `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
    const sessionPair = await loginOperator(app, cfg, operatorId);

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({ id: randomUUID() }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("device.forbidden_action");
  });

  // C1 (whole-branch review): the two ORDER-SETTLEMENT routes a handheld reaches through its own order
  // screens must be fenced too — they file a CHAINED fiscal record, the unrecoverable one (CLAUDE.md
  // §5). `POST /:id/place` files a deferred invoice in a Mode-I (invoice-first) venue; `POST /:id/collect`
  // files the immediate sale (Mode T) or settles the deferred invoice (Mode I). Each test drives a REAL
  // order end to end: the handheld is refused 403 having filed NOTHING, then an enrolled TILL device
  // (post-cutover a sale route resolves its till from the device, not env) completes the same order and
  // files exactly one chained record — so removing the `assertNotHandheld` guard flips the handheld case
  // to a 200 that files the record the guard exists to prevent (prove-by-deletion).
  it("refuses a handheld PLACE (Mode I) with 403, filing nothing; an ordinary till places and files one record", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // Flip to invoice-first (Mode I), so PLACE files the DEFERRED chained invoice — the fiscal write the
    // firewall protects. Same two-part flip (DB column + in-memory cfg) the Mode-T test above makes.
    await suite.admin.execute(
      sql`update locations set order_flow = 'invoice_first' where id = ${cfg.locationId}`,
    );
    await suite.admin.execute(sql`
      update departments set default_service_mode = 'invoice_first'
      where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId}`);
    const modeCfg: TillConfig = { ...cfg, orderFlow: "invoice_first" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);

    // Park a real order (order-taking IS allowed for a handheld; only settlement is fenced) with the
    // ordinary-till session, so both actors below operate on a genuine open order.
    const workingOrderId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionPair },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
      }),
    });
    expect(park.status).toBe(200);

    // The handheld — valid operator session AND a real handheld cookie — is refused 403 BEFORE the id
    // parse or any fiscal write.
    const refused = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie: `${sessionPair}; ${deviceCookie}` },
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("device.forbidden_action");
    // Nothing was filed — the unrecoverable chained record the guard protects (CLAUDE.md §5).
    const afterRefused = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(afterRefused.length).toBe(0);

    // An enrolled TILL device (venue's own till) places the SAME order and files exactly one deferred
    // invoice — post-cutover a place resolves its till from the device, not env (the record is unchanged
    // because the device's till equals the venue till).
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie: `${sessionPair}; ${tillDeviceCookie}` },
    });
    expect(placed.status).toBe(200);
    expect((await placed.json()).invoiceNumber).toMatch(/^A\/\d+$/);
    const afterPlaced = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(afterPlaced.length).toBe(1);
  });

  it("refuses a handheld COLLECT (Mode T) with 403, filing nothing; an ordinary till collects and files one record", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // Mode T (ticket_then_pay): COLLECT files `recordSale` immediate — the chained write. PLACE files
    // nothing under Mode T, so the pre-collect setup writes no fiscal record.
    await suite.admin.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    // A separate TILL device (venue's own till) for the place-setup + collect completion — both are sale
    // routes post-cutover and resolve their till from the enrolled device, not env.
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);

    // Park + place a real order as the ordinary till (Mode T files nothing at placing).
    const workingOrderId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionPair },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
      }),
    });
    expect(park.status).toBe(200);
    const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie: `${sessionPair}; ${tillDeviceCookie}` },
    });
    expect(placed.status).toBe(200);

    // The handheld is refused 403 BEFORE any fiscal write.
    const refused = await app.request(`/api/working-orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("device.forbidden_action");
    const afterRefused = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, cfg.tenantId));
    });
    expect(afterRefused.length).toBe(0);

    // An enrolled till device collects the SAME order and files exactly one chained record.
    const collect = await app.request(`/api/working-orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${sessionPair}; ${tillDeviceCookie}`,
      },
      body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
    });
    expect(collect.status).toBe(200);
    expect((await collect.json()).invoiceNumber).toMatch(/^A\/\d+$/);
    const after = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return {
        wo: await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, workingOrderId)),
        registros: await tx
          .select()
          .from(registrosFacturacion)
          .where(eq(registrosFacturacion.tenantId, cfg.tenantId)),
      };
    });
    expect(after.wo).toEqual([{ status: "settled" }]);
    expect(after.registros.length).toBe(1);
  });

  // I3 (whole-branch review): `POST /:id/cancel` appends an `order_cancelled` entry to the tamper-evident
  // hash-chained amendment log — a fiscal-adjacent mutation a handheld must not perform. No fiscal doc is
  // filed by cancel, so the prove-by-deletion signal is the order's TRANSITION: refused, it stays
  // `placed`; allowed, the ordinary till drives it to `abandoned`.
  it("refuses a handheld CANCEL with 403, leaving the order placed; an ordinary till cancels it", async () => {
    const { cfg, available, operatorId } = await setupVenue(); // default mode: prepay
    const each = available.find((p) => p.pricingUnit === "each")!;
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    const deviceCookie = await enrolHandheldCookie(cfg);
    const sessionPair = await loginOperator(app, cfg, operatorId);

    // Park + place a real order as the ordinary till, so there is a PLACED order to cancel. Place is a
    // sale route post-cutover, so its completion carries an enrolled till device (the venue's own till);
    // cancel is NOT a sale route (stays env), so the cancel calls below need no device cookie.
    const tillDeviceCookie = await enrolTillCookie(cfg);
    const workingOrderId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionPair },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
      }),
    });
    expect(park.status).toBe(200);
    const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie: `${sessionPair}; ${tillDeviceCookie}` },
    });
    expect(placed.status).toBe(200);

    // The handheld is refused 403 BEFORE any transition or amendment write.
    const refused = await app.request(`/api/working-orders/${workingOrderId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionPair}; ${deviceCookie}` },
      body: JSON.stringify({ reason: "customer left" }),
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("device.forbidden_action");
    const stillPlaced = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, workingOrderId));
    });
    expect(stillPlaced).toEqual([{ status: "placed" }]); // no transition — the guard held

    // The ordinary till cancels the SAME order (placed → abandoned).
    const cancelled = await app.request(`/api/working-orders/${workingOrderId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionPair },
      body: JSON.stringify({ reason: "customer left" }),
    });
    expect(cancelled.status).toBe(200);
    const abandoned = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, workingOrderId));
    });
    expect(abandoned).toEqual([{ status: "abandoned" }]);
  });
});
