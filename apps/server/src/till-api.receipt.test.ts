import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  drawerOpens,
  locations,
  printJobs,
  sales,
  tills,
  withTenant,
} from "@waitron/db";
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
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { DRAWER_KICK } from "./receipt-print.js";
import { bytesInclude, decodeTicket } from "./testing/decode-ticket.js";

// REAL Postgres, not PGlite: the manual reprint + drawer-open routes read a GENUINE chained fiscal
// sale back and enqueue paper through the app role (CLAUDE.md §4 — PGlite runs every connection as a
// superuser holding every grant). Setup mirrors `till-api.pg.test.ts` (a provisioned
// venue + a seeded catalogue + a login person, a real `VerifactuBackend` + system clock) plus the
// receipt-printer config helpers from `receipt-print.test.ts`.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

const noopLog: Logger = () => {};

/** The wall clock, already anchored — the stub `till-api.pg.test.ts` documents; `recordSale` reads
 *  `now()` once and touches neither `anchor` nor `currentAnchor`. */
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
      throw new Error("till-api.receipt.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Each provisioned venue needs its own NIF (`tenants_country_tax_id_key` is unique and tenants
// accumulate for the shared container's life).
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(64_000_000 + nifCounter).padStart(8, "0")}K`;
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

function printCfg(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

/** Stand up a fresh chained venue + a one-`each`-product catalogue (1.50 gross, general/21 %), a
 *  staff person ("Cajera") and a supervisor ("Responsable"), both with a known PIN ("5555"). The
 *  supervisor holds `cash.drawer` (the SUPERVISOR permission set); the staff person does not — this
 *  is the pair the gated drawer route + supervisor-override matrix is written against. Each test gets
 *  its OWN tenant, so its `print_jobs` / `drawer_opens` / `registros_facturacion` counts are its own,
 *  order-independent (CLAUDE.md §4). */
async function setupVenue(): Promise<{
  cfg: TillConfig;
  each: AvailableProduct;
  operatorId: string;
  supervisorId: string;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Recibos SL",
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const { each, operatorId, supervisorId } = await withTenant(
    suite.admin,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { [LOCALE]: "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      const staff = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'Cajera', ${hashPin("5555")}, 'staff') returning id`);
      const supervisor = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'Responsable', ${hashPin("5555")}, 'supervisor') returning id`);
      const { products: available } = await listAvailableProducts(tx, cfg.locationId);
      return {
        each: available.find((p) => p.pricingUnit === "each")!,
        operatorId: staff.rows[0]!.id,
        supervisorId: supervisor.rows[0]!.id,
      };
    },
  );
  return { cfg, each, operatorId, supervisorId };
}

function apiDeps(cfg: TillConfig): TillApiDeps {
  return {
    db: suite.admin,
    backend,
    clock,
    cfg,
    secureCookies: false,
    venueLocale: cfg.locale,
  };
}

/** Create a `cloud_poll` receipt printer (no agent needed — the enqueue is a pure INSERT, so no
 *  transport is ever touched on these routes) and return its id. */
async function makePrinter(cfg: TillConfig): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { id } = await createPrinter(tx, printCfg(cfg), {
      name: "Recibos",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    return id;
  });
}

/** Set the location's `receipt_print_mode` and/or the till's `receipt_printer_id` directly (the app
 *  role holds UPDATE on both). Pass `printerId: null` to leave the till with no printer. */
async function configureReceipt(
  cfg: TillConfig,
  opts: { mode?: "auto" | "on_request" | "never"; printerId?: string | null },
): Promise<void> {
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    if (opts.mode !== undefined) {
      await tx
        .update(locations)
        .set({ receiptPrintMode: opts.mode })
        .where(eq(locations.id, cfg.locationId));
    }
    if (opts.printerId !== undefined) {
      await tx
        .update(tills)
        .set({ receiptPrinterId: opts.printerId })
        .where(eq(tills.id, cfg.tillId));
    }
  });
}

async function printJobsFor(
  cfg: TillConfig,
): Promise<{ printerId: string; status: string; payload: Buffer }[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return tx
      .select({
        printerId: printJobs.printerId,
        status: printJobs.status,
        payload: printJobs.payload,
      })
      .from(printJobs);
  });
}

async function drawerOpensFor(cfg: TillConfig): Promise<
  {
    reason: string;
    saleId: string | null;
    personId: string;
    tillId: string;
    authorizedBy: string | null;
    viaOverride: boolean;
  }[]
> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return tx
      .select({
        reason: drawerOpens.reason,
        saleId: drawerOpens.saleId,
        personId: drawerOpens.personId,
        tillId: drawerOpens.tillId,
        authorizedBy: drawerOpens.authorizedBy,
        viaOverride: drawerOpens.viaOverride,
      })
      .from(drawerOpens);
  });
}

/** Set the location's `drawer_open_policy` ('gated' | 'open') directly (the app role holds UPDATE on
 *  locations). The column defaults to 'gated', so a test wanting the gate need not call this. */
async function setDrawerPolicy(cfg: TillConfig, policy: "gated" | "open"): Promise<void> {
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx
      .update(locations)
      .set({ drawerOpenPolicy: policy })
      .where(eq(locations.id, cfg.locationId));
  });
}

async function registroCount(cfg: TillConfig): Promise<number> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return (await tx.select().from(registrosFacturacion)).length;
  });
}

async function saleCount(cfg: TillConfig): Promise<number> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return (await tx.select({ id: sales.id }).from(sales)).length;
  });
}

/** Log in as `operatorId` (PIN "5555") through the HTTP surface and return the session cookie. */
async function login(app: Hono, operatorId: string): Promise<string> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!;
}

/** Enrol a REAL `till`-kind device bound to the venue's own till (`cfg.tillId`) and return the
 *  `waitron_device=<id>.<token>` cookie. SP-A.2 cutover: `POST /api/sales` resolves its till from the
 *  enrolled device, and the device's till IS the venue till, so the filed record is unchanged. */
async function enrolTillCookie(cfg: TillConfig): Promise<string> {
  const { code } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      tillId: cfg.tillId,
      label: "Counter till",
    });
  });
  const dev = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return enrolDevice(tx, cfg, { code });
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Ring a cash sale under a KNOWN client-minted `workingOrderId` (the id the till holds after a sale —
 *  `#store.id`; the reprint route keys on it), and return that id. Carries a till-device cookie so the
 *  post-cutover sale route resolves its till (SP-A.2 §16.4). */
async function ringSale(
  app: Hono,
  cfg: TillConfig,
  cookie: string,
  productId: string,
): Promise<string> {
  const deviceCookie = await enrolTillCookie(cfg);
  const workingOrderId = randomUUID();
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
    body: JSON.stringify({
      workingOrderId,
      lines: [{ productId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    }),
  });
  expect(res.status).toBe(200);
  return workingOrderId;
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
        new Error("till-api.receipt.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("POST /api/sales/:id/reprint (manual receipt reprint over HTTP)", () => {
  it("re-enqueues the filed receipt to the till's printer WITHOUT re-filing, bypassing the print mode", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    // mode 'never' so the SALE itself auto-enqueues nothing — the reprint's job is the only one, and a
    // reprint working under 'never' proves it bypasses the print-mode gate (§0: reprint is always available).
    await configureReceipt(cfg, { mode: "never", printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const workingOrderId = await ringSale(app, cfg, cookie, each.id);
    // The filed sale exists, but mode 'never' enqueued no auto job.
    expect(await registroCount(cfg)).toBe(1);
    expect(await saleCount(cfg)).toBe(1);
    expect(await printJobsFor(cfg)).toEqual([]);

    const res = await app.request(`/api/sales/${workingOrderId}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    // NO re-filing: the immutable fiscal record + sale row counts are unchanged.
    expect(await registroCount(cfg)).toBe(1);
    expect(await saleCount(cfg)).toBe(1);

    // Exactly ONE new outbox job, to the till's printer, carrying the full receipt and NO drawer kick
    // (a reprint never opens the drawer).
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    expect(jobs[0]!.status).toBe("queued");
    const payload = new Uint8Array(jobs[0]!.payload);
    expect(decodeTicket(payload)).toContain("VERI*FACTU"); // the legal legend proves it is the receipt
    expect(decodeTicket(payload)).toContain("Deli Recibos SL"); // issuer venue name (art. 7.1.d)
    expect(bytesInclude(payload, DRAWER_KICK)).toBe(false); // reprint = paper only, no kick
  });

  it("reprints again on a second request, still filing nothing (each reprint is paper only)", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "never", printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);
    const workingOrderId = await ringSale(app, cfg, cookie, each.id);

    for (let i = 0; i < 2; i++) {
      const res = await app.request(`/api/sales/${workingOrderId}/reprint`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    }
    // Two paper jobs, one immutable fiscal record — a reprint never re-files.
    expect(await printJobsFor(cfg)).toHaveLength(2);
    expect(await registroCount(cfg)).toBe(1);
    expect(await saleCount(cfg)).toBe(1);
  });

  it("is a 200 no-op when the id names no filed sale (unknown / never-settled order)", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request(`/api/sales/${randomUUID()}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200); // nothing to reprint → no-op, no error
    expect(await printJobsFor(cfg)).toEqual([]);
  });

  it("is a 200 no-op when the till has no receipt printer set (nothing to print to)", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    // A real filed sale, but no printer on the till.
    await configureReceipt(cfg, { mode: "never", printerId: null });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);
    const workingOrderId = await ringSale(app, cfg, cookie, each.id);

    const res = await app.request(`/api/sales/${workingOrderId}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await printJobsFor(cfg)).toEqual([]); // no printer → nothing enqueued
    expect(await registroCount(cfg)).toBe(1); // and still no re-file
  });

  it("refuses a malformed id with working_order.not_found (404) before any query", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/sales/not-a-uuid/reprint", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "working_order.not_found" },
    });
  });

  it("requires a session (401 without one)", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const res = await app.request(`/api/sales/${randomUUID()}/reprint`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/drawer/open (manual, audited cash-drawer open over HTTP)", () => {
  it("enqueues a KICK-ONLY job to the till's printer and records drawer_opens('manual')", async () => {
    const { cfg, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });
    // 'open' policy: any logged-in operator opens directly, still audited (no permission consulted).
    await setDrawerPolicy(cfg, "open");

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);

    // Exactly ONE job — the kick and NOTHING else (no receipt): the payload equals the kick sequence.
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    expect(jobs[0]!.status).toBe("queued");
    const payload = new Uint8Array(jobs[0]!.payload);
    expect([...payload]).toEqual([...DRAWER_KICK]);
    expect(decodeTicket(payload)).not.toContain("VERI*FACTU"); // no receipt, just the kick

    // The manual open is audited: who, which till, no sale. Under 'open' the operator self-authorizes,
    // so authorized_by is the operator and via_override is false.
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      reason: "manual",
      personId: operatorId,
      tillId: cfg.tillId,
      authorizedBy: operatorId,
      viaOverride: false,
    });
    expect(opens[0]!.saleId).toBeNull();
  });

  it("throws drawer.no_printer (400) and writes nothing when the till has no receipt printer", async () => {
    const { cfg, operatorId } = await setupVenue();
    // No printer on the till. 'open' policy so the (unpermitted) staff operator PASSES authorization
    // and reaches the printer resolution — this test is about the no-printer refusal, not the gate.
    await setDrawerPolicy(cfg, "open");
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "drawer.no_printer" },
    });
    // Refused before any write: no job, no audit row.
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("requires a session (401 without one)", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const res = await app.request("/api/drawer/open", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/drawer/open — gated policy: authorize() + supervisor override", () => {
  // The body a supervisor-override open carries. `override.pin` is the AUTHORIZING supervisor's PIN,
  // never the logged-in operator's; it reaches only this authenticated request.
  function withOverride(cookie: string, override: { personId: string; pin: string }) {
    return {
      method: "POST" as const,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ override }),
    };
  }

  it("gated: a supervisor opens directly (holds cash.drawer) — via_override false, authorized_by self", async () => {
    const { cfg, supervisorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });
    // Default policy is 'gated' (setupVenue leaves it), so this exercises the authorize() path.

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, supervisorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200); // the operator's OWN role satisfies the gate — no override needed

    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      reason: "manual",
      personId: supervisorId,
      authorizedBy: supervisorId,
      viaOverride: false,
    });
    expect(await printJobsFor(cfg)).toHaveLength(1); // the kick still fires
  });

  it("gated: a staff operator opens with a VALID supervisor override — via_override true, authorized_by the supervisor", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId); // logged in as STAFF (lacks cash.drawer)

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: supervisorId, pin: "5555" }),
    );
    expect(res.status).toBe(200);

    // The audit records the OPERATOR who performed the open AND the supervisor who authorized it — the
    // authorized_by=supervisor + via_override=true pair is producible ONLY by authorize()'s override
    // branch consuming { personId: supervisorId, pin } and confirming the supervisor holds cash.drawer.
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      reason: "manual",
      personId: operatorId, // the operator who performed the open
      authorizedBy: supervisorId, // the supervisor who authorized it
      viaOverride: true,
    });
    // The kick still fires to the till's receipt printer.
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
  });

  it("gated: a staff operator with NO override is refused (403 authorization.not_permitted) and writes nothing", async () => {
    const { cfg, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    // The gate refuses before any write — no kick, no audit row.
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: the gate runs BEFORE the printer check — a staff operator with no override is 403 even with NO printer", async () => {
    const { cfg, operatorId } = await setupVenue();
    // No printer configured. If the printer resolution ran first this would be 400 drawer.no_printer;
    // the gate runs first (spec §3 order), so an unpermitted operator is refused regardless.
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("gated: a WRONG override PIN is 401 pin.invalid (valid supervisor id, bad PIN) and writes nothing", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: supervisorId, pin: "0000" }),
    );
    // The credential gate (verifyPersonCredential) throws pin.invalid → 401 (STATUS map), NOT 403: a
    // wrong PIN is a failed login, distinct from a valid credential lacking cash.drawer (403).
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "pin.invalid" },
    });
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: an override by a VALID staff credential (correct PIN, lacks cash.drawer) is 403 — proves the PERMISSION is checked", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    // The override names ANOTHER staff person? There is only one staff here — use the operator's own
    // id as the override: a valid credential (correct PIN) whose role (staff) lacks cash.drawer.
    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: operatorId, pin: "5555" }),
    );
    // Person found, PIN correct, but role lacks cash.drawer → authorization.not_permitted (403). This is
    // the branch that proves the route asks authorize() for `cash.drawer` specifically.
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: a malformed override.personId (not a UUID) is 401 person.not_found — no 22P02 500", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: "not-a-uuid", pin: "5555" }),
    );
    // Screened as a UUID before it can reach the persons.id uuid column (a 22P02 → opaque 500) — mapped
    // to the SAME person.not_found (401) a well-formed-but-absent id already gets.
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.not_found" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: an override with a NON-STRING pin is 401 pin.invalid — never reaches verifyPin", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    // A malformed body: a well-formed supervisor id but a NUMERIC pin. `override.pin` must be a string;
    // a non-string is refused pin.invalid (401) before it can reach verifyPin as a non-string.
    const res = await app.request("/api/drawer/open", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ override: { personId: supervisorId, pin: 5555 } }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "pin.invalid" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: a well-formed-but-unknown override.personId is 401 person.not_found", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: randomUUID(), pin: "5555" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.not_found" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: a well-formed body with NO override, sent by staff, is still 403 (an empty body is no override)", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    // An empty JSON object body — parsed cleanly, no override → the gate refuses. (Proves the optional
    // body is handled without a throw: a malformed/empty body must not become a 500.)
    const res = await app.request("/api/drawer/open", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

describe("GET /api/drawer/authorizers (eligible cash.drawer supervisors over HTTP)", () => {
  it("returns the active cash.drawer holders (supervisor + admin) to a logged-in operator, excluding staff, no secrets", async () => {
    // Logged in as the STAFF operator (lacks cash.drawer): any logged-in operator may ask WHO could
    // authorize their override, so the roster comes back regardless of the caller's own permission.
    const { cfg, operatorId, supervisorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, operatorId);

    const res = await app.request("/api/drawer/authorizers", {
      method: "GET",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const authorizers = (await res.json()) as { personId: string; displayName: string }[];

    // The venue's cash.drawer holders are the provisioned admin (Administradora) + the seeded
    // supervisor (Responsable) — the staff operator (Cajera) is NOT one.
    const ids = new Set(authorizers.map((a) => a.personId));
    expect(ids.has(supervisorId)).toBe(true);
    expect(ids.has(operatorId)).toBe(false);
    expect(authorizers).toHaveLength(2); // admin + supervisor, no staff
    // Same no-secrets shape as GET /api/staff: id + name only, no PIN material, role or status.
    expect(Object.keys(authorizers[0]!)).toEqual(["personId", "displayName"]);
    expect(JSON.stringify(authorizers)).not.toContain("scrypt$");
  });

  it("requires a session (401 session.required without one)", async () => {
    const { cfg } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const res = await app.request("/api/drawer/authorizers", { method: "GET" });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "session.required" },
    });
  });
});
