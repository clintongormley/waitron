import { decimal, type RecordExportDocument, type RecordExportValue } from "@waitron/shared";
import { renderWorkbook, type Cell } from "./xlsx-workbook.js";

function workbookCell(value: RecordExportValue | undefined): Cell {
  if (value === null || value === "") return undefined;
  if (typeof value === "number") return { number: decimal(String(value)), places: 0 };
  return typeof value === "boolean" ? String(value) : value;
}

export function renderAttendanceXlsx(
  document: RecordExportDocument,
): Promise<Uint8Array<ArrayBuffer>> {
  const keys = [
    ...new Set([
      "value",
      ...document.sections.flatMap((section) => section.columns.map((column) => column.key)),
    ]),
  ];
  const rows: Cell[][] = [["section", "row", ...keys]];
  const row = (
    section: string,
    key: string,
    cells: Readonly<Record<string, RecordExportValue>>,
  ) => {
    rows.push([section, key, ...keys.map((column) => workbookCell(cells[column]))]);
  };
  row("document", "title", { value: document.title });
  row("document", "from", { value: document.period.start });
  row("document", "before", { value: document.period.end });
  document.notes.forEach((note, i) => row("document", `note:${i}`, { value: note }));
  for (const section of document.sections)
    for (const item of section.rows) {
      const selected = Object.fromEntries(
        section.columns.map(({ key }) => [key, item.cells[key]!]),
      );
      row(section.key, item.key, selected);
    }
  return renderWorkbook([{ name: document.title, rows }]);
}
