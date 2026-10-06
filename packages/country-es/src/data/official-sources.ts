/**
 * Reads the archived BOE and INE pages in `sources/` for the holiday data's tests and its annual
 * update. Nothing the pack ships imports this file: the pack reads only the typed constants.
 */
import type { SpanishHolidayYear } from "./es-2026.js";

export interface AnnexRow {
  readonly id: string;
  readonly date: string;
  readonly name: string;
  readonly marks: readonly string[];
}

export interface Annex {
  readonly title: string;
  readonly year: number;
  readonly columns: readonly string[];
  readonly rows: readonly AnnexRow[];
  readonly codes: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly paragraphs: readonly string[];
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
};

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-zA-Z]+);/g, (whole, entity: string) =>
      entity.startsWith("#")
        ? String.fromCodePoint(Number(entity.slice(1)))
        : (ENTITIES[entity] ?? whole),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthNumber(name: string): number {
  const index = MONTHS.indexOf(name.toLowerCase());
  if (index < 0) throw new Error(`unknown month ${name}`);
  return index + 1;
}

export function parseAnnex(xml: string): Annex {
  const title = text(/<titulo>([\s\S]*?)<\/titulo>/.exec(xml)![1]!);
  const body = xml.slice(xml.indexOf('<p class="anexo_num">'));
  const year = Number(
    /^Año (\d{4})$/.exec(text(/<p class="anexo_tit">([\s\S]*?)<\/p>/.exec(body)![1]!))![1],
  );
  const table = body.slice(0, body.indexOf("</table>"));
  const columns = [...table.matchAll(/<th axis="comunidad"[^>]*>([\s\S]*?)<\/th>/g)].map(
    ([, header]) => text(header!).replace(/\s*\(\d+\)$/, ""),
  );
  const rows: AnnexRow[] = [];
  let month = 0;
  for (const [, row] of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row!.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
    if (cells.length === 0) continue;
    const [first, ...rest] = cells;
    if (first![1]!.includes('axis="mes"')) {
      month = monthNumber(text(first![2]!));
      continue;
    }
    const label = /^(\d+) (.*)\.$/.exec(text(first![2]!))!;
    rows.push({
      id: /id="header([^"]+)"/.exec(first![1]!)![1]!,
      date: `${year}-${pad(month)}-${pad(Number(label[1]))}`,
      name: label[2]!,
      marks: rest.map(([, , cell]) => text(cell!)),
    });
  }
  const after = body.slice(body.indexOf("</table>"));
  const paragraphs = [...xml.matchAll(/<p class="[^"]*">([\s\S]*?)<\/p>/g)].map(([, p]) =>
    text(p!),
  );
  const codes: Record<string, string> = {};
  for (const [, label, mark] of after.matchAll(/<p class="[^"]*">([^<(]+) \((\*+)\)\.<\/p>/g))
    codes[mark!] = label!.trim();
  const notes = [...after.matchAll(/<p class="[^"]*">(\d+\.\s[\s\S]*?)<\/p>/g)].map(([, p]) =>
    text(p!),
  );
  return { title, year, columns, rows, codes, notes, paragraphs };
}

/** Every row of every table in an HTML page, as the text of its cells. */
export function parseHtmlTable(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => text(cell!)),
  );
}

/** One applicable (fact, region) pair, as one comparable line. */
function line(
  key: string,
  date: string,
  name: string,
  scope: string,
  category: string,
  region: string,
  area: string,
): string {
  return [key, date, name, scope, category, region, area].join(" | ");
}

/**
 * What the annex says, as comparable lines: one per marked cell, and one per holiday a clarifying
 * note gives an area. Note 1 adds a holiday per island; note 2 swaps one of its region's days for
 * another in one area.
 */
export function expectedRowsFromAnnex(
  annex: Annex,
  sourceId: string,
  columns: readonly { boe: string; region: string }[],
  areaByName: (name: string) => string | undefined,
): string[] {
  const regionOf = (column: string) => columns.find(({ boe }) => boe === column)!.region;
  const areaOf = (name: string) => {
    const key = areaByName(name);
    if (key === undefined) throw new Error(`no area is named ${name}`);
    return key;
  };
  const dateOf = (day: string, month: string) =>
    `${annex.year}-${pad(monthNumber(month))}-${pad(Number(day))}`;
  const lines: string[] = [];
  const exceptions = new Map<string, string>();

  for (const note of annex.notes) {
    const number = Number(/^(\d+)\./.exec(note)![1]);
    const region = regionOf(/^\d+\. En la Comunidad Autónoma de ([^,]+),/.exec(note)![1]!);
    const category = `note-${number}`;
    const islands = [...note.matchAll(/en ([^:;]+): el (\d+) de (\w+), festividad de ([^;»]+)/g)];
    for (const [, place, dayOfMonth, month, name] of islands) {
      const area = areaOf(place!);
      lines.push(
        line(
          `${sourceId}:${category}:${area}`,
          dateOf(dayOfMonth!, month!),
          `Festividad de ${name!.trim()}`,
          "regional",
          category,
          region,
          `only:${area}`,
        ),
      );
    }
    const swap =
      /En el territorio de ([^,]+), la fiesta del día (\d+) de (\w+) \([^)]+\) queda sustituida por la de (\d+) de (\w+) \(([^)]+)\)/.exec(
        note,
      );
    if (swap !== null) {
      const [, place, oldDay, oldMonth, newDay, newMonth, name] = swap;
      const area = areaOf(place!);
      exceptions.set(`${dateOf(oldDay!, oldMonth!)} ${region}`, area);
      lines.push(
        line(
          `${sourceId}:${category}:${area}`,
          dateOf(newDay!, newMonth!),
          name!,
          "regional",
          category,
          region,
          `only:${area}`,
        ),
      );
    }
    if (islands.length === 0 && swap === null) throw new Error(`note ${number} was not read`);
  }

  for (const row of annex.rows)
    row.marks.forEach((mark, column) => {
      if (mark === "") return;
      const region = regionOf(annex.columns[column]!);
      const except = exceptions.get(`${row.date} ${region}`);
      lines.push(
        line(
          `${sourceId}:${row.id}`,
          row.date,
          row.name,
          mark === "***" ? "regional" : "national",
          mark,
          region,
          except === undefined ? "" : `except:${except}`,
        ),
      );
    });
  return lines.sort();
}

/** The shipped rows as the same lines. An area restriction shows only in the region its area is
 * in, because elsewhere it changes nothing. */
export function normalizeShippedRows(
  year: SpanishHolidayYear,
  regionOfArea: (areaKey: string) => string | undefined,
): string[] {
  return year.rows
    .flatMap((row) =>
      row.regions.map((region) => {
        const here = (area: string) => regionOfArea(area) === region;
        return line(
          row.key,
          row.date,
          row.name,
          row.scope,
          row.category,
          region,
          [
            ...(row.onlyAreas ?? []).filter(here).map((area) => `only:${area}`),
            ...(row.exceptAreas ?? []).filter(here).map((area) => `except:${area}`),
          ].join(","),
        );
      }),
    )
    .sort();
}

export function compareRows(
  expected: readonly string[],
  shipped: readonly string[],
): { missing: string[]; extra: string[] } {
  const wanted = new Set(expected);
  const have = new Set(shipped);
  return {
    missing: expected.filter((entry) => !have.has(entry)),
    extra: shipped.filter((entry) => !wanted.has(entry)),
  };
}
