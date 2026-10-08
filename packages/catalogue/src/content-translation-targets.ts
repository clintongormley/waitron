import type { Transaction } from "@waitron/db";
import { AppError, contentLanguageCode, type ContentLanguages } from "@waitron/shared";
import { sql, type SQL } from "drizzle-orm";
import { contentLanguagesOr } from "./content-languages.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import type {
  TranslationOwners,
  TranslationPage,
  TranslationRef,
  TranslationTarget,
} from "./content-translation-types.js";
import "./errors.js";

export interface TranslationContext {
  fallbackLanguage: string;
  required: readonly string[];
}
export interface TranslationStructure {
  role: string | null;
  active: boolean;
  ownerActive: boolean;
  rootMatched: boolean;
  parentRole: string | null;
  childActive: boolean;
}
export type ResolvedTranslationTarget =
  | { state: "missing"; target: TranslationTarget }
  | {
      state: "present";
      target: TranslationTarget;
      config: ContentLanguages;
      names: Record<string, string> | null;
      inheritedNames: Record<string, string>;
      structure: TranslationStructure;
    };
export interface TranslationResolution {
  language: string;
  config: ContentLanguages;
  required: string[];
  targets: ResolvedTranslationTarget[];
}
const KINDS: readonly TranslationGapKind[] = [
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
type NamedRow = {
  kind: TranslationGapKind;
  id: string;
  name: string;
  names: string | null;
  inherited: string | null;
  owner: string | null;
  owner_name: string | null;
  container: string | null;
  child: string | null;
  child_menu: string | null;
  role: string | null;
  active: number;
  owner_active: number;
  root_matched: number;
  parent_role: string | null;
  child_active: number;
};
function invalid(): never {
  throw new AppError("content.translation_invalid", {});
}
function checkedRefs(refs: readonly TranslationRef[], limit: number): void {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > limit) invalid();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (
      !ref ||
      !KINDS.includes(ref.kind) ||
      typeof ref.id !== "string" ||
      !ref.id.trim() ||
      seen.has(`${ref.kind}:${ref.id}`)
    )
      invalid();
    seen.add(`${ref.kind}:${ref.id}`);
  }
}
async function configuration(tx: Transaction, language: string, context: TranslationContext) {
  if (typeof language !== "string" || contentLanguageCode(language) !== language) invalid();
  const saved = await tx.execute<{ default_language: string; languages: string }>(
    sql`select default_language, languages from content_languages where id = 1`,
  );
  const row = saved.rows[0];
  const config = contentLanguagesOr(
    row
      ? { defaultLanguage: row.default_language, languages: JSON.parse(row.languages) as string[] }
      : undefined,
    context.fallbackLanguage,
  );
  if (!config.languages.includes(language)) throw new AppError("content.languages_invalid", {});
  return {
    language,
    config,
    required: [...new Set(context.required.map(contentLanguageCode))].sort(),
  };
}
// Each filtered branch binds at most one batch of ids; ownership joins never load an editor's graph.
function namedRows(refs?: readonly TranslationRef[]): SQL {
  const filter = (kind: TranslationGapKind, id: SQL) =>
    refs
      ? sql`${id} in (select json_extract(value, '$.id') from json_each(${JSON.stringify(refs)}) where json_extract(value, '$.kind') = ${kind})`
      : sql`1`;
  return sql`
    select 'product' as kind, p.id, p.name, p.customer_name as names, null as inherited,
      p.parent_id as owner, null as owner_name, null as container, null as child, null as child_menu,
      case when p.parent_id is null then 'product' else 'variant' end as role,
      p.active, 1 as owner_active, 1 as root_matched, null as parent_role, 1 as child_active
    from products p where ${filter("product", sql`p.id`)}
    union all select 'variant', p.id, p.name, p.customer_name, null, p.parent_id, a.name,
      null, null, null, case when p.parent_id is null then 'product' else 'variant' end,
      p.active, coalesce(a.active, 0), (a.id is not null), null, 1
    from products p left join products a on a.id = p.parent_id where ${filter("variant", sql`p.id`)}
    union all select 'option_list', l.id, l.name, l.customer_name, null, null, null,
      null, null, null, null, l.active, 1, 1, null, 1
    from option_lists l where ${filter("option_list", sql`l.id`)}
    union all select 'option_label', l.id, l.name, l.customer_name, null, l.list_id, o.name,
      null, null, null, null, 1, coalesce(o.active, 0), (o.id is not null), null, 1
    from option_labels l left join option_lists o on o.id = l.list_id where ${filter("option_label", sql`l.id`)}
    union all select 'extra_list', l.id, l.name, l.customer_name, null, null, null,
      null, null, null, null, l.active, 1, 1, null, 1
    from extra_lists l where ${filter("extra_list", sql`l.id`)}
    union all select 'menu', s.id, s.internal_name, s.names, null, s.owner_menu_id, c.name,
      null, null, null, s.role, 1, coalesce(c.active, 0), (d.root_section_id = s.id), null, 1
    from sections s left join catalogues c on c.id = s.owner_menu_id
      left join menu_details d on d.menu_id = s.owner_menu_id where ${filter("menu", sql`s.id`)}
    union all select 'section', s.id, s.internal_name, s.names, null, s.owner_menu_id, c.name,
      null, null, null, s.role, 1, coalesce(c.active, 0), (c.id is not null), null, 1
    from sections s left join catalogues c on c.id = s.owner_menu_id where ${filter("section", sql`s.id`)}
    union all select 'included_menu', m.id, s.internal_name, json_extract(m.folder_overrides, '$.names'),
      s.names, l.owner_menu_id, c.name, m.section_id, m.child_section_id, s.owner_menu_id,
      s.role, 1, coalesce(c.active, 0), (d.root_section_id = s.id), l.role, coalesce(a.active, 0)
    from section_members m left join sections s on s.id = m.child_section_id
      left join sections l on l.id = m.section_id left join catalogues c on c.id = l.owner_menu_id
      left join catalogues a on a.id = s.owner_menu_id left join menu_details d on d.menu_id = s.owner_menu_id
    where ${filter("included_menu", sql`m.id`)}
    union all select 'unit', u.id, u.name, u.name, null, null, null,
      null, null, null, null, 1, 1, 1, null, 1
    from units u where ${filter("unit", sql`u.id`)}
  `;
}
function ownersOf(row: NamedRow): TranslationOwners | null {
  if (
    (row.kind === "variant" && row.owner === null) ||
    (row.kind === "included_menu" && row.child_menu === null)
  )
    return null;
  switch (row.kind) {
    case "product":
      return { kind: row.kind, parentId: null };
    case "variant":
      return { kind: row.kind, parentId: row.owner! };
    case "option_label":
      return { kind: row.kind, listId: row.owner! };
    case "menu":
      return { kind: row.kind, menuId: row.owner!, rootId: row.id };
    case "section":
      return { kind: row.kind, menuId: row.owner! };
    case "included_menu":
      return {
        kind: row.kind,
        menuId: row.owner!,
        sectionId: row.container!,
        includedMenuId: row.child_menu!,
        includedRootId: row.child!,
      };
    default:
      return { kind: row.kind };
  }
}
function token(
  target: Omit<TranslationTarget, "expected">,
  config: ContentLanguages,
  required: string[],
  structure?: TranslationStructure,
): string {
  return JSON.stringify({
    ref: { kind: target.kind, id: target.id },
    owners: target.owners,
    structure,
    selectedText: target.selectedText,
    defaultText: target.defaultText,
    effectiveSelectedText: target.effectiveSelectedText,
    effectiveDefaultText: target.effectiveDefaultText,
    config: { defaultLanguage: config.defaultLanguage, languages: [...config.languages].sort() },
    required,
  });
}
function resolved(
  row: NamedRow,
  language: string,
  config: ContentLanguages,
  required: string[],
): ResolvedTranslationTarget {
  const names = row.names === null ? null : (JSON.parse(row.names) as Record<string, string>);
  const inheritedNames =
    row.inherited === null ? {} : (JSON.parse(row.inherited) as Record<string, string>);
  const effective = { ...inheritedNames, ...names };
  const selectedText = names?.[language] ?? null;
  const defaultText = names?.[config.defaultLanguage] ?? null;
  const structure: TranslationStructure = {
    role: row.role,
    active: !!row.active,
    ownerActive: !!row.owner_active,
    rootMatched: !!row.root_matched,
    parentRole: row.parent_role,
    childActive: !!row.child_active,
  };
  const wrongRole =
    (row.kind === "product" && row.role !== "product") ||
    (row.kind === "variant" && row.role !== "variant") ||
    (row.kind === "menu" && row.role !== "menu_root") ||
    (row.kind === "section" && row.role !== "section") ||
    (row.kind === "included_menu" &&
      (row.role !== "menu_root" || !["menu_root", "section"].includes(row.parent_role ?? "")));
  const unavailableReason = wrongRole
    ? "role"
    : !structure.rootMatched
      ? "ownership"
      : !structure.active || !structure.ownerActive || !structure.childActive
        ? "inactive"
        : null;
  const effectiveSelectedText = effective[language] ?? null;
  const effectiveDefaultText = effective[config.defaultLanguage] ?? null;
  const defaultName = names?.[config.defaultLanguage];
  const target: Omit<TranslationTarget, "expected"> = {
    kind: row.kind,
    id: row.id,
    name:
      row.kind === "unit"
        ? defaultName?.trim()
          ? defaultName
          : Object.values(names ?? {}).find((text) => text.trim()) || ""
        : (row.name ?? ""),
    ...(row.owner && row.kind !== "product"
      ? { parent: { id: row.owner, name: row.owner_name ?? "" } }
      : {}),
    reason:
      row.kind !== "unit" &&
      row.kind !== "included_menu" &&
      (names === null || Object.keys(names).length === 0)
        ? "absent"
        : "partial",
    selectedText,
    defaultText,
    effectiveSelectedText,
    effectiveDefaultText,
    defaultRequired: !(effectiveDefaultText ?? "").trim(),
    eligible: unavailableReason === null,
    unavailableReason,
    owners: ownersOf(row),
  };
  return {
    state: "present",
    target: { ...target, expected: token(target, config, required, structure) },
    config,
    names,
    inheritedNames,
    structure,
  };
}
function missing(
  ref: TranslationRef,
  config: ContentLanguages,
  required: string[],
): ResolvedTranslationTarget {
  const target: Omit<TranslationTarget, "expected"> = {
    ...ref,
    name: "",
    reason: "absent",
    owners: null,
    selectedText: null,
    defaultText: null,
    effectiveSelectedText: null,
    effectiveDefaultText: null,
    defaultRequired: false,
    eligible: false,
    unavailableReason: "missing",
  };
  return { state: "missing", target: { ...target, expected: token(target, config, required) } };
}
async function readTargets(
  tx: Transaction,
  refs: readonly TranslationRef[],
  state: Awaited<ReturnType<typeof configuration>>,
): Promise<ResolvedTranslationTarget[]> {
  const result = await tx.execute<NamedRow>(namedRows(refs));
  const rows = new Map(result.rows.map((row) => [`${row.kind}:${row.id}`, row]));
  return refs.map((ref) => {
    const row = rows.get(`${ref.kind}:${ref.id}`);
    return row
      ? resolved(row, state.language, state.config, state.required)
      : missing(ref, state.config, state.required);
  });
}
export async function resolveTranslationTargets(
  tx: Transaction,
  language: string,
  refs: readonly TranslationRef[],
  context: TranslationContext,
): Promise<TranslationResolution> {
  checkedRefs(refs, 100);
  const state = await configuration(tx, language, context);
  return { ...state, targets: await readTargets(tx, refs, state) };
}
export async function listTranslationTargets(
  tx: Transaction,
  language: string,
  query: { after?: string; targets?: TranslationRef[] },
  context: TranslationContext,
): Promise<TranslationPage> {
  if (query.targets !== undefined && query.after !== undefined) invalid();
  if (query.targets !== undefined) {
    checkedRefs(query.targets, 50);
    const state = await configuration(tx, language, context);
    return {
      ...state,
      rows: (await readTargets(tx, query.targets, state)).map((entry) => entry.target),
      total: query.targets.length,
      next: null,
    };
  }
  let cursor: TranslationRef | undefined;
  if (query.after !== undefined) {
    try {
      cursor = JSON.parse(query.after) as TranslationRef;
    } catch {
      invalid();
    }
    checkedRefs([cursor!], 1);
  }
  const state = await configuration(tx, language, context);
  const path = `$."${language}"`;
  const projection = sql`with candidates as (${namedRows()}), gaps as (
    select kind, id, case kind when 'product' then 0 when 'variant' then 1 when 'option_list' then 2
      when 'option_label' then 3 when 'extra_list' then 4 when 'menu' then 5 when 'section' then 6
      when 'included_menu' then 7 else 8 end as position
    from candidates where active = 1 and owner_active = 1 and child_active = 1 and root_matched = 1
      and (kind not in ('product', 'variant', 'menu', 'section', 'included_menu') or
        (kind = 'product' and role = 'product') or (kind = 'variant' and role = 'variant') or
        (kind = 'menu' and role = 'menu_root') or (kind = 'section' and role = 'section') or
        (kind = 'included_menu' and role = 'menu_root' and parent_role in ('menu_root', 'section')))
      and (kind <> 'extra_list' or (names is not null and names <> '{}'))
      and (kind <> 'included_menu' or names is not null)
      and (kind = 'unit' or kind = 'included_menu' or names not in ('{}') or (${language} <> ${state.config.defaultLanguage} and names is null) or (${language} <> ${state.config.defaultLanguage} and names = '{}'))
      and trim(coalesce(json_extract(case when kind = 'included_menu' then json_patch(inherited, names) else names end, ${path}), '')) = ''
  )`;
  const count = await tx.execute<{ total: number }>(
    sql`${projection} select count(*) as total from gaps`,
  );
  const after = cursor
    ? sql`where position > ${KINDS.indexOf(cursor.kind)} or (position = ${KINDS.indexOf(cursor.kind)} and id > ${cursor.id})`
    : sql``;
  const page = await tx.execute<{ kind: TranslationGapKind; id: string }>(
    sql`${projection} select kind, id from gaps ${after} order by position, id limit 50`,
  );
  const refs = page.rows;
  const rows = refs.length ? (await readTargets(tx, refs, state)).map((entry) => entry.target) : [];
  const last = refs.at(-1);
  // A full final page may yield an empty next page; the cursor still advances monotonically.
  return {
    ...state,
    rows,
    total: count.rows[0]!.total,
    next: refs.length === 50 && last ? JSON.stringify(last) : null,
  };
}
