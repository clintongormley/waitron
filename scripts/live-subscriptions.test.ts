// The root gate checks every UI module even when package-scoped CI would omit its server owner.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { QUERY_DEPENDENCIES } from "../apps/dashboard/src/api/live-queries.js";
import { liveResourceTypes } from "../apps/server/src/live-resources.js";

it("every shipped dashboard query subscribes only to a declared server resource", async () => {
  const root = join(import.meta.dirname, "..");
  const allowed = new Set(liveResourceTypes(ALL_MODULES.flatMap((module) => module.changes ?? [])));
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
