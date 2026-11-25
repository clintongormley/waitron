import { strFromU8, unzipSync } from "fflate";

/** The text of each cell in row `number` of a worksheet's XML, numbers as written. */
export function row(xml: string, number: number): string[] {
  const body = xml.match(new RegExp(`<row r="${number}">([\\s\\S]*?)</row>`))?.[1] ?? "";
  const values: string[] = [];
  for (const cell of body.matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
    const column = Array.from(cell[1]!).reduce(
      (n, letter) => n * 26 + letter.charCodeAt(0) - 64,
      0,
    );
    while (values.length < column - 1) values.push("");
    values.push(cell[2]!.match(/<(?:t(?: [^>]*)?|v)>([\s\S]*?)<\/(?:t|v)>/)?.[1] ?? "");
  }
  return values;
}

/** The worksheet XML of the sheet called `name` (written as is, unescaped), found through the workbook's relationships. */
export function sheetNamed(
  files: Readonly<Record<string, Uint8Array>>,
  name: string,
): string | undefined {
  const text = (part: string) => new TextDecoder().decode(files[part]);
  const id = text("xl/workbook.xml").match(
    new RegExp(`<sheet name="${name}"[^>]*r:id="([^"]+)"`),
  )?.[1];
  const target = text("xl/_rels/workbook.xml.rels").match(
    new RegExp(`<Relationship Id="${id}"[^>]*Target="([^"]+)"`),
  )?.[1];
  const part = target === undefined ? undefined : files[`xl/${target}`];
  return part === undefined ? undefined : new TextDecoder().decode(part);
}

export function worksheetText(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);
}

export function worksheetRows(xml: string): string[][] {
  return [...xml.matchAll(/<row r="(\d+)">/g)].map((match) => row(xml, Number(match[1])));
}
