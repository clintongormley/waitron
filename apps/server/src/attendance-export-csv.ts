import type { RecordExportDocument, RecordExportValue } from "@waitron/shared";

function cell(value: RecordExportValue): string {
  // Quoting protects CSV structure; the apostrophe also keeps leading text out of spreadsheet formulas.
  const text =
    typeof value === "string" && (/^\s*[=+\-@]/u.test(value) || /^\s*[\t\r]/u.test(value))
      ? `'${value}`
      : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderAttendanceCsv(document: RecordExportDocument): Uint8Array {
  const keys = [
    ...new Set(["value", ...document.sections.flatMap((s) => s.columns.map((c) => c.key))]),
  ];
  const lines = [["section", "row", ...keys].map(cell).join(",")];
  const row = (
    section: string,
    key: string,
    cells: Readonly<Record<string, RecordExportValue>>,
  ) => {
    lines.push(
      [section, key, ...keys.map((k) => cells[k] ?? (cells[k] === null ? null : ""))]
        .map(cell)
        .join(","),
    );
  };
  row("document", "title", { value: document.title });
  row("document", "from", { value: document.period.start });
  row("document", "before", { value: document.period.end });
  document.notes.forEach((note, i) => row("document", `note:${i}`, { value: note }));
  for (const section of document.sections)
    for (const item of section.rows) {
      const selected = Object.fromEntries(section.columns.map((c) => [c.key, item.cells[c.key]!]));
      row(section.key, item.key, selected);
    }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
