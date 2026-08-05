import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
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
import { hashPin } from "@waitron/identity";
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
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: this drives `POST /api/sales` through the HTTP surface to a GENUINE
// chained fiscal record written by the app role under RLS. PGlite runs every connection as a
// superuser, which bypasses RLS and cannot prove the deployment role is permitted to write
// `registros_facturacion` (CLAUDE.md §4). The 401-without-session guards and the products list live
// in the hermetic `till-api.test.ts`; only the chained-write happy path needs a container. Setup
// mirrors `till-sale.test.ts` (Task 3) — a provisioned venue + a seeded catalogue, a real
// `VerifactuBackend` and the system clock — and then adds a login person and the HTTP driving.
const LOCALE = "es-ES";

const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });

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
      throw new Error("till-api.realpg.test: anchor() is not used by recordSale");
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
  available: AvailableProduct[];
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
      admin: { displayName: "Administradora", pinHash: hashPin("1234") },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const { available, operatorId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: "Comida" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      descriptions: { [LOCALE]: "Jamón cortado" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    // A staff person with a KNOWN PIN ("5555"), inserted on the app role (which holds INSERT on
    // `persons`), so the login route can verify their credential and the sale is attributed to them.
    const person = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'Cajera', ${hashPin("5555")}, 'staff') returning id`);
    return {
      available: await listAvailableProducts(tx, cfg.locationId),
      operatorId: person.rows[0]!.id,
    };
  });
  return { cfg, available, operatorId };
}

/** The till API's deps for a provisioned venue: the owner connection (routes drop to `app_user`
 * themselves via `withTenant` + `asAppUser`), the real fiscal backend + system clock the sale path
 * files through, and `secureCookies:false` so the session cookie rides the non-TLS `app.request`. */
function apiDeps(cfg: TillConfig): TillApiDeps {
  return { db: suite.admin, backend, clock, cfg, secureCookies: false };
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
        new Error("till-api.realpg.test: resolveClient must never be called by recordSale"),
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
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);

    // 2. Ring a sale with that cookie: 2 × 1.50 = 3.00 total, 5.00 tendered → 2.00 change.
    const saleRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [{ productId: each.id, quantity: "2" }],
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
    expect(ticket.change).toBe("2.00");
    expect(ticket.vatBreakdown).toEqual([{ rate: "21.00", base: "2.48", tax: "0.52" }]);
    expect(ticket.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO-8601 instant
    // VerifactuBackend always sets a verification URL, so the QR is a non-empty string.
    expect(typeof ticket.qr).toBe("string");
    expect(ticket.qr.length).toBeGreaterThan(0);

    // 4. A GENUINE chained fiscal record exists for this tenant/node — one, hashed (own tenant, so
    // the count is order-independent).
    const registros = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(registrosFacturacion);
    });
    expect(registros.length).toBe(1);
    expect(registros[0]!.tenantId).toBe(cfg.tenantId);
    expect(registros[0]!.nodeId).toBe(cfg.nodeId);
    expect(registros[0]!.huella).toMatch(/^[0-9A-F]{64}$/);

    // 5. The sale is attributed to the logged-in operator — the whole point of the session guard.
    const saleRows = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select({ operatorId: sales.operatorId }).from(sales);
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
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);

    // 2. The operator sees the menu: GET /api/products returns the seeded catalogue. The sale lines
    // are built FROM this response, exactly as the real till does (it never invents product ids).
    const productsRes = await app.request("/api/products", { headers: { cookie } });
    expect(productsRes.status).toBe(200);
    const products = (await productsRes.json()) as {
      id: string;
      pricingUnit: "each" | "weight";
      descriptions: Record<string, string>;
    }[];
    // The two seeded, sellable products come back — the reduced-rate weighed one and the
    // general-rate each one — so the basket below genuinely mixes VAT rates.
    expect(products.map((p) => p.descriptions[LOCALE]).sort()).toEqual([
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
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [
          { productId: jamon.id, quantity: "0.200" },
          { productId: agua.id, quantity: "2" },
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
    expect(ticket.change).toBe("2.02"); // operational efectivo/cambio line
    // The QR is the AEAT verification URL — required on every RRSIF invoice, so a non-empty string.
    expect(typeof ticket.qr).toBe("string");
    expect(ticket.qr.length).toBeGreaterThan(0);

    // 5. Ring a SECOND identical mixed sale so the chain has a predecessor to link to. Same cookie,
    // same app — invoice A/2.
    const secondRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [
          { productId: jamon.id, quantity: "0.200" },
          { productId: agua.id, quantity: "2" },
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
      return tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
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
