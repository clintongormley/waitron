import { categories, products, type Transaction } from "@waitron/db";
import type { ContentLanguages } from "@waitron/shared";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { batches } from "./batches.js";
import { readContentLanguages } from "./content-languages.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import {
  listAbsentTranslationRefs,
  listTranslationTargets,
  resolveTranslationTargets,
  type ResolvedTranslationTarget,
  type TranslationContext,
} from "./content-translation-targets.js";
import type { TranslationRef, TranslationTarget } from "./content-translation-types.js";
import type { SuggestionItem } from "./content-suggestion-types.js";
import { menuRoots } from "./menu-structure.js";
import { contentSuggestions } from "./schema/suggestions.js";

/** Cloud's bound on every text field, counted as JavaScript string length (contract, "Submit"). */
export const TEXT_LIMIT = 500;

export const KIND_ORDER: readonly TranslationGapKind[] = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
];

type LiveTarget = Extract<ResolvedTranslationTarget, { state: "present" }>;
type Gap = { entry: LiveTarget; missing: Set<string> };

export function suggestionRef(ref: { kind: string; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseSuggestionRef(ref: string): TranslationRef | null {
  const colon = ref.indexOf(":");
  const kind = ref.slice(0, colon) as TranslationGapKind;
  const id = ref.slice(colon + 1);
  return colon > 0 && id !== "" && KIND_ORDER.includes(kind) ? { kind, id } : null;
}

/**
 * Whether a resolved item is still on the venue. `resolveTranslationTargets` marks a deleted
 * product or variant, and a variant of a deleted product, eligible, so `eligible` alone is not
 * enough; for every other kind `eligible` already covers the activity flags.
 */
export function isLiveTarget(entry: ResolvedTranslationTarget): entry is LiveTarget {
  return (
    entry.state === "present" &&
    entry.target.eligible &&
    entry.structure.active &&
    entry.structure.ownerActive
  );
}

function fits(text: string): boolean {
  return text.trim() !== "" && text.length <= TEXT_LIMIT;
}

function effectiveNames(entry: LiveTarget): Record<string, string> {
  return { ...entry.inheritedNames, ...entry.names };
}

export async function resolveLive(
  tx: Transaction,
  language: string,
  refs: readonly TranslationRef[],
  context: TranslationContext,
): Promise<LiveTarget[]> {
  const live: LiveTarget[] = [];
  for (const chunk of batches(refs, 100))
    live.push(
      ...(await resolveTranslationTargets(tx, language, chunk, context)).targets.filter(
        isLiveTarget,
      ),
    );
  return live;
}

async function readGaps(
  tx: Transaction,
  context: TranslationContext,
  config: ContentLanguages,
): Promise<Map<string, Gap>> {
  const refs = new Map<string, TranslationRef>();
  for (const language of config.languages) {
    let after: string | null = null;
    do {
      const page = await listTranslationTargets(
        tx,
        language,
        after === null ? {} : { after },
        context,
      );
      for (const row of page.rows) refs.set(suggestionRef(row), { kind: row.kind, id: row.id });
      after = page.next;
    } while (after !== null);
  }
  for (const ref of await listAbsentTranslationRefs(tx)) refs.set(suggestionRef(ref), ref);
  const gaps = new Map<string, Gap>();
  // Every candidate is blank in at least one language: a page lists an item only where its text is
  // blank, and an absent item is blank everywhere.
  for (const entry of await resolveLive(tx, config.defaultLanguage, [...refs.values()], context)) {
    const effective = effectiveNames(entry);
    gaps.set(suggestionRef(entry.target), {
      entry,
      missing: new Set(config.languages.filter((language) => !(effective[language] ?? "").trim())),
    });
  }
  return gaps;
}

/** Every live item and the enabled languages it has no customer-facing text in, before the
 * waiting suggestions and any exclusion are taken away. */
export async function readSuggestionGaps(
  tx: Transaction,
  context: TranslationContext,
): Promise<Map<string, { target: TranslationTarget; missing: Set<string> }>> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const gaps = await readGaps(tx, context, config);
  return new Map(
    [...gaps].map(([ref, gap]) => [ref, { target: gap.entry.target, missing: gap.missing }]),
  );
}

function productOf(target: TranslationTarget): string | null {
  const owners = target.owners!;
  if (owners.kind === "product") return target.id;
  return owners.kind === "variant" ? owners.parentId : null;
}

function familyOf(target: TranslationTarget, roots: ReadonlyMap<string, string>): string {
  const owners = target.owners!;
  switch (owners.kind) {
    case "variant":
      return suggestionRef({ kind: "product", id: owners.parentId });
    case "option_label":
      return suggestionRef({ kind: "option_list", id: owners.listId });
    case "section":
      return suggestionRef({ kind: "menu", id: roots.get(owners.menuId)! });
    default:
      return suggestionRef(target);
  }
}

async function readCategoryNames(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (const batch of batches(productIds)) {
    const rows = await tx
      .select({ id: products.id, name: categories.name })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(inArray(products.id, batch));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
}

/** Turns live items into job items, leaving out what Cloud's bounds would refuse (rule 8). */
async function describeItems(
  tx: Transaction,
  config: ContentLanguages,
  wanted: readonly { entry: LiveTarget; missing: string[] }[],
): Promise<SuggestionItem[]> {
  const productIds = new Set<string>();
  const menuIds = new Set<string>();
  for (const { entry } of wanted) {
    const productId = productOf(entry.target);
    if (productId !== null) productIds.add(productId);
    const owners = entry.target.owners!;
    if (owners.kind === "section") menuIds.add(owners.menuId);
  }
  const categoryNames = await readCategoryNames(tx, [...productIds]);
  const roots = await menuRoots(tx, [...menuIds]);
  const items: SuggestionItem[] = [];
  for (const { entry, missing } of wanted) {
    const productId = productOf(entry.target);
    const category = productId === null ? null : (categoryNames.get(productId) ?? null);
    if (!fits(entry.target.name) || (category !== null && category.length > TEXT_LIMIT)) continue;
    const effective = effectiveNames(entry);
    items.push({
      ref: suggestionRef(entry.target),
      kind: entry.target.kind,
      family: familyOf(entry.target, roots),
      category: category !== null && category.trim() !== "" ? category : null,
      staffName: entry.target.name,
      existing: Object.fromEntries(
        config.languages
          .filter((language) => !missing.includes(language) && fits(effective[language] ?? ""))
          .map((language) => [language, effective[language]!]),
      ),
      missing,
    });
  }
  return items.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.ref < b.ref ? -1 : 1),
  );
}

/**
 * What a job may ask Cloud for: every missing name less the waiting suggestions and `exclude`, in
 * the dialog's kind order then id, so a family's head comes before its members.
 */
export async function collectSuggestionItems(
  tx: Transaction,
  context: TranslationContext,
  exclude: ReadonlySet<string>,
): Promise<SuggestionItem[]> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const gaps = await readGaps(tx, context, config);
  const waiting = await tx
    .select({
      kind: contentSuggestions.kind,
      itemId: contentSuggestions.itemId,
      language: contentSuggestions.language,
      placeholder: contentSuggestions.placeholder,
    })
    .from(contentSuggestions)
    .where(
      or(
        eq(contentSuggestions.placeholder, true),
        and(isNotNull(contentSuggestions.text), isNotNull(contentSuggestions.language)),
      ),
    );
  for (const row of waiting) {
    const gap = gaps.get(suggestionRef({ kind: row.kind, id: row.itemId }));
    if (gap === undefined) continue;
    if (row.placeholder) gap.missing.clear();
    else gap.missing.delete(row.language!);
  }
  const wanted = [...gaps]
    .filter(([ref, gap]) => gap.missing.size > 0 && !exclude.has(ref))
    .map(([, gap]) => ({
      entry: gap.entry,
      missing: config.languages.filter((language) => gap.missing.has(language)),
    }));
  return describeItems(tx, config, wanted);
}
