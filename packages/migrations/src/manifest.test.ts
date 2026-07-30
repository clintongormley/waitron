import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureError, CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "@waitron/scheduler";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "./manifest.js";

describe("the migration manifest", () => {
  it("names the same journal tables the packages themselves declare", () => {
    // The manifest exists because every *_MIGRATIONS descriptor computes migrationsFolder from its
    // OWN import.meta.url, which collapses onto the bundle's directory under esbuild. Taking the
    // FOLDER from the manifest means the TABLE could silently drift from the package's; this is the
    // assertion that stops it, and a rename fails here rather than by re-running old migrations
    // against a journal nobody reads.
    const byName = Object.fromEntries(manifestSets().map((set) => [set.name, set.table]));
    expect(byName).toEqual({
      core: CORE_MIGRATIONS.migrationsTable,
      fiscal: FISCAL_MIGRATIONS.migrationsTable,
      payments: PAYMENTS_MIGRATIONS.migrationsTable,
      scheduler: SCHEDULER_MIGRATIONS.migrationsTable,
      credentials: CREDENTIALS_MIGRATIONS.migrationsTable,
    });
  });

  it("puts core first, because every other set has a tenants foreign key", () => {
    expect(manifestSets()[0]?.name).toBe("core");
  });

  it("resolves each source folder to a real Drizzle journal when run from source", () => {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      expect(existsSync(join(options.migrationsFolder, "meta", "_journal.json"))).toBe(true);
    }
  });

  it("resolves under a bundle root by name", () => {
    // A real fixture, not the illustrative "/opt/waitron/drizzle" apps/server/src/config.test.ts
    // uses for ROOT: that path is never touched on disk there (loadConfig only plumbs the string
    // through), but migrationOptionsFor's journal check runs in the root branch too — so a
    // bundle-root test needs a folder that actually exists, or it fails on migrations.set_missing
    // rather than on the assertion it's meant to check.
    const root = mkdtempSync(join(tmpdir(), "waitron-migrations-"));
    try {
      mkdirSync(join(root, "core", "meta"), { recursive: true });
      writeFileSync(join(root, "core", "meta", "_journal.json"), "{}");
      const options = migrationOptionsFor(
        [{ name: "core", table: "t", from: "../../packages/db/drizzle" }],
        root,
      );
      expect(options[0]?.migrationsFolder).toBe(join(root, "core"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a relative root against this package, not the process's cwd", async () => {
    // WAITRON_MIGRATIONS_DIR is operator-supplied and could be relative. The from-source branch
    // resolves `from` against this package's own directory (resolve(here, "..", ...)); this proves
    // the root branch uses the identical base for a RELATIVE root, not process.cwd() — which would
    // resolve differently depending on where the process happens to be launched from. There is no
    // real folder at the computed path, so this reaches the same throw as the tests below; the
    // assertion is on the resolved `folder`, not on success.
    const error = await captureError(() =>
      Promise.resolve(
        migrationOptionsFor([{ name: "core", table: "t", from: "x" }], "relative-migrations-root"),
      ),
    );
    expect(isAppError(error) && error.code).toBe("migrations.set_missing");
    expect(isAppError(error) && error.params).toMatchObject({
      name: "core",
      folder: join(import.meta.dirname, "..", "relative-migrations-root", "core"),
    });
  });

  it("refuses a root whose folder is absent, rather than silently migrating nothing", async () => {
    // The ABSENT case: nothing exists at this path at all, not even the parent directory. Drizzle's
    // own migrator already rejects this on its own — see the next test for the case that requires
    // THIS function's own check.
    const error = await captureError(() =>
      Promise.resolve(
        migrationOptionsFor([{ name: "core", table: "t", from: "x" }], "/nonexistent-root"),
      ),
    );
    expect(isAppError(error) && error.code).toBe("migrations.set_missing");
    expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
  });

  it("refuses a folder that exists but carries no journal, not just an absent one", async () => {
    // The EMPTY case, and the reason this function's check exists at all: Drizzle's migrator treats
    // an empty folder as "zero migrations" and boots clean against an unmigrated database, failing
    // later and somewhere else. A test that only reaches the absent case above would still pass even
    // if this function's own existsSync check were deleted entirely, since Drizzle would reject that
    // case on its own — this one creates the folder for real, empty, and proves the check still
    // fires when Drizzle alone would not have complained yet.
    const root = mkdtempSync(join(tmpdir(), "waitron-migrations-empty-"));
    try {
      mkdirSync(join(root, "core"), { recursive: true });
      const error = await captureError(() =>
        Promise.resolve(migrationOptionsFor([{ name: "core", table: "t", from: "x" }], root)),
      );
      expect(isAppError(error) && error.code).toBe("migrations.set_missing");
      expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
