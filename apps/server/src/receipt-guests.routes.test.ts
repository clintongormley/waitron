import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  printJobs,
  saleReceiptGuests,
  sales,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { loadTillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import { BASIC_ACTIONS, deviceRequestCfg } from "./testing/session-device.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const AT = new Date("2026-10-02T08:24:00.000Z");
const clock: TrustedClock = {
  now: () => ({
    instant: AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("unused");
  },
  currentAnchor: () => null,
};

interface Venue {
  app: Hono;
  /** A till signed in on an enrolled device whose receipts print on the one printer. */
  till: string;
  /** An offer at 1,50 €. */
  menuItemId: string;
}

async function venue(db: Database): Promise<Venue> {
  const allocated = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "66000001Y",
        legalName: "Comensales SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle 1",
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
          displayName: "Admin",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    ...loadTillConfig({
      WAITRON_TILL_NODE_ID: allocated.nodeId,
      WAITRON_TILL_LOCATION_ID: allocated.locationId,
    }),
    simplifiedInvoiceLimit: null,
  });
  const { menuItemId, staffId, profileId, printerId } = await withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Tapas" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "Pan",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const offers = await offerProducts(tx, cfg, { productIds: [product.id] });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const { id: printerId } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      },
    );
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: "Barra",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      })
      .returning({ id: deviceProfiles.id });
    return {
      menuItemId: offers.offerFor(product.id),
      staffId: staff!.id,
      profileId: profile!.id,
      printerId,
    };
  });
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const app = new Hono();
  mountTillApi(
    app,
    { db, backend, clock, cfg, secureCookies: false, venueLocale: "es-ES" },
    () => {},
  );
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId });
  const deviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: staffId, pin: "5555" }),
  });
  const tillSession = login.headers.get("set-cookie")!.split(";")[0]!;
  await withTransaction(db, (tx) =>
    tx.update(devices).set({ receiptPrinterId: printerId, cashDrawerPrinterId: printerId }),
  );
  return { app, till: `${tillSession}; ${deviceCookie}`, menuItemId };
}

const CASH = { method: "cash", amount: "12.00" };

/** Sells eight at 1,50 € (12,00 €) on `/api/sales`, with `extra` merged into the body. */
async function sell(
  v: Venue,
  extra: Record<string, unknown>,
  { id = randomUUID() as string, tender = CASH as Record<string, unknown> } = {},
): Promise<{ id: string; status: number; body: unknown }> {
  const res = await v.app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({
      workingOrderId: id,
      lines: [{ menuItemId: v.menuItemId, quantity: "8" }],
      tender,
      ...extra,
    }),
  });
  return { id, status: res.status, body: await res.json() };
}

async function storedGuests(db: Database, workingOrderId: string) {
  return withTransaction(db, (tx) =>
    tx
      .select({ guests: saleReceiptGuests.guests })
      .from(saleReceiptGuests)
      .innerJoin(sales, eq(sales.id, saleReceiptGuests.saleId))
      .where(eq(sales.workingOrderId, workingOrderId)),
  );
}

/** The receipts printed so far, decoded, oldest first. */
async function receipts(db: Database): Promise<string[]> {
  const jobs = await withTransaction(db, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .orderBy(sql`rowid`),
  );
  return jobs
    .map((job) => decodeTicket(new Uint8Array(job.payload)))
    .filter((text) => text.includes("TOTAL"));
}

const WRITTEN_TABLES = [
  "sales",
  "sale_receipt_guests",
  "print_jobs",
  "drawer_opens",
  "working_orders",
  "working_order_lines",
] as const;

function writtenTables(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    WRITTEN_TABLES.map((name) => [name, db.all(sql.raw(`select * from ${name} order by rowid`))]),
  );
}

describe("/api/sales keeps the guests its receipt prints", () => {
  it("stores the chosen count and prints it with the share of 12,00 €", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: 5 });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 5 }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("5 comensales · por persona");
    expect(receipt).toContain("2,40 €");
  });

  it("stores no line for null and prints no guests", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: null });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).not.toContain("comensal");
  });

  it("stores a counter sale's default, no line, when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, {});
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
  });

  it.each([[0], [1000], [2.5], ["4"], [true]])(
    "refuses guests %j before writing anything",
    async (guests) => {
      const v = await venue(suite.db);
      const before = writtenTables(suite.db);
      const sale = await sell(v, { guests });
      expect(sale.status).toBe(400);
      expect(sale.body).toEqual({
        error: { code: "management.request_invalid", params: { field: "guests" } },
      });
      expect(writtenTables(suite.db)).toEqual(before);
    },
  );

  it("stores the count on a hand-keyed card sale", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: 3 }, { tender: { method: "card", amount: "12.00" } });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 3 }]);
  });

  it("keeps the first count when the same sale is sent again with another", async () => {
    const v = await venue(suite.db);
    const first = await sell(v, { guests: 5 });
    expect(first.status).toBe(200);
    const again = await sell(v, { guests: 7 }, { id: first.id });
    expect(again.status).toBe(200);
    expect(await storedGuests(suite.db, first.id)).toEqual([{ guests: 5 }]);
  });
});
