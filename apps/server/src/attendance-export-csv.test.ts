import { describe, expect, it } from "vitest";
import type { RecordExportDocument } from "@waitron/shared";
import {
  attendanceExportFixture,
  longReason,
  longToken,
} from "../test/attendance-export-fixture.js";
import { renderAttendanceCsv } from "./attendance-export-csv.js";

// Read quoted RFC 4180 cells, including embedded line endings, independently of the writer.
function parse(bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes);
  return Array.from(text.matchAll(/(?:"(?:[^"]|"")*"|[^,\r\n]*)(?:,|\r\n)/g))
    .reduce<string[][]>(
      (rows, match) => {
        const raw = match[0];
        const end = raw.endsWith("\r\n");
        const cell = raw.slice(0, end ? -2 : -1);
        rows.at(-1)!.push(cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell);
        if (end) rows.push([]);
        return rows;
      },
      [[]],
    )
    .filter((r) => r.length > 0);
}

function document(value: string | number | boolean | null): RecordExportDocument {
  return {
    title: "Title",
    locale: "en",
    audience: "standard",
    period: { start: "2020-01-01", end: "2026-01-01" },
    notes: [],
    sections: [
      {
        key: "history",
        title: "History",
        layout: "details",
        columns: [
          { key: "personName", label: "Name" },
          { key: "reason", label: "Reason" },
        ],
        rows: [{ key: "one", cells: { personName: value, reason: value } }],
      },
    ],
  };
}

describe("working-time CSV", () => {
  it("round-trips all selected columns and rows with a BOM and CRLF", () => {
    const input = attendanceExportFixture();
    const bytes = renderAttendanceCsv(input);
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const [header, ...rows] = parse(bytes);
    expect(header).toEqual([
      "section",
      "row",
      "value",
      "personName",
      "workedMinutes",
      "authorName",
      "offsetMinutes",
      "confirmedByWorker",
      "correctsEntryId",
      "text",
      "token",
      "reason",
      "reference",
    ]);
    expect(rows.slice(0, 5).map((row) => row.slice(0, 3))).toEqual([
      ["document", "title", input.title],
      ["document", "from", "2020-01-01"],
      ["document", "before", "2026-02-01"],
      ["document", "note:0", input.notes[0]],
      ["document", "note:1", input.notes[1]],
    ]);
    const data = rows.filter((row) => row[0] !== "document");
    expect(data).toHaveLength(12);
    for (const section of input.sections)
      for (const row of section.rows) {
        const actual = data.find((r) => r[0] === section.key && r[1] === row.key)!;
        expect(actual, section.key).toBeDefined();
        for (const { key } of section.columns)
          expect(actual[header!.indexOf(key)], `${section.key}.${key}`).toBe(
            String(row.cells[key]),
          );
      }
    expect(data[1]![header!.indexOf("reason")]).toBe(longReason);
    expect(data[1]![header!.indexOf("token")]).toBe(longToken);
    expect(new TextDecoder().decode(bytes).endsWith("\r\n")).toBe(true);
  });

  it.each([
    "=HYPERLINK(1)",
    "+SUM(1)",
    "-60",
    "@SUM(1)",
    "\tformula",
    "\rformula",
    "  =1",
    " \tordinary",
    "\n@SUM(1)",
  ])("neutralizes spreadsheet text %j in names and reasons", (value) => {
    const [header, ...rows] = parse(renderAttendanceCsv(document(value)));
    const row = rows.at(-1)!;
    expect(row[header!.indexOf("personName")]).toBe(`'${value}`);
    expect(row[header!.indexOf("reason")]).toBe(`'${value}`);
  });

  it.each([
    "María Muñoz",
    'comma, and "quote"\r\nniñez',
    "  ordinary",
    "",
    "line\nwrap",
    -60,
    true,
    false,
    null,
  ])("keeps ordinary values %j", (value) => {
    const [header, ...rows] = parse(renderAttendanceCsv(document(value)));
    expect(rows.at(-1)![header!.indexOf("personName")]).toBe(String(value));
  });

  it("protects textual metadata, section keys, row keys and column keys", () => {
    const input = document("ordinary");
    input.title = "=title";
    input.notes = ["\tNOTE"];
    input.sections = [
      {
        key: "@section",
        title: "Title",
        layout: "details",
        columns: [{ key: "+column", label: "Column" }],
        rows: [{ key: "-row", cells: { "+column": "=value" } }],
      },
    ];
    const [header, ...rows] = parse(renderAttendanceCsv(input));
    expect(header!.at(-1)).toBe("'+column");
    expect(rows[0]![2]).toBe("'=title");
    expect(rows[3]![2]).toBe("'\tNOTE");
    expect(rows.at(-1)!.slice(0, 2)).toEqual(["'@section", "'-row"]);
    expect(rows.at(-1)!.at(-1)).toBe("'=value");
  });
});
