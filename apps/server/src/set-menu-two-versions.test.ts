import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  billSetMenuCopies,
  menuReleases,
  menuVersions,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addSetMenuDishes,
  loadSectionGraph,
  menuItems,
  removeMember,
  requireMenuRoot,
  updateMenuDetails,
  updateProduct,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import { insertPartyBill } from "./parties.js";
import { readBillsSetMenus } from "./set-menu-bill.js";
import { regroupBills } from "./set-menu-regroup.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { commandFor, inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  sendSpecDishes,
  setupSetMenuSpecVenue,
  specRows,
  type SpecSetMenu,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
/** Daily as last published: the cases share one database. */
let liveDaily: SpecSetMenu;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    liveDaily = spec.daily;
  },
});

function republishDaily(change: {
  setPrice: string;
  addSeaBass?: boolean;
  removeSeaBass?: boolean;
}) {
  const { venue, daily, productIds } = spec;
  const seaBass = productIds["Sea bass"];
  return inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: change.setPrice });
    const items = { ...daily.items };
    if (change.addSeaBass === true) {
      await addSetMenuDishes(tx, daily.menuId, [{ productId: seaBass, excludedVariantIds: [] }]);
      const [item] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.menuId, daily.menuId), eq(menuItems.productId, seaBass)));
      items["Sea bass"] = item!.id;
    }
    if (change.removeSeaBass === true) {
      const root = await requireMenuRoot(tx, daily.menuId);
      const member = (await loadSectionGraph(tx))
        .children(root)
        .find(({ ref }) => ref.kind === "product" && ref.productId === seaBass);
      if (member !== undefined) await removeMember(tx, root, member.id);
    }
    liveDaily = { ...daily, items, versionId: await publishWorkingMenu(tx, venue.tables.menuId) };
    return liveDaily;
  });
}

/** Reads the bill's set menus, counting the reads of the order its versions were published in. */
async function readWatchingPublishOrder(billId: string) {
  return inTx(spec.venue, async (tx: Transaction) => {
    const select = vi.spyOn(tx, "select");
    const read = (await readBillsSetMenus(tx, [billId])).get(billId)!;
    const publishOrderReads = select.mock.calls.filter(
      ([fields]) => (fields as Record<string, unknown> | undefined)?.id === menuVersions.id,
    ).length;
    select.mockRestore();
    return { read, publishOrderReads };
  });
}

/** The versions of Daily the bill records. */
async function recordedDailies(billId: string) {
  const rows = await spec.venue.db
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, billId));
  return new Set(
    rows.filter(({ menuId }) => menuId === spec.daily.menuId).map(({ versionId }) => versionId),
  );
}

async function setMenuRows(billId: string) {
  return (await specRows(spec, billId))
    .filter(({ setMenuRole }) => setMenuRole === "set_menu")
    .map(({ id, setMenuVersionId, unitPriceGross }) => ({ id, setMenuVersionId, unitPriceGross }));
}

/** A party whose first bill holds a Daily of the live version and whose second bill holds a Daily
 *  republished as `change` says, or by `change` itself. */
async function partyWithTwoDailies(
  change: Parameters<typeof republishDaily>[0] | ((older: SpecSetMenu) => Promise<SpecSetMenu>),
) {
  const { venue } = spec;
  const olderDaily = liveDaily;
  const first = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await sendSpecDishes(spec, first, [
    { dish: "Soup", from: olderDaily },
    { dish: "Hake", from: olderDaily },
  ]);
  const newerDaily =
    typeof change === "function" ? await change(olderDaily) : await republishDaily(change);
  const second = {
    partyId: first.partyId,
    tabId: await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, first.partyId)),
  };
  await sendSpecDishes(spec, second, [
    { dish: "Soup", from: newerDaily },
    { dish: "Hake", from: newerDaily },
  ]);
  return {
    first,
    second,
    older: olderDaily.versionId,
    newer: newerDaily.versionId,
    newerDaily,
  };
}

it("keeps both versions of Daily when a Daily moves to a bill recording another version (D26)", async () => {
  const { venue, daily } = spec;
  const { first, second, older, newer } = await partyWithTwoDailies({
    setPrice: "15.00",
    addSeaBass: true,
  });
  const [moving] = await setMenuRows(first.tabId);
  expect(moving).toMatchObject({ setMenuVersionId: older, unitPriceGross: 1400 });
  expect(await setMenuRows(second.tabId)).toMatchObject([
    { setMenuVersionId: newer, unitPriceGross: 1500 },
  ]);

  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );

  expect(await recordedDailies(second.tabId)).toEqual(new Set([older, newer]));
  expect(await setMenuRows(second.tabId)).toContainEqual(moving);

  const { read, publishOrderReads } = await readWatchingPublishOrder(second.tabId);
  expect(read.setMenus.recorded[daily.menuId]).toBe(newer);
  expect(publishOrderReads).toBe(0);
  const copyOfRow = (lineId: string) => {
    const { copyId } = read.setMenus.setMenus.find((row) => row.lineId === lineId)!;
    return read.setMenus.copies.find(({ id }) => id === copyId)!;
  };
  expect(copyOfRow(moving!.id)).toMatchObject({ versionId: older });
  expect(read.setMenuCopies.find(({ key }) => key === copyOfRow(moving!.id).id)).toMatchObject({
    terms: { price: "14.00" },
  });
});

it("records no third version for a dish ordered after a republish on a bill holding two", async () => {
  const { venue } = spec;
  const { first, second, older, newer, newerDaily } = await partyWithTwoDailies({
    setPrice: "16.50",
  });
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );
  await republishDaily({ setPrice: "17.00" });

  await sendSpecDishes(spec, second, [{ dish: "Soup", from: newerDaily }]);

  expect(await recordedDailies(second.tabId)).toEqual(new Set([older, newer]));
});

it("groups a Daily rung on a bill holding two versions under the cheaper one (D26)", async () => {
  const { venue } = spec;
  const older = liveDaily;
  const { first, second, newerDaily } = await partyWithTwoDailies({ setPrice: "18.00" });
  const olderCents = (await setMenuRows(first.tabId))[0]!.unitPriceGross;
  expect(olderCents).toBeLessThan(1800);
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );

  await sendSpecDishes(spec, second, [
    { dish: "Soup", from: newerDaily },
    { dish: "Hake", from: newerDaily },
  ]);

  expect(await setMenuRows(second.tabId)).toEqual(
    Array.from({ length: 3 }, () => ({
      id: expect.any(String),
      setMenuVersionId: older.versionId,
      unitPriceGross: olderCents,
    })),
  );
});

function dailyCopy(versionId: string) {
  return inTx(spec.venue, async (tx) => {
    const [copy] = await serveRecordedSetMenus(tx, [{ menuId: spec.daily.menuId, versionId }]);
    return copy!;
  });
}

it("names the version published last as newest when a dish's rename leaves Daily's own time alone (D26)", async () => {
  const { venue, daily, productIds } = spec;
  /** Renames Hake and republishes until the new copy's key sorts below the older one's, so a
   *  choice by Daily's own change time, then by key, would name the older version. */
  const renameHake = async (older: SpecSetMenu) => {
    const olderCopy = await dailyCopy(older.versionId);
    for (let attempt = 1; attempt <= 30; attempt++) {
      const versionId = await inTx(venue, async (tx) => {
        await updateProduct(tx, productIds.Hake, { name: `Hake ${attempt}` });
        return publishWorkingMenu(tx, venue.tables.menuId);
      });
      liveDaily = { ...daily, versionId };
      const newerCopy = await dailyCopy(versionId);
      expect(newerCopy.changedAt).toBe(olderCopy.changedAt);
      if (newerCopy.key < olderCopy.key) return liveDaily;
    }
    throw new Error("no rename gave the newer copy the lower key");
  };
  // Start from a copy whose hash sorts in the upper half, so each rename below has at least an
  // even chance of sorting under it.
  for (let attempt = 1; ; attempt++) {
    if ((await dailyCopy(liveDaily.versionId)).key.slice(-64) >= "8") break;
    if (attempt === 30) throw new Error("no rename gave Daily a key in the upper half");
    const versionId = await inTx(venue, async (tx) => {
      await updateProduct(tx, productIds.Hake, { name: `Hake first ${attempt}` });
      return publishWorkingMenu(tx, venue.tables.menuId);
    });
    liveDaily = { ...daily, versionId };
  }
  const { first, second, newer } = await partyWithTwoDailies(renameHake);
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );

  const { read, publishOrderReads } = await readWatchingPublishOrder(second.tabId);
  expect(read.setMenus.recorded[daily.menuId]).toBe(newer);
  expect(publishOrderReads).toBe(1);
});

it("names the copy changed last as newest even when the other version's release goes live later (D26)", async () => {
  const { venue, daily } = spec;
  const { first, second, older, newer } = await partyWithTwoDailies({ setPrice: "15.75" });
  expect((await dailyCopy(newer)).changedAt > (await dailyCopy(older)).changedAt).toBe(true);
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );
  const activatesAt = async (versionId: string) =>
    (
      await venue.db
        .select({ at: menuReleases.activatesAt })
        .from(menuReleases)
        .where(eq(menuReleases.versionId, versionId))
    )[0]!.at;
  const olderAt = await activatesAt(older);
  const setOlderAt = (at: Date) =>
    venue.db.update(menuReleases).set({ activatesAt: at }).where(eq(menuReleases.versionId, older));
  // As if the older copy came from another full menu whose release was scheduled to go live later.
  await setOlderAt(new Date((await activatesAt(newer)).getTime() + 3_600_000));
  try {
    const read = (await inTx(venue, (tx) => readBillsSetMenus(tx, [second.tabId]))).get(
      second.tabId,
    )!;
    expect(read.setMenus.recorded[daily.menuId]).toBe(newer);
  } finally {
    await setOlderAt(olderAt);
  }
});

it("groups a Sea bass rung on a bill holding two versions under the newer one, the only one listing it (D26)", async () => {
  const { venue, productIds } = spec;
  await republishDaily({ setPrice: "14.00", removeSeaBass: true });
  const { first, second, older, newer, newerDaily } = await partyWithTwoDailies({
    setPrice: "15.00",
    addSeaBass: true,
  });
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );

  await sendSpecDishes(spec, second, [
    { dish: "Soup", from: newerDaily },
    { dish: "Sea bass", from: newerDaily },
  ]);

  const rows = await specRows(spec, second.tabId);
  const seaBass = rows.find(({ productId }) => productId === productIds["Sea bass"])!;
  expect(rows.find(({ id }) => id === seaBass.setMenuLineId)).toMatchObject({
    setMenuVersionId: newer,
    unitPriceGross: 1500,
  });
  expect(
    (await setMenuRows(second.tabId)).map(({ setMenuVersionId, unitPriceGross }) => [
      setMenuVersionId,
      unitPriceGross,
    ]),
  ).toEqual(
    expect.arrayContaining([
      [older, 1400],
      [older, 1400],
      [newer, 1500],
    ]),
  );
  expect(await setMenuRows(second.tabId)).toHaveLength(3);
});

it("brings only the version listing it when a dish moves alone from a bill holding two (D26)", async () => {
  const { venue, productIds } = spec;
  await republishDaily({ setPrice: "14.00", removeSeaBass: true });
  const { first, second, older, newer, newerDaily } = await partyWithTwoDailies({
    setPrice: "15.00",
    addSeaBass: true,
  });
  const [moving] = await setMenuRows(first.tabId);
  const command = await commandFor(venue, first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, first.tabId, second.tabId, [moving!.id], command),
  );
  await sendSpecDishes(spec, second, [{ dish: "Sea bass", from: newerDaily }]);
  expect(await recordedDailies(second.tabId)).toEqual(new Set([older, newer]));
  const seaBass = (await specRows(spec, second.tabId)).find(
    ({ productId }) => productId === productIds["Sea bass"],
  )!;

  const moveCommand = await commandFor(venue, first.partyId);
  const { billId: third } = await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, second.tabId, null, [seaBass.id], moveCommand),
  );

  expect(await recordedDailies(third)).toEqual(new Set([newer]));
  await sendSpecDishes(spec, { partyId: first.partyId, tabId: third }, [
    { dish: "Soup", from: newerDaily },
    { dish: "Soup", from: newerDaily },
    { dish: "Hake", from: newerDaily },
  ]);
  expect(await setMenuRows(third)).toEqual([
    expect.objectContaining({ setMenuVersionId: newer, unitPriceGross: 1500 }),
    expect.objectContaining({ setMenuVersionId: newer, unitPriceGross: 1500 }),
  ]);
});

/** A party's two Dailies moved onto its second bill, the second ordered after `change`. */
async function mergedDailies(change: (older: SpecSetMenu) => Promise<SpecSetMenu>) {
  const { venue } = spec;
  const party = await partyWithTwoDailies(change);
  const [moving] = await setMenuRows(party.first.tabId);
  const command = await commandFor(venue, party.first.partyId);
  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, party.first.tabId, party.second.tabId, [moving!.id], command),
  );
  return party;
}

/** What the bill shows, with every id that differs between two bills of the same order left out. */
async function whatTheBillShows(billId: string) {
  const rows = await specRows(spec, billId);
  const menuRows = rows.filter(({ setMenuRole }) => setMenuRole === "set_menu");
  const menuIndex = new Map(menuRows.map(({ id }, index) => [id, index]));
  const [{ exact }] = await spec.venue.db
    .select({ exact: workingOrders.setMenusExact })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const read = (await inTx(spec.venue, (tx) => readBillsSetMenus(tx, [billId]))).get(billId)!;
  const { copies, recorded, setMenus, dishes } = read.setMenus;
  const offer = (copyId: string) => {
    const copy = copies.find(({ id }) => id === copyId)!;
    const { setMenuId, name, priceCents, lines } = copy;
    return { setMenuId, name, priceCents, lines, dishes: copy.dishes };
  };
  return {
    exact,
    total: rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0),
    grouping: rows.map(({ name, setMenuRole, setMenuLineId, setMenuPlace, unitPriceGross }) => ({
      name,
      setMenuRole,
      inSetMenu: setMenuLineId === null ? null : menuIndex.get(setMenuLineId),
      setMenuPlace,
      unitPriceGross,
    })),
    till: {
      exact: read.setMenus.exact,
      setMenus: setMenus.map(({ lineId, copyId }) => ({
        row: menuIndex.get(lineId),
        offer: offer(copyId),
      })),
      dishes: dishes.map(
        ({
          setMenuLineId,
          place,
          productId,
          variantId,
          priceCents,
          countsAsCourseId,
          movable,
        }) => ({
          setMenu: menuIndex.get(setMenuLineId),
          place,
          productId,
          variantId,
          priceCents,
          countsAsCourseId,
          movable,
        }),
      ),
      recorded: Object.fromEntries(
        Object.entries(recorded).map(([menuId, versionId]) => [
          menuId,
          offer(copies.find((copy) => copy.versionId === versionId)!.id),
        ]),
      ),
    },
  };
}

it("shows a bill holding two copies of Daily that differ only in a dish's allergens as one copy (D26)", async () => {
  const { venue, daily, productIds } = spec;
  const control = await mergedDailies((older) => Promise.resolve(older));
  expect(await recordedDailies(control.second.tabId)).toEqual(new Set([control.older]));

  const correctHakeAllergens = async (older: SpecSetMenu) => {
    const versionId = await inTx(venue, async (tx) => {
      await updateProduct(tx, productIds.Hake, { allergens: { fish: {} } });
      return publishWorkingMenu(tx, venue.tables.menuId);
    });
    liveDaily = { ...older, versionId };
    return liveDaily;
  };
  const corrected = await mergedDailies(correctHakeAllergens);
  const [olderCopy, newerCopy] = [
    await dailyCopy(corrected.older),
    await dailyCopy(corrected.newer),
  ];
  expect(newerCopy.key).not.toBe(olderCopy.key);
  expect(newerCopy.terms).toEqual(olderCopy.terms);
  expect(await recordedDailies(corrected.second.tabId)).toEqual(
    new Set([corrected.older, corrected.newer]),
  );

  const shown = await whatTheBillShows(corrected.second.tabId);
  expect(shown).toEqual(await whatTheBillShows(control.second.tabId));
  expect(shown.exact).toBe(true);
  expect(shown.till.setMenus).toHaveLength(2);
  const read = (await inTx(venue, (tx) => readBillsSetMenus(tx, [corrected.second.tabId]))).get(
    corrected.second.tabId,
  )!;
  expect(
    read.setMenuCopies
      .filter(({ menuId }) => menuId === daily.menuId)
      .map(({ key }) => key)
      .sort(),
  ).toEqual([olderCopy.key, newerCopy.key].sort());
  for (const copy of read.setMenuCopies)
    expect(copy.offers.find(({ productId }) => productId === productIds.Hake)).toMatchObject({
      allergens: { fish: {} },
    });

  const attached = await setMenuRows(corrected.second.tabId);
  expect(new Set(attached.map(({ setMenuVersionId }) => setMenuVersionId))).toEqual(
    new Set([corrected.older, corrected.newer]),
  );
  for (let again = 1; again <= 2; again++) {
    expect(await inTx(venue, (tx) => regroupBills(tx, [corrected.second.tabId]))).toEqual(
      new Set(),
    );
    expect(await setMenuRows(corrected.second.tabId)).toEqual(attached);
  }
  expect(await whatTheBillShows(corrected.second.tabId)).toEqual(shown);
  expect(read.setMenus.recorded[daily.menuId]).toBe(corrected.newer);
});
