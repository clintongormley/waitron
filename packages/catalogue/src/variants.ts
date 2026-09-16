import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError, decimal, toScale, type TenantId } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { menuItems, menuSections } from "./schema/menu.js";
import { menuItemVariants, productVariants } from "./schema/variants.js";
import { isProductPrice } from "./modifier-limits.js";
import "./errors.js";

export interface ProductVariant {
  id: string;
  /** Staff-facing variant name — plain text, appended to the product's with " · " for display. */
  name: string;
  /** Customer-facing translated name; null or a blank entry falls back to `name`. */
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
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
  customerName: productVariants.customerName,
  kitchenName: productVariants.kitchenName,
  image: productVariants.image,
  unitPrice: productVariants.unitPrice,
  available: productVariants.available,
};
const publicationColumns = {
  variantId: menuItemVariants.variantId,
  unitPrice: menuItemVariants.unitPrice,
  available: menuItemVariants.available,
};

function validatePrice(price: string): string {
  if (typeof price !== "string" || !isProductPrice(price)) {
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
  return (await listProductVariantsForProducts(tx, tenantId, [productId])).get(productId) ?? [];
}

/** Read variants for several products in one tenant-scoped query. */
export async function listProductVariantsForProducts(
  tx: Transaction,
  tenantId: TenantId,
  productIds: readonly string[],
): Promise<Map<string, ProductVariant[]>> {
  const grouped = new Map<string, ProductVariant[]>();
  if (productIds.length === 0) return grouped;
  const rows = await tx
    .select({ productId: productVariants.productId, ...variantColumns })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.tenantId, tenantId),
        inArray(productVariants.productId, [...new Set(productIds)]),
      ),
    )
    .orderBy(
      asc(productVariants.productId),
      asc(productVariants.displayOrder),
      asc(productVariants.id),
    );
  for (const row of rows) {
    const variants = grouped.get(row.productId) ?? [];
    const { productId, ...variant } = row;
    variants.push(variant);
    grouped.set(productId, variants);
  }
  return grouped;
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
    // The staff `name` is plain text and needs no translation check; the customer-facing map is what
    // must satisfy the enabled languages. A null customer name is legal — it falls back to `name`.
    if (input.customerName != null)
      await validateContentTranslations(tx, tenantId, input.customerName, fallbackLanguage);
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
      customerName: input.customerName,
      kitchenName: input.kitchenName,
      image: input.image,
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

// The six name pieces mirror {@link ProductPresentation} (product-presentation.ts) exactly, plus the
// selection metadata: a resolved selection is passed straight to that module's staff/customer/kitchen
// resolvers, so the " · " join and the customerName→name fallback live in ONE place and are never
// re-implemented here.
export interface SelectedVariant {
  variantId: string | null;
  name: string; // product staff name
  customerName: Record<string, string> | null; // product customer-facing name
  kitchenName: string | null;
  variantName: string | null; // variant staff name
  variantCustomerName: Record<string, string> | null;
  variantKitchenName: string | null;
  unitPrice: string;
}

export function selectMenuVariant(
  offer: {
    productId: string;
    name: string;
    customerName: Record<string, string> | null;
    kitchenName: string | null;
    grossPrice: string;
    variants: readonly ProductVariant[];
  },
  productVariants: readonly ProductVariant[],
  variantId: string | null,
): SelectedVariant {
  if (productVariants.length > 0 && variantId === null) {
    throw new AppError("product.variant_required", { productId: offer.productId });
  }
  if (variantId === null) {
    return {
      variantId: null,
      name: offer.name,
      customerName: offer.customerName,
      kitchenName: offer.kitchenName,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: offer.grossPrice,
    };
  }
  const variant = productVariants.find((candidate) => candidate.id === variantId);
  const published = offer.variants.find((candidate) => candidate.id === variantId);
  if (!variant?.available || !published?.available) {
    throw new AppError("product.variant_unavailable", { variantId });
  }
  return {
    variantId,
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    variantName: variant.name,
    variantCustomerName: variant.customerName,
    variantKitchenName: variant.kitchenName,
    unitPrice: published.unitPrice,
  };
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
      name: products.name,
      customerName: products.customerName,
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
      name: offer.name,
      customerName: offer.customerName,
      kitchenName: offer.kitchenName,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
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
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    variantName: variant.name,
    variantCustomerName: variant.customerName,
    variantKitchenName: variant.kitchenName,
    unitPrice: published.unitPrice,
  };
}
