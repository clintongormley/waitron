import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  locations,
  tills,
  visits,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeClearingWorkflow } from "@waitron/venue-service";
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
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { createOpenOrder, openTab } from "./working-order.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The HTTP surface of seating and finishing a table: the session guard, the body and id screens and
// the status each refusal answers. The verbs themselves are pinned in `visits.test.ts`.
let cfg: TillConfig;
let ana: { id: string };

// `resetPerTest: false`: the venue, till, node and person are seeded once; each case seats its own
// table.
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({ name: "Sala", invoiceLocales: ["es-ES"], operationDescription: "Restaurante" })
      .returning({ id: locations.id });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Caja 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = {
      tillId: brandTillId(till!.id),
      nodeId: brandNodeId(nodeId),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(loc!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      orderFlow: "prepay",
    };
  },
});

const clock: TrustedClock = {
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
    throw new Error("till-api.visits.test: anchor() is not used by these routes");
  },
  currentAnchor: () => null,
};

function app(db: Database): Hono {
  const deps: TillApiDeps = {
    db,
    // Unused: seating and finishing file nothing.
    backend: {} as FiscalBackend,
    clock,
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
  const hono = new Hono();
  mountTillApi(hono, deps, () => {});
  return hono;
}

async function cookie(): Promise<string> {
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: ana.id, pin: "5555" }),
  );
  return `${SESSION_COOKIE}=${session.token}`;
}

async function table(): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { id } = await createTable(tx, cfg, { label: `Mesa ${randomUUID()}` });
    return id;
  });
}

async function post(path: string, body: unknown, withSession = true): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withSession) headers.cookie = await cookie();
  return app(suite.db).request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function seat(guestCount: number | null = 2) {
  const tableId = await table();
  const res = await post(`/api/tables/${tableId}/seat`, { guestCount });
  expect(res.status).toBe(200);
  return {
    tableId,
    ...((await res.json()) as { visitId: string; tabId: string; revision: number }),
  };
}

async function visitRow(id: string) {
  const [row] = await withTransaction(suite.db, (tx) =>
    tx.select().from(visits).where(eq(visits.id, id)),
  );
  return row!;
}

describe("POST /api/tables/:id/seat", () => {
  it("401s without a session", async () => {
    const res = await post(`/api/tables/${await table()}/seat`, { guestCount: 2 }, false);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("seats a free table for the signed-in operator", async () => {
    const seated = await seat(3);
    expect(seated.revision).toBe(0);
    expect(await visitRow(seated.visitId)).toMatchObject({ guestCount: 3, openedBy: ana.id });
    const [tab] = await withTransaction(suite.db, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, seated.tabId)),
    );
    expect(tab!.visitId).toBe(seated.visitId);
  });

  it("seats without a guest count, absent or null", async () => {
    expect((await visitRow((await seat(null)).visitId)).guestCount).toBeNull();
    const res = await post(`/api/tables/${await table()}/seat`, {});
    expect(res.status).toBe(200);
    const { visitId } = (await res.json()) as { visitId: string };
    expect((await visitRow(visitId)).guestCount).toBeNull();
  });

  it.each([0, -1, 1.5, "3", true, 100_000])(
    "refuses the guest count %j as a bad field",
    async (guestCount) => {
      const res = await post(`/api/tables/${await table()}/seat`, { guestCount });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "guestCount" } },
      });
    },
  );

  it("takes the guest count alone: lines sent with the seat are not rung", async () => {
    await seedLegacySellingUnits(suite.db);
    const { menuItemId, tableId } = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const drinks = await createCategory(tx, { name: { en: "Bebidas" } });
      const coffee = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: drinks.id,
        name: "Café",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, cfg.locationId, catalogue.id);
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const { id } = await createTable(tx, cfg, {
        label: `Mesa ${randomUUID()}`,
        zoneId: offers.zoneId,
      });
      return { menuItemId: offers.offerFor(coffee.id), tableId: id };
    });

    const res = await post(`/api/tables/${tableId}/seat`, {
      guestCount: 2,
      lines: [{ menuItemId, quantity: "1" }],
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const { tabId } = (await res.json()) as { tabId: string };
    const lines = await withTransaction(suite.db, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    );
    expect(lines).toEqual([]);
  });

  it("refuses a malformed table id as a missing table", async () => {
    const res = await post(`/api/tables/not-a-uuid/seat`, { guestCount: 2 });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("refuses an occupied table with 409 tab.already_open", async () => {
    const { tableId } = await seat();
    const res = await post(`/api/tables/${tableId}/seat`, { guestCount: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.already_open", params: { tableId } },
    });
  });
});

describe("POST /api/visits/:id/finish", () => {
  it("closes the visit for the signed-in operator", async () => {
    const { visitId } = await seat();
    const res = await post(`/api/visits/${visitId}/finish`, { expectedVisitRevision: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "closed" });
    expect(await visitRow(visitId)).toMatchObject({ state: "closed", closedBy: ana.id });
  });

  it("answers 409 visit.bill_outstanding while a bill is unpaid", async () => {
    const { visitId, tabId } = await seat();
    await withTransaction(suite.db, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, tabId)),
    );
    const res = await post(`/api/visits/${visitId}/finish`, { expectedVisitRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "visit.bill_outstanding", params: { visitId } },
    });
  });

  it("answers 409 visit.out_of_date for a stale revision", async () => {
    const { visitId } = await seat();
    const res = await post(`/api/visits/${visitId}/finish`, { expectedVisitRevision: 4 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "visit.out_of_date", params: { visitId, revision: 0 } },
    });
  });

  it.each([undefined, -1, 1.5, "0", null])(
    "refuses the revision %j as a bad field",
    async (expectedVisitRevision) => {
      const { visitId } = await seat();
      const res = await post(`/api/visits/${visitId}/finish`, { expectedVisitRevision });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "expectedVisitRevision" } },
      });
    },
  );

  it("answers 409 visit.not_open for a malformed or unknown visit", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      const res = await post(`/api/visits/${id}/finish`, { expectedVisitRevision: 0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "visit.not_open", params: { visitId: id } },
      });
    }
  });

  it("401s without a session", async () => {
    const res = await post(
      `/api/visits/${randomUUID()}/finish`,
      { expectedVisitRevision: 0 },
      false,
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/visits/:id/cleared", () => {
  it("clears a table that needs clearing", async () => {
    await withTransaction(suite.db, (tx) => writeClearingWorkflow(tx, true));
    const { visitId } = await seat();
    const finished = await post(`/api/visits/${visitId}/finish`, { expectedVisitRevision: 0 });
    expect(await finished.json()).toEqual({ state: "needs_clearing" });

    const res = await post(`/api/visits/${visitId}/cleared`, { expectedVisitRevision: 1 });

    expect(res.status).toBe(204);
    expect((await visitRow(visitId)).state).toBe("closed");
    await withTransaction(suite.db, (tx) => writeClearingWorkflow(tx, false));
  });

  it("answers 409 visit.not_open for a visit that does not need clearing", async () => {
    const { visitId } = await seat();
    const res = await post(`/api/visits/${visitId}/cleared`, { expectedVisitRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "visit.not_open" } });
  });

  it("refuses a bad revision as a bad field, and a malformed id as not open", async () => {
    const { visitId } = await seat();
    const bad = await post(`/api/visits/${visitId}/cleared`, { expectedVisitRevision: "1" });
    expect(bad.status).toBe(400);
    const malformed = await post(`/api/visits/nope/cleared`, { expectedVisitRevision: 0 });
    expect(malformed.status).toBe(409);
    expect(await malformed.json()).toMatchObject({ error: { code: "visit.not_open" } });
  });
});

describe("GET /api/visits/:id/bills", () => {
  it("lists the visit's bills", async () => {
    const { visitId, tabId } = await seat();
    const res = await app(suite.db).request(`/api/visits/${visitId}/bills`, {
      headers: { cookie: await cookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        workingOrderId: tabId,
        visitId,
        label: null,
        status: "open",
        total: "0.00",
        outstanding: "0.00",
        receiptAvailable: false,
      },
    ]);
  });

  it("answers 409 visit.not_open for a malformed or unknown visit, and 401 without a session", async () => {
    for (const id of ["nope", randomUUID()]) {
      const res = await app(suite.db).request(`/api/visits/${id}/bills`, {
        headers: { cookie: await cookie() },
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "visit.not_open", params: { visitId: id } },
      });
    }
    const res = await app(suite.db).request(`/api/visits/${randomUUID()}/bills`);
    expect(res.status).toBe(401);
  });
});

describe("the tab routes carry the party's revision", () => {
  async function current(visitId: string): Promise<number> {
    return (await visitRow(visitId)).revision;
  }

  /** Each route, sent to party `a`'s tab (party `b` is the other end of a merge or transfer). */
  const ROUTES: {
    name: string;
    path: (a: Seated) => string;
    body: (a: Seated, b: Seated, free: string, revisions: Record<string, unknown>) => unknown;
  }[] = [
    {
      name: "move",
      path: (a) => `/api/tabs/${a.tabId}/move`,
      body: (_a, _b, free, r) => ({ toTableId: free, ...r }),
    },
    {
      name: "join",
      path: (a) => `/api/tabs/${a.tabId}/join`,
      body: (_a, _b, free, r) => ({ tableId: free, ...r }),
    },
    {
      name: "merge",
      path: (a) => `/api/tabs/${a.tabId}/merge`,
      body: (_a, b, _free, r) => ({ fromTabId: b.tabId, freeSourceTable: true, ...r }),
    },
    {
      name: "transfer",
      path: (a) => `/api/tabs/${a.tabId}/transfer`,
      body: (_a, b, _free, r) => ({ toTabId: b.tabId, transfers: [{ lineNo: 1 }], ...r }),
    },
    {
      name: "split",
      path: (a) => `/api/tabs/${a.tabId}/split`,
      body: (_a, _b, _free, r) => ({ transfers: [{ lineNo: 1 }], ...r }),
    },
    {
      name: "unjoin",
      path: (a) => `/api/tabs/${a.tabId}/unjoin`,
      body: (a, _b, _free, r) => ({ tableId: a.tableId, ...r }),
    },
  ];

  type Seated = Awaited<ReturnType<typeof seat>>;

  it.each(ROUTES)("$name answers 409 visit.out_of_date for a stale revision", async (route) => {
    const a = await seat();
    const b = await seat();
    const res = await post(
      route.path(a),
      route.body(a, b, await table(), {
        expectedVisitRevision: 7,
        expectedSourceVisitRevision: 7,
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "visit.out_of_date" } });
  });

  it.each(ROUTES)("$name refuses a malformed revision as a bad field", async (route) => {
    const a = await seat();
    const b = await seat();
    const crossesVisits = route.name === "merge" || route.name === "transfer";
    const fields = crossesVisits
      ? ["expectedVisitRevision", "expectedSourceVisitRevision"]
      : ["expectedVisitRevision"];
    for (const field of fields) {
      const res = await post(route.path(a), route.body(a, b, await table(), { [field]: "0" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });

  it("move takes the party's revision and records nothing without it", async () => {
    const a = await seat();
    const to = await table();
    const missing = await post(`/api/tabs/${a.tabId}/move`, { toTableId: to });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "expectedVisitRevision" } },
    });

    const moved = await post(`/api/tabs/${a.tabId}/move`, {
      toTableId: to,
      expectedVisitRevision: 0,
    });
    expect(moved.status).toBe(200);
    expect(await current(a.visitId)).toBe(1);
  });

  it("merge closes the absorbed party for the signed-in operator, and needs both revisions", async () => {
    const a = await seat();
    const b = await seat();
    const missing = await post(`/api/tabs/${a.tabId}/merge`, {
      fromTabId: b.tabId,
      freeSourceTable: true,
      expectedVisitRevision: 0,
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: {
        code: "management.request_invalid",
        params: { field: "expectedSourceVisitRevision" },
      },
    });

    const merged = await post(`/api/tabs/${a.tabId}/merge`, {
      fromTabId: b.tabId,
      freeSourceTable: true,
      expectedVisitRevision: 0,
      expectedSourceVisitRevision: 0,
    });
    expect(merged.status).toBe(200);
    expect(await visitRow(b.visitId)).toMatchObject({
      state: "closed",
      mergedIntoVisitId: a.visitId,
      closedBy: ana.id,
    });
  });

  it("join then unjoin: the unjoined table leaves the party", async () => {
    const a = await seat();
    const other = await table();
    const joined = await post(`/api/tabs/${a.tabId}/join`, {
      tableId: other,
      expectedVisitRevision: 0,
    });
    expect(joined.status).toBe(200);
    const unjoined = await post(`/api/tabs/${a.tabId}/unjoin`, {
      tableId: other,
      expectedVisitRevision: 1,
    });
    expect(unjoined.status).toBe(200);
    expect(await unjoined.json()).toEqual({});
    expect(await current(a.visitId)).toBe(2);
  });
});

describe("join and merge refuse bills that would leave a table, a bill and a party disagreeing", () => {
  it("409 tab.not_table_tab joining a table to a counter order", async () => {
    const counterOrderId = randomUUID();
    await withTransaction(suite.db, (tx) => createOpenOrder(tx, cfg, counterOrderId, [], null));
    const free = await table();

    const res = await post(`/api/tabs/${counterOrderId}/join`, { tableId: free });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_table_tab", params: { tabId: counterOrderId } },
    });
  });

  it("409 tab.visit_mismatch merging a party's tab into a table's bill of no party", async () => {
    const a = await seat();
    const tableId = await table();
    const noPartyTabId = await withTransaction(
      suite.db,
      async (tx) => (await openTab(tx, cfg, { tableId })).tabId,
    );

    const res = await post(`/api/tabs/${noPartyTabId}/merge`, {
      fromTabId: a.tabId,
      freeSourceTable: true,
      expectedSourceVisitRevision: 0,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.visit_mismatch", params: { tabId: noPartyTabId } },
    });
  });

  it("409 tab.visit_has_other_open_bill merging another party's separate bill while its tab is open", async () => {
    const a = await seat();
    const b = await seat();
    const checkId = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(tx, cfg, checkId, [], null, { visitId: b.visitId }),
    );

    const res = await post(`/api/tabs/${a.tabId}/merge`, {
      fromTabId: checkId,
      freeSourceTable: false,
      expectedVisitRevision: 0,
      expectedSourceVisitRevision: 0,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.visit_has_other_open_bill", params: { tabId: checkId } },
    });
  });
});
