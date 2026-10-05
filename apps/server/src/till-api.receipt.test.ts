import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  drawerOpens,
  locations,
  printJobs,
  sales,
  tenantReceipts,
  withTransaction,
} from "@waitron/db";
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
import { createPinThrottle, hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { createPrinter, textGrid, updatePrinter } from "@waitron/printing";
import { departmentSalePolicies, departments, stationClaims } from "@waitron/venue-service";
import type { PrintConfig } from "@waitron/printing";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
import { CAPABILITY_FLAGS, setProfilePrinterLists } from "@waitron/layouts";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { DRAWER_KICK } from "./receipt-print.js";
import {
  commandNames,
  decodeTicket,
  opensDrawer,
  printedCommands,
  printedLines,
} from "./testing/decode-ticket.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import {
  watchDerivations,
  watchedOrder,
  watchedDerivationCount,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// The manual reprint and drawer-open routes over HTTP, against a GENUINE chained fiscal sale read
// back and paper enqueued for it.
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const anotherWriter = () => withTransaction(suite.db, (tx) => tx.execute(sql`select 1`));

let backend: FiscalBackend;
let clock: TrustedClock;

const noopLog: Logger = () => {};

/** `recordSale` reads `now()` once and touches neither `anchor` nor `currentAnchor`. */
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

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(64_000_000 + nifCounter);
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
    orderFlow: "prepay",
  };
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

/** Stand up a fresh chained venue + a one-`each`-product catalogue (1.50 gross, general/21 %), a
 *  staff person ("Cajera") and a supervisor ("Responsable"), both with PIN "5555". The supervisor
 *  holds `cash.drawer`; the staff person does not — the pair the gated drawer matrix is written
 *  against. */
async function setupVenue(): Promise<{
  cfg: TillConfig;
  each: AvailableProduct & { menuItemId: string };
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
  venueReceiptPrinter = null;
  const { each, operatorId, supervisorId } = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const product = await createProduct(tx, {
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
      productId: product.id,
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
    await tx.insert(stationClaims).values({
      locationId: cfg.locationId,
      categoryId: bebidas.id,
      stationId: null,
      noPreparation: true,
    });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const [supervisor] = await tx
      .insert(persons)
      .values({ displayName: "Responsable", pinHash: hashPin("5555"), role: "supervisor" })
      .returning({ id: persons.id });
    const { products: available } = await listAvailableProducts(tx, cfg.locationId);
    return {
      each: { ...available.find((p) => p.pricingUnit === "each")!, menuItemId: menuItem.id },
      operatorId: staff!.id,
      supervisorId: supervisor!.id,
    };
  });
  return { cfg, each, operatorId, supervisorId };
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

/** Create a `cloud_poll` receipt printer (the enqueue is a pure INSERT, so no transport is touched). */
async function makePrinter(cfg: TillConfig, hasCashDrawer = true): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { id } = await createPrinter(tx, printCfg(cfg), {
      name: "Recibos",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
      hasCashDrawer,
    });
    return id;
  });
}

/** The printer {@link configureReceipt} last gave the venue's devices; a device enrolled later
 *  starts on it too. */
let venueReceiptPrinter: string | null = null;

/** Puts every device of the venue, and each one enrolled after, on `printerId` for receipts and
 *  payment slips; `null` leaves them with no printer. */
async function configureReceipt(
  cfg: TillConfig,
  opts: { mode?: "auto" | "on_request" | "never"; printerId?: string | null },
): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    if (opts.mode !== undefined) {
      await tx
        .update(locations)
        .set({ receiptPrintMode: opts.mode })
        .where(eq(locations.id, cfg.locationId));
      const scopedDepartments = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.locationId, cfg.locationId));
      await tx
        .update(departmentSalePolicies)
        .set({ receiptPrintMode: opts.mode })
        .where(
          inArray(
            departmentSalePolicies.departmentId,
            scopedDepartments.map((row) => row.id),
          ),
        );
    }
    if (opts.printerId !== undefined) {
      venueReceiptPrinter = opts.printerId;
      await tx
        .update(devices)
        .set({ receiptPrinterId: opts.printerId, paymentSlipPrinterId: opts.printerId })
        .where(eq(devices.locationId, cfg.locationId));
    }
  });
}

async function startOnVenuePrinter(deviceId: string): Promise<void> {
  await suite.db
    .update(devices)
    .set({ receiptPrinterId: venueReceiptPrinter, paymentSlipPrinterId: venueReceiptPrinter })
    .where(eq(devices.id, deviceId));
}

async function printJobsFor(
  cfg: TillConfig,
): Promise<{ printerId: string; status: string; payload: Uint8Array }[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
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
    deviceId: string | null;
    printerId: string | null;
    authorizedBy: string | null;
    viaOverride: boolean;
  }[]
> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return tx
      .select({
        reason: drawerOpens.reason,
        saleId: drawerOpens.saleId,
        personId: drawerOpens.personId,
        deviceId: drawerOpens.deviceId,
        printerId: drawerOpens.printerId,
        authorizedBy: drawerOpens.authorizedBy,
        viaOverride: drawerOpens.viaOverride,
      })
      .from(drawerOpens);
  });
}

/** The column defaults to 'gated', so a test wanting the gate need not call this. */
async function setDrawerPolicy(cfg: TillConfig, policy: "gated" | "open"): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    await tx
      .update(locations)
      .set({ drawerOpenPolicy: policy })
      .where(eq(locations.id, cfg.locationId));
  });
}

async function registroCount(cfg: TillConfig): Promise<number> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return (await tx.select().from(registrosFacturacion)).length;
  });
}

async function saleCount(cfg: TillConfig): Promise<number> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return (await tx.select({ id: sales.id }).from(sales)).length;
  });
}

/** Log in as `operatorId` (PIN "5555") over HTTP. The login is device-gated, so it carries an
 *  enrolled `till` device cookie, on a profile allowed every capability but the drawer, so a cash
 *  sale there queues documents only. */
async function login(app: Hono, cfg: TillConfig, operatorId: string): Promise<string> {
  const capabilities = CAPABILITY_FLAGS.filter((flag) => flag !== "open-cash-drawer");
  return loginOnDevice(app, await enrolTillCookie(cfg, capabilities), operatorId);
}

/** Log in as `operatorId` (PIN "5555") on `deviceCookie`'s device; answers the Set-Cookie. */
async function loginOnDevice(app: Hono, deviceCookie: string, operatorId: string): Promise<string> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!;
}

/** `POST /api/sales` resolves its till from the enrolled device. */
let tillDeviceCounter = 0;
async function enrolTillCookie(
  cfg: TillConfig,
  capabilities: string[] = ["take-cash"],
): Promise<string> {
  // A login plus a sale both enrol a till device in the SAME database, so the profile name AND the
  // device name must be unique per call — both carry a unique index.
  tillDeviceCounter += 1;
  const n = tillDeviceCounter;
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Counter till profile ${n}`, formFactor: "till", capabilities })
    .returning({ id: deviceProfiles.id });
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: `Counter till ${n}`,
    profileId: profile!.id,
  });
  await startOnVenuePrinter(dev.deviceId);
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** A till device that may open a drawer. */
async function enrolConfiguredTillCookie(cfg: TillConfig): Promise<string> {
  tillDeviceCounter += 1;
  const n = tillDeviceCounter;
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Configured till profile ${n}`,
      formFactor: "till",
      capabilities: ["open-cash-drawer", "take-cash"],
    })
    .returning({ id: deviceProfiles.id });
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: `Configured till ${n}`,
    profileId: profile!.id,
  });
  await startOnVenuePrinter(dev.deviceId);
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Log in as `operatorId` at the configured till's device; the cookie carries both. */
async function loginAtTill(app: Hono, cfg: TillConfig, operatorId: string): Promise<string> {
  const deviceCookie = await enrolConfiguredTillCookie(cfg);
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: operatorId, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  return `${res.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;
}

/** The device a {@link loginAtTill} cookie names. */
function deviceIn(cookie: string): string {
  return new RegExp(`${DEVICE_COOKIE}=([^.;]+)\\.`).exec(cookie)![1]!;
}

/** Ring a cash sale under a KNOWN client-minted `workingOrderId` (the reprint route keys on it). */
async function ringSale(
  app: Hono,
  cfg: TillConfig,
  cookie: string,
  menuItemId: string,
  method: "cash" | "card" = "cash",
): Promise<string> {
  const deviceCookie = await enrolTillCookie(cfg);
  const workingOrderId = randomUUID();
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
    body: JSON.stringify({
      workingOrderId,
      lines: [{ menuItemId, quantity: "1" }],
      tender: { method, amount: "1.50" },
    }),
  });
  expect(res.status).toBe(200);
  return workingOrderId;
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
        new Error("till-api.receipt.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("POST /api/sales/:id/reprint (manual receipt reprint over HTTP)", () => {
  it("re-enqueues the filed receipt to the device's printer WITHOUT re-filing, bypassing the print mode", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    // mode 'never' so the SALE itself auto-enqueues nothing — the reprint's job is the only one, and a
    // reprint working under 'never' shows it bypasses the print-mode gate.
    await configureReceipt(cfg, { mode: "never", printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);

    const workingOrderId = await ringSale(app, cfg, cookie, each.menuItemId);
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

    // Exactly ONE new outbox job, to the device's printer, carrying the full receipt and NO drawer kick
    // (a reprint never opens the drawer).
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    expect(jobs[0]!.status).toBe("queued");
    const payload = new Uint8Array(jobs[0]!.payload);
    expect(decodeTicket(payload)).toContain("DUPLICADO");
    expect(decodeTicket(payload)).toContain("VERI*FACTU"); // the legal legend proves it is the receipt
    expect(decodeTicket(payload)).toContain("Deli Recibos SL"); // issuer venue name (art. 7.1.d)
    expect(opensDrawer(payload)).toBe(false); // reprint = paper only, no kick
  });

  it("reprints again on a second request, still filing nothing (each reprint is paper only)", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "never", printerId });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const workingOrderId = await ringSale(app, cfg, cookie, each.menuItemId);

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
    const cookie = await login(app, cfg, operatorId);

    const res = await app.request(`/api/sales/${randomUUID()}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200); // nothing to reprint → no-op, no error
    expect(await printJobsFor(cfg)).toEqual([]);
  });

  it("is a 200 no-op when the device has no receipt printer set (nothing to print to)", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    // A real filed sale, but no printer on the device.
    await configureReceipt(cfg, { mode: "never", printerId: null });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const workingOrderId = await ringSale(app, cfg, cookie, each.menuItemId);

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
    const cookie = await login(app, cfg, operatorId);

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
  it("enqueues a KICK-ONLY job to the device's printer and records drawer_opens('manual')", async () => {
    const { cfg, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });
    // 'open' policy: any logged-in operator opens directly, still audited (no permission consulted).
    await setDrawerPolicy(cfg, "open");

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

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

    // The manual open is audited: who, which device, no sale. Under 'open' the operator self-authorizes,
    // so authorized_by is the operator and via_override is false.
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      reason: "manual",
      personId: operatorId,
      deviceId: deviceIn(cookie),
      printerId,
      authorizedBy: operatorId,
      viaOverride: false,
    });
    expect(opens[0]!.saleId).toBeNull();
  });

  it("throws drawer.no_printer (400) and writes nothing when the device has no receipt printer", async () => {
    const { cfg, operatorId } = await setupVenue();
    // No printer on the device. 'open' policy so the (unpermitted) staff operator PASSES authorization
    // and reaches the printer resolution — this test is about the no-printer refusal, not the gate.
    await setDrawerPolicy(cfg, "open");
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "drawer.no_printer" },
    });
    // Refused before any write: no job, no audit row.
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("refuses an unattached cash drawer without writing a command or audit", async () => {
    const { cfg, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg, false);
    await configureReceipt(cfg, { printerId });
    await setDrawerPolicy(cfg, "open");
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);
    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "drawer.not_attached", params: { printerId } },
    });
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

  it("refuses an operator session whose device has been revoked with device.unauthorized, writing nothing", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    await setDrawerPolicy(cfg, "open");
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const deviceCookie = await enrolConfiguredTillCookie(cfg);
    const sessionOnly = (await loginOnDevice(app, deviceCookie, operatorId)).split(";")[0]!;
    const deviceId = /waitron_device=([^.]+)\./.exec(deviceCookie)![1]!;
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));

    const res = await app.request("/api/drawer/open", {
      method: "POST",
      headers: { cookie: sessionOnly },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "device.unauthorized", params: {} } });
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });
});

describe("POST /api/drawer/open from a device opens its own receipt printer's drawer", () => {
  /** A till device allowed to open a drawer, and its cookie. */
  async function enrolDrawerTill(cfg: TillConfig): Promise<{ cookie: string; deviceId: string }> {
    tillDeviceCounter += 1;
    const n = tillDeviceCounter;
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `Drawer till profile ${n}`,
        formFactor: "till",
        capabilities: ["open-cash-drawer"],
      })
      .returning({ id: deviceProfiles.id });
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: `Drawer till ${n}`,
      profileId: profile!.id,
    });
    await startOnVenuePrinter(dev.deviceId);
    return { cookie: `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`, deviceId: dev.deviceId };
  }

  async function setDevicePrinter(deviceId: string, printerId: string): Promise<void> {
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: printerId })
      .where(eq(devices.id, deviceId));
  }

  async function venueWithOpenPolicy() {
    const venue = await setupVenue();
    await setDrawerPolicy(venue.cfg, "open");
    const app = new Hono();
    mountTillApi(app, apiDeps(venue.cfg), noopLog);
    // The operator signed in on the pressing device.
    const press = async (deviceCookie: string) => {
      const session = (await loginOnDevice(app, deviceCookie, venue.operatorId)).split(";")[0]!;
      return app.request("/api/drawer/open", {
        method: "POST",
        headers: { cookie: `${session}; ${deviceCookie}` },
      });
    };
    return { ...venue, app, press };
  }

  it("opens the drawer of the pressing device's own receipt printer, and the row names that device", async () => {
    const { cfg, operatorId, press } = await venueWithOpenPolicy();
    const till = await enrolDrawerTill(cfg);
    const printerId = await makePrinter(cfg);
    await setDevicePrinter(till.deviceId, printerId);

    const res = await press(till.cookie);

    expect(res.status).toBe(200);
    const jobs = await printJobsFor(cfg);
    expect(jobs.map((job) => [job.printerId, [...job.payload]])).toEqual([
      [printerId, [...DRAWER_KICK]],
    ]);
    expect(await drawerOpensFor(cfg)).toEqual([
      {
        reason: "manual",
        saleId: null,
        personId: operatorId,
        deviceId: till.deviceId,
        printerId,
        authorizedBy: operatorId,
        viaOverride: false,
      },
    ]);
  });

  it("a device with its own drawer printer opens its own drawer, not the one the venue's other devices use", async () => {
    const { cfg, press } = await venueWithOpenPolicy();
    const boxPrinter = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId: boxPrinter });
    const till = await enrolDrawerTill(cfg);
    const ownPrinter = await makePrinter(cfg);
    await setDevicePrinter(till.deviceId, ownPrinter);

    const res = await press(till.cookie);

    expect(res.status).toBe(200);
    expect((await printJobsFor(cfg)).map((job) => job.printerId)).toEqual([ownPrinter]);
    expect((await drawerOpensFor(cfg)).map((row) => [row.deviceId, row.printerId])).toEqual([
      [till.deviceId, ownPrinter],
    ]);
  });

  it("two devices sharing one drawer printer: each opens it, naming itself", async () => {
    const { cfg, press } = await venueWithOpenPolicy();
    const first = await enrolDrawerTill(cfg);
    const second = await enrolDrawerTill(cfg);
    const printerId = await makePrinter(cfg);
    for (const till of [first, second]) await setDevicePrinter(till.deviceId, printerId);

    for (const till of [first, second]) expect((await press(till.cookie)).status).toBe(200);

    expect((await printJobsFor(cfg)).map((job) => job.printerId)).toEqual([printerId, printerId]);
    expect((await drawerOpensFor(cfg)).map((row) => [row.deviceId, row.printerId])).toEqual([
      [first.deviceId, printerId],
      [second.deviceId, printerId],
    ]);
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
    const cookie = await loginAtTill(app, cfg, supervisorId);

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
    const cookie = await loginAtTill(app, cfg, operatorId); // logged in as STAFF (lacks cash.drawer)

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
    // The kick still fires to the device's receipt printer.
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
    const cookie = await loginAtTill(app, cfg, operatorId);

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
    // No printer configured. If the printer resolution ran first this would be 400 drawer.no_printer.
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

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
    const cookie = await loginAtTill(app, cfg, operatorId);

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
    const cookie = await loginAtTill(app, cfg, operatorId);

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

  it("gated: a malformed override.personId (not a UUID) is 401 pin.invalid", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: "not-a-uuid", pin: "5555" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "pin.invalid" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: an override with a NON-STRING pin is 401 pin.invalid — never reaches verifyPin", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

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

  it("gated: a well-formed-but-unknown override.personId is 401 pin.invalid", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

    const res = await app.request(
      "/api/drawer/open",
      withOverride(cookie, { personId: randomUUID(), pin: "5555" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "pin.invalid" },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: an override that cannot sign in gets one answer, whether the person is unknown, suspended, malformed or gave a wrong PIN", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const [suspended] = await suite.db
      .insert(persons)
      .values({
        displayName: "Responsable suspendida",
        pinHash: hashPin("5555"),
        role: "supervisor",
        status: "suspended",
      })
      .returning({ id: persons.id });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

    const causes = {
      unknown: { personId: randomUUID(), pin: "5555" },
      // The suspended supervisor's own PIN, so only the suspension can be the cause.
      suspended: { personId: suspended!.id, pin: "5555" },
      notAUuid: { personId: "not-a-uuid", pin: "5555" },
      wrongPin: { personId: supervisorId, pin: "0000" },
    };
    const answers: Record<string, unknown> = {};
    for (const [cause, override] of Object.entries(causes)) {
      const res = await app.request("/api/drawer/open", withOverride(cookie, override));
      answers[cause] = { status: res.status, body: await res.json() };
    }
    const refused = { status: 401, body: { error: { code: "pin.invalid", params: {} } } };
    expect(answers).toEqual({
      unknown: refused,
      suspended: refused,
      notAUuid: refused,
      wrongPin: refused,
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("gated: a well-formed body with NO override, sent by staff, is still 403 (an empty body is no override)", async () => {
    const { cfg, operatorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });

    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, operatorId);

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

describe("POST /api/drawer/open — the limit on wrong override PINs", () => {
  /** The drawer route with a wrong-PIN limit on a clock the case moves. */
  function throttledApp(cfg: TillConfig) {
    const clockAt = { now: 1_000_000 };
    const app = new Hono();
    mountTillApi(
      app,
      { ...apiDeps(cfg), pinThrottle: createPinThrottle({ now: () => clockAt.now }) },
      noopLog,
    );
    return { app, clockAt };
  }

  /** Signs `personId` in on an already enrolled till device, so several sessions share one till. */
  async function loginOn(app: Hono, deviceCookie: string, personId: string): Promise<string> {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    return `${res.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;
  }

  function openWith(app: Hono, cookie: string, override: { personId: string; pin: string }) {
    return app.request("/api/drawer/open", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ override }),
    });
  }

  it("after four wrong PINs even the right one is 429 pin.throttled and writes nothing, until the wait is over", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const { app, clockAt } = throttledApp(cfg);
    const cookie = await loginAtTill(app, cfg, operatorId);

    for (let i = 0; i < 4; i += 1) {
      const wrong = await openWith(app, cookie, { personId: supervisorId, pin: "0000" });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toMatchObject({ error: { code: "pin.invalid" } });
    }
    const throttled = await openWith(app, cookie, { personId: supervisorId, pin: "5555" });

    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({
      error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } },
    });
    expect(await drawerOpensFor(cfg)).toEqual([]);
    expect(await printJobsFor(cfg)).toEqual([]);

    clockAt.now += 2_001;
    const opened = await openWith(app, cookie, { personId: supervisorId, pin: "5555" });
    expect(opened.status).toBe(200);
    expect(await drawerOpensFor(cfg)).toMatchObject([
      { personId: operatorId, authorizedBy: supervisorId, viaOverride: true },
    ]);
  });

  it("a right PIN before the limit opens the drawer and starts the count again", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const { app } = throttledApp(cfg);
    const cookie = await loginAtTill(app, cfg, operatorId);
    const wrongThrice = async () => {
      for (let i = 0; i < 3; i += 1) {
        const wrong = await openWith(app, cookie, { personId: supervisorId, pin: "0000" });
        expect(wrong.status).toBe(401);
      }
    };

    await wrongThrice();
    expect((await openWith(app, cookie, { personId: supervisorId, pin: "5555" })).status).toBe(200);
    await wrongThrice();
    expect((await openWith(app, cookie, { personId: supervisorId, pin: "5555" })).status).toBe(200);
    expect(await drawerOpensFor(cfg)).toHaveLength(2);
  });

  it("signing in again on the same till does not start the count again", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const { app } = throttledApp(cfg);
    const device = await enrolConfiguredTillCookie(cfg);
    const first = await loginOn(app, device, operatorId);

    for (let i = 0; i < 4; i += 1) {
      expect((await openWith(app, first, { personId: supervisorId, pin: "0000" })).status).toBe(
        401,
      );
    }
    const fresh = await loginOn(app, device, operatorId);
    const still = await openWith(app, fresh, { personId: supervisorId, pin: "5555" });

    expect(still.status).toBe(429);
    expect(await still.json()).toMatchObject({ error: { code: "pin.throttled" } });
  });

  it("an override sent by an operator who may open the drawer is never checked, so it neither counts nor clears", async () => {
    const { cfg, operatorId, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const { app } = throttledApp(cfg);
    const device = await enrolConfiguredTillCookie(cfg);
    const staff = await loginOn(app, device, operatorId);
    const supervisor = await loginOn(app, device, supervisorId);

    // Wrong PINs carried by the supervisor's own requests are not tried, so none of them counts.
    for (let i = 0; i < 5; i += 1) {
      const own = await openWith(app, supervisor, { personId: supervisorId, pin: "0000" });
      expect(own.status).toBe(200);
    }
    expect((await openWith(app, staff, { personId: supervisorId, pin: "0000" })).status).toBe(401);

    for (let i = 0; i < 3; i += 1) {
      expect((await openWith(app, staff, { personId: supervisorId, pin: "0000" })).status).toBe(
        401,
      );
    }
    // The right PIN carried by a request that never checks it does not clear the back-off.
    expect((await openWith(app, supervisor, { personId: supervisorId, pin: "5555" })).status).toBe(
      200,
    );
    const still = await openWith(app, staff, { personId: supervisorId, pin: "5555" });
    expect(still.status).toBe(429);
    expect(await still.json()).toMatchObject({ error: { code: "pin.throttled" } });
  });
});

describe("GET /api/drawer/authorizers (eligible cash.drawer supervisors over HTTP)", () => {
  it("returns the active cash.drawer holders (supervisor + admin) to a logged-in operator, excluding staff, no secrets", async () => {
    // Logged in as the STAFF operator (lacks cash.drawer): any logged-in operator may ask WHO could
    // authorize their override, so the roster comes back regardless of the caller's own permission.
    const { cfg, operatorId, supervisorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);

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

afterEach(async () => {
  await suite.db.execute(sql`delete from management_sessions`);
  await suite.db.execute(sql`delete from sessions`);
  await suite.db.execute(sql`delete from persons`);
});

describe("original receipt and payment slip actions", () => {
  it("prints an original then a marked duplicate without additional fiscal records", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    await configureReceipt(cfg, { mode: "on_request", printerId: await makePrinter(cfg) });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId);
    for (const action of ["receipt", "reprint", "payment-slip"]) {
      const res = await app.request(`/api/sales/${id}/${action}`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    }
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(2);
    const original = jobs
      .map((j) => new Uint8Array(j.payload))
      .find((p) => !decodeTicket(p).includes("DUPLICADO"))!;
    const duplicate = printedCommands(
      jobs
        .map((j) => new Uint8Array(j.payload))
        .find((p) => decodeTicket(p).includes("DUPLICADO"))!,
    );
    // `makePrinter` leaves the paper and resolution at the printers table's defaults.
    const { columns } = textGrid("80mm", "180dpi");
    const marker = `${" ".repeat(Math.floor((columns - "DUPLICADO".length) / 2))}DUPLICADO`;
    expect(duplicate.filter((c) => c.text === marker)).toHaveLength(1);
    expect(Buffer.concat(duplicate.filter((c) => c.text !== marker).map((c) => c.bytes))).toEqual(
      Buffer.from(original),
    );
    expect(await registroCount(cfg)).toBe(1);
    expect(await saleCount(cfg)).toBe(1);
  });
  it("refuses unknown and malformed payment-slip ids", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    for (const id of [randomUUID(), "bad-id"]) {
      const res = await app.request(`/api/sales/${id}/payment-slip`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "working_order.not_found" } });
    }
  });
});

describe("payment slip persisted capture facts", () => {
  it.each([true, false])(
    "prints an integrated capture with card facts=%s and preserves fiscal rows",
    async (withCard) => {
      const { cfg, each, operatorId } = await setupVenue();
      await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
      const app = new Hono();
      mountTillApi(app, apiDeps(cfg), noopLog);
      const cookie = await login(app, cfg, operatorId);
      const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
      // Seed the same persisted columns an integrated provider supplies, without contacting hardware.
      await suite.db.execute(
        sql`update payments set provider = 'sumup', card_scheme = ${withCard ? "VISA" : null}, card_last4 = ${withCard ? "5838" : null}, card_entry_mode = ${withCard ? "contactless" : null}, card_auth_code = ${withCard ? "328600" : null} where working_order_id = ${id}`,
      );
      const res = await app.request(`/api/sales/${id}/payment-slip`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      const jobs = await printJobsFor(cfg);
      expect(jobs).toHaveLength(1);
      const text = decodeTicket(new Uint8Array(jobs[0]!.payload));
      expect(text).toContain("JUSTIFICANTE DE PAGO");
      expect(text).toContain("Cobrado");
      if (withCard) expect(text).toContain("VISA **** 5838");
      else expect(text).not.toContain("Tarjeta");
      expect(text).not.toContain("VERI*FACTU");
      expect(commandNames(new Uint8Array(jobs[0]!.payload))).not.toContain("GS ( k");
      expect(await registroCount(cfg)).toBe(1);
      expect(await saleCount(cfg)).toBe(1);
    },
  );
  it("does not print a manual card slip", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
    expect(
      (await app.request(`/api/sales/${id}/payment-slip`, { method: "POST", headers: { cookie } }))
        .status,
    ).toBe(200);
    expect(await printJobsFor(cfg)).toEqual([]);
  });
  it("lays the payment slip out for the device printer's paper width and resolution", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await withTransaction(suite.db, async (tx) => {
      await updatePrinter(tx, printCfg(cfg), printerId, {
        paperWidth: "58mm",
        resolution: "203dpi",
      });
    });
    await configureReceipt(cfg, { mode: "never", printerId });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
    await suite.db.execute(
      sql`update payments set provider = 'sumup', card_scheme = 'VISA', card_last4 = '5838', card_entry_mode = 'contactless', card_auth_code = '328600' where working_order_id = ${id}`,
    );
    const res = await app.request(`/api/sales/${id}/payment-slip`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const [job] = await printJobsFor(cfg);
    const payload = new Uint8Array(job!.payload);
    const commands = printedCommands(payload);
    expect(commands.slice(0, 2).map((command) => command.name)).toEqual(["ESC @", "GS v 0"]);
    for (const name of ["ESC t", "FS ."]) {
      expect(commands.map((command) => command.name)).not.toContain(name);
    }
    for (const { name, widthDots } of commands) {
      if (name === "GS v 0") expect(widthDots).toBe(384);
    }
    const lines = printedLines(payload);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    expect(lines.join("\n")).toContain("€");
  });
});

describe("payment slip with nothing to print", () => {
  it("prints nothing when the device has no payment slip printer", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    await configureReceipt(cfg, { mode: "never", printerId: null });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
    await suite.db.execute(
      sql`update payments set provider = 'sumup' where working_order_id = ${id}`,
    );
    const res = await app.request(`/api/sales/${id}/payment-slip`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await printJobsFor(cfg)).toEqual([]);
  });

  it("prints nothing for a capture that records no settlement instant", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
    await suite.db.execute(
      sql`update payments set provider = 'sumup', settled_at = null where working_order_id = ${id}`,
    );
    const res = await app.request(`/api/sales/${id}/payment-slip`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await printJobsFor(cfg)).toEqual([]);
  });
});

describe("persisted cash receipt facts", () => {
  it("returns the filed department heading on first sale and replay after a rename", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const scopes = await suite.db.execute<{ zone_id: string; department_id: string }>(sql`
      select zone_id, department_id from zone_service_policies where location_id = ${cfg.locationId}
      limit 1
    `);
    const [scope] = scopes.rows;
    await suite.db.execute(sql`
      update departments set trading_name = 'Terrace Bar' where id = ${scope!.department_id}
    `);
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const deviceCookie = await enrolTillCookie(cfg);
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId: randomUUID(),
        zoneId: scope!.zone_id,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      }),
    };
    const first = await app.request("/api/sales", request);
    expect(first.status).toBe(200);
    expect((await first.json()).receiptHeader).toMatchObject({
      tradingName: "Terrace Bar",
      printTradingName: true,
    });
    await suite.db.execute(sql`
      update departments set trading_name = 'Renamed' where id = ${scope!.department_id}
    `);
    const replay = await app.request("/api/sales", request);
    expect(replay.status).toBe(200);
    expect((await replay.json()).receiptHeader).toMatchObject({
      tradingName: "Terrace Bar",
      printTradingName: true,
    });
  });

  it("replays and reprints the original cash handed over and change", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    await configureReceipt(cfg, { mode: "on_request", printerId: await makePrinter(cfg) });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const deviceCookie = await enrolTillCookie(cfg);
    const id = randomUUID();
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${cookie}; ${deviceCookie}` },
      body: JSON.stringify({
        workingOrderId: id,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "20.00" },
      }),
    };
    const first = await app.request("/api/sales", request);
    expect(first.status).toBe(200);
    const original = await first.json();
    expect(original.tender).toEqual({ method: "cash", change: "18.50" });
    expect(original.issuer).toMatchObject({ venueName: "Deli Recibos SL" });
    const replay = await app.request("/api/sales", request);
    expect(replay.status).toBe(200);
    expect((await replay.json()).tender).toEqual(original.tender);
    const printed = await app.request(`/api/sales/${id}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(printed.status).toBe(200);
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    const text = decodeTicket(new Uint8Array(jobs[0]!.payload));
    expect(text).toMatch(/Efectivo\s+20,00/);
    expect(text).toMatch(/Cambio\s+18,50/);
    expect(await registroCount(cfg)).toBe(1);
  });
});

it("duplicates use the filed issuer identity while optional trim follows the current layout", async () => {
  const { cfg, each, operatorId } = await setupVenue();
  await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
  const app = new Hono();
  mountTillApi(app, apiDeps(cfg), noopLog);
  const cookie = await login(app, cfg, operatorId);
  const id = await ringSale(app, cfg, cookie, each.menuItemId);
  const originalTaxId = (
    await suite.db.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`)
  ).rows[0]!.tax_id;
  await suite.db.execute(
    sql`update tenants set legal_name = 'Changed venue identity' where id = 1`,
  );
  // The CURRENT receipt text, which the reprint below must NOT read — it reprints the sale's own
  // snapshot.
  await suite.db
    .insert(tenantReceipts)
    .values({
      id: 1,
      receipt: { headerSubtitle: "Current welcome", footerMessage: "Current farewell" },
    })
    .onConflictDoUpdate({
      target: tenantReceipts.id,
      set: { receipt: { headerSubtitle: "Current welcome", footerMessage: "Current farewell" } },
    });
  const res = await app.request(`/api/sales/${id}/reprint`, {
    method: "POST",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const jobs = await printJobsFor(cfg);
  expect(jobs).toHaveLength(1);
  const text = decodeTicket(new Uint8Array(jobs[0]!.payload));
  expect(text).toContain("Deli Recibos SL");
  expect(text).toContain(originalTaxId);
  expect(text).not.toContain("Changed venue identity");
  expect(text).toContain("Current welcome");
  expect(text).toContain("Current farewell");
  expect(await registroCount(cfg)).toBe(1);
});

describe("the till's sign-in and drawer override derive the PIN's key outside the write lock", () => {
  afterEach(async () => {
    await watchedOrder();
  });

  function suspend(personId: string) {
    return () =>
      withTransaction(suite.db, (tx) =>
        tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId)),
      );
  }

  function signIn(app: Hono, deviceCookie: string, personId: string) {
    return app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId, pin: "5555" }),
    });
  }

  function openWithOverride(
    app: Hono,
    cookie: string,
    override: { personId: string; pin: string },
  ) {
    return app.request("/api/drawer/open", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ override }),
    });
  }

  /** A staff operator signed in at the configured till, whose printer has a drawer. */
  async function staffAtDrawerTill(pinThrottle = createPinThrottle()) {
    const venue = await setupVenue();
    await configureReceipt(venue.cfg, { printerId: await makePrinter(venue.cfg) });
    const app = new Hono();
    mountTillApi(app, { ...apiDeps(venue.cfg), pinThrottle }, noopLog);
    const cookie = await loginAtTill(app, venue.cfg, venue.operatorId);
    return { ...venue, app, cookie };
  }

  it("signs in while another writer commits during the PIN check", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const deviceCookie = await enrolConfiguredTillCookie(cfg);
    watchDerivations("5555", anotherWriter, anotherWriter, anotherWriter);

    const res = await signIn(app, deviceCookie, operatorId);

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });

  it("refuses a sign-in whose person is suspended while the PIN's key is being derived", async () => {
    const { cfg, operatorId } = await setupVenue();
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const deviceCookie = await enrolConfiguredTillCookie(cfg);
    watchDerivations("5555", suspend(operatorId));

    const res = await signIn(app, deviceCookie, operatorId);

    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("pin.invalid");
  });

  it("opens the drawer on an override while another writer commits during the PIN check", async () => {
    const { app, cookie, supervisorId, operatorId, cfg } = await staffAtDrawerTill();
    watchDerivations("5555", anotherWriter, anotherWriter, anotherWriter);

    const res = await openWithOverride(app, cookie, { personId: supervisorId, pin: "5555" });

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(await drawerOpensFor(cfg)).toEqual([
      expect.objectContaining({
        personId: operatorId,
        authorizedBy: supervisorId,
        viaOverride: true,
      }),
    ]);
  });

  it("refuses an override whose supervisor is suspended while the PIN's key is being derived, writing nothing", async () => {
    const { app, cookie, supervisorId, cfg } = await staffAtDrawerTill();
    watchDerivations("5555", suspend(supervisorId));

    const res = await openWithOverride(app, cookie, { personId: supervisorId, pin: "5555" });

    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("pin.invalid");
    expect(await drawerOpensFor(cfg)).toEqual([]);
    expect(await printJobsFor(cfg)).toEqual([]);
  });

  it("derives no key for an override sent by an operator who holds cash.drawer", async () => {
    const { cfg, supervisorId } = await setupVenue();
    await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await loginAtTill(app, cfg, supervisorId);
    watchDerivations("0000", anotherWriter);

    const res = await openWithOverride(app, cookie, { personId: supervisorId, pin: "0000" });

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual([]);
  });

  it("derives no key for an override while the drawer's policy is open", async () => {
    const { app, cookie, supervisorId, cfg } = await staffAtDrawerTill();
    await setDrawerPolicy(cfg, "open");
    watchDerivations("0000", anotherWriter);

    const res = await openWithOverride(app, cookie, { personId: supervisorId, pin: "0000" });

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual([]);
  });

  it("counts wrong override PINs sent at once as it counts them sent in turn, deriving as many keys", async () => {
    const { app, cookie, supervisorId, cfg } = await staffAtDrawerTill(
      createPinThrottle({ now: () => 1_000_000 }),
    );

    watchDerivations("0000");

    const wrong = await Promise.all(
      Array.from({ length: 5 }, () =>
        openWithOverride(app, cookie, { personId: supervisorId, pin: "0000" }),
      ),
    );
    const derived = watchedDerivationCount();
    const right = await openWithOverride(app, cookie, { personId: supervisorId, pin: "5555" });

    expect(wrong.map((res) => res.status).sort()).toEqual([401, 401, 401, 401, 429]);
    // As many keys as when the five are sent in turn: none for the one the limit refuses.
    expect(derived).toBe(4);
    expect(right.status).toBe(429);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("derives no key for an override the wrong-PIN limit refuses", async () => {
    const { app, cookie, supervisorId, cfg } = await staffAtDrawerTill(
      createPinThrottle({ now: () => 1_000_000 }),
    );
    for (let i = 0; i < 4; i += 1) {
      const wrong = await openWithOverride(app, cookie, { personId: supervisorId, pin: "0000" });
      expect(wrong.status).toBe(401);
    }
    watchDerivations("5555", anotherWriter);

    const res = await openWithOverride(app, cookie, { personId: supervisorId, pin: "5555" });

    expect(res.status).toBe(429);
    expect(await watchedOrder()).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });
});

describe("receipts, payment slips and the cash drawer follow the requesting device", () => {
  /** A device on its own profile listing `receipt` and `slip`; it starts on the first of each. */
  async function enrolPrintingDevice(
    cfg: TillConfig,
    opts: {
      formFactor?: "till" | "phone-portrait";
      capabilities: string[];
      receipt: string[];
      slip: string[];
    },
  ): Promise<{ deviceId: string; cookie: string }> {
    tillDeviceCounter += 1;
    const n = tillDeviceCounter;
    const formFactor = opts.formFactor ?? "till";
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: `Printing profile ${n}`, formFactor, capabilities: opts.capabilities })
      .returning({ id: deviceProfiles.id });
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profile!.id, {
        receiptPrinterIds: opts.receipt,
        paymentSlipPrinterIds: opts.slip,
      }),
    );
    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: `Printing device ${n}`,
      profileId: profile!.id,
    });
    return { deviceId: dev.deviceId, cookie: `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}` };
  }

  async function jobs(): Promise<{ printerId: string; kind: string; payload: number[] }[]> {
    const rows = await suite.db
      .select({ printerId: printJobs.printerId, kind: printJobs.kind, payload: printJobs.payload })
      .from(printJobs);
    return rows.map((row) => ({ ...row, payload: [...new Uint8Array(row.payload)] }));
  }

  async function venueWithPrinters() {
    const venue = await setupVenue();
    await configureReceipt(venue.cfg, { mode: "never" });
    // No drawers, so a cash sale on these printers queues documents only.
    const [r1, r2, s1] = [
      await makePrinter(venue.cfg, false),
      await makePrinter(venue.cfg, false),
      await makePrinter(venue.cfg, false),
    ];
    const app = new Hono();
    mountTillApi(app, apiDeps(venue.cfg), noopLog);
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
      },
      noopLog,
    );
    const signIn = async (deviceCookie: string) =>
      (await loginOnDevice(app, deviceCookie, venue.operatorId)).split(";")[0]!;
    return { ...venue, app, signIn, r1: r1!, r2: r2!, s1: s1! };
  }

  async function post(app: Hono, cookie: string, path: string): Promise<Response> {
    return app.request(path, { method: "POST", headers: { cookie } });
  }

  async function cardSaleWithCapture(app: Hono, cfg: TillConfig, cookie: string, item: string) {
    const id = await ringSale(app, cfg, cookie, item, "card");
    await suite.db.execute(
      sql`update payments set provider = 'sumup', card_scheme = 'VISA', card_last4 = '5838', card_entry_mode = 'contactless', card_auth_code = '328600' where working_order_id = ${id}`,
    );
    return id;
  }

  it("prints each device's receipt on its own receipt printer", async () => {
    const { cfg, each, app, signIn, r1, r2, s1 } = await venueWithPrinters();
    const a = await enrolPrintingDevice(cfg, {
      capabilities: [...CAPABILITY_FLAGS],
      receipt: [r1],
      slip: [s1],
    });
    const b = await enrolPrintingDevice(cfg, {
      capabilities: [...CAPABILITY_FLAGS],
      receipt: [r2],
      slip: [r2],
    });
    const onA = await signIn(a.cookie);
    const onB = await signIn(b.cookie);
    const id = await ringSale(app, cfg, onA, each.menuItemId);

    expect((await post(app, onA, `/api/sales/${id}/receipt`)).status).toBe(200);
    expect((await post(app, onB, `/api/sales/${id}/receipt`)).status).toBe(200);

    const printed = await jobs();
    expect(printed.map((job) => [job.printerId, job.kind])).toEqual([
      [r1, "document"],
      [r2, "document"],
    ]);
  });

  it("prints a card sale's payment slip on the device's payment slip printer, not its receipt printer", async () => {
    const { cfg, each, app, signIn, r1, s1 } = await venueWithPrinters();
    const a = await enrolPrintingDevice(cfg, {
      capabilities: [...CAPABILITY_FLAGS],
      receipt: [r1],
      slip: [s1],
    });
    const onA = await signIn(a.cookie);
    const id = await cardSaleWithCapture(app, cfg, onA, each.menuItemId);

    expect((await post(app, onA, `/api/sales/${id}/payment-slip`)).status).toBe(200);

    expect((await jobs()).map((job) => job.printerId)).toEqual([s1]);
  });

  it("reprints on the device's receipt printer", async () => {
    const { cfg, each, app, signIn, r1, s1 } = await venueWithPrinters();
    const a = await enrolPrintingDevice(cfg, {
      capabilities: [...CAPABILITY_FLAGS],
      receipt: [r1],
      slip: [s1],
    });
    const onA = await signIn(a.cookie);
    const id = await ringSale(app, cfg, onA, each.menuItemId);

    expect((await post(app, onA, `/api/sales/${id}/reprint`)).status).toBe(200);

    expect((await jobs()).map((job) => job.printerId)).toEqual([r1]);
  });

  it("prints the next payment slip on the printer the device switched to", async () => {
    const { cfg, each, app, signIn, r1, s1 } = await venueWithPrinters();
    const a = await enrolPrintingDevice(cfg, {
      capabilities: [...CAPABILITY_FLAGS],
      receipt: [r1],
      slip: [s1, r1],
    });
    const onA = await signIn(a.cookie);
    const id = await cardSaleWithCapture(app, cfg, onA, each.menuItemId);

    const switched = await app.request("/api/device/printers", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: onA },
      body: JSON.stringify({ paymentSlipPrinterId: r1 }),
    });
    expect(switched.status).toBe(200);
    expect((await post(app, onA, `/api/sales/${id}/payment-slip`)).status).toBe(200);

    expect((await jobs()).map((job) => job.printerId)).toEqual([r1]);
  });

  it("opens no drawer on a cash sale when the device's receipt printer has none, whatever another printer has", async () => {
    const { cfg, each, app, signIn } = await venueWithPrinters();
    const noDrawer = await makePrinter(cfg, false);
    await makePrinter(cfg);
    const device = await enrolPrintingDevice(cfg, {
      capabilities: ["open-cash-drawer", "take-cash"],
      receipt: [noDrawer],
      slip: [],
    });

    await ringSale(app, cfg, await signIn(device.cookie), each.menuItemId);

    expect(await jobs()).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("opens a handheld's drawer on a cash sale when its profile allows the drawer", async () => {
    const { cfg, each, app, signIn, operatorId } = await venueWithPrinters();
    const drawer = await makePrinter(cfg);
    const handheld = await enrolPrintingDevice(cfg, {
      formFactor: "phone-portrait",
      capabilities: ["open-cash-drawer", "take-cash"],
      receipt: [drawer],
      slip: [],
    });

    await ringSale(app, cfg, await signIn(handheld.cookie), each.menuItemId);

    expect((await jobs()).map((job) => [job.printerId, job.kind, job.payload])).toEqual([
      [drawer, "drawer", [...DRAWER_KICK]],
    ]);
    expect(
      (await drawerOpensFor(cfg)).map((row) => [row.reason, row.printerId, row.personId]),
    ).toEqual([["cash_sale", drawer, operatorId]]);
  });

  it("opens no drawer on a cash sale at a till whose profile does not allow the drawer", async () => {
    const { cfg, each, app, signIn } = await venueWithPrinters();
    const drawer = await makePrinter(cfg);
    const till = await enrolPrintingDevice(cfg, {
      capabilities: ["take-cash"],
      receipt: [drawer],
      slip: [],
    });

    await ringSale(app, cfg, await signIn(till.cookie), each.menuItemId);

    expect(await jobs()).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("opens the drawer by hand from a handheld whose profile allows it", async () => {
    const { cfg, app, signIn, operatorId } = await venueWithPrinters();
    await setDrawerPolicy(cfg, "open");
    const drawer = await makePrinter(cfg);
    const handheld = await enrolPrintingDevice(cfg, {
      formFactor: "phone-portrait",
      capabilities: ["open-cash-drawer"],
      receipt: [drawer],
      slip: [],
    });

    const res = await post(app, await signIn(handheld.cookie), "/api/drawer/open");

    expect(res.status).toBe(200);
    expect((await jobs()).map((job) => [job.printerId, job.kind])).toEqual([[drawer, "drawer"]]);
    expect(
      (await drawerOpensFor(cfg)).map((row) => [row.reason, row.printerId, row.personId]),
    ).toEqual([["manual", drawer, operatorId]]);
  });

  it("refuses the drawer by hand from a profile that does not allow it", async () => {
    const { cfg, app, signIn } = await venueWithPrinters();
    await setDrawerPolicy(cfg, "open");
    const drawer = await makePrinter(cfg);
    const handheld = await enrolPrintingDevice(cfg, {
      formFactor: "phone-portrait",
      capabilities: [],
      receipt: [drawer],
      slip: [],
    });

    const res = await post(app, await signIn(handheld.cookie), "/api/drawer/open");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "device.forbidden_action", params: { action: "drawer_open" } },
    });
    expect(await jobs()).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("refuses the drawer by hand from a device with no receipt printer, naming the device", async () => {
    const { cfg, app, signIn } = await venueWithPrinters();
    await setDrawerPolicy(cfg, "open");
    const device = await enrolPrintingDevice(cfg, {
      capabilities: ["open-cash-drawer"],
      receipt: [],
      slip: [],
    });

    const res = await post(app, await signIn(device.cookie), "/api/drawer/open");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "drawer.no_printer", params: { deviceId: device.deviceId } },
    });
    expect(await jobs()).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });
});
