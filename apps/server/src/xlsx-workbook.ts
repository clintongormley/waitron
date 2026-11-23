import { setImmediate as nextTurn } from "node:timers/promises";
import { strToU8, zip } from "fflate";
import { decimal, toScale, type Decimal } from "@waitron/shared";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORKSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const STYLES = `${XML}<styleSheet xmlns="${SHEET}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export type Cell = string | null | { number: Decimal };
export const numeric = (value: string): Cell => ({ number: toScale(decimal(value), 2) });

export interface WorkbookSheet {
  name: string;
  rows: readonly (readonly Cell[])[];
}

function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r\x20-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "�")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;");
}

/** The spreadsheet name of the zero-based `column`: A to Z, then AA, AB and on. */
function columnName(column: number): string {
  let name = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

async function worksheet(rows: readonly (readonly Cell[])[]): Promise<string> {
  const parts = [`${XML}<worksheet xmlns="${SHEET}"><sheetData>`];
  for (const [index, row] of rows.entries()) {
    if (index % 250 === 0) await nextTurn();
    parts.push(
      `<row r="${index + 1}">${row
        .map((cell, column) => {
          const reference = `${columnName(column)}${index + 1}`;
          return cell !== null && typeof cell === "object"
            ? `<c r="${reference}" t="n" s="1"><v>${cell.number}</v></c>`
            : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(cell ?? "")}</t></is></c>`;
        })
        .join("")}</row>`,
    );
  }
  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

/** A workbook's per-request response headers: downloaded as `filename`, never cached or sniffed. */
export function workbookDownloadHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function renderWorkbook(
  sheets: readonly WorkbookSheet[],
): Promise<Uint8Array<ArrayBuffer>> {
  const numbered = sheets.map((sheet, index) => ({ ...sheet, number: index + 1 }));
  const stylesId = `rId${sheets.length + 1}`;
  const parts: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${numbered
      .map(
        ({ number }) =>
          `<Override PartName="/xl/worksheets/sheet${number}.xml" ContentType="${WORKSHEET_TYPE}"/>`,
      )
      .join(
        "",
      )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${SHEET}" xmlns:r="${REL}"><sheets>${numbered
      .map(
        ({ name, number }) =>
          `<sheet name="${xmlText(name)}" sheetId="${number}" r:id="rId${number}"/>`,
      )
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${numbered
      .map(
        ({ number }) =>
          `<Relationship Id="rId${number}" Type="${REL}/worksheet" Target="worksheets/sheet${number}.xml"/>`,
      )
      .join(
        "",
      )}<Relationship Id="${stylesId}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": STYLES,
  };
  for (const { rows, number } of numbered) {
    parts[`xl/worksheets/sheet${number}.xml`] = await worksheet(rows);
  }
  const entries = Object.fromEntries(
    Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]),
  );
  return new Promise((resolve, reject) => {
    zip(entries, (error, bytes) => {
      if (error) reject(error);
      else resolve(bytes);
    });
  });
}
