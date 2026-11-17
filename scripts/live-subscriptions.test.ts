// The root gate checks every UI module even when package-scoped CI would omit its server owner.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { enabledModules, parseModuleConfig } from "../packages/module/src/index.js";
import { QUERY_DEPENDENCIES } from "../apps/dashboard/src/api/live-queries.js";
import { liveResourceTypesForModules } from "../apps/server/src/live-resources.js";
import { TILL_LIVE_TYPES } from "../apps/till/src/api/live-connection.js";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

function inlineDependencyLines(text: string): number[] {
  return [...text.matchAll(/\bdependencies\s*:\s*\[(?!\s*\])/g)].map(
    (match) => text.slice(0, match.index).split("\n").length,
  );
}

it.each([
  {},
  ...ALL_MODULES.filter((module) => module.tier !== "mandatory").map((module) => ({
    [module.name]: false,
  })),
])("every till interest names a resource the device stream accepts with %j", (overrides) => {
  const modules = enabledModules(
    ALL_MODULES,
    parseModuleConfig({ modules: overrides }, ALL_MODULES),
  );
  const allowed = new Set(liveResourceTypesForModules(modules));
  expect(
    Object.entries(TILL_LIVE_TYPES).flatMap(([reader, types]) =>
      (reader === "clocking" && !modules.some((module) => module.name === "workforce") ? [] : types)
        .filter((type) => !allowed.has(type))
        .map((type) => `${reader}:${type}`),
    ),
  ).toEqual([]);
});

it("every shipped dashboard query subscribes only to a declared server resource", async () => {
  const root = join(import.meta.dirname, "..");
  const allowed = new Set(liveResourceTypesForModules(ALL_MODULES));
  const groups: { source: string; queries: Record<string, readonly string[]> }[] = [
    { source: "apps/dashboard", queries: QUERY_DEPENDENCIES },
  ];
  for (const name of readdirSync(join(root, "packages"))) {
    const dashboard = join(root, "packages", name, "src/dashboard");
    if (!existsSync(join(dashboard, "index.ts"))) continue;
    const declarations = join(dashboard, "live-queries.ts");
    expect(existsSync(declarations), `${name} must declare its dashboard query dependencies`).toBe(
      true,
    );
    const { QUERY_DEPENDENCIES } = (await import(pathToFileURL(declarations).href)) as {
      QUERY_DEPENDENCIES: Record<string, readonly string[]>;
    };
    groups.push({ source: name, queries: QUERY_DEPENDENCIES });
  }
  const unknown = groups.flatMap(({ source, queries }) =>
    Object.entries(queries).flatMap(([query, types]) =>
      types.filter((type) => !allowed.has(type)).map((type) => `${source}:${query}:${type}`),
    ),
  );
  expect(unknown).toEqual([]);
});

it.each([
  ["refuses a one-line list", 'x({ dependencies: [{ type: "x" }] })', [1]],
  [
    "refuses a list whose first element is on the next line",
    'x({\n  dependencies: [\n    { type: "x" },\n  ],\n})',
    [2],
  ],
  ["allows an empty list", "x({ dependencies: [] })", []],
  ["allows an empty list with a space", "x({ dependencies: [ ] })", []],
  ["allows an empty list across lines", "x({ dependencies: [\n] })", []],
  [
    "allows a list built from declarations",
    "x({ dependencies: QUERY_DEPENDENCIES.x.map((type) => ({ type })) })",
    [],
  ],
  [
    "reports the line of a later match",
    'a;\nb;\nc({ dependencies: [] });\nd({ dependencies: [{ type: "x" }] });',
    [4],
  ],
])("inline dependency matcher %s", (_label, text, lines) => {
  expect(inlineDependencyLines(text)).toEqual(lines);
});

// Reads text: an unquoted non-empty `dependencies: [` is refused even in a comment or string; a
// quoted key or a list passed by variable escapes. `[]` never refreshes on a resource change.
it("no shipped dashboard source subscribes through an inline dependency list", () => {
  const root = join(import.meta.dirname, "..");
  const trees = [
    "apps/dashboard/src",
    "packages/dashboard-kit/src",
    "packages/dashboard-modules/src",
    ...readdirSync(join(root, "packages"))
      .map((name) => `packages/${name}/src/dashboard`)
      .filter((dir) => existsSync(join(root, dir))),
  ];
  const files = trees
    .flatMap((dir) => sourceFilesIn(root, dir))
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !/\.test\.[cm]?[jt]sx?$/.test(path));
  expect(files.length).toBeGreaterThan(0);
  const inline = files.flatMap((path) =>
    inlineDependencyLines(readFileSync(join(root, path), "utf8")).map((line) => `${path}:${line}`),
  );
  expect(inline).toEqual([]);
});

it("keeps the daily report's live interests admitted when payments is off", () => {
  const modules = enabledModules(
    ALL_MODULES,
    parseModuleConfig({ modules: { payments: false } }, ALL_MODULES),
  );
  const allowed = new Set(liveResourceTypesForModules(modules));
  expect(QUERY_DEPENDENCIES.getDailyClose.filter((type) => !allowed.has(type))).toEqual([]);
});
