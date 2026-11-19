import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orderDraftLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { splitDraft } from "./order-drafts.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { commandFor, inTx, join, seatWithNoAllergies } from "./testing/party-venue.js";
import { saveSetMenuDraft, seedBillSetMenu } from "./testing/set-menu-bill-fixture.js";
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
  ).rejects.toMatchObject({ code: "set_menu.not_seated" });
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

it("splits a table with a set-menu dish only when its destination has a place", async () => {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const leaving = await venue.table(crypto.randomUUID());
  await join(venue, source.partyId, leaving);
  const before = await read(source.billId);
  const command = await commandFor(venue, source.partyId);
  const split = (lineIds: string[]) =>
    inTx(venue, (tx) =>
      splitTable(
        tx,
        venue.cfg,
        source.partyId,
        leaving,
        { wholeBillIds: [], loose: [{ billId: source.billId, lineIds }] },
        command,
      ),
    );
  await expect(split([source.dishId])).rejects.toMatchObject({
    code: "set_menu.no_place_on_target",
  });
  expect(await read(source.billId)).toEqual(before);
  const moved = await split([source.menuLineId]);
  expect(moved.billIds).toEqual([moved.billId]);
  expect(await read(moved.billId)).toMatchObject({
    recorded: before.recorded,
    setMenus: before.setMenus,
    dishes: before.dishes,
  });
  expect((await read(source.billId)).dishes).toEqual([]);
});

it("clears only the moved draft dish's reservation while keeping its set-menu offer", async () => {
  const { venue, copy } = fixture;
  const seated = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const [staying, moving] = await inTx(venue, async (tx) => [
    await seedBillSetMenu(tx, seated.tabId, copy, 1),
    await seedBillSetMenu(tx, seated.tabId, copy, 2),
  ]);
  const dish = {
    menuItemId: copy.menuItemId,
    menuVersionId: copy.versionId,
    setMenuId: copy.menuId,
    quantity: "1",
    setMenuReservedPlace: 0,
  };
  const draft = await saveSetMenuDraft(
    venue,
    seated,
    { ...dish, setMenuReservedLineId: staying },
    { ...dish, setMenuReservedLineId: moving },
  );
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
  expect(result.source.draft?.lines).toMatchObject([
    { id: first!.id, setMenuReservedLineId: staying, setMenuReservedPlace: 0 },
  ]);
  expect(result.destination.draft?.lines).toMatchObject([
    {
      id: second!.id,
      menuItemId: copy.menuItemId,
      menuVersionId: copy.versionId,
      setMenuId: copy.menuId,
      setMenuReservedLineId: null,
      setMenuReservedPlace: null,
    },
  ]);
  const [stored] = await venue.db
    .select()
    .from(orderDraftLines)
    .where(eq(orderDraftLines.id, second!.id));
  expect(stored).toMatchObject({
    draftId: result.destination.draft!.id,
    setMenuReservedLineId: null,
    setMenuReservedPlace: null,
  });
});
