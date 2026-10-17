import { sql, type SQL } from "drizzle-orm";
import type { ContentLanguages } from "@waitron/shared";
import { TRANSLATION_GAP_KINDS as KINDS } from "./content-translation-kinds.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import type { TranslationRef } from "./content-translation-types.js";

export type NamedRow = {
  kind: TranslationGapKind;
  id: string;
  name: string;
  names: string | null;
  inherited: string | null;
  abbreviations: string | null;
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
export const LIVE_CANDIDATE = sql`active = 1 and owner_active = 1 and child_active = 1 and root_matched = 1
      and (kind not in ('product', 'variant', 'menu', 'section', 'included_menu') or
        (kind = 'product' and role = 'product') or (kind = 'variant' and role = 'variant') or
        (kind = 'menu' and role = 'menu_root') or (kind = 'section' and role = 'section') or
        (kind = 'included_menu' and role = 'menu_root' and parent_role in ('menu_root', 'section')))`;
export const POSITION = sql`case kind ${sql.join(
  KINDS.map((kind, index) => sql`when ${kind} then ${index}`),
  sql` `,
)} end`;
const TRIM_CHARACTERS =
  "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export function blankTranslationSql(value: SQL): SQL {
  return sql`trim(coalesce(${value}, ''), ${TRIM_CHARACTERS}) = ''`;
}

export function blankIn(path: SQL): SQL {
  const effective = sql`case when kind = 'included_menu' then json_patch(inherited, names) else names end`;
  return sql`(kind <> 'included_menu' or exists (select 1 from json_each(names)))
    and (${blankTranslationSql(sql`json_extract(${effective}, ${path})`)}
      or (kind = 'unit' and ${blankTranslationSql(sql`json_extract(abbreviations, ${path})`)}))`;
}

export const ABSENT = sql`kind <> 'included_menu' and kind <> 'unit'
  and (names is null or names = '{}')`;

export function translationGapsQuery(config: ContentLanguages): SQL {
  return sql`with candidates as materialized (${namedRows()}), gaps as (
    select candidates.*, language.value as language from candidates
      cross join json_each(${JSON.stringify(config.languages)}) as language
    where ${LIVE_CANDIDATE} and ${blankIn(sql`'$."' || language.value || '"'`)})`;
}
export function namedRows(
  refs?: readonly TranslationRef[],
  kinds: readonly TranslationGapKind[] = KINDS,
): SQL {
  const filter = (kind: TranslationGapKind, id: SQL) =>
    !kinds.includes(kind)
      ? sql`0`
      : refs
        ? sql`${id} in (select json_extract(value, '$.id') from json_each(${JSON.stringify(refs)}) where json_extract(value, '$.kind') = ${kind})`
        : sql`1`;
  return sql`
    select 'product' as kind, p.id, p.name, p.customer_name as names, null as inherited,
      p.parent_id as owner, null as owner_name, null as container, null as child, null as child_menu,
      case when p.parent_id is null then 'product' else 'variant' end as role,
      p.active, 1 as owner_active, 1 as root_matched, null as parent_role, 1 as child_active, null as abbreviations
    from products p where ${filter("product", sql`p.id`)}
    union all select 'variant', p.id, p.name, p.customer_name, null, p.parent_id, a.name,
      null, null, null, case when p.parent_id is null then 'product' else 'variant' end,
      p.active, coalesce(a.active, 0), (a.id is not null), null, 1, null
    from products p left join products a on a.id = p.parent_id where ${filter("variant", sql`p.id`)}
    union all select 'option_list', l.id, l.name, l.customer_name, null, null, null,
      null, null, null, null, l.active, 1, 1, null, 1, null
    from option_lists l where ${filter("option_list", sql`l.id`)}
    union all select 'option_label', l.id, l.name, l.customer_name, null, l.list_id, o.name,
      null, null, null, null, 1, coalesce(o.active, 0), (o.id is not null), null, 1, null
    from option_labels l left join option_lists o on o.id = l.list_id where ${filter("option_label", sql`l.id`)}
    union all select 'extra_list', l.id, l.name, l.customer_name, null, null, null,
      null, null, null, null, l.active, 1, 1, null, 1, null
    from extra_lists l where ${filter("extra_list", sql`l.id`)}
    union all select 'menu', s.id, s.internal_name, s.names, null, s.owner_menu_id, c.name,
      null, null, null, s.role, 1, coalesce(c.active, 0), (d.root_section_id = s.id), null, 1, null
    from sections s left join catalogues c on c.id = s.owner_menu_id
      left join menu_details d on d.menu_id = s.owner_menu_id where ${filter("menu", sql`s.id`)}
    union all select 'section', s.id, s.internal_name, s.names, null, s.owner_menu_id, c.name,
      null, null, null, s.role, 1, coalesce(c.active, 0), (c.id is not null), null, 1, null
    from sections s left join catalogues c on c.id = s.owner_menu_id where ${filter("section", sql`s.id`)}
    union all select 'included_menu', m.id, s.internal_name, json_extract(m.folder_overrides, '$.names'),
      s.names, l.owner_menu_id, c.name, m.section_id, m.child_section_id, s.owner_menu_id,
      s.role, 1, coalesce(c.active, 0), (d.root_section_id = s.id), l.role, coalesce(a.active, 0), null
    from section_members m left join sections s on s.id = m.child_section_id
      left join sections l on l.id = m.section_id left join catalogues c on c.id = l.owner_menu_id
      left join catalogues a on a.id = s.owner_menu_id left join menu_details d on d.menu_id = s.owner_menu_id
    where ${filter("included_menu", sql`m.id`)}
    union all select 'unit', u.id, u.staff_name, u.name, null, null, null,
      null, null, null, null, 1, 1, 1, null, 1, u.abbreviation
    from units u where ${filter("unit", sql`u.id`)}
  `;
}
export function liveTranslationRows(kinds: readonly TranslationGapKind[]): SQL {
  return sql`select * from (${namedRows(undefined, kinds)}) where ${LIVE_CANDIDATE}`;
}
