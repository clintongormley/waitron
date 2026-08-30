import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TenantId } from "@waitron/shared";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// PGlite, not real Postgres: these routes are wiring — session guard + isUuid screen + STATUS mapping
// over the commercial table/tab verbs, which are LOGIC (no privilege or concurrency behaviour to
// prove here). The table/tab verbs' own real-PG proofs (RLS, the FOR UPDATE tab lock, the composite
// FKs) live in their packages' `*.rls.test.ts`; they are not re-proven at the HTTP layer. The schema
// is CORE_MIGRATIONS (dining_tables + tab_id/delivery_table_id land in 0043/0044/0046) +
// IDENTITY_MIGRATIONS (the sessions/persons the login path needs).
let cfg: TillConfig;
let ana: { id: string };
// The one product seeded into the counter location's catalogue, so a tab can open with a real line
// (`openTab`/`addTabRound` price it and the `check_locales` trigger demands its `es-ES` description
// key match the location's `es-ES` locale).
let productId: string;
// A real `floor_zones` row in the counter location — a table's `zoneId` is now a composite FK to
// `floor_zones`, not a free-text string, so the create/patch table tests point at THIS id. (The zone
// CRUD verbs have no HTTP route yet — that is a later FP-1 task — so it is seeded directly here.)
let seededZoneId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    // invoice_locales is `es-ES` (full-tag, fiscal). The product is authored under the BARE `es` key;
    // `priceOrderLines` re-keys its descriptions to the location's `es-ES` before the tab
    // line-insert fires `check_locales`, which demands a line's `descriptions` keys equal the
    // location's locales exactly — the same constraint the park route's harness documents.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
    // KDS-1: a default kitchen station so addTabRound's fire (→ fireLines) has a fallback. Seeded as
    // the PGlite superuser here, as the surrounding venue rows are (RLS bypassed in setup).
    await seedKitchenStation(db, { tenantId, locationId: brandLocationId(loc.rows[0]!.id) });
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
    // A node the tab's working-order write needs: `openTab`/`addTabRound` create an `open`
    // working_orders row whose composite FK `(tenant_id, node_id) → nodes(tenant_id, id)` requires a
    // real row; `cfg.nodeId` names THIS one.
    const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
    // Ana logs in with PIN "5555"; the session cookie the routes require names her shift.
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    // One product in a catalogue assigned to the counter location, seeded on the APP role via the
    // catalogue helpers — the same `withTenant` + `asAppUser` path the tab verbs price it through, so
    // the active/assignment filters are real, not bypassed by a superuser insert.
    const product = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { es: "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, loc.rows[0]!.id, cat.id);
      return p;
    });
    productId = product.id;
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Terraza') returning id`);
    seededZoneId = zone.rows[0]!.id;
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id, nodeId);
  },
});

/** A collecting logger — the routes' structured lines are not asserted here, only that a code maps. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `seriesId` is unused by these routes (no fiscal write on
 *  the tab/table path) so it carries a fresh uuid; `nodeId`/`locationId` are the seeded rows the tab
 *  and table reads write/scope by. */
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

/** The system wall clock — the table/tab routes never file a fiscal doc under this `prepay` cfg, but
 *  `TillApiDeps` demands a clock, so the same stub shape the sibling suites use is supplied. */
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
      throw new Error("till-api.tables.test: anchor() is not used by the table/tab routes");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // Never called by the table/tab routes — none files a fiscal doc under this suite's `prepay` cfg.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 *  `loginWithPin` path the login route runs — and returns its id. */
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

// One app + one logged-in session shared across the table/tab tests. The suite's PGlite db persists,
// so tables accumulate across tests — which is why every list assertion below is a membership check
// (`.toContainEqual` / `.find`), never an exact-list assertion that would depend on execution order (§4).
// `request` attaches the JSON content-type and the session cookie, so each test drives the real
// session-guarded surface.
let app: Hono;
let cookie: string;

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });
}

describe("table + tab routes", () => {
  it("POST /api/tables creates and GET /api/tables lists it", async () => {
    const create = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "12", zoneId: seededZoneId, capacity: 4 }),
    });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as { id: string };
    const list = (await (await request("/api/tables")).json()) as unknown[];
    // Membership, not an exact one-element array: the suite's PGlite db persists across tests, so an
    // exact-list assertion would be order-reliant (§4). `.toContainEqual` holds no matter what other
    // table-creating tests have run.
    expect(list).toContainEqual(
      expect.objectContaining({ id, label: "12", zoneId: seededZoneId, active: true }),
    );
  });

  it("POST /api/tables with an unknown zoneId → 404 zone.not_found", async () => {
    // The table create route now forwards `zoneId` to `createTable`; one naming no `floor_zones` row
    // trips the composite `dining_tables_zone_fk` (23503), surfaced as the domain `zone.not_found`
    // (404 via the STATUS map) rather than an opaque 500. A real zoneId is proven by the create test
    // above; this is its negative counterpart.
    const res = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "orphan-zone", zoneId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST /api/tables with a MALFORMED zoneId → 404 zone.not_found (isUuid guard, not an opaque 22P02 500)", async () => {
    // A non-UUID `zoneId` string is screened to the domain `zone.not_found` (→ 404) BEFORE any DB work —
    // the SAME code a well-formed-but-missing zoneId gets (the test above), so a bad zone reads the same
    // whether it is malformed or merely absent. Without the `isUuid` screen the string reaches the
    // `zone_id` uuid column and PostgreSQL raises `22P02 (invalid_text_representation)`, a non-AppError the
    // boundary turns into an opaque `server.internal` 500 — the prove-by-deletion (drop the screen → 500).
    const res = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "bad-zone", zoneId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST /api/tables with a duplicate label → 409 table.label_taken", async () => {
    await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "7" }) });
    const dup = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "7" }),
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "table.label_taken" } });
  });

  it("POST /api/tables with an OUT-OF-int4-RANGE capacity → 400 management.request_invalid (not an opaque 22003 500)", async () => {
    // `dining_tables.capacity` is int4. `9999999999` is a valid JS number, so a bare type check would
    // let it through; it would then bind into the insert on the int4 column and PostgreSQL would raise
    // `22003 (numeric_value_out_of_range)` — a non-AppError the boundary turns into an opaque
    // `server.internal` 500 (the same class the table verb's own `tables.test.ts` "rethrows raw"
    // asserts below the route). The route's `requireCapacity` range guard refuses it as a domain 400
    // BEFORE any DB work. Dropping the `> 2_147_483_647` bound makes this a 500 — the prove-by-deletion.
    const res = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "over-cap", capacity: 9_999_999_999 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capacity" } },
    });
  });

  it("PATCH /api/tables/:id with a NEGATIVE capacity → 400 management.request_invalid (not a 500)", async () => {
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "neg-cap" }) })
    ).json()) as { id: string };
    const res = await request(`/api/tables/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ capacity: -1 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capacity" } },
    });
  });

  it("PATCH /api/tables/:id with a malformed id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ label: "X" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("PATCH /api/tables/:id with a MALFORMED zoneId → 404 zone.not_found (isUuid guard, not an opaque 22P02 500)", async () => {
    // The twin of the malformed-:id screen above, one field over: a present-but-non-UUID `zoneId` in the
    // body is screened to `zone.not_found` (→ 404) BEFORE `updateTable`, the SAME code a well-formed-but-
    // missing zoneId gets. Without the screen the string reaches the `zone_id` uuid column → `22P02` →
    // opaque `server.internal` 500 (the prove-by-deletion). A real table id is used so the id screen passes
    // and the zoneId screen is what fires.
    const { id } = (await (
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "bad-zone-patch" }),
      })
    ).json()) as { id: string };
    const res = await request(`/api/tables/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ zoneId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PATCH /api/tables/:id edits a real table (label/zoneId/capacity) and returns an empty 200", async () => {
    const { id } = (await (
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "20", zoneId: seededZoneId, capacity: 2 }),
      })
    ).json()) as { id: string };

    const res = await request(`/api/tables/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "20A", capacity: 6 }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const list = (await (await request("/api/tables")).json()) as {
      id: string;
      label: string;
      zoneId: string | null;
      capacity: number | null;
    }[];
    expect(list.find((t) => t.id === id)).toMatchObject({
      label: "20A",
      zoneId: seededZoneId,
      capacity: 6,
    });
  });

  it("DELETE /api/tables/:id deactivates a real table (it leaves the active list)", async () => {
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "21" }) })
    ).json()) as { id: string };

    const res = await request(`/api/tables/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const list = (await (await request("/api/tables")).json()) as { id: string }[];
    expect(list.find((t) => t.id === id)).toBeUndefined();
  });

  it("DELETE /api/tables/:id with a malformed id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("POST /api/tables/:id/tab opens a tab; a second → 409 tab.already_open", async () => {
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "3" }) })
    ).json()) as { id: string };
    const open = await request(`/api/tables/${id}/tab`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ productId, quantity: "1" }] }),
    });
    expect(open.status).toBe(200);
    const { tabId } = (await open.json()) as { tabId: string };
    expect(tabId).toBeDefined();

    const again = await request(`/api/tables/${id}/tab`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "tab.already_open" } });
  });

  it("POST /api/tables/:id/tab with a malformed id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid/tab", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("POST /api/working-orders/:id/round appends; DELETE .../lines/:lineNo voids; GET /api/tables/state reflects it", async () => {
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "5" }) })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ productId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };

    const round = await request(`/api/working-orders/${tabId}/round`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ productId, quantity: "1" }] }),
    });
    expect(round.status).toBe(200);
    expect(await round.text()).toBe("");

    const voided = await request(`/api/working-orders/${tabId}/lines/1`, { method: "DELETE" });
    expect(voided.status).toBe(200);
    expect(await voided.text()).toBe("");

    const state = (await (await request("/api/tables/state")).json()) as {
      id: string;
      state: string;
      tabLineCount?: number;
    }[];
    expect(state.find((t) => t.id === id)).toMatchObject({ state: "open-tab", tabLineCount: 1 });
  });

  it("GET /api/working-orders/:id/lines reads an open tab's lines with locked price + served state", async () => {
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "9" }) })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ productId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };
    // A second round so there are two lines, then serve line 1 (the two floor states the screen renders).
    await request(`/api/working-orders/${tabId}/round`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ productId, quantity: "2" }] }),
    });
    await request(`/api/working-orders/${tabId}/lines/1/served`, { method: "POST" });

    const res = await request(`/api/working-orders/${tabId}/lines`);
    expect(res.status).toBe(200);
    const lines = (await res.json()) as {
      lineNo: number;
      productId: string;
      quantity: string;
      unitPriceGross: string;
      servedAt: string | null;
    }[];
    expect(lines).toHaveLength(2);
    // Seeded product is 1.50; the locked gross unit rides back verbatim, quantity at numeric(_,3).
    expect(lines[0]).toMatchObject({
      lineNo: 1,
      productId,
      quantity: "1.000",
      unitPriceGross: "1.50",
    });
    expect(lines[0]!.servedAt).not.toBeNull();
    expect(lines[1]).toMatchObject({ lineNo: 2, quantity: "2.000", servedAt: null });
  });

  it("a malformed :id on the lines read route → 409 tab.not_open (not a 500)", async () => {
    const res = await request("/api/working-orders/not-a-uuid/lines");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });

  it("a malformed :id on the round route → 409 tab.not_open (not a 500)", async () => {
    const res = await request("/api/working-orders/not-a-uuid/round", {
      method: "POST",
      body: JSON.stringify({ lines: [] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });

  it("a malformed :id on the void route → 409 tab.not_open (not a 500)", async () => {
    const res = await request("/api/working-orders/not-a-uuid/lines/1", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });

  it("a non-integer :lineNo on the void route → 404 tab.line_not_found (it names no line, not a 500)", async () => {
    // A valid-uuid `:id` passes the `isUuid` screen so the `Number.isInteger` guard is what fires:
    // `Number("abc")` is `NaN`, refused as `tab.line_not_found` BEFORE any DB read (a raw `abc` would
    // never reach the integer `line_no` column anyway).
    const res = await request(`/api/working-orders/${randomUUID()}/lines/abc`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
  });

  it("an OUT-OF-int4-RANGE :lineNo on the void route → 404 tab.line_not_found (not an opaque 22003 500)", async () => {
    // Open a REAL tab so `voidTabLine`'s `lockOpenTab` passes and the delete query is actually reached
    // — a random uuid would be shielded by `lockOpenTab` (tab.not_open, 409) before the query. With a
    // real open tab: `9999999999` IS a `Number.isInteger`, so the bare integer check let it through; it
    // would then bind as `$n` into `where line_no = $n` on the int4 `line_no` column and PostgreSQL
    // would raise `22003 (out of range for integer)`, a non-AppError the boundary turns into an opaque
    // 500. The route's range bound refuses it as `tab.line_not_found` (a line number that cannot exist
    // names no line) BEFORE any query. Dropping the `> 2_147_483_647` bound makes this a 500 — the
    // prove-by-deletion this fix is for.
    const { id } = (await (
      await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "88" }) })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ productId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };

    const res = await request(`/api/working-orders/${tabId}/lines/9999999999`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
  });

  it("REJECTS every new table/tab route with 401 session.required when no cookie is present", async () => {
    // A fresh app driven WITHOUT the session cookie: `requireSession` runs first on each route (before
    // any isUuid screen, body read or DB touch), so an unauthenticated create/list/state/edit/
    // deactivate/open-tab/round/void all 401 with the one code. Deleting the `requireSession` call
    // from any route flips that route's case to a 200/404/409 — the deletion proof of the guard.
    const noAuth = new Hono();
    mountTillApi(noAuth, deps(suite.db), collect([]));
    const id = randomUUID();
    const json = { "content-type": "application/json" };
    const cases = [
      noAuth.request("/api/tables", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ label: "z" }),
      }),
      noAuth.request("/api/tables"),
      noAuth.request("/api/tables/state"),
      noAuth.request(`/api/tables/${id}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ label: "z" }),
      }),
      noAuth.request(`/api/tables/${id}`, { method: "DELETE" }),
      noAuth.request(`/api/tables/${id}/tab`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({}),
      }),
      noAuth.request(`/api/working-orders/${id}/round`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ lines: [] }),
      }),
      noAuth.request(`/api/working-orders/${id}/lines`),
      noAuth.request(`/api/working-orders/${id}/lines/1`, { method: "DELETE" }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });
});
