import { archiveHost, key, node, clock } from "./hour-recovery-host.js";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as filesystem from "node:fs/promises";
import * as restore from "../src/restore.js";
import * as sourceProof from "../src/first-setup-backup-source.js";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "../src/module-operation-host.js";
import { createFirstSetupBackupRecovery } from "../src/first-setup-backup-recovery.js";
import { request as ownerRequest } from "./first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "../src/artifact-cipher.js";
import { packArchive, unpackArchive } from "../src/backup-archive.js";
import { recoverySelectPastWaits } from "../src/testing/hour-test-clock.js";
import { buildBackupVerificationTarget } from "../src/backup-verification-target.js";
import * as runtime from "../src/backup-verification-target.js";

beforeEach(async () => {
  const fs = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.rename).mockImplementation(fs.rename);
  const placement = await vi.importActual<typeof restore>("../src/restore.js");
  vi.mocked(restore.restoreFromArtifact).mockImplementation(placement.restoreFromArtifact);
  const proof = await vi.importActual<typeof sourceProof>("../src/first-setup-backup-source.js");
  vi.mocked(sourceProof.authenticatedFirstSetupBackupPreview).mockImplementation(
    proof.authenticatedFirstSetupBackupPreview,
  );
});

const services: ReturnType<typeof createFirstSetupBackupRecovery>[] = [];

export function recovery(options: Parameters<typeof createFirstSetupBackupRecovery>[0]) {
  const service = createFirstSetupBackupRecovery(options);
  services.push(service);
  return service;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.dispose();
});

export async function fixture(protocol: 1 | 2 = 2) {
  const f = await archiveHost();
  const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
  entries.push({
    name: "secrets/backup.env",
    bytes: Buffer.from("WAITRON_BACKUP_SECRET_ACCESS_KEY=old-source-credential\n"),
  });
  entries.push({
    name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
    bytes: Buffer.from(
      JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
    ),
  });
  const artifact = encryptArtifact(packArchive(entries), f.restore.recoveryKey);
  const target = buildBackupVerificationTarget({
    modules: ALL_MODULES,
    migrationsRoot: null,
    runtime: { release: "2026.10.24", revision: "a".repeat(40), fingerprint: "b".repeat(64) },
  });
  vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(target);
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  await host.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...ownerRequest,
        legalName: "Retained setup company",
        location: {
          ...ownerRequest.location,
          operationDescription: "Restaurant",
          name: "Retained venue",
        },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
  const point = {
    id: pointId,
    venueId: node.locationId,
    capturedAt: new Date().toISOString(),
    modules: JSON.parse(
      Buffer.from(entries.find((entry) => entry.name === "manifest.json")!.bytes).toString(),
    ).modules,
    digest: createHash("sha256").update(artifact).digest("hex"),
    size: artifact.length,
    objectKey: `snapshots/${pointId}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const verification = {
    protocol: "backup-data-restore/v1",
    target,
    policyDigest: target.policyDigest,
    requestDigest: "c".repeat(64),
    archiveSha256: point.digest,
    archiveBytes: point.size,
    pointId,
  };
  const calls: string[] = [];
  const control = {
    beforeDownload: async () => {},
    expired: false,
    refuse: "",
    downloaded: 0,
    archive: artifact,
    rewrite: (_action: string, result: Record<string, unknown>): Record<string, unknown> => result,
  };
  const expiresAt = new Date(clock.wall() + 900_000).toISOString();
  const cloud = {
    origin: "https://cloud.example.test",
    environment: "preproduction" as const,
    ...(protocol === 2 ? { snapshotProtocol: 2 as const, target: () => target } : {}),
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const action = new URL(String(url)).pathname.split("/").at(-1)!;
      calls.push(action);
      if (action === "status" && control.expired) return new Response(null, { status: 410 });
      if (control.refuse === action) return new Response(null, { status: 403 });
      const body = JSON.parse(String(init?.body)) as { payload: string };
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
      const result =
        action === "start" || action === "status"
          ? {
              version: 2,
              requestId,
              state: action === "start" ? "awaiting_owner" : "approved",
              expiresAt,
              operationId: action === "start" ? null : requestId,
            }
          : action === "restored"
            ? { version: 2, status: "restored" }
            : {
                version: 2,
                point,
                verification,
                operationExpiresAt: new Date(clock.wall() + 3_600_000).toISOString(),
                ...(action === "read"
                  ? {
                      location: {
                        endpoint: "https://store.example.test",
                        bucket: "backup",
                        region: "local",
                      },
                      credentials: {
                        accessKeyId: "access",
                        secretAccessKey: "secret",
                        sessionToken: "session",
                      },
                      recoveryKey: f.restore.recoveryKey,
                      expiresAt,
                    }
                  : {}),
              };
      return Response.json(control.rewrite(action, result));
    },
    download: async () => {
      control.downloaded++;
      await control.beforeDownload();
      return control.archive;
    },
  };
  const options = {
    ...f.roots,
    environment: "preproduction" as const,
    modules: ALL_MODULES,
    host,
    workspace,
    sources: {
      ...f.restore,
      bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
    },
    cloud,
    log: () => {},
  };
  const service = recovery(options);
  await service.cloudStart();
  const approved = await service.cloudStatus();
  expect(approved.state).toBe("approved");
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const request = {
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
    source: { kind: "cloud" as const, pointId },
    nodeRecoverySecret: key.secret,
    context: { oldBoxGone: true, soleRecovery: true },
  };
  return {
    ...f,
    artifact,
    original,
    target,
    pointId,
    options,
    workspace,
    service,
    request,
    control,
    calls,
    approved,
  };
}

export async function selectedRepair(protocol: 1 | 2 = 2) {
  const f = await fixture(protocol);
  const session = await f.service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => f.service.prepare(session.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  return { ...f, session, selected, record: (await f.workspace.read()).at(-1)! };
}

export async function interruptedCloudTransfer() {
  const f = await fixture();
  const session = await f.service.open(f.request, { onBox: false });
  const { rename } = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (String(to).endsWith("/cloud/cloud-recovery.json"))
      throw new Error("interrupted Cloud transfer");
    return rename(from, to);
  });
  await expect(
    f.service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const record = (await f.workspace.read()).at(-1)!;
  expect(record.input).toBeNull();
  expect(record.phase).toBe("prepared");
  await f.service.dispose();
  vi.mocked(filesystem.rename).mockImplementation(rename);
  const restarted = recovery(f.options);
  expect((await restarted.cloudStart()).state).toBe("awaiting_owner");
  expect((await restarted.cloudStatus()).state).toBe("approved");
  return { ...f, session, record, restarted };
}
