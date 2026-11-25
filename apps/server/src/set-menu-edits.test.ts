import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { products, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createExtraList,
  createOptionList,
  createUnit,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { cancelItem } from "./line-cancel.js";
import { submitDraft } from "./order-drafts.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import {
  cancelItemForTest,
  cancelLine,
  cancelReasonId,
  observedCancelItem,
} from "./testing/cancel-line.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  commandFor,
  inTx,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { saveSetMenuDraft, setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { updateHeldOrder, updateOrderLine } from "./working-order-held-write.js";
import { setLineCourse } from "./working-order-kitchen-service.js";
import { type OrderLinePatch } from "./working-order-edit-state.js";
import { readOrderRevision } from "./working-order-context.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
let decimalUnitMenu: typeof daily;
let extra: { listId: string; picks: { productId: string; quantity: number }[] };
let options: { listId: string; labelId: string }[];

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    await inTx(venue, async (tx) => {
      const flan = venue.productId("Flan");
      const spoon = await createOptionList(
        tx,
        {
          name: "Spoon",
          defaultLabelId: null,
          active: true,
          labels: [
            { name: "With spoon", available: true },
            { name: "Without spoon", available: true },
          ],
        },
        venue.cfg.locale,
      );
      options = spoon.labels.map(({ id }) => ({ listId: spoon.id, labelId: id }));
      const productId = venue.productId("Burger");
      const sides = await createExtraList(
        tx,
        {
          name: "Side",
          minPicks: 0,
          maxPicks: 1,
          items: [{ productId, maxQuantity: 1, price: "1.50" }],
        },
        venue.cfg.locale,
      );
      extra = { listId: sides.id, picks: [{ productId, quantity: 1 }] };
      await writeProductModifiers(tx, flan, [
        { kind: "options", id: spoon.id },
        { kind: "extras", id: sides.id },
      ]);
      // Below Flan's 5.00, so a send groups Flan alone into a Daily.
      daily = await setMenuOnFullMenu(tx, venue.tables.menuId, flan, "Daily menu", "4.00");
      const tarta = venue.productId("Tarta");
      const unit = await createUnit(
        tx,
        {
          staffName: "Portion",
          staffAbbreviation: "pt",
          name: {},
          abbreviation: {},
          precision: 2,
        },
        venue.cfg.locale,
      );
      await tx.update(products).set({ unitId: unit.id }).where(eq(products.id, tarta));
      decimalUnitMenu = await setMenuOnFullMenu(tx, venue.tables.menuId, tarta, "Cake menu");
      daily.versionId = decimalUnitMenu.versionId;
    });
  },
});

/** A seated bill holding one dish from `menu`'s folder, sent held: line 1, grouped by line 2. */
async function bill(menu = daily) {
  const tab = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const draft = await saveSetMenuDraft(venue, tab, {
    menuItemId: menu.menuItemId,
    menuVersionId: menu.versionId,
    setMenuId: menu.menuId,
    quantity: "1",
    ...(menu === daily ? { options: [options[0]] } : {}),
  });
  const command = await commandFor(venue, tab.partyId);
  await inTx(venue, async (tx) =>
    submitDraft(tx, venue.cfg, tab.partyId, draft.id, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: [draft.lines[0]!.id], release: "hold" }],
    }),
  );
  return { ...tab, lineNo: 1 };
}

function rows(tabId: string) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

function edit(
  { tabId, lineNo }: Awaited<ReturnType<typeof bill>>,
  patch: Omit<OrderLinePatch, "portionLineNos">,
) {
  return inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      tabId,
      lineNo,
      { portionLineNos: [], ...patch },
      await readOrderRevision(tx, tabId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, tabId),
      },
    ),
  );
}

it("edits an option from the recorded offer without moving or repricing the dish", async () => {
  const tab = await bill();
  const [before, menu] = await rows(tab.tabId);
  await inTx(venue, (tx) => writeProductModifiers(tx, daily.productId, []));
  try {
    await edit(tab, { options: [options[1]!] });
  } finally {
    await inTx(venue, (tx) =>
      writeProductModifiers(tx, daily.productId, [
        { kind: "options", id: options[0]!.listId },
        { kind: "extras", id: extra.listId },
      ]),
    );
  }
  const [after] = await rows(tab.tabId);
  expect(after).toMatchObject({
    id: before!.id,
    setMenuLineId: menu!.id,
    setMenuPlace: 0,
    lineTotal: 0,
    optionSnapshots: [{ labelName: { es: "Without spoon" } }],
  });
});

it("keeps the set-menu heading when saving the bill's edited dishes", async () => {
  const tab = await bill();
  const [dish, menu] = await rows(tab.tabId);
  const observed = await inTx(venue, async (tx) => ({
    expectedEdit: await readBillEditState(tx, tab.tabId),
    revision: await readOrderRevision(tx, tab.tabId),
  }));
  await updateHeldOrder({ db: venue.db, admission: testTradingAdmission() }, venue.cfg, tab.tabId, {
    ...observed,
    operatorId: venue.operator.personId,
    lines: [
      {
        workingOrderLineId: dish!.id,
        menuItemId: daily.menuItemId,
        quantity: "1",
        options: [options[0]!],
        note: "At the end",
      },
    ],
  });
  expect(await rows(tab.tabId)).toEqual([{ ...dish, note: "At the end" }, menu]);
});

it("groups added portions into set menus of their own without moving the first dish", async () => {
  const tab = await bill();
  const [original, first] = await rows(tab.tabId);
  await edit(tab, { quantity: "3" });
  const saved = await rows(tab.tabId);
  expect(saved.slice(0, 2)).toEqual([original, first]);
  const menus = saved.filter(({ setMenuRole }) => setMenuRole === "set_menu");
  expect(menus.map(({ id, lineTotal }) => ({ id, lineTotal }))).toEqual([
    { id: first!.id, lineTotal: 400 },
    { id: expect.any(String), lineTotal: 400 },
    { id: expect.any(String), lineTotal: 400 },
  ]);
  expect(
    saved
      .filter(({ setMenuRole }) => setMenuRole === "dish")
      .map(({ quantity, setMenuLineId, lineTotal }) => ({ quantity, setMenuLineId, lineTotal })),
  ).toEqual(menus.map(({ id }) => ({ quantity: 1000, setMenuLineId: id, lineTotal: 0 })));
});

it("splits each added set-menu dish even when its ordinary unit accepts fractions", async () => {
  const tab = await bill(decimalUnitMenu);
  const original = (await rows(tab.tabId))[0]!;
  expect(original.wholePortion).toBe(false);
  expect(original.countAsPortions).toBe(false);
  expect(original.cohortId).toEqual(expect.any(String));
  await edit(tab, { quantity: "3" });
  const dishes = (await rows(tab.tabId)).filter(
    ({ productId }) => productId === decimalUnitMenu.productId,
  );
  const menus = (await rows(tab.tabId)).filter(({ setMenuRole }) => setMenuRole === "set_menu");
  expect(menus.map(({ setMenuId, lineTotal }) => ({ setMenuId, lineTotal }))).toEqual(
    [1, 2, 3].map(() => ({ setMenuId: decimalUnitMenu.menuId, lineTotal: 1400 })),
  );
  expect(
    dishes.map(({ quantity, setMenuRole, setMenuLineId, lineTotal }) => ({
      quantity,
      setMenuRole,
      setMenuLineId,
      lineTotal,
    })),
  ).toEqual(
    menus.map(({ id }) => ({
      quantity: 1000,
      setMenuRole: "dish",
      setMenuLineId: id,
      lineTotal: 0,
    })),
  );
});

it("keeps the set-menu classification when the kitchen course changes", async () => {
  const tab = await bill();
  await inTx(venue, async (tx) =>
    setLineCourse(tx, tab.tabId, tab.lineNo, null, {
      operatorId: venue.operator.personId,
      expectedEdit: await readBillEditState(tx, tab.tabId),
    }),
  );
  expect((await rows(tab.tabId))[0]).toMatchObject({
    courseId: null,
    countsAsCourseId: daily.courseId,
  });
});

it.each([
  ["item cancel", cancelItemForTest],
  ["adjustment", cancelLine],
] as const)(
  "a dish cancellation takes its emptied set menu away via %s",
  async (_route, cancel) => {
    const tab = await bill();
    const [, menu] = await rows(tab.tabId);
    expect(menu).toMatchObject({ setMenuRole: "set_menu" });
    await inTx(venue, (tx) => cancel(tx, venue.cfg, tab.tabId, tab.lineNo));
    expect(await rows(tab.tabId)).toEqual([]);
    expect(await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId))).toMatchObject({
      setMenus: [],
      dishes: [],
    });
  },
);

it("an adjustment refuses a set-menu heading", async () => {
  const tab = await bill();
  const before = await rows(tab.tabId);
  await expect(inTx(venue, (tx) => cancelLine(tx, venue.cfg, tab.tabId, 2))).rejects.toMatchObject({
    code: "set_menu.worked_out_by_bill",
  });
  expect(await rows(tab.tabId)).toEqual(before);
});

it("prices an added extra from the recorded menu and preserves the placed dish", async () => {
  const tab = await bill();
  const [dish, menu] = await rows(tab.tabId);
  await edit(tab, { extras: [extra] });
  expect(await rows(tab.tabId)).toMatchObject([
    { id: menu!.id, lineTotal: 400 },
    { id: dish!.id, setMenuLineId: menu!.id, lineTotal: 0 },
    { parentLineId: dish!.id, lineTotal: 150, productId: extra.picks[0]!.productId },
  ]);
});

it("refuses a fractional increase in a whole-bill set-menu edit", async () => {
  const tab = await bill(decimalUnitMenu);
  const before = await rows(tab.tabId);
  const observed = await inTx(venue, async (tx) => ({
    expectedEdit: await readBillEditState(tx, tab.tabId),
    revision: await readOrderRevision(tx, tab.tabId),
  }));
  await expect(
    updateHeldOrder({ db: venue.db, admission: testTradingAdmission() }, venue.cfg, tab.tabId, {
      ...observed,
      operatorId: venue.operator.personId,
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: decimalUnitMenu.menuItemId,
          quantity: "1.5",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "quantity.invalid", params: { reason: "precision" } });
  expect(await rows(tab.tabId)).toEqual(before);
});

it("refuses a request to cancel a set-menu heading while keeping its charge", async () => {
  const tab = await bill();
  const before = await rows(tab.tabId);
  await expect(
    inTx(venue, async (tx) => {
      const { target, lineId, body } = await observedCancelItem(tx, tab.tabId, 2);
      await cancelItem(
        tx,
        venue.cfg,
        target,
        lineId,
        {
          ...body,
          outcome: "keep_charge",
          admission: testTradingAdmission(),
          reasonId: await cancelReasonId(tx),
        },
        venue.operator.personId,
      );
    }),
  ).rejects.toMatchObject({ code: "set_menu.worked_out_by_bill" });
  expect(await rows(tab.tabId)).toEqual(before);
});
