import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";
import { tablesCreatedBy } from "../packages/sync-enrolment/src/migration-tables.js";

/**
 * Every table a module's migrations CREATE is classified `ledger`/`state`/`local` (swap spec §2.1)
 * exactly once — tree-wide. The two publication table-lists derive from that classification, so a
 * table left unclassified silently vanishes from replication and a phantom classification points at
 * nothing; a table classified twice (within or across modules) is ambiguous. This is the net for all
 * three (the per-package tests and `modules.test.ts`'s dedup are earlier checkpoints).
 *
 * WHY A TREE-WIDE ROOT-PROJECT PROGRAM. The classification list is assembled in one package
 * (`@waitron/composition`) but the evidence — the `CREATE TABLE` statements — is spread across every
 * domain package's `drizzle/` directory, and "classified exactly once" is a property ACROSS modules
 * (two modules must not classify the same physical name). No per-package suite can see both sides, so
 * this sits in the root Vitest project beside `module-graph-honesty.test.ts` (see the repo-root
 * `vitest.config.ts`). It reads SQL as TEXT, never executing it, and — like everything under
 * `scripts/` — is NOT typechecked, so it stays plain and uses its cross-package imports for runtime
 * values only.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** From every descriptor's `migrations.from` (`../<pkg>/drizzle`), the package DIR → module NAME map,
 * through `@waitron/module`'s `packageDirOf`. A package is in scope only if a descriptor points at it
 * (the dir `fiscal-verifactu` maps to the module named `fiscal-verifactu`). */
function packageDirToModule(): Map<string, string> {
  return new Map(ALL_MODULES.map((module) => [packageDirOf(module), module.name]));
}

interface DrizzlePackage {
  moduleName: string;
  packageDir: string;
  /** Raw SQL of each `drizzle/*.sql` file; stripping happens at scan time. */
  sqls: string[];
}

function discoverDrizzlePackages(): DrizzlePackage[] {
  const discovered: DrizzlePackage[] = [];
  for (const [packageDir, moduleName] of packageDirToModule()) {
    const drizzleDir = join(PACKAGES_DIR, packageDir, "drizzle");
    let entries: string[];
    try {
      entries = readdirSync(drizzleDir);
    } catch {
      // A descriptor pointing at a package with no `drizzle/` dir: skip it. The anchor's module floor
      // catches a discovery that silently found too few packages.
      continue;
    }
    const sqls = entries
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"));
    discovered.push({ moduleName, packageDir, sqls });
  }
  return discovered;
}

/** Every table a module's migrations leave in existence (lowercased), by module name — CREATEs minus
 * later DROPs, in filename order. A module with a `drizzle/` dir but no `.sql` (e.g. `fiscal-none`)
 * contributes an empty set. */
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

/** The `{table, class}` a module DECLARES via its `classification` seat (`[]` when the seat is
 * omitted), by module name — read straight off the descriptor, not the SQL. */
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

  // Tree-wide views for the anchor and the "classified more than once" check.
  const allCreatedTables = new Set<string>();
  for (const tables of createdByModule.values()) for (const t of tables) allCreatedTables.add(t);

  // table -> the modules that classify it, and (via last write) its class. More than one module for a
  // name is a cross-module duplicate; the class map drives the anchor's per-class assertions.
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

    // (1) every created table is classified by its own module; (2) every classification names a table
    // that module actually creates.
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

    // (3) no table classified more than once, within OR across modules.
    for (const [table, owners] of classifiers) {
      if (owners.length > 1) {
        violations.push(
          `table "${table}" classified ${owners.length} times (by ${owners.join(", ")})`,
        );
      }
    }

    expect(violations.sort()).toEqual([]);
  });

  // Vacuous-pass anchor. An empty scan (discovery matched nothing, or the regex drifted out from under
  // the tree's SQL) would leave `violations` empty and pass — identical to a fully-classified tree. So
  // pin that the scan actually found the real tables, in each class, at a floor, across enough modules.
  it("discovers the known real tables in each class, at a floor, across the modules", () => {
    // A known table per class, resolved with the class the tree really assigns it.
    expect(classOfTable.get("sales")).toBe("ledger");
    expect(classOfTable.get("tenants")).toBe("state");
    expect(classOfTable.get("deployment")).toBe("local");
    // Those three are created tables, not phantoms.
    for (const t of ["sales", "tenants", "deployment"]) expect(allCreatedTables.has(t)).toBe(true);

    expect(allCreatedTables.size).toBeGreaterThanOrEqual(77);
    expect(discovered.length).toBeGreaterThanOrEqual(8);
  });

  // Drizzle's per-set bookkeeping table (`__drizzle_migrations_*`) is created at runtime by the
  // migrator, never by a `CREATE TABLE` in a `.sql` file, so it must never enter the created set — if
  // it did, the completeness check above would demand a classification for a table no module owns.
  it("does not pick up drizzle's bookkeeping table", () => {
    for (const table of allCreatedTables) {
      expect(table.startsWith("__drizzle_migrations")).toBe(false);
    }
  });
});
