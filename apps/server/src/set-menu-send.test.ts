import { eq, type Query } from "drizzle-orm";
import { SQLiteSelectBase } from "drizzle-orm/sqlite-core";
import { expect, it, vi } from "vitest";
import { kitchenCourses, orderGroups, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createExtraList,
  createOptionList,
  menuItems,
  saveSetMenuDishCourse,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { GroupRelease } from "./order-group-records.js";
import { readDrafts, submitDraft, type Draft } from "./order-drafts.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  commandFor,
  inTx,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
let special: typeof daily;
let option: { listId: string; labelId: string };
let extra: { listId: string; picks: { productId: string; quantity: number }[] };
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    await inTx(venue, async (tx) => {
      const flan = venue.productId("Flan");
      const topping = venue.productId("Tarta");
      const options = await createOptionList(
        tx,
        {
          name: "Spoon",
          defaultLabelId: null,
          active: true,
          labels: [{ name: "With spoon", available: true }],
        },
        venue.cfg.locale,
      );
      const extras = await createExtraList(
        tx,
        {
          name: "Side",
          minPicks: 0,
          maxPicks: 1,
          items: [{ productId: topping, maxQuantity: 1, price: "1.50" }],
        },
        venue.cfg.locale,
      );
      await writeProductModifiers(tx, flan, [
        { kind: "options", id: options.id },
        { kind: "extras", id: extras.id },
      ]);
      option = { listId: options.id, labelId: options.labels[0]!.id };
      extra = { listId: extras.id, picks: [{ productId: topping, quantity: 1 }] };
      daily = await setMenuOnFullMenu(tx, venue.tables.menuId, flan);
      const [{ id: courseId }] = await tx
        .insert(kitchenCourses)
        .values({ name: "Sharing", displayOrder: 5 })
        .returning({ id: kitchenCourses.id });
      await saveSetMenuDishCourse(tx, daily.menuId, daily.menuItemId, courseId);
      daily.courseId = courseId;
      special = await setMenuOnFullMenu(tx, venue.tables.menuId, flan, "Special menu", "21.00");
      await tx
        .update(menuItems)
        .set({ grossPrice: 500 })
        .where(eq(menuItems.id, special.menuItemId));
      daily.versionId = special.versionId = await publishWorkingMenu(tx, venue.tables.menuId);
    });
  },
});

const tableBill = async () => seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
const dessert = () => ({
  menuItemId: daily.menuItemId,
  menuVersionId: daily.versionId,
  setMenuId: daily.menuId,
  quantity: "1",
  options: [option],
});

const save = (bill: { partyId: string; tabId: string }, ...lines: unknown[]) =>
  saveSetMenuDraft(venue, bill, ...lines);

async function send(
  draft: Draft,
  groups: { lineIds: string[]; release: GroupRelease }[] = [
    { lineIds: draft.lines.map(({ id }) => id), release: "hold" },
  ],
) {
  const command = await commandFor(venue, draft.partyId);
  return inTx(venue, async (tx) =>
    submitDraft(tx, venue.cfg, draft.partyId, draft.id, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups,
    }),
  );
}

const rowsOf = (tabId: string) =>
  venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);

it("sends a set-menu dish at its placed price while a separately ordered one keeps its own price", async () => {
  const bill = await tableBill();
  const menuLineId = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const draft = await save(
    bill,
    { ...dessert(), extras: [extra] },
    {
      menuItemId: venue.item("Flan"),
      quantity: "1",
      options: [option],
    },
  );
  const sent = await send(draft);
  const [menu, included, added, separate] = await rowsOf(bill.tabId);
  expect(menu!.id).toBe(menuLineId);
  expect(included).toMatchObject({
    setMenuRole: "dish",
    setMenuId: daily.menuId,
    setMenuLineId: menuLineId,
    setMenuPlace: 0,
    setMenuCountsAsCourseId: daily.courseId,
    menuId: daily.fullMenuId,
    menuVersionId: daily.versionId,
    menuItemId: daily.menuItemId,
    courseId: daily.courseId,
    unitPriceGross: 0,
    lineTotal: 0,
    groupId: sent.groups[0]!.id,
  });
  expect(included!.optionSnapshots).toHaveLength(1);
  expect(added).toMatchObject({
    parentLineId: included!.id,
    setMenuRole: null,
    menuVersionId: daily.versionId,
    unitPriceGross: 150,
    lineTotal: 150,
  });
  expect(separate).toMatchObject({
    setMenuRole: null,
    unitPriceGross: 500,
    lineTotal: 500,
  });
});

it("keeps the requested place on the second set menu", async () => {
  const bill = await tableBill();
  const second = await inTx(venue, async (tx) => {
    await seedBillSetMenu(tx, bill.tabId, daily, 1);
    return seedBillSetMenu(tx, bill.tabId, daily, 2);
  });
  const draft = await save(bill, {
    ...dessert(),
    setMenuReservedLineId: second,
    setMenuReservedPlace: 0,
  });
  await send(draft);
  expect((await rowsOf(bill.tabId))[2]).toMatchObject({
    setMenuLineId: second,
    setMenuPlace: 0,
  });
});

it("places in saved draft order even when sending groups in reverse order", async () => {
  const bill = await tableBill();
  const first = await inTx(venue, async (tx) => {
    const id = await seedBillSetMenu(tx, bill.tabId, daily, 1);
    await seedBillSetMenu(tx, bill.tabId, daily, 2);
    return id;
  });
  const draft = await save(bill, { ...dessert(), note: "First" }, { ...dessert(), note: "Second" });
  const [early, late] = draft.lines;
  await send(draft, [
    { lineIds: [late!.id], release: "hold" },
    { lineIds: [early!.id], release: "hold" },
  ]);
  const placed = (await rowsOf(bill.tabId)).find((row) => row.setMenuLineId === first);
  expect(placed?.note).toBe("First");
});

it("refuses the whole send and retains the draft when the second dish has no place", async () => {
  const bill = await tableBill();
  await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const draft = await save(bill, dessert(), dessert());
  const before = await rowsOf(bill.tabId);
  const revision = await revisionOf(venue, bill.partyId);
  await expect(
    send(draft, [{ lineIds: draft.lines.map(({ id }) => id), release: "fire" }]),
  ).rejects.toMatchObject({ code: "set_menu.no_place", params: { dishName: "Flan" } });
  expect(await rowsOf(bill.tabId)).toEqual(before);
  expect(
    await venue.db.select().from(orderGroups).where(eq(orderGroups.partyId, bill.partyId)),
  ).toEqual([]);
  expect(await revisionOf(venue, bill.partyId)).toBe(revision);
  expect(await inTx(venue, (tx) => readDrafts(tx, bill.partyId))).toEqual([draft]);
});

it("uses the landing copy's price and counts-as course while sending with the tapped course", async () => {
  const bill = await tableBill();
  const target = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const tap = { ...dessert(), setMenuId: special.menuId, menuItemId: special.menuItemId };
  const draft = await save(bill, tap);
  await send(draft);
  const [, placed] = await rowsOf(bill.tabId);
  expect(placed).toMatchObject({
    setMenuId: special.menuId,
    setMenuLineId: target,
    setMenuCountsAsCourseId: daily.courseId,
    courseId: special.courseId,
    unitPriceGross: 0,
  });

  const second = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, special, 3, 2100));
  await send(await save(bill, tap));
  const [, kept, , later] = await rowsOf(bill.tabId);
  expect(kept).toEqual(placed);
  expect(later).toMatchObject({ setMenuLineId: second, lineTotal: 500 });
});

it("keeps a place reserved by a draft dish left out of this send", async () => {
  const bill = await tableBill();
  const [first, second] = await inTx(venue, async (tx) => [
    await seedBillSetMenu(tx, bill.tabId, daily, 1),
    await seedBillSetMenu(tx, bill.tabId, daily, 2),
  ]);
  const draft = await save(bill, dessert(), {
    ...dessert(),
    setMenuReservedLineId: first,
    setMenuReservedPlace: 0,
  });
  const sent = await send(draft, [{ lineIds: [draft.lines[0]!.id], release: "hold" }]);
  expect((await rowsOf(bill.tabId))[2]).toMatchObject({ setMenuLineId: second });
  await send(sent.draft!);
  expect((await rowsOf(bill.tabId))[3]).toMatchObject({ setMenuLineId: first });
});

it("refuses to place a dish after its only set-menu line is removed", async () => {
  const bill = await tableBill();
  const lineId = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const draft = await save(bill, dessert());
  await inTx(venue, (tx) => tx.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId)));
  await expect(send(draft)).rejects.toMatchObject({ code: "set_menu.no_place" });
  expect(await rowsOf(bill.tabId)).toEqual([]);
});

it("sends ordinary dishes without reading set-menu copies", async () => {
  const bill = await tableBill();
  const draft = await save(bill, { menuItemId: venue.item("Burger"), quantity: "1" });
  const prototype = SQLiteSelectBase.prototype as unknown as {
    _prepare(oneTime?: boolean): unknown;
    toSQL(): Query;
  };
  const prepare = prototype._prepare;
  const reads: string[] = [];
  const observed = vi.spyOn(prototype, "_prepare").mockImplementation(function (
    this: { toSQL(): Query },
    oneTime,
  ) {
    const { sql } = this.toSQL();
    if (sql.includes('from "bill_set_menu_copies"')) reads.push(sql);
    return prepare.call(this, oneTime);
  });
  try {
    await send(draft);
    expect(reads).toEqual([]);
  } finally {
    observed.mockRestore();
  }
});
