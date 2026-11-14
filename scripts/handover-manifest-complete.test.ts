import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { NODE_LOCAL_MANIFEST } from "../packages/handover/src/manifest.js";
import { NODE_CLASSIFICATION } from "../packages/node-db/src/classification.js";
import { OPTIONAL_BACKUP_STATE } from "../apps/server/src/backup-optional-state.js";
import { RECOVERY_FILES } from "../apps/server/src/state-secrets.js";

/**
 * A box's own state that the handover manifest does not name is state nobody decided about: M2
 * would silently keep, drop or inherit it. Reads its lists from their sources, so a new `node.db`
 * or `local` table, or a new name in `RECOVERY_FILES` or `OPTIONAL_BACKUP_STATE`, fails here until
 * the manifest has a row for it, and a module backup source of a kind this guard does not map
 * fails until the guard maps it. A state-folder file outside those lists is not seen.
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

describe("the handover manifest names every piece of a box's own state", () => {
  it("names every node.db table and every venue.db table classified local", () => {
    const nodeTables = NODE_CLASSIFICATION.map((c) => c.table);
    const venueLocal: string[] = [];
    const nodeLocal: string[] = [];
    for (const module of ALL_MODULES) {
      const tables = (module.classification ?? [])
        .filter((c) => c.class === "local")
        .map((c) => c.table);
      if (module.migrations?.database === "node") nodeLocal.push(...tables);
      else venueLocal.push(...tables);
    }
    // A floor, so a discovery that silently read nothing cannot pass.
    expect(nodeTables.length).toBeGreaterThan(0);
    expect(venueLocal.length).toBeGreaterThan(0);
    expect(missing([...new Set([...nodeTables, ...nodeLocal])], "node.db")).toEqual([]);
    expect(missing(venueLocal, "venue.db")).toEqual([]);
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
