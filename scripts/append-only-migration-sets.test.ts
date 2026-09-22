import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";
import { appendOnlyTablesIn } from "../packages/sync-enrolment/src/classification.js";

/**
 * A module that declares a table `appendOnly()` also carries that table in its OWN migration
 * descriptor — the `<PKG>_MIGRATIONS` constant a suite hands to `useVenueDb`.
 *
 * There are two ways a set reaches a database and they read the list from different objects. The
 * product composes its sets through `orderedMigrationSets(ALL_MODULES)`, which derives
 * `appendOnlyTables` from the descriptor's `classification`; a SUITE hands over the package's own
 * exported constant instead, one per package, and `useVenueDb` installs from that
 * (`packages/db/src/testing/venue-db.ts`). A package that declares a new append-only table and does
 * not carry it into its constant gets test databases where a ledger row can be rewritten while the
 * box refuses it — CLAUDE.md §5, the one area where a wrong value cannot be corrected afterwards.
 * Nothing else notices: the tests go green.
 *
 * It compares the two derivations by RUNNING them — importing both objects and reading the arrays —
 * rather than reading either file as text, so a list built some other way is still compared.
 *
 * WHY A TREE-WIDE ROOT-PROJECT PROGRAM. The declarations are assembled in `@waitron/composition`
 * and the constants are exported one per domain package; no package suite can see both sides. Like
 * everything under `scripts/`, it is NOT typechecked, so it stays plain.
 *
 * WHAT IT DOES NOT COVER. It says nothing about whether the triggers are installed — that is
 * `scripts/append-only-triggers.test.ts` (the product's own migrate path) and the three
 * `a migrated set's append-only tables` cases in `packages/db/src/testing/venue-db.test.ts` (the
 * suite helper's). And a module with no `src/migrations.ts` at all is out of scope here: it has no
 * constant for a suite to hand over, so there is nothing to compare.
 */

/**
 * Every `packages/*\u002fsrc/migrations.ts` in the tree, as lazy importers keyed by path.
 *
 * `import.meta.glob` rather than a computed `import()`, which Vite refuses outright
 * (`Unknown variable dynamic import` — measured here), and rather than a hand-written list, which
 * would go stale the day a package is added.
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
  // The anchor: a discovery that silently found nothing would leave every case below skipped, and a
  // suite of zero cases passes. This names the property rather than a count, which goes stale.
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
