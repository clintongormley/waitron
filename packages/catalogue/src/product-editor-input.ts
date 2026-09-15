import { AppError, contentLanguageCode, decimal, isUuid, toScale } from "@waitron/shared";
import { validateAllergens, type ProductAllergens } from "./allergens.js";
import { validateDietaryDeclarations, type DietaryLabel } from "./dietary-declarations.js";
import type { ProductVariantInput } from "./variants.js";
import type { VatClass } from "./pricing.js";
import "./errors.js";

export interface ProductEditorInput {
  name: Record<string, string>;
  description: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
  unitId: string | null;
  unitPrice: string;
  available: boolean;
  vatClass: VatClass;
  variants: ProductVariantInput[];
  categoryIds: string[];
  primaryCategoryId: string | null;
  modifierIds: string[];
  allergens: ProductAllergens | null;
  dietaryDeclarations: DietaryLabel[];
}

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
function price(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) invalid(field);
  return toScale(decimal(value), 2);
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(field);
  return value.trim() || null;
}

/** Parse the complete write body before touching storage; reference ownership is checked in the transaction. */
export function parseProductEditorInput(value: unknown): ProductEditorInput {
  const body = object(value, "product");
  const name = translations(body.name, "name");
  const description =
    body.description === null ? null : translations(body.description, "description");
  const unitId = nullableId(body.unitId, "unitId");
  const categoryIds = ids(body.categoryIds, "categoryIds");
  const modifierIds = ids(body.modifierIds, "modifierIds");
  const primaryCategoryId =
    body.primaryCategoryId === null ? null : id(body.primaryCategoryId, "primaryCategoryId");
  if (
    categoryIds.length
      ? primaryCategoryId !== null && !categoryIds.includes(primaryCategoryId)
      : primaryCategoryId !== null
  )
    invalid("primaryCategoryId");
  if (
    typeof body.vatClass !== "string" ||
    !["general", "reduced", "super_reduced", "zero"].includes(body.vatClass)
  )
    invalid("vatClass");
  if (!Array.isArray(body.variants)) invalid("variants");
  const seen = new Set<string>();
  const variants = body.variants.map((value, index): ProductVariantInput => {
    const field = `variants.${index}`;
    const variant = object(value, field);
    const variantId = variant.id === undefined ? undefined : id(variant.id, `${field}.id`);
    if (variantId !== undefined) {
      if (seen.has(variantId)) invalid(`${field}.id`);
      seen.add(variantId);
    }
    return {
      ...(variantId === undefined ? {} : { id: variantId }),
      name: translations(variant.name, `${field}.name`),
      unitPrice: price(variant.unitPrice, `${field}.unitPrice`),
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
    name,
    description:
      description && Object.values(description).some((text) => text.trim()) ? description : null,
    kitchenName: nullableText(body.kitchenName, "kitchenName"),
    image: nullableText(body.image, "image"),
    unitId,
    unitPrice: price(body.unitPrice, "unitPrice"),
    available: boolean(body.available, "available"),
    vatClass: body.vatClass as VatClass,
    variants,
    categoryIds,
    primaryCategoryId,
    modifierIds,
    allergens,
    dietaryDeclarations: validateDietaryDeclarations(body.dietaryDeclarations),
  };
}
