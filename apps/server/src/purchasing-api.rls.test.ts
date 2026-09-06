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

// Real Postgres, not PGlite: this suite proves the purchase-invoice write group's RLS isolation and its
// `purchase.manage` gate DIFFERENTIALLY, which PGlite cannot do — every PGlite connection is a
// superuser that bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned nothing" on PGlite
// would be a FALSE pass. The route mechanics (body/id/date screens, STATUS map) are already proven
// in-process on PGlite (`purchasing-api.test.ts`); here every DB touch goes through `withTenant` +
// `asAppUser` from `suite.admin`, and the assertions are written so that dropping `asAppUser`
// (isolation) or `authorizeManager` (the gate) from `purchasing-api.ts` turns a green test red — the
// two guard-by-deletion receipts recorded on the blocks below.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling RLS suites use.
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

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised — seed a MANAGER (role `manager`) and a STAFF person (role `staff`) and mint a live
 * management session for each, returning the two session cookies the purchase routes read. Each test
 * gets its OWN tenant, so its reads are that test's alone and order-independent (CLAUDE.md §4). The
 * purchase routes carry no login route of their own, so the sessions are minted directly with
 * `startManagementSession`, exactly as the PGlite `purchasing-api.test.ts` does.
 */
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
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
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
 * routes need their own app (mirrors `catalogue-api.rls.test.ts`). */
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

describe("Purchasing API over real Postgres (RLS end-to-end)", () => {
  it("isolates purchase invoices across tenants — a manager sees only their OWN tenant", async () => {
    // Differential cross-tenant isolation (spec §2). Two independent provisioned venues, each with its
    // own manager. Every list read below has NO explicit tenant filter — isolation is entirely
    // `withTenant` + `asAppUser` RLS. So were `asAppUser` ever dropped from `mountPurchasingApi`'s
    // `gated` helper, each list would run on the `suite.admin` connection (a superuser that BYPASSES
    // FORCE RLS) and would leak the other tenant's rows, failing the `not.toContain` assertions here,
    // and A reading B's invoice by id would 200 instead of 404.
    //
    // GUARD-BY-DELETION (asAppUser), run on 2026-08-16 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed `await asAppUser(tx);` from `purchasing-api.ts`'s
    // `gated` helper (the line above `authorizeManager`). This test then FAILED — tenant A's list
    // contained tenant B's invoice id and A's GET of B's id returned 200, exactly the RLS leak
    // predicted. Restored the line and the test passed again; `git diff purchasing-api.ts` is clean.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    const invA = await createInvoice(appA, a.managerCookie, "A-0001");
    const invB = await createInvoice(appB, b.managerCookie, "B-0001");

    // Tenant A's manager lists invoices: exactly A's own, and NOT B's. The read is unfiltered and
    // relies wholly on RLS (see the deletion receipt above).
    const listA = await send(appA, "GET", "/management-api/purchase-invoices", a.managerCookie);
    expect(listA.status).toBe(200);
    const idsA = ((await listA.json()) as { id: string }[]).map((r) => r.id);
    expect(idsA).toContain(invA);
    expect(idsA).not.toContain(invB);

    // A reading B's invoice by id: RLS hides B's row, so the op returns null → a clean 404.
    const aReadsB = await send(
      appA,
      "GET",
      `/management-api/purchase-invoices/${invB}`,
      a.managerCookie,
    );
    expect(aReadsB.status).toBe(404);

    // The reverse direction: B's manager sees only B's rows, never A's — proving the isolation is
    // symmetric and not an artefact of which tenant was provisioned first.
    const listB = await send(appB, "GET", "/management-api/purchase-invoices", b.managerCookie);
    const idsB = ((await listB.json()) as { id: string }[]).map((r) => r.id);
    expect(idsB).toContain(invB);
    expect(idsB).not.toContain(invA);

    // And the reused supplier-number uniqueness is PER TENANT, not global: B can enter A's number.
    const reuse = await send(
      appB,
      "POST",
      "/management-api/purchase-invoices",
      b.managerCookie,
      invoiceBody("A-0001"),
    );
    expect(reuse.status).toBe(201);
  });

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
