import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { kitchenCourses, workingOrderLines } from "@waitron/db";
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
import { submitDraft, type Draft } from "./order-drafts.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  commandFor,
  inTx,
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

// Flan (5.00) is cheaper than any set menu here, so the grouping charges it a la carte (D10).
it("sends a set-menu-folder dish at the grouping's price, removing a set menu it does not pay, while a separately ordered one keeps its own price", async () => {
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
  const rows = await rowsOf(bill.tabId);
  expect(rows.map(({ id }) => id)).not.toContain(menuLineId);
  const [included, added, separate] = rows;
  expect(rows).toHaveLength(3);
  expect(included).toMatchObject({
    setMenuRole: null,
    setMenuId: daily.menuId,
    setMenuLineId: null,
    setMenuPlace: null,
    setMenuCountsAsCourseId: null,
    menuId: daily.fullMenuId,
    menuVersionId: daily.versionId,
    menuItemId: daily.menuItemId,
    courseId: daily.courseId,
    unitPriceGross: 500,
    lineTotal: 500,
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

it("stores a dish tapped in another set menu's folder at its a la carte price with the tapped course", async () => {
  const bill = await tableBill();
  const target = await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, daily, 1));
  const tap = { ...dessert(), setMenuId: special.menuId, menuItemId: special.menuItemId };
  const draft = await save(bill, tap);
  await send(draft);
  const [placed, ...rest] = await rowsOf(bill.tabId);
  expect(rest).toEqual([]);
  expect(placed).toMatchObject({
    setMenuId: special.menuId,
    setMenuLineId: null,
    setMenuCountsAsCourseId: null,
    courseId: special.courseId,
    unitPriceGross: 500,
  });
  expect(placed!.id).not.toBe(target);

  await inTx(venue, (tx) => seedBillSetMenu(tx, bill.tabId, special, 3, 2100));
  await send(await save(bill, tap));
  const [kept, later, ...left] = await rowsOf(bill.tabId);
  expect(left).toEqual([]);
  expect(kept).toEqual(placed);
  expect(later).toMatchObject({ setMenuLineId: null, lineTotal: 500 });
});
