import { describe, expect, it } from "vitest";
import {
  readBackupVerificationRequest,
  backupVerificationRequestDigest,
  readBackupVerificationResult,
  type BackupVerificationRequest,
} from "./backup-verification-protocol.js";

const VECTOR = {
  protocol: "backup-data-restore/v1",
  captureId: "capture-1",
  pointId: "capture-1",
  venueId: "venue-1",
  sourceInstallationId: "installation-1",
  sourceNodeId: "node-1",
  capturedAt: "2026-10-20T08:00:00.000Z",
  archive: {
    sha256: "1111111111111111111111111111111111111111111111111111111111111111",
    bytes: 8388608,
    manifestVersion: 1,
    environment: "preproduction",
    modules: {
      orders: 0,
      core: 2,
    },
  },
  backupKey: {
    version: 1,
    reference: "key-1",
  },
  target: {
    version: 1,
    runtime: {
      release: "2026.10.20",
      revision: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      fingerprint: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    modules: [
      {
        name: "core",
        packageVersion: "1.2.3",
        requires: {},
        schema: 2,
        migrationTable: "__drizzle_migrations_db",
        migrationDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        semanticsVersion: 1,
        policyDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        name: "orders",
        packageVersion: "2.0.0",
        requires: {
          core: "^1.2.0",
        },
        schema: 0,
        migrationTable: "__drizzle_migrations_orders",
        migrationDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        semanticsVersion: 1,
        policyDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
    ],
    compositionDigest: "b4856410cd1eb08bbbbdca82780768cb4ede5c00c7a8bb3a1c17589ad0c4a7a5",
    migrationDigest: "185384d2b168dcc542e78692a3649d220c8841ae26bab6cf93c7f1f997ac06c0",
    policyDigest: "bd085f106c2acf118ed5d22b2b32b6104ab5d0546f6146a750c3e210025c15d5",
    digest: "e7a8e1dc880ec7f846a6f22750dc610ea8159d02393b08d5c4bb08ed181a9e76",
  },
  verifierImage:
    "registry.example/waitron@sha256:2222222222222222222222222222222222222222222222222222222222222222",
  attempt: {
    jobId: "job-1",
    number: 1,
    claimId: "claim-1",
    controllerScope: "controller-1",
    childToken: "child-1",
    deadline: "2026-10-20T08:00:30.000Z",
  },
} as const;
const DIGEST = "ecac239bf44b948246432671c1f896219d079c9a3a11b1e3a96d7bd6240e786a";
function request(): BackupVerificationRequest {
  return structuredClone(VECTOR) as unknown as BackupVerificationRequest;
}
function result() {
  return {
    protocol: "backup-data-restore/v1",
    requestDigest: DIGEST,
    attemptToken: "child-1",
    measuredArchive: { sha256: "1".repeat(64), bytes: 8388608 },
    targetDigest: VECTOR.target.digest,
    policyDigest: VECTOR.target.policyDigest,
    modules: ["core", "orders"].map((name) => ({
      name,
      semanticsVersion: 1,
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    })),
    status: "passed",
    reason: "none",
    activation: "not_attempted",
  };
}
function change(value: object, path: string, replacement: unknown) {
  const parts = path.split(".");
  let cursor = value as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  cursor[parts.at(-1)!] = replacement;
}
function refused(body: () => unknown) {
  expect(body).toThrowError("Invalid backup verification protocol");
}

describe("private backup request", () => {
  it("admits and freezes the independent literal vector", () => {
    const admitted = readBackupVerificationRequest(JSON.stringify(VECTOR));
    expect(admitted).toEqual(VECTOR);
    expect(backupVerificationRequestDigest(admitted)).toBe(DIGEST);
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(admitted.target.modules[1]!.requires)).toBe(true);
    expect(Object.isFrozen(admitted.archive.modules)).toBe(true);
  });
  it("module ordering leaves the digest stable", () => {
    const input = request();
    input.archive.modules = { core: 2, orders: 0 };
    input.target.modules = [...input.target.modules].reverse();
    expect(
      backupVerificationRequestDigest(readBackupVerificationRequest(JSON.stringify(input))),
    ).toBe(DIGEST);
  });
  it.each([
    ["protocol", "backup-data-restore/v2"],
    ["captureId", "capture-2"],
    ["pointId", "capture-2"],
    ["venueId", "venue-2"],
    ["sourceInstallationId", "installation-2"],
    ["sourceNodeId", "node-2"],
    ["capturedAt", "2026-10-20T08:00:01.000Z"],
    ["archive.sha256", "3".repeat(64)],
    ["archive.bytes", 8388609],
    ["archive.manifestVersion", 2],
    ["archive.environment", "production"],
    ["archive.modules.core", 3],
    ["backupKey.version", 2],
    ["backupKey.reference", "key-2"],
    ["target.digest", "3".repeat(64)],
    ["target.runtime.release", "2026.10.21"],
    ["target.runtime.revision", "3".repeat(40)],
    ["target.runtime.fingerprint", "3".repeat(64)],
    ["target.compositionDigest", "3".repeat(64)],
    ["target.migrationDigest", "3".repeat(64)],
    ["target.policyDigest", "3".repeat(64)],
    ["verifierImage", "registry.example/waitron@sha256:" + "3".repeat(64)],
    ["attempt.jobId", "job-2"],
    ["attempt.number", 2],
    ["attempt.claimId", "claim-2"],
    ["attempt.controllerScope", "controller-2"],
    ["attempt.childToken", "child-2"],
    ["attempt.deadline", "2026-10-20T08:00:31.000Z"],
  ])("binds request field %s independently", (path, replacement) => {
    const input = request();
    change(input, path as string, replacement);
    expect(backupVerificationRequestDigest(input)).not.toBe(DIGEST);
  });
  it.each([
    ["archive.bytes", 0],
    ["archive.bytes", 536870913],
    ["archive.bytes", 1.5],
    ["archive.bytes", Number.MAX_SAFE_INTEGER + 1],
    ["archive.manifestVersion", 0],
    ["archive.modules.core", -1],
    ["backupKey.version", 0],
    ["attempt.number", 0],
    ["pointId", "different"],
    ["venueId", "contains space"],
    ["venueId", "x".repeat(129)],
    ["sourceNodeId", String.fromCharCode(128)],
    ["backupKey.reference", "x".repeat(257)],
    ["capturedAt", "2026-10-20T08:00:00Z"],
    ["capturedAt", "2026-02-30T08:00:00.000Z"],
    ["attempt.deadline", "2026-10-20T10:00:30.000+02:00"],
    ["archive.sha256", "A".repeat(64)],
    ["archive.environment", "dev"],
    ["verifierImage", "waitron:main"],
    ["target.runtime.revision", "e".repeat(39)],
    ["target.runtime.fingerprint", "F".repeat(64)],
    ["target.version", 2],
    ["archive.modules", {}],
    ["archive.modules", { Bad: 1 }],
    ["target.modules", []],
    ["target.modules", [VECTOR.target.modules[0], VECTOR.target.modules[0]]],
    ["target.modules.0.schema", -1],
    ["target.modules.0.semanticsVersion", 0],
    ["target.modules.0.requires", { missing: "*" }],
    ["target.modules.0.migrationTable", "../outside"],
    ["target.modules.0.packageVersion", ""],
    ["target.modules.0.name", "x".repeat(65)],
  ])("rejects malformed %s=%j", (path, replacement) => {
    const input = request();
    change(input, path as string, replacement);
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  it.each([
    "secret",
    "archive.path",
    "backupKey.secret",
    "target.runtime.sourceRevision",
    "target.modules.0.extra",
    "attempt.extra",
  ])("rejects unknown key %s", (path) => {
    const input = request();
    change(input, path, "private-value");
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  it.each(['{"captureId":"replaced",', '{"\\u0063aptureId":"replaced",'])(
    "rejects duplicate decoded root keys: %s",
    (prefix) => {
      refused(() => readBackupVerificationRequest(prefix + JSON.stringify(VECTOR).slice(1)));
    },
  );
  it("rejects duplicate nested keys before JSON parsing loses them", () => {
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace('"bytes":8388608', '"bytes":1,"bytes":8388608'),
      ),
    );
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace('"orders":0', '"orders":1,"orders":0'),
      ),
    );
  });
  it.each(["-0", "2.0", "2e0", "02", "NaN", "Infinity"])(
    "rejects noncanonical integer spelling %s",
    (spelling) => {
      refused(() =>
        readBackupVerificationRequest(
          JSON.stringify(VECTOR).replace('"number":1', '"number":' + spelling),
        ),
      );
    },
  );
  it.each([
    "",
    "null",
    "[]",
    "true",
    "{}",
    '{"a":',
    JSON.stringify(VECTOR) + " trailing",
    "[".repeat(40) + "]".repeat(40),
  ])("refuses malformed or wrong-root JSON %s", (raw) => {
    refused(() => readBackupVerificationRequest(raw));
  });
  it("bounds bytes and map sizes", () => {
    refused(() => readBackupVerificationRequest(" ".repeat(65536) + JSON.stringify(VECTOR)));
    const input = request();
    input.archive.modules = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => ["module-" + i, 0]),
    );
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  it("admits well-formed unsupported manifest versions without qualifying them", () => {
    const input = request();
    input.archive.manifestVersion = 2;
    const admitted = readBackupVerificationRequest(JSON.stringify(input));
    expect(admitted.archive.manifestVersion).toBe(2);
    const output = result();
    output.requestDigest = backupVerificationRequestDigest(admitted);
    refused(() => readBackupVerificationResult(JSON.stringify(output), admitted));
    output.status = "unsupported";
    output.reason = "archive_format_unsupported";
    output.modules = [];
    expect(readBackupVerificationResult(JSON.stringify(output), admitted).status).toBe(
      "unsupported",
    );
  });
});

describe("private backup result admission", () => {
  it("admits only complete measured passed output", () => {
    const output = result();
    const admitted = readBackupVerificationResult(JSON.stringify(output), request());
    expect(admitted).toEqual(output);
    expect(Object.isFrozen(admitted.modules[0]!.checks)).toBe(true);
  });
  it.each([
    ["protocol", "v2"],
    ["requestDigest", "3".repeat(64)],
    ["attemptToken", "other"],
    ["targetDigest", "3".repeat(64)],
    ["policyDigest", "3".repeat(64)],
    ["activation", "attempted"],
    ["measuredArchive", null],
    ["measuredArchive.sha256", "3".repeat(64)],
    ["measuredArchive.bytes", 8388607],
    ["modules", []],
    ["modules", [result().modules[0]]],
    ["modules", [result().modules[0], result().modules[0]]],
    ["modules.0.name", "unknown"],
    ["modules.0.semanticsVersion", 2],
    ["modules.0.checks", []],
    [
      "modules.0.checks",
      [
        { code: "data", status: "passed" },
        { code: "data", status: "passed" },
      ],
    ],
    ["modules.0.checks", [{ code: "arbitrary", status: "passed" }]],
    ["modules.0.checks.0.status", "invalid"],
    ["modules.0.status", "invalid"],
    ["status", "other"],
    ["reason", "unexpected"],
    ["secret", "private"],
    ["modules.0.path", "/private"],
    ["modules.0.checks.0.detail", "private"],
    ["measuredArchive.filename", "private"],
  ])("rejects forged or incomplete result field %s", (path, replacement) => {
    const output = result();
    change(output, path as string, replacement);
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
  });
  it.each([
    ["invalid", "archive_digest_mismatch"],
    ["invalid", "module_integrity"],
    ["needs_authority", "module_data_check_requires_authority"],
    ["unsupported", "semantics_missing"],
    ["unavailable", "decryption_unavailable"],
    ["unavailable", "cleanup_uncertain"],
  ])("admits bounded early %s/%s without claiming success", (status, reason) => {
    const output = { ...result(), status, reason, modules: [], measuredArchive: null };
    expect(readBackupVerificationResult(JSON.stringify(output), request())).toEqual(output);
  });
  it("requires status agreement in failed owner checks", () => {
    const output = result();
    output.status = "invalid";
    output.reason = "module_integrity";
    output.modules[0]!.status = "invalid";
    output.modules[0]!.checks[0]!.status = "invalid";
    expect(readBackupVerificationResult(JSON.stringify(output), request()).status).toBe("invalid");
    output.modules[0]!.status = "passed";
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
  });
  it("refuses an inconclusive owner being reported as corruption", () => {
    const output = result();
    output.status = "invalid";
    output.reason = "module_integrity";
    output.modules[0]!.status = "unsupported";
    output.modules[0]!.checks[0]!.status = "unsupported";
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
  });
  it("rejects duplicate result keys and oversized or excessive checks", () => {
    refused(() =>
      readBackupVerificationResult(
        '{"status":"invalid",' + JSON.stringify(result()).slice(1),
        request(),
      ),
    );
    refused(() =>
      readBackupVerificationResult(" ".repeat(32768) + JSON.stringify(result()), request()),
    );
    const output = result();
    output.modules[0]!.checks = Array.from({ length: 17 }, () => ({
      code: "data",
      status: "passed",
    }));
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
  });
});

describe("additional private wire boundaries", () => {
  it.each([
    ["archive.modules", null],
    ["archive.modules", []],
    ["target.modules.0.requires", []],
    ["target.modules.1.migrationTable", "__drizzle_migrations_db"],
    ["target.modules.0.requires", { core: "" }],
    ["target.modules.0.requires", { core: ">=1.0.0\t<2.0.0" }],
    ["target.modules.0", null],
    ["archive.sha256", 1],
    ["attempt.number", true],
    ["archive.modules.core", false],
  ])("rejects ill-typed nested field %s", (path, replacement) => {
    const input = request();
    change(input, path as string, replacement);
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  it.each([
    '{"a" 1}',
    "[1 2]",
    '{"a":1 "b":2}',
    '"unterminated',
    String.raw`{"a":"\q"}`,
    '{"a":1,}',
    "[1,]",
  ])("rejects broken JSON grammar %s", (raw) => {
    refused(() => readBackupVerificationRequest(raw));
  });
  it("refuses non-string transport values with the same private error", () => {
    refused(() => readBackupVerificationRequest(null as unknown as string));
  });
  it("admits a sole not-applicable check but refuses it alongside ordinary checks", () => {
    const output = result();
    output.modules[0]!.checks = [{ code: "not_applicable", status: "passed" }];
    expect(
      readBackupVerificationResult(JSON.stringify(output), request()).modules[0]!.checks,
    ).toEqual([{ code: "not_applicable", status: "passed" }]);
    output.modules[0]!.checks.push({ code: "data", status: "passed" });
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
    output.modules[0]!.checks = [{ code: "not_applicable", status: "invalid" }];
    output.modules[0]!.status = "invalid";
    output.status = "invalid";
    output.reason = "module_integrity";
    refused(() => readBackupVerificationResult(JSON.stringify(output), request()));
  });
  it("admits mixed-status precedence and an unavailable cleanup after completed checks", () => {
    const output = result();
    output.status = "unsupported";
    output.reason = "semantics_missing";
    output.modules[0]!.status = "unsupported";
    output.modules[0]!.checks = [
      { code: "data", status: "invalid" },
      { code: "secret", status: "unsupported" },
    ];
    expect(readBackupVerificationResult(JSON.stringify(output), request()).status).toBe(
      "unsupported",
    );
    output.status = "unavailable";
    output.reason = "cleanup_uncertain";
    expect(readBackupVerificationResult(JSON.stringify(output), request()).status).toBe(
      "unavailable",
    );
  });
});
