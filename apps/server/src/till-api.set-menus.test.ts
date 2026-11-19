import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { persons, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import * as venueService from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { insertPartyBill, partyRevision } from "./parties.js";
import { mountTillApi } from "./till-api.js";
import { inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { saveSetMenuDraft, seedBillSetMenu } from "./testing/set-menu-bill-fixture.js";
import { setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let app: Hono;
let cookie: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    const { venue } = fixture;
    const token = await inTx(venue, async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.email, "owner@example.test"));
      return (
        await loginWithPin(tx, {
          deviceId: venue.cfg.origin.deviceId,
          personId: admin!.id,
          pin: "1234",
        })
      ).token;
    });
    cookie = await sessionCookieForTest(db, token);
    app = new Hono();
    mountTillApi(
      app,
      {
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: "es-ES",
        secureCookies: false,
        admission: testTradingAdmission(),
      },
      () => {},
    );
  },
});

async function seated() {
  const { venue } = fixture;
  return seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
}

function request(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("sets a bill's count, reads it for a move, cancels one line and refuses the stale count", async () => {
  const { venue, copy } = fixture;
  const { partyId, tabId } = await seated();
  const expectedPartyRevision = await inTx(venue, (tx) => partyRevision(tx, partyId));
  const path = `/api/bills/${tabId}/set-menus`;
  const expectedEdit = await inTx(venue, (tx) => readBillEditState(tx, tabId));
  const count = { count: 2, expectedPartyRevision, expectedEdit };
  const raised = await request("PUT", `${path}/${copy.menuId}`, count);
  expect(raised.status).toBe(200);
  const answer = await raised.json();
  expect(answer).toMatchObject({
    partyRevision: expectedPartyRevision + 1,
    setMenus: {
      recorded: { [copy.menuId]: copy.versionId },
      setMenus: [{ lineNo: 1 }, { lineNo: 2 }],
    },
  });

  const read = await request("GET", path);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(answer);
  const stale = await request("PUT", `${path}/${copy.menuId}`, { ...count, count: 3 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "party.out_of_date" } });

  const [first, second] = answer.setMenus.setMenus;
  const removed = await request("DELETE", `/api/bills/${tabId}/set-menu-lines/${first.lineId}`, {
    expectedPartyRevision: answer.partyRevision,
    expectedEdit,
  });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({
    partyRevision: expectedPartyRevision + 2,
    setMenus: { setMenus: [second] },
  });
  expect(
    await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId)),
  ).toEqual([{ id: second.lineId }]);
});

it.each(["PUT", "DELETE"] as const)(
  "%s refuses a change while another person owns the bill's draft",
  async (method) => {
    const { venue, copy } = fixture;
    const bill = await seated();
    const lineId = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, copy, 1));
    await saveSetMenuDraft(venue, bill, {
      menuItemId: copy.menuItemId,
      menuVersionId: copy.versionId,
      setMenuId: copy.menuId,
      quantity: "1",
    });
    const expectedPartyRevision = await inTx(venue, (tx) => partyRevision(tx, bill.partyId));
    const expectedEdit = await inTx(venue, (tx) => readBillEditState(tx, bill.tabId));
    const path = method === "PUT" ? `set-menus/${copy.menuId}` : `set-menu-lines/${lineId}`;
    const response = await request(method, `/api/bills/${bill.tabId}/${path}`, {
      count: 2,
      expectedPartyRevision,
      expectedEdit,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "draft.taken_over" } });
    expect(
      await venue.db
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, bill.tabId)),
    ).toEqual([{ id: lineId }]);
    expect(await inTx(venue, (tx) => partyRevision(tx, bill.partyId))).toBe(expectedPartyRevision);
  },
);

it.each([-1, 100, 1.5, "2", null])("refuses an invalid count %s", async (count) => {
  const { copy } = fixture;
  const { tabId } = await seated();
  const response = await request("PUT", `/api/bills/${tabId}/set-menus/${copy.menuId}`, {
    count,
    expectedPartyRevision: 0,
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "count" } },
  });
});

it("returns each bill's recorded copy in full with one lookup, even after republishing", async () => {
  const { venue, copy } = fixture;
  const { partyId, tabId } = await seated();
  const { older, newer, newerBill } = await inTx(venue, async (tx) => {
    const older = await seedBillSetMenu(tx, tabId, copy, 1);
    await updateMenuDetails(tx, copy.menuId, { setPrice: "15.00" });
    const versionId = await publishWorkingMenu(tx, copy.fullMenuId);
    const newerBill = await insertPartyBill(tx, venue.cfg, partyId);
    const newer = await seedBillSetMenu(tx, newerBill, { ...copy, versionId }, 1, 1500);
    return { older, newer, newerBill };
  });

  const serve = vi.spyOn(venueService, "serveRecordedSetMenus");
  try {
    const response = await request("GET", `/api/parties/${partyId}/bills`);
    expect(response.status).toBe(200);
    const bills = await response.json();
    expect(bills).toMatchObject([
      {
        workingOrderId: tabId,
        setMenus: { setMenus: [{ lineId: older }] },
        setMenuCopies: [
          {
            menuId: copy.menuId,
            terms: { price: "14.00" },
            structure: expect.any(Object),
            offers: [{ id: copy.menuItemId }],
          },
        ],
      },
      {
        workingOrderId: newerBill,
        setMenus: { setMenus: [{ lineId: newer }] },
        setMenuCopies: [
          {
            menuId: copy.menuId,
            terms: { price: "15.00" },
            structure: expect.any(Object),
            offers: [{ id: copy.menuItemId }],
          },
        ],
      },
    ]);
    expect(serve).toHaveBeenCalledTimes(1);
  } finally {
    serve.mockRestore();
  }
});
