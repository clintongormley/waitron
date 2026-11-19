import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listZoneOffers } from "@waitron/venue-service";
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

async function draft(seeded: boolean) {
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { zoneId: venue.zoneId, label: crypto.randomUUID() }),
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
    lines: [
      {
        setMenuId: daily.menuId,
        menuVersionId: daily.versionId,
        menuItemId: daily.menuItemId,
        quantity: "1",
      },
    ],
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
      groups: [{ lineIds: [value.lines[0]!.id], release: "fire" }],
    },
  };
}

it("accepts a saved set-menu dish and reports a placed group", async () => {
  const { path, body } = await draft(true);
  const result = await request("POST", path, body);
  expect(result.status).toBe(200);
  expect(result.json).toMatchObject({ draft: null, groups: [{ lineIds: [expect.any(String)] }] });
});

it("answers 409 when a set-menu dish has no place", async () => {
  const { path, body } = await draft(false);
  const result = await request("POST", path, body);
  expect(result.status).toBe(409);
  expect(result.json).toMatchObject({
    code: "set_menu.no_place",
    params: { dishName: "Soup", draftLineId: body.groups[0]!.lineIds[0] },
  });
});

it("lets a till mark a dish that only a set menu lists sold out", async () => {
  const { path, body } = await draft(true);
  const availability = `/api/service-zones/${venue.zoneId}/products/${daily.productId}/availability`;
  const soldOut = await request("PUT", availability, { available: false });
  expect(soldOut).toEqual({ status: 200, json: { available: false } });
  try {
    const result = await request("POST", path, body);
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({
      code: "product.unavailable",
      params: { productId: daily.productId },
    });
  } finally {
    const restored = await request("PUT", availability, { available: true });
    expect(restored.status).toBe(200);
  }
});
