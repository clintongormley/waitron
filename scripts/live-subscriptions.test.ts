// The root gate checks every UI module even when package-scoped CI would omit its server owner.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { enabledModules, parseModuleConfig } from "../packages/module/src/index.js";
import { QUERY_DEPENDENCIES } from "../apps/dashboard/src/api/live-queries.js";
import { liveResourceTypesForModules } from "../apps/server/src/live-resources.js";
import { TILL_LIVE_TYPES } from "../apps/till/src/api/live-connection.js";

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

it("keeps the daily report's live interests admitted when payments is off", () => {
  const modules = enabledModules(
    ALL_MODULES,
    parseModuleConfig({ modules: { payments: false } }, ALL_MODULES),
  );
  const allowed = new Set(liveResourceTypesForModules(modules));
  expect(QUERY_DEPENDENCIES.getDailyClose.filter((type) => !allowed.has(type))).toEqual([]);
});
