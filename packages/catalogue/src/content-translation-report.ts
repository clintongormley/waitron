import type { Transaction } from "@waitron/db";
import type { ContentLanguages } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { TRANSLATION_GAP_KINDS as KIND_ORDER } from "./content-translation-kinds.js";
import { translationGapsQuery } from "./content-translation-candidates.js";
import type {
  LanguageTranslationGaps,
  LanguageTranslationGapCount,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "./content-translation-report-types.js";
export type {
  LanguageTranslationGaps,
  LanguageTranslationGapCount,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "./content-translation-report-types.js";

type GapRow = {
  language: string;
  kind: TranslationGapKind;
  id: string;
  name: string;
  owner: string | null;
  owner_name: string | null;
  reason: TranslationGapReason;
};

export async function listTranslationGapReport(
  tx: Transaction,
  config: ContentLanguages,
): Promise<LanguageTranslationGaps[]> {
  const result = await tx.execute<GapRow>(sql`${translationGapsQuery(config)}
    select language, kind, id, name, owner, owner_name,
      case when kind not in ('unit', 'included_menu') and (names is null or names = '{}')
        then 'absent' else 'partial' end as reason from gaps`);
  return config.languages.map((language) => {
    const gaps: TranslationGap[] = result.rows
      .filter((row) => row.language === language)
      .map(({ kind, id, name, reason, owner, owner_name }) => ({
        kind,
        id,
        name,
        reason,
        ...(owner !== null && kind !== "product"
          ? { parent: { id: owner, name: owner_name ?? "" } }
          : {}),
      }));
    gaps.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        compare(a.name, b.name) ||
        compare(a.id, b.id),
    );
    return { language, gaps };
  });
}

export async function listTranslationGapCounts(
  tx: Transaction,
  config: ContentLanguages,
): Promise<LanguageTranslationGapCount[]> {
  const result = await tx.execute<{
    language: string;
    count: number;
  }>(sql`${translationGapsQuery(config)}
    select enabled.value as language, count(gaps.id) as count
    from json_each(${JSON.stringify(config.languages)}) as enabled
      left join gaps on gaps.language = enabled.value
    group by enabled.key order by enabled.key`);
  return result.rows;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
