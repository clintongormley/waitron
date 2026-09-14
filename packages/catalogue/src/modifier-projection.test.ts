import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  asAppUser,
  optionGroupItems,
  optionGroups,
  productOptionGroups,
  withTenant,
} from "@waitron/db";
import { createModifier } from "./modifiers.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createMenuItem,
  createMenuSection,
  createProduct,
  listAvailableProducts,
  listMenuOffers,
  setMenuItemOptionGroups,
} from "./operations.js";
import { seedLegacySellingUnits, seedVenue, useCatalogueDb } from "../test/fixtures.js";

// PGlite verifies publication/projection; definition-publication locking races use real PostgreSQL.
const suite = useCatalogueDb();

it("publishes attached text and yes-no modifiers without requiring choice rows", async () => {
  const { tenantId, locationId } = await seedVenue(suite.db);
  await seedLegacySellingUnits(suite.db, tenantId);
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    await assignCatalogueToLocation(tx, locationId, menu.id);
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Coffee" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const text = await createModifier(
      tx,
      tenantId,
      { type: "text", name: { en: "Message" }, available: true },
      "en",
    );
    const yesNo = await createModifier(
      tx,
      tenantId,
      {
        type: "yes-no",
        name: { en: "Ice" },
        available: true,
        defaultValue: false,
      },
      "en",
    );
    await tx.insert(productOptionGroups).values(
      [text, yesNo].map((modifier, sort) => ({
        tenantId,
        productId: product.id,
        groupId: modifier.id,
        sort,
      })),
    );
    await createMenuItem(tx, tenantId, {
      menuId: menu.id,
      productId: product.id,
      sectionId: section.id,
      grossPrice: "2.00",
    });
    expect((await listMenuOffers(tx, tenantId, [menu.id]))[0]!.modifiers).toEqual([text, yesNo]);
    expect((await listAvailableProducts(tx, locationId)).products[0]!.modifiers).toEqual([
      text,
      yesNo,
    ]);
  });
});

it("projects only published available choices, clears excluded defaults, and keeps empty required modifiers", async () => {
  const { tenantId } = await seedVenue(suite.db);
  await seedLegacySellingUnits(suite.db, tenantId);
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Coffee" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const omittedId = randomUUID();
    const chosenId = randomUUID();
    const options = await createModifier(
      tx,
      tenantId,
      {
        type: "options",
        name: { en: "Milk" },
        available: true,
        defaultChoiceId: omittedId,
        choices: [
          { id: omittedId, name: { en: "Milk" }, available: true },
          { id: chosenId, name: { en: "Oat" }, available: true },
        ],
      },
      "en",
    );
    const extraId = randomUUID();
    const extras = await createModifier(
      tx,
      tenantId,
      {
        type: "extras",
        name: { en: "Extras" },
        available: true,
        required: false,
        maxTotalQuantity: null,
        choices: [
          {
            id: extraId,
            name: { en: "Shot" },
            available: true,
            priceDelta: "1.00",
            maxQuantity: 3,
            preselected: true,
            vatClass: "general",
          },
        ],
      },
      "en",
    );
    await tx.insert(productOptionGroups).values(
      [options, extras].map((modifier, sort) => ({
        tenantId,
        productId: product.id,
        groupId: modifier.id,
        sort,
      })),
    );
    const item = await createMenuItem(tx, tenantId, {
      menuId: menu.id,
      productId: product.id,
      sectionId: section.id,
      grossPrice: "2.00",
    });
    await expect(
      setMenuItemOptionGroups(tx, tenantId, item.id, [
        { groupId: options.id, options: [{ optionId: chosenId, priceDelta: "0.00" }] },
        { groupId: extras.id, options: [{ optionId: extraId, priceDelta: "-0.75" }] },
      ]),
    ).rejects.toMatchObject({ code: "modifier.invalid" });
    await expect(
      setMenuItemOptionGroups(tx, tenantId, item.id, [
        { groupId: options.id, options: [{ optionId: chosenId, priceDelta: "1.00" }] },
      ]),
    ).rejects.toMatchObject({ code: "modifier.invalid" });
    // The per-item price obeys the same ten-whole-digit limit as a modifier's own price.
    await expect(
      setMenuItemOptionGroups(tx, tenantId, item.id, [
        { groupId: options.id, options: [{ optionId: chosenId, priceDelta: "0.00" }] },
        { groupId: extras.id, options: [{ optionId: extraId, priceDelta: "10000000000.00" }] },
      ]),
    ).rejects.toMatchObject({ code: "modifier.invalid", params: { field: "priceDelta" } });
    await setMenuItemOptionGroups(tx, tenantId, item.id, [
      { groupId: options.id, options: [{ optionId: chosenId, priceDelta: "0.00" }] },
      { groupId: extras.id, options: [{ optionId: extraId, priceDelta: "9999999999.99" }] },
    ]);
    await setMenuItemOptionGroups(tx, tenantId, item.id, [
      { groupId: options.id, options: [{ optionId: chosenId, priceDelta: "0.00" }] },
      { groupId: extras.id, options: [{ optionId: extraId, priceDelta: "0.75" }] },
    ]);
    let projected = (await listMenuOffers(tx, tenantId, [menu.id]))[0]!.modifiers;
    expect(projected[0]).toMatchObject({
      type: "options",
      defaultChoiceId: null,
      choices: [{ id: chosenId }],
    });
    expect(projected[1]).toMatchObject({
      type: "extras",
      maxTotalQuantity: null,
      choices: [{ id: extraId, priceDelta: "0.75", vatClass: "general", preselected: true }],
    });
    await tx
      .update(optionGroupItems)
      .set({ active: false })
      .where(eq(optionGroupItems.id, chosenId));
    await tx.update(optionGroups).set({ active: false }).where(eq(optionGroups.id, extras.id));
    projected = (await listMenuOffers(tx, tenantId, [menu.id]))[0]!.modifiers;
    // Deactivating the options choice empties that group's choices; deactivating the whole extras
    // group no longer hides it, because a non-yes-no modifier cannot be turned off as a whole.
    expect(projected).toEqual([
      { ...options, choices: [], defaultChoiceId: null },
      {
        ...extras,
        choices: [
          {
            id: extraId,
            name: { en: "Shot" },
            available: true,
            dietaryEffect: { invalidates: [] },
            priceDelta: "0.75",
            maxQuantity: 3,
            preselected: true,
            vatClass: "general",
          },
        ],
      },
    ]);
  });
});
