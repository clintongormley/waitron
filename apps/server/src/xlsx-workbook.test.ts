import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { renderWorkbook } from "./xlsx-workbook.js";

describe("renderWorkbook", () => {
  it("escapes a sheet name in the workbook part", async () => {
    const files = unzipSync(await renderWorkbook([{ name: `Tom & "Jerry" <1>`, rows: [["a"]] }]));
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain(
      'name="Tom &amp; &quot;Jerry&quot; &lt;1&gt;"',
    );
  });

  it("writes one part per sheet, in order, each declared and related", async () => {
    const files = unzipSync(
      await renderWorkbook([
        { name: "First", rows: [["one"]] },
        { name: "Second", rows: [["two"]] },
      ]),
    );
    const workbook = strFromU8(files["xl/workbook.xml"]!);
    const relationships = strFromU8(files["xl/_rels/workbook.xml.rels"]!);
    const types = strFromU8(files["[Content_Types].xml"]!);
    for (const [index, name] of ["First", "Second"].entries()) {
      const id = workbook.match(new RegExp(`<sheet name="${name}"[^>]*r:id="([^"]+)"`))?.[1];
      expect(relationships).toMatch(
        new RegExp(`<Relationship Id="${id}"[^>]*Target="worksheets/sheet${index + 1}.xml"`),
      );
      expect(types).toContain(`/xl/worksheets/sheet${index + 1}.xml`);
    }
    expect(strFromU8(files["xl/worksheets/sheet2.xml"]!)).toContain(">two</t>");
    expect(relationships).toContain('Target="styles.xml"');
  });

  it("names columns past Z in base 26, as A to Z then AA, AZ, BA, ZZ, AAA", async () => {
    const cells = Array.from({ length: 703 }, (_, index) => String(index));
    const sheet = strFromU8(
      unzipSync(await renderWorkbook([{ name: "Wide", rows: [cells, ["a", "b"]] }]))[
        "xl/worksheets/sheet1.xml"
      ]!,
    );
    const reference = (index: number) =>
      sheet.match(
        new RegExp(`<c r="([A-Z]+1)" t="inlineStr"><is><t xml:space="preserve">${index}<`),
      )?.[1];
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(reference)).toEqual([
      "A1",
      "Z1",
      "AA1",
      "AB1",
      "AZ1",
      "BA1",
      "ZZ1",
      "AAA1",
    ]);
    expect(sheet).toContain(
      '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">a</t></is></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">b</t></is></c></row>',
    );
  });
  it("a three-place number cell uses the 0.000 style, and a plain number cell keeps two places", async () => {
    const files = unzipSync(
      await renderWorkbook([
        {
          name: "Numbers",
          rows: [[{ number: decimal("0.125"), places: 3 }, { number: decimal("1.50") }]],
        },
      ]),
    );
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<c r="A1" t="n" s="2"><v>0.125</v></c>');
    expect(sheet).toContain('<c r="B1" t="n" s="1"><v>1.50</v></c>');
    const styles = strFromU8(files["xl/styles.xml"]!);
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="0.000"/>');
    const formats = [...styles.matchAll(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/g)][0]!;
    const xfs = [...formats[2]!.matchAll(/<xf numFmtId="(\d+)"/g)].map((xf) => xf[1]);
    expect(xfs).toEqual(["0", "2", "164"]);
    expect(formats[1]).toBe("3");
  });
});
