import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, locations, printJobs, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { assignCatalogueToLocation, createCatalogue, createProduct } from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { attachPrinterToStation } from "./station-printers.js";
import type { TillConfig } from "./till-config.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The HTTP shape of the reprint route: the `requireSession` guard, the `requireUuidId` screen, and
// that `reprintOrderTickets` re-enqueues through the SAME outbox path the fire uses. The verb's logic
// is pinned in `kitchen-print.test.ts`.
const CAFE = "Cafe con leche";
let cfg: TillConfig;
let ana: { id: string };
let stationId: string;
let cafeOffer: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(loc!.id);
    // The default station a fire routes the (courseless, stationless) product to (fireLines fallback).
    stationId = await seedKitchenStation(db, { locationId });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Caja 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, locationId);
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(till!.id, loc!.id, nodeId);

    // One sellable product, routed to the default station by the fire fallback (no explicit station/course).
    await withTransaction(db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const cafe = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: CAFE,
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, loc!.id, catalogue.id);
      cafeOffer = (await offerProducts(tx, cfg)).offerFor(cafe.id);
    });
  },
});

function makeCfg(tillId: string, locationId: string, nodeId: string): TillConfig {
  return {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The reprint route files no fiscal doc, but `placeOrder` calls `clock.now()` regardless of mode. */
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
      throw new Error("till-api.reprint.test: anchor() is not used by the reprint route");
    },
    currentAnchor: () => null,
  };
}

const noopLog: Logger = () => {};

function deps(db: Database): TillApiDeps {
  return {
    db,
    backend: {} as FiscalBackend, // never called: the reprint route files no fiscal doc
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

function printCfg(): PrintConfig {
  return { locationId: cfg.locationId };
}

async function openSession(db: Database): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
}

let app: Hono;
let cookie: string;
// `POST /:id/place` resolves its `till_id` from the authenticated enrolled device, so `placeAndFire`
// carries a `till`-device cookie.
let tillDeviceCookie: string;

/** Enrol a REAL `till` device and return its `waitron_device=…` cookie. */
async function enrolTillDeviceCookie(db: Database): Promise<string> {
  const rows = await db
    .insert(deviceProfiles)
    .values({ name: "Counter till profile", formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const dev = await enrolDeviceForTest(db, cfg, { name: "Counter till", profileId: rows[0]!.id });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), noopLog);
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  tillDeviceCookie = await enrolTillDeviceCookie(suite.db);
});

/** Park + place an order carrying `CAFE`, which FIRES it (placeOrder → fireLines). Returns the order id. */
async function placeAndFire(): Promise<string> {
  const id = randomUUID();
  const park = await app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ id, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
  });
  expect(park.status).toBe(200);
  const place = await app.request(`/api/working-orders/${id}/place`, {
    method: "POST",
    headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
  });
  expect(place.status).toBe(200);
  return id;
}

/** Create a live cloud_poll printer and attach it to the default station. */
async function attachPrinterToDefaultStation(): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    const { id } = await createPrinter(tx, printCfg(), {
      name: `Cocina ${randomUUID()}`,
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, { stationId, printerId: id });
    return id;
  });
}

/** The database's print-job outbox, each job's printer + decoded ESC/POS bytes. */
async function printJobsFor(printerId: string): Promise<{ id: string; ticket: string }[]> {
  const rows = await withTransaction(suite.db, async (tx) => {
    return tx
      .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
  });
  return rows.map((r) => ({ id: r.id, ticket: decodeTicket(r.payload) }));
}

describe("POST /api/orders/:id/reprint", () => {
  it("REJECTS with 401 session.required when no cookie is present (the guard runs first)", async () => {
    const res = await app.request(`/api/orders/${randomUUID()}/reprint`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("re-enqueues the order's current ticket to its station printer (200)", async () => {
    // Fire the order FIRST (no printer mapped yet → the fire enqueues nothing), THEN wire up the printer
    // and reprint — the paper-jam recovery shape: the ticket is already fired, the printer is fixed, and
    // reprint re-enqueues the current ticket. This isolates the reprint's effect from print-on-fire.
    const orderId = await placeAndFire();
    const printerId = await attachPrinterToDefaultStation();
    expect(await printJobsFor(printerId)).toHaveLength(0); // fired before the printer existed → nothing yet

    const res = await app.request(`/api/orders/${orderId}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const jobs = await printJobsFor(printerId);
    expect(jobs).toHaveLength(1); // reprint re-enqueued the current ticket
    expect(jobs[0]!.ticket).toContain(CAFE);
  });

  it("404s working_order.not_found on a malformed id, and no-ops (200) an unknown well-formed order", async () => {
    // A malformed id is `requireUuidId`-screened to `working_order.not_found` (404) before any query,
    // carrying the id it rejected.
    const malformed = await app.request("/api/orders/not-a-uuid/reprint", {
      method: "POST",
      headers: { cookie },
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });

    // A well-formed but unknown order has no fired items → the verb no-ops (enqueues nothing), so the
    // route answers 200 with an empty body and no new error code — the design's empty-order behaviour.
    const unknown = await app.request(`/api/orders/${randomUUID()}/reprint`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe("");
  });
});
