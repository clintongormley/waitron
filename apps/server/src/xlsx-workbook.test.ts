import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
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
});
