import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  asAppUser,
  optionGroups,
  optionGroupItems,
  productOptionGroups,
  withTenant,
  workingOrders,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  createModifier,
  updateModifier,
  deleteModifier,
  listModifiers,
  getModifier,
} from "./modifiers.js";
import { menuItemOptionGroups } from "./schema/menu.js";
import {
  createCatalogue,
  createMenuItem,
  createMenuSection,
  createProduct,
  setMenuItemOptionGroups,
  setProductOptionGroups,
} from "./operations.js";
import { tenantId as brandTenantId } from "@waitron/shared";
import { seedLegacySellingUnits, seedVenue } from "../test/fixtures.js";

// Grants and attachment races need independent, non-superuser PostgreSQL connections.
const suite = useTemplateDb({ template: "core" });
async function app<T>(tenantId: string, action: (tx: Transaction) => Promise<T>) {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}
const name = { en: "Extras" };
const text = { type: "text", name };
const extra = () => ({
  id: randomUUID(),
  name: { en: "Bacon" },
  priceDelta: "1.00",
  maxQuantity: 2,
  preselected: true,
});

it("saves complete definitions as app_user, preserves ids/order, and scopes every operation", async () => {
  const tenant = await seedTenant(suite.admin);
  const other = await seedTenant(suite.admin);
  const choices = [extra(), extra()];
  const created = await app(tenant, (tx) =>
    createModifier(tx, tenant, { type: "extras", name, choices }, "en"),
  );
  expect(created).toMatchObject({
    type: "extras",
    available: true,
    maxTotalQuantity: null,
    choices: choices.map((c) => ({ ...c, available: true })),
  });
  const changed = await app(tenant, (tx) =>
    updateModifier(
      tx,
      tenant,
      created.id,
      { type: "extras", name, choices: [{ ...choices[1], available: false }, choices[0]] },
      "en",
    ),
  );
  expect(changed).toMatchObject({
    choices: [
      { id: choices[1]!.id, preselected: false },
      { id: choices[0]!.id, preselected: true },
    ],
  });
  expect(await app(other, (tx) => listModifiers(tx, other))).toEqual([]);
  await expect(app(other, (tx) => getModifier(tx, other, created.id))).rejects.toMatchObject({
    code: "modifier.not_found",
  });
  await expect(app(other, (tx) => deleteModifier(tx, other, created.id))).rejects.toMatchObject({
    code: "modifier.not_found",
  });
  await app(tenant, (tx) => updateModifier(tx, tenant, created.id, text, "en"));
  expect(await app(tenant, (tx) => getModifier(tx, tenant, created.id))).toEqual({
    id: created.id,
    type: "text",
    name,
    available: true,
  });
  await app(tenant, (tx) => deleteModifier(tx, tenant, created.id));
  expect(await app(tenant, (tx) => listModifiers(tx, tenant))).toEqual([]);
});

it("reads a stored-inactive non-yes/no modifier as available", async () => {
  // The write side forces available:true for text/extras/options (only yes/no is authored), so a
  // stored active=false on such a group is an inconsistency the read must not surface: the
  // projection and validateModifierSelections still offer it, so reading it back as unavailable
  // would hide it from the till widgets and leave an unsatisfiable required selection. Insert the
  // raw inconsistent row as the owner (the contract cannot produce it) and read it back.
  const tenant = await seedTenant(suite.admin);
  const groupId = randomUUID();
  await suite.admin.insert(optionGroups).values({
    tenantId: tenant,
    id: groupId,
    name,
    type: "options",
    active: false,
  });
  await suite.admin
    .insert(optionGroupItems)
    .values({ tenantId: tenant, id: randomUUID(), groupId, name: { en: "Oat" }, active: true });
  const [modifier] = await app(tenant, (tx) => listModifiers(tx, tenant));
  expect(modifier).toMatchObject({ id: groupId, type: "options", available: true });
});

it("rolls back the whole save when a choice belongs to another modifier", async () => {
  const tenant = await seedTenant(suite.admin);
  const choice = extra();
  const original = await app(tenant, (tx) =>
    createModifier(tx, tenant, { type: "extras", name, choices: [choice] }, "en"),
  );
  await expect(
    app(tenant, (tx) =>
      createModifier(
        tx,
        tenant,
        { type: "extras", name: { en: "Bad save" }, choices: [extra(), choice] },
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "modifier.invalid" });
  expect(await app(tenant, (tx) => listModifiers(tx, tenant))).toEqual([original]);
});

it("blocks a type change for attached definitions, but permits other edits", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  const definition = await app(tenant, (tx) => createModifier(tx, tenant, text, "en"));
  await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    const product = await createProduct(tx, brandTenantId(tenant), {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Dish",
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "reduced",
    });
    await setProductOptionGroups(tx, brandTenantId(tenant), product.id, [definition.id]);
  });
  // A product attachment no longer blocks deletion (the delete cascades it away); the delete-detach
  // path is covered separately. A TYPE CHANGE is still refused while attached.
  await expect(
    app(tenant, (tx) =>
      updateModifier(tx, tenant, definition.id, { type: "extras", name, choices: [] }, "en"),
    ),
  ).rejects.toMatchObject({ code: "modifier.in_use" });
  // A modifier cannot be turned off as a whole, so a sent available:false is ignored
  // (forced true) rather than rejected — the edit is still permitted while attached.
  expect(
    await app(tenant, (tx) =>
      updateModifier(tx, tenant, definition.id, { ...text, available: false }, "en"),
    ),
  ).toMatchObject({ available: true });
});

it("serializes deletion behind an attachment write, then cascades the committed attachment", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  const definition = await app(tenant, (tx) => createModifier(tx, tenant, text, "en"));
  const product = await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    return createProduct(tx, brandTenantId(tenant), {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Dish",
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "reduced",
    });
  });
  const [writer, deleter] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const pid = (await deleter.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]!
    .pid;
  const writing = withTenant(writer, tenant, async (tx) => {
    await asAppUser(tx);
    await setProductOptionGroups(tx, brandTenantId(tenant), product.id, [definition.id]);
    ready();
    await gate;
  });
  try {
    await attached;
    const deleting = withTenant(deleter, tenant, async (tx) => {
      await asAppUser(tx);
      await deleteModifier(tx, tenant, definition.id);
    }).catch((error: unknown) => error);
    await expect
      .poll(
        async () =>
          (
            await suite.admin.execute<{ blocked: boolean }>(
              sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
            )
          ).rows[0]!.blocked,
      )
      .toBe(true);
    release();
    await writing;
    // The delete waited on the writer's advisory lock (proven above), then saw the committed
    // attachment and cascaded it away rather than refusing — no open order references the modifier.
    expect(await deleting).toBeUndefined();
  } finally {
    release();
    await writing;
    await writer.close();
    await deleter.close();
  }
  expect(await app(tenant, (tx) => listModifiers(tx, tenant))).toEqual([]);
  expect(
    await app(tenant, (tx) =>
      tx.select().from(productOptionGroups).where(eq(productOptionGroups.tenantId, tenant)),
    ),
  ).toEqual([]);
});

it("blocks a default-language change while a modifier name is untranslated", async () => {
  const tenant = await seedTenant(suite.admin);
  await app(tenant, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    await createModifier(
      tx,
      tenant,
      {
        type: "text",
        name: { en: "Hot" },
      },
      "en",
    );
    const { listContentTranslationGaps, writeContentLanguages } =
      await import("./content-languages.js");
    expect(await listContentTranslationGaps(tx, tenant, "fr")).toEqual([
      { kind: "option_group", id: expect.any(String) },
    ]);
    await expect(
      writeContentLanguages(tx, tenant, { defaultLanguage: "fr", languages: ["en", "fr"] }, "en"),
    ).rejects.toMatchObject({ code: "content.default_missing" });
  });
});

it("preserves inactive attachments when editing a product, but refuses a new attachment", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  // A modifier can no longer be turned off as a whole through the editor, so the inactive-group
  // state this attachment guard rejects is forced directly on the row.
  const definition = await app(tenant, (tx) =>
    createModifier(tx, tenant, { type: "text", name }, "en"),
  );
  const products = await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    const products = [];
    for (let i = 0; i < 2; i++)
      products.push(
        await createProduct(tx, brandTenantId(tenant), {
          catalogueId: catalogue.id,
          categoryId: null,
          name: "Dish",
          pricingUnit: "each",
          unitPrice: "5.00",
          vatClass: "reduced",
        }),
      );
    await setProductOptionGroups(tx, brandTenantId(tenant), products[0]!.id, [definition.id]);
    return products;
  });
  await withTenant(suite.admin, tenant, (tx) =>
    tx.update(optionGroups).set({ active: false }).where(eq(optionGroups.id, definition.id)),
  );
  await app(tenant, (tx) =>
    setProductOptionGroups(tx, brandTenantId(tenant), products[0]!.id, [definition.id]),
  );
  await expect(
    app(tenant, (tx) =>
      setProductOptionGroups(tx, brandTenantId(tenant), products[1]!.id, [definition.id]),
    ),
  ).rejects.toMatchObject({ code: "modifier.invalid" });
});

it("maps an old author's total cap into the canonical extras definition", async () => {
  const tenant = await seedTenant(suite.admin);
  await app(tenant, async (tx) => {
    const { createOptionGroup, updateOptionGroup } = await import("./operations.js");
    const group = await createOptionGroup(tx, brandTenantId(tenant), { name, maxSelect: 2 });
    expect(await getModifier(tx, tenant, group.id)).toMatchObject({
      type: "extras",
      maxTotalQuantity: 2,
    });
    await updateOptionGroup(tx, brandTenantId(tenant), group.id, { maxSelect: 3 });
    expect(await getModifier(tx, tenant, group.id)).toMatchObject({
      type: "extras",
      maxTotalQuantity: 3,
    });
  });
});

it("deletes a modifier attached to a product and published on a menu, cascading the links", async () => {
  const { tenantId } = await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const modifierId = await app(tenantId, async (tx) => {
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
      { type: "options", name, choices: [choice], defaultChoiceId: choice.id },
      "en",
    );
    await setProductOptionGroups(tx, tenantId, product.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, tenantId, item.id, [
      { groupId: modifier.id, options: [{ optionId: choice.id, priceDelta: "0" }] },
    ]);
    return modifier.id;
  });
  await app(tenantId, (tx) => deleteModifier(tx, tenantId, modifierId));
  await expect(app(tenantId, (tx) => getModifier(tx, tenantId, modifierId))).rejects.toMatchObject({
    code: "modifier.not_found",
  });
  expect(
    await app(tenantId, async (tx) => ({
      products: await tx
        .select()
        .from(productOptionGroups)
        .where(
          and(
            eq(productOptionGroups.tenantId, tenantId),
            eq(productOptionGroups.groupId, modifierId),
          ),
        ),
      menus: await tx
        .select()
        .from(menuItemOptionGroups)
        .where(
          and(
            eq(menuItemOptionGroups.tenantId, tenantId),
            eq(menuItemOptionGroups.groupId, modifierId),
          ),
        ),
    })),
  ).toEqual({ products: [], menus: [] });
});

it("refuses to delete a modifier an open working order uses", async () => {
  const { tenantId, tillId, nodeId } = await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const choice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const modifierId = await app(tenantId, async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const modifier = await createModifier(
      tx,
      tenantId,
      { type: "options", name, choices: [choice], defaultChoiceId: choice.id },
      "en",
    );
    const [order] = await tx
      .insert(workingOrders)
      .values({ tenantId, tillId, nodeId, orderNumber: 1 })
      .returning();
    await tx.insert(workingOrderLines).values({
      tenantId,
      workingOrderId: order!.id,
      productId: product.id,
      lineNo: 1,
      name: "Coffee",
      descriptions: { "en-GB": "Coffee" },
      optionGroupItemId: choice.id,
      quantity: "1",
      unitPrice: "1.82",
      unitPriceGross: "2.00",
      vatRate: "10.00",
      lineTotal: "2.00",
    });
    return modifier.id;
  });
  await expect(
    app(tenantId, (tx) => deleteModifier(tx, tenantId, modifierId)),
  ).rejects.toMatchObject({
    code: "modifier.in_use",
    params: expect.objectContaining({ dependency: "order" }),
  });
});
