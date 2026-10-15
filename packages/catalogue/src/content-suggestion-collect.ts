import { categories, products, tenants, type Transaction } from "@waitron/db";
import type { ContentLanguages } from "@waitron/shared";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { readContentLanguages } from "./content-languages.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import {
  listTranslationGapRefs,
  resolveTranslationTargets,
  type ResolvedTranslationTarget,
  type TranslationContext,
} from "./content-translation-targets.js";
import type { TranslationRef, TranslationTarget } from "./content-translation-types.js";
import type { HouseStyleExample, SuggestionItem } from "./content-suggestion-types.js";
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
export interface SuggestionGap {
  entry: LiveTarget;
  target: TranslationTarget;
  missing: Set<string>;
}
export type SuggestionGaps = Map<string, SuggestionGap>;

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

/** Every live item and the enabled languages it has no customer-facing text in, before the
 * waiting suggestions and any exclusion are taken away. */
export async function readSuggestionGaps(
  tx: Transaction,
  context: TranslationContext,
): Promise<SuggestionGaps> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const refs = await listTranslationGapRefs(tx, config);
  const gaps: SuggestionGaps = new Map();
  for (const entry of await resolveLive(tx, config.defaultLanguage, refs, context)) {
    const effective = effectiveNames(entry);
    gaps.set(suggestionRef(entry.target), {
      entry,
      target: entry.target,
      missing: new Set(config.languages.filter((language) => !(effective[language] ?? "").trim())),
    });
  }
  return gaps;
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
 * the dialog's kind order then id, so a family's head comes before its members. `read` is
 * {@link readSuggestionGaps}'s answer when the caller already has it in this transaction.
 */
export async function collectSuggestionItems(
  tx: Transaction,
  context: TranslationContext,
  exclude: ReadonlySet<string>,
  read?: SuggestionGaps,
): Promise<SuggestionItem[]> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const gaps = new Map(
    [...(read ?? (await readSuggestionGaps(tx, context)))].map(([ref, gap]) => [
      ref,
      { entry: gap.entry, missing: new Set(gap.missing) },
    ]),
  );
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

export const JOB_ITEM_LIMIT = 1000;
export const JOB_BYTE_LIMIT = 1_048_576;
export const HOUSE_STYLE_LIMIT = 300;
export const HOUSE_STYLE_BYTE_LIMIT = 262_144;

type HouseStyleRow = {
  kind: TranslationGapKind;
  id: string;
  staff_name: string;
  names: string;
  category: string | null;
};

/**
 * Saved customer-facing names of live items, one from each kind-and-category group in turn. Every
 * saved name was typed, or reviewed and saved, by a person, so they are the venue's house style.
 */
export async function readHouseStyle(
  tx: Transaction,
  languages: readonly string[],
  limit: number = HOUSE_STYLE_LIMIT,
): Promise<HouseStyleExample[]> {
  const result = await tx.execute<HouseStyleRow>(sql`
    select * from (
      select 'product' as kind, p.id, p.name as staff_name, p.customer_name as names,
          c.name as category
        from products p left join categories c on c.id = p.category_id
        where p.parent_id is null and p.active = 1
      union all select 'variant', v.id, v.name, v.customer_name, c.name
        from products v join products p on p.id = v.parent_id
          left join categories c on c.id = p.category_id
        where v.active = 1 and p.active = 1
      union all select 'option_list', id, name, customer_name, null
        from option_lists where active = 1
      union all select 'option_label', l.id, l.name, l.customer_name, null
        from option_labels l join option_lists o on o.id = l.list_id where o.active = 1
      union all select 'extra_list', id, name, customer_name, null
        from extra_lists where active = 1
      union all select 'menu', s.id, s.internal_name, s.names, null
        from sections s join menu_details d on d.root_section_id = s.id
          join catalogues c on c.id = s.owner_menu_id
        where s.role = 'menu_root' and c.active = 1
      union all select 'section', s.id, s.internal_name, s.names, null
        from sections s join catalogues c on c.id = s.owner_menu_id
        where s.role = 'section' and c.active = 1
    ) where names is not null and names <> '{}'
    order by kind, category, id`);
  const groups = new Map<string, HouseStyleExample[]>();
  for (const row of result.rows) {
    if (!fits(row.staff_name)) continue;
    const saved = JSON.parse(row.names) as Record<string, string>;
    const names = Object.fromEntries(
      languages
        .filter((language) => fits(saved[language] ?? ""))
        .map((language) => [language, saved[language]!]),
    );
    if (Object.keys(names).length === 0) continue;
    const key = `${row.kind}:${row.category ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push({ kind: row.kind, staffName: row.staff_name, names });
    groups.set(key, group);
  }
  const lists = [...groups.values()];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const spread: HouseStyleExample[] = [];
  for (let round = 0; round < longest; round += 1)
    for (const list of lists) if (round < list.length) spread.push(list[round]!);
  return spread.slice(0, limit);
}

function fitHouseStyle(examples: readonly HouseStyleExample[]): HouseStyleExample[] {
  const kept: HouseStyleExample[] = [];
  let bytes = 2;
  for (const example of examples) {
    const size = Buffer.byteLength(JSON.stringify(example)) + (kept.length === 0 ? 0 : 1);
    if (bytes + size > HOUSE_STYLE_BYTE_LIMIT) break;
    kept.push(example);
    bytes += size;
  }
  return kept;
}

/** The family heads the items name but do not include, as context entries keyed by ref. */
async function readContextHeads(
  tx: Transaction,
  context: TranslationContext,
  config: ContentLanguages,
  items: readonly SuggestionItem[],
): Promise<Map<string, SuggestionItem>> {
  const listed = new Set(items.map((item) => item.ref));
  const families = [...new Set(items.map((item) => item.family))].filter(
    (family) => !listed.has(family),
  );
  const live = await resolveLive(
    tx,
    config.defaultLanguage,
    families.map((family) => parseSuggestionRef(family)!),
    context,
  );
  const heads = await describeItems(
    tx,
    config,
    live.map((entry) => ({ entry, missing: [] })),
  );
  return new Map(heads.map((head) => [head.ref, head]));
}

export interface SuggestionJobDraft {
  body: string;
  sent: Record<string, string[]>;
  included: number;
  heads: number;
  remaining: number;
  bytes: number;
}

/** The next job of a run: what is missing, less `exclude`, inside Cloud's item and byte limits. */
export async function buildSuggestionJob(
  tx: Transaction,
  context: TranslationContext,
  exclude: ReadonlySet<string>,
  gaps?: SuggestionGaps,
): Promise<SuggestionJobDraft | null> {
  const items = await collectSuggestionItems(tx, context, exclude, gaps);
  if (items.length === 0) return null;
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const [tenant] = await tx
    .select({ country: tenants.country })
    .from(tenants)
    .where(eq(tenants.id, 1));
  const heads = await readContextHeads(tx, context, config, items);
  const job = {
    version: 1,
    country: tenant!.country,
    languages: { default: config.defaultLanguage, enabled: config.languages },
    items: [] as SuggestionItem[],
    houseStyle: fitHouseStyle(await readHouseStyle(tx, config.languages)),
  };
  // The first item always fits: the house style takes at most a quarter of the job, and an item
  // with its head is two entries of at most 22 fields of 500 characters (staff name, category and
  // Cloud's 20 languages), under 140 KB even with every character escaped as six bytes.
  let bytes = Buffer.byteLength(JSON.stringify(job));
  const sent: Record<string, string[]> = {};
  const inJob = new Set<string>();
  let headCount = 0;
  let next = 0;
  for (; next < items.length; next += 1) {
    const item = items[next]!;
    const head = inJob.has(item.family) ? undefined : heads.get(item.family);
    const adding = head === undefined ? [item] : [head, item];
    const size =
      adding.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0) +
      adding.length -
      (job.items.length === 0 ? 1 : 0);
    if (job.items.length + adding.length > JOB_ITEM_LIMIT || bytes + size > JOB_BYTE_LIMIT) break;
    for (const entry of adding) {
      job.items.push(entry);
      inJob.add(entry.ref);
    }
    sent[item.ref] = item.missing;
    headCount += adding.length - 1;
    bytes += size;
  }
  return {
    body: JSON.stringify(job),
    sent,
    included: job.items.length,
    heads: headCount,
    remaining: items.length - next,
    bytes,
  };
}

export async function pruneSuggestions(
  tx: Transaction,
  context: TranslationContext,
  read?: SuggestionGaps,
): Promise<void> {
  const gaps = read ?? (await readSuggestionGaps(tx, context));
  const rows = await tx
    .select({
      id: contentSuggestions.id,
      kind: contentSuggestions.kind,
      itemId: contentSuggestions.itemId,
      language: contentSuggestions.language,
      text: contentSuggestions.text,
    })
    .from(contentSuggestions);
  const gone = rows
    .filter((row) => {
      const gap = gaps.get(suggestionRef({ kind: row.kind, id: row.itemId }));
      return (
        !gap ||
        gap.missing.size === 0 ||
        (row.text !== null && !gap.missing.has(row.language ?? ""))
      );
    })
    .map((row) => row.id);
  for (let start = 0; start < gone.length; start += 500)
    await tx
      .delete(contentSuggestions)
      .where(inArray(contentSuggestions.id, gone.slice(start, start + 500)));
}
