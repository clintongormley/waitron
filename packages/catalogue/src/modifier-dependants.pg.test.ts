import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { asAppUser, withTransaction, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createModifier, modifierDependants } from "./modifiers.js";
import {
  createCatalogue,
  createMenuItem,
  createMenuSection,
  createProduct,
  setMenuItemOptionGroups,
  setProductOptionGroups,
} from "./operations.js";
import { seedLegacySellingUnits, seedVenue } from "../test/fixtures.js";

// The read runs the same grants as the delete it previews, so it needs the real app_user session.
const suite = useTemplateDb({ template: "core" });
async function app<T>(action: (tx: Transaction) => Promise<T>) {
  return withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}
const name = { en: "Milk" };
const optionsGroup = (choice: {
  id: string;
  name: Record<string, string>;
  available: boolean;
}) => ({
  type: "options" as const,
  name,
  choices: [choice],
  defaultChoiceId: choice.id,
});

it("reports the products and menus a delete would touch", async () => {
  await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin);
  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const seeded = await app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Menu" });
    const section = await createMenuSection(tx, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const productP = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const productQ = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Tea",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const itemQ = await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: productQ.id,
      grossPrice: "2.00",
    });
    const modifier = await createModifier(tx, optionsGroup(choice), "en");
    // P carries the group only as an attachment; Q carries it as a published menu offer. Publishing
    // on Q's item requires the group attached to Q too, so both products appear as dependants.
    await setProductOptionGroups(tx, productP.id, [modifier.id]);
    await setProductOptionGroups(tx, productQ.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, itemQ.id, [
      { groupId: modifier.id, options: [{ optionId: choice.id, priceDelta: "0" }] },
    ]);
    return { modifierId: modifier.id, productP, productQ, itemQ };
  });
  const dependants = await app((tx) => modifierDependants(tx, seeded.modifierId));
  expect(dependants.products.map((p) => p.id)).toContain(seeded.productP.id);
  expect(dependants.products.map((p) => p.id)).toContain(seeded.productQ.id);
  expect(dependants.products).toHaveLength(2);
  expect(dependants.products.map((p) => p.name)).toContain("Coffee");
  expect(dependants.menus.map((m) => m.id)).toContain(seeded.itemQ.id);
  expect(dependants.menus.map((m) => m.name)).toContain("Tea");
  // Always zero: an open order line carries no column that could name a modifier or one of its
  // choices, so nothing can make this anything else (`deleteModifier`, modifiers.ts).
  expect(dependants.orders).toBe(0);
});
