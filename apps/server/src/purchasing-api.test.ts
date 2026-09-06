import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the ROUTES — the request/response boundary, the body +
// id/date screens, the permission-gate wiring and the STATUS map — end to end in-process, the same way
// `catalogue-api.test.ts` proves the catalogue routes. The purchase-invoice tables live in
// CORE_MIGRATIONS and the management session/persons in IDENTITY_MIGRATIONS, and every DB touch runs
// `withTenant` + `asAppUser` exactly as production does. The gate-by-DELETION proof, run as the
// non-superuser app role, is the real-Postgres suite (`purchasing-api.pg.test.ts`); PGlite connects as
// a superuser holding every grant (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
let managerCookie: string;
let staffCookie: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    // Seed a MANAGER (role `manager`, holds `purchase.manage`) and a STAFF person (role `staff`, holds
    // nothing) as the app role under the tenant, then mint a live management session for each so the
    // route tests can drive the gate through a real cookie. `pin_hash` is NOT NULL, so a value is
    // supplied even though these sessions are minted directly rather than via a PIN/password login.
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        tenantId,
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        tenantId,
        personId: stf.rows[0]!.id,
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountPurchasingApi(app, { db: suite.db, cfg: { tenantId } }, noopLog);
  return app;
}

/** JSON POST/PATCH/GET/DELETE helper with the manager cookie unless overridden. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET" | "DELETE",
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

/** A well-formed create body: a general-regime invoice with one 21% VAT line. */
function validBody(overrides: { supplierInvoiceNumber?: string } = {}): unknown {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Distribuciones García SL",
      supplierInvoiceNumber: overrides.supplierInvoiceNumber ?? "F-2026/001",
      issuedOn: "2026-08-10",
      receivedOn: "2026-08-12",
      total: "121.00",
      regime: "general",
      deductibleProportion: "100.00",
      note: "Compra de género",
    },
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
  };
}

async function createVia(app: Hono, overrides: { supplierInvoiceNumber?: string } = {}) {
  const res = await send(app, "POST", "/management-api/purchase-invoices", {
    body: validBody(overrides),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; lines: unknown[] };
}

describe("mountPurchasingApi — create", () => {
  it("POST /management-api/purchase-invoices creates one (201 → the PurchaseInvoice shape)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", {
      body: validBody(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      supplierTaxId: string;
      total: string;
      regime: string;
      deductibleProportion: string;
      note: string | null;
      lines: { rate: string; base: string; tax: string; kind: string }[];
    };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      supplierTaxId: "B12345678",
      total: "121.00",
      regime: "general",
      deductibleProportion: "100.00",
      note: "Compra de género",
    });
    expect(body.lines).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }]);
  });

  it("defaults regime/deductibleProportion/kind when omitted", async () => {
    const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", {
      body: {
        header: {
          supplierTaxId: "B99999999",
          supplierName: "Proveedor mínimo",
          supplierInvoiceNumber: "MIN-1",
          issuedOn: "2026-08-01",
          receivedOn: "2026-08-02",
          total: "10.00",
        },
        lines: [{ rate: "10.00", base: "9.09", tax: "0.91" }],
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      regime: string;
      deductibleProportion: string;
      note: string | null;
      lines: { kind: string }[];
    };
    expect(body).toMatchObject({ regime: "general", deductibleProportion: "100.00", note: null });
    expect(body.lines[0]!.kind).toBe("ordinary");
  });

  it("POST unauthenticated → 401 management_session.required", async () => {
    const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", {
      body: validBody(),
      cookie: null,
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("POST as a staff-role session → 403 authorization.not_permitted", async () => {
    const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", {
      body: validBody(),
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("POST a duplicate supplier invoice → 409 purchase.duplicate", async () => {
    const app = mountApp();
    await createVia(app, { supplierInvoiceNumber: "DUP-1" });
    const res = await send(app, "POST", "/management-api/purchase-invoices", {
      body: validBody({ supplierInvoiceNumber: "DUP-1" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.duplicate" },
    });
  });

  it("POST with no VAT lines → 400 purchase.invalid", async () => {
    const app = mountApp();
    const res = await send(app, "POST", "/management-api/purchase-invoices", {
      body: {
        header: {
          supplierTaxId: "B1",
          supplierName: "X",
          supplierInvoiceNumber: "NOLINES-1",
          issuedOn: "2026-08-01",
          receivedOn: "2026-08-02",
          total: "0.00",
        },
        lines: [],
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.invalid" },
    });
  });

  it("POST with a rate out of range → 400 purchase.invalid", async () => {
    const app = mountApp();
    const res = await send(app, "POST", "/management-api/purchase-invoices", {
      body: {
        header: {
          supplierTaxId: "B1",
          supplierName: "X",
          supplierInvoiceNumber: "BADRATE-1",
          issuedOn: "2026-08-01",
          receivedOn: "2026-08-02",
          total: "1.00",
        },
        lines: [{ rate: "150.00", base: "1.00", tax: "0.00" }],
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.invalid" },
    });
  });
});

describe("mountPurchasingApi — create request-shape screens", () => {
  it.each([
    ["header", { header: "nope", lines: [{ rate: "21.00", base: "1.00", tax: "0.21" }] }],
    ["supplierTaxId", withHeader({ supplierTaxId: 123 })],
    ["supplierName", withHeader({ supplierName: 123 })],
    ["supplierInvoiceNumber", withHeader({ supplierInvoiceNumber: 123 })],
    ["issuedOn", withHeader({ issuedOn: "2026-13-40" })],
    ["issuedOn", withHeader({ issuedOn: "10/08/2026" })],
    ["receivedOn", withHeader({ receivedOn: 123 })],
    ["total", withHeader({ total: 123 })],
    ["regime", withHeader({ regime: "reduced" })],
    ["deductibleProportion", withHeader({ deductibleProportion: 50 })],
    ["note", withHeader({ note: 5 })],
    ["lines", { header: goodHeader(), lines: "nope" }],
    ["lines", { header: goodHeader(), lines: [123] }],
    ["rate", { header: goodHeader(), lines: [{ base: "1.00", tax: "0.21" }] }],
    ["base", { header: goodHeader(), lines: [{ rate: "21.00", tax: "0.21" }] }],
    ["tax", { header: goodHeader(), lines: [{ rate: "21.00", base: "1.00" }] }],
    [
      "kind",
      { header: goodHeader(), lines: [{ rate: "21.00", base: "1.00", tax: "0.21", kind: "x" }] },
    ],
  ])(
    "POST rejects a wrong-typed/invalid %s → management.request_invalid 400",
    async (field, body) => {
      const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("POST null body → 400 management.request_invalid naming header", async () => {
    const res = await send(mountApp(), "POST", "/management-api/purchase-invoices", { body: null });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "header" } } });
  });

  it("POST with a MALFORMED body → 400 management.request_invalid naming header (never a 500)", async () => {
    // `c.req.json()` throws on a malformed body; `readJsonBody` coerces that throw to `{}` → the same
    // header-screen 400 as the null-body test above, not an opaque 500. Sent raw, since `send` would
    // JSON.stringify a valid body.
    const res = await mountApp().request("/management-api/purchase-invoices", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "header" } } });
  });
});

describe("mountPurchasingApi — list", () => {
  it("GET lists them, newest window filtered by received_on (200)", async () => {
    const app = mountApp();
    await createVia(app, { supplierInvoiceNumber: "LIST-1" });
    const res = await send(app, "GET", "/management-api/purchase-invoices");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { supplierInvoiceNumber: string; lines: unknown[] }[];
    const row = rows.find((r) => r.supplierInvoiceNumber === "LIST-1")!;
    expect(row).toBeDefined();
    expect(row.lines.length).toBe(1);
  });

  it("GET with a from/to window narrows by received_on", async () => {
    const app = mountApp();
    await createVia(app, { supplierInvoiceNumber: "WIN-1" }); // receivedOn 2026-08-12
    const inWindow = await send(
      app,
      "GET",
      "/management-api/purchase-invoices?from=2026-08-12&to=2026-08-13",
    );
    expect(
      ((await inWindow.json()) as { supplierInvoiceNumber: string }[]).some(
        (r) => r.supplierInvoiceNumber === "WIN-1",
      ),
    ).toBe(true);
    const outOfWindow = await send(
      app,
      "GET",
      "/management-api/purchase-invoices?from=2026-09-01&to=2026-09-02",
    );
    expect(
      ((await outOfWindow.json()) as { supplierInvoiceNumber: string }[]).some(
        (r) => r.supplierInvoiceNumber === "WIN-1",
      ),
    ).toBe(false);
  });

  it("GET with a malformed from → 400 management.request_invalid", async () => {
    const res = await send(mountApp(), "GET", "/management-api/purchase-invoices?from=not-a-date");
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "from" } } });
  });

  it("GET unauthenticated → 401", async () => {
    const res = await send(mountApp(), "GET", "/management-api/purchase-invoices", {
      cookie: null,
    });
    expect(res.status).toBe(401);
  });
});

describe("mountPurchasingApi — get one", () => {
  it("GET /:id returns the invoice with its lines (200)", async () => {
    const app = mountApp();
    const created = await createVia(app, { supplierInvoiceNumber: "GET-1" });
    const res = await send(app, "GET", `/management-api/purchase-invoices/${created.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; lines: unknown[] };
    expect(body.id).toBe(created.id);
    expect(body.lines.length).toBe(1);
  });

  it("GET /:id for a missing invoice → 404 purchase.not_found", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/purchase-invoices/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.not_found" },
    });
  });

  it("GET /:id with a non-uuid id → 400 shared.invalid_id", async () => {
    const res = await send(mountApp(), "GET", "/management-api/purchase-invoices/not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });
});

describe("mountPurchasingApi — update", () => {
  it("PATCH /:id replaces every header field and the VAT lines (204) and they land", async () => {
    // A FULL header patch — every screenable field present and valid — so each present-and-valid
    // branch of the PATCH header screen is exercised, plus a full desglose replacement.
    const app = mountApp();
    const created = await createVia(app, { supplierInvoiceNumber: "UPD-1" });
    const res = await send(app, "PATCH", `/management-api/purchase-invoices/${created.id}`, {
      body: {
        header: {
          supplierTaxId: "B87654321",
          supplierName: "Nombre corregido",
          supplierInvoiceNumber: "UPD-1-REV",
          issuedOn: "2026-08-09",
          receivedOn: "2026-08-11",
          total: "242.00",
          regime: "equivalence_surcharge",
          deductibleProportion: "50.00",
          note: "Rectificado",
        },
        lines: [
          { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
          { rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" },
        ],
      },
    });
    expect(res.status).toBe(204);

    const read = await send(app, "GET", `/management-api/purchase-invoices/${created.id}`);
    const body = (await read.json()) as {
      supplierTaxId: string;
      supplierName: string;
      supplierInvoiceNumber: string;
      issuedOn: string;
      receivedOn: string;
      total: string;
      regime: string;
      deductibleProportion: string;
      note: string | null;
      lines: { rate: string; kind: string }[];
    };
    expect(body).toMatchObject({
      supplierTaxId: "B87654321",
      supplierName: "Nombre corregido",
      supplierInvoiceNumber: "UPD-1-REV",
      issuedOn: "2026-08-09",
      receivedOn: "2026-08-11",
      total: "242.00",
      regime: "equivalence_surcharge",
      deductibleProportion: "50.00",
      note: "Rectificado",
    });
    expect(body.lines.map((l) => l.rate)).toEqual(["10.00", "21.00"]);
  });

  it("PATCH /:id with an empty body is a 204 no-op that bumps the record", async () => {
    const app = mountApp();
    const created = await createVia(app, { supplierInvoiceNumber: "NOOP-1" });
    const res = await send(app, "PATCH", `/management-api/purchase-invoices/${created.id}`, {
      body: {},
    });
    expect(res.status).toBe(204);
  });

  it("PATCH /:id for a missing invoice → 404 purchase.not_found", async () => {
    const res = await send(
      mountApp(),
      "PATCH",
      "/management-api/purchase-invoices/00000000-0000-0000-0000-000000000000",
      { body: { header: { note: "x" } } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.not_found" },
    });
  });

  it("PATCH /:id with a non-uuid id → 400 shared.invalid_id", async () => {
    const res = await send(mountApp(), "PATCH", "/management-api/purchase-invoices/not-a-uuid", {
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id null body → 204 no-op", async () => {
    const app = mountApp();
    const created = await createVia(app, { supplierInvoiceNumber: "NULLPATCH-1" });
    const res = await send(app, "PATCH", `/management-api/purchase-invoices/${created.id}`, {
      body: null,
    });
    expect(res.status).toBe(204);
  });

  it.each([
    ["header", { header: "nope" }],
    ["supplierName", { header: { supplierName: 5 } }],
    ["issuedOn", { header: { issuedOn: "nope" } }],
    ["regime", { header: { regime: "reduced" } }],
    ["note", { header: { note: 5 } }],
    ["lines", { lines: "nope" }],
    ["rate", { lines: [{ base: "1.00", tax: "0.21" }] }],
  ])(
    "PATCH rejects a wrong-typed/invalid %s → management.request_invalid 400",
    async (field, body) => {
      const app = mountApp();
      const created = await createVia(app, { supplierInvoiceNumber: `PATCHSCREEN-${field}` });
      const res = await send(app, "PATCH", `/management-api/purchase-invoices/${created.id}`, {
        body,
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );
});

describe("mountPurchasingApi — delete", () => {
  it("DELETE /:id removes the invoice (204), and a second delete → 404", async () => {
    const app = mountApp();
    const created = await createVia(app, { supplierInvoiceNumber: "DEL-1" });
    const first = await send(app, "DELETE", `/management-api/purchase-invoices/${created.id}`);
    expect(first.status).toBe(204);
    const second = await send(app, "DELETE", `/management-api/purchase-invoices/${created.id}`);
    expect(second.status).toBe(404);
    expect((await second.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "purchase.not_found" },
    });
  });

  it("DELETE /:id with a non-uuid id → 400 shared.invalid_id", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/purchase-invoices/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("DELETE unauthenticated → 401", async () => {
    const res = await send(
      mountApp(),
      "DELETE",
      "/management-api/purchase-invoices/00000000-0000-0000-0000-000000000000",
      { cookie: null },
    );
    expect(res.status).toBe(401);
  });
});

// ── Test-body builders (kept below the suites that read them) ───────────────────────────────────────
function goodHeader(): Record<string, unknown> {
  return {
    supplierTaxId: "B12345678",
    supplierName: "Proveedor",
    supplierInvoiceNumber: "SCREEN-1",
    issuedOn: "2026-08-10",
    receivedOn: "2026-08-12",
    total: "121.00",
  };
}

/** A create body with one header field overridden to an invalid value (the rest well-formed), plus a
 * valid single line, for the request-shape screen table. */
function withHeader(override: Record<string, unknown>): unknown {
  return {
    header: { ...goodHeader(), ...override },
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
  };
}
