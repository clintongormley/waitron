import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "./manifest.js";

describe("the migration manifest", () => {
  it("puts core first; media, which creates triggers on core's `products`, will not migrate without it", () => {
    expect(manifestSets()[0]?.name).toBe("core");
  });

  it("resolves each source folder to a real Drizzle journal when run from source", () => {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      expect(existsSync(join(options.migrationsFolder, "meta", "_journal.json"))).toBe(true);
    }
  });

  it("resolves under a bundle root by name", () => {
    // migrationOptionsFor's journal check runs in the root branch too, so a bundle-root test needs a
    // folder that actually exists, or it fails on migrations.set_missing rather than on the assertion.
    const root = mkdtempSync(join(tmpdir(), "waitron-migrations-"));
    try {
      mkdirSync(join(root, "core", "meta"), { recursive: true });
      writeFileSync(join(root, "core", "meta", "_journal.json"), "{}");
      const options = migrationOptionsFor(
        [{ name: "core", table: "t", from: "../../packages/db/drizzle", appendOnlyTables: [] }],
        root,
      );
      expect(options[0]?.migrationsFolder).toBe(join(root, "core"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a relative root against this package, not the process's cwd", async () => {
    // The root branch uses the from-source branch's base for a RELATIVE root, not process.cwd().
    // There is no real folder at the computed path, so the assertion is on the resolved `folder`.
    // "Against this package" holds FROM SOURCE only; in a bundle the base moves (see
    // `migrationOptionsFor`).
    const error = await captureError(() =>
      Promise.resolve(
        migrationOptionsFor(
          [{ name: "core", table: "t", from: "x", appendOnlyTables: [] }],
          "relative-migrations-root",
        ),
      ),
    );
    expect(isAppError(error) && error.code).toBe("migrations.set_missing");
    expect(isAppError(error) && error.params).toMatchObject({
      name: "core",
      folder: join(import.meta.dirname, "..", "relative-migrations-root", "core"),
    });
  });

  it("refuses a root whose folder is absent, rather than silently migrating nothing", async () => {
    // The ABSENT case: nothing exists at this path at all, not even the parent directory.
    const error = await captureError(() =>
      Promise.resolve(
        migrationOptionsFor(
          [{ name: "core", table: "t", from: "x", appendOnlyTables: [] }],
          "/nonexistent-root",
        ),
      ),
    );
    expect(isAppError(error) && error.code).toBe("migrations.set_missing");
    expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
  });

  it("refuses a folder that exists but carries no journal, not just an absent one", async () => {
    // The EMPTY case: the folder exists but holds no journal.
    const root = mkdtempSync(join(tmpdir(), "waitron-migrations-empty-"));
    try {
      mkdirSync(join(root, "core"), { recursive: true });
      const error = await captureError(() =>
        Promise.resolve(
          migrationOptionsFor(
            [{ name: "core", table: "t", from: "x", appendOnlyTables: [] }],
            root,
          ),
        ),
      );
      expect(isAppError(error) && error.code).toBe("migrations.set_missing");
      expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
