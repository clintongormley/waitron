import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";
import { tablesCreatedBy } from "../packages/sync-enrolment/src/migration-tables.js";
import { migrationSqlFiles } from "../packages/sync-enrolment/src/testing/migration-sets.js";

/**
 * Every table a module's migrations CREATE is classified `ledger`/`state`/`local` exactly once,
 * tree-wide: an unclassified table has no stated rule, a phantom classification points at nothing,
 * and a table classified twice, within or across modules, is ambiguous. Reads SQL as TEXT, never
 * executing it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

function packageDirToModule(): Map<string, string> {
  return new Map(ALL_MODULES.map((module) => [packageDirOf(module), module.name]));
}

interface DrizzlePackage {
  moduleName: string;
  packageDir: string;
  sqls: string[];
}

function discoverDrizzlePackages(): DrizzlePackage[] {
  const discovered: DrizzlePackage[] = [];
  for (const [packageDir, moduleName] of packageDirToModule()) {
    const set = join("packages", packageDir, "drizzle");
    // The anchor's module floor catches a discovery that silently found too few packages.
    if (!existsSync(join(REPO_ROOT, set))) continue;
    const sqls = migrationSqlFiles(REPO_ROOT, set).map((file) =>
      readFileSync(join(REPO_ROOT, file), "utf8"),
    );
    discovered.push({ moduleName, packageDir, sqls });
  }
  return discovered;
}

/** Every table a module's migrations leave in existence (lowercased), by module name — CREATEs minus
 * later DROPs, a RENAME counting as a drop of the old name and a create of the new. */
function createdTablesByModule(discovered: DrizzlePackage[]): Map<string, Set<string>> {
  const byModule = new Map<string, Set<string>>();
  for (const { moduleName, sqls } of discovered) {
    const existing = byModule.get(moduleName);
    const tables = tablesCreatedBy(sqls);
    if (existing !== undefined) for (const t of existing) tables.add(t);
    byModule.set(moduleName, tables);
  }
  return byModule;
}

function classifiedTablesByModule(): Map<string, { table: string; cls: string }[]> {
  const byModule = new Map<string, { table: string; cls: string }[]>();
  for (const module of ALL_MODULES) {
    byModule.set(
      module.name,
      (module.classification ?? []).map((c) => ({ table: c.table.toLowerCase(), cls: c.class })),
    );
  }
  return byModule;
}

describe("every table is classified exactly once", () => {
  const discovered = discoverDrizzlePackages();
  const createdByModule = createdTablesByModule(discovered);
  const classifiedByModule = classifiedTablesByModule();

  const allCreatedTables = new Set<string>();
  for (const tables of createdByModule.values()) for (const t of tables) allCreatedTables.add(t);

  // table -> the modules that classify it. More than one module for a name is a duplicate.
  const classifiers = new Map<string, string[]>();
  const classOfTable = new Map<string, string>();
  for (const [moduleName, entries] of classifiedByModule) {
    // A name repeated INSIDE one module's list is counted once per occurrence, so an in-module
    // duplicate surfaces as length > 1 too.
    for (const { table, cls } of entries) {
      const owners = classifiers.get(table) ?? [];
      owners.push(moduleName);
      classifiers.set(table, owners);
      classOfTable.set(table, cls);
    }
  }

  it("classifies every created table exactly once, and classifies nothing that is not created", () => {
    const violations: string[] = [];

    for (const [moduleName, created] of createdByModule) {
      const classifiedHere = new Set(
        (classifiedByModule.get(moduleName) ?? []).map((e) => e.table),
      );
      for (const table of created) {
        if (!classifiedHere.has(table)) {
          violations.push(`${moduleName}: created table "${table}" is not classified`);
        }
      }
      for (const table of classifiedHere) {
        if (!created.has(table)) {
          violations.push(
            `${moduleName}: classifies "${table}" but no migration creates it in this module`,
          );
        }
      }
    }

    for (const [table, owners] of classifiers) {
      if (owners.length > 1) {
        violations.push(
          `table "${table}" classified ${owners.length} times (by ${owners.join(", ")})`,
        );
      }
    }

    expect(violations.sort()).toEqual([]);
  });

  // An empty scan would leave `violations` empty and pass, identical to a fully-classified tree.
  it("discovers the known real tables in each class, at a floor, across the modules", () => {
    expect(classOfTable.get("sales")).toBe("ledger");
    expect(classOfTable.get("tenants")).toBe("state");
    expect(classOfTable.get("mirror_config")).toBe("local");
    for (const t of ["sales", "tenants", "mirror_config"])
      expect(allCreatedTables.has(t)).toBe(true);

    expect(allCreatedTables.size).toBeGreaterThanOrEqual(77);
    expect(discovered.length).toBeGreaterThanOrEqual(8);
  });

  // Drizzle's per-set bookkeeping table is created at runtime by the migrator, never by a `.sql`
  // file, so if it entered the created set the check above would demand a classification for it.
  it("does not pick up drizzle's bookkeeping table", () => {
    for (const table of allCreatedTables) {
      expect(table.startsWith("__drizzle_migrations")).toBe(false);
    }
  });
});
