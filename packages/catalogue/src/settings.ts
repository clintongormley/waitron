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

export async function saveCatalogueSettings(
  tx: Transaction,
  input: { defaultProductVatClass: unknown },
): Promise<CatalogueSettings> {
  const value = input.defaultProductVatClass;
  if (typeof value !== "string" || !VAT_CLASSES.includes(value as VatClass))
    throw new AppError("product.invalid", { field: "defaultProductVatClass" });
  const settings = { defaultProductVatClass: value as VatClass };
  await tx
    .insert(catalogueSettings)
    .values(settings)
    .onConflictDoUpdate({ target: catalogueSettings.id, set: settings });
  return readCatalogueSettings(tx);
}

export async function saveCatalogueDefaultColor(
  tx: Transaction,
  color: unknown,
): Promise<CatalogueSettings> {
  const defaultColor = colorOrNull(color, () => {
    throw new AppError("category.invalid", { field: "color" });
  });
  await tx
    .insert(catalogueSettings)
    .values({ defaultColor })
    .onConflictDoUpdate({ target: catalogueSettings.id, set: { defaultColor } });
  return readCatalogueSettings(tx);
}
