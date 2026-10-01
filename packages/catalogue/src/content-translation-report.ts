import type { Transaction } from "@waitron/db";
import { resolveContentText, type ContentLanguages } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { contentTranslationGapsIn, readContentTranslationCandidates } from "./content-languages.js";
import type {
  LanguageTranslationGaps,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "./content-language-types.js";
export type {
  LanguageTranslationGaps,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "./content-language-types.js";

const KIND_ORDER: readonly TranslationGapKind[] = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "unit",
];

/** One row of a table the report names; `absent` uses the gap query's own test, null or `'{}'`. */
type NamedRow = {
  source: "product" | "option_list" | "option_label" | "extra_list" | "section" | "menu" | "unit";
  id: string;
  name: string;
  /** A product's parent product, an option's list, a section's menu. */
  owner: string | null;
  active: number;
  absent: number;
};

/**
 * For each enabled language, in the configuration's order, what has no customer-facing name in it.
 * A `partial` gap is exactly what {@link listContentTranslationGaps} reports for that language; a
 * non-default language also lists what has no customer-facing name at all (`absent`), which shows
 * the staff name there. An extras list's own name reaches no order or receipt, so an absent one is
 * never listed, and a unit has no staff name to stand in for its own. Nothing that cannot be ordered is listed:
 * a deleted product or its variants, a switched-off options or extras list or its options, or what
 * a switched-off menu owns.
 */
export async function listTranslationGapReport(
  tx: Transaction,
  config: ContentLanguages,
): Promise<LanguageTranslationGaps[]> {
  const candidates = await readContentTranslationCandidates(tx);
  const named = await tx.execute<NamedRow>(sql`
    select 'product' as source, id, name, parent_id as owner, active,
        (customer_name is null or customer_name = '{}') as absent
      from products
    union all select 'option_list', id, name, null, active,
        (customer_name is null or customer_name = '{}') from option_lists
    union all select 'option_label', id, name, list_id, 1,
        (customer_name is null or customer_name = '{}') from option_labels
    union all select 'extra_list', id, name, null, active,
        (customer_name is null or customer_name = '{}') from extra_lists
    union all select case role when 'menu_root' then 'menu' else 'section' end, id, internal_name,
        owner_menu_id, 1, names = '{}'
      from sections where role in ('section', 'menu_root')
    union all select 'catalogue', id, name, null, active, 0 from catalogues
    union all select 'unit', id, name, null, 1, 0 from units
  `);
  const rows = new Map<string, NamedRow>();
  for (const row of named.rows) rows.set(`${row.source}:${row.id}`, row);
  const row = (source: string, id: string | null) => rows.get(`${source}:${id}`);
  const menuOf = (section: NamedRow) => row("catalogue", section.owner)!;

  const gap = (
    kind: TranslationGapKind,
    id: string,
    reason: TranslationGapReason,
  ): TranslationGap | null => {
    switch (kind) {
      case "product": {
        const product = row("product", id)!;
        return product.active ? { kind, id, name: product.name, reason } : null;
      }
      case "variant": {
        const variant = row("product", id)!;
        const parent = row("product", variant.owner)!;
        return variant.active && parent.active
          ? { kind, id, name: variant.name, reason, parent: { id: parent.id, name: parent.name } }
          : null;
      }
      case "option_list":
      case "extra_list": {
        const list = row(kind, id)!;
        return list.active ? { kind, id, name: list.name, reason } : null;
      }
      case "option_label": {
        const label = row("option_label", id)!;
        const list = row("option_list", label.owner)!;
        return list.active
          ? { kind, id, name: label.name, reason, parent: { id: list.id, name: list.name } }
          : null;
      }
      case "menu":
      case "section": {
        const section = row(kind, id)!;
        const menu = menuOf(section);
        return menu.active
          ? { kind, id, name: section.name, reason, parent: { id: menu.id, name: menu.name } }
          : null;
      }
      case "unit": {
        const names = JSON.parse(row("unit", id)!.name) as Record<string, string>;
        const name =
          resolveContentText(names, config.defaultLanguage, config.defaultLanguage) ||
          (Object.values(names).find((value) => value.trim() !== "") ?? "");
        return { kind, id, name, reason };
      }
    }
  };

  const absent = named.rows.flatMap((entry): { kind: TranslationGapKind; id: string }[] => {
    if (!entry.absent) return [];
    switch (entry.source) {
      case "product":
        return [{ kind: entry.owner === null ? "product" : "variant", id: entry.id }];
      case "option_list":
      case "option_label":
      case "menu":
      case "section":
        return [{ kind: entry.source, id: entry.id }];
      default:
        return [];
    }
  });

  return config.languages.map((language) => {
    const partial = contentTranslationGapsIn(candidates, language).map(({ kind, id }) =>
      gap(candidateKind(kind, id, row), id, "partial"),
    );
    const missing =
      language === config.defaultLanguage
        ? []
        : absent.map(({ kind, id }) => gap(kind, id, "absent"));
    const gaps = [...partial, ...missing].filter(
      (entry): entry is TranslationGap => entry !== null,
    );
    gaps.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        compare(a.name, b.name) ||
        compare(a.id, b.id),
    );
    return { language, gaps };
  });
}

/** The gap query names a menu's root and its sections alike `menu_section`. */
function candidateKind(
  kind: string,
  id: string,
  row: (source: string, id: string) => NamedRow | undefined,
): TranslationGapKind {
  if (kind === "menu_section") return row("menu", id) ? "menu" : "section";
  return kind as TranslationGapKind;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
