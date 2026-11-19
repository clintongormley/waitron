import { eq } from "drizzle-orm";
import { workingOrders } from "@waitron/db";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { menuDocumentHash, menuVersions, updateProduct } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readDrafts } from "./order-drafts.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import {
  inTx,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    daily = await inTx(venue, (tx) =>
      setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
    );
  },
});

const tableBill = async () => seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
const dessert = () => ({
  menuItemId: daily.menuItemId,
  menuVersionId: daily.versionId,
  setMenuId: daily.menuId,
  quantity: "1",
});

function save({ partyId, tabId }: { partyId: string; tabId: string }, ...lines: unknown[]) {
  return inTx(venue, (tx) =>
    saveDraftForTest(tx, venue.cfg, partyId, venue.operator.personId, {
      billId: tabId,
      draftId: null,
      revision: 0,
      lines,
    }),
  );
}

it("saves a dish only the set menu offers and reads it back as available", async () => {
  const bill = await tableBill();
  await save(bill, dessert());
  const [draft] = await inTx(venue, (tx) => readDrafts(tx, bill.partyId));
  expect(draft!.lines).toEqual([
    expect.objectContaining({ ...dessert(), quantity: "1.000", unavailable: false }),
  ]);
});

it("keeps two identical set-menu dishes as separate units", async () => {
  const draft = await save(await tableBill(), dessert(), dessert());
  expect(draft.lines.map(({ quantity }) => quantity)).toEqual(["1.000", "1.000"]);
});

it("refuses a set-menu draft line with quantity two", async () => {
  await expect(save(await tableBill(), { ...dessert(), quantity: "2" })).rejects.toMatchObject({
    code: "management.request_invalid",
    params: { field: "quantity" },
  });
});

it("saves a requested place and reads it back", async () => {
  const bill = await tableBill();
  const lineId = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const reservation = { setMenuReservedLineId: lineId, setMenuReservedPlace: 0 };
  const draft = await save(bill, { ...dessert(), ...reservation });
  expect(draft.lines[0]).toMatchObject(reservation);
  const [read] = await inTx(venue, (tx) => readDrafts(tx, bill.partyId));
  expect(read!.lines[0]).toMatchObject(reservation);
});

it("reads a saved set-menu dish as unavailable after it sells out", async () => {
  const bill = await tableBill();
  await save(bill, dessert());
  const setAvailable = (available: boolean) =>
    inTx(venue, (tx) => updateProduct(tx, daily.productId, { available }));
  await setAvailable(false);
  try {
    const [draft] = await inTx(venue, (tx) => readDrafts(tx, bill.partyId));
    expect(draft!.lines[0]).toMatchObject({ unavailable: true });
  } finally {
    await setAvailable(true);
  }
});

it("refuses set-menu dishes on an eat-in bill with counter service", async () => {
  const bill = await tableBill();
  await inTx(venue, (tx) =>
    tx
      .update(workingOrders)
      .set({ serviceMode: "ticket_then_pay" })
      .where(eq(workingOrders.id, bill.tabId)),
  );
  await expect(save(bill, dessert())).rejects.toMatchObject({ code: "set_menu.not_seated" });
});

it("refuses a measured dish even when an existing copy lists it", async () => {
  const bill = await tableBill();
  const copy = await inTx(venue, async (tx) => {
    const [current] = await tx
      .select()
      .from(menuVersions)
      .where(eq(menuVersions.id, daily.versionId));
    const document = structuredClone(current!.document);
    document.setMenus![daily.menuId]!.offers[daily.menuItemId]!.unit.measure = true;
    const versionId = crypto.randomUUID();
    await tx.insert(menuVersions).values({
      ...current!,
      id: versionId,
      number: current!.number + 1,
      contentHash: menuDocumentHash(document),
      document,
    });
    const copy = { ...daily, versionId };
    await seedBillSetMenu(tx, bill.tabId, copy, 1);
    return copy;
  });
  await expect(save(bill, { ...dessert(), menuVersionId: copy.versionId })).rejects.toMatchObject({
    code: "set_menu.dish_sold_by_measure",
    params: { productId: daily.productId },
  });
});
