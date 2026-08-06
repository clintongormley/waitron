import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, endSession, hashPin, loginWithPin } from "@waitron/identity";
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
// the route reads back — id, descriptions, unit price, VAT class and the resolved category NAME.
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
    expect(await res.json()).toEqual({ personId: ana.id });

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

  it("GET /api/till returns locale + issuer identity (venueName + nif) and no secret", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The receipt-issuer identity Task 17's ticket view needs: the legal name + NIF printed on every
    // customer receipt, plus the till's UI locale.
    expect(body).toEqual({ locale: "es-ES", venueName: "Test SL", nif: venueTaxId });
    // Nothing sensitive: no pin, certificate, connection string or verification url reaches the wire.
    expect(JSON.stringify(body)).not.toMatch(/pin|secret|password|url|cert/i);
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
    // category NAME (not id), priced from the catalogue, one entry for the one assigned product.
    expect(await res.json()).toEqual([
      {
        id: aguaProduct.id,
        descriptions: { "es-ES": "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        category: "Bebidas",
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
  it("POST {} sends a parked order to prep at queued — GET /api/prep-queue then lists it", async () => {
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
    expect(sent.status).toBe(200);
    expect(await sent.text()).toBe("");

    const queue = await app.request("/api/prep-queue", { headers: { cookie } });
    expect(queue.status).toBe(200);
    const entries = (await queue.json()) as { id: string; state: string; label: string | null }[];
    expect(entries).toContainEqual(
      expect.objectContaining({ id, state: "queued", label: "Mesa 5" }),
    );
  });

  it("POST { to } advances the prep state one step; skipping straight to a later state is refused", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ productId: aguaProduct.id, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });

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
