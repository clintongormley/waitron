import { archiveHost, key, clock } from "./hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";

import { createFirstSetupModuleHost } from "../src/module-operation-host.js";
import { createFirstSetupBackupRecovery } from "../src/first-setup-backup-recovery.js";
import * as sources from "../src/first-setup-backup-source.js";
import * as stateSecrets from "../src/state-secrets.js";
import { request as ownerRequest } from "./first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "../src/artifact-cipher.js";
import { packArchive, unpackArchive, type ArchiveEntry } from "../src/backup-archive.js";
import { recoverySelectPastWaits } from "../src/testing/hour-test-clock.js";

beforeEach(async () => {
  const actual = await vi.importActual<typeof sources>("../src/first-setup-backup-source.js");
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementation(
    actual.openFirstSetupBackupSource,
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

export function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function fixture(readableAttempt = false) {
  const f = await archiveHost();
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  if (readableAttempt) {
    await host.owner.claimFirstSetup(
      {
        environment: "preproduction",
        request: {
          ...ownerRequest,
          legalName: "Retained setup company",
          location: {
            ...ownerRequest.location,
            operationDescription: "Restaurant",
            name: "Retained setup venue",
          },
        },
      },
      randomBytes(32).toString("base64url"),
    );
  } else {
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "unreadable old attempt");
  }
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
    log: () => {},
  };
  await host.resolution.withVenueExclusion(async () => {});
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const request = {
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
    source: {
      kind: "archive" as const,
      artifact: Uint8Array.from(f.restore.artifact),
      recoveryKey: f.restore.recoveryKey,
      environment: "preproduction" as const,
    },
    nodeRecoverySecret: key.secret,
    context: { oldBoxGone: true, soleRecovery: true },
  };
  return { ...f, host, workspace, options, request };
}

export async function selectedRepair(
  editEntries: (entries: ArchiveEntry[]) => Promise<void> = async () => {},
) {
  const f = await fixture(true);
  const entries = unpackArchive(decryptArtifact(f.request.source.artifact, f.restore.recoveryKey));
  await editEntries(entries);
  entries.push({
    name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
    bytes: Buffer.from(
      JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
    ),
  });
  f.request.source.artifact = Uint8Array.from(
    encryptArtifact(packArchive(entries), f.restore.recoveryKey),
  );
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; identity: string; input: unknown };
  expect(selected.status).toBe("selected");
  return { ...f, service, session, selected, record: (await f.workspace.read()).at(-1)! };
}

export async function interruptedRepair(editEntries?: (entries: ArchiveEntry[]) => Promise<void>) {
  const f = await selectedRepair(editEntries);
  vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
    new Error("interrupted secrets"),
  );
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted secrets");
  await f.service.dispose();
  return {
    ...f,
    resumeRequest: {
      observation: f.request.observation,
      recoveryId: f.session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
  };
}
