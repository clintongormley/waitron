import { expect, it } from "vitest";
import { orderDraftLines, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProductToMenu,
  readPublishedDeclarations,
  setProductVariants,
  updateProduct,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPartyAllergyView } from "./party-allergy.js";
import { inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  sendSpecDraft,
  setSpecCount,
  setupSetMenuSpecVenue,
  specRows,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

/** Hake's Large variant, and allergens of its own on each of Soup, Hake, Large and Bread. */
async function declareDishes(tx: Transaction, { venue, productIds, bread }: SpecVenue) {
  const [large] = await setProductVariants(
    tx,
    productIds.Hake,
    [
      {
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "20.00",
        available: true,
      },
    ],
    venue.cfg.locale,
  );
  await updateProduct(tx, productIds.Soup, { allergens: { milk: {} } });
  await updateProduct(tx, productIds.Hake, { allergens: { fish: {} } });
  await updateProduct(tx, large!.id, { allergens: { molluscs: {} } });
  await updateProduct(tx, bread.picks[0]!.productId, { allergens: { sesame: {} } });
  return large!.id;
}

it("reads each kind of stored order line's published declarations", async () => {
  const spec = await setupSetMenuSpecVenue(suite.db);
  const { venue, daily, productIds, bread } = spec;
  const breadId = bread.picks[0]!.productId;
  const { large, soupItem, hakeItem, versionId } = await inTx(venue, async (tx) => {
    const large = await declareDishes(tx, spec);
    const menuId = venue.tables.menuId;
    const soup = await addProductToMenu(tx, {
      menuId,
      productId: productIds.Soup,
      grossPrice: "6.00",
    });
    const hake = await addProductToMenu(tx, {
      menuId,
      productId: productIds.Hake,
      grossPrice: "16.00",
    });
    return {
      large,
      soupItem: soup.id,
      hakeItem: hake.id,
      versionId: await publishWorkingMenu(tx, menuId),
    };
  });
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await inTx(venue, (tx) =>
    addTabRound(tx, venue.cfg, bill.tabId, [
      { menuItemId: soupItem, quantity: "1", extras: [bread] },
      { menuItemId: hakeItem, variantId: large, quantity: "1" },
    ]),
  );
  await setSpecCount(spec, bill.tabId, daily, 1);
  const fromDaily = { menuVersionId: versionId, setMenuId: daily.menuId, quantity: "1" };
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    { ...fromDaily, menuItemId: daily.items.Soup!, extras: [bread] },
    { ...fromDaily, menuItemId: daily.items.Hake!, variantId: large },
  );
  await sendSpecDraft(spec, bill.partyId, draft.id);
  await inTx(venue, async (tx) => {
    for (const id of [productIds.Soup, productIds.Hake, large, breadId])
      await updateProduct(tx, id, { allergens: { eggs: {} } });
  });

  const rows = await specRows(spec, bill.tabId);
  const published = await inTx(venue, (tx) => readPublishedDeclarations(tx, rows));
  expect(
    rows.map((row) => ({
      menuItemId: row.menuItemId,
      productId: row.productId,
      listId: row.extraListId,
      menuVersionId: row.menuVersionId,
      allergens: published.get(row.id)?.allergens,
    })),
  ).toEqual(
    [
      [soupItem, productIds.Soup, null, { milk: {} }],
      [soupItem, breadId, bread.listId, { sesame: {} }],
      [hakeItem, large, null, { molluscs: {} }],
      [null, null, null, undefined],
      [daily.items.Soup, productIds.Soup, null, { milk: {} }],
      [daily.items.Soup, breadId, bread.listId, { sesame: {} }],
      [daily.items.Hake, large, null, { molluscs: {} }],
    ].map(([menuItemId, productId, listId, allergens]) => ({
      menuItemId,
      productId,
      listId,
      menuVersionId: menuItemId === null ? null : versionId,
      allergens,
    })),
  );
});

it("names a set-menu draft's dishes and extras as the sent lines are and shows their published allergens", async () => {
  const spec = await setupSetMenuSpecVenue(suite.db);
  const { venue, daily, productIds, bread } = spec;
  const breadId = bread.picks[0]!.productId;
  const { large, versionId } = await inTx(venue, async (tx) => {
    const large = await declareDishes(tx, spec);
    return { large, versionId: await publishWorkingMenu(tx, venue.tables.menuId) };
  });
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, { ...daily, versionId }, 1);
  const fromDaily = { menuVersionId: versionId, setMenuId: daily.menuId, quantity: "1" };
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    { ...fromDaily, menuItemId: daily.items.Soup!, extras: [bread] },
    { ...fromDaily, menuItemId: daily.items.Hake!, variantId: large },
  );
  const dishes = async () =>
    (await inTx(venue, (tx) => readPartyAllergyView(tx, bill.partyId))).dishes.map(
      ({ line, name, allergens, extras }) => [
        line.kind,
        name,
        allergens,
        extras.map((extra) => [extra.name, extra.allergens]),
      ],
    );
  expect(await dishes()).toEqual([
    ["draft", "Soup", { milk: {} }, [["Bread", { sesame: {} }]]],
    ["draft", "Hake (Large)", { molluscs: {} }, []],
  ]);

  await inTx(venue, async (tx) => {
    await updateProduct(tx, productIds.Soup, {
      name: "Broth",
      allergens: { milk: {}, celery: {} },
    });
    await updateProduct(tx, breadId, { allergens: { sesame: {}, soybeans: {} } });
    await publishWorkingMenu(tx, venue.tables.menuId);
    for (const id of [productIds.Soup, large, breadId])
      await updateProduct(tx, id, { allergens: {} });
  });
  const published = [
    ["Soup", { milk: {}, celery: {} }, [["Bread", { sesame: {}, soybeans: {} }]]],
    ["Hake (Large)", { molluscs: {} }, []],
  ];
  expect(await dishes()).toEqual(published.map((dish) => ["draft", ...dish]));
  await sendSpecDraft(spec, bill.partyId, draft.id);
  expect(await dishes()).toEqual(published.map((dish) => ["working", ...dish]));
});

it("reads a set-menu draft naming no known menu version as not reviewed", async () => {
  const spec = await setupSetMenuSpecVenue(suite.db);
  const { venue, daily } = spec;
  const versionId = await inTx(venue, async (tx) => {
    await declareDishes(tx, spec);
    return publishWorkingMenu(tx, venue.tables.menuId);
  });
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, { ...daily, versionId }, 1);
  await saveSetMenuDraft(venue, bill, {
    menuVersionId: versionId,
    setMenuId: daily.menuId,
    menuItemId: daily.items.Soup!,
    quantity: "1",
  });
  await suite.db.update(orderDraftLines).set({ menuVersionId: crypto.randomUUID() });
  const { dishes } = await inTx(venue, (tx) => readPartyAllergyView(tx, bill.partyId));
  expect(dishes.map(({ name, allergens }) => ({ name, allergens }))).toEqual([
    { name: "", allergens: null },
  ]);
});
