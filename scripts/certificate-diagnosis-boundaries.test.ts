// Weaker than runtime qualification: literal source scans do not prove no writes, unchanged
// protected files or migration history, indirect imports, child execution or shipped notices.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const diagnosis = /certificate[-_]?diagnos|diagnos(?:e|is)(?:InChild|Certificate)/i;
const regimeImport =
  /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@waitron\/(?:fiscal-verifactu|verifactu)(?:[/'"])/;
function files(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(file);
    return entry.isFile() ? [file] : [];
  });
}

it("generic fiscal, dashboard support and server source acquire no regime import for diagnosis", () => {
  const source = ["packages/fiscal/src", "packages/dashboard-kit/src", "apps/server/src"]
    .flatMap(files)
    .filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("/testing/"),
    );
  expect(source.length).toBeGreaterThan(0);
  expect(source.filter((file) => regimeImport.test(read(file)))).toEqual([]);
});

it.each([
  'import { x } from "@waitron/fiscal-verifactu";',
  'await import("@waitron/verifactu/client");',
  'require("@waitron/verifactu");',
  'import "@waitron/fiscal-verifactu";',
])("detects the forbidden import form %s", (source) => {
  expect(regimeImport.test(source)).toBe(true);
});
it("accepts the optional generic seat and unrelated module imports", () => {
  expect(regimeImport.test('import type { FiscalCertificateSeat } from "@waitron/fiscal";')).toBe(
    false,
  );
  expect(regimeImport.test('import { x } from "@waitron/identity";')).toBe(false);
});

it("diagnosis stays out of protected writers, fiscal fixtures and migrations", () => {
  const source = [
    "packages/fiscal-verifactu/src/chain.ts",
    "packages/fiscal-verifactu/src/reserved-series.ts",
    "packages/fiscal-verifactu/src/schema/registros.ts",
    ...files("packages").filter((file) => /\/drizzle\//.test(file)),
    ...files("packages/fiscal-verifactu/test").filter((file) => /(?:golden|huella)/.test(file)),
  ];
  expect(source.filter((file) => diagnosis.test(read(file)))).toEqual([]);
});
it("detects diagnosis references while accepting ordinary fiscal code and SQL", () => {
  expect(diagnosis.test('import "./certificate-diagnosis.js";')).toBe(true);
  expect(diagnosis.test("await seat.diagnoseInChild(input);")).toBe(true);
  expect(diagnosis.test("CREATE TABLE receipts (id text);")).toBe(false);
  expect(diagnosis.test("await computeHuella(record);")).toBe(false);
});

function shipping(build: string, image: string): string[] {
  const problems: string[] = [];
  if (
    !build.includes(
      "src/fiscal-certificate-diagnosis-entry.ts=dist/fiscal-certificate-diagnosis.js",
    )
  )
    problems.push("missing child build");
  if (!image.includes("/src/apps/server/dist/fiscal-certificate-diagnosis.js \\\n"))
    problems.push("missing image child");
  if (!image.includes("/src/apps/server/dist/fiscal-certificate-diagnosis.js.NOTICES.txt \\\n"))
    problems.push("missing child notices");
  return problems;
}
it("builds and copies the child and its generated notices", () => {
  const build = JSON.parse(read("apps/server/package.json")).scripts.build;
  const image = read("deploy/Dockerfile");
  expect(shipping(build, image)).toEqual([]);
  expect(shipping("", image)).toEqual(["missing child build"]);
  expect(
    shipping(
      build,
      image.replace("/src/apps/server/dist/fiscal-certificate-diagnosis.js \\\n", ""),
    ),
  ).toEqual(["missing image child"]);
  expect(
    shipping(
      build,
      image.replace("/src/apps/server/dist/fiscal-certificate-diagnosis.js.NOTICES.txt \\\n", ""),
    ),
  ).toEqual(["missing child notices"]);
});
