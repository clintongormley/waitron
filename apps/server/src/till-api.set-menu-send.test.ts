import { Hono } from "hono";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/menu";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listZoneOffers } from "@waitron/venue-service";
import { mountMenuApi } from "./menu-api.js";
import { createTable } from "./testing/live-table.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";

let venue: BillVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    daily = await inTx(venue, async (tx) => {
      const offer = await listZoneOffers(tx, venue.zoneId);
      const { id } = await createProduct(tx, {
        name: "Soup",
        categoryId: null,
        pricingUnit: "each",
        vatClass: "general",
        unitPrice: "5.00",
      });
      return setMenuOnFullMenu(tx, offer.menus.find(({ isDefault }) => isDefault)!.id, id);
    });
  },
});

async function request(method: string, path: string, body: unknown) {
  return send(
    venue.app,
    venue.cookie,
    method,
    path,
    await observedDraftCommandBody(venue.db, method, path, body),
  );
}

async function draft(seeded: boolean, dishes = 1) {
  const table = await inTx(venue, (tx) =>
    createTable(tx, { zoneId: venue.zoneId, label: crypto.randomUUID() }),
  );
  const seated = await request("POST", `/api/tables/${table.id}/seat`, {});
  expect(seated.status).toBe(200);
  const { partyId, tabId, revision } = seated.json as {
    partyId: string;
    tabId: string;
    revision: number;
  };
  if (seeded) await inTx(venue, (tx) => seedBillSetMenu(tx, tabId, daily, 1));
  const saved = await request("PUT", `/api/parties/${partyId}/drafts`, {
    billId: tabId,
    draftId: null,
    revision: 0,
    lines: Array.from({ length: dishes }, () => ({
      setMenuId: daily.menuId,
      menuVersionId: daily.versionId,
      menuItemId: daily.menuItemId,
      quantity: "1",
    })),
  });
  expect(saved.status).toBe(200);
  const value = saved.json.draft as { id: string; revision: number; lines: { id: string }[] };
  return {
    path: `/api/parties/${partyId}/drafts/${value.id}/submit`,
    body: {
      dining: "eat_in",
      submissionId: crypto.randomUUID(),
      draftRevision: value.revision,
      expectedPartyRevision: revision,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [{ lineIds: value.lines.map(({ id }) => id), release: "fire" }],
    },
  };
}

it("accepts a saved set-menu dish and reports a placed group", async () => {
  const { path, body } = await draft(true);
  const result = await request("POST", path, body);
  expect(result.status).toBe(200);
  expect(result.json).toMatchObject({ draft: null, groups: [{ lineIds: [expect.any(String)] }] });
});

it("refuses to send a set-menu-only dish after the dashboard marks it sold out", async () => {
  const { path, body } = await draft(true);
  const manager = await inTx(venue, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: "Menu Manager", role: "manager" });
    return startManagementSession(tx, { personId: person!.id, method: "password" });
  });
  const dashboard = new Hono();
  mountMenuApi(dashboard, { db: venue.db }, () => {});
  const changeAvailability = (available: boolean) =>
    dashboard.request("/management-api/products/availability", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${MANAGEMENT_COOKIE}=${manager.token}`,
      },
      body: JSON.stringify({ productIds: [daily.productId], available }),
    });
  expect((await changeAvailability(false)).status).toBe(204);
  try {
    const result = await request("POST", path, body);
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({
      code: "product.unavailable",
      params: { productId: daily.productId },
    });
  } finally {
    expect((await changeAvailability(true)).status).toBe(204);
  }
});
