import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { contentTranslationGap } from "./content-languages.js";
import type { ResolvedTranslationTarget } from "./content-translation-targets.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { sections, sectionMembers } from "./schema/sections.js";
import "./errors.js";

export function validateTranslationNames(
  target: ResolvedTranslationTarget,
  kind: TranslationGapKind,
  names: Record<string, string>,
): Record<string, string> {
  if (target.state !== "present" || !target.target.eligible || target.target.kind !== kind)
    throw new AppError("content.translation_invalid", {});
  const merged = { ...target.names, ...names };
  const gap = contentTranslationGap(
    [kind === "included_menu" ? { ...target.inheritedNames, ...merged } : merged],
    target.config,
  );
  if (gap) {
    switch (kind) {
      case "option_list":
      case "option_label":
        throw new AppError("options.translation_required", {
          field: "customerName",
          language: gap.language,
        });
      case "extra_list":
        throw new AppError("extras.translation_required", {
          field: "customerName",
          language: gap.language,
        });
      case "menu":
      case "section":
      case "included_menu":
        throw new AppError("menu_section.translation_required", {
          field: "names",
          language: gap.language,
        });
      case "unit":
        throw new AppError("unit.translation_required", { field: "name", language: gap.language });
      default:
        throw new AppError("content.translation_required", { language: gap.language });
    }
  }
  return merged;
}

// Resolve targets and write inside the same transaction; a resolved map is not a reusable draft.
export async function writeProductTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = validateTranslationNames(target, "product", names);
  await tx.update(products).set({ customerName }).where(eq(products.id, target.target.id));
}
export async function writeVariantTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = validateTranslationNames(target, "variant", names);
  await tx.update(products).set({ customerName }).where(eq(products.id, target.target.id));
}
export async function writeOptionListTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = validateTranslationNames(target, "option_list", names);
  await tx.update(optionLists).set({ customerName }).where(eq(optionLists.id, target.target.id));
}
export async function writeOptionLabelTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = validateTranslationNames(target, "option_label", names);
  await tx.update(optionLabels).set({ customerName }).where(eq(optionLabels.id, target.target.id));
}
export async function writeExtraListTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = validateTranslationNames(target, "extra_list", names);
  await tx.update(extraLists).set({ customerName }).where(eq(extraLists.id, target.target.id));
}
export async function writeUnitTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const name = validateTranslationNames(target, "unit", names);
  await tx.update(units).set({ name }).where(eq(units.id, target.target.id));
}

export async function writeMenuTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const merged = validateTranslationNames(target, "menu", names);
  await tx.update(sections).set({ names: merged }).where(eq(sections.id, target.target.id));
}
export async function writeSectionTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const merged = validateTranslationNames(target, "section", names);
  await tx.update(sections).set({ names: merged }).where(eq(sections.id, target.target.id));
}
export async function writeIncludedMenuTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const merged = validateTranslationNames(target, "included_menu", names);
  await tx
    .update(sectionMembers)
    .set({
      folderOverrides: sql`json_set(${sectionMembers.folderOverrides}, '$.names', json(${JSON.stringify(merged)}))`,
    })
    .where(eq(sectionMembers.id, target.target.id));
}
