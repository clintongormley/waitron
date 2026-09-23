import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal, decimal, decimalToCents, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { menuItems, menuSections } from "./schema/menu.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { isProductPrice } from "./modifier-limits.js";
import { priceOrNull, resolveOfferPrice } from "./offer-price.js";
import type { ProductPresentation } from "./product-presentation.js";
import type { MenuOffer } from "./menu-types.js";
import {
  effectiveProductColumns as effective,
  INHERITED_KEYS,
  parentJoin,
  parentProducts,
  productWithId,
} from "./variant-fallback.js";
import "./errors.js";
import type { ProductVariant, ProductVariantInput } from "./product-types.js";
export type { ProductVariant, ProductVariantInput } from "./product-types.js";

/** What {@link setProductVariants} takes: the editor's {@link ProductVariantInput}, whose `active`
 * the editor body always carries, with `active` optional for a caller in code — absent creates a new
 * variant Active and leaves one sent by `id` Active or Inactive as it already is. */
export type VariantWrite = Omit<ProductVariantInput, "active"> & { active?: boolean };

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

/**
 * Every inherited field `written` does not set, stored blank so it reads the parent's. Explicitly
 * null rather than omitted: a column default (`dietary_declarations`' is `[]`) would be a value of
 * the variant's own.
 */
function blankInherited(written: object): Partial<Record<(typeof INHERITED_KEYS)[number], null>> {
  return Object.fromEntries(
    INHERITED_KEYS.filter((key) => !(key in written)).map((key) => [key, null]),
  );
}

/**
 * The product exists and is not itself a variant; returns the catalogue its variants are created in.
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
    .where(productWithId(productId, "top-level"));
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}

/** Every variant of the product, Inactive ones included, in variant order. */
export async function listProductVariants(
  tx: Transaction,
  productId: string,
): Promise<ProductVariant[]> {
  return (await variantsOfProducts(tx, [productId])).get(productId) ?? [];
}

/**
 * Every variant of each product in `productIds`, Inactive ones included, in ONE query. Left out of
 * the package's exports (`index.ts`): what a menu SELLS is decided from the offer
 * (`MenuOffer.variants`), never from this read.
 */
export async function variantsOfProducts(
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
 * Save a product's variants: each one in the input is written Active or Inactive as its `active`
 * says, in the input's order; each current variant the input leaves out is made Inactive and kept
 * (spec §15.6), ordered after the ones sent. The caller owns the transaction, including product
 * fields and supporting associations.
 */
export async function setProductVariants(
  tx: Transaction,
  productId: string,
  inputs: readonly VariantWrite[],
  fallbackLanguage: string,
): Promise<ProductVariant[]> {
  const seen = new Set<string>();
  const checked: (VariantWrite & { cents: number | null })[] = [];
  for (const input of inputs) {
    if (input.id !== undefined) {
      if (seen.has(input.id)) throw new AppError("product.variant_invalid", { field: "id" });
      seen.add(input.id);
    }
    validateFlag(input.available, "available");
    if (input.active !== undefined) validateFlag(input.active, "active");
    const price = validatePrice(input.unitPrice, "unitPrice");
    checked.push({ ...input, cents: price === null ? null : decimalToCents(price) });
  }
  const parent = await assertProductForWrite(tx, productId);
  const current = await listProductVariants(tx, productId);
  const currentActive = new Map(current.map((variant) => [variant.id, variant.active]));
  const normalized: (VariantWrite & { active: boolean; cents: number | null })[] = [];
  for (const input of checked) {
    const active =
      input.active ?? (input.id === undefined ? true : (currentActive.get(input.id) ?? true));
    // The staff `name` is plain text and needs no translation check; the customer-facing map is what
    // must satisfy the enabled languages. A null customer name is legal — it falls back to `name`.
    // An Inactive variant is on no menu offer and in no translation-gap report, so it is checked when
    // next saved Active; checking it here would let a language enabled after its removal block every
    // save of its parent.
    if (active && input.customerName != null)
      await validateContentTranslations(tx, input.customerName, fallbackLanguage);
    normalized.push({ ...input, active });
  }
  const currentIds = new Set(currentActive.keys());
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
      active: input.active,
      variantOrder: index,
      updatedAt: now(),
    };
    if (input.id === undefined) {
      await tx.insert(products).values({
        ...values,
        parentId: productId,
        catalogueId: parent.catalogueId,
        soldAlone: true,
        ...blankInherited(values),
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

/**
 * The line an offer sells, as `resolveMenuVariant` resolves it: the three names of the offer's
 * product beside the chosen variant's own three, and the price charged.
 */
export interface SelectedName extends ProductPresentation {
  /** The product sold: the chosen variant, or the offer's product when it has no Active variant. */
  productId: string;
  unitPrice: string;
}

/** The selling values the order path prices, taxes and routes a line by, typed as the caller's
 * offer types them (the module contract's offer carries `vatClass` as a plain string). */
export interface SellingValues<
  Unit = MenuOffer["unit"],
  Vat extends string = MenuOffer["vatClass"],
> {
  unit: Unit;
  vatClass: Vat;
  category: string | null;
  courseId: string | null;
}

/**
 * {@link SelectedName} plus the chosen row's EFFECTIVE selling values — a variant's own, or its
 * parent's where it leaves one blank (`variant-fallback.ts`), as the offer carries them.
 */
export type SelectedVariant<
  Unit = MenuOffer["unit"],
  Vat extends string = MenuOffer["vatClass"],
> = SelectedName & SellingValues<Unit, Vat>;

/**
 * The line an offer sells (spec §4.5): the chosen variant, or the offer's product itself when it
 * lists no variant (spec §15.1). Decided from the offer alone: `offer.variants` holds only Active
 * variants, each flagged `available` when it may be sold on this menu now.
 */
export function selectMenuVariant<Unit, Vat extends string>(
  offer: SellingValues<Unit, Vat> & {
    productId: string;
    name: string;
    customerName: Readonly<Record<string, string>> | null;
    kitchenName: string | null;
    unitPrice: string;
    variants: readonly (SellingValues<Unit, Vat> & {
      id: string;
      name: string;
      customerName: Readonly<Record<string, string>> | null;
      kitchenName: string | null;
      unitPrice: string;
      available: boolean;
    })[];
  },
  variantId: string | null,
): SelectedVariant<Unit, Vat> {
  const parentNames = {
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
  };
  if (variantId === null) {
    if (offer.variants.length > 0) {
      throw new AppError("product.variant_required", { productId: offer.productId });
    }
    return {
      productId: offer.productId,
      ...parentNames,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: offer.unitPrice,
      unit: offer.unit,
      vatClass: offer.vatClass,
      category: offer.category,
      courseId: offer.courseId,
    };
  }
  const variant = offer.variants.find((candidate) => candidate.id === variantId);
  if (!variant?.available) throw new AppError("product.variant_unavailable", { variantId });
  return {
    productId: variant.id,
    ...parentNames,
    variantName: variant.name,
    variantCustomerName: variant.customerName,
    variantKitchenName: variant.kitchenName,
    unitPrice: variant.unitPrice,
    unit: variant.unit,
    vatClass: variant.vatClass,
    category: variant.category,
    courseId: variant.courseId,
  };
}

export async function resolveMenuVariant(
  tx: Transaction,
  menuItemId: string,
  variantId: string | null,
): Promise<SelectedName> {
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
      menuPrice: menuItems.grossPrice,
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
      productId: offer.productId,
      name: offer.name,
      customerName: offer.customerName,
      kitchenName: offer.kitchenName,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      // No variant: the chain's last two steps, this menu's price else the product's own.
      unitPrice: resolveOfferPrice({
        variantMenuPrice: null,
        variantPrice: null,
        parentMenuPrice: priceOrNull(offer.menuPrice),
        parentPrice: centsToDecimal(offer.productPrice),
      }),
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
    productId: variantId,
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    variantName: variant.name,
    variantCustomerName: variant.customerName,
    variantKitchenName: variant.kitchenName,
    unitPrice: resolveOfferPrice({
      variantMenuPrice: priceOrNull(override?.price ?? null),
      variantPrice: variant.unitPrice === null ? null : decimal(variant.unitPrice),
      parentMenuPrice: priceOrNull(offer.menuPrice),
      parentPrice: centsToDecimal(offer.productPrice),
    }),
  };
}
