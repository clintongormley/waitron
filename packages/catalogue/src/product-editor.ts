import { and, eq, isNull } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal } from "@waitron/shared";
import { categoryIdArray, replaceProductCategories } from "./categories.js";
import { validateContentTranslations } from "./content-languages.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import { createProduct, updateProduct } from "./operations.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import { productCategories } from "./schema/categories.js";
import { productUnits } from "./schema/units.js";
import {
  categoryOwnerJoin,
  effectiveProductColumns as effective,
  parentJoin,
  parentProducts,
  unitOwnerJoin,
} from "./variant-fallback.js";
import { listProductVariants, setProductVariants } from "./variants.js";
import { parseProductEditorInput } from "./product-editor-input.js";
export { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
import type { ProductEditorValue } from "./product-types.js";
export type { ProductEditorValue } from "./product-types.js";
import type { VatClass } from "./pricing.js";
import "./errors.js";

/** The product's own names and flags, and its EFFECTIVE inherited values (`variant-fallback.ts`). */
const columns = {
  id: products.id,
  name: products.name,
  customerName: products.customerName,
  soldAlone: products.soldAlone,
  description: effective.description,
  kitchenName: products.kitchenName,
  image: effective.image,
  unitPrice: effective.unitPrice,
  active: products.active,
  available: products.available,
  vatClass: effective.vatClass,
  allergens: effective.manualAllergens,
  dietaryDeclarations: effective.dietaryDeclarations,
  stationId: effective.stationId,
  courseId: effective.courseId,
  unitId: productUnits.unitId,
  primaryCategoryId: effective.categoryId,
  categoryIds: categoryIdArray,
};

export async function readProductEditor(
  tx: Transaction,
  productId: string,
): Promise<ProductEditorValue> {
  const [row] = await tx
    .select(columns)
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(productCategories, categoryOwnerJoin)
    .where(and(eq(products.id, productId), isNull(products.parentId)))
    .groupBy(products.id);
  if (!row) throw new AppError("product.not_found", { productId });
  return {
    ...row,
    unitPrice: centsToDecimal(row.unitPrice),
    vatClass: row.vatClass as VatClass,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
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
  const value = parseProductEditorInput(input);
  // The staff `name` is plain required text, checked by the parser; the customer-facing name is what
  // must satisfy the enabled languages. A blank one is legal (it falls back to `name`), so only a
  // supplied customer name is validated — validateContentTranslations({}) would wrongly demand a
  // default-language entry.
  if (value.customerName !== null)
    await validateContentTranslations(tx, value.customerName, fallbackLanguage);
  if (productId !== null) {
    // A plain existence read. It took `for update` on PostgreSQL, to serialise two saves of the
    // same product; one write transaction runs on the venue file at a time, so there is no second
    // save — the pattern is stated once on `assertExtraListForWrite` (extras.ts).
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), isNull(products.parentId)));
    if (!product) throw new AppError("product.not_found", { productId });
  } else {
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
      unitPrice: value.unitPrice,
      vatClass: value.vatClass,
      active: value.active,
      available: value.available,
      soldAlone: value.soldAlone,
      ...(value.image === null ? {} : { image: value.image }),
      ...(value.allergens === null ? {} : { allergens: value.allergens }),
      dietaryDeclarations: value.dietaryDeclarations,
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
  await replaceProductCategories(tx, productId, {
    categoryIds: value.categoryIds,
    primaryCategoryId: value.primaryCategoryId,
  });
  await setProductVariants(tx, productId, value.variants, fallbackLanguage);
  await writeProductModifiers(tx, productId, value.modifiers);
  return readProductEditor(tx, productId);
}
