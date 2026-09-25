import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { floorZones, locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
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
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The HTTP wiring of the table/tab routes: session guard, isUuid screens and STATUS mapping. The verbs
// are pinned in `tabs.filing.test.ts`, `move-merge.filing.test.ts` and packages/db's schema suites.
// The schema is the whole manifest: the tables here span modules that FK into core.
let cfg: TillConfig;
let ana: { id: string };
// The one product seeded into the counter location's catalogue, so a tab can open with a real line
// (`openTab`/`addTabRound` price it and the `check_locales` trigger demands its `es-ES` description
// key match the location's `es-ES` locale).
let productId: string;
// The product's offer, and the table_tab zone offering it: a tab's table sits in that zone, and its
// lines name the offer.
let menuItemId: string;
let tablesZoneId: string;
// A real `floor_zones` row in the counter location: a table's `zoneId` is a FK to `floor_zones`.
let seededZoneId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // invoice_locales is `es-ES` (full-tag, fiscal). The product is authored under the BARE `es` key;
    // `priceOrderLines` re-keys its descriptions to the location's `es-ES` before the tab
    // line-insert fires `check_locales`, which demands a line's `descriptions` keys equal the
    // location's locales exactly.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    await seedKitchenStation(db, { locationId: brandLocationId(loc!.id) });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Till 1" })
      .returning({ id: tills.id });
    // `openTab`/`addTabRound` create a working_orders row whose `node_id` FK requires a real row.
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    // Through the catalogue verbs, so the active/assignment filters are real.
    const product = await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Agua mineral",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, loc!.id, cat.id);
      return p;
    });
    productId = product.id;
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId: loc!.id, name: "Terraza" })
      .returning({ id: floorZones.id });
    seededZoneId = zone!.id;
    cfg = makeCfg(till!.id, loc!.id, nodeId);
    const offers = await withTransaction(db, (tx) => offerProducts(tx, cfg, { zone: "tables" }));
    menuItemId = offers.offerFor(productId);
    tablesZoneId = offers.zoneId;
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused by these routes (no fiscal write on the tab/table path), so it carries a fresh uuid. */
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

// One app + one logged-in session shared across the table/tab tests. The suite's venue file persists,
// so tables accumulate across tests — which is why every list assertion below is a membership check
// (`.toContainEqual` / `.find`), never an exact-list assertion that would depend on execution order.
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
    expect(list).toContainEqual(
      expect.objectContaining({ id, label: "12", zoneId: seededZoneId, active: true }),
    );
  });

  it("POST /api/tables with an unknown zoneId → 404 zone.not_found", async () => {
    const res = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ label: "orphan-zone", zoneId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST /api/tables with a MALFORMED zoneId → 404 zone.not_found (isUuid guard, not an opaque 22P02 500)", async () => {
    // A non-UUID `zoneId` is screened to the SAME `zone.not_found` a well-formed-but-missing zoneId
    // gets, so a bad zone reads the same whether it is malformed or merely absent.
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
    // `9999999999` is a valid JS number, so a bare type check would let it through; the route's
    // `requireCapacity` range guard refuses it as a domain 400.
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
    // The twin of the malformed-zoneId screen above, one field over. A real table id is used so the
    // id screen passes and the zoneId screen is what fires.
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
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "3", zoneId: tablesZoneId }),
      })
    ).json()) as { id: string };
    const open = await request(`/api/tables/${id}/tab`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ menuItemId, quantity: "1" }] }),
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
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "5", zoneId: tablesZoneId }),
      })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ menuItemId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };

    const round = await request(`/api/working-orders/${tabId}/round`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ menuItemId, quantity: "1" }] }),
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
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "9", zoneId: tablesZoneId }),
      })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ menuItemId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };
    // A second round so there are two lines, then serve line 1 (the two floor states the screen renders).
    await request(`/api/working-orders/${tabId}/round`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ menuItemId, quantity: "2" }] }),
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
    // Seeded product is 1.50; the locked gross unit rides back verbatim, and the quantity at the
    // three places `thousandthsToDecimal` renders.
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
    // `Number("abc")` is `NaN`, refused as `tab.line_not_found`.
    const res = await request(`/api/working-orders/${randomUUID()}/lines/abc`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
  });

  it("an OUT-OF-int4-RANGE :lineNo on the void route → 404 tab.line_not_found (not an opaque 22003 500)", async () => {
    // Open a REAL tab so `voidTabLine`'s `assertAnchoredTabOpen` passes — a random uuid would be
    // refused as tab.not_open first. `9999999999` IS a `Number.isInteger`; the route's range bound
    // refuses it as `tab.line_not_found` (a line number that cannot exist names no line).
    const { id } = (await (
      await request("/api/tables", {
        method: "POST",
        body: JSON.stringify({ label: "88", zoneId: tablesZoneId }),
      })
    ).json()) as { id: string };
    const { tabId } = (await (
      await request(`/api/tables/${id}/tab`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ menuItemId, quantity: "1" }] }),
      })
    ).json()) as { tabId: string };

    const res = await request(`/api/working-orders/${tabId}/lines/9999999999`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
  });

  it("REJECTS every new table/tab route with 401 session.required when no cookie is present", async () => {
    // A fresh app driven WITHOUT the session cookie: every route below answers 401 with the one code.
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
