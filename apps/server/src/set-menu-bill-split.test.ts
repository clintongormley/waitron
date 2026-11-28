import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orderDraftLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { splitDraft } from "./order-drafts.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { commandFor, inTx, join, seatWithNoAllergies } from "./testing/party-venue.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
  },
});

const read = (billId: string) => inTx(fixture.venue, (tx) => readBillSetMenus(tx, billId));

it("refuses to move an eat-in set-menu bill to the counter", async () => {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const command = await commandFor(venue, source.partyId);
  await expect(
    inTx(venue, (tx) =>
      moveBill(tx, venue.cfg, source.billId, { counter: { zoneId: null } }, command),
    ),
  ).rejects.toMatchObject({ code: "set_menu.bill_holds_set_menus" });
  const [bill] = await venue.db
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, source.billId));
  expect(bill?.partyId).toBe(source.partyId);
});

it("refuses to leave a draft containing a set-menu dish at the eat-in counter", async () => {
  const { venue, copy } = fixture;
  const seated = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const draft = await saveSetMenuDraft(venue, seated, {
    menuItemId: copy.menuItemId,
    menuVersionId: copy.versionId,
    setMenuId: copy.menuId,
    quantity: "1",
  });
  const command = await commandFor(venue, seated.partyId);
  await expect(
    inTx(venue, (tx) =>
      moveBill(
        tx,
        venue.cfg,
        seated.tabId,
        { counter: { zoneId: null } },
        { ...command, operatorId: draft.ownerId },
      ),
    ),
  ).rejects.toMatchObject({ code: "set_menu.not_seated" });
  expect(await inTx(venue, (tx) => readBillEditState(tx, seated.tabId))).toMatchObject({
    draftId: draft.id,
    draftRevision: draft.revision,
  });
});

it("keeps the recorded menu and dish places when a whole bill moves to another table", async () => {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const before = await read(source.billId);
  const tableId = await venue.table(crypto.randomUUID());
  const command = await commandFor(venue, source.partyId);
  const moved = await inTx(venue, (tx) =>
    moveBill(tx, venue.cfg, source.billId, { tableId }, { ...command, otherPartyId: null }),
  );
  expect(moved.billId).toBe(source.billId);
  expect(moved.partyId).not.toBe(source.partyId);
  expect(await read(moved.billId)).toEqual(before);
});

it("splits a table taking a set-menu dish alone, and both bills work out their set menus", async () => {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const leaving = await venue.table(crypto.randomUUID());
  await join(venue, source.partyId, leaving);
  const command = await commandFor(venue, source.partyId);
  const moved = await inTx(venue, (tx) =>
    splitTable(
      tx,
      venue.cfg,
      source.partyId,
      leaving,
      { wholeBillIds: [], loose: [{ billId: source.billId, lineIds: [source.dishId] }] },
      command,
    ),
  );
  expect(moved.billIds).toEqual([moved.billId]);
  expect(await read(source.billId)).toMatchObject({ setMenus: [], dishes: [] });
  expect(await read(moved.billId)).toMatchObject({ setMenus: [], dishes: [] });
  expect(await inTx(venue, (tx) => storedOrderTotal(tx, moved.billId))).toBe("5.00");
});

it("keeps both set-menu draft offers when one dish moves to a new bill", async () => {
  const { venue, copy } = fixture;
  const seated = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const offer = {
    menuItemId: copy.menuItemId,
    menuVersionId: copy.versionId,
    setMenuId: copy.menuId,
  };
  const dish = { ...offer, quantity: "1" };
  const draft = await saveSetMenuDraft(venue, seated, dish, dish);
  const [first, second] = draft.lines;
  const command = await commandFor(venue, seated.partyId);
  const result = await inTx(venue, async (tx) =>
    splitDraft(tx, venue.cfg, seated.partyId, draft.id, {
      ...command,
      operatorId: draft.ownerId,
      submissionId: crypto.randomUUID(),
      expectedEdit: await readBillEditState(tx, seated.tabId),
      lineIds: [second!.id],
    }),
  );
  expect(result.source.draft?.lines).toMatchObject([{ ...offer, id: first!.id }]);
  expect(result.destination.draft?.lines).toMatchObject([{ ...offer, id: second!.id }]);
  const [stored] = await venue.db
    .select()
    .from(orderDraftLines)
    .where(eq(orderDraftLines.id, second!.id));
  expect(stored).toMatchObject({
    draftId: result.destination.draft!.id,
    setMenuId: copy.menuId,
  });
});
