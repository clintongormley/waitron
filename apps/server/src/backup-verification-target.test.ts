import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { expectedSchemaVersion } from "@waitron/migrations";
import {
  BackupVerificationUnsupported,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import { readBackupVerificationRequest } from "./backup-verification-protocol.js";
import * as targetExports from "./backup-verification-target.js";

const runtime = { release: "2026.10.20", revision: "e".repeat(40), fingerprint: "f".repeat(64) };
function policy(): BackupVerificationContribution {
  return {
    version: 1,
    publicEvidenceDigest: null,
    data: {
      kind: "custom",
      tables: ["items", "history"],
      immutableTables: ["history"],
      checks: ["data", "immutable"],
    },
    secrets: ["vault"],
    entries: [{ name: "secrets/key.env", presence: "required" }],
    effects: [{ id: "activation", kind: "activation", check: null }],
    zeroSchema: "absent_tables_and_entries",
    targetOnly: "empty_after_migration",
    verifyRestoredData: async () => ({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "immutable", status: "passed" },
      ],
    }),
  };
}
function module(name = "core"): WaitronModule {
  return {
    name,
    version: "1.0.0",
    tier: "mandatory",
    migrations: { name, table: "__drizzle_migrations_" + name, from: "../db/drizzle" },
    backup: { verification: policy() },
  };
}
let root: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a850-target-"));
  for (const name of ["core", "extra"]) {
    mkdirSync(join(root, name, "meta"), { recursive: true });
    writeFileSync(
      join(root, name, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [{ idx: 0, version: "6", when: 1, tag: "0000_first", breakpoints: true }],
      }),
    );
    writeFileSync(join(root, name, "0000_first.sql"), "create table items (id text);\n");
  }
});
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
function target(modules: readonly WaitronModule[] = [module()]) {
  return buildBackupVerificationTarget({ modules, migrationsRoot: root!, runtime });
}
function unsupported(body: () => unknown) {
  expect(body).toThrow(BackupVerificationUnsupported);
  expect(body).toThrow(expect.objectContaining({ reason: "target_incompatible" }));
}

describe("bound backup target", () => {
  it("uses actual SQL and journal bytes, package version, dependency ranges and declared policy", () => {
    const original = target();
    expect(original).toMatchObject({
      compositionDigest: "694fbaee601fcfeeb736d7045bd456a75b2ef7e56e414c4d0d6c5e28f68d5ade",
      migrationDigest: "c4eb6977058216c400373f80ab163e725fabddb542452f2de68f44651c3d3d04",
      policyDigest: "8467c1fc60d3be8711d05cf0b0ff9581421552de55da5ef2836a743fad74c824",
      digest: "d7b541f9e7089ca95ca6a2abe529b118016493c1d262fbe393b00f8d8bc66fb8",
    });
    expect(original.modules[0]).toMatchObject({
      name: "core",
      packageVersion: "1.0.0",
      schema: 1,
      migrationTable: "__drizzle_migrations_core",
      requires: {},
      semanticsVersion: 1,
    });
    const folder = join(root!, "core");
    writeFileSync(join(folder, "0000_first.sql"), "create table items (id text, value text);\n");
    const changedSql = target();
    expect(changedSql.migrationDigest).not.toBe(original.migrationDigest);
    expect(changedSql.digest).not.toBe(original.digest);
    expect(changedSql.policyDigest).toBe(original.policyDigest);
    expect(changedSql.compositionDigest).toBe(original.compositionDigest);
    const journal = readFileSync(join(folder, "meta/_journal.json"), "utf8");
    writeFileSync(join(folder, "meta/_journal.json"), journal + "\n");
    expect(target().migrationDigest).not.toBe(changedSql.migrationDigest);
    writeFileSync(join(folder, "extra.sql"), "select 1;");
    const extraSql = target();
    expect(extraSql.migrationDigest).not.toBe(changedSql.migrationDigest);
    const changedPackage = target([{ ...module(), version: "1.0.1" }]);
    expect(changedPackage.compositionDigest).not.toBe(extraSql.compositionDigest);
    expect(changedPackage.policyDigest).toBe(extraSql.policyDigest);
    expect(Object.isFrozen(original.modules[0]!.requires)).toBe(true);
  });
  it("sorts descriptors, dependencies and set-like policies without changing identity", () => {
    const core = module(),
      extra = { ...module("extra"), requires: { core: "^1.0.0" } };
    const original = target([core, extra]);
    const base = policy();
    const p = {
      ...base,
      data: {
        ...base.data,
        tables: [...base.data.tables].reverse(),
        checks: [...base.data.checks].reverse(),
      },
    };
    expect(target([extra, { ...core, backup: { verification: p } }])).toEqual(original);
    const changed = target([core, { ...extra, requires: { core: "~1.0.0" } }]);
    expect(changed.compositionDigest).not.toBe(original.compositionDigest);
  });
  it.each([
    [
      "public trust",
      (p: BackupVerificationContribution) => ({ ...p, publicEvidenceDigest: "a".repeat(64) }),
    ],
    [
      "kind",
      (p: BackupVerificationContribution) => ({
        ...p,
        data: { ...p.data, kind: "database_only" as const },
      }),
    ],
    [
      "tables",
      (p: BackupVerificationContribution) => ({
        ...p,
        data: { ...p.data, tables: [...p.data.tables, "more"] },
      }),
    ],
    [
      "immutable tables",
      (p: BackupVerificationContribution) => ({
        ...p,
        data: { ...p.data, immutableTables: [...p.data.immutableTables, "items"] },
      }),
    ],
    [
      "checks",
      (p: BackupVerificationContribution) => ({
        ...p,
        data: { ...p.data, checks: [...p.data.checks, "history" as const] },
      }),
    ],
    ["secrets", (p: BackupVerificationContribution) => ({ ...p, secrets: [...p.secrets, "totp"] })],
    [
      "entry",
      (p: BackupVerificationContribution) => ({
        ...p,
        entries: [{ name: "secrets/key.env", presence: "optional" as const }],
      }),
    ],
    [
      "effect",
      (p: BackupVerificationContribution) => ({
        ...p,
        effects: [
          ...p.effects,
          { id: "data-effect", kind: "data" as const, check: "data" as const },
        ],
      }),
    ],
    [
      "zero schema",
      (p: BackupVerificationContribution) => ({ ...p, zeroSchema: "empty_schema" as const }),
    ],
    [
      "target only",
      (p: BackupVerificationContribution) => ({ ...p, targetOnly: "unsupported" as const }),
    ],
  ])("binds policy %s", (_, mutate) => {
    const original = target();
    const changed = target([{ ...module(), backup: { verification: mutate(policy()) } }]);
    expect(changed.policyDigest).not.toBe(original.policyDigest);
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.compositionDigest).toBe(original.compositionDigest);
    expect(changed.migrationDigest).toBe(original.migrationDigest);
  });
  it.each(["release", "revision", "fingerprint"] as const)("binds runtime %s", (key) => {
    const original = target();
    const changed = buildBackupVerificationTarget({
      modules: [module()],
      migrationsRoot: root!,
      runtime: {
        ...runtime,
        [key]: key === "release" ? "other" : "a".repeat(key === "revision" ? 40 : 64),
      },
    });
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.policyDigest).toBe(original.policyDigest);
  });
  it("hashes every supplied real owner's shipped assets from source", () => {
    const modules = ALL_MODULES.map((m) => ({
      ...m,
      backup: { ...m.backup, verification: policy() },
    }));
    const actual = buildBackupVerificationTarget({ modules, migrationsRoot: null, runtime });
    expect(actual.modules.map((m) => m.name)).toEqual(ALL_MODULES.map((m) => m.name).sort());
    for (const m of modules) {
      expect(actual.modules.find((x) => x.name === m.name)!.schema).toBe(
        expectedSchemaVersion(m.migrations, null),
      );
    }
  });
  it.each(["revision", "fingerprint", "release"] as const)(
    "refuses absent or mutable provenance %s",
    (key) => {
      unsupported(() =>
        buildBackupVerificationTarget({
          modules: [module()],
          migrationsRoot: root!,
          runtime: { ...runtime, [key]: "" },
        }),
      );
    },
  );
  it("refuses migration-set identity mismatch and unsafe journal tags", () => {
    unsupported(() =>
      target([{ ...module(), migrations: { ...module().migrations, name: "extra" } }]),
    );
    writeFileSync(
      join(root!, "core/meta/_journal.json"),
      JSON.stringify({ entries: [{ idx: 0, tag: "../private" }] }),
    );
    unsupported(() => target());
  });
  it("refuses missing journal/SQL rather than fingerprinting incomplete assets", () => {
    rmSync(join(root!, "core/0000_first.sql"));
    unsupported(() => target());
    rmSync(join(root!, "core/meta/_journal.json"));
    unsupported(() => target());
  });
  it("refuses a target with a substituted descriptor digest", () => {
    const original = target();
    const actual = {
      ...original,
      modules: [{ ...original.modules[0]!, packageVersion: "99.0.0" }],
    };
    const input = {
      protocol: "backup-data-restore/v1",
      captureId: "c",
      pointId: "c",
      venueId: "v",
      sourceInstallationId: "i",
      sourceNodeId: "n",
      capturedAt: "2026-10-20T08:00:00.000Z",
      archive: {
        sha256: "a".repeat(64),
        bytes: 1,
        manifestVersion: 1,
        environment: "preproduction",
        modules: { core: 1 },
      },
      backupKey: { version: 1, reference: "k" },
      target: actual,
      verifierImage: "waitron@sha256:" + "a".repeat(64),
      attempt: {
        jobId: "j",
        number: 1,
        claimId: "c",
        controllerScope: "s",
        childToken: "t",
        deadline: "2026-10-20T08:00:30.000Z",
      },
    };
    expect(() => readBackupVerificationRequest(JSON.stringify(input))).toThrow(
      "Invalid backup verification protocol",
    );
  });
});

describe("target asset admission", () => {
  it.each([
    "{",
    "null",
    "[]",
    '{"entries":null}',
    '{"entries":[null]}',
    '{"entries":[{"idx":1,"tag":"0000_first"}]}',
    '{"entries":[{"idx":0,"tag":"0000_first"},{"idx":1,"tag":"0000_first"}]}',
  ])("refuses malformed or ambiguous journal %s", (raw) => {
    writeFileSync(join(root!, "core/meta/_journal.json"), raw);
    unsupported(() => target());
  });
});

describe("target declaration and asset boundaries", () => {
  it("does not follow symlinked SQL or journals", () => {
    const sql = join(root!, "core/0000_first.sql");
    rmSync(sql);
    symlinkSync(join(root!, "extra/0000_first.sql"), sql);
    unsupported(() => target());
    rmSync(sql);
    writeFileSync(sql, "select 1;");
    const journal = join(root!, "core/meta/_journal.json");
    rmSync(journal);
    symlinkSync(join(root!, "extra/meta/_journal.json"), journal);
    unsupported(() => target());
  });
  it("refuses a directory in place of a migration journal", () => {
    rmSync(join(root!, "core/meta/_journal.json"));
    mkdirSync(join(root!, "core/meta/_journal.json"));
    unsupported(() => target());
  });
  it("does not collapse two conflicting core dependency ranges", () => {
    unsupported(() =>
      target([
        module(),
        { ...module("extra"), requires: { core: "*", modules: { core: "^1.0.0" } } },
      ]),
    );
    expect(
      target([module(), { ...module("extra"), requires: { core: "*", modules: { core: "*" } } }])
        .modules[1]!.requires,
    ).toEqual({ core: "*" });
  });
  it("binds nested extra SQL bytes and sorts multiple entry and effect declarations", () => {
    const base = policy();
    const entries = [
      { name: "z/key.env", presence: "optional" as const },
      { name: "a/key.env", presence: "required" as const },
    ];
    const effects = [
      { id: "z", kind: "data" as const, check: "data" as const },
      { id: "a", kind: "activation" as const, check: null },
    ];
    const original = target([
      { ...module(), backup: { verification: { ...base, entries, effects } } },
    ]);
    expect(
      target([
        {
          ...module(),
          backup: {
            verification: {
              ...base,
              entries: [...entries].reverse(),
              effects: [...effects].reverse(),
            },
          },
        },
      ]),
    ).toEqual(original);
    mkdirSync(join(root!, "core/extra"));
    writeFileSync(join(root!, "core/extra/other.sql"), "select 1;");
    expect(target().migrationDigest).not.toBe(original.migrationDigest);
  });
});

it("preserves legitimate semver ranges containing spaces in the bound target", () => {
  const actual = target([module(), { ...module("extra"), requires: { core: ">=1.0.0 <2.0.0" } }]);
  expect(actual.modules[1]!.requires).toEqual({ core: ">=1.0.0 <2.0.0" });
  const other = target([module(), { ...module("extra"), requires: { core: "^1.0.0" } }]);
  expect(actual.compositionDigest).not.toBe(other.compositionDigest);
});

describe("current binary backup target", () => {
  it("uses the embedded source stamp with actual installed modules and migrations", () => {
    vi.stubGlobal("__WAITRON_BACKUP_VERIFICATION_RUNTIME__", runtime);
    try {
      const current = targetExports.currentBackupVerificationTarget();
      expect(current.runtime).toEqual(runtime);
      expect(current.modules.map((m) => m.name)).toEqual(ALL_MODULES.map((m) => m.name).sort());
      expect(current.modules.find((m) => m.name === "core")!.schema).toBe(
        expectedSchemaVersion(ALL_MODULES.find((m) => m.name === "core")!.migrations, null),
      );
      expect(Object.isFrozen(current)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses an explicitly unstamped development build", () => {
    vi.stubGlobal("__WAITRON_BACKUP_VERIFICATION_RUNTIME__", null);
    try {
      unsupported(() => targetExports.currentBackupVerificationTarget());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses absent embedded provenance even with ambient build claims", () => {
    vi.stubEnv("WAITRON_BUILD_ID", "a".repeat(40));
    try {
      unsupported(() => targetExports.currentBackupVerificationTarget());
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
