import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { type TenantId } from "@waitron/shared";
import { createCatalogue, createProduct, createMenuSection, createMenuItem } from "./operations.js";
import {
  listProductVariants,
  setProductVariants,
  setMenuVariants,
  selectMenuVariant,
  type ProductVariant,
} from "./variants.js";
import { staffPresentationName, customerPresentationText } from "./product-presentation.js";
import { createUnit } from "./units.js";

const suite = useTemplateDb({ template: "core" });
function app<T>(db: Database, tenantId: TenantId, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void tenantId;
  return withTransaction(db, async (tx) => {
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
      name: "Coffee",
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
      [
        {
          name: "Small",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.00",
          available: true,
        },
      ],
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

// setProductVariants persists and listProductVariants reads back the widened variant shape (staff
// name, customer name, kitchen name and image). Seeded with raw SQL so it does not depend on
// createProduct (which a later task rewrites for the renamed products.name).
it("a variant round-trips staff name, customer name, kitchen name and image through set/list", async () => {
  const tenantId = await seedTenant(suite.admin);
  const { id: catalogueId } = (
    await suite.admin.execute<{ id: string }>(
      sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Bar') returning id`,
    )
  ).rows[0]!;
  const { id: productId } = (
    await suite.admin.execute<{ id: string }>(
      sql`insert into products (tenant_id, catalogue_id, name, pricing_unit, unit_price, vat_class)
          values (${tenantId}, ${catalogueId}, 'Coffee', 'each', '9.00', 'reduced') returning id`,
    )
  ).rows[0]!;
  await app(suite.admin, tenantId, async (tx) => {
    await setProductVariants(
      tx,
      tenantId,
      productId,
      [
        {
          name: "Large",
          customerName: { en: "Large cup" },
          kitchenName: "LG",
          image: "cup.png",
          unitPrice: "3.00",
          available: true,
        },
      ],
      "en",
    );
    const [variant] = await listProductVariants(tx, tenantId, productId);
    expect(variant).toMatchObject({
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: "cup.png",
      unitPrice: "3.00",
      available: true,
    });
  });
});

// selectMenuVariant is the pure core of menu-variant resolution — no DB. It returns the six name
// pieces (product staff/customer/kitchen and variant staff/customer/kitchen) separately, in the
// exact shape product-presentation.ts consumes, so the display join and fallback are never
// re-implemented here.
describe("selectMenuVariant returns the six product and variant name pieces", () => {
  const large: ProductVariant = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Large",
    customerName: { en: "Large cup" },
    kitchenName: "LG",
    image: null,
    unitPrice: "3.00",
    available: true,
  };
  const offer = {
    productId: "22222222-2222-2222-2222-222222222222",
    name: "Coffee",
    customerName: { en: "Fresh Coffee" },
    kitchenName: "BAR COFFEE",
    grossPrice: "8.00",
    variants: [large],
  };

  it("carries the product's names and the chosen variant's own three names", () => {
    const selected = selectMenuVariant(offer, [large], large.id);
    expect(selected).toEqual({
      variantId: large.id,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: "Large",
      variantCustomerName: { en: "Large cup" },
      variantKitchenName: "LG",
      unitPrice: "3.00",
    });
    // The selection is a ProductPresentation superset, so T4's resolvers own the join/fallback.
    expect(staffPresentationName(selected)).toBe("Coffee · Large");
    expect(customerPresentationText(selected, "en")).toEqual({
      product: { en: "Fresh Coffee" },
      variant: { en: "Large cup" },
    });
  });

  it("leaves all three variant name pieces null when no variant is chosen", () => {
    const selected = selectMenuVariant({ ...offer, variants: [] }, [], null);
    expect(selected).toEqual({
      variantId: null,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: "8.00",
    });
    expect(staffPresentationName(selected)).toBe("Coffee");
  });
});

// Self-contained apply/round-trip proof for the A2 columns, seeded with raw SQL so it does not
// depend on createProduct (which a later task rewrites for the renamed products.name).
it("round-trips a variant's new name, customer_name, kitchen_name and image columns", async () => {
  const tenantId = await seedTenant(suite.admin);
  // The return type is INFERRED from `execute`, which widens to drizzle's `Assume<T, ...>`; writing
  // `Promise<T>` here would need a cast, and each call site names a concrete row shape anyway.
  async function one<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
    return (await suite.admin.execute<T>(query)).rows[0]!;
  }
  const { id: catalogueId } = await one<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Bar') returning id`,
  );
  const { id: productId } = await one<{ id: string }>(
    sql`insert into products (tenant_id, catalogue_id, name, pricing_unit, unit_price, vat_class)
        values (${tenantId}, ${catalogueId}, 'Coffee', 'each', '9.00', 'reduced') returning id`,
  );
  const row = await one<{
    name: string;
    customer_name: Record<string, string> | null;
    kitchen_name: string | null;
    image: string | null;
  }>(
    sql`insert into product_variants
          (tenant_id, product_id, name, customer_name, kitchen_name, image, unit_price)
        values (${tenantId}, ${productId}, 'Small', '{"en":"Small"}'::jsonb, 'SM COFFEE', 'abc123.jpg', '2.00')
        returning name, customer_name, kitchen_name, image`,
  );
  expect(row).toEqual({
    name: "Small",
    customer_name: { en: "Small" },
    kitchen_name: "SM COFFEE",
    image: "abc123.jpg",
  });
});
