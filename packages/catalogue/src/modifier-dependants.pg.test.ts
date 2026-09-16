import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  asAppUser,
  withTenant,
  workingOrders,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
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
async function app<T>(tenantId: string, action: (tx: Transaction) => Promise<T>) {
  return withTenant(suite.admin, tenantId, async (tx) => {
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

it("reports products, menus and the open-order count a delete would touch", async () => {
  const { tenantId, tillId, nodeId } = await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const seeded = await app(tenantId, async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const productP = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const productQ = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Tea",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const itemQ = await createMenuItem(tx, tenantId, {
      menuId: menu.id,
      sectionId: section.id,
      productId: productQ.id,
      grossPrice: "2.00",
    });
    const modifier = await createModifier(tx, tenantId, optionsGroup(choice), "en");
    // P carries the group only as an attachment; Q carries it as a published menu offer. Publishing
    // on Q's item requires the group attached to Q too, so both products appear as dependants.
    await setProductOptionGroups(tx, tenantId, productP.id, [modifier.id]);
    await setProductOptionGroups(tx, tenantId, productQ.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, tenantId, itemQ.id, [
      { groupId: modifier.id, options: [{ optionId: choice.id, priceDelta: "0" }] },
    ]);
    const [order] = await tx
      .insert(workingOrders)
      .values({ tenantId, tillId, nodeId, orderNumber: 1 })
      .returning();
    await tx.insert(workingOrderLines).values({
      tenantId,
      workingOrderId: order!.id,
      productId: productQ.id,
      lineNo: 1,
      name: "Tea",
      descriptions: { "en-GB": "Tea" },
      optionGroupItemId: choice.id,
      quantity: "1",
      unitPrice: "1.82",
      unitPriceGross: "2.00",
      vatRate: "10.00",
      lineTotal: "2.00",
    });
    return { modifierId: modifier.id, productP, productQ, itemQ };
  });
  const dependants = await app(tenantId, (tx) =>
    modifierDependants(tx, tenantId, seeded.modifierId),
  );
  expect(dependants.products.map((p) => p.id)).toContain(seeded.productP.id);
  expect(dependants.products.map((p) => p.id)).toContain(seeded.productQ.id);
  expect(dependants.products).toHaveLength(2);
  expect(dependants.products.map((p) => p.name)).toContain("Coffee");
  expect(dependants.menus.map((m) => m.id)).toContain(seeded.itemQ.id);
  expect(dependants.menus.map((m) => m.name)).toContain("Tea");
  expect(dependants.orders).toBe(1);
});

it("404s a modifier of another tenant", async () => {
  const { tenantId } = await seedVenue(suite.admin);
  const { tenantId: otherTenantId } = await seedVenue(suite.admin);
  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const modifierId = await app(tenantId, async (tx) => {
    const modifier = await createModifier(tx, tenantId, optionsGroup(choice), "en");
    return modifier.id;
  });
  await expect(
    app(otherTenantId, (tx) => modifierDependants(tx, otherTenantId, modifierId)),
  ).rejects.toMatchObject({ code: "modifier.not_found" });
});
