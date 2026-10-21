import { createHash } from "node:crypto";
import { appendFile, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import forge from "node-forge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import * as store from "@waitron/store";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { certificate } from "@waitron/server-kit/certificate.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifactAsync } from "./artifact-cipher.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import {
  backupVerificationRequestDigest,
  readBackupVerificationResult,
  type BackupVerificationRequest,
} from "./backup-verification-protocol.js";
import * as entry from "./backup-verification-entry.js";
import * as archiveReaders from "./backup-verification-archive.js";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rm: vi.fn(real.rm) };
});
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const modules = ALL_MODULES.filter((m) => ["core", "credentials", "fiscal-none"].includes(m.name));
const sourceNodeId = "20000000-0000-4000-8000-000000000002";
const locationId = "10000000-0000-4000-8000-000000000001";
const capturedAt = "2026-10-20T08:00:00.000Z";
const runtime = { release: "test-release", revision: "a".repeat(40), fingerprint: "b".repeat(64) };
const key = "private-archive-key-sentinel";
const vault = Buffer.alloc(32, 19).toString("base64");
const pair = forge.pki.rsa.generateKeyPair(2048);
const issuer = { cn: "Verification fixture CA", key: pair.privateKey };
const validity = { notBefore: new Date("2026-01-01Z"), notAfter: new Date("2030-01-01Z") };
const ca = certificate(issuer.cn, pair, issuer, "01", validity, [
  { name: "basicConstraints", cA: true },
]);
const server = certificate("verification.test", pair, issuer, "02", validity, [
  { name: "basicConstraints", cA: false },
]);
const recoveryEntries = Object.entries({
  "secrets.env": `WAITRON_CREDENTIALS_KEY=${vault}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
  "trading.env": `WAITRON_TILL_NODE_ID=${sourceNodeId}\nWAITRON_TILL_LOCATION_ID=${locationId}\nWAITRON_ENV=preproduction\n`,
  "tls/ca.crt": forge.pki.certificateToPem(ca),
  "tls/ca.key": forge.pki.privateKeyToPem(pair.privateKey),
  "tls/server.crt": forge.pki.certificateToPem(server),
  "tls/server.key": forge.pki.privateKeyToPem(pair.privateKey),
}).map(([name, text]) => ({ name: "secrets/" + name, bytes: Buffer.from(text) }));
const suite = useVenueDb({
  migrations: migrationOptionsFor(orderedMigrationSets(modules), null),
  resetPerTest: false,
  setup: async (db) => {
    db.run(
      `insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'private-tax-sentinel', 'Private company sentinel', '2026-10-20T00:00:00Z')`,
    );
    await db.run(
      sql`insert into locations (id, name, invoice_locales, operation_description) values (${locationId}, 'Fixture location', '["en"]', 'Restaurant')`,
    );
    await db.run(
      sql`insert into nodes (id, location_id, name, created_at) values (${sourceNodeId}, ${locationId}, 'Source node', '2026-10-20T00:00:00Z')`,
    );
    db.run(
      `insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
    );
  },
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.rm).mockImplementation(realFs.rm);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "a850-verifier-"));
  roots.push(root);
  const scratchRoot = join(root, "scratch");
  await mkdir(scratchRoot, { mode: 0o700 });
  const databasePath = join(root, "source.db");
  await suite.db.archiveTo(databasePath);
  const manifest = await buildManifest({
    db: suite.db,
    modules,
    environment: "preproduction",
    now: new Date(capturedAt),
  });
  const entries: ArchiveEntry[] = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(databasePath) },
    ...recoveryEntries.map((e) => ({ name: e.name, bytes: Buffer.from(e.bytes) })),
  ];
  const artifactPath = join(root, "input.enc");
  const target = buildBackupVerificationTarget({ modules, migrationsRoot: null, runtime });
  const request: BackupVerificationRequest = {
    protocol: "backup-data-restore/v1",
    captureId: "capture-1",
    pointId: "capture-1",
    venueId: "venue-1",
    sourceInstallationId: "installation-1",
    sourceNodeId,
    capturedAt,
    archive: {
      sha256: "c".repeat(64),
      bytes: 1,
      manifestVersion: 1,
      environment: "preproduction",
      modules: manifest.modules,
    },
    backupKey: { version: 2, reference: "key-2" },
    target,
    verifierImage: "registry.example/waitron@sha256:" + "d".repeat(64),
    attempt: {
      jobId: "job-1",
      number: 1,
      claimId: "claim-1",
      controllerScope: "controller-1",
      childToken: "child-1",
      deadline: "2026-10-20T08:00:30.000Z",
    },
  };
  return {
    root,
    entries,
    databasePath,
    request,
    deps: {
      artifactPath,
      recoveryKey: { ...request.backupKey, secret: key },
      scratchRoot,
      modules,
      migrationsRoot: null as string | null,
      runtime,
      signal: new AbortController().signal,
      now: () => new Date(capturedAt),
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seal(f: Fixture) {
  const bytes = await encryptArtifactAsync(packArchive(f.entries), key);
  await writeFile(f.deps.artifactPath, bytes);
  f.request.archive.sha256 = createHash("sha256").update(bytes).digest("hex");
  f.request.archive.bytes = bytes.length;
  return bytes;
}
async function verify(f: Fixture) {
  expect(entry).toHaveProperty("verifyBackupArtifact", expect.any(Function));
  const result = await entry.verifyBackupArtifact(f.request, f.deps);
  expect(result.requestDigest).toBe(backupVerificationRequestDigest(f.request));
  expect(result.attemptToken).toBe("child-1");
  expect(result.targetDigest).toBe(f.request.target.digest);
  expect(result.policyDigest).toBe(f.request.target.policyDigest);
  expect(result.activation).toBe("not_attempted");
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  const raw = JSON.stringify(result);
  for (const privateValue of [
    key,
    vault,
    sourceNodeId,
    locationId,
    f.root,
    "private-tax-sentinel",
    "Private company sentinel",
  ])
    expect(raw).not.toContain(privateValue);
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(32768);
  return result;
}

describe("complete backup verification", () => {
  it("independently measures consumed encrypted bytes and completes every owner without activation", async () => {
    const f = await fixture();
    const bytes = await seal(f);
    const result = await verify(f);
    expect(result).toEqual({
      protocol: "backup-data-restore/v1",
      requestDigest: backupVerificationRequestDigest(f.request),
      attemptToken: "child-1",
      measuredArchive: {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
      targetDigest: f.request.target.digest,
      policyDigest: f.request.target.policyDigest,
      modules: [
        {
          name: "core",
          semanticsVersion: 1,
          status: "passed",
          checks: [
            { code: "data", status: "passed" },
            { code: "secret", status: "passed" },
          ],
        },
        {
          name: "credentials",
          semanticsVersion: 1,
          status: "passed",
          checks: [
            { code: "data", status: "passed" },
            { code: "secret", status: "passed" },
          ],
        },
        {
          name: "fiscal-none",
          semanticsVersion: 1,
          status: "passed",
          checks: [{ code: "not_applicable", status: "passed" }],
        },
      ],
      status: "passed",
      reason: "none",
      activation: "not_attempted",
    });
    expect(readBackupVerificationResult(JSON.stringify(result), f.request)).toEqual(result);
    expect(await readFile(f.deps.artifactPath)).toEqual(bytes);
  });
  it.each(["sha256", "bytes"] as const)(
    "rejects an independently measured %s mismatch before parsing",
    async (field) => {
      const f = await fixture();
      await seal(f);
      if (field === "sha256") f.request.archive.sha256 = "e".repeat(64);
      else f.request.archive.bytes++;
      const result = await verify(f);
      expect(result.status).toBe("invalid");
      expect(result.reason).toBe(
        field === "sha256" ? "archive_digest_mismatch" : "archive_size_mismatch",
      );
      expect(result.measuredArchive).not.toEqual({
        sha256: f.request.archive.sha256,
        bytes: f.request.archive.bytes,
      });
      expect(result.modules).toEqual([]);
    },
  );
  it.each(["wrong", "missing", "version", "reference"])(
    "treats a %s key as unavailable rather than corruption",
    async (kind) => {
      const f = await fixture();
      await seal(f);
      if (kind === "wrong") f.deps.recoveryKey.secret = "wrong-key";
      if (kind === "missing") f.deps.recoveryKey.secret = "";
      if (kind === "version") f.deps.recoveryKey.version++;
      if (kind === "reference") f.deps.recoveryKey.reference = "different-key";
      const result = await verify(f);
      expect(result.status).toBe("unavailable");
      expect(result.reason).toBe(
        kind === "wrong" ? "decryption_unavailable" : "secret_unavailable",
      );
      expect(result.modules).toEqual([]);
      expect(result.measuredArchive === null).toBe(kind !== "wrong");
    },
  );
  it.each(["capturedAt", "sourceNodeId", "environment", "manifestVersion"])(
    "checks archive %s against the request",
    async (field) => {
      const f = await fixture();
      await seal(f);
      if (field === "capturedAt") f.request.capturedAt = "2026-10-20T07:59:59.000Z";
      if (field === "sourceNodeId") f.request.sourceNodeId = "other-node";
      if (field === "environment") f.request.archive.environment = "production";
      if (field === "manifestVersion") f.request.archive.manifestVersion = 2;
      const result = await verify(f);
      expect(result.status).toBe(field === "manifestVersion" ? "unsupported" : "invalid");
      expect(result.reason).toBe(
        field === "manifestVersion" ? "archive_format_unsupported" : "binding_mismatch",
      );
      expect(result.modules).toEqual([]);
    },
  );
  it("refuses the local runtime changing before any input is consumed", async () => {
    const f = await fixture();
    await seal(f);
    f.deps.runtime = { ...runtime, revision: "e".repeat(40) };
    const result = await verify(f);
    expect(result).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      measuredArchive: null,
      modules: [],
    });
  });
  it("does not invent a measurement for an unreadable input", async () => {
    const f = await fixture();
    expect(await verify(f)).toMatchObject({
      status: "unavailable",
      reason: "unexpected",
      measuredArchive: null,
      modules: [],
    });
  });
  it.each(["cancelled", "deadline"])("withholds a result when %s before work", async (reason) => {
    const f = await fixture();
    await seal(f);
    if (reason === "cancelled")
      f.deps.signal = AbortSignal.abort(new Error("private-cancel-sentinel"));
    else f.deps.now = () => new Date(f.request.attempt.deadline);
    expect(await verify(f)).toMatchObject({
      status: "unavailable",
      reason,
      measuredArchive: null,
      modules: [],
    });
  });
  it("checks SQLite foreign keys on the captured original", async () => {
    const f = await fixture();
    const db = new DatabaseSync(f.databasePath);
    try {
      db.exec("pragma foreign_keys=off");
      db.exec(`update nodes set location_id='missing'`);
    } finally {
      db.close();
    }
    f.entries[1] = { name: "db.dump", bytes: await readFile(f.databasePath) };
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "sqlite_integrity",
      modules: [],
    });
  });
  it("checks declared recovery secrets rather than presence alone", async () => {
    const f = await fixture();
    f.entries = f.entries.map((e) =>
      e.name === "secrets/tls/server.key"
        ? { ...e, bytes: Buffer.from("malformed-key-private-sentinel") }
        : e,
    );
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "secret_invalid",
      modules: [],
    });
  });
  it("refuses unclaimed archive data through real compatibility", async () => {
    const f = await fixture();
    f.entries.push({ name: "secrets/unowned.json", bytes: Buffer.from("private-unclaimed") });
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      modules: [],
    });
  });
  it("input path replacement cannot swap the decrypted bytes", async () => {
    const f = await fixture();
    const original = await seal(f);
    const replacement = await encryptArtifactAsync(Buffer.from("different-private-archive"), key);
    const validate = archiveReaders.validateBackupArtifactFile;
    vi.spyOn(archiveReaders, "validateBackupArtifactFile").mockImplementation(async (input) => {
      await rm(f.deps.artifactPath);
      await writeFile(f.deps.artifactPath, replacement);
      expect(input.artifactPath).not.toBe(f.deps.artifactPath);
      expect(await readFile(input.artifactPath)).toEqual(original);
      return validate(input);
    });
    const result = await verify(f);
    expect(result.status).toBe("passed");
    expect(result.measuredArchive?.bytes).toBe(original.length);
    expect(await readFile(f.deps.artifactPath)).toEqual(replacement);
  });
  it("an empty input has no invented positive measurement", async () => {
    const f = await fixture();
    await writeFile(f.deps.artifactPath, "");
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "archive_size_mismatch",
      measuredArchive: null,
      modules: [],
    });
  });
  it("refuses an unsupported newer source schema without calling it corruption", async () => {
    const f = await fixture();
    const manifest = JSON.parse(Buffer.from(f.entries[0]!.bytes).toString()) as {
      modules: Record<string, number>;
    };
    manifest.modules.core!++;
    f.request.archive.modules = manifest.modules;
    f.entries[0] = { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) };
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      modules: [],
    });
  });
  it("disposes the plaintext after a malformed authenticated archive", async () => {
    const f = await fixture();
    const bytes = await encryptArtifactAsync(Buffer.from("private-invalid-plaintext"), key);
    await writeFile(f.deps.artifactPath, bytes);
    f.request.archive.bytes = bytes.length;
    f.request.archive.sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "archive_invalid",
      modules: [],
    });
  });
  it("checks the real 256 MiB scratch bound while copying", async () => {
    const f = await fixture();
    await seal(f);
    const handle = await fs.open(f.deps.artifactPath, "r+");
    try {
      await handle.truncate(256 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    f.request.archive.bytes = 256 * 1024 * 1024 + 1;
    expect(await verify(f)).toMatchObject({
      status: "unavailable",
      reason: "resource_limit",
      measuredArchive: null,
      modules: [],
    });
  });
  it("a close failure overrides completed checks and still removes owned scratch", async () => {
    const f = await fixture();
    await seal(f);
    const open = store.openBackupQuery;
    vi.spyOn(store, "openBackupQuery").mockImplementation(async (path) => {
      const actual = await open(path);
      return {
        query: actual.query,
        close: async () => {
          await actual.close();
          throw new Error("private-close-sentinel");
        },
      };
    });
    expect(await verify(f)).toMatchObject({ status: "unavailable", reason: "cleanup_uncertain" });
  });
  it.each(["passed", "invalid"])(
    "failed removal overrides a provisional %s verdict",
    async (provisional) => {
      const f = await fixture();
      await seal(f);
      if (provisional === "invalid") f.request.archive.sha256 = "e".repeat(64);
      const attempts: string[] = [];
      vi.mocked(fs.rm).mockImplementation(async (path, options) => {
        if (dirname(String(path)) === f.deps.scratchRoot) {
          attempts.push(String(path));
          throw new Error("private-removal-sentinel");
        }
        return realFs.rm(path, options);
      });
      const result = await entry.verifyBackupArtifact(f.request, f.deps);
      expect(result).toMatchObject({
        status: "unavailable",
        reason: "cleanup_uncertain",
        activation: "not_attempted",
      });
      expect(attempts).toHaveLength(1);
      expect(await readdir(f.deps.scratchRoot)).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("private-removal-sentinel");
      vi.mocked(fs.rm).mockImplementation(realFs.rm);
      await rm(attempts[0]!, { recursive: true, force: true });
      expect(await readdir(f.deps.scratchRoot)).toEqual([]);
    },
  );
  it.each(["cancelled", "deadline"])(
    "rechecks %s after successful cleanup before returning",
    async (reason) => {
      const f = await fixture();
      await seal(f);
      const abort = new AbortController();
      f.deps.signal = abort.signal;
      let expired = false;
      f.deps.now = () => new Date(expired ? f.request.attempt.deadline : capturedAt);
      vi.mocked(fs.rm).mockImplementation(async (path, options) => {
        await realFs.rm(path, options);
        if (dirname(String(path)) === f.deps.scratchRoot) {
          if (reason === "cancelled") abort.abort(new Error("private-cancel-sentinel"));
          else expired = true;
        }
      });
      expect(await verify(f)).toMatchObject({ status: "unavailable", reason });
    },
  );
  it("keeps a completed real owner integrity refusal distinct from an unfinished check", async () => {
    const f = await fixture();
    const db = new DatabaseSync(f.databasePath);
    try {
      db.exec("delete from tenants");
    } finally {
      db.close();
    }
    f.entries[1] = { name: "db.dump", bytes: await readFile(f.databasePath) };
    await seal(f);
    const result = await verify(f);
    expect(result).toMatchObject({ status: "invalid", reason: "module_integrity" });
    expect(result.modules).toHaveLength(3);
    expect(result.modules[0]).toEqual({
      name: "core",
      semanticsVersion: 1,
      status: "invalid",
      checks: [
        { code: "data", status: "invalid" },
        { code: "secret", status: "passed" },
      ],
    });
  });
  it("a real encrypted vault row with an unavailable key prevents a completed module verdict", async () => {
    const f = await fixture();
    const db = new DatabaseSync(f.databasePath);
    try {
      db.prepare(
        "insert into tenant_credentials (purpose,ciphertext,iv,auth_tag,key_version,updated_at) values (?,?,?,?,?,?)",
      ).run(
        "payments.sumup",
        Buffer.from("private-encrypted-value"),
        Buffer.alloc(12, 1),
        Buffer.alloc(16, 2),
        99,
        capturedAt,
      );
    } finally {
      db.close();
    }
    f.entries[1] = { name: "db.dump", bytes: await readFile(f.databasePath) };
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "unavailable",
      reason: "decryption_unavailable",
      modules: [],
    });
  });
  it.each(["empty", "semantics"])(
    "refuses %s local coverage before reading an archive",
    async (kind) => {
      const f = await fixture();
      await seal(f);
      f.deps.modules =
        kind === "empty" ? [] : modules.map((m) => (m.name === "core" ? { ...m, backup: {} } : m));
      expect(await verify(f)).toMatchObject({
        status: "unsupported",
        reason: kind === "empty" ? "module_missing" : "semantics_missing",
        measuredArchive: null,
        modules: [],
      });
    },
  );
  it("accepts a real target-only owner only after its migrated tables are empty", async () => {
    const f = await fixture();
    await seal(f);
    f.deps.modules = [...modules, ALL_MODULES.find((m) => m.name === "scheduler")!];
    f.request.target = buildBackupVerificationTarget(f.deps);
    const result = await verify(f);
    expect(result.status).toBe("passed");
    expect(result.modules.find((m) => m.name === "scheduler")).toEqual({
      name: "scheduler",
      semanticsVersion: 1,
      status: "passed",
      checks: [{ code: "not_applicable", status: "passed" }],
    });
  });
  it("refuses a target-only owner when real migrations seed its owned table", async () => {
    const f = await fixture();
    await seal(f);
    const scheduler = ALL_MODULES.find((module) => module.name === "scheduler")!;
    f.deps.modules = [...modules, scheduler];
    f.deps.migrationsRoot = join(f.root, "migrations");
    const migrations = migrationOptionsFor(orderedMigrationSets(f.deps.modules), null);
    for (const module of f.deps.modules) {
      const options = migrations.find(
        (option) => option.migrationsTable === module.migrations.table,
      );
      await cp(options!.migrationsFolder, join(f.deps.migrationsRoot, module.name), {
        recursive: true,
      });
    }
    const schedulerRoot = join(f.deps.migrationsRoot, "scheduler");
    const journal = JSON.parse(
      await readFile(join(schedulerRoot, "meta/_journal.json"), "utf8"),
    ) as {
      entries: { tag: string }[];
    };
    await appendFile(
      join(schedulerRoot, journal.entries.at(-1)!.tag + ".sql"),
      `\n--> statement-breakpoint\ninsert into scheduled_runs
        (id, duty, period_from, period_to, state, created_at, updated_at)
        values ('90000000-0000-4000-8000-000000000009', 'verification-fixture',
          '2026-10-20', '2026-10-21', 'pending', '${capturedAt}', '${capturedAt}');`,
    );
    f.request.target = buildBackupVerificationTarget(f.deps);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      modules: [],
    });
  });
  it("a target-only owner cannot claim an empty table its migrations did not create", async () => {
    const f = await fixture();
    await seal(f);
    const scheduler = ALL_MODULES.find((m) => m.name === "scheduler")!;
    const owner = scheduler.backup!.verification!;
    f.deps.modules = [
      ...modules,
      {
        ...scheduler,
        classification: [
          ...scheduler.classification!,
          {
            table: "missing_owned_state",
            class: "state",
            reason: "Deliberately incomplete migration fixture",
          },
        ],
        backup: {
          ...scheduler.backup,
          verification: {
            ...owner,
            data: { ...owner.data, tables: [...owner.data.tables, "missing_owned_state"] },
          },
        },
      },
    ];
    f.request.target = buildBackupVerificationTarget(f.deps);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      modules: [],
    });
  });
  it("authenticates selected-node sealed state before data placement", async () => {
    const f = await fixture();
    const sealed = await encryptArtifactAsync(
      packArchive(
        recoveryEntries.map((e) =>
          e.name === "secrets/tls/server.key"
            ? { ...e, bytes: Buffer.from("malformed-private-sealed-key") }
            : e,
        ),
      ),
      key,
    );
    const db = new DatabaseSync(f.databasePath);
    try {
      db.prepare("insert into node_sealed_state (node_id,sealed,updated_at) values (?,?,?)").run(
        sourceNodeId,
        sealed,
        capturedAt,
      );
    } finally {
      db.close();
    }
    f.entries[1] = { name: "db.dump", bytes: await readFile(f.databasePath) };
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "secret_invalid",
      modules: [],
    });
  });
  it("rejects a placed key layout whose effective key came only from excluded backup.env", async () => {
    const f = await fixture();
    const other = Buffer.alloc(32, 23).toString("base64");
    f.entries.push({
      name: "secrets/backup.env",
      bytes: Buffer.from(`WAITRON_CREDENTIALS_KEY=${other}\n`),
    });
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "target_incompatible",
      modules: [],
    });
  });
  it("SQLite damage cannot become an unexpected successful check", async () => {
    const f = await fixture();
    f.entries[1] = { name: "db.dump", bytes: Buffer.alloc(4096, 7) };
    await seal(f);
    expect(await verify(f)).toMatchObject({
      status: "invalid",
      reason: "sqlite_integrity",
      modules: [],
    });
  });
  it("applies the monotonic 30-second watchdog even with a fixed supplied clock", async () => {
    const f = await fixture();
    await seal(f);
    vi.spyOn(performance, "now").mockReturnValueOnce(1).mockReturnValue(30_002);
    expect(await verify(f)).toMatchObject({
      status: "unavailable",
      reason: "deadline",
      measuredArchive: null,
      modules: [],
    });
  });
  it("an owner cannot read another owner's private archive entry", async () => {
    const f = await fixture();
    await seal(f);
    let exposed = false;
    f.deps.modules = modules.map((m) => {
      if (m.name !== "core") return m;
      const original = m.backup!.verification!;
      return {
        ...m,
        backup: {
          ...m.backup,
          verification: {
            ...original,
            async verifyRestoredData(context) {
              await context.entries.read("secrets/tls/ca.key");
              exposed = true;
              return original.verifyRestoredData(context);
            },
          },
        },
      };
    });
    f.request.target = buildBackupVerificationTarget(f.deps);
    expect(await verify(f)).toMatchObject({
      status: "unsupported",
      reason: "semantics_missing",
      modules: [],
    });
    expect(exposed).toBe(false);
  });
  it("rejects a malformed request before creating scratch or consuming input", async () => {
    const f = await fixture();
    const malformed = { ...f.request, unexpected: "private-request-sentinel" };
    await expect(entry.verifyBackupArtifact(malformed, f.deps)).rejects.toMatchObject({
      name: "BackupVerificationProtocolError",
      message: "Invalid backup verification protocol",
    });
    expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  });
  it("keeps the admitted binding when its caller changes the request during an await", async () => {
    const f = await fixture();
    await seal(f);
    const admitted = structuredClone(f.request);
    const attempt = entry.verifyBackupArtifact(f.request, f.deps);
    f.request.archive.sha256 = "e".repeat(64);
    f.request.attempt.childToken = "replacement-child";
    const result = await attempt;
    expect(result.status).toBe("passed");
    expect(result.requestDigest).toBe(backupVerificationRequestDigest(admitted));
    expect(readBackupVerificationResult(JSON.stringify(result), admitted)).toEqual(result);
    expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  });
  it("unexpected owner failure keeps the attempt unavailable without raw diagnostics", async () => {
    const f = await fixture();
    await seal(f);
    f.deps.modules = modules.map((m) => {
      if (m.name !== "credentials") return m;
      const original = m.backup!.verification!;
      return {
        ...m,
        backup: {
          ...m.backup,
          verification: {
            ...original,
            async verifyRestoredData(context) {
              const checked = await original.verifyRestoredData(context);
              expect(checked.status).toBe("passed");
              throw new Error("private-owner-diagnostic-sentinel");
            },
          },
        },
      };
    });
    const result = await verify(f);
    expect(result).toMatchObject({ status: "unavailable", reason: "unexpected", modules: [] });
    expect(JSON.stringify(result)).not.toContain("private-owner-diagnostic-sentinel");
  });
  it.each(["needs_authority", "unsupported"] as const)(
    "an additional required source check keeps %s after real owner checks",
    async (sourceStatus) => {
      const f = await fixture();
      await seal(f);
      f.deps.modules = modules.map((m) => {
        if (m.name !== "core") return m;
        const original = m.backup!.verification!;
        return {
          ...m,
          backup: {
            ...m.backup,
            verification: {
              ...original,
              data: { ...original.data, checks: [...original.data.checks, "source"] },
              effects: [
                ...original.effects,
                { id: "additional_source_obligation", kind: "data", check: "source" },
              ],
              async verifyRestoredData(context) {
                const checked = await original.verifyRestoredData(context);
                expect(checked.status).toBe("passed");
                return {
                  status: sourceStatus,
                  checks: [...checked.checks, { code: "source", status: sourceStatus }],
                };
              },
            },
          },
        };
      });
      f.request.target = buildBackupVerificationTarget(f.deps);
      const result = await verify(f);
      expect(result.status).toBe(sourceStatus);
      expect(result.reason).toBe(
        sourceStatus === "needs_authority"
          ? "module_data_check_requires_authority"
          : "semantics_missing",
      );
      expect(result.modules).toHaveLength(3);
      expect(result.modules[0]!.checks).toContainEqual({ code: "source", status: sourceStatus });
    },
  );
});
