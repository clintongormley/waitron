import { describe, expect, it } from "vitest";
import {
  BackupVerificationUnsupported,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { backupVerificationInventory } from "./backup-verification.js";

function semantics(): BackupVerificationContribution {
  return {
    version: 1,
    publicEvidenceDigest: null,
    data: { kind: "custom", tables: [], immutableTables: [], checks: ["data"] },
    secrets: [],
    entries: [],
    effects: [],
    zeroSchema: "absent_tables_and_entries",
    targetOnly: "empty_after_migration",
    verifyRestoredData: async () => ({
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    }),
  };
}

function descriptor(name: string, extra: Partial<WaitronModule> = {}): WaitronModule {
  return {
    name,
    version: "1.0.0",
    tier: "toggleable",
    migrations: {
      name,
      table: `__migrations_${name.replaceAll("-", "_")}`,
      from: `../${name}/drizzle`,
    },
    backup: { verification: semantics() },
    ...extra,
  };
}

function unsupported(
  body: () => unknown,
  reason: "module_missing" | "semantics_missing" | "target_incompatible",
) {
  expect(body).toThrow(BackupVerificationUnsupported);
  expect(body).toThrow(expect.objectContaining({ reason }));
}

describe("backup verification inventory", () => {
  it.each(ALL_MODULES.map((module) => module.name))(
    "refuses each missing owner independently: %s",
    (name) => {
      const modules = ALL_MODULES.map((module) => ({
        ...module,
        backup: { ...module.backup, verification: semantics() },
      }));
      expect(backupVerificationInventory(modules).map((entry) => entry.module.name)).toEqual(
        ALL_MODULES.map((module) => module.name),
      );
      const missing = modules.map((module) =>
        module.name === name ? { ...module, backup: undefined } : module,
      );
      unsupported(() => backupVerificationInventory(missing), "semantics_missing");
    },
  );

  it("includes toggleable and schema-zero owners without selecting a fiscal slot", () => {
    const modules = [
      descriptor("core", { tier: "mandatory" }),
      descriptor("fiscal-verifactu", { requires: { core: "^1.0.0" } }),
      descriptor("fiscal-none"),
      descriptor("extra"),
    ];
    const inventory = backupVerificationInventory(modules);
    expect(inventory.map((entry) => entry.module.name)).toEqual([
      "core",
      "fiscal-verifactu",
      "fiscal-none",
      "extra",
    ]);
    expect(inventory[1]!.verification.zeroSchema).toBe("absent_tables_and_entries");
    expect(inventory[1]!.verification.data.tables).toEqual([]);
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory[1])).toBe(true);
    expect(inventory[1]!.module).toBe(modules[1]);
  });

  it("never substitutes fiscal-none for an absent fiscal declaration", () => {
    const modules = [
      descriptor("fiscal-verifactu", { backup: { restore: async () => ({ report: "restored" }) } }),
      descriptor("fiscal-none"),
    ];
    unsupported(() => backupVerificationInventory(modules), "semantics_missing");
  });

  it("requires semantics for a newly supplied descriptor", () => {
    unsupported(
      () =>
        backupVerificationInventory([
          descriptor("core"),
          descriptor("new-owner", { backup: undefined }),
        ]),
      "semantics_missing",
    );
    expect(
      backupVerificationInventory([descriptor("core"), descriptor("new-owner")]).map(
        (entry) => entry.module.name,
      ),
    ).toEqual(["core", "new-owner"]);
  });

  it("refuses an empty composition", () =>
    unsupported(() => backupVerificationInventory([]), "module_missing"));

  it.each(
    [
      [descriptor("core"), descriptor("core")],
      [descriptor("bad name")],
      [descriptor("core", { name: undefined as unknown as string })],
      [descriptor("dependent", { requires: { core: "*" } })],
      [descriptor("dependent", { requires: { modules: { missing: "*" } } })],
      [descriptor("core"), descriptor("dependent", { requires: { core: "^2.0.0" } })],
      [descriptor("core"), descriptor("dependent", { requires: { core: "not-a-range" } })],
      [
        descriptor("first", { requires: { modules: { second: "*" } } }),
        descriptor("second", { requires: { modules: { first: "*" } } }),
      ],
    ].map((modules) => ({ modules })),
  )("refuses duplicate names invalid names and dependency gaps: %j", ({ modules }) => {
    unsupported(() => backupVerificationInventory(modules), "target_incompatible");
  });

  it("checks supported semantics even with a correctly typed declaration", () => {
    const invalid = { ...semantics(), version: 2 } as unknown as BackupVerificationContribution;
    unsupported(
      () =>
        backupVerificationInventory([descriptor("core", { backup: { verification: invalid } })]),
      "semantics_missing",
    );
  });

  it("keeps unexpected descriptor exceptions distinct from unsupported dependencies", () => {
    const failure = new Error("unexpected descriptor access");
    const module = descriptor("core");
    Object.defineProperty(module, "requires", {
      get() {
        throw failure;
      },
    });
    expect(() => backupVerificationInventory([module])).toThrow(failure);
  });
});
