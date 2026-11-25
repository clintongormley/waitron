import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { floorZones, persons, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import * as venueService from "@waitron/venue-service";
import { insertPartyBill } from "./parties.js";
import { mountTillApi } from "./till-api.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { seedBillSetMenu } from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
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

it("returns each bill's recorded copy in full with one lookup, even after republishing", async () => {
  const { venue, copy } = fixture;
  const { partyId, billId, menuLineId: older, dishId } = await setMenuBill(fixture);
  const { newer, newerBill } = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "15.00" });
    const versionId = await publishWorkingMenu(tx, copy.fullMenuId);
    const newerBill = await insertPartyBill(tx, venue.cfg, partyId);
    const newer = await seedBillSetMenu(tx, newerBill, { ...copy, versionId }, 1, 1500);
    return { newer, newerBill };
  });

  const serve = vi.spyOn(venueService, "serveRecordedSetMenus");
  try {
    const response = await request("GET", `/api/parties/${partyId}/bills`);
    expect(response.status).toBe(200);
    const bills = await response.json();
    expect(bills).toMatchObject([
      {
        workingOrderId: billId,
        setMenus: {
          setMenus: [{ lineId: older }],
          dishes: [{ lineId: dishId, setMenuLineId: older }],
        },
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
        setMenus: { setMenus: [{ lineId: newer }], dishes: [] },
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

async function counterTakeaway() {
  const { venue } = fixture;
  const id = crypto.randomUUID();
  const zoneId = venue.counter.zoneId;
  await inTx(venue, async (tx) => {
    const [zone] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId));
    await venueService.setDepartmentSalePolicyField(
      tx,
      zone!.departmentId,
      "dining",
      "till_choice",
    );
  });
  return {
    id,
    zoneId,
    dining: "takeaway",
    lines: [{ menuItemId: venue.counterItem("Flan"), quantity: "1" }],
  };
}

/**
 * A counter takeaway holding an empty set menu of the fixture's copy at line 2, with its revision
 * and set-menu state. Opened with a Flan the caller's save drops: an order opens with a line.
 */
async function counterWithSetMenu() {
  const { venue, copy } = fixture;
  const body = await counterTakeaway();
  expect((await request("POST", "/api/working-orders", body)).status).toBe(200);
  await inTx(venue, (tx) => seedBillSetMenu(tx, body.id, copy, 2));
  const held = await (await request("GET", `/api/working-orders/${body.id}`)).json();
  return { body, revision: held.revision as number, setMenus: held.setMenus };
}

// D10: one dish fills no set menu, so a dish tapped in a set-menu folder stays at its a la carte
// price and the empty set menu goes.
it("saves a dish tapped in a set-menu folder at its a la carte price without sending it to the kitchen", async () => {
  const { venue, copy } = fixture;
  const { body, revision, setMenus } = await counterWithSetMenu();
  const path = `/api/working-orders/${body.id}`;
  const response = await request("PUT", path, {
    dining: body.dining,
    expectedEdit: null,
    revision,
    lines: [
      {
        menuItemId: copy.menuItemId,
        menuVersionId: setMenus.recorded[copy.menuId],
        setMenuId: copy.menuId,
        quantity: "1",
        setMenuReservedLineId: setMenus.setMenus[0].lineId,
        setMenuReservedPlace: 0,
      },
    ],
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ revision: revision + 1 });
  expect(
    await venue.db
      .select({
        role: workingOrderLines.setMenuRole,
        price: workingOrderLines.unitPriceGross,
        reservedMenu: workingOrderLines.setMenuLineId,
        place: workingOrderLines.setMenuPlace,
        sentAt: workingOrderLines.sentAt,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, body.id))
      .orderBy(workingOrderLines.lineNo),
  ).toEqual([{ role: null, price: 500, reservedMenu: null, place: null, sentAt: null }]);
  const reopened = await request("GET", path);
  expect(reopened.status).toBe(200);
  const saved = await reopened.json();
  expect(saved).toMatchObject({
    lines: [
      {
        menuItemId: copy.menuItemId,
        menuVersionId: setMenus.recorded[copy.menuId],
        setMenuId: copy.menuId,
        product: { unitPrice: "5.00" },
      },
    ],
    setMenus: { setMenus: [], dishes: [] },
  });
  const fresh = { menuItemId: copy.menuItemId, setMenuId: copy.menuId, quantity: "1" };
  const kept = {
    ...fresh,
    menuVersionId: setMenus.recorded[copy.menuId],
    workingOrderLineId: saved.lines[0].workingOrderLineId,
  };
  const update = { dining: body.dining, expectedEdit: null, revision: saved.revision };
  const missingVersion = await request("PUT", path, { ...update, lines: [kept, fresh] });
  expect(missingVersion.status).toBe(400);
  expect(await missingVersion.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "lines[1].menuVersionId" } },
  });
  expect(await (await request("GET", path)).json()).toEqual(saved);
  const placed = await request("POST", `${path}/place`, { expectedEdit: null });
  expect(placed.status).toBe(200);
  expect(await placed.json()).toMatchObject({ id: body.id, status: "placed" });
  expect(
    await venue.db
      .select({ lineId: ticketItems.workingOrderLineId })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, saved.lines[0].workingOrderLineId)),
  ).toEqual([{ lineId: saved.lines[0].workingOrderLineId }]);
});

it("refuses Eat in on a counter bill with a set menu using the set-menu refusal", async () => {
  const { body, revision } = await counterWithSetMenu();
  const path = `/api/working-orders/${body.id}`;
  const switched = await request("PUT", `${path}/dining`, {
    dining: "eat_in",
    revision,
    expectedEdit: null,
  });
  expect(switched.status).toBe(409);
  expect(await switched.json()).toMatchObject({ error: { code: "set_menu.not_seated" } });
  expect(await (await request("GET", path)).json()).toMatchObject({ dining: "takeaway", revision });
});

it("keeps sending from the held-order edit on a seated bill that has started service", async () => {
  const { venue } = fixture;
  const { tabId, partyId } = await seated();
  await inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, partyId, {
      operatorId: venue.operator.personId,
      billId: tabId,
      groups: [{ lines: [{ menuItemId: venue.item("Flan"), quantity: "1" }], release: "fire" }],
    }),
  );
  const [first] = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const path = `/api/working-orders/${tabId}`;
  const order = await (await request("GET", path)).json();
  const saved = await request("PUT", path, {
    dining: order.dining,
    expectedEdit: order.expectedEdit,
    revision: order.revision,
    lines: [
      { workingOrderLineId: first!.id, menuItemId: venue.item("Flan"), quantity: "1" },
      { menuItemId: venue.item("Flan"), quantity: "1" },
    ],
  });
  expect(saved.status).toBe(200);
  const lines = await venue.db
    .select({ role: workingOrderLines.setMenuRole, sentAt: workingOrderLines.sentAt })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  // A sent dish started service, so the added Flan is sent too; a set-menu row would not have.
  expect(lines.filter(({ role }) => role !== "set_menu")).toEqual([
    { role: null, sentAt: expect.any(String) },
    { role: null, sentAt: expect.any(String) },
  ]);
});
