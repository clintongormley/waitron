import { main, transformSource } from "./venue-document-fixtures.mjs";
import ts from "typescript";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 35_000 });

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const move = "name,city=seedVenueSettings";
function run(source, relative = "fixture.ts") {
  const dir = mkdtempSync(join(tmpdir(), "venue-document-script-"));
  dirs.push(dir);
  const file = join(dir, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, source);
  const invoke = () => {
    const output = [];
    main(["--move", move, "--write", file], (line) => output.push(line));
    return { source: readFileSync(file, "utf8"), report: output.join("\n") };
  };
  return { ...invoke(), invoke };
}

it("moves properties into a new helper call and adds its import", () => {
  const out = run('await db.insert(locations).values({ id, name: "Venue", city });');
  expect(out.source).toContain('import { seedVenueSettings } from "@waitron/db/testing/seed.js";');
  expect(out.source).toMatch(/values\(\{\s*id\s*\}\)/);
  expect(out.source).toMatch(/await seedVenueSettings\(db, \{\s*name: "Venue", city\s*\}\);/);
  expect(out.invoke().source).toBe(out.source);
});
it("creates an empty call when the insert relies on defaults", () => {
  const out = run('await tx.insert(locations).values({ invoiceLocales: ["en"] });');
  expect(out.source).toMatch(/await seedVenueSettings\(tx, \{\s*\}\);/);
});
it.each(["seedNode", "seedNode,"])(
  "merges a following helper and extends an import containing %s",
  (imported) => {
    const out = run(
      `import { ${imported} } from "@waitron/db/testing/seed.js";\nawait db.insert(locations).values({ name: title });\nawait seedVenueSettings(db, { city: "Port" });`,
    );
    expect(out.source.match(/await seedVenueSettings/g)).toHaveLength(1);
    expect(out.source).toContain('city: "Port"');
    expect(out.source).toContain("name: title");
    expect(out.source).toContain("seedVenueSettings");
    expect(
      ts.createSourceFile("fixture.ts", out.source, ts.ScriptTarget.Latest, true).parseDiagnostics,
    ).toEqual([]);
  },
);
it("strips and reports later inserts without creating another document", () => {
  const out = run(
    'await db.insert(locations).values({ name: "First" });\nawait db.insert(locations).values({ name: "Second", invoiceLocales });',
  );
  expect(out.source.match(/await seedVenueSettings/g)).toHaveLength(1);
  expect(out.source).not.toContain('"Second"');
  expect(out.report).toContain("second insert");
});
it.each(["{ ...values, name }", "{ [field]: value }", "values"])(
  "reports unsupported values %s without editing",
  (value) => {
    const source = `await db.insert(locations).values(${value});`;
    const out = run(source);
    expect(out.source).toBe(source);
    expect(out.report).toContain("not edited");
  },
);
it.each(["write-path.e2e.test.ts", "inmutabilidad.test.ts"])(
  "leaves the protected fiscal file %s untouched",
  (file) => {
    const source = "await db.insert(locations).values({ name });";
    const out = run(source, `packages/fiscal-verifactu/src/${file}`);
    expect(out.source).toBe(source);
    expect(out.report).toContain("fiscal pair");
  },
);

it("runs as a command and previews without changing the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "venue-document-cli-"));
  dirs.push(dir);
  const file = join(dir, "fixture.ts");
  const source = "await db.insert(locations).values({ name });";
  writeFileSync(file, source);
  const args = [resolve("scripts/a1308/venue-document-fixtures.mjs"), "--move", move, file];
  const preview = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
  expect(preview.status, preview.stderr).toBe(0);
  expect(preview.stdout).toContain("would change");
  expect(readFileSync(file, "utf8")).toBe(source);
  const output = [];
  main(args.slice(1), (line) => output.push(line));
  expect(output.join("\n")).toContain("would change");
  expect(readFileSync(file, "utf8")).toBe(source);
});
it.each([[], ["--move", "bad", "fixture.ts"], ["fixture.ts"], ["--move"]].map((args) => [args]))(
  "refuses incomplete arguments %j",
  (args) => {
    expect(() => main(args)).toThrow(/Expected/);
  },
);
it("moves several helper groups after a returning insert and keeps explicit following values", () => {
  const input =
    'const [row] = await db.insert(locations).values({ name, city, dayCutover });\nawait seedVenueSettings(db, { name: "Override" });';
  const result = transformSource("fixture.ts", input, [
    { fields: ["name", "city"], helper: "seedVenueSettings" },
    { fields: ["dayCutover"], helper: "seedClock" },
  ]);
  expect(result.source).toContain('name: "Override", city');
  expect(result.source).toContain("await seedClock(db, { dayCutover });");
  expect(result.source).toMatch(/values\(\{\s*\}\)/);
  expect(
    transformSource("fixture.ts", result.source, [
      { fields: ["name", "city"], helper: "seedVenueSettings" },
      { fields: ["dayCutover"], helper: "seedClock" },
    ]).source,
  ).toBe(result.source);
});
it.each([
  "db.insert(locations).values({ name });",
  "await db.insert(other).values({ name });",
  "await other();",
  "await db.insert(locations).values();",
])("leaves unsupported or unrelated statement %s alone", (source) => {
  const result = transformSource("fixture.ts", source, [
    { fields: ["name"], helper: "seedVenueSettings" },
  ]);
  expect(result.source).toBe(source);
});
it("retains comments on untouched fields and fills an empty import", () => {
  const input =
    'import {} from "@waitron/db/testing/seed.js";\nawait db.insert(locations).values({ name,\n // The clock stays in this row.\n dayCutover, city, });';
  const result = transformSource("fixture.ts", input, [
    { fields: ["name", "city"], helper: "seedVenueSettings" },
  ]);
  expect(result.source).toContain("// The clock stays in this row.");
  expect(result.source).toContain("dayCutover");
  expect(result.source).toContain("import { seedVenueSettings}");
  expect(
    ts.createSourceFile("fixture.ts", result.source, ts.ScriptTarget.Latest, true).parseDiagnostics,
  ).toEqual([]);
});
it("handles a trailing comma when every property moves and reports an unbraced conditional", () => {
  const moved = transformSource(
    "fixture.ts",
    "await db.insert(locations).values({ name, });\nconst next = 1;",
    [{ fields: ["name"], helper: "seedVenueSettings" }],
  );
  expect(moved.source).toMatch(/values\(\{\s*\}\)/);
  const conditional = "if (ready) await db.insert(locations).values({ name });";
  expect(
    transformSource("fixture.ts", conditional, [{ fields: ["name"], helper: "seedVenueSettings" }]),
  ).toEqual({ source: conditional, report: ["fixture.ts: statement not edited"] });
});
