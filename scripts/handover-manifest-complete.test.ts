import { describe, expect, it } from "vitest";
import { modulesSettings } from "../packages/module/src/index.js";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { NODE_LOCAL_MANIFEST } from "../packages/handover/src/manifest.js";
import { STATE_LAYOUT, VENUE_LITESTREAM_DIR } from "../packages/store/src/state-layout.js";
import { NODE_CLASSIFICATION } from "../packages/node-db/src/classification.js";
import { OPTIONAL_BACKUP_STATE } from "../apps/server/src/backup-optional-state.js";
import { RECOVERY_FILES } from "../apps/server/src/state-secrets.js";

/**
 * Checks declared local tables and state entries in both directions. Tables and settings keys match exactly;
 * a file inside a declared folder is checked only to that folder. This does not inspect runtime
 * files, child names, resumption behavior or whether every writer declares its state entry.
 */

type Where = (typeof NODE_LOCAL_MANIFEST)[number]["where"];

/** A manifest item may be a template (`<module>`, `<source>`); filled, it must equal `name`. */
function named(name: string, where: Where, fill: Record<string, string> = {}): boolean {
  return NODE_LOCAL_MANIFEST.some(
    (row) =>
      row.where === where &&
      row.item.replace(/<([a-z]+)>/g, (whole, key: string) => fill[key] ?? whole) === name,
  );
}

function missing(names: readonly string[], where: Where): string[] {
  return names.filter((name) => !named(name, where));
}

const nodeTables = new Set(NODE_CLASSIFICATION.map((entry) => entry.table));
const venueTables = new Set<string>();
const settingsItems = new Set(
  [modulesSettings(ALL_MODULES), ...ALL_MODULES.flatMap((module) => module.settings ?? [])].map(
    (document) => `settings:${document.module}`,
  ),
);
for (const module of ALL_MODULES) {
  const target = module.migrations?.database === "node" ? nodeTables : venueTables;
  for (const entry of module.classification ?? [])
    if (entry.class === "local") target.add(entry.table);
}

function declaredState(item: string): boolean {
  return STATE_LAYOUT.some((entry) => {
    if (entry.kind === "folder") return item.startsWith(`${entry.name}/`);
    if (entry.kind === "prefix") return item.startsWith(entry.name);
    return item === entry.name;
  });
}

describe("the handover manifest names every piece of a box's own state", () => {
  it("names every node.db table and every venue.db table classified local, without stale tables", () => {
    expect(nodeTables.size).toBeGreaterThan(0);
    expect(venueTables.size).toBeGreaterThan(0);
    expect(missing([...nodeTables], "node.db")).toEqual([]);
    expect(missing([...venueTables], "venue.db")).toEqual([]);
    const stale = NODE_LOCAL_MANIFEST.filter((row) =>
      row.where === "node.db"
        ? !nodeTables.has(row.item)
        : row.where === "venue.db" &&
          !(row.item.startsWith("settings:")
            ? settingsItems.has(row.item)
            : venueTables.has(row.item)),
    );
    expect(stale).toEqual([]);
  });

  it("names every declared top-level state entry", () => {
    const items = STATE_LAYOUT.map(
      (entry) => entry.name + (entry.kind === "folder" ? "/" : entry.kind === "prefix" ? "*" : ""),
    );
    expect(missing(items, "state")).toEqual([]);
    expect(
      NODE_LOCAL_MANIFEST.filter((row) => row.where === "state" && !declaredState(row.item)),
    ).toEqual([]);
    expect(
      NODE_LOCAL_MANIFEST.filter(
        (row) => row.where === "venue-folder" && row.item !== `${VENUE_LITESTREAM_DIR}/`,
      ),
    ).toEqual([]);
  });

  it("names every recovery file and every optional backup state file", () => {
    expect(missing(RECOVERY_FILES, "state")).toEqual([]);
    expect(missing(OPTIONAL_BACKUP_STATE, "state")).toEqual([]);
  });

  it("names the state files behind every module's non-database backup source", () => {
    const unnamed: string[] = [];
    let sources = 0;
    for (const module of ALL_MODULES) {
      for (const source of module.backup?.nonDbState ?? []) {
        sources += 1;
        if (source.kind !== "preparation-history") {
          unnamed.push(
            `${module.name}:${source.source} → kind "${source.kind}" has no manifest mapping; decide where its files live and teach this guard`,
          );
          continue;
        }
        // A preparation-history source reads the module journal and the retained kept file
        // (`apps/server/src/backup-sources.ts`).
        const fill = { module: module.name, source: source.source };
        for (const file of [
          `module-records/${module.name}.json#prepared`,
          `module-records/${module.name}.json#retained`,
        ])
          if (!named(file, "state", fill))
            unnamed.push(`${module.name}:${source.source} → ${file}`);
      }
    }
    expect(sources).toBeGreaterThan(0);
    expect(unnamed).toEqual([]);
  });
});
