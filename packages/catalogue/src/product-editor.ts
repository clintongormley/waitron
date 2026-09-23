import { eq } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { categoryIdArray, replaceProductCategories } from "./categories.js";
import { validateContentTranslations } from "./content-languages.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import { createProduct, updateProduct } from "./operations.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import { productCategories } from "./schema/categories.js";
import { productUnits } from "./schema/units.js";
import { priceOrNull } from "./offer-price.js";
import { productWithId } from "./variant-fallback.js";
import { listProductVariants, setProductVariants } from "./variants.js";
import { parseProductEditorInput } from "./product-editor-input.js";
export { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
import type { InheritedValues, ProductEditorValue } from "./product-types.js";
export type { InheritedValues, ProductEditorValue } from "./product-types.js";
import type { VatClass } from "./pricing.js";
import "./errors.js";

/** The row as stored: a variant's blanks read blank here, never as its parent's. */
const columns = {
  id: products.id,
  parentId: products.parentId,
  name: products.name,
  customerName: products.customerName,
  soldAlone: products.soldAlone,
  description: products.description,
  kitchenName: products.kitchenName,
  image: products.image,
  unitPrice: products.unitPrice,
  active: products.active,
  available: products.available,
  vatClass: products.vatClass,
  allergens: products.manualAllergens,
  dietaryDeclarations: products.dietaryDeclarations,
  stationId: products.stationId,
  courseId: products.courseId,
  unitId: productUnits.unitId,
  primaryCategoryId: products.categoryId,
  categoryIds: categoryIdArray,
};

/** The row as stored, and beside it the PUBLISHED allergens (the manual overlay merged with the
 * recipe derivation, or null when not yet reviewed), which the editor's `allergens` field does not
 * carry. */
async function readStored(tx: Transaction, productId: string) {
  const [row] = await tx
    .select({ ...columns, publishedAllergens: products.allergens })
    .from(products)
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .leftJoin(productCategories, eq(productCategories.productId, products.id))
    .where(eq(products.id, productId))
    .groupBy(products.id);
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
    categoryIds: parent.categoryIds,
    primaryCategoryId: parent.primaryCategoryId,
    stationId: parent.stationId,
    courseId: parent.courseId,
    allergens: publishedAllergens,
    dietaryDeclarations: parent.dietaryDeclarations!,
  };
}

/** A product's editor value, or a variant's: its own stored values, and its parent's beside them. */
export async function readProductEditor(
  tx: Transaction,
  productId: string,
): Promise<ProductEditorValue> {
  const { stored: row } = await readStored(tx, productId);
  if (row.parentId !== null) {
    return {
      ...row,
      inherited: await readInherited(tx, row.parentId),
      modifiers: [],
      variants: [],
    };
  }
  return {
    ...row,
    inherited: null,
    // `readProductModifiers` keys its map by the LOWER-CASED product id the uuid column hands back,
    // so an upper-cased `productId` argument would find nothing; lower-case it for the lookup.
    modifiers: (await readProductModifiers(tx, [productId])).get(productId.toLowerCase()) ?? [],
    // Active variants only: a save sends back every variant it received and makes each Active, so
    // listing an Inactive one here would restore it on the parent's next save.
    variants: (await listProductVariants(tx, productId)).filter((variant) => variant.active),
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
  // must satisfy the enabled languages. A blank one is legal (it falls back to `name`), so only a
  // supplied customer name is validated — validateContentTranslations({}) would wrongly demand a
  // default-language entry.
  if (value.customerName !== null)
    await validateContentTranslations(tx, value.customerName, fallbackLanguage);
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
      soldAlone: value.soldAlone,
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
      soldAlone: value.soldAlone,
      image: value.image,
      allergens: value.allergens,
      dietaryDeclarations: value.dietaryDeclarations,
    });
  }
  // The row is known here (found above, or just created), so the scope only has to admit a variant.
  await replaceProductCategories(
    tx,
    productId,
    { categoryIds: value.categoryIds, primaryCategoryId: value.primaryCategoryId },
    "any",
  );
  if (!isVariant) {
    await setProductVariants(tx, productId, value.variants, fallbackLanguage);
    await writeProductModifiers(tx, productId, value.modifiers);
  }
  return readProductEditor(tx, productId);
}
