import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { contentTranslationGap } from "./content-languages.js";
import type { ResolvedTranslationTarget } from "./content-translation-targets.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import "./errors.js";

function mergedNames(
  target: ResolvedTranslationTarget,
  kind: TranslationGapKind,
  names: Record<string, string>,
): Record<string, string> {
  if (target.state !== "present" || !target.target.eligible || target.target.kind !== kind)
    throw new AppError("content.translation_invalid", {});
  const merged = { ...target.names, ...names };
  const gap = contentTranslationGap([merged], target.config);
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
  const customerName = mergedNames(target, "product", names);
  await tx.update(products).set({ customerName }).where(eq(products.id, target.target.id));
}
export async function writeVariantTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = mergedNames(target, "variant", names);
  await tx.update(products).set({ customerName }).where(eq(products.id, target.target.id));
}
export async function writeOptionListTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = mergedNames(target, "option_list", names);
  await tx.update(optionLists).set({ customerName }).where(eq(optionLists.id, target.target.id));
}
export async function writeOptionLabelTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = mergedNames(target, "option_label", names);
  await tx.update(optionLabels).set({ customerName }).where(eq(optionLabels.id, target.target.id));
}
export async function writeExtraListTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const customerName = mergedNames(target, "extra_list", names);
  await tx.update(extraLists).set({ customerName }).where(eq(extraLists.id, target.target.id));
}
export async function writeUnitTranslation(
  tx: Transaction,
  target: ResolvedTranslationTarget,
  names: Record<string, string>,
): Promise<void> {
  const name = mergedNames(target, "unit", names);
  await tx.update(units).set({ name }).where(eq(units.id, target.target.id));
}
