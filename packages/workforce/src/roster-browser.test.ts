import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { WorkTimeRuleset as BrowserRules } from "@waitron/workforce/roster-validation";
import { makeRuleset } from "../test/fixtures.js";

it("offers the real roster validator and rules through its public browser subpath", async () => {
  const subpath = "@waitron/workforce/roster-validation";
  const api: typeof import("./roster-validation.js") = await import(/* @vite-ignore */ subpath);
  const rules: BrowserRules = makeRuleset();
  const breaches = api.validateRoster(
    [
      {
        shiftId: "sunday",
        personId: "Ana",
        startsAt: "2026-03-01T20:00:00Z",
        endsAt: "2026-03-01T23:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      },
      {
        shiftId: "monday",
        personId: "Ana",
        startsAt: "2026-03-02T07:00:00Z",
        endsAt: "2026-03-02T10:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      },
    ],
    rules,
  );
  expect(breaches.filter((breach) => breach.kind === "rest_too_short")).toEqual([
    {
      kind: "rest_too_short",
      personId: "Ana",
      previousShiftId: "sunday",
      shiftId: "monday",
      restMinutes: 480,
      requiredMinutes: 720,
    },
  ]);
});

const RUNTIME_IMPORT =
  /^(?:import\s+(?!type\b)[\s\S]*?|export\s*(?:\*\s*(?:as\s+[\w$]+\s+)?|\{[^}]*\}\s*))from\s+["']([^"']+)["']/gm;
const runtimeImports = (source: string) =>
  [...source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").matchAll(RUNTIME_IMPORT)].map(
    (statement) => statement[1],
  );

it.each<[string, string[]]>([
  ['export { readFileSync } from "node:fs";', ["node:fs"]],
  ['export * from "node:fs";', ["node:fs"]],
  ['export * as fs from "node:fs";', ["node:fs"]],
  [
    'import {\n  // File access; deliberately forbidden here.\n  readFileSync\n} from "node:fs";',
    ["node:fs"],
  ],
  ['import {\n  readFileSync,\n  statSync,\n} from "node:fs";', ["node:fs"]],
  ['export {\n  // see {@link x}\n  readFileSync,\n} from "node:fs";', ["node:fs"]],
  ['import {\n  // was: from "./ruleset.js"\n  readFileSync,\n} from "node:fs";', ["node:fs"]],
  ['export type { Stats } from "node:fs";', []],
  ['import type { Stats } from "node:fs";', []],
  ['const x = 1;\nexport { x };\nimport type { Stats } from "node:fs";', []],
])("reads the runtime imports of %j as %j", (source, expected) => {
  expect(runtimeImports(source)).toEqual(expected);
});

it("keeps the validator and rules' runtime imports and re-exports inside the browser entry", () => {
  const files = ["roster-validation.ts", "ruleset.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const specifier of runtimeImports(source))
      expect(files, `${file}: ${specifier}`).toContain(
        specifier!.replace("./", "").replace(/\.js$/, ".ts"),
      );
    expect(source).not.toMatch(/\b(?:require\s*\(|import\s*\()/);
    expect(source).not.toMatch(/^import\s*["']/m);
  }
});
