import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { departments, floorZones, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addMember,
  addProducts,
  addSetMenuDishes,
  createMenu,
  menuItems,
  removeMember,
  requireMenuRoot,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { switchOrderDining } from "./order-dining.js";
import { readBillSetMenuVersions } from "./set-menu-bill.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { parkOrder } from "./working-order-open.js";
import { inTx, OPERATOR, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  setupSetMenuSpecVenue,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";

let spec: SpecVenue;
let venue: PartyVenue;
let ordinary: Record<SpecDish, string>;
let zoneId: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, async (tx) => {
      const shop = await createDepartment(tx, { name: "Counter", orderStart: "counter" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "till_choice");
      await setDepartmentSalePolicyField(tx, shop.id, "diningStartsAs", "eat_in");
      const zone = await createServiceZone(tx, { name: "Counter", departmentId: shop.id });
      zoneId = (await offerProducts(tx, { zone: { zoneId: zone.id } })).zoneId;
      const productIds = Object.values(spec.productIds);
      await addProducts(tx, await requireMenuRoot(tx, venue.tables.menuId), productIds);
      spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(
        tx,
        venue.tables.menuId,
      );
      const rows = await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(
          and(eq(menuItems.menuId, venue.tables.menuId), inArray(menuItems.productId, productIds)),
        );
      ordinary = Object.fromEntries(
        (Object.keys(spec.productIds) as SpecDish[]).map((dish) => [
          dish,
          rows.find(({ productId }) => productId === spec.productIds[dish])!.id,
        ]),
      ) as Record<SpecDish, string>;
    });
  },
});

async function counterOrder(dining: Dining, ...dishes: SpecDish[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId,
    lines: dishes.map((dish) => ({ menuItemId: ordinary[dish], quantity: "1" })),
    operatorId: OPERATOR,
    dining,
  });
  return id;
}

async function order(id: string) {
  const [row] = await venue.db
    .select({ dining: workingOrders.dining, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return row!;
}

async function shape(billId: string) {
  return (await specRows(spec, billId)).map((row) => ({
    what: row.setMenuRole === "set_menu" ? row.name : row.productId,
    role: row.setMenuRole,
    total: row.lineTotal,
  }));
}

async function switchTo(id: string, dining: Dining) {
  const { revision } = await order(id);
  return inTx(venue, (tx) =>
    switchOrderDining(tx, id, dining, revision, { operatorId: OPERATOR, expectedEdit: null }),
  );
}

const A_LA_CARTE = () => [
  { what: spec.productIds.Soup, role: null, total: 600 },
  { what: spec.productIds.Hake, role: null, total: 1600 },
];

const DAILY = () => [
  { what: spec.productIds.Soup, role: "dish", total: 0 },
  { what: spec.productIds.Hake, role: "dish", total: 0 },
  { what: spec.daily.name, role: "set_menu", total: 1400 },
];

it("groups an eat-in counter order's Soup and Hake into a Daily when it is switched to takeaway", async () => {
  const id = await counterOrder("eat_in", "Soup", "Hake");
  expect(await shape(id)).toEqual(A_LA_CARTE());
  const { revision } = await order(id);

  expect(await switchTo(id, "takeaway")).toBe(revision + 1);

  expect(await order(id)).toEqual({ dining: "takeaway", revision: revision + 1 });
  expect(await shape(id)).toEqual(DAILY());
});

it("refuses switching a takeaway counter order holding a set menu back to eat in, changing nothing", async () => {
  const id = await counterOrder("takeaway", "Soup", "Hake");
  expect(await shape(id)).toEqual(DAILY());
  const before = await order(id);

  await expect(switchTo(id, "eat_in")).rejects.toMatchObject({
    code: "set_menu.bill_holds_set_menus",
  });

  expect(await order(id)).toEqual(before);
  expect(await shape(id)).toEqual(DAILY());
});

it("switches a takeaway counter order whose dishes are a la carte back to eat in", async () => {
  const id = await counterOrder("takeaway", "Soup");
  const { revision } = await order(id);

  expect(await switchTo(id, "eat_in")).toBe(revision + 1);

  expect(await shape(id)).toEqual([{ what: spec.productIds.Soup, role: null, total: 600 }]);
});

it("groups an eat-in counter order's Soup and Hake into a Daily when it is seated at a table", async () => {
  const id = await counterOrder("eat_in", "Soup", "Hake");
  expect(await shape(id)).toEqual(A_LA_CARTE());
  const tableId = await venue.table(randomUUID());

  await inTx(venue, (tx) =>
    moveBill(
      tx,
      venue.cfg,
      id,
      { tableId },
      {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        partyId: null,
        otherPartyId: null,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      },
    ),
  );

  expect(await shape(id)).toEqual(DAILY());
});

const SOUP_A_LA_CARTE = () => [{ what: spec.productIds.Soup, role: null, total: 600 }];

/** Runs `act` while a 4.00 set menu listing Soup is on sale on the tables' menu. */
async function whileLateSoupMenuOnSale(act: () => Promise<void>): Promise<void> {
  const late = await inTx(venue, async (tx) => {
    const { id: menuId } = await createMenu(tx, {
      kind: "set_menu",
      name: `Late menu ${randomUUID()}`,
      setPrice: "4.00",
    });
    await addSetMenuDishes(tx, menuId, [
      { productId: spec.productIds.Soup, excludedVariantIds: [] },
    ]);
    const root = await requireMenuRoot(tx, venue.tables.menuId);
    const member = await addMember(tx, root, { kind: "set_menu", menuId });
    await publishWorkingMenu(tx, venue.tables.menuId);
    return { root, member };
  });
  try {
    await act();
  } finally {
    await inTx(venue, async (tx) => {
      await removeMember(tx, late.root, late.member.id);
      await publishWorkingMenu(tx, venue.tables.menuId);
    });
  }
}

const recordedSetMenus = (id: string) => inTx(venue, (tx) => readBillSetMenuVersions(tx, id));

it("records no set menu that went on sale after a table bill's dishes were ordered when it is switched to takeaway", async () => {
  const [table] = await venue.db
    .select({ departmentId: floorZones.departmentId, dining: departments.dining })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(eq(floorZones.id, venue.tables.zoneId));
  const { tabId: id } = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await inTx(venue, (tx) =>
    addPortionRound(tx, venue.cfg, id, [{ menuItemId: ordinary.Soup, quantity: "1" }]),
  );
  expect(await shape(id)).toEqual(SOUP_A_LA_CARTE());
  const recorded = await recordedSetMenus(id);
  await inTx(venue, (tx) =>
    setDepartmentSalePolicyField(tx, table!.departmentId, "dining", "till_choice"),
  );
  try {
    await whileLateSoupMenuOnSale(async () => {
      const { revision } = await order(id);
      await inTx(venue, async (tx) =>
        switchOrderDining(tx, id, "takeaway", revision, {
          operatorId: OPERATOR,
          expectedEdit: await readBillEditState(tx, id),
        }),
      );

      expect(await order(id)).toMatchObject({ dining: "takeaway" });
      expect(await shape(id)).toEqual(SOUP_A_LA_CARTE());
      expect(await recordedSetMenus(id)).toEqual(recorded);
    });
  } finally {
    await inTx(venue, (tx) =>
      setDepartmentSalePolicyField(tx, table!.departmentId, "dining", table!.dining),
    );
  }
});

it("records no set menu that went on sale after a takeaway counter order's dishes were ordered when it is seated at a table", async () => {
  const id = await counterOrder("takeaway", "Soup");
  expect(await shape(id)).toEqual(SOUP_A_LA_CARTE());
  const recorded = await recordedSetMenus(id);
  const tableId = await venue.table(randomUUID());

  await whileLateSoupMenuOnSale(async () => {
    await inTx(venue, (tx) =>
      moveBill(
        tx,
        venue.cfg,
        id,
        { tableId },
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          partyId: null,
          otherPartyId: null,
          allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        },
      ),
    );

    expect(await shape(id)).toEqual(SOUP_A_LA_CARTE());
    expect(await recordedSetMenus(id)).toEqual(recorded);
  });
});
