import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import type { TranslationItem, TranslationField } from "./content-translation-types.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { validateOptionalTranslations } from "./optional-translations.js";
import "./errors.js";

export async function writeTranslationMaps(
  tx: Transaction,
  item: TranslationItem,
  maps: Partial<Record<TranslationField, Record<string, string>>>,
): Promise<void> {
  if (
    !item.owners ||
    item.owners.kind !== item.kind ||
    !item.cells.length ||
    item.cells.some(
      (cell) =>
        !cell.eligible ||
        cell.kind !== item.kind ||
        cell.id !== item.id ||
        (cell.field !== "name" && !(item.kind === "unit" && cell.field === "abbreviation")),
    ) ||
    Object.keys(maps).length === 0 ||
    Object.keys(maps).some(
      (field) => field !== "name" && !(item.kind === "unit" && field === "abbreviation"),
    )
  )
    throw new AppError("content.translation_invalid", {});
  for (const names of Object.values(maps)) validateOptionalTranslations(names);
  const names = maps.name;
  const customerName = names && Object.keys(names).length ? names : null;
  switch (item.kind) {
    case "product":
    case "variant":
      await tx.update(products).set({ customerName }).where(eq(products.id, item.id));
      break;
    case "option_list":
      await tx.update(optionLists).set({ customerName }).where(eq(optionLists.id, item.id));
      break;
    case "option_label":
      await tx.update(optionLabels).set({ customerName }).where(eq(optionLabels.id, item.id));
      break;
    case "extra_list":
      await tx.update(extraLists).set({ customerName }).where(eq(extraLists.id, item.id));
      break;
    case "unit":
      await tx
        .update(units)
        .set({
          ...(names === undefined ? {} : { name: names }),
          ...(maps.abbreviation === undefined ? {} : { abbreviation: maps.abbreviation }),
        })
        .where(eq(units.id, item.id));
      break;
    case "menu":
    case "section":
      await tx.update(sections).set({ names: names! }).where(eq(sections.id, item.id));
      break;
    case "included_menu":
      await tx
        .update(sectionMembers)
        .set({
          folderOverrides: sql`json_set(${sectionMembers.folderOverrides}, '$.names', json(${JSON.stringify(names)}))`,
        })
        .where(eq(sectionMembers.id, item.id));
      break;
  }
}
