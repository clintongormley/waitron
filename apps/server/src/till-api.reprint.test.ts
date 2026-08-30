import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, printJobs, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
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
import type { TenantId } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { attachPrinterToStation } from "./station-printers.js";
import type { TillConfig } from "./till-config.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import "./errors.js";

// PGlite, not real Postgres: this file proves the HTTP SHAPE of the reprint route — the `requireSession`
// guard, the `requireUuidId` screen, and that `reprintOrderTickets` re-enqueues through the SAME outbox
// path the fire uses. The reprint VERB's logic (re-query all fired items, R-D whole-ticket, never-block)
// is proven at the verb level in `kitchen-print.test.ts`; `station_printers` RLS/grants are real-Postgres's
// job (Task 1's rls suite). Schema is CORE (kitchen_stations / ticket_items / printers / station_printers /
// print_jobs all land in CORE) + IDENTITY (the sessions/persons the login path needs).
const CAFE = "Cafe con leche";
let cfg: TillConfig;
let ana: { id: string };
let stationId: string;
let cafeId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    const locationId = brandLocationId(loc.rows[0]!.id);
    // The default station a fire routes the (courseless, stationless) product to (fireLines fallback).
    stationId = await seedKitchenStation(db, { tenantId, locationId });
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Caja 1') returning id`);
    const nodeId = await seedNode(db, tenantId, locationId);
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id, nodeId);

    // One sellable product, routed to the default station by the fire fallback (no explicit station/course).
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const cafe = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        descriptions: { es: CAFE },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      cafeId = cafe.id;
      await assignCatalogueToLocation(tx, loc.rows[0]!.id, catalogue.id);
    });
  },
});

function makeCfg(
  tenantId: TenantId,
  tillId: string,
  locationId: string,
  nodeId: string,
): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The system wall clock — the reprint route files no fiscal doc, but `placeOrder` calls `clock.now()`
 *  regardless of mode, so the same stub shape the sibling suites use is supplied. */
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

/** The tenant + location scope the printing verbs run under. */
function printCfg(): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

async function openSession(db: Database): Promise<string> {
  const session = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return loginWithPin(tx, {
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.id;
}

let app: Hono;
let cookie: string;

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), noopLog);
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
});

/** Park + place an order carrying `CAFE`, which FIRES it (placeOrder → fireLines). Returns the order id. */
async function placeAndFire(): Promise<string> {
  const id = randomUUID();
  const park = await app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ id, lines: [{ productId: cafeId, quantity: "1" }] }),
  });
  expect(park.status).toBe(200);
  const place = await app.request(`/api/working-orders/${id}/place`, {
    method: "POST",
    headers: { cookie },
  });
  expect(place.status).toBe(200);
  return id;
}

/** Create a live cloud_poll printer and attach it to the default station (app role, RLS in force). */
async function attachPrinterToDefaultStation(): Promise<string> {
  return withTenant(suite.db, cfg.tenantId, async (tx: Transaction) => {
    await asAppUser(tx);
    const { id } = await createPrinter(tx, printCfg(), {
      name: `Cocina ${randomUUID()}`,
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, printCfg(), { stationId, printerId: id });
    return id;
  });
}

/** The tenant's print-job outbox (RLS-scoped), each job's printer + decoded ESC/POS bytes. */
async function printJobsFor(printerId: string): Promise<{ id: string; ticket: string }[]> {
  const rows = await withTenant(suite.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return tx
      .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
  });
  return rows.map((r) => ({ id: r.id, ticket: decodeTicket(r.payload) }));
}

describe("POST /api/orders/:id/reprint", () => {
  it("REJECTS with 401 session.required when no cookie is present (the guard runs first)", async () => {
    // The `requireSession` guard runs FIRST, before the id screen or any DB touch; deleting it flips this
    // to a 2xx/4xx — the deletion proof (run manually, CLAUDE.md §4).
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
    // A malformed id is `requireUuidId`-screened to `working_order.not_found` (404) before any query —
    // never a 22P02 → 500 — carrying the id it rejected.
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
