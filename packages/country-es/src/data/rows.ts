import type { HolidayDatasetRow, HolidayDatasetYear } from "@waitron/country";

/** The annex's own mark for a row (`*`, `**`, `***`), or the clarifying note it comes from. */
export type SpanishHolidayCategory = "*" | "**" | "***" | "note-1" | "note-2";

export interface SpanishHolidayRow extends HolidayDatasetRow {
  readonly category: SpanishHolidayCategory;
  readonly englishName: string;
}

export interface SpanishHolidayYear extends HolidayDatasetYear {
  readonly rows: readonly SpanishHolidayRow[];
}

export const ALL = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].concat([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
]);

/** The row builders for one year's resolution, `source` being its BOE id. */
export function rowsFrom(source: string) {
  /** A row of the annex, keyed by the row's id: the BOE's own where its XML gives one. */
  function annex(
    row: string,
    date: string,
    name: string,
    englishName: string,
    category: "*" | "**" | "***",
    regions: readonly string[],
    extra: Partial<SpanishHolidayRow> = {},
  ): SpanishHolidayRow {
    return {
      key: `${source}:${row}`,
      date,
      name,
      englishName,
      scope: category === "***" ? "regional" : "national",
      category,
      regions,
      sourceId: source,
      ...extra,
    };
  }

  /** A holiday a clarifying note gives one area. */
  function note(
    number: 1 | 2,
    area: string,
    date: string,
    name: string,
    englishName: string,
    region: string,
  ): SpanishHolidayRow {
    return {
      key: `${source}:note-${number}:${area}`,
      date,
      name,
      englishName,
      scope: "regional",
      category: `note-${number}`,
      regions: [region],
      onlyAreas: [area],
      sourceId: source,
    };
  }

  return { annex, note };
}
