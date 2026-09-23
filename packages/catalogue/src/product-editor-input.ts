import { AppError, contentLanguageCode, decimal, isUuid, toScale } from "@waitron/shared";
import { validateAllergens } from "./allergens.js";
import { isProductPrice } from "./modifier-limits.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import { nonBlankTranslations } from "./product-presentation.js";
import { isModifierListKind } from "./product-modifiers.js";
import type { ProductVariantInput } from "./variants.js";
import { VAT_CLASSES, type VatClass } from "./pricing.js";
import type { ProductEditorInput, ProductModifierRef } from "./product-types.js";
export type { ProductEditorInput } from "./product-types.js";
import "./errors.js";

function invalid(field: string): never {
  throw new AppError("product.invalid", { field });
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function translations(value: unknown, field: string): Record<string, string> {
  const entries = Object.entries(object(value, field));
  for (const [language, text] of entries) {
    contentLanguageCode(language);
    if (typeof text !== "string") invalid(field);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}
/** `null` (the Each option) parses to null; any other value must be a uuid, or it throws. */
function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : id(value, field);
}
function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(field);
  const values = value.map((value) => id(value, field));
  if (new Set(values).size !== values.length) invalid(field);
  return values;
}
/**
 * The product's ordered attachment list: each entry names one list and which KIND of list it is, and
 * the array's order is the order a diner is offered them. Ids are lower-cased by {@link id}, so a
 * duplicate that differs only in case is still a duplicate — the same normalisation
 * `writeProductModifiers` (product-modifiers.ts) applies before it writes.
 *
 * A repeated (kind, id) pair is refused rather than collapsed: the list is ordered, so a caller who
 * sent the same list twice meant something this model cannot express, and the write side refuses it
 * too (`assertRefsExist`, product-modifiers.ts). The same id under the two DIFFERENT kinds is two
 * different lists and is allowed.
 *
 * Refusals name the entry (`modifiers.0.kind`), not the whole field, which is how the sibling
 * `variants` screen below reports and what `assertRefsExist` throws when the ids are checked against
 * the stored lists. Only a problem with the array ITSELF names the bare field.
 *
 * What this does NOT check is that the ids name real lists — that needs the transaction, and it is
 * `assertRefsExist`'s job at write time.
 */
function modifiers(value: unknown, field: string): ProductModifierRef[] {
  if (!Array.isArray(value)) invalid(field);
  const seen = new Set<string>();
  return value.map((entry, index): ProductModifierRef => {
    const at = `${field}.${index}`;
    const ref = object(entry, at);
    if (!isModifierListKind(ref.kind)) invalid(`${at}.kind`);
    const listId = id(ref.id, `${at}.id`);
    const key = `${ref.kind}\u0000${listId}`;
    if (seen.has(key)) invalid(`${at}.id`);
    seen.add(key);
    return { kind: ref.kind, id: listId };
  });
}
function price(value: unknown, field: string): string {
  if (typeof value !== "string" || !isProductPrice(value)) invalid(field);
  return toScale(decimal(value), 2);
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalid(field);
  return value.trim() || null;
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(field);
  return value.trim();
}
/** Optional translated text: null/absent or an all-blank map means "no value" (falls back to name). */
function nullableTranslations(value: unknown, field: string): Record<string, string> | null {
  if (value === null || value === undefined) return null;
  return nonBlankTranslations(translations(value, field));
}

/** `null` is a variant's blank; a product with no parent refuses it as malformed. */
function inheritable<T>(
  value: unknown,
  field: string,
  isVariant: boolean,
  parse: (value: unknown, field: string) => T,
): T | null {
  return isVariant && value === null ? null : parse(value, field);
}
function vatClass(value: unknown, field: string): VatClass {
  if (!VAT_CLASSES.includes(value as VatClass)) invalid(field);
  return value as VatClass;
}
/** A variant has no variants or attached lists of its own (spec §4.4), so only an empty one is taken. */
function emptyOnVariant<T>(values: T[], field: string, isVariant: boolean): T[] {
  if (isVariant && values.length > 0) invalid(field);
  return values;
}

/**
 * Parse the complete write body before touching storage; reference ownership is checked in the
 * transaction, and so is `parentId` against the stored parent. `isVariant` is the STORED row's.
 */
export function parseProductEditorInput(
  value: unknown,
  { isVariant }: { isVariant: boolean },
): ProductEditorInput {
  const body = object(value, "product");
  const parentId =
    body.parentId === undefined ? {} : { parentId: nullableId(body.parentId, "parentId") };
  const name = requiredText(body.name, "name");
  const customerName = nullableTranslations(body.customerName, "customerName");
  const soldAlone = boolean(body.soldAlone, "soldAlone");
  const description =
    body.description === null ? null : translations(body.description, "description");
  const unitId = nullableId(body.unitId, "unitId");
  const categoryIds = ids(body.categoryIds, "categoryIds");
  // The two fields the ordered `modifiers` list replaced. A body carrying either is refused rather
  // than having it ignored: ignoring would save a product with NO attachments and report success,
  // the one outcome a caller still on the old contract could not tell from having worked.
  for (const legacy of ["modifierIds", "optionGroupIds"] as const)
    if (body[legacy] !== undefined) invalid(legacy);
  const attachments = emptyOnVariant(
    modifiers(body.modifiers, "modifiers"),
    "modifiers",
    isVariant,
  );
  const primaryCategoryId =
    body.primaryCategoryId === null ? null : id(body.primaryCategoryId, "primaryCategoryId");
  if (
    categoryIds.length
      ? primaryCategoryId !== null && !categoryIds.includes(primaryCategoryId)
      : primaryCategoryId !== null
  )
    invalid("primaryCategoryId");
  const tax = inheritable(body.vatClass, "vatClass", isVariant, vatClass);
  if (!Array.isArray(body.variants)) invalid("variants");
  const listed = emptyOnVariant(body.variants, "variants", isVariant);
  const seen = new Set<string>();
  const variants = listed.map((value, index): ProductVariantInput => {
    const field = `variants.${index}`;
    const variant = object(value, field);
    const variantId = variant.id === undefined ? undefined : id(variant.id, `${field}.id`);
    if (variantId !== undefined) {
      if (seen.has(variantId)) invalid(`${field}.id`);
      seen.add(variantId);
    }
    return {
      ...(variantId === undefined ? {} : { id: variantId }),
      name: requiredText(variant.name, `${field}.name`),
      customerName: nullableTranslations(variant.customerName, `${field}.customerName`),
      kitchenName: nullableText(variant.kitchenName, `${field}.kitchenName`),
      image: nullableText(variant.image, `${field}.image`),
      // Every listed entry is a variant, so a blank price follows the product's (spec §15.3).
      unitPrice: inheritable(variant.unitPrice, `${field}.unitPrice`, true, price),
      available: boolean(variant.available, `${field}.available`),
    };
  });
  const allergens =
    body.allergens === null
      ? null
      : Object.fromEntries(
          Object.entries(validateAllergens(body.allergens)).map(([code, entry]) => [
            code,
            { presence: entry.presence },
          ]),
        );
  return {
    ...parentId,
    name,
    customerName,
    soldAlone,
    description: nonBlankTranslations(description),
    kitchenName: nullableText(body.kitchenName, "kitchenName"),
    image: nullableText(body.image, "image"),
    unitId,
    unitPrice: inheritable(body.unitPrice, "unitPrice", isVariant, price),
    active: boolean(body.active, "active"),
    available: boolean(body.available, "available"),
    vatClass: tax,
    variants,
    categoryIds,
    primaryCategoryId,
    modifiers: attachments,
    allergens,
    dietaryDeclarations: inheritable(
      body.dietaryDeclarations,
      "dietaryDeclarations",
      isVariant,
      validateDietaryDeclarations,
    ),
  };
}
