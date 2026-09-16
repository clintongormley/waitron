import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, optionGroups, withTenant, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { seedLegacySellingUnits, seedVenue } from "../test/fixtures.js";
import { menuItemOptionGroups, menuItemOptions } from "./schema/menu.js";
import { createModifier } from "./modifiers.js";
import {
  createCatalogue,
  createMenuItem,
  createMenuSection,
  createProduct,
  setMenuItemOptionGroups,
  setProductOptionGroups,
} from "./operations.js";

// A real backend is used for the RESTRICT→CASCADE control described at the delete below: before
// migration 0012 this same delete threw a foreign-key RESTRICT violation, watched red on a real
// container. The delete runs as app_user (the deployment role), exactly as production's
// deleteModifier does — no owner privilege is needed, so this proves the app_user cascade itself.
const suite = useTemplateDb({ template: "core" });

function app<T>(
  db: Database,
  tenantId: TenantId,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}

it("cascades an option_groups delete through the published menu link rows", async () => {
  const venue = await seedVenue(suite.admin);
  const { tenantId } = venue;
  await seedLegacySellingUnits(suite.admin, tenantId);

  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const { groupId, optionId } = await app(suite.admin, tenantId, async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const item = await createMenuItem(tx, tenantId, {
      menuId: menu.id,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "2.00",
    });
    const modifier = await createModifier(
      tx,
      tenantId,
      { type: "options", name: { en: "Milk" }, choices: [choice], defaultChoiceId: choice.id },
      "en",
    );
    // Attach to the product, then publish the group on the menu item with one priced option — this
    // writes the menu_item_option_groups row and the menu_item_options row the delete must reach.
    await setProductOptionGroups(tx, tenantId, product.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, tenantId, item.id, [
      { groupId: modifier.id, options: [{ optionId: choice.id, priceDelta: "0" }] },
    ]);
    return { groupId: modifier.id, optionId: choice.id };
  });

  // Sanity: the link rows exist before the delete.
  const linksBefore = await suite.admin
    .select()
    .from(menuItemOptionGroups)
    .where(
      and(eq(menuItemOptionGroups.tenantId, tenantId), eq(menuItemOptionGroups.groupId, groupId)),
    );
  const optionsBefore = await suite.admin
    .select()
    .from(menuItemOptions)
    .where(and(eq(menuItemOptions.tenantId, tenantId), eq(menuItemOptions.optionId, optionId)));
  expect(linksBefore).toHaveLength(1);
  expect(optionsBefore).toHaveLength(1);

  // Delete the option group as app_user (the deployment role), the same path production's
  // deleteModifier takes, and directly — bypassing only the application's in-use guard, not the role.
  // Before migration 0012 both menu foreign keys were RESTRICT: this same delete threw SQLSTATE
  // 23001 (foreign-key RESTRICT violation), watched red on 2026-09-14 before the flip. That red run
  // is the control — it proves the delete reaches the constraint rather than a no-op.
  await app(suite.admin, tenantId, (tx) =>
    tx.execute(sql`delete from option_groups where tenant_id = ${tenantId} and id = ${groupId}`),
  );

  const groupsAfter = await suite.admin
    .select()
    .from(optionGroups)
    .where(and(eq(optionGroups.tenantId, tenantId), eq(optionGroups.id, groupId)));
  const linksByGroup = await suite.admin
    .select()
    .from(menuItemOptionGroups)
    .where(
      and(eq(menuItemOptionGroups.tenantId, tenantId), eq(menuItemOptionGroups.groupId, groupId)),
    );
  const optionsAfter = await suite.admin
    .select()
    .from(menuItemOptions)
    .where(and(eq(menuItemOptions.tenantId, tenantId), eq(menuItemOptions.optionId, optionId)));

  expect(groupsAfter).toEqual([]);
  expect(linksByGroup).toEqual([]);
  expect(optionsAfter).toEqual([]);
});
