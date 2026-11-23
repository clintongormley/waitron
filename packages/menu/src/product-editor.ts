import { eq, inArray } from "drizzle-orm";
import {
  decodeSettingsRow,
  now,
  products,
  settings,
  VENUE_SETTINGS,
  type Transaction,
} from "@waitron/db";
import { AppError, validateDietaryDeclarations } from "@waitron/shared";
import { readCategory } from "./categories.js";
import { contentLanguagesOr, savedContentLanguagesIn } from "./content-languages.js";
import { mergeOptionalTranslations } from "./optional-translations.js";
import {
  createProductSkippingNameCheck,
  updateProduct,
  updateProductSkippingNameCheck,
} from "./operations.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import { priceOrNull } from "./offer-price.js";
import { archiveProducts } from "./archive.js";
import { MENU_SETTINGS } from "./settings.js";
import { assertFamilyNamesFree, readUpdatedName, type StoredName } from "./product-names.js";
import { listProductVariants, writeProductVariantsSkippingNameCheck } from "./variants.js";
import { parseProductEditorInput } from "./product-editor-input.js";
import {
  readOwnTakeawayVatSchedules,
  readVenueVatRates,
  setTakeawayVatRate,
  takeawayVatRatesToday,
} from "./takeaway-vat-rates.js";
export { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";
import type { InheritedValues, ProductEditorValue, VatClass } from "@waitron/shared";
export type { InheritedValues, ProductEditorValue } from "@waitron/shared";
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
  allergens: products.allergens,
  dietaryDeclarations: products.dietaryDeclarations,
  courseId: products.courseId,
  unitId: products.unitId,
  primaryCategoryId: products.categoryId,
  color: products.color,
};

async function readStored(tx: Transaction, productId: string) {
  const [row] = await tx.select(columns).from(products).where(eq(products.id, productId));
  if (!row) throw new AppError("product.not_found", { productId });
  const stored = row;
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
  };
}

/** A parent has no parent of its own, so `products_top_level_owns_ck` sets its price, VAT class
 * and dietary declarations. */
async function readInherited(
  tx: Transaction,
  parentId: string,
  takeawayVatRate: string,
): Promise<InheritedValues> {
  const { stored: parent } = await readStored(tx, parentId);
  return {
    name: parent.name,
    description: parent.description,
    image: parent.image,
    unitPrice: parent.unitPrice!,
    vatClass: parent.vatClass!,
    takeawayVatRate,
    unitId: parent.unitId,
    primaryCategoryId: parent.primaryCategoryId,
    courseId: parent.courseId,
    allergens: parent.allergens,
    dietaryDeclarations: parent.dietaryDeclarations!,
  };
}

/** Today's takeaway rate of the product's own rows, and of its parent's when it has one. A variant
 * without rows of its own is absent; a product with no parent always has one. */
async function takeawayRatesOf(
  tx: Transaction,
  productId: string,
  parentId: string | null,
): Promise<Map<string, string>> {
  const topLevel = parentId ?? productId;
  const own = await readOwnTakeawayVatSchedules(tx, [...new Set([productId, topLevel])]);
  // An empty list makes `takeawayVatRatesToday` refuse a product with no parent and no rows.
  if (!own.has(topLevel)) own.set(topLevel, []);
  return takeawayVatRatesToday(tx, own);
}

/** A product's editor value, or a variant's: its own stored values, and its parent's beside them.
 * A variant has no category, unit or colour of its own, so one it still stores is never read back. */
export async function readProductEditor(
  tx: Transaction,
  productId: string,
): Promise<ProductEditorValue> {
  const { stored: row } = await readStored(tx, productId);
  const rates = await takeawayRatesOf(tx, row.id, row.parentId);
  if (row.parentId !== null) {
    return {
      ...row,
      takeawayVatRate: rates.get(row.id) ?? null,
      primaryCategoryId: null,
      unitId: null,
      color: null,
      inherited: await readInherited(tx, row.parentId, rates.get(row.parentId)!),
      modifiers: [],
      variants: [],
    };
  }
  return {
    ...row,
    takeawayVatRate: rates.get(row.id)!,
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
  input: unknown,
  fallbackLanguage: string,
  personId: string | null = null,
): Promise<ProductEditorValue> {
  // An update reads the stored row first, because whether the body may leave inherited fields
  // blank depends on it; a create has no stored row and parses first.
  let storedParentId: string | null = null;
  let stored: StoredName | null = null;
  if (productId !== null) {
    const product = await readUpdatedName(tx, productId);
    if (!product) throw new AppError("product.not_found", { productId });
    if (!product.active || product.parentActive === false)
      throw new AppError("product.archived", { productId });
    storedParentId = product.parentId;
    stored = product;
  }
  const isVariant = storedParentId !== null;
  const value = parseProductEditorInput(input, { isVariant });
  if (value.parentId !== undefined && value.parentId !== storedParentId)
    throw new AppError("product.invalid", { field: "parentId" });
  // Archiving preserves the stored details, rather than rewriting the editor's draft.
  if (productId !== null && !value.active) {
    await archiveProducts(tx, [productId], personId);
    return readProductEditor(tx, productId);
  }
  // One read for both documents: a create also needs the menu settings' hidden eat-in class.
  const settingsRows = await tx
    .select({
      module: settings.module,
      version: settings.version,
      revision: settings.revision,
      doc: settings.doc,
    })
    .from(settings)
    .where(inArray(settings.module, [VENUE_SETTINGS.module, MENU_SETTINGS.module]));
  const settingsRow = (module: string) => settingsRows.find((row) => row.module === module);
  const venue = decodeSettingsRow(settingsRow(VENUE_SETTINGS.module), VENUE_SETTINGS);
  const config = contentLanguagesOr(savedContentLanguagesIn(venue.doc), fallbackLanguage);
  const body = input as Record<string, unknown>;
  if (productId !== null) {
    const [previous] = await tx
      .select({ customerName: products.customerName })
      .from(products)
      .where(eq(products.id, productId));
    value.customerName =
      body.customerName === undefined
        ? previous!.customerName
        : mergeOptionalTranslations(
            previous!.customerName,
            body.customerName as Record<string, string> | null,
            config,
          );
  }
  // Preserve the supplied maps until merging so a cleared disabled key is still an explicit edit.
  const variantInputs = value.variants.map((variant, index) => ({
    ...variant,
    customerName: (body.variants as Record<string, unknown>[])[index]!.customerName as
      Record<string, string> | null | undefined,
  }));
  // A variant's own save changes one row, which `updateProduct` checks. A product's save is checked
  // here, whole, before anything is written, and the writes below skip their own row-by-row check.
  if (!isVariant)
    await assertFamilyNamesFree(
      tx,
      stored && { product: stored },
      { name: value.name, active: value.active },
      value.variants,
    );
  if (productId === null) {
    const created = await createProductSkippingNameCheck(
      tx,
      {
        categoryId: null,
        name: value.name,
        customerName: value.customerName,
        description: value.description,
        kitchenName: value.kitchenName,
        unitId: value.unitId,
        // The parser refuses a blank on a product with no parent, which every created one is.
        unitPrice: value.unitPrice!,
        vatClass: decodeSettingsRow(settingsRow(MENU_SETTINGS.module), MENU_SETTINGS).doc
          .defaultProductVatClass,
        takeawayVatRate: value.takeawayVatRate!,
        active: value.active,
        available: value.available ?? true,
        ordering: value.ordering,
        ...(value.image === null ? {} : { image: value.image }),
        ...(value.allergens === null ? {} : { allergens: value.allergens }),
        dietaryDeclarations: value.dietaryDeclarations!,
      },
      // With no venue saved, the create reads the settings again and refuses as `venue.not_found`.
      venue.revision === 0 ? undefined : venue.doc,
    );
    productId = created.id;
  } else {
    await (isVariant ? updateProduct : updateProductSkippingNameCheck)(tx, productId, {
      name: value.name,
      customerName: value.customerName,
      description: value.description,
      kitchenName: value.kitchenName,
      unitId: value.unitId,
      unitPrice: value.unitPrice,
      active: value.active,
      ...(value.available === undefined ? {} : { available: value.available }),
      ordering: value.ordering,
      image: value.image,
      allergens: value.allergens,
      dietaryDeclarations: value.dietaryDeclarations,
    });
    // Replacing the list erases its dated rows, so a save that sends back the rate the editor read
    // leaves them alone.
    const own = (await readOwnTakeawayVatSchedules(tx, [productId])).get(productId);
    const today =
      own === undefined
        ? null
        : (await takeawayVatRatesToday(tx, new Map([[productId, own]]))).get(productId)!;
    if (value.takeawayVatRate !== today)
      await setTakeawayVatRate(
        tx,
        productId,
        value.takeawayVatRate,
        await readVenueVatRates(tx, venue.revision === 0 ? undefined : venue.doc),
      );
  }
  if (isVariant) {
    // A variant's category and colour are always its parent's, so it stores neither.
    await tx
      .update(products)
      .set({ categoryId: null, color: null, updatedAt: now() })
      .where(eq(products.id, productId));
  } else {
    if (value.primaryCategoryId !== null) await readCategory(tx, value.primaryCategoryId);
    await tx
      .update(products)
      .set({ categoryId: value.primaryCategoryId, color: value.color, updatedAt: now() })
      .where(eq(products.id, productId));
    await writeProductVariantsSkippingNameCheck(tx, productId, variantInputs, config);
    await writeProductModifiers(tx, productId, value.modifiers);
  }
  return readProductEditor(tx, productId);
}
