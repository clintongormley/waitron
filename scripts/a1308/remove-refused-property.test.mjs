import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { main, refusals, removeAt, run } from "./remove-refused-property.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("parses both output forms, selecting only the named property refusal", () => {
  const message =
    "Object literal may only specify known properties, and 'menuId' does not exist in type 'Input'.";
  expect(
    refusals(
      [
        `src/a.ts(2,3): error TS2353: ${message}`,
        `src/b.ts:4:5 - error TS2353: ${message}`,
        "src/c.ts(1,2): error TS2353: Object literal may only specify known properties, and 'name' does not exist in type 'Input'.",
        "src/a.ts(3,4): error TS2339: Property 'menuId' does not exist on type 'Product'.",
      ].join("\n"),
      "menuId",
    ),
  ).toEqual([
    { file: "src/a.ts", line: 2, column: 3 },
    { file: "src/b.ts", line: 4, column: 5 },
  ]);
});

it("reads the property's nested refusal in an insert overload diagnostic", () => {
  expect(
    refusals(
      "src/a.ts(2,3): error TS2769: No overload matches this call.\n  The last overload gave the following error.\n    Object literal may only specify known properties, and 'menuId' does not exist in type 'Insert[]'.",
      "menuId",
    ),
  ).toEqual([{ file: "src/a.ts", line: 2, column: 3 }]);
});

it("removes a property on its own line", () => {
  expect(
    removeAt(
      "const x = {\n  menuId: menu.id,\n  name: 'Tea',\n};\n",
      [{ line: 2, column: 3 }],
      "menuId",
    ),
  ).toBe("const x = {\n  name: 'Tea',\n};\n");
});

it("removes a shorthand property and its comma", () => {
  expect(removeAt("const x = { menuId, name: 'Tea' };", [{ line: 1, column: 13 }], "menuId")).toBe(
    "const x = {  name: 'Tea' };",
  );
});

it("removes a property in the middle of a one-line object", () => {
  expect(
    removeAt(
      "const x = { a: 1, menuId: f({a: 2}, 3), b: 4 };",
      [{ line: 1, column: 19 }],
      "menuId",
    ),
  ).toBe("const x = { a: 1,  b: 4 };");
});

it("removes quoted and multiline properties using original positions", () => {
  const source =
    'const x = {\n  "menuId": f(\n    { nested: 1 }, 2\n  ),\n  name: "Tea",\n  menuId: other\n};';
  expect(
    removeAt(
      source,
      [
        { line: 2, column: 3 },
        { line: 6, column: 3 },
      ],
      "menuId",
    ),
  ).toBe('const x = {\n  name: "Tea",\n};');
});

it("refuses a position that does not name the property", () => {
  expect(() =>
    removeAt("const x = { name: menuId };", [{ line: 1, column: 19 }], "menuId"),
  ).toThrow(/1:19/);
});

it("counts each refused property once and is idempotent with an empty error list", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-refused-property-"));
  roots.push(root);
  writeFileSync(join(root, "a.ts"), "const x = { menuId, name: 'Tea' };");
  writeFileSync(
    join(root, "errors.txt"),
    "a.ts(1,13): error TS2353: Object literal may only specify known properties, and 'menuId' does not exist in type 'Input'.\n".repeat(
      2,
    ),
  );
  expect(run({ root, property: "menuId", outputFile: join(root, "errors.txt") })).toEqual({
    removed: 1,
  });
  expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = {  name: 'Tea' };");
  writeFileSync(join(root, "errors.txt"), "");
  expect(run({ root, property: "menuId", outputFile: join(root, "errors.txt") })).toEqual({
    removed: 0,
  });
  expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = {  name: 'Tea' };");
});

it("keeps a file unchanged when any position in that file is wrong", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-refused-property-"));
  roots.push(root);
  const source = "const x = { menuId, name: 'Tea' };";
  writeFileSync(join(root, "a.ts"), source);
  writeFileSync(
    join(root, "errors.txt"),
    [13, 21]
      .map(
        (column) =>
          `a.ts(1,${column}): error TS2353: Object literal may only specify known properties, and 'menuId' does not exist in type 'Input'.`,
      )
      .join("\n"),
  );
  expect(() => run({ root, property: "menuId", outputFile: join(root, "errors.txt") })).toThrow(
    /1:21/,
  );
  expect(readFileSync(join(root, "a.ts"), "utf8")).toBe(source);
});

it("runs from the checked package's directory and refuses an incomplete command", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-refused-property-"));
  roots.push(root);
  const script = fileURLToPath(new URL("./remove-refused-property.mjs", import.meta.url));
  writeFileSync(join(root, "a.ts"), "const x = { menuId };");
  writeFileSync(
    join(root, "errors.txt"),
    "a.ts(1,13): error TS2353: Object literal may only specify known properties, and 'menuId' does not exist in type 'Input'.",
  );
  expect(main(["--property", "menuId", "errors.txt"], root)).toEqual({ removed: 1 });
  expect(() => main([], root)).toThrow(/Usage:/);
  expect(() => main(["--property", "menuId", "errors.txt", "extra"], root)).toThrow(/Usage:/);
  writeFileSync(join(root, "a.ts"), "const x = { menuId };");
  execFileSync(process.execPath, [script, "--property", "menuId", "errors.txt"], { cwd: root });
  expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = { };");
  expect(() => execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" })).toThrow();
});
