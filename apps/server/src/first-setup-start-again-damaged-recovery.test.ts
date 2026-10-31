import { archiveHost, clock, external, key } from "../test/hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { access, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  createFirstSetupBackupWorkspace,
  isEmptiedTombstone,
  readStartAgainMarker,
} from "@waitron/provisioning";
import { recovery } from "../test/first-setup-backup-recovery-fixture.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

const attemptDb = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

/**
 * A fiscal attempt whose recovery-key record is damaged, beside a backup recovery that chose a name
 * and stopped, with the venue database present and empty.
 */
async function damagedBesideStoppedRecovery() {
  const archive = await archiveHost();
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: clock.wall(),
    wallFinishedMs: clock.wall(),
    monotonicStartedMs: clock.monotonic(),
    monotonicFinishedMs: clock.monotonic(),
  }));
  const attempt = await hourFirstFiscalFixture({ database: () => attemptDb.db, clock });
  const roots = { stateDir: attempt.stateDir, venueDir: attempt.venueDir };
  const host = createFirstSetupModuleHost({
    ...roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  const workspace = createFirstSetupBackupWorkspace(roots);
  const service = recovery({
    ...roots,
    environment: "preproduction",
    modules: ALL_MODULES,
    host,
    workspace,
    sources: {
      ...archive.restore,
      bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
    },
    log: () => {},
  });
  const entries = unpackArchive(
    decryptArtifact(archive.restore.artifact, archive.restore.recoveryKey),
  );
  entries.push({
    name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
    bytes: Buffer.from(
      JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
    ),
  });
  await host.resolution.withVenueExclusion(async () => {});
  const inspected = await host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).toBe("missing");
  const session = await service.open(
    {
      observation: {
        inspectionId: inspected.inspectionId,
        revision: inspected.revision,
        ownerGeneration: inspected.ownerGeneration,
      },
      source: {
        kind: "archive",
        artifact: Uint8Array.from(
          encryptArtifact(packArchive(entries), archive.restore.recoveryKey),
        ),
        recoveryKey: archive.restore.recoveryKey,
        environment: "preproduction",
      },
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    { onBox: false },
  );
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
    { onBox: false },
  )) as { status: string; identity: string };
  expect(selected.status).toBe("selected");
  await service.close(session.sessionId);
  await attemptDb.db.archiveTo(join(attempt.venueDir, "venue.db"));
  await writeFile(
    join(attempt.stateDir, "first-fiscal-documents", `${attempt.module}.recovery.json`),
    "{}",
  );
  const before = await host.resolution.inspectFirstSetupResolution();
  await host.owner.recoverFirstSetupOwner({
    inspectionId: before.inspectionId,
    revision: before.revision!,
    ownerGeneration: before.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: attempt.password,
  });
  const current = await host.resolution.inspectFirstSetupResolution();
  expect(current.database).toBe("no-venue-rows");
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...roots, host, backupRecovery: service });
  const shown = await actions.startAgainSummary(ids);
  const register = {
    kind: "current-master" as const,
    status: "Consumed" as const,
    custodian: "Elena",
    reference: attempt.staged.ref.bindingDigest,
    consultedAt: "2026-10-16T12:20:00.000Z",
  };
  return {
    roots,
    workspace,
    session,
    selected,
    shown,
    start: (damagedShown: boolean) =>
      actions.startAgainFirstSetup({
        ...ids,
        register,
        confirmRecoveryDiscard: { shown },
        ...(damagedShown ? { recoveryRecordDamagedShown: true as const } : {}),
      }),
  };
}

it("with the database present, a damaged recovery-key record beside a stopped recovery: the summary shows both, and with both acknowledged Start again discards the recovery", async () => {
  const f = await damagedBesideStoppedRecovery();
  expect(f.shown).toMatchObject({
    recoveryRecordDamaged: true,
    recovery: expect.any(Object),
  });
  const targetLock = join(
    (await f.workspace.readChain()).at(-1)!.target.target.venueDir,
    "venue.lock",
  );
  const lock = await lstat(targetLock);
  await expect(f.start(true)).resolves.toBeUndefined();
  expect((await f.workspace.readChain()).at(-1)).toMatchObject({
    phase: "abandoned",
    target: { recoveryId: f.session.recoveryId },
  });
  expect((await lstat(targetLock)).ino).toBe(lock.ino);
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  const folder = join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR);
  const records = await readdir(folder);
  expect(records).toHaveLength(1);
  expect(JSON.parse(await readFile(join(folder, records[0]!), "utf8"))).toMatchObject({
    database: "present",
    shown: f.shown,
  });
});

it("with the database present, a damaged recovery-key record beside a stopped recovery: without recoveryRecordDamagedShown Start again is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await damagedBesideStoppedRecovery();
  const last = (await f.workspace.readChain()).at(-1)!;
  const attempt = await readFile(join(f.roots.stateDir, "first-setup.json"));
  await expect(f.start(false)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(attempt);
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});
