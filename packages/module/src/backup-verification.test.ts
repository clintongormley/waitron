import { describe, expect, it } from "vitest";
import {
  BackupCheckUnavailable,
  BackupVerificationUnsupported,
  combineBackupVerification,
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

describe("combining a set's own verification with the modules it hosts", () => {
  type Status = "passed" | "invalid" | "needs_authority" | "unsupported";
  function hosted(statuses: Readonly<Record<string, Status>> = { data: "passed" }) {
    const checks = Object.keys(statuses);
    return validateBackupVerificationContribution({
      version: 1,
      publicEvidenceDigest: null,
      data: { kind: "database_only", tables: ["shifts", "records"], immutableTables: [], checks },
      secrets: ["vault:shifts"],
      entries: [
        { name: "secrets/example.json", presence: "required" },
        { name: "secrets/shifts.json", presence: "optional" },
      ],
      effects: [{ id: "keep-shifts", kind: "data", check: checks[0] }],
      zeroSchema: "empty_schema",
      targetOnly: "empty_after_migration",
      verifyRestoredData: async () => {
        const list = Object.entries(statuses).map(([code, status]) => ({ code, status }));
        const status =
          (["unsupported", "needs_authority", "invalid"] as const).find((s) =>
            list.some((c) => c.status === s),
          ) ?? "passed";
        return { status, checks: list };
      },
    });
  }
  const host = () => validateBackupVerificationContribution(declaration());
  const context = {} as Parameters<ReturnType<typeof host>["verifyRestoredData"]>[0];

  it("is the host itself when nothing is hosted", () => {
    const own = host();
    expect(combineBackupVerification(own, [])).toBe(own);
  });

  it("covers the union of every table, check, secret, entry and effect", () => {
    const combined = combineBackupVerification(host(), [hosted()]);
    expect([...combined.data.tables].sort()).toEqual(["heads", "records", "shifts"]);
    expect(combined.data.immutableTables).toEqual(["records"]);
    expect([...combined.data.checks].sort()).toEqual(["chain", "data"]);
    expect([...combined.secrets].sort()).toEqual(["vault:example", "vault:shifts"]);
    expect(combined.effects.map((e) => e.id).sort()).toEqual([
      "activate",
      "keep-shifts",
      "preserve-history",
    ]);
    expect(combined.data.kind).toBe("custom");
    expect(combined.targetOnly).toBe("unsupported");
    expect(combined.zeroSchema).toBe("absent_tables_and_entries");
    expect(Object.isFrozen(combined)).toBe(true);
  });

  it("keeps an entry required when any contribution requires it", () => {
    const combined = combineBackupVerification(host(), [hosted()]);
    expect([...combined.entries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: "secrets/example.json", presence: "required" },
      { name: "secrets/shifts.json", presence: "optional" },
    ]);
  });

  it("is database-only and supported when every contribution is", () => {
    const combined = combineBackupVerification(hosted(), [
      hosted({ data: "passed", secret: "passed" }),
    ]);
    expect(combined.data.kind).toBe("database_only");
    expect(combined.targetOnly).toBe("empty_after_migration");
    expect(combined.zeroSchema).toBe("empty_schema");
  });

  it("keeps the one public evidence digest there is, and none when there are none", () => {
    const digest = "a".repeat(64);
    const withDigest = validateBackupVerificationContribution({
      ...declaration(),
      publicEvidenceDigest: digest,
    });
    expect(combineBackupVerification(hosted(), [withDigest]).publicEvidenceDigest).toBe(digest);
    expect(combineBackupVerification(hosted(), [hosted()]).publicEvidenceDigest).toBeNull();
  });

  it("refuses two different public evidence digests rather than dropping one", () => {
    const one = validateBackupVerificationContribution({
      ...declaration(),
      publicEvidenceDigest: "a".repeat(64),
    });
    const two = validateBackupVerificationContribution({
      ...hosted(),
      publicEvidenceDigest: "b".repeat(64),
    });
    unsupported(() => combineBackupVerification(one, [two]));
  });

  it("refuses one effect id declared two different ways", () => {
    const other = validateBackupVerificationContribution({
      ...hosted(),
      effects: [{ id: "activate", kind: "data", check: "data" }],
    });
    unsupported(() => combineBackupVerification(host(), [other]));
  });

  it("returns one check per code, each with its worst status, and the worst status overall", async () => {
    const combined = combineBackupVerification(host(), [
      hosted({ data: "needs_authority" }),
      hosted({ data: "invalid", secret: "passed" }),
    ]);
    const result = await combined.verifyRestoredData(context);
    expect(result.status).toBe("needs_authority");
    expect([...result.checks].sort((a, b) => (a.code < b.code ? -1 : 1))).toEqual([
      { code: "chain", status: "passed" },
      { code: "data", status: "needs_authority" },
      { code: "secret", status: "passed" },
    ]);
    expect(validateBackupModuleResult(result, combined, false)).toEqual(result);
  });

  it("fails the set when a hosted module's check fails", async () => {
    const combined = combineBackupVerification(host(), [hosted({ data: "invalid" })]);
    const result = await combined.verifyRestoredData(context);
    expect(result.status).toBe("invalid");
    expect(result.checks.find((c) => c.code === "data")!.status).toBe("invalid");
  });

  it("runs the host first, then each hosted contribution in the order given", async () => {
    const order: string[] = [];
    const tracked = (name: string, owner: ReturnType<typeof host>) =>
      validateBackupVerificationContribution({
        ...owner,
        verifyRestoredData: async (c: typeof context) => {
          order.push(name);
          return owner.verifyRestoredData(c);
        },
      });
    await combineBackupVerification(tracked("host", host()), [
      tracked("first", hosted()),
      tracked("second", hosted()),
    ]).verifyRestoredData(context);
    expect(order).toEqual(["host", "first", "second"]);
  });

  it("refuses a hosted result that does not answer its own checks", async () => {
    const wrong = validateBackupVerificationContribution({
      ...hosted(),
      verifyRestoredData: async () => ({
        status: "passed",
        checks: [{ code: "chain", status: "passed" }],
      }),
    });
    await expect(
      combineBackupVerification(host(), [wrong]).verifyRestoredData(context),
    ).rejects.toThrow(expect.objectContaining({ reason: "semantics_missing" }));
  });
});
