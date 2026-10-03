import { eq } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { setMainReportingCategory } from "./categories.js";
import { assertContentTranslations, readContentLanguages } from "./content-languages.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import { createProduct, updateProduct } from "./operations.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import { productUnits } from "./schema/units.js";
import { priceOrNull } from "./offer-price.js";
import { productWithId } from "./variant-fallback.js";
import { listProductVariants, writeProductVariants } from "./variants.js";
import { parseProductEditorInput } from "./product-editor-input.js";
export { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
import type { InheritedValues, ProductEditorValue } from "./product-types.js";
export type { InheritedValues, ProductEditorValue } from "./product-types.js";
import type { VatClass } from "./vat-rates.js";
import "./errors.js";

/** The row as stored: a variant's blanks read blank here, never as its parent's. */
const columns = {
  id: products.id,
  parentId: products.parentId,
  name: products.name,
  customerName: products.customerName,
  ordering: products.ordering,
  description: products.description,
  kitchenName: products.kitchenName,
  image: products.image,
  unitPrice: products.unitPrice,
  active: products.active,
  available: products.available,
  vatClass: products.vatClass,
  allergens: products.manualAllergens,
  dietaryDeclarations: products.dietaryDeclarations,
  courseId: products.courseId,
  unitId: productUnits.unitId,
  primaryCategoryId: products.categoryId,
};

/** The row as stored, and beside it the PUBLISHED allergens (the manual overlay merged with the
 * recipe derivation, or null when not yet reviewed), which the editor's `allergens` field does not
 * carry. */
async function readStored(tx: Transaction, productId: string) {
  const [row] = await tx
    .select({ ...columns, publishedAllergens: products.allergens })
    .from(products)
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .where(eq(products.id, productId));
  if (!row) throw new AppError("product.not_found", { productId });
  const { publishedAllergens, ...stored } = row;
  return {
    stored: {
      ...stored,
      unitPrice: priceOrNull(stored.unitPrice),
      vatClass: stored.vatClass as VatClass | null,
      dietaryDeclarations:
        stored.dietaryDeclarations === null
          ? null
          : validateDietaryDeclarations(stored.dietaryDeclarations),
    },
    publishedAllergens,
  };
}

/** A parent's value for each field its variants inherit. A parent has no parent of its own, so
 * `products_top_level_owns_ck` sets its price, VAT class and dietary declarations. */
async function readInherited(tx: Transaction, parentId: string): Promise<InheritedValues> {
  const { stored: parent, publishedAllergens } = await readStored(tx, parentId);
  return {
    description: parent.description,
    image: parent.image,
    unitPrice: parent.unitPrice!,
    vatClass: parent.vatClass!,
    unitId: parent.unitId,
    primaryCategoryId: parent.primaryCategoryId,
    courseId: parent.courseId,
    allergens: publishedAllergens,
    dietaryDeclarations: parent.dietaryDeclarations!,
  };
}

/** A product's editor value, or a variant's: its own stored values, and its parent's beside them.
 * A variant has no category of its own, so a category it still stores is never read back. */
export async function readProductEditor(
  tx: Transaction,
  productId: string,
): Promise<ProductEditorValue> {
  const { stored: row } = await readStored(tx, productId);
  if (row.parentId !== null) {
    return {
      ...row,
      primaryCategoryId: null,
      inherited: await readInherited(tx, row.parentId),
      modifiers: [],
      variants: [],
    };
  }
  return {
    ...row,
    inherited: null,
    // `readProductModifiers` keys its map by the LOWER-CASED product id, so an upper-cased
    // `productId` argument would find nothing.
    modifiers: (await readProductModifiers(tx, [productId])).get(productId.toLowerCase()) ?? [],
    variants: await listProductVariants(tx, productId),
  };
}

/** No section commits independently: a rejected association rolls back the complete product. */
export async function saveProductEditor(
  tx: Transaction,
  productId: string | null,
  catalogueId: string,
  input: unknown,
  fallbackLanguage: string,
): Promise<ProductEditorValue> {
  // An update reads the stored row first, because whether the body may leave inherited fields
  // blank depends on it; a create has no stored row and parses first.
  let storedParentId: string | null = null;
  if (productId !== null) {
    const [product] = await tx
      .select({ parentId: products.parentId })
      .from(products)
      .where(productWithId(productId, "any"));
    if (!product) throw new AppError("product.not_found", { productId });
    storedParentId = product.parentId;
  }
  const isVariant = storedParentId !== null;
  const value = parseProductEditorInput(input, { isVariant });
  if (value.parentId !== undefined && value.parentId !== storedParentId)
    throw new AppError("product.invalid", { field: "parentId" });
  // The staff `name` is plain required text, checked by the parser; the customer-facing name is what
  // must satisfy the default content language. A blank one is legal (it falls back to `name`), so
  // only a supplied customer name is validated. A variant saved Inactive is skipped, as its
  // product's save skips it (`writeProductVariants`), so removing it is never refused for its
  // customer name; it is checked on every save as Active.
  const config = await readContentLanguages(tx, fallbackLanguage);
  if (value.customerName !== null && (!isVariant || value.active))
    assertContentTranslations([value.customerName], config);
  if (productId === null) {
    const [catalogue] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(eq(catalogues.id, catalogueId));
    if (!catalogue) throw new AppError("catalogue.not_found", { catalogueId });
  }
  if (productId === null) {
    const created = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: value.name,
      customerName: value.customerName,
      description: value.description,
      kitchenName: value.kitchenName,
      unitId: value.unitId,
      // The parser refuses a blank on a product with no parent, which every created one is.
      unitPrice: value.unitPrice!,
      vatClass: value.vatClass!,
      active: value.active,
      available: value.available,
      ordering: value.ordering,
      ...(value.image === null ? {} : { image: value.image }),
      ...(value.allergens === null ? {} : { allergens: value.allergens }),
      dietaryDeclarations: value.dietaryDeclarations!,
    });
    productId = created.id;
  } else {
    await updateProduct(tx, productId, {
      name: value.name,
      customerName: value.customerName,
      description: value.description,
      kitchenName: value.kitchenName,
      unitId: value.unitId,
      unitPrice: value.unitPrice,
      vatClass: value.vatClass,
      active: value.active,
      available: value.available,
      ordering: value.ordering,
      image: value.image,
      allergens: value.allergens,
      dietaryDeclarations: value.dietaryDeclarations,
    });
  }
  if (isVariant) {
    // A variant's category is always its parent's, so it stores none.
    await tx
      .update(products)
      .set({ categoryId: null, updatedAt: now() })
      .where(eq(products.id, productId));
  } else {
    await setMainReportingCategory(tx, productId, value.primaryCategoryId);
    await writeProductVariants(tx, productId, value.variants, config);
    await writeProductModifiers(tx, productId, value.modifiers);
  }
  return readProductEditor(tx, productId);
}
