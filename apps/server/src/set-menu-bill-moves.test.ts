import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { billSetMenuCopies, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { insertPartyBill } from "./parties.js";
import { cancelItem } from "./line-cancel.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { moveOrderLines } from "./working-order-transfer.js";
import { advanceTicketItem } from "./working-order-kitchen-service.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { mergeBills, moveDishes } from "./testing/bill-action-fixture.js";
import { cancelReasonId, observedCancelItem } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  billRow,
  commandFor,
  counterOrder,
  inTx,
  OPERATOR,
  pay,
  revisionOf,
  seatWithNoAllergies,
  zoneOf,
} from "./testing/party-venue.js";
import { moveGuests } from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  freezeBillLine,
  priceSetMenuDish,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let special: typeof fixture.copy;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    const { venue, copy } = fixture;
    special = await inTx(venue, (tx) =>
      setMenuOnFullMenu(
        tx,
        copy.fullMenuId,
        copy.productId,
        "Special menu",
        "21.00",
        copy.courseId,
      ),
    );
    // Flan at 20.00 a la carte, so a bill works a Flan out into a Daily (14.00).
    copy.versionId = special.versionId = await inTx(venue, (tx) =>
      priceSetMenuDish(tx, copy, { aLaCarte: 2000 }),
    );
  },
});

async function bills() {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const target = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, source.partyId));
  return { ...source, target };
}

async function move(
  source: Pick<Awaited<ReturnType<typeof bills>>, "partyId" | "billId" | "target">,
  ...lineIds: string[]
) {
  const { venue } = fixture;
  const command = await commandFor(venue, source.partyId);
  return inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, source.billId, source.target, lineIds, command),
  );
}

function lines(billId: string) {
  return fixture.venue.db
    .select({
      id: workingOrderLines.id,
      setMenuLineId: workingOrderLines.setMenuLineId,
      place: workingOrderLines.setMenuPlace,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      versionId: workingOrderLines.setMenuVersionId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

function copies(billId: string) {
  return fixture.venue.db
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, billId));
}

it("moves a menu and its dishes together, with their original places, prices and recorded copy", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const stayingId = await inTx(venue, async (tx) => {
    const id = await seedBillSetMenu(tx, source.billId, special, 3, 2100);
    await freezeBillLine(tx, id);
    return id;
  });
  const before = await lines(source.billId);
  await move(source, source.menuLineId, source.dishId);
  expect(await lines(source.billId)).toEqual(before.filter(({ id }) => id === stayingId));
  expect(await lines(source.target)).toEqual(before.filter(({ id }) => id !== stayingId));
  expect(new Set(await copies(source.billId))).toEqual(
    new Set([
      { menuId: copy.menuId, versionId: copy.versionId },
      { menuId: special.menuId, versionId: special.versionId },
    ]),
  );
  expect(new Set(await copies(source.target))).toEqual(
    new Set([
      { menuId: copy.menuId, versionId: copy.versionId },
      { menuId: special.menuId, versionId: special.versionId },
    ]),
  );
});

/** The target after a Flan moved alone: the Flan in a Daily of its own, the Daily at 14.00. */
async function expectFlanInOwnDaily(source: Awaited<ReturnType<typeof bills>>) {
  const { copy } = fixture;
  const rows = await lines(source.target);
  expect(rows).toEqual([
    {
      id: source.dishId,
      setMenuLineId: rows[1]?.id,
      place: 0,
      unitPriceGross: 0,
      lineTotal: 0,
      versionId: null,
    },
    {
      id: expect.any(String),
      setMenuLineId: null,
      place: null,
      unitPriceGross: 1400,
      lineTotal: 1400,
      versionId: copy.versionId,
    },
  ]);
}

it("moves a dish alone to a bill holding a Special with no dish, and both bills work out their set menus", async () => {
  const source = await bills();
  const { venue } = fixture;
  await inTx(venue, (tx) => seedBillSetMenu(tx, source.target, special, 1, 2100));
  await move(source, source.dishId);
  expect(await lines(source.billId)).toEqual([]);
  await expectFlanInOwnDaily(source);
});

it("moves a dish alone to a bill with no set menu, charging it as that bill groups it", async () => {
  const source = await bills();
  await move(source, source.dishId);
  expect(await lines(source.billId)).toEqual([]);
  await expectFlanInOwnDaily(source);
});

it("records both versions of Daily on a target that recorded another one (D26)", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const versionId = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "16.00" });
    const versionId = await publishWorkingMenu(tx, copy.fullMenuId);
    await seedBillSetMenu(tx, source.target, { ...copy, versionId }, 1, 1600);
    return versionId;
  });
  const recorded = await copies(source.billId);
  await move(source, source.menuLineId);
  expect(new Set(await copies(source.target))).toEqual(
    new Set([{ menuId: copy.menuId, versionId }, ...recorded]),
  );
  // Daily back at 14.00 for the cases after this one, which share the database.
  copy.versionId = special.versionId = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "14.00" });
    return publishWorkingMenu(tx, copy.fullMenuId);
  });
});

it("merges both menus with their places and brings across missing recorded copies", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const otherMenu = await inTx(venue, async (tx) => {
    const id = await seedBillSetMenu(tx, source.target, special, 1, 2100);
    await freezeBillLine(tx, id);
    return id;
  });
  const command = await commandFor(venue, source.partyId);
  await inTx(venue, (tx) => mergeBills(tx, venue.cfg, source.target, source.billId, command));
  expect(await lines(source.billId)).toEqual([]);
  expect(await lines(source.target)).toMatchObject([
    { id: otherMenu, lineTotal: 2100 },
    { id: source.menuLineId, lineTotal: 1400 },
    { id: source.dishId, setMenuLineId: source.menuLineId, place: 0, lineTotal: 0 },
  ]);
  expect(await copies(source.target)).toEqual(
    expect.arrayContaining([
      { menuId: copy.menuId, versionId: copy.versionId },
      { menuId: special.menuId, versionId: special.versionId },
    ]),
  );
  expect(await copies(source.target)).toHaveLength(2);
});

it("refuses to move set-menu lines into an eat-in counter bill", async () => {
  const source = await bills();
  const { venue } = fixture;
  const counter = await counterOrder(venue, "Burger");
  await expect(
    inTx(venue, (tx) => moveOrderLines(tx, venue.cfg, source.billId, counter, undefined)),
  ).rejects.toMatchObject({ code: "set_menu.not_seated" });
  expect(await lines(source.billId)).toHaveLength(2);
  expect(await lines(counter)).toHaveLength(1);
});

async function cancelKeepingCharge(source: Awaited<ReturnType<typeof bills>>) {
  const { venue } = fixture;
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, source.dishId));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 500, lineTotal: 500 })
      .where(eq(workingOrderLines.id, source.dishId));
    const { target, lineId, body } = await observedCancelItem(tx, source.billId, 2);
    await cancelItem(
      tx,
      venue.cfg,
      target,
      lineId,
      {
        ...body,
        outcome: "keep_charge",
        reasonId: await cancelReasonId(tx),
        admission: testTradingAdmission(),
      },
      venue.operator.personId,
    );
  });
}

it("refuses to reprice a cancelled dish whose charge was kept", async () => {
  const source = await bills();
  const { venue } = fixture;
  await inTx(venue, (tx) => seedBillSetMenu(tx, source.target, special, 1, 2100));
  await cancelKeepingCharge(source);
  const before = await lines(source.billId);
  await expect(move(source, source.dishId)).rejects.toMatchObject({
    code: "set_menu.moves_with_set_menu",
  });
  expect(await lines(source.billId)).toEqual(before);
});

it("keeps a cancelled dish fixed at its charged price after moving its menu", async () => {
  const source = await bills();
  const { venue } = fixture;
  await cancelKeepingCharge(source);
  const total = (id: string) => inTx(venue, (tx) => storedOrderTotal(tx, id));
  expect(await total(source.billId)).toBe("19.00");
  await move(source, source.menuLineId);
  expect(await total(source.billId)).toBe("0.00");
  expect(await total(source.target)).toBe("19.00");
  const state = await inTx(venue, (tx) => readBillSetMenus(tx, source.target));
  expect(state.dishes).toMatchObject([
    { lineId: source.dishId, setMenuLineId: source.menuLineId, movable: false, priceCents: 500 },
  ]);
});

it("keeps an unsent eaten-in bill eaten in when its guests move to a table of a takeaway-only department, so the set menu it formed is paid", async () => {
  const { venue } = fixture;
  const { partyId, tabId: billId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  expect((await billRow(venue, billId)).dining).toBe("eat_in");
  await inTx(venue, (tx) =>
    addPortionRound(tx, venue.cfg, billId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
  );
  const formed = await inTx(venue, (tx) => readBillSetMenus(tx, billId));
  expect(formed.setMenus).toHaveLength(1);
  const shopZone = await inTx(venue, async (tx) => {
    const shop = await createDepartment(tx, {
      name: `Takeaway shop ${crypto.randomUUID()}`,
      orderStart: "table",
    });
    await setDepartmentSalePolicyField(tx, shop.id, "dining", "takeaway");
    const zone = await createServiceZone(tx, {
      name: `Takeaway shop ${crypto.randomUUID()}`,
      departmentId: shop.id,
    });
    return (await offerProducts(tx, { zone: { zoneId: zone.id }, orderStart: "table" })).zoneId;
  });
  const table = await venue.table(crypto.randomUUID(), shopZone);
  const expectedPartyRevision = await revisionOf(venue, partyId);

  await inTx(venue, (tx) =>
    moveGuests(tx, venue.cfg, partyId, table, { expectedPartyRevision, operatorId: OPERATOR }),
  );
  expect(await zoneOf(venue, billId)).toBe(shopZone);
  expect((await billRow(venue, billId)).dining).toBe("eat_in");
  const kept = await inTx(venue, (tx) => readBillSetMenus(tx, billId));
  expect(kept.setMenus).toEqual(formed.setMenus);
  expect(await inTx(venue, (tx) => storedOrderTotal(tx, billId))).toBe("14.00");

  await pay(venue, billId, "14.00");
  expect((await billRow(venue, billId)).status).toBe("settled");
});
