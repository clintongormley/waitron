import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { colorOrNull } from "./color-inheritance.js";
import { catalogueSettings } from "./schema/settings.js";
import { VAT_CLASSES, type VatClass } from "./vat-rates.js";
import "./errors.js";

import type { CatalogueSettings } from "./settings-types.js";
export type { CatalogueSettings } from "./settings-types.js";

export async function readCatalogueSettings(tx: Transaction): Promise<CatalogueSettings> {
  const [row] = await tx
    .select({
      defaultProductVatClass: catalogueSettings.defaultProductVatClass,
      defaultColor: catalogueSettings.defaultColor,
    })
    .from(catalogueSettings)
    .where(eq(catalogueSettings.id, 1));
  return row ?? { defaultProductVatClass: "general", defaultColor: null };
}

async function upsertSettings(
  tx: Transaction,
  values: Partial<CatalogueSettings>,
): Promise<CatalogueSettings> {
  const [row] = await tx
    .insert(catalogueSettings)
    .values(values)
    .onConflictDoUpdate({ target: catalogueSettings.id, set: values })
    .returning({
      defaultProductVatClass: catalogueSettings.defaultProductVatClass,
      defaultColor: catalogueSettings.defaultColor,
    });
  return row!;
}

export async function saveCatalogueSettings(
  tx: Transaction,
  input: { defaultProductVatClass: unknown },
): Promise<CatalogueSettings> {
  const value = input.defaultProductVatClass;
  if (typeof value !== "string" || !VAT_CLASSES.includes(value as VatClass))
    throw new AppError("product.invalid", { field: "defaultProductVatClass" });
  return upsertSettings(tx, { defaultProductVatClass: value as VatClass });
}

export async function saveCatalogueDefaultColor(
  tx: Transaction,
  color: unknown,
): Promise<CatalogueSettings> {
  const defaultColor = colorOrNull(color, () => {
    throw new AppError("category.invalid", { field: "color" });
  });
  return upsertSettings(tx, { defaultColor });
}
