import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError, decimal, toScale, type TenantId } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { menuItems, menuSections } from "./schema/menu.js";
import { menuItemVariants, productVariants } from "./schema/variants.js";
import "./errors.js";

export interface ProductVariant {
  id: string;
  name: Record<string, string>;
  unitPrice: string;
  available: boolean;
}
export type ProductVariantInput = Omit<ProductVariant, "id"> & { id?: string };
export interface MenuVariant {
  variantId: string;
  unitPrice: string;
  available: boolean;
}
const variantColumns = {
  id: productVariants.id,
  name: productVariants.name,
  unitPrice: productVariants.unitPrice,
  available: productVariants.available,
};
const publicationColumns = {
  variantId: menuItemVariants.variantId,
  unitPrice: menuItemVariants.unitPrice,
  available: menuItemVariants.available,
};

function validatePrice(price: string): string {
  if (typeof price !== "string" || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(price)) {
    throw new AppError("product.variant_invalid", { field: "unitPrice" });
  }
  return toScale(decimal(price), 2);
}

function validateAvailability(available: boolean): void {
  if (typeof available !== "boolean")
    throw new AppError("product.variant_invalid", { field: "available" });
}

async function lockProduct(tx: Transaction, tenantId: TenantId, productId: string): Promise<void> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .for("update");
  if (!product) throw new AppError("product.not_found", { productId });
}

export async function listProductVariants(
  tx: Transaction,
  tenantId: TenantId,
  productId: string,
): Promise<ProductVariant[]> {
  return tx
    .select(variantColumns)
    .from(productVariants)
    .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.productId, productId)))
    .orderBy(asc(productVariants.displayOrder), asc(productVariants.id));
}

/** The caller owns the transaction, including product fields and supporting associations. */
export async function setProductVariants(
  tx: Transaction,
  tenantId: TenantId,
  productId: string,
  inputs: readonly ProductVariantInput[],
  fallbackLanguage: string,
): Promise<ProductVariant[]> {
  const seen = new Set<string>();
  const normalized: ProductVariantInput[] = [];
  for (const input of inputs) {
    if (input.id !== undefined) {
      if (seen.has(input.id)) throw new AppError("product.variant_invalid", { field: "id" });
      seen.add(input.id);
    }
    validateAvailability(input.available);
    const unitPrice = validatePrice(input.unitPrice);
    await validateContentTranslations(tx, tenantId, input.name, fallbackLanguage);
    normalized.push({ ...input, unitPrice });
  }
  await lockProduct(tx, tenantId, productId);
  const current = await listProductVariants(tx, tenantId, productId);
  const currentIds = new Set(current.map((v) => v.id));
  for (const id of seen) {
    if (!currentIds.has(id)) throw new AppError("product.variant_not_found", { variantId: id });
  }
  const removed = current.filter((v) => !seen.has(v.id)).map((v) => v.id);
  if (removed.length) {
    const dependencies = await tx
      .select({ variantId: menuItemVariants.variantId, menuItemId: menuItemVariants.menuItemId })
      .from(menuItemVariants)
      .where(
        and(eq(menuItemVariants.tenantId, tenantId), inArray(menuItemVariants.variantId, removed)),
      );
    if (dependencies.length) {
      const variantId = dependencies[0]!.variantId;
      throw new AppError("product.variant_in_use", {
        variantId,
        menuItemIds: dependencies.filter((d) => d.variantId === variantId).map((d) => d.menuItemId),
      });
    }
    await tx
      .delete(productVariants)
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          eq(productVariants.productId, productId),
          inArray(productVariants.id, removed),
        ),
      );
  }
  for (const [displayOrder, input] of normalized.entries()) {
    const values = {
      name: input.name,
      unitPrice: input.unitPrice,
      available: input.available,
      displayOrder,
    };
    if (input.id === undefined) {
      await tx.insert(productVariants).values({ tenantId, productId, ...values });
    } else {
      await tx
        .update(productVariants)
        .set(values)
        .where(
          and(
            eq(productVariants.tenantId, tenantId),
            eq(productVariants.productId, productId),
            eq(productVariants.id, input.id),
          ),
        );
    }
  }
  return listProductVariants(tx, tenantId, productId);
}

export async function listMenuVariants(
  tx: Transaction,
  tenantId: TenantId,
  menuItemId: string,
  menuId?: string,
): Promise<MenuVariant[]> {
  if (menuId !== undefined) {
    const [offer] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.tenantId, tenantId),
          eq(menuItems.id, menuItemId),
          eq(menuItems.menuId, menuId),
        ),
      );
    if (!offer) throw new AppError("menu_item.not_found", { menuItemId });
  }
  return tx
    .select(publicationColumns)
    .from(menuItemVariants)
    .where(
      and(eq(menuItemVariants.tenantId, tenantId), eq(menuItemVariants.menuItemId, menuItemId)),
    )
    .orderBy(asc(menuItemVariants.displayOrder), asc(menuItemVariants.variantId));
}

export async function setMenuVariants(
  tx: Transaction,
  tenantId: TenantId,
  menuItemId: string,
  inputs: readonly MenuVariant[],
  menuId?: string,
): Promise<MenuVariant[]> {
  const [offer] = await tx
    .select({ productId: menuItems.productId })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.tenantId, tenantId),
        eq(menuItems.id, menuItemId),
        ...(menuId === undefined ? [] : [eq(menuItems.menuId, menuId)]),
      ),
    );
  if (!offer) throw new AppError("menu_item.not_found", { menuItemId });
  // Product saves and publication take the same lock before checking dependencies or replacing rows.
  await lockProduct(tx, tenantId, offer.productId);
  const variants = await listProductVariants(tx, tenantId, offer.productId);
  const ids = new Set(variants.map((v) => v.id));
  const seen = new Set<string>();
  const values = inputs.map((input, displayOrder) => {
    if (seen.has(input.variantId))
      throw new AppError("product.variant_invalid", { field: "variantId" });
    if (!ids.has(input.variantId))
      throw new AppError("product.variant_not_found", { variantId: input.variantId });
    seen.add(input.variantId);
    validateAvailability(input.available);
    return {
      ...input,
      unitPrice: validatePrice(input.unitPrice),
      tenantId,
      menuItemId,
      productId: offer.productId,
      displayOrder,
    };
  });
  await tx
    .delete(menuItemVariants)
    .where(
      and(
        eq(menuItemVariants.tenantId, tenantId),
        eq(menuItemVariants.menuItemId, menuItemId),
        ...(seen.size ? [notInArray(menuItemVariants.variantId, [...seen])] : []),
      ),
    );
  for (const value of values) {
    await tx
      .insert(menuItemVariants)
      .values(value)
      .onConflictDoUpdate({
        target: [
          menuItemVariants.tenantId,
          menuItemVariants.menuItemId,
          menuItemVariants.variantId,
        ],
        set: {
          unitPrice: value.unitPrice,
          available: value.available,
          displayOrder: value.displayOrder,
        },
      });
  }
  return listMenuVariants(tx, tenantId, menuItemId);
}

export interface SelectedVariant {
  variantId: string | null;
  productName: Record<string, string>;
  variantName: Record<string, string> | null;
  kitchenName: string | null;
  unitPrice: string;
}

export async function resolveMenuVariant(
  tx: Transaction,
  tenantId: TenantId,
  menuItemId: string,
  variantId: string | null,
): Promise<SelectedVariant> {
  const [offer] = await tx
    .select({
      productId: products.id,
      productName: products.descriptions,
      kitchenName: products.kitchenName,
      available: products.active,
      offerAvailable: menuItems.active,
      menuAvailable: catalogues.active,
      sectionAvailable: menuSections.active,
      unitPrice: menuItems.grossPrice,
    })
    .from(menuItems)
    .innerJoin(
      products,
      and(eq(products.tenantId, menuItems.tenantId), eq(products.id, menuItems.productId)),
    )
    .innerJoin(
      catalogues,
      and(eq(catalogues.tenantId, menuItems.tenantId), eq(catalogues.id, menuItems.menuId)),
    )
    .innerJoin(
      menuSections,
      and(eq(menuSections.tenantId, menuItems.tenantId), eq(menuSections.id, menuItems.sectionId)),
    )
    .where(and(eq(menuItems.tenantId, tenantId), eq(menuItems.id, menuItemId)));
  if (!offer) throw new AppError("menu_item.not_found", { menuItemId });
  if (
    !offer.available ||
    !offer.offerAvailable ||
    !offer.menuAvailable ||
    !offer.sectionAvailable
  ) {
    throw new AppError("product.unavailable", { productId: offer.productId });
  }
  const variants = await listProductVariants(tx, tenantId, offer.productId);
  if (variants.length && variantId === null)
    throw new AppError("product.variant_required", { productId: offer.productId });
  if (variantId === null)
    return {
      variantId: null,
      productName: offer.productName,
      variantName: null,
      kitchenName: offer.kitchenName,
      unitPrice: offer.unitPrice,
    };
  const variant = variants.find((v) => v.id === variantId);
  const published = (await listMenuVariants(tx, tenantId, menuItemId)).find(
    (v) => v.variantId === variantId,
  );
  if (!variant?.available || !published?.available)
    throw new AppError("product.variant_unavailable", { variantId });
  return {
    variantId,
    productName: offer.productName,
    variantName: variant.name,
    kitchenName: offer.kitchenName,
    unitPrice: published.unitPrice,
  };
}
