import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: this suite proves the purchase-invoice write group's `purchase.manage`
// gate BY DELETION against the real cluster, with every DB touch going through `withTenant` +
// `asAppUser` so the routes run as the non-superuser app role and its table grants are enforced —
// PGlite connects as a superuser holding every privilege (CLAUDE.md §4). The route mechanics (body/id/
// date screens, STATUS map) are already proven in-process on PGlite (`purchasing-api.test.ts`).
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `purchase.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupVenue(): Promise<Venue> {
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  return {
    tenantId: venue.tenantId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per tenant — `mountPurchasingApi` binds ONE tenant via `cfg.tenantId`, so each venue's
 * routes need their own app (mirrors `catalogue-api.pg.test.ts`). */
function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountPurchasingApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

/** JSON POST/PATCH/GET/DELETE helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function invoiceBody(supplierInvoiceNumber: string): unknown {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Distribuciones García SL",
      supplierInvoiceNumber,
      issuedOn: "2026-08-10",
      receivedOn: "2026-08-12",
      total: "121.00",
    },
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
  };
}

async function createInvoice(app: Hono, cookie: string, number: string): Promise<string> {
  const res = await send(
    app,
    "POST",
    "/management-api/purchase-invoices",
    cookie,
    invoiceBody(number),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Purchasing API over real Postgres (the purchase.manage gate)", () => {
  it("refuses every purchase-invoice write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `purchase.manage` gate BY DELETION. A `staff`-role management session holds no
    // `purchase.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any op runs on all four write/read routes.
    //
    // GUARD-BY-DELETION (authorizeManager), run on 2026-08-16 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: PURCHASE_WRITE_PERMISSION });`
    // call from `purchasing-api.ts`'s `gated` helper. This test then FAILED — every staff request that
    // expected 403 instead succeeded (POST → 201, PATCH/DELETE → 404 for the dummy id, GET → 200/404),
    // so the `toBe(403)` assertions flipped green→red. Restored the line and the test passed again;
    // `git diff purchasing-api.ts` is clean afterwards.
    const { tenantId, managerCookie, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);

    // A real invoice the manager owns, so the staff PATCH/DELETE target an id that DOES exist — the
    // refusal is the gate, not a not_found masking it.
    const id = await createInvoice(app, managerCookie, "GATE-1");
    const DUMMY = "00000000-0000-0000-0000-000000000000";

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(await send(app, "GET", "/management-api/purchase-invoices", staffCookie));
    await expect403(await send(app, "GET", `/management-api/purchase-invoices/${id}`, staffCookie));
    await expect403(
      await send(
        app,
        "POST",
        "/management-api/purchase-invoices",
        staffCookie,
        invoiceBody("STAFF-1"),
      ),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/purchase-invoices/${id}`, staffCookie, {
        header: { note: "hack" },
      }),
    );
    await expect403(
      await send(app, "DELETE", `/management-api/purchase-invoices/${DUMMY}`, staffCookie),
    );
  });
});
