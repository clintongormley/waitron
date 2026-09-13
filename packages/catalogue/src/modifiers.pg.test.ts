import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  createModifier,
  updateModifier,
  deleteModifier,
  listModifiers,
  getModifier,
} from "./modifiers.js";
import { createCatalogue, createProduct, setProductOptionGroups } from "./operations.js";
import { tenantId as brandTenantId } from "@waitron/shared";
import { seedLegacySellingUnits } from "../test/fixtures.js";

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

it("blocks type changes and deletion for attached definitions, but permits deactivation", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  const definition = await app(tenant, (tx) => createModifier(tx, tenant, text, "en"));
  await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    const product = await createProduct(tx, brandTenantId(tenant), {
      catalogueId: catalogue.id,
      categoryId: null,
      descriptions: { en: "Dish" },
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "reduced",
    });
    await setProductOptionGroups(tx, brandTenantId(tenant), product.id, [definition.id]);
  });
  await expect(
    app(tenant, (tx) => deleteModifier(tx, tenant, definition.id)),
  ).rejects.toMatchObject({ code: "modifier.in_use", params: { dependency: "product" } });
  await expect(
    app(tenant, (tx) => updateModifier(tx, tenant, definition.id, { type: "yes-no", name }, "en")),
  ).rejects.toMatchObject({ code: "modifier.in_use" });
  expect(
    await app(tenant, (tx) =>
      updateModifier(tx, tenant, definition.id, { ...text, available: false }, "en"),
    ),
  ).toMatchObject({ available: false });
});

it("serializes deletion behind an attachment write and reports its committed dependency", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  const definition = await app(tenant, (tx) => createModifier(tx, tenant, text, "en"));
  const product = await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    return createProduct(tx, brandTenantId(tenant), {
      catalogueId: catalogue.id,
      categoryId: null,
      descriptions: { en: "Dish" },
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
    expect(await deleting).toMatchObject({ code: "modifier.in_use" });
  } finally {
    release();
    await writing;
    await writer.close();
    await deleter.close();
  }
});

it("blocks a default-language change while a yes/no modifier name is untranslated", async () => {
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
        type: "yes-no",
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

it("preserves unavailable attachments when editing a product, but refuses a new attachment", async () => {
  const tenant = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenant);
  const definition = await app(tenant, (tx) => createModifier(tx, tenant, text, "en"));
  const products = await app(tenant, async (tx) => {
    const catalogue = await createCatalogue(tx, brandTenantId(tenant), { name: "Menu" });
    const products = [];
    for (let i = 0; i < 2; i++)
      products.push(
        await createProduct(tx, brandTenantId(tenant), {
          catalogueId: catalogue.id,
          categoryId: null,
          descriptions: { en: "Dish" },
          pricingUnit: "each",
          unitPrice: "5.00",
          vatClass: "reduced",
        }),
      );
    await setProductOptionGroups(tx, brandTenantId(tenant), products[0]!.id, [definition.id]);
    return products;
  });
  await app(tenant, (tx) =>
    updateModifier(tx, tenant, definition.id, { ...text, available: false }, "en"),
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
