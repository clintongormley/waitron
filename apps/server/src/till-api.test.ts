import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, endSession, hashPin, loginWithPin } from "@waitron/identity";
import { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "@waitron/layouts";
import type { LayoutDef, ReceiptConfig } from "@waitron/layouts";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import type { TenantId } from "@waitron/shared";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi, run } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE, requireSession } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// PGlite, not real Postgres: the session routes are LOGIC (login → cookie → logout), and the login
// path runs through `withTenant` + `asAppUser` exactly as production does, so RLS scopes the person
// lookup to the till's tenant on the app role. Sessions/persons live in identity, so the schema is
// CORE_MIGRATIONS + IDENTITY_MIGRATIONS. Real-PG privilege proofs for these tables are elsewhere
// (identity's sessions.rls.test.ts / persons.rls.test.ts); they are not re-proven here.
let cfg: TillConfig;
let ana: { id: string };
// The pre-login roster fixtures: `abel` is a second ACTIVE person whose name sorts BEFORE "Ana" but
// is inserted AFTER it, so `[abel, ana]` proves `listActiveStaff` sorts by name rather than by
// insertion order; `zoe` is SUSPENDED, so its absence proves the `status = 'active'` filter. The
// tenant's tax_id is generated (a fresh NIF each run), so `GET /api/till`'s `nif` is asserted against
// the value read back here, not a hardcoded one.
let abel: { id: string };
let venueTaxId: string;
// The one product seeded into the counter location's catalogue, so `GET /api/products` (Task 6) has
// something to return. Captured here so the success test can pin the exact `AvailableProduct` shape
// the route reads back — id, descriptions, unit price, VAT class, the resolved category NAME, and its
// EU-14 allergen declaration (menu & allergens, Task 4), which the route carries through unchanged.
let aguaProduct: { id: string };

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    // `seedTenant` sets legal_name = 'Test SL' and a generated tax_id; read the tax_id back so the
    // `GET /api/till` assertion can pin the exact NIF the route must echo.
    const tenant = await db.execute<{ tax_id: string }>(
      sql`select tax_id from tenants where id = ${tenantId}`,
    );
    venueTaxId = tenant.rows[0]!.tax_id;
    // A location → till the session cookie references: `loginWithPin` inserts a `sessions` row with a
    // FK to `tills`, so the till `cfg.tillId` names must exist. Seeded as the PGlite superuser (RLS
    // bypassed) — pure setup, as `@waitron/db`'s own seed helpers document.
    // invoice_locales is `es-ES` (matching the seeded product's `es-ES` description key), because the
    // working-order-line insert `POST /api/working-orders` performs fires `check_locales`, which
    // demands a line's `descriptions` keys equal the location's locales EXACTLY.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
    // A node the working-order routes need: `parkOrder`/`payWorkingOrder` write `working_orders.node_id`
    // (its composite FK `(tenant_id, node_id) → nodes(tenant_id, id)` requires a real row), and
    // `listHeldOrders` filters by it. `cfg.nodeId` names THIS row so every parked order is on-node.
    const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
    // Ana's PIN is "5555"; anything else must not verify. Stored hashed via `hashPin`, never plain.
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    // Abel: ACTIVE, inserted after Ana but sorts before her. Zoe: SUSPENDED, must be excluded.
    const abelRow = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Abel', ${hashPin("1111")}, 'staff') returning id`);
    abel = { id: abelRow.rows[0]!.id };
    await db.execute(sql`
      insert into persons (tenant_id, display_name, pin_hash, role, status)
      values (${tenantId}, 'Zoe', ${hashPin("2222")}, 'staff', 'suspended')`);
    // One product in a catalogue assigned to the counter location, so `GET /api/products` returns a
    // non-empty list. Seeded on the APP role via the catalogue helpers — the same `withTenant` +
    // `asAppUser` path the route reads it back through — so the active/assignment filters are real,
    // not bypassed by a superuser insert. (Catalogue tables live in CORE_MIGRATIONS, already applied.)
    const product = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { "es-ES": "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        // An EU-14 allergen declaration on the seeded product, so `GET /api/products` has a non-null
        // `allergens` map to carry back — the field this task proves flows through the route unchanged
        // (no server code change: it rides `c.json(listAvailableProducts(...))`, Task 4).
        allergens: { sulphites: { presence: "may_contain" } },
      });
      await assignCatalogueToLocation(tx, loc.rows[0]!.id, cat.id);
      return p;
    });
    aguaProduct = { id: product.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id, nodeId);
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `nodeId` is the seeded node the working-order routes
 * write and filter by; `seriesId` is unused by these routes (the chained sale write is proven over
 * real Postgres in `till-api.rls.test.ts`), so it carries a fresh uuid; `locationId` is the seeded
 * one the sale/catalogue routes read. */
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
    // No integrated card terminal for the default cfg — these routes don't build or drive one.
    cardProvider: "none",
    tipsEnabled: false,
    // These API tests exercise the session/roster/park routes, none of which dispatch on the mode.
    orderFlow: "prepay",
  };
}

/** The system wall clock, reported confident/anchored — the identical stub shape
 *  `working-order.rls.test.ts`/`till-api.rls.test.ts` use. Task 9's `place`/`cancel` routes call
 *  `deps.clock.now()` unconditionally (the amendment's local wall-clock), even under `prepay` — this
 *  suite's cfg — where no fiscal doc is filed, so the stub can no longer be the inert `{}` the
 *  session-only routes got away with. */
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
      throw new Error("till-api.test: anchor() is not used by placeOrder/cancelPlacedOrder");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // `backend` is unused by every route this suite drives: the session/roster/park routes never
    // touch it, and `place`/`prep`/`cancel` only reach it under `invoice_first`/Mode-T-collect, which
    // this suite's `prepay` cfg never dispatches into (Task 8's `placeOrder`/`collectOrder` dispatch).
    // Stubbed (never called) so this suite pulls in no fiscal backend. `clock` IS real (see
    // `systemClock`) — `place`/`cancel` need it regardless of mode.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    // FALSE so the Set-Cookie is issued over the non-TLS `app.request` — it must still carry HttpOnly
    // and SameSite=Strict, and must NOT carry Secure.
    secureCookies: false,
    // No integrated card terminal here (the `cardProvider` PaymentProvider is left undefined). `GET
    // /api/till` echoes `deps.cfg.tipsEnabled` (this suite's `cfg` has it `false`); a separate test
    // below drives `cfg.tipsEnabled` to `true` to prove the route reads it rather than hardcoding.
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 * `loginWithPin` path the login route runs — and returns its id, so a test can hand `requireSession`
 * or the logout route a cookie that names a genuine row. */
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

/** Ends a session out of band on the app role, so a cookie can be made to name a CLOSED row. */
async function closeSession(db: Database, id: string): Promise<void> {
  await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await endSession(tx, id);
  });
}

describe("POST /api/session (log in) + DELETE /api/session (log out)", () => {
  it("POST opens a session and sets an httpOnly SameSite=Strict cookie; DELETE ends it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: ana.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    // The response carries the operator's OWN role (Ana is `staff`) so the till can gate manager-only
    // affordances client-side; the on-till placement route (Task 4) still re-checks the gate.
    expect(await res.json()).toEqual({ personId: ana.id, role: "staff" });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // secureCookies:false → no Secure attribute, so the cookie is usable over the non-TLS request.
    expect(cookie).not.toMatch(/Secure/i);

    const del = await app.request("/api/session", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    // DELETE actually stamped ended_at on the row the cookie named (read as superuser, RLS bypassed).
    const sessionId = /waitron_till_session=([^;]+)/.exec(cookie)![1];
    const rows = await suite.db.execute<{ ended: boolean }>(
      sql`select ended_at is not null as ended from sessions where id = ${sessionId}`,
    );
    expect(rows.rows).toEqual([{ ended: true }]);
  });

  it("POST carries a MANAGER operator's role in the session response (not hardcoded to staff)", async () => {
    // Seed + log in a manager to prove the response reflects the person's ACTUAL role — a mutant that
    // hardcoded "staff" (or dropped the field) fails here. Cleaned up so the roster's exact ordering
    // assertions elsewhere stay untouched.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const mgr = await suite.db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'Marta', ${hashPin("9999")}, 'manager') returning id`);
    const managerId = mgr.rows[0]!.id;

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: managerId, pin: "9999" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personId: managerId, role: "manager" });

    await suite.db.execute(sql`delete from sessions where person_id = ${managerId}`);
    await suite.db.execute(sql`delete from persons where id = ${managerId}`);
  });

  it("POST rejects a bad pin with 401 and a code", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: ana.id, pin: "0000" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
  });

  it("DELETE with no session cookie is an idempotent 200 no-op", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: nothing to end, but logout is idempotent — the cookie is cleared and the request
    // answered 200 rather than treated as an error.
    const del = await app.request("/api/session", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
  });

  it("DELETE with a NON-UUID cookie is an idempotent 200 that clears the cookie (never a 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A malformed cookie names no `uuid` row and must not reach the DB — `endSession` would raise
    // `22P02 invalid input syntax for type uuid`, which `run` maps to an opaque 500, contradicting the
    // route's documented idempotency (a stale/garbage cookie is never an error). The `isUuid` screen
    // skips `endSession`, clears the cookie and answers 200. Dropping the screen makes this a 500.
    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("DELETE naming an ALREADY-ended session is still an idempotent 200 that clears the cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A cookie naming a session that was already closed: `endSession` matches nothing, but logout
    // still answers 200 and clears the cookie (the idempotency the route comment claims).
    const id = await openSession(suite.db);
    await closeSession(suite.db, id);

    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    // The clear is a Set-Cookie that empties the value and expires it (deleteCookie → maxAge 0).
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });
});

describe("the run wrapper (the shared error boundary Tasks 5 & 6 reuse)", () => {
  it("maps a registered but UNMAPPED AppError code to 400 (its default)", async () => {
    const app = new Hono();
    // `tenant.not_found` is a real code deliberately absent from STATUS, so it takes the `?? 400`
    // default the wrapper falls back to for any code a later task forgets to map.
    app.get("/boom", (c) =>
      run(c, collect([]), () =>
        Promise.reject(new AppError("tenant.not_found", { id: randomUUID() })),
      ),
    );
    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "tenant.not_found" } });
  });

  it("maps a non-AppError to an opaque 500 server.internal and logs it at error", async () => {
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    app.get("/crash", (c) => run(c, collect(lines), () => Promise.reject(new Error("boom"))));

    const res = await app.request("/crash");
    expect(res.status).toBe(500);
    // No message leaks — only the opaque code, and the structured line is logged at error level with
    // `codeOf`'s classification (an unclassified value → "unknown").
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    const failed = lines.find((l) => l.event === "till.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.fields).toMatchObject({ errorCode: "unknown" });
  });
});

describe("requireSession (validates an OPEN session for Tasks 5 & 6's protected routes)", () => {
  // A throwaway route standing in for the protected routes Tasks 5/6 add: it calls `requireSession`
  // and echoes what it resolved. `requireSession` does the DB lookup, so these tests exercise real
  // validation, not a cookie-presence check.
  function guardApp(db: Database): Hono {
    const app = new Hono();
    const d = { db, cfg };
    app.get("/whoami", (c) => run(c, collect([]), async () => c.json(await requireSession(d, c))));
    return app;
  }

  it("ACCEPTS an open session and returns the operator's personId + sessionId", async () => {
    const id = await openSession(suite.db);
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personId: ana.id, sessionId: id });
  });

  it("REJECTS (401 session.required) when no cookie is present", async () => {
    const res = await guardApp(suite.db).request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a well-formed but nonexistent/forged session id", async () => {
    // A valid uuid the attacker guessed — never issued, so it names no row. A cookie is present, so a
    // mere presence check would WRONGLY accept it; the DB lookup is what refuses it.
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${randomUUID()}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie WITHOUT hitting the DB (not an opaque 500)", async () => {
    // A forged, non-UUID cookie is a CLIENT fault. Passed into the `uuid` column it would raise
    // `22P02` → an opaque 500; the `isUuid` shape screen in `requireSession` refuses it as
    // `session.required` (401) before any query. Dropping the screen turns this into a 500.
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) an ENDED session — logging out invalidates the cookie", async () => {
    // Open a real session, then end it. Its id still names a row, but `ended_at IS NOT NULL`, so the
    // `IS NULL` filter excludes it: a logged-out cookie is as good as no cookie.
    const id = await openSession(suite.db);
    await closeSession(suite.db, id);

    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("GET /api/staff (pre-login roster) + GET /api/till (public boot info)", () => {
  it("GET /api/staff lists ACTIVE staff sorted by name, no cookie required, no secrets", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie at all — the lock screen calls this before any session exists.
    const res = await app.request("/api/staff");
    expect(res.status).toBe(200);
    const staff = await res.json();
    // Sorted by displayName (Abel before Ana, though Abel was inserted second), suspended Zoe absent.
    expect(staff).toEqual([
      { personId: abel.id, displayName: "Abel" },
      { personId: ana.id, displayName: "Ana" },
    ]);
    // The roster carries the login id + display name only — nothing a customer or a bystander at the
    // lock screen must not see (no pin material, no role, no status).
    expect(JSON.stringify(staff)).not.toMatch(/pin|secret|password|url|cert|role|status|hash/i);
  });

  it("GET /api/till returns locale + issuer identity + orderFlow + card fields, and no secret", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The receipt-issuer identity Task 17's ticket view needs: the legal name + NIF printed on every
    // customer receipt, the till's UI locale, (7c) the location's pay-timing mode, and (integrated
    // card terminal) the card provider + tips flag the client picks its collect route / UI from. This
    // suite's `deps` cfg carries no terminal (`cardProvider: "none"`) and tips off. The tenant has
    // authored no layout, so `layout`/`receipt` are the built-in defaults (Task 8).
    expect(body).toEqual({
      locale: "es-ES",
      venueName: "Test SL",
      nif: venueTaxId,
      orderFlow: "prepay",
      cardProvider: "none",
      tipsEnabled: false,
      layout: DEFAULT_LAYOUT,
      receipt: DEFAULT_RECEIPT,
    });
    // Nothing sensitive: no pin, certificate, connection string or verification url reaches the wire.
    expect(JSON.stringify(body)).not.toMatch(/pin|secret|password|url|cert/i);
  });

  it("GET /api/till echoes a non-default cardProvider and cfg.tipsEnabled, proving it reads config rather than a hardcoded value", async () => {
    // A default of `none`/`false` would pass even if the route hardcoded those values, so drive both
    // to their OTHER value. Both now come off `deps.cfg` — `cardProvider` always did, and
    // `tipsEnabled` does too since `TillApiDeps.tipsEnabled` (a second copy that could never diverge
    // from `cfg.tipsEnabled`, since `boot.ts` set both from the SAME `till` object) was dropped as
    // redundant. Driving `cfg.tipsEnabled` to `true` here, against the suite default `false` asserted
    // above, still proves the route reads config rather than a constant.
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cfg: { ...cfg, cardProvider: "stripe_terminal", tipsEnabled: true } },
      collect([]),
    );

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ cardProvider: "stripe_terminal", tipsEnabled: true });
  });

  it("GET /api/till returns the AUTHORED layout + receipt when the tenant has one, not the defaults", async () => {
    // Seed a `till_layouts` row for the till's tenant (as the PGlite superuser, RLS bypassed — pure
    // setup, like the other seeds here). `GET /api/till` must return THIS authored definition/receipt
    // rather than DEFAULT_LAYOUT/DEFAULT_RECEIPT, proving the route reads the store rather than a
    // constant. Cleaned up in `finally` so the shared-tenant default case above stays order-independent
    // (CLAUDE.md §4). The authored layout differs from DEFAULT_LAYOUT (a product-grid columns config +
    // a trimmed widget set) so a route that hardcoded the default would fail this.
    const authored: LayoutDef = [
      { type: "product-grid", region: "main", config: { columns: 5 } },
      { type: "basket", region: "aside", config: {} },
      { type: "total", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
    ];
    const authoredReceipt: ReceiptConfig = { footerMessage: "Hasta pronto" };
    await suite.db.execute(sql`
      insert into till_layouts (tenant_id, definition, receipt)
      values (${cfg.tenantId}, ${JSON.stringify(authored)}::jsonb, ${JSON.stringify(authoredReceipt)}::jsonb)`);
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { layout: LayoutDef; receipt: ReceiptConfig };
      expect(body.layout).toEqual(authored);
      expect(body.receipt).toEqual(authoredReceipt);
    } finally {
      await suite.db.execute(sql`delete from till_layouts where tenant_id = ${cfg.tenantId}`);
    }
  });
});

describe("GET /api/products (session-guarded catalogue)", () => {
  it("REJECTS (401 session.required) when no cookie is present — proves the requireSession guard", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: the guard must refuse before any catalogue is read. Deleting the `requireSession`
    // call in the route makes this 200-with-the-list instead, which is the deletion proof.
    const res = await app.request("/api/products");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie — a malformed cookie is a 401, not a 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // Through the real route: a non-UUID cookie must be refused by the guard as 401 before any
    // catalogue read, not become an opaque 500 from a `22P02` on the `uuid` column.
    const res = await app.request("/api/products", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("RETURNS the location's available products when an open session's cookie is sent", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const id = await openSession(suite.db);
    const res = await app.request("/api/products", {
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.status).toBe(200);
    // The exact `AvailableProduct` shape the route reads back: the seeded product with its resolved
    // category NAME (not id), priced from the catalogue, its EU-14 allergen declaration carried
    // through unchanged, one entry for the one assigned product.
    expect(await res.json()).toEqual([
      {
        id: aguaProduct.id,
        descriptions: { "es-ES": "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        category: "Bebidas",
        allergens: { sulphites: { presence: "may_contain" } },
      },
    ]);
  });
});

describe("POST /api/sales (session-guarded sale)", () => {
  it("REJECTS (401 session.required) when no cookie is present — the sale never runs unauthenticated", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The guard runs BEFORE the body is even read, so an unauthenticated sale is refused with the
    // same code a missing session yields everywhere else. The chained fiscal write (the happy path)
    // and the idempotent replay are proven end-to-end over real Postgres in `till-api.rls.test.ts`,
    // not here — PGlite runs as a superuser and cannot exercise the deployment role's chained write
    // (CLAUDE.md §4).
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: [], tender: { method: "cash", amount: "0" } }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("POST with a malformed workingOrderId is 400 shared.invalid_id, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = await openSession(suite.db);

    // The 7b malformed-id follow-up for the OPTIONAL `workingOrderId` (only a malformed one is an error;
    // absent / well-formed-unknown are valid walk-ups). The non-empty basket + cash tender clear
    // `recordTillSale`'s early-outs, so in the RED state the id reaches `payWorkingOrder`'s
    // `eq(workingOrders.id, req.id)` lock read and `22P02`s → 500; the screen refuses it 400 first
    // (PGlite adequate — the screen fires at the HTTP boundary before any query, CLAUDE.md §4).
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${id}` },
      body: JSON.stringify({
        lines: [{ productId: aguaProduct.id, quantity: "1" }],
        tender: { method: "cash", amount: "10.00" },
        workingOrderId: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });
});

describe("POST /api/pay (session-guarded integrated card pay)", () => {
  it("REJECTS (401 session.required) when no cookie is present — a pay never runs unauthenticated", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The guard runs BEFORE the body is even read, matching every other session-guarded route. The
    // capture/decline/empty-basket happy paths are proven end-to-end over real Postgres in
    // `till-api.rls.test.ts` (PGlite runs as a superuser and cannot exercise the deployment role's
    // chained write or the provider's own FORCE RLS, CLAUDE.md §4).
    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), lines: [] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("500s server.internal when the till has no integrated card provider configured", async () => {
    // `deps(suite.db)` leaves `cardProvider` undefined — the shape a till boots with when
    // `WAITRON_TILL_CARD_PROVIDER=none` (`boot.ts`'s `buildCardProvider`). `mountTillApi` mounts this
    // route on EVERY till regardless of `cardProvider` (`boot.ts`'s `startServer`, which always calls
    // it), so `/api/pay` stays reachable on such a till: nothing at the HTTP layer stops a client from
    // posting here even though the till UI's own affordance is not expected to. That makes a request
    // reaching this branch a genuine misconfiguration/foreign-request fault — never a payment outcome
    // — refused BEFORE any DB write, with the SAME opaque `server.internal` 500 every other
    // non-AppError failure gets from `run`.
    const id = await openSession(suite.db);
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${id}` },
      body: JSON.stringify({ id: randomUUID(), lines: [] }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
  });

  it("POST with a malformed id is 400 shared.invalid_id, not an opaque 500 (the 7b /api/pay sibling)", async () => {
    const id = await openSession(suite.db);
    const app = new Hono();
    // A non-undefined stub provider clears the route's `cardProvider === undefined` guard, so in the RED
    // state a malformed `id` genuinely reaches `payWorkingOrderIntegrated`'s `eq(workingOrders.id, req.id)`
    // lock read — a `uuid` column — and `22P02`s → an opaque 500, the same exposure `/api/sales` has. The
    // route screen refuses it 400 first, so the stub is never invoked (PGlite adequate, CLAUDE.md §4).
    mountTillApi(app, { ...deps(suite.db), cardProvider: {} as PaymentProvider }, collect([]));

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${id}` },
      body: JSON.stringify({
        id: "not-a-uuid",
        lines: [{ productId: aguaProduct.id, quantity: "1" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });
});

// Park a fresh order for the logged-in operator over the real HTTP surface (never the working-order
// module directly), so every assertion using it rides the route's own requireSession + run wrapper.
// Module-scoped (not just `/api/working-orders`'s own describe) because Task 9's place/prep/cancel
// suites below all need a parked order to place first.
async function park(
  app: Hono,
  cookie: string,
  body: { id: string; lines: { productId: string; quantity: string }[]; label?: string },
): Promise<Response> {
  return app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("/api/working-orders (session-guarded park & retrieve)", () => {
  it("REJECTS every route with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    const json = { "content-type": "application/json" };
    // The guard runs FIRST on each route (before any body is read or catalogue touched), so an
    // unauthenticated park/list/retrieve/update/abandon/place/prep/prep-queue/collect/cancel all 401
    // with the one code. Deleting the `requireSession` call from any route flips that route's case to
    // a 200/404, the deletion proof.
    const cases = [
      app.request("/api/working-orders", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ id, lines: [] }),
      }),
      app.request("/api/working-orders"),
      app.request(`/api/working-orders/${id}`),
      app.request(`/api/working-orders/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ lines: [] }),
      }),
      app.request(`/api/working-orders/${id}`, { method: "DELETE" }),
      // Task 9 — the prep surface.
      app.request(`/api/working-orders/${id}/place`, { method: "POST" }),
      app.request(`/api/working-orders/${id}/prep`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({}),
      }),
      app.request("/api/prep-queue"),
      app.request(`/api/working-orders/${id}/collect`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ tender: { method: "cash", amount: "1.50" } }),
      }),
      app.request(`/api/working-orders/${id}/cancel`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ reason: "changed mind" }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("POST parks an order attributed to the session's till and returns { id, orderNumber }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();

    const res = await park(app, cookie, {
      id,
      lines: [{ productId: aguaProduct.id, quantity: "2" }],
      label: "Mesa 4",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; orderNumber: number };
    expect(body.id).toBe(id);
    // Per-(tenant,node) counter shared across this suite's tests, so assert the shape, not the value.
    expect(Number.isInteger(body.orderNumber)).toBe(true);
    expect(body.orderNumber).toBeGreaterThanOrEqual(1);

    // The order really persisted OPEN on the seeded till (read as the PGlite superuser, RLS bypassed).
    const rows = await suite.db.execute<{ status: string; till_id: string }>(
      sql`select status, till_id from working_orders where id = ${id}`,
    );
    expect(rows.rows[0]).toMatchObject({ status: "open", till_id: cfg.tillId });
  });

  it("POST with a malformed id is 400 shared.invalid_id, not an opaque 500 (the 7b park sibling)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // Park is the one route where the client MINTS the working-order id that becomes the PK:
    // `createOpenOrder` INSERTs `body.id` into the `working_orders.id` `uuid` column (working-order.ts),
    // so un-screened a malformed one `22P02`s → an opaque 500. The non-empty basket clears parkOrder's
    // empty-basket early-out so the INSERT is reached in the RED state; the route screen refuses it 400.
    const res = await park(app, cookie, {
      id: "not-a-uuid",
      lines: [{ productId: aguaProduct.id, quantity: "1" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });

  it("GET lists it, GET/:id retrieves its lines, PUT edits it, DELETE abandons it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();

    const parked = await park(app, cookie, {
      id,
      lines: [{ productId: aguaProduct.id, quantity: "2" }],
      label: "Mesa 7",
    });
    const { orderNumber } = (await parked.json()) as { orderNumber: number };

    // GET list carries this order's summary. `total` is the GROSS (VAT-inclusive) draft total the
    // operator saw: 2 × 1.50 = 3.00 gross (NOT the net base 2.48 the filed sale line carries). Assert
    // containment — the suite shares one node, so other tests' open orders also list.
    const list = await app.request("/api/working-orders", { headers: { cookie } });
    expect(list.status).toBe(200);
    const summaries = (await list.json()) as {
      id: string;
      orderNumber: number;
      label: string | null;
      itemCount: number;
      total: string;
    }[];
    expect(summaries).toContainEqual(
      expect.objectContaining({ id, orderNumber, label: "Mesa 7", itemCount: 1, total: "3.00" }),
    );

    // GET /:id rebuilds the basket inputs (product_id + quantity, in line order) — no stored price.
    // `quantity` reads back at the column's numeric(_, 3) scale ("2.000", not the sent "2").
    const got = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({
      id,
      orderNumber,
      label: "Mesa 7",
      lines: [{ productId: aguaProduct.id, quantity: "2.000" }],
    });

    // PUT replaces the whole basket + label — a 200 with no body — and a re-retrieve reflects it.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [{ productId: aguaProduct.id, quantity: "5" }],
        label: "Mesa 7 bis",
      }),
    });
    expect(put.status).toBe(200);
    expect(await put.text()).toBe("");
    const afterPut = await (
      await app.request(`/api/working-orders/${id}`, { headers: { cookie } })
    ).json();
    expect(afterPut).toEqual({
      id,
      orderNumber,
      label: "Mesa 7 bis",
      lines: [{ productId: aguaProduct.id, quantity: "5.000" }],
    });

    // DELETE abandons it — a 200 with no body — after which retrieve is 404 and it leaves the list.
    const del = await app.request(`/api/working-orders/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.text()).toBe("");
    const goneGet = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(goneGet.status).toBe(404);
    expect(await goneGet.json()).toMatchObject({ error: { code: "working_order.not_found" } });
    const afterList = (await (
      await app.request("/api/working-orders", { headers: { cookie } })
    ).json()) as { id: string }[];
    expect(afterList.find((o) => o.id === id)).toBeUndefined();
  });

  it("GET /:id of an unknown id is 404 working_order.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request(`/api/working-orders/${randomUUID()}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "working_order.not_found" } });
  });

  it("PUT of an abandoned (terminal) order is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ productId: aguaProduct.id, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}`, { method: "DELETE", headers: { cookie } });

    // The order now sits in the terminal `abandoned` state, so an edit is refused 409 — the mutation
    // counterpart to the retrieve side's 404.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ productId: aguaProduct.id, quantity: "2" }] }),
    });
    expect(put.status).toBe(409);
    expect(await put.json()).toMatchObject({ error: { code: "working_order.not_open" } });
  });

  // The 7b malformed-id follow-up for the retrieve/edit/abandon routes — the counterparts of the
  // place/prep/collect/cancel malformed-id tests below. An un-screened `:id` reaches
  // `getHeldOrder`/`updateHeldOrder`/`abandonHeldOrder`'s `eq(workingOrders.id, id)` (a `uuid` column)
  // and `22P02`s → an opaque 500; the `requireUuidId` screen refuses it FIRST with the same domain code
  // an absent/non-open id gets on that route. PGlite adequate — the screen fires before any query runs
  // (CLAUDE.md §4).
  it("GET /:id with a malformed id is 404 working_order.not_found, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("PUT /:id with a malformed id is 409 working_order.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A well-formed body, so the route parses it and reaches the (un-screened) `updateHeldOrder` query
    // in the RED state — this 409, not a 500, is the witness the screen refuses before that query.
    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ productId: aguaProduct.id, quantity: "1" }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("DELETE /:id with a malformed id is 409 working_order.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// Task 9 — the prep surface's till routes. This suite's cfg is `prepay` (never `invoice_first`), so
// `placeOrder`/`cancelPlacedOrder` never dispatch into the fiscal backend (Task 8's mode dispatch) —
// only `deps.clock` is genuinely needed (see `systemClock` above), so these routes are testable
// hermetically. `collectOrder`'s NON-fiscal path (a malformed id, refused before any dispatch) is
// tested here too, for the same reason; its FISCAL happy path needs a real backend and lives in
// `till-api.rls.test.ts`.
describe("/api/working-orders/:id/place (send-to-prep placing)", () => {
  it("POST places an open order (open → placed), enqueues prep at queued, and returns { id, status }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ productId: aguaProduct.id, quantity: "1" }],
      label: "Mesa 2",
    });

    const placed = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie },
    });
    expect(placed.status).toBe(200);
    // `prepay` files nothing at placing (Task 8's dispatch) — just the bare transition result.
    expect(await placed.json()).toEqual({ id, status: "placed" });

    // The order really transitioned AND a prep row was enqueued — send-to-prep = placing (design §5).
    // Read as the PGlite superuser (RLS bypassed), a plain state witness.
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
    const prep = await suite.db.execute<{ state: string }>(
      sql`select state from order_prep where working_order_id = ${id}`,
    );
    expect(prep.rows[0]).toEqual({ state: "queued" });
  });

  it("POST on a non-open order (a re-place of an already-placed one) is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ productId: aguaProduct.id, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, { method: "POST", headers: { cookie } });

    const rePlace = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie },
    });
    expect(rePlace.status).toBe(409);
    expect(await rePlace.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: id } },
    });
  });

  it("POST with a malformed id is 409 working_order.not_open, not an opaque 500 (the 7b isUuid follow-up)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // "not-a-uuid" passed straight into `eq(workingOrders.id, id)` would `22P02` in the DB → an
    // opaque 500; the route's `isUuid` screen refuses it first.
    const res = await app.request("/api/working-orders/not-a-uuid/place", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("/api/working-orders/:id/prep + GET /api/prep-queue", () => {
  // `sendToPrep` (a `{}` body) needs a SETTLED order (fix round 1), and settling one under this
  // suite's `prepay` cfg means a real fiscal write the stub `FiscalBackend` cannot make — so the
  // send-to-prep SUCCESS path (a genuine Mode-P walk-up settled via `POST /api/sales`, then sent to
  // prep) lives in `till-api.rls.test.ts`. This suite proves the REFUSAL the route now forwards, and
  // the advance/malformed-id mechanics using `placeOrder`'s OWN enqueue (which needs no fiscal write
  // under this suite's `prepay` cfg — Task 8's dispatch only reaches the backend for `invoice_first`)
  // to seed a queued row instead of `sendToPrep`.
  it("POST {} on a still-OPEN (parked, unpaid) order is refused 409 working_order.not_settled, not enqueued", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ productId: aguaProduct.id, quantity: "1" }],
      label: "Mesa 5",
    });

    const sent = await app.request(`/api/working-orders/${id}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe(409);
    expect(await sent.json()).toMatchObject({
      error: { code: "working_order.not_settled", params: { workingOrderId: id } },
    });

    // Refused BEFORE any write — the order never appears on the prep queue.
    const queue = await app.request("/api/prep-queue", { headers: { cookie } });
    const entries = (await queue.json()) as { id: string }[];
    expect(entries.find((e) => e.id === id)).toBeUndefined();
  });

  it("POST { to } advances a prep-queued order one step; skipping straight to a later state is refused", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ productId: aguaProduct.id, quantity: "1" }],
      label: "Mesa 6",
    });
    // `placeOrder`'s OWN enqueue seeds the `queued` row — no fiscal write needed under `prepay` (Task
    // 8's dispatch only reaches the backend for `invoice_first`), unlike `sendToPrep` (see above).
    await app.request(`/api/working-orders/${id}/place`, { method: "POST", headers: { cookie } });

    const queueBefore = await app.request("/api/prep-queue", { headers: { cookie } });
    const before = (await queueBefore.json()) as {
      id: string;
      state: string;
      label: string | null;
    }[];
    expect(before).toContainEqual(
      expect.objectContaining({ id, state: "queued", label: "Mesa 6" }),
    );

    const advance = (to: string) =>
      app.request(`/api/working-orders/${id}/prep`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });

    const toPreparing = await advance("preparing");
    expect(toPreparing.status).toBe(200);
    expect(await toPreparing.text()).toBe("");

    // Skipping straight from `preparing` to `collected` (the legal next step is `ready`) is refused —
    // 409 order_prep.invalid_transition, the domain code every illegal prep move surfaces.
    const skip = await advance("collected");
    expect(skip.status).toBe(409);
    expect(await skip.json()).toMatchObject({
      error: { code: "order_prep.invalid_transition", params: { workingOrderId: id } },
    });
  });

  it("POST with a malformed id is 409 order_prep.invalid_transition, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid/prep", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "order_prep.invalid_transition", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("/api/working-orders/:id/collect (malformed id — the fiscal happy path is till-api.rls.test.ts)", () => {
  it("POST with a malformed id is 409 working_order.not_placed BEFORE any fiscal dispatch, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // The stub `backend: {} as FiscalBackend` would throw (a non-AppError → opaque 500) the moment
    // `collectOrder` tried to use it — this 409, not a 500, is the witness that the `isUuid` screen
    // refuses BEFORE `collectOrder` is even called.
    const res = await app.request("/api/working-orders/not-a-uuid/collect", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tender: { method: "cash", amount: "1.50" } }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_placed", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("/api/working-orders/:id/cancel", () => {
  it("POST cancels a PLACED order (placed → abandoned) given a reason", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ productId: aguaProduct.id, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, { method: "POST", headers: { cookie } });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "customer left" }),
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.text()).toBe("");

    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "abandoned" });
  });

  it("POST with an empty reason is 400 working_order.reason_required, changing nothing", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ productId: aguaProduct.id, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, { method: "POST", headers: { cookie } });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "" }),
    });
    expect(cancel.status).toBe(400);
    expect(await cancel.json()).toMatchObject({ error: { code: "working_order.reason_required" } });

    // Refused BEFORE any transition — still `placed`, the guard `cancelPlacedOrder` itself enforces.
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
  });

  it("POST with a malformed id is 409 working_order.not_placed, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "changed mind" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_placed", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// FP-1 Task 6 — the live-floor till surface: GET /api/zones (list-only), the mark/unmark-served
// route, and the zoneId + pendingToServe fields Task 4 added to the /api/tables/state read. All
// SESSION-GUARDED, all wrapped in `run`. served_at is a PRE-FISCAL operational field (design H2):
// nothing here touches a fiscal path. A zone is SEEDED directly as the PGlite superuser (RLS bypassed
// — pure setup, exactly as the location/till/node seeds in `setup` above; zone CRUD is the management
// API's, Task 5), then read back / assigned through the app-role routes under test.
describe("/api/zones + served route + /api/tables/state occupancy fields (FP-1, Task 6)", () => {
  it("lists zones, marks a line served (2→1) and unmarks it (1→2), surfacing zoneId + pendingToServe in the state read", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // Seed one active floor zone in the till's own venue. `GET /api/zones` must read it back through
    // the app role, and the table-create must accept it, so those two paths — not this insert — are
    // under test. This is the only zone-seeding test in the suite, so "Comedor" cannot collide.
    const zoneRow = await suite.db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${cfg.tenantId}, ${cfg.locationId}, 'Comedor') returning id`);
    const zoneId = zoneRow.rows[0]!.id;

    // Create a table IN that zone through the till route, so `createTable`'s zoneId assignment (and its
    // composite zone FK) is exercised — not a raw insert.
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "4", zoneId }),
    });
    expect(tableRes.status).toBe(200);
    const { id: tableId } = (await tableRes.json()) as { id: string };

    // Open a tab with TWO lines. `priceBasket` maps items 1:1 (it does NOT merge by product), so two
    // lines of the one seeded product become line_no 1 and 2 — pendingToServe starts at 2.
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [
          { productId: aguaProduct.id, quantity: "1" },
          { productId: aguaProduct.id, quantity: "1" },
        ],
      }),
    });
    expect(tabRes.status).toBe(200);
    const { tabId } = (await tabRes.json()) as { tabId: string };

    // GET /api/zones lists the active zone (session-gated, read through the app role, by display_order).
    const zonesRes = await app.request("/api/zones", { headers: { cookie } });
    expect(zonesRes.status).toBe(200);
    const zones = (await zonesRes.json()) as {
      id: string;
      name: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(zones.map((z) => z.name)).toContain("Comedor");
    expect(zones).toContainEqual({ id: zoneId, name: "Comedor", displayOrder: 0, active: true });

    // Read this table's occupancy row out of the state read.
    const stateOf = async () => {
      const res = await app.request("/api/tables/state", { headers: { cookie } });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as {
        id: string;
        zoneId: string | null;
        pendingToServe: number;
      }[];
      return rows.find((t) => t.id === tableId)!;
    };

    // The state read carries the table's zoneId (Task 4) and its pending-to-serve count (2 unserved).
    let state = await stateOf();
    expect(state.zoneId).toBe(zoneId);
    expect(state.pendingToServe).toBe(2);

    // POST marks line 1 delivered — pendingToServe drops to 1. A 200 with an empty body.
    const served = await app.request(`/api/working-orders/${tabId}/lines/1/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("");
    state = await stateOf();
    expect(state.pendingToServe).toBe(1);

    // DELETE clears the marker again (the mis-tap inverse) — pendingToServe returns to 2.
    const unserved = await app.request(`/api/working-orders/${tabId}/lines/1/served`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(unserved.status).toBe(200);
    expect(await unserved.text()).toBe("");
    state = await stateOf();
    expect(state.pendingToServe).toBe(2);
  });

  it("REJECTS GET /api/zones + the served POST/DELETE with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    // The guard runs FIRST on each route (before any DB work), so an unauthenticated list/mark/unmark
    // all 401 with the one code. Deleting the `requireSession` call from any of them flips its case.
    const cases = [
      app.request("/api/zones"),
      app.request(`/api/working-orders/${id}/lines/1/served`, { method: "POST" }),
      app.request(`/api/working-orders/${id}/lines/1/served`, { method: "DELETE" }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("served POST with a malformed :id is 409 tab.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A non-UUID :id passed into `eq(workingOrders.id, id)` would 22P02 → an opaque 500; the tab screen
    // refuses it first with the SAME code a non-open/absent tab gets from `markLineServed` (the
    // fail-closed shape the sibling void-line route uses).
    const res = await app.request("/api/working-orders/not-a-uuid/lines/1/served", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("served POST with a :lineNo that is not an in-range int4 line number is 404 tab.line_not_found, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A REAL open tab, so `markLineServed`'s `lockOpenTab` passes and the malformed :lineNo genuinely
    // reaches the `where line_no = $n` UPDATE in the RED (screen-removed) state — the witness that the
    // route screen, not the verb, is what refuses it. "abc"/"1.5"/NaN and "9999999999" (which clears
    // `Number.isInteger` but exceeds int4's max) would raise `22P02`/`22003` → an opaque 500 there;
    // "0" is below the 1-based floor. All four are refused BEFORE any query as the honest 404 an absent
    // line gets — the same shape the sibling void-line route screens.
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "served-bad-lineno" }),
    });
    const { id: tableId } = (await tableRes.json()) as { id: string };
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ productId: aguaProduct.id, quantity: "1" }] }),
    });
    const { tabId } = (await tabRes.json()) as { tabId: string };

    for (const lineNo of ["abc", "1.5", "0", "9999999999"]) {
      const res = await app.request(`/api/working-orders/${tabId}/lines/${lineNo}/served`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
    }
  });

  it("served POST naming a line that does not exist on a real open tab is 404 tab.line_not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A real open tab (one line), then a mark of line 99 — an in-range int4 that clears the route
    // screen and reaches `markLineServed`, whose 0-row UPDATE throws `tab.line_not_found`. This is the
    // verb's own guard, distinct from the route's range screen above.
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "served-99" }),
    });
    const { id: tableId } = (await tableRes.json()) as { id: string };
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ productId: aguaProduct.id, quantity: "1" }] }),
    });
    const { tabId } = (await tabRes.json()) as { tabId: string };

    const res = await app.request(`/api/working-orders/${tabId}/lines/99/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.line_not_found", params: { tabId, lineNo: 99 } },
    });
  });

  it("served POST on a well-formed id that names no OPEN tab is 409 tab.not_open (markLineServed's own guard)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A valid uuid naming no open tab a table points at (never opened, or settled/abandoned/foreign):
    // clears the route's isUuid screen, reaches `markLineServed`, whose `lockOpenTab` matches no row →
    // tab.not_open (409).
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/1/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });
});

describe("PUT + DELETE /api/tables/:id/placement — the on-till authorize(till.configure) gate (FP-2, Task 4)", () => {
  // PGlite, like the rest of this suite. The novel thing under test is the FIRST on-till
  // `authorize(till.configure)` hop: the route resolves the SESSION operator's OWN role and refuses a
  // write the role cannot make (no supervisor override this slice — manager-on-till only). That gate is
  // `authorize` reading `persons.role` for the open session and asking `roleHasPermission` — a query
  // plus a JS lookup whose 204-vs-403 outcome is IDENTICAL on PGlite and real Postgres, because it
  // turns on the person's role VALUE, not on any privilege / RLS-as-deployment-role / concurrency
  // behaviour (CLAUDE.md §4's real-PG triggers). The write itself (`setTablePlacement`'s UPDATE on
  // dining_tables under FORCE RLS as app_user) is proven over REAL Postgres by the management-api
  // placement sibling, which wraps the SAME verb (management-api.test.ts). So the lighter target is the
  // right one here and the heavier one adds nothing to THIS gate proof — the choice §4 asks to state.

  // A live zone every placement body points at, and the two operators the gate distinguishes: a MANAGER
  // (role `manager`, which holds `till.configure`) and a STAFF operator (Ana, role `staff`, which does
  // NOT — reused from setup rather than re-seeded). Both are GENUINE `persons.role` values logged in
  // through the real `loginWithPin` path; the role is never faked.
  let managerCookie: string;
  let managerPersonId: string;
  let staffCookie: string;
  let zoneId: string;

  beforeAll(async () => {
    const managerRow = await suite.db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'Manolo (manager)', ${hashPin("9999")}, 'manager') returning id`);
    managerPersonId = managerRow.rows[0]!.id;
    const managerSession = await withTenant(suite.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return loginWithPin(tx, {
        tenantId: cfg.tenantId,
        tillId: cfg.tillId,
        personId: managerPersonId,
        pin: "9999",
      });
    });
    managerCookie = `${SESSION_COOKIE}=${managerSession.id}`;
    // Ana (role `staff`) is the STAFF operator — no `till.configure`. Reusing the setup fixture keeps
    // the roster's `[abel, ana]` invariant untouched (no extra staff person seeded).
    staffCookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const zoneRow = await suite.db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${cfg.tenantId}, ${cfg.locationId}, 'Sala') returning id`);
    zoneId = zoneRow.rows[0]!.id;
  });

  // Remove the seeded manager (and its session) so `GET /api/staff`'s EXACT `[abel, ana]` roster
  // assertion stays order-independent whatever order the suites run in (CLAUDE.md §4).
  afterAll(async () => {
    await suite.db.execute(sql`delete from sessions where person_id = ${managerPersonId}`);
    await suite.db.execute(sql`delete from persons where id = ${managerPersonId}`);
  });

  /** A valid full placement against the live `zoneId`: a real `floor_table_shape` member and in-range
   *  coordinates/rotation, so nothing in the body is itself the fault under test. */
  function place() {
    return { zoneId, posX: 120, posY: 340, shape: "rect", rotation: 90 };
  }

  /** Create a fresh table (unique label) through the till route, returning its id — a distinct row per
   *  test so the PUT/DELETE cases never contend on one table's placement. */
  async function makeTable(app: Hono): Promise<string> {
    const res = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ label: `placement-${randomUUID().slice(0, 8)}` }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  }

  /** Read a table's four placement columns (plus zone_id) back as the PGlite superuser (RLS bypassed —
   *  a pure assertion read, not a path under test). */
  async function placementOf(tableId: string) {
    const rows = await suite.db.execute<{
      pos_x: number | null;
      pos_y: number | null;
      shape: string | null;
      rotation: number | null;
      zone_id: string | null;
    }>(sql`select pos_x, pos_y, shape, rotation, zone_id from dining_tables where id = ${tableId}`);
    return rows.rows[0]!;
  }

  it("a MANAGER operator places a table (204, placement landed); a STAFF operator is 403", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // Manager holds `till.configure`: `authorize` passes, the placement is written, the route answers 204.
    const ok = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    // The four placement columns (plus zone_id) actually landed on the row.
    expect(await placementOf(tableId)).toEqual({
      pos_x: 120,
      pos_y: 340,
      shape: "rect",
      rotation: 90,
      zone_id: zoneId,
    });

    // Staff holds no `till.configure` and sends no override: `authorize` throws
    // `authorization.not_permitted`, which the till STATUS map answers 403. (Removing the `authorize`
    // call flips this case to a 204 — the gate deletion-proof this task runs.)
    const forbidden = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: staffCookie },
      body: JSON.stringify(place()),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "till.configure" } },
    });
  });

  it("a MANAGER operator clears a placement (204, columns NULLed); a STAFF operator is 403", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // Place it first (as the manager) so there is something to clear.
    const placed = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(placed.status).toBe(204);

    // Staff cannot clear either — the same gate, 403 before any write.
    const forbidden = await app.request(`/api/tables/${tableId}/placement`, {
      method: "DELETE",
      headers: { cookie: staffCookie },
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    // The staff 403 wrote nothing: the placement the manager set is still present.
    expect(await placementOf(tableId)).toMatchObject({ pos_x: 120, pos_y: 340 });

    // Manager clears it: the four placement columns go NULL (zone_id is an FP-1 assignment, left as-is).
    const cleared = await app.request(`/api/tables/${tableId}/placement`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(cleared.status).toBe(204);
    expect(await cleared.text()).toBe("");
    expect(await placementOf(tableId)).toMatchObject({
      pos_x: null,
      pos_y: null,
      shape: null,
      rotation: null,
      zone_id: zoneId,
    });
  });

  it("a malformed :id is 404 table.not_found on PUT and DELETE (the screen, never an opaque 22P02 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A non-UUID :id passed into `eq(diningTables.id, id)` would 22P02 → an opaque 500; the isUuid screen
    // refuses it first with the domain `table.not_found` (404), the shape the sibling PATCH/DELETE
    // /api/tables routes use. The MANAGER cookie proves it is the SCREEN, not the gate, that rejects it —
    // an authorized operator still gets the 404 (the screen runs before `authorize`).
    const put = await app.request("/api/tables/not-a-uuid/placement", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });

    const del = await app.request("/api/tables/not-a-uuid/placement", {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(del.status).toBe(404);
    expect(await del.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });
  });

  it("a malformed zoneId in the PUT body is 404 zone.not_found (the screen, never an opaque 22P02 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // A string-typed but non-UUID zoneId reaches `setTablePlacement`'s `where floor_zones.id = ${zoneId}`
    // read → 22P02 → opaque 500 un-screened; the route screens it to the SAME `zone.not_found` a
    // well-formed-but-missing zone gets, matching the sibling table POST/PATCH routes.
    const res = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ ...place(), zoneId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "zone.not_found", params: { zoneId: "not-a-uuid" } },
    });
  });

  it("a placement VALUE fault surfaces the verb's placement.invalid as 400 through the till route", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // posX above the 0..1000 canvas bound is `setTablePlacement`'s `placement.invalid` naming the field
    // (reached only AFTER `authorize` passes for the manager). The till STATUS map answers it 400 — the
    // entry this task lists explicitly; absent it the `?? 400` default yields the same 400, so this pins
    // the surfaced status rather than proving the entry load-bearing.
    const res = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ ...place(), posX: 5000 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "placement.invalid", params: { field: "posX" } },
    });
  });
});
