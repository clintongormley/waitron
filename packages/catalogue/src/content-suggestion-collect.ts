import { categories, products, tenants, type Transaction } from "@waitron/db";
import type { ContentLanguages } from "@waitron/shared";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { TRANSLATION_GAP_KINDS as KIND_ORDER } from "./content-translation-kinds.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import {
  listTranslationGapRows,
  liveTranslationRows,
  readTranslationRows,
  readTranslationSettings,
  resolveTranslationRow,
  type ResolvedTranslationTarget,
  type TranslationContext,
  type TranslationRow,
  type TranslationSettings,
} from "./content-translation-targets.js";
import type { TranslationRef, TranslationTarget } from "./content-translation-types.js";
import type { HouseStyleExample, SuggestionItem } from "./content-suggestion-types.js";
import { menuRoots } from "./menu-structure.js";
import { contentSuggestions } from "./schema/suggestions.js";

/** Cloud's bound on every text field, counted as JavaScript string length (contract, "Submit"). */
export const TEXT_LIMIT = 500;

export type LiveTarget = Extract<ResolvedTranslationTarget, { state: "present" }>;
/** A live item in the default language, with the row it was resolved from for any other. */
export interface LiveItem {
  row: TranslationRow;
  entry: LiveTarget;
}
export interface SuggestionGap extends LiveItem {
  target: TranslationTarget;
  missing: Set<string>;
}
/** The gaps keyed by ref, with the settings they were read under. */
export class SuggestionGaps extends Map<string, SuggestionGap> {
  constructor(readonly settings: TranslationSettings) {
    super();
  }
}

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

/** Blank as the listing judges a stored name: SQLite's one-argument `trim` removes spaces only. */
export function blankName(text: string | null | undefined): boolean {
  return /^ *$/.test(text ?? "");
}

function fits(text: string): boolean {
  return !blankName(text) && text.length <= TEXT_LIMIT;
}

export function effectiveNames(entry: LiveTarget): Record<string, string> {
  return { ...entry.inheritedNames, ...entry.names };
}

/** The live items among `refs`, keyed by ref. */
export async function readLiveItems(
  tx: Transaction,
  refs: readonly TranslationRef[],
  settings: TranslationSettings,
): Promise<Map<string, LiveItem>> {
  const live = new Map<string, LiveItem>();
  for (const [key, row] of await readTranslationRows(tx, refs)) {
    const entry = resolveTranslationRow(row, settings.config.defaultLanguage, settings);
    if (isLiveTarget(entry)) live.set(key, { row, entry });
  }
  return live;
}

/** Every live item and the enabled languages it has no customer-facing text in, before the
 * waiting suggestions and any exclusion are taken away. */
export async function readSuggestionGaps(
  tx: Transaction,
  context: TranslationContext,
  read?: TranslationSettings,
): Promise<SuggestionGaps> {
  const settings = read ?? (await readTranslationSettings(tx, context));
  const { config } = settings;
  const gaps = new SuggestionGaps(settings);
  // Every gap row is live: the listing's liveness filter implies `isLiveTarget`.
  for (const row of await listTranslationGapRows(tx, config)) {
    const entry = resolveTranslationRow(row, config.defaultLanguage, settings);
    const effective = effectiveNames(entry);
    gaps.set(suggestionRef(entry.target), {
      row,
      entry,
      target: entry.target,
      missing: new Set(config.languages.filter((language) => blankName(effective[language]))),
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

/** Turns live items into job items, leaving out what Cloud's bounds would refuse. */
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
      category: category !== null && !blankName(category) ? category : null,
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
  const all = read ?? (await readSuggestionGaps(tx, context));
  const { config } = all.settings;
  const gaps = new Map(
    [...all].map(([ref, gap]) => [ref, { entry: gap.entry, missing: new Set(gap.missing) }]),
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
const HOUSE_STYLE_KINDS = KIND_ORDER.filter((kind) => kind !== "included_menu" && kind !== "unit");

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
    select live.kind, live.id, live.name as staff_name, live.names, c.name as category
    from (${liveTranslationRows(HOUSE_STYLE_KINDS)}) as live
      left join products p on p.id = case live.kind when 'product' then live.id
        when 'variant' then live.owner end
      left join categories c on c.id = p.category_id
    where live.names is not null and live.names <> '{}'
    order by live.kind, category, live.id`);
  const groups = new Map<string, HouseStyleExample[]>();
  for (const row of result.rows) {
    const key = `${row.kind}:${row.category ?? ""}`;
    const group = groups.get(key) ?? [];
    // Handed out one per group in turn, a group's example past `limit` is never among the first `limit`.
    if (group.length >= limit || !fits(row.staff_name)) continue;
    const saved = JSON.parse(row.names) as Record<string, string>;
    const names = Object.fromEntries(
      languages
        .filter((language) => fits(saved[language] ?? ""))
        .map((language) => [language, saved[language]!]),
    );
    if (Object.keys(names).length === 0) continue;
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

/** The family heads the items name but do not include, as context entries keyed by ref. A head
 * among `gaps` is taken from there rather than read again. */
async function readContextHeads(
  tx: Transaction,
  gaps: SuggestionGaps,
  items: readonly SuggestionItem[],
): Promise<Map<string, SuggestionItem>> {
  const listed = new Set(items.map((item) => item.ref));
  const families = [...new Set(items.map((item) => item.family))].filter(
    (family) => !listed.has(family),
  );
  const known = families.flatMap((family) => {
    const gap = gaps.get(family);
    return gap ? [gap.entry] : [];
  });
  const read = await readLiveItems(
    tx,
    families.filter((family) => !gaps.has(family)).map((family) => parseSuggestionRef(family)!),
    gaps.settings,
  );
  const live = [...known, ...[...read.values()].map((item) => item.entry)];
  const heads = await describeItems(
    tx,
    gaps.settings.config,
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
  read?: SuggestionGaps,
): Promise<SuggestionJobDraft | null> {
  const gaps = read ?? (await readSuggestionGaps(tx, context));
  const items = await collectSuggestionItems(tx, context, exclude, gaps);
  if (items.length === 0) return null;
  const { config } = gaps.settings;
  const [tenant] = await tx
    .select({ country: tenants.country })
    .from(tenants)
    .where(eq(tenants.id, 1));
  const heads = await readContextHeads(tx, gaps, items);
  const job = {
    version: 1,
    country: tenant!.country,
    languages: { default: config.defaultLanguage, enabled: config.languages },
    items: [] as SuggestionItem[],
    houseStyle: fitHouseStyle(await readHouseStyle(tx, config.languages)),
  };
  // The job holds no item only past Cloud's 20 languages (the box saves up to 200), where an item
  // and its head can pass 1 MiB; Cloud refuses such a job with 400 ("languages.enabled holds 1 to
  // 20"), shown as cloud.request_invalid.
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
      // A row with text has a language (content_suggestions_text_language_ck).
      return (
        !gap || gap.missing.size === 0 || (row.text !== null && !gap.missing.has(row.language!))
      );
    })
    .map((row) => row.id);
  for (const batch of batches(gone))
    await tx.delete(contentSuggestions).where(inArray(contentSuggestions.id, batch));
}
