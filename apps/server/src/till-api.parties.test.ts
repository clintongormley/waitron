import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  diningTables,
  locations,
  tills,
  parties,
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
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The HTTP surface of seating and finishing a table: the session guard, the body and id screens and
// the status each refusal answers. The verbs themselves are pinned in `parties.test.ts`.
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
    throw new Error("till-api.parties.test: anchor() is not used by these routes");
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

async function send(
  method: string,
  path: string,
  body: unknown,
  withSession: boolean,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withSession) headers.cookie = await cookie();
  return app(suite.db).request(path, { method, headers, body: JSON.stringify(body) });
}

async function post(path: string, body: unknown, withSession = true): Promise<Response> {
  return send("POST", path, body, withSession);
}

async function put(path: string, body: unknown, withSession = true): Promise<Response> {
  return send("PUT", path, body, withSession);
}

async function seat(guestCount: number | null = 2) {
  const tableId = await table();
  const res = await post(`/api/tables/${tableId}/seat`, { guestCount });
  expect(res.status).toBe(200);
  return {
    tableId,
    ...((await res.json()) as { partyId: string; tabId: string; revision: number }),
  };
}

async function partyRow(id: string) {
  const [row] = await withTransaction(suite.db, (tx) =>
    tx.select().from(parties).where(eq(parties.id, id)),
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
    expect(await partyRow(seated.partyId)).toMatchObject({ guestCount: 3, openedBy: ana.id });
    const [tab] = await withTransaction(suite.db, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, seated.tabId)),
    );
    expect(tab!.partyId).toBe(seated.partyId);
  });

  it("seats without a guest count, absent or null", async () => {
    expect((await partyRow((await seat(null)).partyId)).guestCount).toBeNull();
    const res = await post(`/api/tables/${await table()}/seat`, {});
    expect(res.status).toBe(200);
    const { partyId } = (await res.json()) as { partyId: string };
    expect((await partyRow(partyId)).guestCount).toBeNull();
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

describe("POST /api/parties/:id/finish", () => {
  it("closes the party for the signed-in operator", async () => {
    const { partyId } = await seat();
    const res = await post(`/api/parties/${partyId}/finish`, { expectedPartyRevision: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "closed" });
    expect(await partyRow(partyId)).toMatchObject({ state: "closed", closedBy: ana.id });
  });

  it("answers 409 party.bill_outstanding while a bill is unpaid", async () => {
    const { partyId, tabId } = await seat();
    await withTransaction(suite.db, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, tabId)),
    );
    const res = await post(`/api/parties/${partyId}/finish`, { expectedPartyRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "party.bill_outstanding", params: { partyId } },
    });
  });

  it("answers 409 party.out_of_date for a stale revision", async () => {
    const { partyId } = await seat();
    const res = await post(`/api/parties/${partyId}/finish`, { expectedPartyRevision: 4 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "party.out_of_date", params: { partyId, revision: 0 } },
    });
  });

  it.each([undefined, -1, 1.5, "0", null])(
    "refuses the revision %j as a bad field",
    async (expectedPartyRevision) => {
      const { partyId } = await seat();
      const res = await post(`/api/parties/${partyId}/finish`, { expectedPartyRevision });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "expectedPartyRevision" } },
      });
    },
  );

  it("answers 409 party.not_open for a malformed or unknown party", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      const res = await post(`/api/parties/${id}/finish`, { expectedPartyRevision: 0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "party.not_open", params: { partyId: id } },
      });
    }
  });

  it("401s without a session", async () => {
    const res = await post(
      `/api/parties/${randomUUID()}/finish`,
      { expectedPartyRevision: 0 },
      false,
    );
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/parties/:id/name", () => {
  it("names the party, trimmed, and answers its revision and name", async () => {
    const { partyId, revision } = await seat();
    const res = await put(`/api/parties/${partyId}/name`, {
      name: "  Ana ",
      expectedPartyRevision: revision,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: revision + 1, name: "Ana" });
    expect(await partyRow(partyId)).toMatchObject({ name: "Ana", revision: revision + 1 });
  });

  it("refuses a 41-character name as a bad field, changing nothing", async () => {
    const { partyId, revision } = await seat();
    const res = await put(`/api/parties/${partyId}/name`, {
      name: "x".repeat(41),
      expectedPartyRevision: revision,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
    expect(await partyRow(partyId)).toMatchObject({ name: null, revision });
  });

  it.each([undefined, 7])("refuses the name %j as a bad field, changing nothing", async (name) => {
    const { partyId, revision } = await seat();
    const res = await put(`/api/parties/${partyId}/name`, {
      name,
      expectedPartyRevision: revision,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
    expect(await partyRow(partyId)).toMatchObject({ name: null, revision });
  });

  it("answers 409 party.out_of_date for a stale revision, changing nothing", async () => {
    const { partyId, revision } = await seat();
    const res = await put(`/api/parties/${partyId}/name`, {
      name: "Ana",
      expectedPartyRevision: revision + 4,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "party.out_of_date", params: { partyId, revision } },
    });
    expect(await partyRow(partyId)).toMatchObject({ name: null, revision });
  });

  it.each([undefined, -1, 1.5, "0", null])(
    "refuses the revision %j as a bad field, changing nothing",
    async (expectedPartyRevision) => {
      const { partyId, revision } = await seat();
      const res = await put(`/api/parties/${partyId}/name`, { name: "Ana", expectedPartyRevision });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "expectedPartyRevision" } },
      });
      expect(await partyRow(partyId)).toMatchObject({ name: null, revision });
    },
  );

  it("answers 409 party.not_open for a malformed or unknown party", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      const res = await put(`/api/parties/${id}/name`, { name: "Ana", expectedPartyRevision: 0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "party.not_open", params: { partyId: id } },
      });
    }
  });

  it("401s without a session", async () => {
    const { partyId, revision } = await seat();
    const res = await put(
      `/api/parties/${partyId}/name`,
      { name: "Ana", expectedPartyRevision: revision },
      false,
    );
    expect(res.status).toBe(401);
    expect(await partyRow(partyId)).toMatchObject({ name: null, revision });
  });
});

describe("POST /api/parties/:id/groups naming a bill", () => {
  it("answers 409 bill.other_party for another party's bill, writing nothing", async () => {
    const { partyId, revision } = await seat();
    const other = await seat();
    const res = await post(`/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      billId: other.tabId,
      groups: [{ lines: [{ menuItemId: randomUUID(), quantity: "1" }], release: "fire" }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "bill.other_party", params: { workingOrderId: other.tabId } },
    });
    expect(await partyRow(partyId)).toMatchObject({ revision });
    const lines = await withTransaction(suite.db, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, other.tabId)),
    );
    expect(lines).toEqual([]);
  });
});

describe("a table that needs clearing", () => {
  async function tableRow(id: string) {
    const [row] = await withTransaction(suite.db, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, id)),
    );
    return row!;
  }
  async function condition(id: string): Promise<string> {
    const res = await app(suite.db).request("/api/tables/state", {
      headers: { cookie: await cookie() },
    });
    expect(res.status).toBe(200);
    const floor = (await res.json()) as { id: string; condition: string }[];
    return floor.find((row) => row.id === id)!.condition;
  }
  /** A table whose party has finished with the venue's clearing setting on. */
  async function finishedWithClearing(): Promise<{ tableId: string; partyId: string }> {
    await withTransaction(suite.db, (tx) => writeClearingWorkflow(tx, true));
    try {
      const { tableId, partyId } = await seat();
      const finished = await post(`/api/parties/${partyId}/finish`, { expectedPartyRevision: 0 });
      expect(await finished.json()).toEqual({ state: "closed" });
      return { tableId, partyId };
    } finally {
      await withTransaction(suite.db, (tx) => writeClearingWorkflow(tx, false));
    }
  }

  it("POST /api/tables/:id/cleared frees it with a 204, and the floor reads it free", async () => {
    const { tableId } = await finishedWithClearing();
    expect(await condition(tableId)).toBe("needs_clearing");

    const res = await post(`/api/tables/${tableId}/cleared`, {});

    expect(res.status).toBe(204);
    expect((await tableRow(tableId)).needsClearingSince).toBeNull();
    expect(await condition(tableId)).toBe("free");
  });

  it("POST /api/tables/:id/cleared answers 204 for a table that does not need clearing, changing nothing", async () => {
    const { tableId, partyId, revision } = await seat();

    const res = await post(`/api/tables/${tableId}/cleared`, {});

    expect(res.status).toBe(204);
    expect(await condition(tableId)).toBe("held");
    expect(await partyRow(partyId)).toMatchObject({ state: "open", revision });
  });

  it("POST /api/tables/:id/cleared answers 404 table.not_found for an unknown or malformed id", async () => {
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const res = await post(`/api/tables/${id}/cleared`, {});
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "table.not_found", params: { tableId: id } },
      });
    }
  });

  it("POST /api/tables/:id/cleared 401s without a session, leaving the table needing clearing", async () => {
    const { tableId } = await finishedWithClearing();

    const res = await post(`/api/tables/${tableId}/cleared`, {}, false);

    expect(res.status).toBe(401);
    expect((await tableRow(tableId)).needsClearingSince).not.toBeNull();
  });

  it("refuses seating it with 409 table.needs_clearing, opening no party", async () => {
    const { tableId } = await finishedWithClearing();
    const partiesBefore = await withTransaction(suite.db, (tx) => tx.select().from(parties));

    const res = await post(`/api/tables/${tableId}/seat`, { guestCount: 2 });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.needs_clearing", params: { tableId } },
    });
    expect(await withTransaction(suite.db, (tx) => tx.select().from(parties))).toHaveLength(
      partiesBefore.length,
    );
    expect(await condition(tableId)).toBe("needs_clearing");
  });

  it("no longer answers the party route that cleared a whole party", async () => {
    const { tableId, partyId } = await finishedWithClearing();

    const res = await post(`/api/parties/${partyId}/cleared`, { expectedPartyRevision: 1 });

    expect(res.status).toBe(404);
    expect(await condition(tableId)).toBe("needs_clearing");
  });
});

describe("GET /api/parties/:id/bills", () => {
  it("lists the party's bills", async () => {
    const { partyId, tabId } = await seat();
    const res = await app(suite.db).request(`/api/parties/${partyId}/bills`, {
      headers: { cookie: await cookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        workingOrderId: tabId,
        partyId,
        label: null,
        status: "open",
        total: "0.00",
        outstanding: "0.00",
        hasPayments: false,
        receiptAvailable: false,
      },
    ]);
  });

  it("answers 409 party.not_open for a malformed or unknown party, and 401 without a session", async () => {
    for (const id of ["nope", randomUUID()]) {
      const res = await app(suite.db).request(`/api/parties/${id}/bills`, {
        headers: { cookie: await cookie() },
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "party.not_open", params: { partyId: id } },
      });
    }
    const res = await app(suite.db).request(`/api/parties/${randomUUID()}/bills`);
    expect(res.status).toBe(401);
  });
});

describe("the tab routes are gone", () => {
  /** Each old tab route, sent to party `a`'s bill with a body it once took. */
  const ROUTES: {
    name: string;
    path: (a: Seated) => string;
    body: (a: Seated, b: Seated, free: string) => unknown;
  }[] = [
    {
      name: "move",
      path: (a) => `/api/tabs/${a.tabId}/move`,
      body: (_a, _b, free) => ({ toTableId: free, expectedPartyRevision: 0 }),
    },
    {
      name: "join",
      path: (a) => `/api/tabs/${a.tabId}/join`,
      body: (_a, _b, free) => ({ tableId: free, expectedPartyRevision: 0 }),
    },
    {
      name: "merge",
      path: (a) => `/api/tabs/${a.tabId}/merge`,
      body: (_a, b) => ({ fromTabId: b.tabId, expectedPartyRevision: 0 }),
    },
    {
      name: "transfer",
      path: (a) => `/api/tabs/${a.tabId}/transfer`,
      body: (_a, b) => ({ toTabId: b.tabId, transfers: [{ lineNo: 1 }], expectedPartyRevision: 0 }),
    },
    {
      name: "split",
      path: (a) => `/api/tabs/${a.tabId}/split`,
      body: () => ({ transfers: [{ lineNo: 1 }], expectedPartyRevision: 0 }),
    },
    {
      name: "unjoin",
      path: (a) => `/api/tabs/${a.tabId}/unjoin`,
      body: (a) => ({ tableId: a.tableId, expectedPartyRevision: 0 }),
    },
  ];

  type Seated = Awaited<ReturnType<typeof seat>>;

  // An unrouted path's plain 404, not a domain refusal that also answers 404.
  it.each(ROUTES)("$name answers 404 as an unknown path, changing neither party", async (route) => {
    const a = await seat();
    const b = await seat();

    const res = await post(route.path(a), route.body(a, b, await table()));

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("404 Not Found");
    expect(await partyRow(a.partyId)).toMatchObject({ state: "open", revision: 0 });
    expect(await partyRow(b.partyId)).toMatchObject({ state: "open", revision: 0 });
  });
});
