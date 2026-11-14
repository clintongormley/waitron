import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, colorOrNull, VAT_CLASSES, type VatClass } from "@waitron/shared";
import { catalogueSettings } from "@waitron/db";
import "./errors.js";

import type { CatalogueSettings } from "./settings-types.js";
export type { CatalogueSettings } from "./settings-types.js";

const SETTINGS_COLUMNS = {
  defaultProductVatClass: catalogueSettings.defaultProductVatClass,
  defaultColor: catalogueSettings.defaultColor,
};

export async function readCatalogueSettings(tx: Transaction): Promise<CatalogueSettings> {
  const [row] = await tx
    .select(SETTINGS_COLUMNS)
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
    .returning(SETTINGS_COLUMNS);
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
