import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, sales, withTenant, workingOrders } from "@waitron/db";
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

// Real Postgres, not PGlite: this drives `POST /api/sales` and the `/api/working-orders` routes
// through the HTTP surface to a GENUINE chained fiscal record written by the app role under RLS.
// PGlite runs every connection as a superuser, which bypasses RLS and cannot prove the deployment
// role is permitted to write `registros_facturacion` (CLAUDE.md §4). The 401-without-session guards,
// the products list and the park/list/retrieve/update/abandon route LOGIC live in the hermetic
// `till-api.test.ts`; what needs a container is the chained-write happy path AND the pay-idempotency
// crux (a lost-response pay retry must REPLAY the ticket, filing no second chained record — spec §3),
// which only a real fiscal write proves. Setup mirrors `till-sale.test.ts` (Task 3) — a provisioned
// venue + a seeded catalogue, a real `VerifactuBackend` and the system clock — plus a login person.
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
      throw new Error("till-api.rls.test: anchor() is not used by recordSale");
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
        new Error("till-api.rls.test: resolveClient must never be called by recordSale"),
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

describe("/api/working-orders → pay (park & retrieve, idempotent over HTTP)", () => {
  it("parks an order, retrieves it, pays it via POST /api/sales, and a replay refiles nothing", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);

    // 1. Log in and capture the session cookie.
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;

    // 2. Park an order (client-minted id, its own idempotency key) with 2 × 1.50. Fresh tenant+node
    //    per test, so the allocated order number is deterministically 1.
    const workingOrderId = randomUUID();
    const parkRes = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ productId: each.id, quantity: "2" }],
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
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ productId: each.id, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    });
    expect(pay.status).toBe(200);
    const ticket = await pay.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(ticket.total).toBe("3.00");
    expect(ticket.change).toBe("2.00");
    expect(ticket.qr.length).toBeGreaterThan(0); // a genuine first filing carries the AEAT QR

    // 5. Exactly ONE chained fiscal record; the working order is now `settled` and the sale is filed
    //    under its id and attributed to the logged-in operator.
    const after = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
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
    //    retrieve (spec §3): invoice numbers are never reused, so a double filing is unrepairable.
    const replay = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        workingOrderId,
        lines: [{ productId: each.id, quantity: "2" }],
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
    expect(replayTicket.change).toBe("0.00");

    // Still exactly ONE record — the replay filed nothing.
    const stillOne = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(registrosFacturacion);
    });
    expect(stillOne).toHaveLength(1);
  });
});

// Task 9's prep surface over HTTP: place → prep-queue → advance → collect. Real Postgres because
// `collect` under Mode T (`ticket_then_pay`) files `recordSale` IMMEDIATE at collect — a genuine
// chained fiscal write as the app role under RLS, exactly what `till-api.test.ts`'s stub
// `FiscalBackend` cannot exercise (that hermetic suite proves only the malformed-id short-circuit,
// which never reaches the backend at all). `place`/`prep-queue`/`prep`-advance need no fiscal write
// under Mode T (no doc issues until collect), but are driven through the SAME real venue here so the
// one test walks the whole route surface end to end, the way an actual till session would.
describe("/api/working-orders/:id/place → :id/prep → GET /api/prep-queue → :id/collect (Task 9, over HTTP)", () => {
  it("Mode T: place files no fiscal doc; the prep queue tracks it; collect files the sale at collect", async () => {
    const { cfg, available, operatorId } = await setupVenue();
    // Flip this venue's location to `ticket_then_pay` (Mode T) — `setupVenue` provisions the DEFAULT
    // `prepay`, so both the DB column and the in-memory cfg are updated together, the same two-part
    // flip `working-order.rls.test.ts`'s `modeVenue` makes.
    await suite.admin.execute(
      sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
    );
    const modeCfg: TillConfig = { ...cfg, orderFlow: "ticket_then_pay" };
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const app = new Hono();
    mountTillApi(app, apiDeps(modeCfg), noopLog);

    // 1. Log in.
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;

    // 2. Park then PLACE: 2 × 1.50 = 3.00. Mode T files NO fiscal doc at placing.
    const workingOrderId = randomUUID();
    const park = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: workingOrderId,
        lines: [{ productId: each.id, quantity: "2" }],
        label: "Mesa 9",
      }),
    });
    expect(park.status).toBe(200);
    const placed = await app.request(`/api/working-orders/${workingOrderId}/place`, {
      method: "POST",
      headers: { cookie },
    });
    expect(placed.status).toBe(200);
    expect(await placed.json()).toEqual({ id: workingOrderId, status: "placed" });

    const noSaleYet = await withTenant(suite.admin, modeCfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(noSaleYet).toEqual([]); // Mode T: nothing filed at placing

    // 3. The NODE-SCOPED prep queue shows it `queued` — send-to-prep = placing (design §5).
    const queue1 = await app.request("/api/prep-queue", { headers: { cookie } });
    expect(queue1.status).toBe(200);
    expect(await queue1.json()).toEqual([
      {
        id: workingOrderId,
        orderNumber: expect.any(Number),
        label: "Mesa 9",
        state: "queued",
        queuedAt: expect.any(String),
      },
    ]);

    // 4. Advance the prep state over HTTP: queued → preparing → ready → collected.
    for (const to of ["preparing", "ready", "collected"]) {
      const advance = await app.request(`/api/working-orders/${workingOrderId}/prep`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });
      expect(advance.status).toBe(200);
    }
    // Collected leaves the ACTIVE queue.
    const queue2 = await app.request("/api/prep-queue", { headers: { cookie } });
    expect(await queue2.json()).toEqual([]);

    // 5. COLLECT: Mode T files `recordSale` IMMEDIATE here, placed → settled — the genuine chained
    // fiscal write this real-Postgres suite exists to prove.
    const collect = await app.request(`/api/working-orders/${workingOrderId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tender: { method: "cash", amount: "5.00" } }),
    });
    expect(collect.status).toBe(200);
    const ticket = await collect.json();
    expect(ticket.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(ticket.total).toBe("3.00");
    expect(ticket.change).toBe("2.00");
    expect(ticket.qr.length).toBeGreaterThan(0); // a genuine fresh filing carries the AEAT QR

    const after = await withTenant(suite.admin, modeCfg.tenantId, async (tx) => {
      await asAppUser(tx);
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
  });
});
