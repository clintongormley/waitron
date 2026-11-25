import { describe, expect, it } from "vitest";
import type { RecordExportDocument } from "@waitron/shared";
import {
  attendanceExportFixture,
  longReason,
  longToken,
} from "../test/attendance-export-fixture.js";
import { renderAttendanceXlsx } from "./attendance-export-xlsx.js";
import { worksheetRows, worksheetText } from "./testing/xlsx-rows.js";

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

describe("working-time Excel", () => {
  it("round-trips the selected columns and rows", async () => {
    const input = { ...attendanceExportFixture(), title: "Registro de jornada" };
    const xml = worksheetText(await renderAttendanceXlsx(input));
    const [header, ...rows] = worksheetRows(xml);
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
          expect(actual[header!.indexOf(key)] ?? "", `${section.key}.${key}`).toBe(
            key === "text"
              ? "&lt;script&gt;alert(1)&lt;/script&gt; /OpenAction https://example.test/ � � 😀 TEXT-FINAL"
              : String(row.cells[key] ?? ""),
          );
      }
    expect(data[1]![header!.indexOf("reason")]).toBe(longReason);
    expect(data[1]![header!.indexOf("token")]).toBe(longToken);
    expect(xml.includes('<c r="C7"')).toBe(false);
    expect(xml).toContain('<c r="E7" t="n" s="0"><v>480</v></c>');
    expect(xml.includes('<c r="I8"')).toBe(false);
    expect(xml.includes('<c r="C9"')).toBe(false);
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
  ])("writes formula-looking text %j in literal cells", async (value) => {
    const xml = worksheetText(await renderAttendanceXlsx(document(value)));
    const [header, ...rows] = worksheetRows(xml);
    const row = rows.at(-1)!;
    expect(row[header!.indexOf("personName")]).toBe(value.replaceAll("\r", "&#13;"));
    expect(row[header!.indexOf("reason")]).toBe(value.replaceAll("\r", "&#13;"));
    expect(xml).not.toContain("<f");
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
  ])("keeps ordinary values %j", async (value) => {
    const [header, ...rows] = worksheetRows(
      worksheetText(await renderAttendanceXlsx(document(value))),
    );
    expect(rows.at(-1)![header!.indexOf("personName")] ?? "").toBe(
      String(value ?? "")
        .replaceAll('"', "&quot;")
        .replaceAll("\r", "&#13;"),
    );
  });

  it("keeps textual metadata and keys in literal cells", async () => {
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
    const xml = worksheetText(await renderAttendanceXlsx(input));
    const [header, ...rows] = worksheetRows(xml);
    expect(header!.at(-1)).toBe("+column");
    expect(rows[0]![2]).toBe("=title");
    expect(rows[3]![2]).toBe("\tNOTE");
    expect(rows.at(-1)!.slice(0, 2)).toEqual(["@section", "-row"]);
    expect(rows.at(-1)!.at(-1)).toBe("=value");
    expect(xml).not.toContain("<f");
  });
});
