import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
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
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import { DEV_DEVICE_HEADER, DEVICE_COOKIE } from "./device-session.js";

/**
 * The H2 fiscal receipt for the SP-A.2 device-unification cutover — the REAL-Postgres arm (spec
 * §16.4(b) mutation control + §16.4(c) `nodeId` untouched). The cutover (`requireSaleTillId`,
 * `device-session.ts`) moved a sale's `till_id` from the env `WAITRON_TILL_TILL_ID` to the
 * AUTHENTICATED enrolled device's assigned `tills` row; `nodeId`/`seriesId` (the SIF and chain
 * anchor) still come from `cfg`. This suite drives the ACTUAL `POST /api/sales` route over HTTP,
 * with a real `waitron_device` cookie, to a GENUINE chained fiscal record written by the app role
 * under RLS — the one place the whole cutover path (device auth -> `requireSaleTillId` ->
 * `saleCfg = { ...cfg, tillId }` -> `recordSale`) runs end to end.
 *
 * Real Postgres, not PGlite (CLAUDE.md §4): this proves the deployment role, under RLS, resolves a
 * device's `till_id` and files it, while `node_id` stays `cfg`'s — a privilege/RLS property PGlite
 * (every connection a superuser) cannot show. The byte-identity huella-inertness half of §16.4(b) —
 * two first-of-chain records differing only in `till_id` hash identically — is a determinism property
 * that needs no container and lives in `packages/fiscal-verifactu/src/write-path.e2e.test.ts`
 * ("till_id is inert to the huella and the chain"), beside its `entorno`/`parent_line_id` precedents.
 *
 * Setup mirrors `till-api.rls.test.ts`: a provisioned venue + a seeded catalogue + a login person, a
 * real `VerifactuBackend` and the system clock.
 */
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

const noopLog: Logger = () => {};

/** The wall clock reported as already anchored — the identical stub shape `till-api.rls.test.ts`
 *  documents. `recordSale` reads `now()` once and touches neither `anchor` nor `currentAnchor`. */
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

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF — the same local counter `till-api.rls.test.ts`
// uses for the same reason.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(61_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** Provision a fresh chained venue (its own tenant, so the `registros_facturacion`/`sales` counts are
 *  this test's alone — order-independent, CLAUDE.md §4), seed a catalogue + a `each` product and a
 *  login person with a known PIN. Returns the cfg (whose `tillId` is the venue's own till X), the
 *  venue's `locationId`, the sellable product, and the operator to attribute the sale to. */
async function setupVenue(): Promise<{
  cfg: TillConfig;
  locationId: string;
  product: AvailableProduct;
  operatorId: string;
}> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const { product, operatorId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { es: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const person = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'Cajera', ${hashPin("5555")}, 'staff') returning id`);
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    return {
      product: available.find((p) => p.pricingUnit === "each")!,
      operatorId: person.rows[0]!.id,
    };
  });
  return { cfg, locationId: venue.locationId, product, operatorId };
}

/** A SECOND `tills` row in the SAME tenant and location as the venue's own till — the register a
 *  re-homed / second device would ring against. Inserted on the owner connection directly (fixture
 *  setup, not the code under test), returning its id. */
async function insertTill(cfg: TillConfig, locationId: string, name: string): Promise<string> {
  const till = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${cfg.tenantId}, ${locationId}, ${name}) returning id`);
  return till.rows[0]!.id;
}

/** Enrol a REAL `till`-kind device bound to `boundTillId`, and return the `waitron_device=<id>.<token>`
 *  cookie a booting till carries — the mint->redeem runs on the app role under the tenant (the
 *  production enrol path), so the scrypt hash verifies and `tryReadDevice` resolves a genuine binding.
 *  The sale route now resolves `till_id` from THIS device (`requireSaleTillId`). */
async function enrolTillCookie(cfg: TillConfig, boundTillId: string): Promise<string> {
  const { code } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      tillId: boundTillId,
      canvasId: null,
      label: "Counter till",
    });
  });
  const dev = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return enrolDevice(tx, cfg, { code });
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Enrol a REAL `till`-kind device bound to `boundTillId` and return its raw `deviceId` (not a cookie)
 *  — the id the SP-C dev-override header (`x-waitron-dev-device`) carries in place of the cookie. Same
 *  genuine mint->redeem enrol path as {@link enrolTillCookie}. */
async function enrolTillDeviceId(cfg: TillConfig, boundTillId: string): Promise<string> {
  const { code } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      tillId: boundTillId,
      canvasId: null,
      label: "Dev-override till",
    });
  });
  const dev = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return enrolDevice(tx, cfg, { code });
  });
  return dev.deviceId;
}

function apiDeps(cfg: TillConfig): TillApiDeps {
  return { db: suite.admin, backend, clock, cfg, secureCookies: false, venueLocale: cfg.locale };
}

/** Log in through the HTTP surface and return the session cookie the route sets. */
async function login(app: Hono, operatorId: string): Promise<string> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!;
}

/** Ring one cash sale of two units of `productId`, carrying the session + device cookies, and assert
 *  the route returned a ticket (200). The device cookie is what `requireSaleTillId` reads. */
async function ringSale(
  app: Hono,
  sessionCookie: string,
  deviceCookie: string,
  productId: string,
): Promise<void> {
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${sessionCookie}; ${deviceCookie}` },
    body: JSON.stringify({
      lines: [{ productId, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    }),
  });
  expect(res.status).toBe(200);
}

interface Registro {
  tillId: string;
  nodeId: string;
  secuencia: number;
  huella: string;
  anteriorHuella: string | null;
  entorno: string | null;
  numSerieFactura: string;
}

/** Every fiscal record filed for the tenant, oldest first — one per sale, this tenant's alone. */
async function registrosFor(cfg: TillConfig): Promise<Registro[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await tx
      .select({
        tillId: registrosFacturacion.tillId,
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

/** Each sale's stored `sales.till_id`, ordered by the per-series `invoice_number` (1, 2, …) so it
 *  lines up with the registros ordered by `secuencia`. */
async function saleTillIds(cfg: TillConfig): Promise<string[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await tx
      .select({ tillId: sales.tillId, invoiceNumber: sales.invoiceNumber })
      .from(sales);
    return rows.sort((a, b) => a.invoiceNumber - b.invoiceNumber).map((r) => r.tillId);
  });
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
        new Error("sale-till-source.receipt: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("H2 receipt: sale-time till_id resolves from the device, the chain does not (SP-A.2 §16.4)", () => {
  it("files each sale under the AUTHENTICATED device's till, changing ONLY till_id — node/series/chain untouched", async () => {
    // Two `till`-kind devices in ONE tenant/node, bound to two DIFFERENT tills X and Y. Ringing a sale
    // via device-X then device-Y files two records on the SAME chain (secuencia 1, 2) whose ONLY
    // difference is the `till_id` snapshot — the device resolved the till, and nothing device-derived
    // touched `node_id`, `series` or the hash chain.
    //
    // Failing case (§16.4): if the device path sourced a DIFFERENT till_id than the one it is bound to,
    // the resolution assertion fails; if a device / canvas / hardware code path perturbed `node_id` or
    // forked the series, the two records would NOT share one continuous chain and `node_id` would not
    // equal `cfg.nodeId`.
    const { cfg, locationId, product, operatorId } = await setupVenue();
    const tillX = cfg.tillId;
    const tillY = await insertTill(cfg, locationId, "Caja 2");
    expect(tillY).not.toBe(tillX);

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const sessionCookie = await login(app, operatorId);

    // Sale 1 via a device bound to till X (the venue's own till).
    const deviceX = await enrolTillCookie(cfg, tillX);
    await ringSale(app, sessionCookie, deviceX, product.id);

    // Sale 2 via a device bound to till Y — same tenant, same node, same operator, same basket.
    const deviceY = await enrolTillCookie(cfg, tillY);
    await ringSale(app, sessionCookie, deviceY, product.id);

    const registros = await registrosFor(cfg);
    expect(registros).toHaveLength(2);
    const [first, second] = registros;

    // (resolution + the one intended metadata change, §16.4) Each record's till_id is the till its
    // ringing DEVICE was bound to — X then Y — not a single env value. This is the whole cutover.
    expect(first!.tillId).toBe(tillX);
    expect(second!.tillId).toBe(tillY);
    expect(first!.tillId).not.toBe(second!.tillId);
    // The same movement on the `sales` row itself.
    expect(await saleTillIds(cfg)).toEqual([tillX, tillY]);

    // (§16.4(c) nodeId untouched) BOTH records file under `cfg.nodeId` — the SIF anchor — regardless
    // of which device rang them. A `DeviceBinding` carries no node, and `saleCfg = { ...cfg, tillId }`
    // keeps `nodeId` from `cfg`; if the device path were ever wired to influence `nodeId`, one of these
    // would differ and a device on another node would silently fork the SIF.
    expect(first!.nodeId).toBe(cfg.nodeId);
    expect(second!.nodeId).toBe(cfg.nodeId);

    // (§16.4(b) mutation control) The two records form ONE continuous chain under the same node: the
    // second's predecessor pointer IS the first's huella, sequence 1 -> 2, both in series A. Only the
    // till_id moved; the chain, its ordering and its series are inert to the device's till.
    expect(first!.secuencia).toBe(1);
    expect(first!.anteriorHuella).toBeNull();
    expect(second!.secuencia).toBe(2);
    expect(second!.anteriorHuella).toBe(first!.huella);
    expect(first!.numSerieFactura).toBe("A/1");
    expect(second!.numSerieFactura).toBe("A/2");
    expect(second!.entorno).toBe(first!.entorno);
  });
});

describe("SP-C: a sale posted with the dev-override header files under THAT device's till (devMode)", () => {
  it("resolves sale-time till_id from the x-waitron-dev-device header, not the env/cfg till", async () => {
    // The §7 fiscal boundary for the dev switcher: under `devMode`, a `POST /api/sales` carrying the
    // `x-waitron-dev-device: <id>` header (no `waitron_device` cookie) must resolve `sales.till_id` from
    // THAT device's binding — the same `requireSaleTillId`/`tryReadDevice` path the cookie takes, reached
    // through the dev override rather than the cookie. Device is bound to till Y (not the venue's own
    // till X), so a pass proves the OVERRIDE drove the till, not a default to cfg.tillId.
    //
    // Failing case: were the override ignored (or `devMode` not forwarded to `requireSaleTillId`), the
    // route would fall through to `device.unauthorized` (401, no cookie) — never file under till Y. This
    // pins the composition SP-A.2's huella receipt already covers on the inertness side; till_id movement
    // via the header is the new surface, so only that is asserted here.
    const { cfg, locationId, product, operatorId } = await setupVenue();
    const tillX = cfg.tillId;
    const tillY = await insertTill(cfg, locationId, "Caja override");
    expect(tillY).not.toBe(tillX);

    // devMode ON: `mountTillApi`'s deps forward `devMode` to `requireSaleTillId`, which is what makes the
    // override header live (byte-for-byte inert otherwise — the boot.test.ts fail-closed arm proves that).
    const app = new Hono();
    mountTillApi(app, { ...apiDeps(cfg), devMode: true }, noopLog);
    const sessionCookie = await login(app, operatorId);

    const deviceY = await enrolTillDeviceId(cfg, tillY);
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
        [DEV_DEVICE_HEADER]: deviceY,
      },
      body: JSON.stringify({
        lines: [{ productId: product.id, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(res.status).toBe(200);

    // The one sale filed under till Y (the overridden device's binding), NOT the venue's own till X.
    expect(await saleTillIds(cfg)).toEqual([tillY]);
  });
});
