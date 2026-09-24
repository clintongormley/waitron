import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";
import { appendOnlyTablesIn } from "../packages/sync-enrolment/src/classification.js";

/**
 * A module that declares a table `appendOnly()` also carries it in its own migration descriptor.
 * The product derives `appendOnlyTables` from the module's `classification`
 * (`orderedMigrationSets`), but a suite hands `useVenueDb` the package's exported constant, so a
 * table missing from the constant gives test databases where the row can be rewritten and the box
 * refuses it.
 *
 * Not covered: whether the triggers are installed (`scripts/append-only-triggers.test.ts`), and a
 * module with no `src/migrations.ts`, which has no constant to compare.
 */

/**
 * `import.meta.glob` because Vite refuses a computed `import()`, and a hand-written list would go
 * stale when a package is added.
 */
const MIGRATION_MODULES: Record<string, () => Promise<Record<string, unknown>>> = import.meta.glob(
  "../packages/*/src/migrations.ts",
);

/** The `{ migrationsFolder, migrationsTable, appendOnlyTables }` objects a package exports.
 * Discovered by SHAPE rather than by name, so a package naming its constant something new is still
 * compared. Empty when the package exports no such module at all. */
async function migrationDescriptors(packageDir: string): Promise<Record<string, unknown>[]> {
  const load = MIGRATION_MODULES[`../packages/${packageDir}/src/migrations.ts`];
  if (load === undefined) return [];
  const loaded = await load();
  return Object.values(loaded).filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && "migrationsFolder" in value,
  );
}

const modules = await Promise.all(
  ALL_MODULES.map(async (module) => {
    const packageDir = packageDirOf(module);
    return {
      name: module.name,
      packageDir,
      declared: appendOnlyTablesIn(module.classification ?? []),
      descriptors: await migrationDescriptors(packageDir),
    };
  }),
);

describe("every module that declares an append-only table", () => {
  // A discovery that found nothing would leave zero cases below, and zero cases pass.
  it("is found by the discovery, with at least one such module", () => {
    expect(
      modules
        .filter((module) => module.declared.length > 0)
        .map((module) => module.name)
        .sort(),
    ).not.toHaveLength(0);
  });

  for (const module of modules.filter((entry) => entry.declared.length > 0)) {
    it(`carries them in ${module.packageDir}'s own migration descriptor`, () => {
      expect(module.descriptors).toHaveLength(1);
      expect(module.descriptors[0]?.appendOnlyTables).toEqual(module.declared);
    });
  }

  // The other direction: a constant claiming a table its module never declared would install a
  // trigger the box does not have, which is the same divergence pointing the other way.
  for (const module of modules.filter((entry) => entry.declared.length === 0)) {
    it(`is absent from ${module.packageDir}'s own migration descriptor`, () => {
      for (const descriptor of module.descriptors) {
        expect(descriptor.appendOnlyTables ?? []).toEqual([]);
      }
    });
  }
});
