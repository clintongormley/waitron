import { and, eq } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError, type TenantId } from "@waitron/shared";
import { readProductCategories, replaceProductCategories } from "./categories.js";
import { validateContentTranslations } from "./content-languages.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import {
  createProduct,
  listProductOptionGroupIds,
  setProductOptionGroups,
  updateProduct,
} from "./operations.js";
import { readProductUnitId } from "./units.js";
import { listProductVariants, setProductVariants, type ProductVariant } from "./variants.js";
import { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
export { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
import type { VatClass } from "./pricing.js";
import "./errors.js";

export type ProductEditorValue = Omit<ProductEditorInput, "variants"> & {
  id: string;
  variants: ProductVariant[];
  stationId: string | null;
  courseId: string | null;
};
const columns = {
  id: products.id,
  name: products.descriptions,
  description: products.description,
  kitchenName: products.kitchenName,
  image: products.image,
  unitPrice: products.unitPrice,
  available: products.active,
  vatClass: products.vatClass,
  allergens: products.manualAllergens,
  dietaryDeclarations: products.dietaryDeclarations,
  stationId: products.stationId,
  courseId: products.courseId,
};

export async function readProductEditor(
  tx: Transaction,
  tenantId: TenantId,
  productId: string,
): Promise<ProductEditorValue> {
  const [row] = await tx
    .select(columns)
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  if (!row) throw new AppError("product.not_found", { productId });
  const categories = await readProductCategories(tx, tenantId, productId);
  return {
    ...row,
    vatClass: row.vatClass as VatClass,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    unitId: await readProductUnitId(tx, tenantId, productId),
    ...categories,
    modifierIds: await listProductOptionGroupIds(tx, tenantId, productId),
    variants: await listProductVariants(tx, tenantId, productId),
  };
}

/** No section commits independently: a rejected association rolls back the complete product. */
export async function saveProductEditor(
  tx: Transaction,
  tenantId: TenantId,
  productId: string | null,
  catalogueId: string,
  input: unknown,
  fallbackLanguage: string,
): Promise<ProductEditorValue> {
  const value = parseProductEditorInput(input);
  await validateContentTranslations(tx, tenantId, value.name, fallbackLanguage);
  if (productId !== null) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .for("update");
    if (!product) throw new AppError("product.not_found", { productId });
  } else {
    const [catalogue] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(and(eq(catalogues.tenantId, tenantId), eq(catalogues.id, catalogueId)));
    if (!catalogue) throw new AppError("catalogue.not_found", { catalogueId });
  }
  if (productId === null) {
    const created = await createProduct(tx, tenantId, {
      catalogueId,
      categoryId: null,
      descriptions: value.name,
      description: value.description,
      kitchenName: value.kitchenName,
      unitId: value.unitId,
      unitPrice: value.unitPrice,
      vatClass: value.vatClass,
      active: value.available,
      ...(value.image === null ? {} : { image: value.image }),
      ...(value.allergens === null ? {} : { allergens: value.allergens }),
      dietaryDeclarations: value.dietaryDeclarations,
    });
    productId = created.id;
  } else {
    await updateProduct(tx, tenantId, productId, {
      descriptions: value.name,
      description: value.description,
      kitchenName: value.kitchenName,
      unitId: value.unitId,
      unitPrice: value.unitPrice,
      vatClass: value.vatClass,
      active: value.available,
      image: value.image,
      allergens: value.allergens,
      dietaryDeclarations: value.dietaryDeclarations,
    });
  }
  await replaceProductCategories(tx, tenantId, productId, {
    categoryIds: value.categoryIds,
    primaryCategoryId: value.primaryCategoryId,
  });
  await setProductVariants(tx, tenantId, productId, value.variants, fallbackLanguage);
  await setProductOptionGroups(tx, tenantId, productId, value.modifierIds);
  return readProductEditor(tx, tenantId, productId);
}
