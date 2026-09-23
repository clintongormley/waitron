import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal, decimal, decimalToCents, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { menuItems, menuSections } from "./schema/menu.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { isProductPrice } from "./modifier-limits.js";
import { resolveOfferPrice } from "./offer-price.js";
import type { ProductPresentation } from "./product-presentation.js";
import {
  effectiveProductColumns as effective,
  parentJoin,
  parentProducts,
} from "./variant-fallback.js";
import "./errors.js";
import type { ProductVariant, ProductVariantInput } from "./product-types.js";
export type { ProductVariant, ProductVariantInput } from "./product-types.js";

/**
 * A variant is a `products` row with a `parent_id` (spec §15). It follows its parent onto every
 * menu the parent is on; `menu_item_variant_overrides` holds a row for it only while one menu
 * overrides its price there or switches it off (plan V13).
 */

/** One Active variant's settings on one menu: `price` null and `offered` true store nothing. */
export interface MenuVariant {
  variantId: string;
  price: string | null;
  offered: boolean;
}

const variantColumns = {
  id: products.id,
  name: products.name,
  customerName: products.customerName,
  kitchenName: products.kitchenName,
  image: products.image,
  unitPrice: products.unitPrice,
  available: products.available,
  active: products.active,
};

function validatePrice(price: string | null, field: string): Decimal | null {
  if (price === null) return null;
  if (typeof price !== "string" || !isProductPrice(price)) {
    throw new AppError("product.variant_invalid", { field });
  }
  return toScale(decimal(price), 2);
}

function validateFlag(value: boolean, field: string): void {
  if (typeof value !== "boolean") throw new AppError("product.variant_invalid", { field });
}

const priceOrNull = (cents: number | null): string | null =>
  cents === null ? null : centsToDecimal(cents);

/**
 * The product exists; returns the catalogue its variants are created in.
 *
 * This took `select … for update` on the product's row, so that two variant saves of the same
 * product could not overlap. One write transaction runs on the venue file at a time, so there is
 * no second save to overlap with; the mechanism and the receipt are on `assertExtraListForWrite`
 * (extras.ts), which is where this package states the pattern once.
 */
async function assertProductForWrite(
  tx: Transaction,
  productId: string,
): Promise<{ catalogueId: string }> {
  const [product] = await tx
    .select({ catalogueId: products.catalogueId })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}

/** Every variant of the product, Inactive ones included, in variant order. */
export async function listProductVariants(
  tx: Transaction,
  productId: string,
): Promise<ProductVariant[]> {
  return (await listProductVariantsForProducts(tx, [productId])).get(productId) ?? [];
}

/** Read variants for several products in one query. */
export async function listProductVariantsForProducts(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, ProductVariant[]>> {
  const grouped = new Map<string, ProductVariant[]>();
  if (productIds.length === 0) return grouped;
  const rows = await tx
    .select({ parentId: products.parentId, ...variantColumns })
    .from(products)
    .where(inArray(products.parentId, [...new Set(productIds)]))
    .orderBy(asc(products.parentId), asc(products.variantOrder), asc(products.id));
  for (const { parentId, unitPrice, ...variant } of rows) {
    const variants = grouped.get(parentId!) ?? [];
    variants.push({ ...variant, unitPrice: priceOrNull(unitPrice) });
    grouped.set(parentId!, variants);
  }
  return grouped;
}

/**
 * Save a product's variants: each one in the input is Active, in the input's order; each current
 * variant the input leaves out is made Inactive and kept (spec §15.6), ordered after the Active
 * ones. The caller owns the transaction, including product fields and supporting associations.
 */
export async function setProductVariants(
  tx: Transaction,
  productId: string,
  inputs: readonly ProductVariantInput[],
  fallbackLanguage: string,
): Promise<ProductVariant[]> {
  const seen = new Set<string>();
  const normalized: (ProductVariantInput & { cents: number | null })[] = [];
  for (const input of inputs) {
    if (input.id !== undefined) {
      if (seen.has(input.id)) throw new AppError("product.variant_invalid", { field: "id" });
      seen.add(input.id);
    }
    validateFlag(input.available, "available");
    const price = validatePrice(input.unitPrice, "unitPrice");
    // The staff `name` is plain text and needs no translation check; the customer-facing map is what
    // must satisfy the enabled languages. A null customer name is legal — it falls back to `name`.
    if (input.customerName != null)
      await validateContentTranslations(tx, input.customerName, fallbackLanguage);
    normalized.push({ ...input, cents: price === null ? null : decimalToCents(price) });
  }
  const parent = await assertProductForWrite(tx, productId);
  const current = await listProductVariants(tx, productId);
  const currentIds = new Set(current.map((v) => v.id));
  for (const id of seen) {
    if (!currentIds.has(id)) throw new AppError("product.variant_not_found", { variantId: id });
  }
  for (const [index, input] of normalized.entries()) {
    const values = {
      name: input.name,
      customerName: input.customerName,
      kitchenName: input.kitchenName,
      image: input.image,
      unitPrice: input.cents,
      available: input.available,
      active: true,
      variantOrder: index,
      updatedAt: now(),
    };
    if (input.id === undefined) {
      await tx.insert(products).values({
        ...values,
        parentId: productId,
        catalogueId: parent.catalogueId,
        soldAlone: true,
        // Every other inherited field stored blank, so it reads the parent's. Explicitly: the
        // `dietary_declarations` column's own default is `[]`, which would be a value of the
        // variant's own.
        description: null,
        vatClass: null,
        pricingUnit: null,
        categoryId: null,
        stationId: null,
        courseId: null,
        allergens: null,
        manualAllergens: null,
        recipeDerivation: null,
        dietDerivation: null,
        dietOverride: null,
        diet: null,
        dietaryDeclarations: null,
      });
    } else {
      await tx
        .update(products)
        .set(values)
        .where(and(eq(products.parentId, productId), eq(products.id, input.id)));
    }
  }
  const left = current.filter((variant) => !seen.has(variant.id));
  for (const [index, variant] of left.entries()) {
    await tx
      .update(products)
      .set({
        active: false,
        variantOrder: normalized.length + index,
        ...(variant.active ? { updatedAt: now() } : {}),
      })
      .where(and(eq(products.parentId, productId), eq(products.id, variant.id)));
  }
  return listProductVariants(tx, productId);
}

/** The offer's product, checked to be on `menuId` when one is given. */
async function offerProduct(
  tx: Transaction,
  menuItemId: string,
  menuId: string | undefined,
): Promise<string> {
  const [offer] = await tx
    .select({ productId: menuItems.productId })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.id, menuItemId),
        ...(menuId === undefined ? [] : [eq(menuItems.menuId, menuId)]),
      ),
    );
  if (!offer) throw new AppError("menu_item.not_found", { menuItemId });
  return offer.productId;
}

async function activeVariants(tx: Transaction, productId: string): Promise<ProductVariant[]> {
  return (await listProductVariants(tx, productId)).filter((variant) => variant.active);
}

/** Every Active variant of the offer's product, with what this menu overrides for it. */
export async function listMenuVariants(
  tx: Transaction,
  menuItemId: string,
  menuId?: string,
): Promise<MenuVariant[]> {
  const productId = await offerProduct(tx, menuItemId, menuId);
  const overrides = new Map(
    (
      await tx
        .select({
          variantId: menuItemVariantOverrides.variantId,
          price: menuItemVariantOverrides.price,
          offered: menuItemVariantOverrides.offered,
        })
        .from(menuItemVariantOverrides)
        .where(eq(menuItemVariantOverrides.menuItemId, menuItemId))
    ).map((row) => [row.variantId, row]),
  );
  return (await activeVariants(tx, productId)).map((variant) => {
    const override = overrides.get(variant.id);
    return {
      variantId: variant.id,
      price: priceOrNull(override?.price ?? null),
      offered: override?.offered ?? true,
    };
  });
}

/**
 * Save what this menu overrides for the Active variants of the offer's product. An entry that
 * overrides nothing — no price, and offered — stores no row, and so does an Active variant the
 * input leaves out. An Inactive variant's row is left alone, for when it is made Active again.
 */
export async function setMenuVariants(
  tx: Transaction,
  menuItemId: string,
  inputs: readonly MenuVariant[],
  menuId?: string,
): Promise<MenuVariant[]> {
  const productId = await offerProduct(tx, menuItemId, menuId);
  const ids = new Set((await activeVariants(tx, productId)).map((variant) => variant.id));
  const seen = new Set<string>();
  const rows = [];
  for (const input of inputs) {
    if (seen.has(input.variantId))
      throw new AppError("product.variant_invalid", { field: "variantId" });
    if (!ids.has(input.variantId))
      throw new AppError("product.variant_not_found", { variantId: input.variantId });
    seen.add(input.variantId);
    const price = validatePrice(input.price, "price");
    validateFlag(input.offered, "offered");
    if (price !== null || !input.offered)
      rows.push({
        menuItemId,
        productId,
        variantId: input.variantId,
        price: price === null ? null : decimalToCents(price),
        offered: input.offered,
      });
  }
  const kept = rows.map((row) => row.variantId);
  if (ids.size > 0)
    await tx
      .delete(menuItemVariantOverrides)
      .where(
        and(
          eq(menuItemVariantOverrides.menuItemId, menuItemId),
          inArray(menuItemVariantOverrides.variantId, [...ids]),
          ...(kept.length ? [notInArray(menuItemVariantOverrides.variantId, kept)] : []),
        ),
      );
  for (const row of rows) {
    await tx
      .insert(menuItemVariantOverrides)
      .values(row)
      .onConflictDoUpdate({
        target: [menuItemVariantOverrides.menuItemId, menuItemVariantOverrides.variantId],
        set: { price: row.price, offered: row.offered },
      });
  }
  return listMenuVariants(tx, menuItemId);
}

// Extends ProductPresentation so the compiler keeps the six name pieces in step: a resolved
// selection goes straight to that module's staff/customer/kitchen resolvers, and the " · " join and
// the customerName-to-name fallback stay in ONE place.
export interface SelectedVariant extends ProductPresentation {
  variantId: string | null;
  unitPrice: string;
}

/**
 * The line an offer sells: the chosen variant, or the product itself when it has no Active
 * variant (spec §15.1). `offer.variants` carries each variant's resolved price and whether it may
 * be sold on this menu now.
 */
export function selectMenuVariant(
  offer: {
    productId: string;
    name: string;
    customerName: Record<string, string> | null;
    kitchenName: string | null;
    unitPrice: string;
    variants: readonly { id: string; unitPrice: string; available: boolean }[];
  },
  productVariants: readonly ProductVariant[],
  variantId: string | null,
): SelectedVariant {
  const active = productVariants.filter((variant) => variant.active);
  if (active.length > 0 && variantId === null) {
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
      unitPrice: offer.unitPrice,
    };
  }
  const variant = active.find((candidate) => candidate.id === variantId);
  const offered = offer.variants.find((candidate) => candidate.id === variantId);
  if (!variant?.available || !offered?.available) {
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
    unitPrice: offered.unitPrice,
  };
}

export async function resolveMenuVariant(
  tx: Transaction,
  menuItemId: string,
  variantId: string | null,
): Promise<SelectedVariant> {
  const [offer] = await tx
    .select({
      productId: products.id,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      active: products.active,
      available: products.available,
      offerAvailable: menuItems.active,
      menuAvailable: catalogues.active,
      sectionAvailable: menuSections.active,
      unitPrice: menuItems.grossPrice,
      productPrice: effective.unitPrice,
    })
    .from(menuItems)
    .innerJoin(products, eq(products.id, menuItems.productId))
    .leftJoin(parentProducts, parentJoin)
    .innerJoin(catalogues, eq(catalogues.id, menuItems.menuId))
    .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
    .where(eq(menuItems.id, menuItemId));
  if (!offer) throw new AppError("menu_item.not_found", { menuItemId });
  if (
    !offer.active ||
    !offer.available ||
    !offer.offerAvailable ||
    !offer.menuAvailable ||
    !offer.sectionAvailable
  ) {
    throw new AppError("product.unavailable", { productId: offer.productId });
  }
  const variants = await activeVariants(tx, offer.productId);
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
      unitPrice: centsToDecimal(offer.unitPrice),
    };
  const variant = variants.find((v) => v.id === variantId);
  const [override] = await tx
    .select({ price: menuItemVariantOverrides.price, offered: menuItemVariantOverrides.offered })
    .from(menuItemVariantOverrides)
    .where(
      and(
        eq(menuItemVariantOverrides.menuItemId, menuItemId),
        eq(menuItemVariantOverrides.variantId, variantId),
      ),
    );
  if (!variant?.available || override?.offered === false)
    throw new AppError("product.variant_unavailable", { variantId });
  return {
    variantId,
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    variantName: variant.name,
    variantCustomerName: variant.customerName,
    variantKitchenName: variant.kitchenName,
    unitPrice: resolveOfferPrice({
      variantMenuPrice: override?.price == null ? null : centsToDecimal(override.price),
      variantPrice: variant.unitPrice === null ? null : decimal(variant.unitPrice),
      parentMenuPrice: centsToDecimal(offer.unitPrice),
      parentPrice: centsToDecimal(offer.productPrice),
    }),
  };
}
