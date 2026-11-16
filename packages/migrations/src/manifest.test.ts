import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
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

  it("carries the file a set names into its options", () => {
    const root = mkdtempSync(join(tmpdir(), "waitron-migrations-"));
    try {
      for (const name of ["node", "core"]) {
        mkdirSync(join(root, name, "meta"), { recursive: true });
        writeFileSync(join(root, name, "meta", "_journal.json"), "{}");
      }
      expect(
        migrationOptionsFor(
          [
            { name: "node", table: "n", from: "x", appendOnlyTables: [], database: "node" },
            { name: "core", table: "c", from: "y", appendOnlyTables: [] },
          ],
          root,
        ),
      ).toEqual([
        {
          migrationsFolder: join(root, "node"),
          migrationsTable: "n",
          appendOnlyTables: [],
          database: "node",
        },
        { migrationsFolder: join(root, "core"), migrationsTable: "c", appendOnlyTables: [] },
      ]);
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

describe("declared migration triggers", () => {
  const definition = `"fixed_value" BEFORE UPDATE ON "records" WHEN old.value <> new.value\nBEGIN SELECT raise(abort, 'fixed'); END`;
  const set = {
    name: "probe",
    table: "__drizzle_migrations_probe",
    from: "unused",
    appendOnlyTables: [],
    migrationTriggers: ["fixed_value"],
  };
  function rootFor(statement: string): string {
    const root = mkdtempSync(join(tmpdir(), "wt-trigger-source-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "probe", "meta"), { recursive: true });
    writeFileSync(
      join(root, "probe", "meta", "_journal.json"),
      JSON.stringify({ entries: [{ idx: 0, tag: "0000_probe", when: 1, breakpoints: true }] }),
    );
    writeFileSync(join(root, "probe", "0000_probe.sql"), statement);
    return root;
  }

  it("resolves a commented header and delimiter without changing the catalogue definition", () => {
    const root = rootFor(`-- generated trigger\n\ncReAtE TrIgGeR ${definition};\n`);
    expect(migrationOptionsFor([set], root)[0]?.expectedTriggers).toEqual([
      { name: "fixed_value", table: "records", definition },
    ]);
  });

  it.each([
    [
      "t",
      "create trigger t before update on records begin select 1; end;",
      "t before update on records begin select 1; end",
    ],
    [
      "fixed_value",
      "create trigger fixed_value before update on records begin select 1; end \n;",
      "fixed_value before update on records begin select 1; end",
    ],
  ])("resolves the matched name and final END for %s", (name, statement, definition) => {
    const options = migrationOptionsFor(
      [{ ...set, migrationTriggers: [name] }],
      rootFor(statement),
    );
    expect(options[0]?.expectedTriggers).toEqual([{ name, table: "records", definition }]);
  });

  it.each([
    "create table records (value text)",
    `CREATE TRIGGER ${definition};\n--> statement-breakpoint\nCREATE TRIGGER ${definition};`,
    `CREATE TEMP TRIGGER ${definition};`,
    `CREATE TRIGGER fixed_value AFTER UPDATE ON main.records BEGIN SELECT 1; END;`,
  ])("refuses a missing, duplicate or unsupported declared definition: %s", (statement) => {
    expect(() => migrationOptionsFor([set], rootFor(statement))).toThrow(
      expect.objectContaining({
        code: "migrations.trigger_definition_invalid",
        params: { set: "probe", trigger: "fixed_value" },
      }),
    );
  });

  it("carries independent trigger metadata from the manifest and resolves source and copied bundles alike", () => {
    const sets = manifestSets();
    const paymentSet = sets.find((entry) => entry.name === "payments")!;
    expect(paymentSet.migrationTriggers).toEqual(["payments_guard_update", "payments_no_delete"]);
    const source = migrationOptionsFor([paymentSet], null)[0]!;
    expect(source.expectedTriggers?.map(({ name, table }) => ({ name, table }))).toEqual([
      { name: "payments_guard_update", table: "payments" },
      { name: "payments_no_delete", table: "payments" },
    ]);
    const root = mkdtempSync(join(tmpdir(), "wt-trigger-bundle-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    cpSync(source.migrationsFolder, join(root, "payments"), { recursive: true });
    expect(migrationOptionsFor([paymentSet], root)[0]?.expectedTriggers).toEqual(
      source.expectedTriggers,
    );
    (paymentSet.migrationTriggers as string[]).pop();
    expect(
      manifestSets().find((entry) => entry.name === "payments")?.migrationTriggers,
    ).toHaveLength(2);
  });
});
