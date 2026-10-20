import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { sql, type SQL } from "drizzle-orm";
import { namedRows, blankIn, LIVE_CANDIDATE, POSITION } from "./content-translation-candidates.js";
import {
  canonicalTranslationLanguage,
  invalidTranslationQuery as invalid,
  readTranslationCells,
  translationConfiguration,
} from "./content-translation-cells.js";
import { TRANSLATION_GAP_KINDS as KINDS } from "./content-translation-kinds.js";
import {
  readTranslationSettings,
  type TranslationContext,
  type TranslationSettings,
} from "./content-translation-targets.js";
import type {
  MissingIn,
  TranslationCell,
  TranslationCellRef,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
  TranslationRef,
} from "./content-translation-types.js";
import "./errors.js";

function keys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function ref(value: unknown): value is TranslationRef {
  return (
    keys(value, ["kind", "id"]) &&
    KINDS.includes(value.kind as TranslationRef["kind"]) &&
    typeof value.id === "string" &&
    !!value.id.trim()
  );
}
function missing(value: unknown): value is MissingIn {
  return (
    (keys(value, ["mode"]) && ["any", "all"].includes(value.mode as string)) ||
    (keys(value, ["mode", "language"]) &&
      value.mode === "language" &&
      canonicalTranslationLanguage(value.language))
  );
}
interface Filter {
  languages: string[];
  missing: MissingIn;
  kind: TranslationRef["kind"] | null;
  search: string;
  waitingFixes: boolean;
}
function checkedQuery(
  query: unknown,
  settings: TranslationSettings,
): { languages: string[]; targets: TranslationRef[] } | { filter: Filter; after?: string } {
  if (
    !keys(
      query,
      ["languages"],
      ["targets", "missing", "kind", "search", "after", "waitingFixes"],
    ) ||
    !Array.isArray(query.languages) ||
    query.languages.length < 1 ||
    query.languages.length > 8 ||
    query.languages.some((l) => !canonicalTranslationLanguage(l)) ||
    new Set(query.languages).size !== query.languages.length
  )
    invalid();
  const languages = query.languages as string[];
  if (Object.hasOwn(query, "targets")) {
    if (
      !keys(query, ["languages", "targets"]) ||
      !Array.isArray(query.targets) ||
      query.targets.length < 1 ||
      query.targets.length > 50 ||
      query.targets.some((r) => !ref(r)) ||
      new Set(query.targets.map((r) => JSON.stringify([r.kind, r.id]))).size !==
        query.targets.length ||
      languages.some((language) => !settings.config.languages.includes(language))
    )
      invalid();
    return { languages, targets: query.targets as TranslationRef[] };
  }
  if (
    !missing(query.missing) ||
    (Object.hasOwn(query, "kind") && !KINDS.includes(query.kind as TranslationRef["kind"])) ||
    (Object.hasOwn(query, "search") &&
      (typeof query.search !== "string" || query.search.trim().length > 200)) ||
    (Object.hasOwn(query, "after") && typeof query.after !== "string") ||
    (Object.hasOwn(query, "waitingFixes") &&
      (query.waitingFixes !== true || query.missing.mode !== "all"))
  )
    invalid();
  return {
    filter: {
      languages,
      missing: query.missing,
      kind: (query.kind as TranslationRef["kind"] | undefined) ?? null,
      search: (query.search as string | undefined)?.trim() ?? "",
      waitingFixes: query.waitingFixes === true,
    },
    ...(query.after === undefined ? {} : { after: query.after as string }),
  };
}
function cursor(
  after: string | undefined,
  filter: Filter,
  configuration: string,
): TranslationRef | undefined {
  if (after === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(after);
  } catch {
    invalid();
  }
  if (
    !keys(value, ["configuration", "filter", "last"]) ||
    typeof value.configuration !== "string" ||
    !ref(value.last)
  )
    invalid();
  const old = value.filter;
  if (
    !keys(old, ["languages", "missing", "kind", "search", "waitingFixes"]) ||
    !missing(old.missing) ||
    !Array.isArray(old.languages) ||
    old.languages.length !== filter.languages.length ||
    old.languages.some((l, i) => l !== filter.languages[i]) ||
    old.kind !== filter.kind ||
    old.search !== filter.search ||
    old.waitingFixes !== filter.waitingFixes ||
    old.missing.mode !== filter.missing.mode ||
    (old.missing.mode === "language" &&
      (filter.missing.mode !== "language" || old.missing.language !== filter.missing.language)) ||
    (filter.kind !== null && value.last.kind !== filter.kind)
  )
    invalid();
  if (value.configuration !== configuration)
    throw new AppError("content.translation_stale", { scope: "configuration" });
  return value.last;
}
function filtered(filter: Filter, settings: TranslationSettings): SQL {
  const missingIn =
    filter.missing.mode === "all"
      ? sql`1`
      : filter.missing.mode === "language"
        ? blankIn(sql`${`$."${filter.missing.language}"`}`)
        : sql`exists (select 1 from json_each(${JSON.stringify(settings.config.languages)}) as language where ${blankIn(sql`'$."' || language.value || '"'`)})`;
  const searchParts: SQL[] = [sql`name`, sql`owner_name`];
  for (const language of filter.languages) {
    const path = `$."${language}"`;
    searchParts.push(
      sql`coalesce(json_extract(names, ${path}), json_extract(inherited, ${path}))`,
      sql`json_extract(abbreviations, ${path})`,
    );
  }
  const search = filter.search
    ? sql`waitron_search_rank(${filter.search}, ${sql.join(searchParts, sql`, `)}) is not null`
    : sql`1`;
  const fixes = filter.waitingFixes
    ? sql`exists (select 1 from content_suggestions s where s.kind = candidates.kind and s.item_id = candidates.id and (s.fix_field is not null or s.placeholder = 1))`
    : sql`1`;
  return sql`with candidates as (${namedRows(undefined, filter.kind ? [filter.kind] : KINDS)}), filtered as (
    select kind, id, name, owner, owner_name, ${POSITION} as position from candidates
    where ${LIVE_CANDIDATE} and (kind <> 'included_menu' or exists (select 1 from json_each(names)))
      and ${missingIn} and ${search} and ${fixes}
  )`;
}
type ItemRow = {
  kind: TranslationRef["kind"];
  id: string;
  name: string;
  owner: string | null;
  owner_name: string | null;
};
async function items(
  tx: Transaction,
  refs: TranslationRef[],
  rows: ItemRow[],
  languages: string[],
  settings: TranslationSettings,
): Promise<TranslationItem[]> {
  const requested: TranslationCellRef[] = refs.flatMap((r) =>
    languages.flatMap((language) =>
      (r.kind === "unit" ? (["name", "abbreviation"] as const) : (["name"] as const)).map(
        (field) => ({ ...r, language, field }),
      ),
    ),
  );
  const cells = await readTranslationCells(tx, requested, settings);
  const byItem = new Map<string, TranslationCell[]>();
  for (const cell of cells) {
    const key = JSON.stringify([cell.kind, cell.id]);
    const existing = byItem.get(key) ?? [];
    existing.push(cell);
    byItem.set(key, existing);
  }
  const byRef = new Map(rows.map((row) => [JSON.stringify([row.kind, row.id]), row]));
  return refs.map((r) => {
    const key = JSON.stringify([r.kind, r.id]);
    const row = byRef.get(key);
    const projected = byItem.get(key)!;
    return {
      ...r,
      name: row?.name ?? "",
      ...(row?.owner && r.kind !== "product"
        ? { parent: { id: row.owner, name: row.owner_name ?? "" } }
        : {}),
      owners: projected[0]!.owners,
      cells: projected,
    };
  });
}
export async function listTranslationItems(
  tx: Transaction,
  query: TranslationQuery,
  context: TranslationContext,
): Promise<TranslationItemPage> {
  const settings = await readTranslationSettings(tx, context);
  const checked = checkedQuery(query, settings);
  const configuration = translationConfiguration(settings);
  if ("targets" in checked) {
    const rows = await tx.execute<ItemRow>(
      sql`select kind, id, name, owner, owner_name from (${namedRows(checked.targets)})`,
    );
    return {
      ...settings,
      configuration,
      rows: await items(tx, checked.targets, rows.rows, checked.languages, settings),
      total: checked.targets.length,
      next: null,
    };
  }
  const last = cursor(checked.after, checked.filter, configuration);
  if (
    checked.filter.languages.some((language) => !settings.config.languages.includes(language)) ||
    (checked.filter.missing.mode === "language" &&
      !settings.config.languages.includes(checked.filter.missing.language))
  )
    invalid();
  const source = filtered(checked.filter, settings);
  const count = await tx.execute<{ total: number }>(
    sql`${source} select count(*) as total from filtered`,
  );
  const after = last
    ? sql`where position > ${KINDS.indexOf(last.kind)} or (position = ${KINDS.indexOf(last.kind)} and id > ${last.id})`
    : sql``;
  const page = await tx.execute<ItemRow>(
    sql`${source} select kind, id, name, owner, owner_name from filtered ${after} order by position, id limit 51`,
  );
  const refs = page.rows.slice(0, 50).map(({ kind, id }) => ({ kind, id }));
  return {
    ...settings,
    configuration,
    rows: await items(tx, refs, page.rows.slice(0, 50), checked.filter.languages, settings),
    total: count.rows[0]!.total,
    next:
      page.rows.length > 50
        ? JSON.stringify({ configuration, filter: checked.filter, last: refs.at(-1) })
        : null,
  };
}
