import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A package whose tables moved into another package's migration set keeps no `drizzle/` folder and
 * no schema source. A branch cut before the move can still add a migration to the retired folder or
 * a table file to its `src/schema/`: both rebase cleanly, and neither creates a table, because
 * nothing reads them any more. Which packages hold a set is read from the migrations manifest.
 */

const REPO = join(import.meta.dirname, "..");
const MANIFEST = join(REPO, "packages", "migrations", "migrations.manifest.json");

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** The package directory names under `packages/` that hold a migration set. */
function packagesWithSets(manifestPath: string): Set<string> {
  const sets = JSON.parse(readFileSync(manifestPath, "utf8")) as { name: string; from: string }[];
  return new Set(sets.map((set) => basename(dirname(resolve(dirname(manifestPath), set.from)))));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return statSync(full).isFile() ? [full] : [];
  });
}

/** Every file that brings schema into a package with no set, as a path relative to `root`. */
function offenders(root: string, withSets: ReadonlySet<string>): string[] {
  const packagesDir = join(root, "packages");
  const found: string[] = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const packageDir = join(packagesDir, name);
    if (withSets.has(name) || !statSync(packageDir).isDirectory()) continue;
    const drizzle = join(packageDir, "drizzle");
    if (existsSync(drizzle)) {
      const files = filesUnder(drizzle);
      found.push(...(files.length > 0 ? files : [drizzle]).map((path) => relative(root, path)));
    }
    const schema = join(packageDir, "src", "schema");
    if (existsSync(schema)) {
      for (const file of filesUnder(schema)) {
        if (!TEST_FILE.test(basename(file))) found.push(relative(root, file));
      }
    }
  }
  return found.sort();
}

describe("a package with no migration set brings no schema", () => {
  const withSets = packagesWithSets(MANIFEST);

  it("reads every set's package from the manifest, and scans packages beyond them", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as unknown[];
    expect(withSets.size).toBe(manifest.length);
    for (const name of withSets) {
      expect(existsSync(join(REPO, "packages", name, "drizzle")), name).toBe(true);
    }
    const scanned = readdirSync(join(REPO, "packages")).filter((name) => !withSets.has(name));
    expect(scanned).toContain("adjustments");
    expect(scanned).toContain("staffing");
  });

  it("finds no drizzle folder and no schema source in today's tree", () => {
    expect(offenders(REPO, withSets)).toEqual([]);
  });

  describe("on a scratch tree", () => {
    const root = mkdtempSync(join(tmpdir(), "retired-schema-folders-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const write = (path: string, text = ""): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write(
      "packages/migrations/migrations.manifest.json",
      JSON.stringify([{ name: "core", from: "../db/drizzle" }]),
    );
    write("packages/db/drizzle/0000_baseline.sql");
    write("packages/db/src/schema/tables.ts");
    write("packages/retired/src/schema/kept.test.ts");
    write("packages/retired/src/schema/nested/kept.db.test.ts");
    const scratchSets = packagesWithSets(
      join(root, "packages/migrations/migrations.manifest.json"),
    );

    it("accepts a set's own schema and a retired package's tests", () => {
      expect(offenders(root, scratchSets)).toEqual([]);
    });

    it("names a retired package's schema file and each file in its drizzle folder", () => {
      write("packages/retired/src/schema/nested/table.ts");
      write("packages/retired/drizzle/0009_new.sql");
      write("packages/other/drizzle/meta/_journal.json");
      expect(offenders(root, scratchSets)).toEqual([
        "packages/other/drizzle/meta/_journal.json",
        "packages/retired/drizzle/0009_new.sql",
        "packages/retired/src/schema/nested/table.ts",
      ]);
    });
  });
});
