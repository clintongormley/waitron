import { describe, expect, it } from "vitest";
import {
  BackupCheckUnavailable,
  BackupVerificationUnsupported,
  validateBackupModuleResult,
  validateBackupVerificationContribution,
} from "./backup-verification.js";

function declaration() {
  return {
    version: 1,
    publicEvidenceDigest: null,
    data: {
      kind: "custom",
      tables: ["records", "heads"],
      immutableTables: ["records"],
      checks: ["data", "chain"],
    },
    secrets: ["vault:example"],
    entries: [{ name: "secrets/example.json", presence: "optional" }],
    effects: [
      { id: "preserve-history", kind: "data", check: "chain" },
      { id: "activate", kind: "activation", check: null },
    ],
    zeroSchema: "absent_tables_and_entries",
    targetOnly: "unsupported",
    verifyRestoredData: async () => ({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "chain", status: "passed" },
      ],
    }),
  };
}

function unsupported(body: () => unknown) {
  expect(body).toThrow(BackupVerificationUnsupported);
  expect(body).toThrow(expect.objectContaining({ reason: "semantics_missing" }));
}

describe("backup verification declarations", () => {
  it.each([undefined, null, false, 1, "", [], {}])(
    "requires explicit verification declarations: %j",
    (value) => unsupported(() => validateBackupVerificationContribution(value)),
  );

  it("accepts an explicit database-only empty owner", () => {
    const value = {
      ...declaration(),
      data: { kind: "database_only", tables: [], immutableTables: [], checks: ["data"] },
      secrets: [],
      entries: [],
      effects: [],
      zeroSchema: "empty_schema",
      targetOnly: "empty_after_migration",
    };
    const owner = validateBackupVerificationContribution(value);
    expect(owner.data).toEqual({
      kind: "database_only",
      tables: [],
      immutableTables: [],
      checks: ["data"],
    });
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
    expect(owner.zeroSchema).toBe("empty_schema");
    expect(owner.targetOnly).toBe("empty_after_migration");
    expect(owner.verifyRestoredData).toBe(value.verifyRestoredData);
  });

  it.each([null, "unknown", "not_applicable"])(
    "data effects name independent declared checks: %j",
    (check) => {
      const value = declaration();
      value.effects = [{ id: "preserve-history", kind: "data", check }];
      unsupported(() => validateBackupVerificationContribution(value));
    },
  );

  it("activation effects cannot claim executed checks", () => {
    const value = declaration();
    value.effects = [{ id: "activate", kind: "activation", check: "data" }];
    unsupported(() => validateBackupVerificationContribution(value));
  });

  it.each([
    { version: 2 },
    { version: "1" },
    { publicEvidenceDigest: "private-diagnostic" },
    { publicEvidenceDigest: "A".repeat(64) },
    { data: { ...declaration().data, kind: "unknown" } },
    { data: { ...declaration().data, tables: ["records", "records"] } },
    { data: { ...declaration().data, tables: ["bad table"] } },
    { data: { ...declaration().data, immutableTables: ["unowned"] } },
    { data: { ...declaration().data, immutableTables: ["records", "records"] } },
    { data: { ...declaration().data, checks: [] } },
    { data: { ...declaration().data, checks: ["chain", "chain"] } },
    { data: { ...declaration().data, checks: ["unknown"] } },
    { data: { ...declaration().data, checks: ["not_applicable"] } },
    { data: { ...declaration().data, report: "private" } },
    { secrets: ["vault:example", "vault:example"] },
    { secrets: [""] },
    { secrets: null },
    { entries: [{ name: "../example", presence: "required" }] },
    { entries: [{ name: "/example", presence: "required" }] },
    { entries: [{ name: "secrets\\example", presence: "required" }] },
    { entries: [{ name: "secrets//example", presence: "required" }] },
    { entries: [{ name: "secrets/./example", presence: "required" }] },
    { entries: [{ name: "secrets/example\u0000", presence: "required" }] },
    { entries: [{ name: "secrets/example", presence: "sometimes" }] },
    { entries: [...declaration().entries, ...declaration().entries] },
    { entries: [{ name: "secrets/example", presence: "required", report: "private" }] },
    { effects: [...declaration().effects, ...declaration().effects] },
    { effects: [{ id: "", kind: "data", check: "chain" }] },
    { effects: [{ id: "effect", kind: "unknown", check: "chain" }] },
    { effects: [{ id: "effect", kind: "data", check: "chain", report: "private" }] },
    { zeroSchema: "ignore" },
    { targetOnly: "ignore" },
    { verifyRestoredData: null },
    { report: "private" },
  ])("refuses malformed or incomplete semantics: %j", (change) => {
    unsupported(() => validateBackupVerificationContribution({ ...declaration(), ...change }));
  });

  it.each(["secrets", "entries", "effects", "publicEvidenceDigest", "zeroSchema", "targetOnly"])(
    "requires the explicit %s policy",
    (key) => {
      const value: Record<string, unknown> = declaration();
      delete value[key];
      unsupported(() => validateBackupVerificationContribution(value));
    },
  );

  it("copies and freezes admitted policy without freezing the caller", () => {
    const value = declaration();
    const owner = validateBackupVerificationContribution({
      ...value,
      publicEvidenceDigest: "a".repeat(64),
    });
    value.data.tables.push("later");
    value.data.checks.length = 0;
    value.entries[0]!.presence = "required";
    value.effects[0]!.check = "data";
    value.secrets.push("vault:later");
    expect(owner.data.tables).toEqual(["records", "heads"]);
    expect(owner.data.checks).toEqual(["data", "chain"]);
    expect(owner.entries).toEqual([{ name: "secrets/example.json", presence: "optional" }]);
    expect(owner.effects[0]).toEqual({ id: "preserve-history", kind: "data", check: "chain" });
    expect(owner.secrets).toEqual(["vault:example"]);
    expect(owner.publicEvidenceDigest).toBe("a".repeat(64));
    expect(() => Reflect.set(owner.data.tables, "0", "changed")).not.toThrow();
    expect(owner.data.tables[0]).toBe("records");
    for (const part of [
      owner,
      owner.data,
      owner.secrets,
      owner.entries,
      owner.entries[0],
      owner.effects,
      owner.effects[0],
      owner.data.checks,
      owner.data.immutableTables,
    ]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });
});

describe("backup module results", () => {
  const owner = () => validateBackupVerificationContribution(declaration());

  it("accepts complete fixed checks in any order", () => {
    expect(
      validateBackupModuleResult(
        {
          status: "passed",
          checks: [
            { code: "chain", status: "passed" },
            { code: "data", status: "passed" },
          ],
        },
        owner(),
        false,
      ),
    ).toEqual({
      status: "passed",
      checks: [
        { code: "chain", status: "passed" },
        { code: "data", status: "passed" },
      ],
    });
  });

  it.each(["passed", "invalid", "needs_authority", "unsupported"])(
    "accepts the aggregate outcome %s when every check agrees",
    (status) =>
      expect(
        validateBackupModuleResult(
          {
            status,
            checks: [
              { code: "data", status },
              { code: "chain", status },
            ],
          },
          owner(),
          false,
        ).status,
      ).toBe(status),
  );

  it.each([
    ["invalid", "passed", "invalid"],
    ["needs_authority", "invalid", "needs_authority"],
    ["unsupported", "invalid", "unsupported"],
    ["unsupported", "needs_authority", "unsupported"],
  ])("inconclusive checks cannot certify completed integrity: %s/%s", (first, second, status) => {
    const checks = [
      { code: "data", status: first },
      { code: "chain", status: second },
    ];
    expect(validateBackupModuleResult({ status, checks }, owner(), false).status).toBe(status);
    unsupported(() => validateBackupModuleResult({ status: second, checks }, owner(), false));
  });

  it.each([
    null,
    {},
    { status: "passed", checks: [] },
    { status: "passed", checks: [{ code: "data", status: "passed" }] },
    {
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "data", status: "passed" },
      ],
    },
    {
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "unknown", status: "passed" },
      ],
    },
    {
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "chain", status: "invalid" },
      ],
    },
    {
      status: "failed",
      checks: [
        { code: "data", status: "passed" },
        { code: "chain", status: "passed" },
      ],
    },
    {
      status: "passed",
      checks: [
        { code: "data", status: "unavailable" },
        { code: "chain", status: "passed" },
      ],
    },
    {
      status: "passed",
      checks: [
        { code: "data", status: "passed", report: "secret" },
        { code: "chain", status: "passed" },
      ],
    },
    { status: "passed", checks: [{ code: "not_applicable", status: "passed" }] },
    {
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "chain", status: "passed" },
      ],
      report: "secret",
    },
  ])("rejects missing duplicate unknown inconsistent or free-form results: %j", (value) => {
    unsupported(() => validateBackupModuleResult(value, owner(), false));
  });

  it("admits only a sole passed not-applicable check after host admission", () => {
    expect(
      validateBackupModuleResult(
        { status: "passed", checks: [{ code: "not_applicable", status: "passed" }] },
        owner(),
        true,
      ),
    ).toEqual({
      status: "passed",
      checks: [{ code: "not_applicable", status: "passed" }],
    });
    unsupported(() =>
      validateBackupModuleResult(
        { status: "invalid", checks: [{ code: "not_applicable", status: "invalid" }] },
        owner(),
        true,
      ),
    );
    unsupported(() =>
      validateBackupModuleResult(
        {
          status: "passed",
          checks: [
            { code: "not_applicable", status: "passed" },
            { code: "data", status: "passed" },
          ],
        },
        owner(),
        true,
      ),
    );
    unsupported(() =>
      validateBackupModuleResult(
        {
          status: "passed",
          checks: [
            { code: "data", status: "passed" },
            { code: "chain", status: "passed" },
          ],
        },
        owner(),
        true,
      ),
    );
  });

  it("copies and freezes admitted results", () => {
    const value = {
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "chain", status: "passed" },
      ],
    };
    const result = validateBackupModuleResult(value, owner(), false);
    value.checks[0]!.status = "invalid";
    value.checks.length = 0;
    expect(result.checks).toEqual([
      { code: "data", status: "passed" },
      { code: "chain", status: "passed" },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.checks)).toBe(true);
    expect(Object.isFrozen(result.checks[0])).toBe(true);
  });

  it("uses bounded private signals with no supplied diagnostics", () => {
    expect(new BackupVerificationUnsupported("target_incompatible")).toMatchObject({
      reason: "target_incompatible",
      message: "Backup verification unsupported",
    });
    expect(new BackupVerificationUnsupported("module_missing").reason).toBe("module_missing");
    for (const reason of [
      "secret_unavailable",
      "decryption_unavailable",
      "resource_limit",
    ] as const) {
      expect(new BackupCheckUnavailable(reason)).toMatchObject({
        reason,
        message: "Backup check unavailable",
      });
    }
  });
});
