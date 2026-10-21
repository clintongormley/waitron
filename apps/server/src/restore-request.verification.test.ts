import { createHash, generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locations, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { ALL_MODULES } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { decryptArtifact, encryptArtifactAsync } from "./artifact-cipher.js";
import {
  backupVerificationTargetDigests,
  type BackupVerificationTarget,
} from "./backup-verification-protocol.js";
import * as targetRuntime from "./backup-verification-target.js";
import type { SnapshotRecoveryVerification } from "./cloud-recovery-v2.js";
import {
  runStagedRestore,
  stageRestoreRequest,
  type ArchiveRestoreRequest,
} from "./restore-request.js";
import { restoreFromArtifactFile, type RestoreFileDeps } from "./restore.js";

vi.mock("./backup-verification-target.js", { spy: true });
const unavailable = "Cloud recovery is unavailable. Try again.";
const requestId = "10000000-0000-4000-8000-000000000001";
const pointId = "20000000-0000-4000-8000-000000000002";
const nodeId = "30000000-0000-4000-8000-000000000003";
const locationId = "40000000-0000-4000-8000-000000000004";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function target(revision = "a".repeat(40)): BackupVerificationTarget {
  const input = {
    runtime: { release: "test", revision, fingerprint: "b".repeat(64) },
    modules: [
      {
        name: "core",
        packageVersion: "0.0.0",
        requires: {},
        schema: 1,
        migrationTable: "__drizzle_migrations_db",
        migrationDigest: "c".repeat(64),
        semanticsVersion: 1,
        policyDigest: "d".repeat(64),
      },
    ],
  };
  return { version: 1, ...input, ...backupVerificationTargetDigests(input) };
}
async function fixture(artifact: Uint8Array = Buffer.from("archive")) {
  const root = await mkdtemp(join(tmpdir(), "waitron-qualified-restore-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(join(stateDir, "trading.env"), "old identity");
  await writeFile(join(stateDir, "secrets.env"), "old secrets");
  await writeFile(join(venueDir, "venue.db"), "old database");
  const running = vi
    .spyOn(targetRuntime, "currentBackupVerificationTarget")
    .mockReturnValue(target());
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const verification: SnapshotRecoveryVerification = {
    protocol: "backup-data-restore/v1",
    target: target(),
    policyDigest: target().policyDigest,
    requestDigest: "e".repeat(64),
    archiveSha256: createHash("sha256").update(artifact).digest("hex"),
    archiveBytes: artifact.length,
    pointId,
  };
  const saved = {
    version: 2,
    protocol: "backup-data-restore/v1",
    origin: "https://cloud.example.test",
    environment: "preproduction",
    requestId,
    code: "12345678",
    publicKey,
    privateKey: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    target: target(),
    pointId,
    snapshotVerification: verification,
  };
  const save = () =>
    writeFile(join(stateDir, "cloud-recovery.json"), JSON.stringify(saved), { mode: 0o600 });
  await save();
  const request: ArchiveRestoreRequest & { snapshotVerification: SnapshotRecoveryVerification } = {
    artifact,
    recoveryKey: "test-key",
    environment: "preproduction",
    managedCloud: { requestId, pointId },
    snapshotVerification: verification,
  };
  const deps = { stateDir, venueDir, migrationsRoot: null, log: () => {} };
  const evidence = async () => ({
    database: await readFile(join(venueDir, "venue.db"), "utf8"),
    identity: await readFile(join(stateDir, "trading.env"), "utf8"),
    secrets: await readFile(join(stateDir, "secrets.env"), "utf8"),
  });
  const marker = () => readFile(join(stateDir, "restore-request.json"), "utf8");
  return {
    root,
    stateDir,
    venueDir,
    running,
    publicKey,
    verification,
    saved,
    save,
    request,
    deps,
    evidence,
    marker,
  };
}

it("binary change after approval prevents staging without touching existing files", async () => {
  const f = await fixture();
  const before = await f.evidence();
  f.running.mockReturnValue(target("f".repeat(40)));
  await expect(stageRestoreRequest(f.stateDir, f.request)).rejects.toThrow(unavailable);
  expect(await f.evidence()).toEqual(before);
  expect(await readdir(f.stateDir)).toEqual(
    expect.not.arrayContaining(["restore-request.json", "restore-request.artifact"]),
  );
});

it("target is rechecked after asynchronous staging validation", async () => {
  const f = await fixture();
  await expect(
    stageRestoreRequest(f.stateDir, f.request, async () => {
      f.running.mockReturnValue(target("f".repeat(40)));
    }),
  ).rejects.toThrow(unavailable);
  await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
});
it("qualified staging refuses a non-Cloud environment before writing payloads", async () => {
  const f = await fixture();
  await expect(
    stageRestoreRequest(f.stateDir, { ...f.request, environment: "production" }),
  ).rejects.toThrow(unavailable);
  await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
});
it("qualified staging with unavailable local build identity refuses with the fixed response", async () => {
  const f = await fixture();
  f.running.mockImplementation(() => {
    throw new Error("private runtime failure");
  });
  await expect(stageRestoreRequest(f.stateDir, f.request)).rejects.toThrow(unavailable);
  await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
});
it("an ordinary stream restore remains independent of a saved v2 snapshot approval", async () => {
  const f = await fixture();
  const databasePath = join(f.root, "stream.db");
  await writeFile(databasePath, "stream database");
  await stageRestoreRequest(f.stateDir, {
    kind: "stream",
    databasePath,
    entries: [],
    environment: "preproduction",
  });
  const stream = vi.fn(async () => {});
  expect(await runStagedRestore(f.deps, undefined, stream)).toBe(true);
  expect(stream).toHaveBeenCalledOnce();
});

it.each(["loose-permissions", "damaged-identity"])(
  "ordinary archive staging and restart ignore a recognised v1 Cloud cache with %s",
  async (fault) => {
    const f = await fixture();
    const legacy = { ...f.saved, version: 1 } as Record<string, unknown>;
    delete legacy.protocol;
    delete legacy.target;
    delete legacy.snapshotVerification;
    if (fault === "damaged-identity") legacy.privateKey = "damaged-cache-key";
    const cache = join(f.stateDir, "cloud-recovery.json");
    await writeFile(cache, JSON.stringify(legacy));
    if (fault === "loose-permissions") await chmod(cache, 0o644);
    const before = await f.evidence();
    await stageRestoreRequest(f.stateDir, {
      artifact: f.request.artifact,
      recoveryKey: f.request.recoveryKey,
      environment: "preproduction",
    });
    expect(JSON.parse(await f.marker()).version).toBe(1);
    const restore = vi.fn<(deps: RestoreFileDeps) => Promise<void>>(async () => {});
    expect(await runStagedRestore(f.deps, restore)).toBe(true);
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0]![0]).toMatchObject({ environment: "preproduction" });
    expect(await f.evidence()).toEqual(before);
    expect(await readFile(cache, "utf8")).toBe(JSON.stringify(legacy));
  },
);

it.each([
  '{"version":2,"version":1}',
  '{"version":1,"protocol":"backup-data-restore/v1"}',
  '{"version":3}',
  "{broken",
])("ordinary archives refuse ambiguous or downgraded Cloud state %s", async (raw) => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "cloud-recovery.json"), raw);
  await expect(
    stageRestoreRequest(f.stateDir, {
      artifact: f.request.artifact,
      recoveryKey: f.request.recoveryKey,
      environment: "preproduction",
    }),
  ).rejects.toThrow(unavailable);
  await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
});

it("matching v2 stages the complete descriptor and fresh request key", async () => {
  const f = await fixture();
  await stageRestoreRequest(f.stateDir, f.request);
  expect(JSON.parse(await f.marker())).toEqual({
    version: 2,
    environment: "preproduction",
    managedCloud: { requestId, pointId },
    snapshotVerification: f.verification,
    snapshotRequestKey: f.publicKey,
  });
});

it("binary change after staging prevents placement or marker mutation", async () => {
  const f = await fixture();
  await stageRestoreRequest(f.stateDir, f.request);
  const marker = await f.marker();
  const before = await f.evidence();
  f.running.mockReturnValue(target("f".repeat(40)));
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(f.deps, restore)).rejects.toThrow(unavailable);
  expect(restore).not.toHaveBeenCalled();
  expect(await f.marker()).toBe(marker);
  expect(await f.evidence()).toEqual(before);
});

it.each([
  "descriptor",
  "managed",
  "key",
  "v1",
  "v1-fields",
  "point",
  "request",
  "request-digest",
  "new-key",
  "saved",
  "saved-verification",
])("stripped or changed binding cannot downgrade a saved v2 operation: %s", async (fault) => {
  const f = await fixture();
  await stageRestoreRequest(f.stateDir, f.request);
  const marker = JSON.parse(await f.marker()) as Record<string, unknown>;
  if (fault === "descriptor") delete marker.snapshotVerification;
  if (fault === "managed") delete marker.managedCloud;
  if (fault === "key") delete marker.snapshotRequestKey;
  if (fault === "v1" || fault === "v1-fields") marker.version = 1;
  if (fault === "v1-fields") {
    delete marker.snapshotVerification;
    delete marker.snapshotRequestKey;
  }
  if (fault === "point") marker.managedCloud = { requestId, pointId: nodeId };
  if (fault === "request") marker.managedCloud = { requestId: nodeId, pointId };
  if (fault === "request-digest")
    marker.snapshotVerification = { ...f.verification, requestDigest: "0".repeat(64) };
  if (fault === "new-key") {
    const pair = generateKeyPairSync("ed25519");
    f.saved.publicKey = pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url");
    f.saved.privateKey = pair.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url");
    await f.save();
  }
  if (fault === "saved") await rm(join(f.stateDir, "cloud-recovery.json"));
  if (fault === "saved-verification") {
    await writeFile(
      join(f.stateDir, "cloud-recovery.json"),
      JSON.stringify({ ...f.saved, snapshotVerification: undefined }),
    );
  }
  const raw = JSON.stringify(marker);
  await writeFile(join(f.stateDir, "restore-request.json"), raw);
  const before = await f.evidence();
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(f.deps, restore)).rejects.toThrow(unavailable);
  expect(restore).not.toHaveBeenCalled();
  expect(await f.marker()).toBe(raw);
  expect(await f.evidence()).toEqual(before);
});

it.each(["hash", "size", "point", "request", "missing-descriptor", "stream"])(
  "staging refuses mismatched qualified input before replacing prior request: %s",
  async (fault) => {
    const f = await fixture();
    await writeFile(join(f.stateDir, "restore-request.json"), "prior marker");
    if (fault === "hash") f.request.artifact = Buffer.from("changed");
    if (fault === "size") f.request.snapshotVerification = { ...f.verification, archiveBytes: 8 };
    if (fault === "point") f.request.managedCloud = { requestId, pointId: nodeId };
    if (fault === "request") f.request.managedCloud = { requestId: nodeId, pointId };
    const input =
      fault === "missing-descriptor"
        ? { ...f.request, snapshotVerification: undefined }
        : fault === "stream"
          ? {
              ...f.request,
              kind: "stream" as const,
              entries: [],
              databasePath: join(f.root, "absent.db"),
            }
          : f.request;
    await expect(stageRestoreRequest(f.stateDir, input)).rejects.toThrow(unavailable);
    expect(await f.marker()).toBe("prior marker");
  },
);

it("matching restart carries the full binding into the real restore boundary", async () => {
  const f = await fixture();
  await stageRestoreRequest(f.stateDir, f.request);
  const restore = vi.fn(async () => {});
  expect(await runStagedRestore(f.deps, restore)).toBe(true);
  expect(restore).toHaveBeenCalledWith(
    expect.objectContaining({
      managedCloud: { requestId, pointId },
      snapshotVerification: f.verification,
    }),
  );
});

it.each([
  "unknown",
  "nested-unknown",
  "duplicate",
  "malformed",
  "stream",
  "started",
  "changed-artifact",
])(
  "strict v2 restart refuses malformed or substituted state without mutation: %s",
  async (fault) => {
    const f = await fixture();
    await stageRestoreRequest(f.stateDir, f.request);
    const marker = JSON.parse(await f.marker()) as Record<string, unknown>;
    if (fault === "unknown") marker.extra = true;
    if (fault === "nested-unknown") marker.managedCloud = { requestId, pointId, extra: true };
    if (fault === "stream") marker.kind = "stream";
    if (fault === "started") {
      marker.placementStarted = true;
      marker.nodeRecoveryKey = false;
    }
    let raw = JSON.stringify(marker);
    if (fault === "duplicate") raw = raw.replace('"version":2', '"version":1,"version":2');
    if (fault === "malformed") raw = "{";
    if (fault === "changed-artifact")
      await writeFile(join(f.stateDir, "restore-request.artifact"), "changed");
    await writeFile(join(f.stateDir, "restore-request.json"), raw);
    const restore = vi.fn(async () => {});
    const before = await f.evidence();
    await expect(runStagedRestore(f.deps, restore)).rejects.toThrow(unavailable);
    expect(restore).not.toHaveBeenCalled();
    expect(await f.marker()).toBe(raw);
    expect(await f.evidence()).toEqual(before);
  },
);

it("target mismatch keeps the node credential and never sets placementStarted", async () => {
  const f = await fixture();
  await stageRestoreRequest(f.stateDir, {
    ...f.request,
    recoveryOperation: {
      binding: {
        module: "fiscal-verifactu",
        action: "restore",
        eventId: "event-test",
        sourceId: f.verification.archiveSha256,
        targetNodeId: nodeId,
      },
      input: {},
    },
    nodeRecoverySecret: "disposable node key",
  });
  const marker = await f.marker();
  f.running.mockReturnValue(target("f".repeat(40)));
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(f.deps, restore)).rejects.toThrow(unavailable);
  expect(await f.marker()).toBe(marker);
  expect(JSON.parse(await f.marker())).not.toHaveProperty("placementStarted");
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
    "disposable node key",
  );
  expect(restore).not.toHaveBeenCalled();
});

describe("comparison immediately before real archive placement", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null),
  });
  async function realFixture() {
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Test venue" });
    await suite.db.insert(locations).values({
      id: locationId,
      name: "Test room",
      invoiceLocales: ["en"],
      operationDescription: "Meal",
    });
    await suite.db.insert(nodes).values({ id: nodeId, locationId, name: "Test node" });
    const sourceDir = await mkdtemp(join(tmpdir(), "qualified-source-"));
    roots.push(sourceDir);
    const archivePath = join(sourceDir, "snapshot.db");
    await suite.db.archiveTo(archivePath);
    const manifest = await buildManifest({
      db: suite.db,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    const bytes = await encryptArtifactAsync(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.dump", bytes: await readFile(archivePath) },
        {
          name: "secrets/trading.env",
          bytes: Buffer.from(
            `WAITRON_TILL_NODE_ID=${nodeId}\nWAITRON_TILL_LOCATION_ID=${locationId}\nWAITRON_ENV=preproduction\n`,
          ),
        },
      ]),
      "test-key",
    );
    const f = await fixture(bytes);
    const artifactPath = join(f.root, "archive.enc");
    await writeFile(artifactPath, bytes);
    const deps: RestoreFileDeps & { snapshotVerification: SnapshotRecoveryVerification } = {
      ...f.deps,
      artifactPath,
      recoveryKey: "test-key",
      environment: "preproduction",
      modules: ALL_MODULES,
      stagingDir: join(f.root, "validation"),
      snapshotVerification: f.verification,
      snapshotRequestKey: f.publicKey,
      managedCloud: { requestId, pointId },
    };
    return { ...f, restoreDeps: deps };
  }
  it("binary change during validation prevents actual placement and preserves destination evidence", async () => {
    const f = await realFixture();
    const before = await f.evidence();
    const lockVenue = vi.fn(async () => {
      throw new Error("placement was reached");
    });
    await expect(
      restoreFromArtifactFile({
        ...f.restoreDeps,
        lockVenue,
        checkSourceLive: async () => {
          f.running.mockReturnValue(target("f".repeat(40)));
        },
      }),
    ).rejects.toThrow(unavailable);
    expect(lockVenue).not.toHaveBeenCalled();
    expect(await f.evidence()).toEqual(before);
  });
  it("matching v2 still requires ordinary fiscal authority before destination mutation", async () => {
    const f = await realFixture();
    const before = await f.evidence();
    const operation = createRecoveryRestoreRunner(
      ALL_MODULES,
      {
        binding: {
          module: "fiscal-verifactu",
          action: "restore",
          eventId: "event-test",
          sourceId: f.verification.archiveSha256,
          targetNodeId: nodeId,
        },
        input: {},
      },
      "invalid node recovery key",
    );
    await expect(
      restoreFromArtifactFile({ ...f.restoreDeps, withModuleOperations: operation }),
    ).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    expect(await f.evidence()).toEqual(before);
  });
  it("a local archive with an unusable v1 cache reaches the unchanged fiscal authority gate", async () => {
    const f = await realFixture();
    await writeFile(
      join(f.stateDir, "cloud-recovery.json"),
      '{"version":1,"privateKey":"damaged-cache"}',
    );
    await chmod(join(f.stateDir, "cloud-recovery.json"), 0o644);
    const before = await f.evidence();
    const operation = createRecoveryRestoreRunner(
      ALL_MODULES,
      {
        binding: {
          module: "fiscal-verifactu",
          action: "restore",
          eventId: "event-test",
          sourceId: f.verification.archiveSha256,
          targetNodeId: nodeId,
        },
        input: {},
      },
      "invalid node recovery key",
    );
    await expect(
      restoreFromArtifactFile({
        ...f.restoreDeps,
        managedCloud: undefined,
        snapshotVerification: undefined,
        snapshotRequestKey: undefined,
        withModuleOperations: operation,
      }),
    ).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    expect(await f.evidence()).toEqual(before);
  });
  it("a changed fresh request key during validation prevents actual placement", async () => {
    const f = await realFixture();
    const before = await f.evidence();
    const lockVenue = vi.fn(async () => {
      throw new Error("placement was reached");
    });
    await expect(
      restoreFromArtifactFile({
        ...f.restoreDeps,
        lockVenue,
        checkSourceLive: async () => {
          const pair = generateKeyPairSync("ed25519");
          f.saved.publicKey = pair.publicKey
            .export({ format: "der", type: "spki" })
            .toString("base64url");
          f.saved.privateKey = pair.privateKey
            .export({ format: "der", type: "pkcs8" })
            .toString("base64url");
          await f.save();
        },
      }),
    ).rejects.toThrow(unavailable);
    expect(lockVenue).not.toHaveBeenCalled();
    expect(await f.evidence()).toEqual(before);
  });
  it("a late target refusal restores the pending marker and keeps its node key for retry", async () => {
    const f = await realFixture();
    await stageRestoreRequest(f.stateDir, {
      ...f.request,
      recoveryOperation: {
        binding: {
          module: "fiscal-verifactu",
          action: "restore",
          eventId: "event-test",
          sourceId: f.verification.archiveSha256,
          targetNodeId: nodeId,
        },
        input: {},
      },
      nodeRecoverySecret: "disposable node key",
    });
    const marker = await f.marker();
    const before = await f.evidence();
    await expect(
      runStagedRestore(f.deps, (deps) =>
        restoreFromArtifactFile({
          ...deps,
          checkSourceLive: async () => {
            f.running.mockReturnValue(target("f".repeat(40)));
          },
        }),
      ),
    ).rejects.toThrow(unavailable);
    expect(await f.marker()).toBe(marker);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
      "disposable node key",
    );
    expect(await f.evidence()).toEqual(before);
  });
  it.each(["hash", "size"])(
    "real validation checks measured archive binding again: %s",
    async (fault) => {
      const f = await realFixture();
      if (fault === "hash")
        await writeFile(
          f.restoreDeps.artifactPath,
          await encryptArtifactAsync(decryptArtifact(f.request.artifact, "test-key"), "test-key"),
        );
      else {
        f.verification.archiveBytes++;
        await f.save();
      }
      const lockVenue = vi.fn(async () => {
        throw new Error("placement was reached");
      });
      const before = await f.evidence();
      await expect(restoreFromArtifactFile({ ...f.restoreDeps, lockVenue })).rejects.toThrow(
        unavailable,
      );
      expect(lockVenue).not.toHaveBeenCalled();
      expect(await f.evidence()).toEqual(before);
    },
  );
});
