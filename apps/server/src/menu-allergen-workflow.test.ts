import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getHeldOrder } from "./working-order-held-read.js";
import { parkOrder } from "./working-order-open.js";
import { setupPartyVenue, inTx } from "./testing/party-venue.js";
import { republishMenus } from "./testing/publish-menu.js";
import { describe, expect, it } from "vitest";
import { sectionMembers, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignMenuToVenue,
  createMenu,
  createCategory,
  createProduct,
  listAvailableProducts,
  updateProduct,
  setProductVariants,
  createExtraList,
  writeProductModifiers,
  removeMember,
} from "@waitron/menu";
import type { ProductAllergens } from "@waitron/menu";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

describe("menu allergen workflows", () => {
  it("keeps unreviewed, reviewed-none and specific allergen kinds distinct in the till read", async () => {
    await seedVenue(suite.db, { timeZone: "Europe/Madrid", invoiceLocales: ["en-GB"] });
    await withTransaction(suite.db, async (tx) => {
      const menu = await createMenu(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: "Food" });
      const desserts = await createCategory(tx, { name: "Desserts" });
      const samples: {
        name: string;
        categoryId: string;
        unitPrice: string;
        allergens?: ProductAllergens;
      }[] = [
        {
          name: "Wheat pastry",
          categoryId: food.id,
          unitPrice: "3.50",
          allergens: { gluten: { kinds: ["wheat"] }, eggs: {} },
        },
        {
          name: "House cake",
          categoryId: desserts.id,
          unitPrice: "4.20",
          allergens: { milk: {}, nuts: { kinds: ["almonds"] } },
        },
        { name: "Garden salad", categoryId: food.id, unitPrice: "5.90", allergens: {} },
        { name: "Daily soup", categoryId: food.id, unitPrice: "4.50" },
      ];
      for (const sample of samples) {
        await createProduct(tx, {
          pricingUnit: "each",
          vatClass: "reduced",
          ...sample,
        });
      }
      await assignMenuToVenue(tx, menu.id);
    });
    const available = await withTransaction(suite.db, (tx) => listAvailableProducts(tx));
    expect(
      Object.fromEntries(available.products.map((product) => [product.name, product.allergens])),
    ).toEqual({
      "Wheat pastry": { gluten: { kinds: ["wheat"] }, eggs: {} },
      "House cake": { milk: {}, nuts: { kinds: ["almonds"] } },
      "Garden salad": {},
      "Daily soup": null,
    });
  });
});

it("retrieves held product, variant and extra declarations outside current offers, retaining commercial snapshots", async () => {
  const v = await setupPartyVenue(suite.db);
  const parentId = v.productId("Burger");
  const plainId = v.productId("Water");
  const { variantId, extraId, listId } = await inTx(v, async (tx) => {
    await updateProduct(tx, parentId, {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
    });
    await updateProduct(tx, plainId, {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
    });
    const [variant] = await setProductVariants(
      tx,
      parentId,
      [
        {
          name: "Large",
          customerName: { en: "Guest large" },
          kitchenName: "LARGE",
          image: null,
          unitPrice: "15.00",
          available: true,
        },
      ],
      "en",
    );
    const extra = await createProduct(tx, {
      name: "Lemon",
      unitPrice: "1.00",
      vatClass: "reduced",
      pricingUnit: "each",
      categoryId: null,
      allergens: { sesame: {} },
    });
    const list = await createExtraList(
      tx,
      { name: "Extras", minPicks: 0, maxPicks: 1, items: [{ productId: extra.id, price: "1.00" }] },
      "en",
    );
    await writeProductModifiers(tx, plainId, [{ kind: "extras", id: list.id }]);
    await republishMenus(tx);
    return { variantId: variant!.id, extraId: extra.id, listId: list.id };
  });
  const id = randomUUID();
  await parkOrder({ db: suite.db }, v.cfg, {
    id,
    zoneId: v.tables.zoneId,
    lines: [
      {
        menuItemId: v.item("Water"),
        quantity: "1",
        extras: [{ listId, picks: [{ productId: extraId, quantity: 1 }] }],
      },
      { menuItemId: v.item("Burger"), variantId, quantity: "1" },
    ],
  });
  await inTx(v, async (tx) => {
    await updateProduct(tx, parentId, {
      allergens: null,
      dietaryDeclarations: ["vegan"],
      dietOverride: { vegan: "yes" },
      unitPrice: "99.00",
    });
    await updateProduct(tx, plainId, {
      allergens: null,
      dietaryDeclarations: ["vegan"],
      dietOverride: { vegan: "yes" },
      unitPrice: "99.00",
    });
    await updateProduct(tx, variantId, { allergens: { eggs: {} }, dietOverride: { vegan: "no" } });
    await updateProduct(tx, extraId, { allergens: {}, dietaryDeclarations: ["vegan"] });
    for (const member of await tx
      .select()
      .from(sectionMembers)
      .where(inArray(sectionMembers.productId, [parentId, plainId])))
      await removeMember(tx, member.sectionId, member.id);
    await republishMenus(tx);
  });
  const held = await getHeldOrder({ db: suite.db }, id);
  expect(held.lines[0]!.product).toMatchObject({
    name: "Water",
    unitPrice: "2.00",
    allergens: null,
    dietaryDeclarations: ["vegan"],
    dietOverride: { vegan: "yes" },
    diet: { vegan: "yes" },
  });
  expect(held.lines[1]!.product).toMatchObject({
    name: "Burger",
    unitPrice: "15.00",
    allergens: { eggs: {} },
    dietaryDeclarations: ["vegan"],
    dietOverride: { vegan: "no" },
    diet: { vegan: "no" },
  });
  expect(held.lines[0]!.extras).toMatchObject([
    {
      name: "Lemon",
      price: "1.00",
      addAllergens: {},
      suitableFor: ["vegan", "vegetarian", "no_meat", "no_fish"],
    },
  ]);
});
