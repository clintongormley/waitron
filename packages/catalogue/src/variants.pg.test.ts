import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { type TenantId } from "@waitron/shared";
import { createCatalogue, createProduct, createMenuSection, createMenuItem } from "./operations.js";
import { listProductVariants, setProductVariants, setMenuVariants } from "./variants.js";
import { createUnit } from "./units.js";

const suite = useTemplateDb({ template: "core" });
function app<T>(db: Database, tenantId: TenantId, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}
async function fixture() {
  const tenantId = await seedTenant(suite.admin);
  return app(suite.admin, tenantId, async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Bar" });
    const unit = await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    );
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Coffee" },
      description: { en: "Freshly roasted" },
      kitchenName: "BAR COFFEE",
      unitId: unit.id,
      unitPrice: "9.00",
      vatClass: "reduced",
    });
    expect(product.description).toEqual({ en: "Freshly roasted" });
    expect(product.kitchenName).toBe("BAR COFFEE");
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const offer = await createMenuItem(tx, tenantId, {
      menuId: menu.id,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "8.00",
    });
    const variants = await setProductVariants(
      tx,
      tenantId,
      product.id,
      [{ name: { en: "Small" }, unitPrice: "2.00", available: true }],
      "en",
    );
    return { tenantId, productId: product.id, offerId: offer.id, variant: variants[0]! };
  });
}

it("creates, reads, edits and deletes variants as the non-superuser app role", async () => {
  const { tenantId, productId, variant } = await fixture();
  await app(suite.admin, tenantId, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    expect(await listProductVariants(tx, tenantId, productId)).toEqual([variant]);
    expect(
      await setProductVariants(
        tx,
        tenantId,
        productId,
        [{ ...variant, available: false, unitPrice: "2.50" }],
        "en",
      ),
    ).toEqual([{ ...variant, available: false, unitPrice: "2.50" }]);
    expect(await setProductVariants(tx, tenantId, productId, [], "en")).toEqual([]);
  });
});

it("a concurrent variant removal waits for publication and then reports the dependency", async () => {
  const { tenantId, productId, offerId, variant } = await fixture();
  const [publisher, remover] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let publishing: Promise<unknown> | undefined;
  let removing: Promise<unknown> | undefined;
  try {
    const pid = (await remover.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    publishing = app(publisher, tenantId, async (tx) => {
      await setMenuVariants(tx, tenantId, offerId, [
        { variantId: variant.id, unitPrice: "4.00", available: true },
      ]);
      ready();
      await gate;
    });
    await Promise.race([published, publishing]);
    removing = app(remover, tenantId, (tx) =>
      setProductVariants(tx, tenantId, productId, [], "en"),
    );
    const rejected = expect(removing).rejects.toMatchObject({
      code: "product.variant_in_use",
      params: { variantId: variant.id, menuItemIds: [offerId] },
    });
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
    await publishing;
    await rejected;
    expect(
      await app(suite.admin, tenantId, (tx) => listProductVariants(tx, tenantId, productId)),
    ).toEqual([variant]);
  } finally {
    release();
    await Promise.allSettled([publishing, removing]);
    await publisher.close();
    await remover.close();
  }
});
