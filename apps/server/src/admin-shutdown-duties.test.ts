import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKeyRing, writePairLinkTx } from "@waitron/credentials";
import { incidents, withNodeTransaction, withTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { buildNextMembershipDocument, endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, jobOrigin } from "@waitron/shared";
import { WorkforceBackend } from "@waitron/workforce";
import { expect, it, onTestFinished, vi } from "vitest";
import { adminShutdownDuties } from "./admin-shutdown-duties.js";
import type { BackupRuntimeStatus, BackupSupervisor } from "./backup-supervisor.js";
import type { ServerConfig } from "./config.js";
import * as atomic from "./fs-atomic.js";
import { createJobRunner } from "./job-runner.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import type { SpareFollowView } from "./spare-follow.js";
import * as stopAlert from "./stop-alert.js";
import type { StreamHost } from "./stream-host.js";
import { TRADING_BOOT_KEY_ENV } from "./testing/boot-trading-fixture.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ring = loadKeyRing(TRADING_BOOT_KEY_ENV);
const actor = { source: "person", person: "00000000-0000-4000-8000-000000000041" } as const;
const spareNodeId = "00000000-0000-4000-8000-000000000042";
const savedBackups = {
  enabled: true,
  cloud: false,
  destinations: [{ id: "folder" }],
} as unknown as BackupRuntimeStatus;

async function fixture(
  options: {
    readSpare?: () => Promise<SpareFollowView | null>;
    readBoxEnv?: () => Promise<Record<string, string | undefined>>;
    runForShutdown?: BackupSupervisor["runForShutdown"];
    checkShutdownUpload?: StreamHost["checkShutdownUpload"];
    status?: BackupRuntimeStatus;
    workforceEnabled?: boolean;
  } = {},
) {
  const { cfg } = await setupVenue(suite.db);
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-shutdown-duties-"));
  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));
  const log = vi.fn();
  const runner = createJobRunner({ now: () => new Date(), log, subscribe: () => () => {} });
  const wake = vi.spyOn(runner, "wake");
  const runForShutdown = vi.fn(options.runForShutdown ?? (async () => {}));
  const checkShutdownUpload = vi.fn(options.checkShutdownUpload ?? (async () => true));
  const duties = adminShutdownDuties({
    db: suite.db,
    node: suite.node,
    nodeId: cfg.nodeId,
    ring,
    config: { stateDir, migrationsRoot: join(stateDir, "migrations") } as ServerConfig,
    runner,
    backup: {
      current: () => options.status ?? savedBackups,
      runForShutdown,
      runForShutdownDownload: vi.fn(),
    } as unknown as BackupSupervisor,
    host: synchronisedBoxHost(),
    streamHost: {
      checkShutdownUpload,
      checkDirectShutdownUpload: vi.fn(),
    } as unknown as StreamHost,
    readSpare: options.readSpare ?? (async () => null),
    readBoxEnv: options.readBoxEnv ?? (async () => ({})),
    isMain: () => true,
    now: () => new Date(),
    workforceEnabled: options.workforceEnabled ?? false,
    log,
  });
  onTestFinished(() => duties.close());
  const shutdownIncidents = () =>
    suite.db.select({ code: incidents.code, params: incidents.params }).from(incidents);
  return {
    nodeId: cfg.nodeId,
    stateDir,
    log,
    wake,
    runForShutdown,
    checkShutdownUpload,
    duties,
    shutdownIncidents,
  };
}

async function pairWithStreamingSpare(nodeId: string) {
  const spare = generateNodeKeyPair();
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const key = await readNodeIdentityKey(suite.node, ring, nodeId);
  await writeNodeMembership(
    suite.db,
    buildNextMembershipDocument({
      heldDocument: null,
      nodes: [
        { nodeId, contactUrl: "https://main.example", standing: "serving-primary" },
        { nodeId: spareNodeId, contactUrl: "https://spare.example", standing: "serving-secondary" },
      ],
      signerNodeId: nodeId,
      signerPrivateKey: key,
      endorsements: [endorseKey(spareNodeId, spare.publicKey, nodeId, key)],
    }),
  );
  await writePairLink(nodeId, "streaming", spare.publicKey);
}

async function writePairLink(
  nodeId: string,
  state: "pending" | "streaming",
  peerPublicKey = generateNodeKeyPair().publicKey,
) {
  await withNodeTransaction(suite.node, (tx) =>
    writePairLinkTx(tx, ring, nodeId, {
      role: "streams",
      state,
      peerNodeId: spareNodeId,
      peerPublicKey,
      storeUrl: "https://spare.example:7443",
      venueId: "00000000-0000-4000-8000-000000000043",
      accessKeyId: "pair-access",
      secretAccessKey: "pair-secret",
    }),
  );
}

function following(state: SpareFollowView["state"] = "following"): SpareFollowView {
  return {
    peerNodeId: spareNodeId,
    state,
    generation: null,
    appliedTXID: "0000000000000001",
    uploadedTXID: "0000000000000001",
    lagMs: 0,
    lastAppliedAt: null,
    clockAt: null,
  };
}

it("refuses a checked shutdown while the spare's pair link has not started streaming", async () => {
  const { nodeId, duties, runForShutdown } = await fixture();
  await writePairLink(nodeId, "pending");
  expect(await duties.available()).toBe(false);
  await expect(duties.start(actor)).rejects.toMatchObject({ code: "box.shutdown_unavailable" });
  expect(await duties.view()).toEqual({ available: false, phase: "idle" });
  expect(runForShutdown).not.toHaveBeenCalled();
});

it("offers no checked shutdown on a box whose backups Waitron Cloud takes", async () => {
  const { duties } = await fixture({ status: { ...savedBackups, cloud: true } });
  expect(await duties.available()).toBe(false);
  await expect(duties.start(actor)).rejects.toMatchObject({ code: "box.shutdown_unavailable" });
});

it("shows shutdown as unavailable when the box's settings file cannot be read", async () => {
  const unreadable = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const { duties } = await fixture({
    status: { ...savedBackups, enabled: false },
    readBoxEnv: async () => {
      throw unreadable;
    },
  });
  await expect(duties.available()).rejects.toBe(unreadable);
  expect(await duties.view()).toEqual({ available: false, phase: "idle" });
});

async function seedWorkingStaff(nodeId: string) {
  const workforce = new WorkforceBackend();
  await withTransaction(suite.db, async (tx) => {
    const [working] = await seedPersons(tx, [
      { displayName: "Working staff", pinHash: "seed", role: "staff" },
    ]);
    await workforce.clockIn(tx, {
      personId: working!.id,
      nodeId,
      at: "2026-11-25T18:00:00.000Z",
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    });
  });
}

it.each([
  [true, [{ displayName: "Working staff", state: "working" }]],
  [false, []],
])("with the workforce module on: %s, lists the staff still working", async (on, staff) => {
  const { nodeId, duties } = await fixture({ workforceEnabled: on });
  await seedWorkingStaff(nodeId);
  expect(await duties.readStaff()).toEqual(staff);
});

it("pauses without taking the final backup when the paired spare stops following before the check", async () => {
  const spareStates: SpareFollowView["state"][] = ["following", "following"];
  const { nodeId, duties, runForShutdown } = await fixture({
    readSpare: async () => following(spareStates.shift() ?? "unknown"),
  });
  await pairWithStreamingSpare(nodeId);
  expect(await duties.view()).toEqual({ available: true, paired: true, phase: "idle" });
  await duties.start(actor);
  await vi.waitFor(() =>
    expect(duties.status()).toEqual({ phase: "paused", errorCode: "box.shutdown_unavailable" }),
  );
  expect(runForShutdown).not.toHaveBeenCalled();
});

it("pauses when the paired spare cannot confirm it holds the final upload", async () => {
  const { nodeId, stateDir, duties, checkShutdownUpload, shutdownIncidents } = await fixture({
    readSpare: async () => following(),
    checkShutdownUpload: async () => false,
  });
  await pairWithStreamingSpare(nodeId);
  await duties.start(actor);
  await vi.waitFor(() =>
    expect(duties.status()).toEqual({ phase: "paused", errorCode: "box.shutdown_spare_unchecked" }),
  );
  expect(checkShutdownUpload).toHaveBeenCalledWith(spareNodeId, expect.any(AbortSignal));
  await expect(stat(join(stateDir, "admin-shutdown.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await vi.waitFor(async () =>
    expect(await shutdownIncidents()).toEqual([
      { code: "start.shutdown_paused", params: { errorCode: "box.shutdown_spare_unchecked" } },
    ]),
  );
});

it("records no alert for an upload stall that lands after the shutdown was cancelled", async () => {
  let reached!: () => void;
  const checking = new Promise<void>((resolve) => (reached = resolve));
  const { duties, wake, log, shutdownIncidents } = await fixture({
    runForShutdown: async (signal, _migrations, onUploadTimeout) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        reached();
      });
      await onUploadTimeout!(signal);
    },
  });
  await duties.start(actor);
  await checking;
  await duties.cancel();
  expect(duties.status()).toEqual({ phase: "idle" });
  expect(await shutdownIncidents()).toEqual([]);
  expect(wake).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalledWith("warn", "server.shutdown_alert_failed", expect.anything());
});

it("keeps the shutdown paused and logs when its alert cannot be recorded, then alerts on retry", async () => {
  vi.spyOn(stopAlert, "recordShutdownPause").mockRejectedValueOnce(
    new AppError("storage.disk_full", {}),
  );
  const { duties, wake, log, shutdownIncidents } = await fixture({
    runForShutdown: async () => {
      throw new AppError("backup.archive_invalid", { reason: "read_back_mismatch" });
    },
  });
  await duties.start(actor);
  await vi.waitFor(() =>
    expect(duties.status()).toEqual({ phase: "paused", errorCode: "backup.archive_invalid" }),
  );
  expect(log).toHaveBeenCalledWith("warn", "server.shutdown_alert_failed", {
    errorCode: "storage.disk_full",
  });
  expect(await shutdownIncidents()).toEqual([]);
  expect(wake).not.toHaveBeenCalled();
  duties.resolvePaused("retry");
  await vi.waitFor(async () =>
    expect(await shutdownIncidents()).toEqual([
      { code: "start.shutdown_paused", params: { errorCode: "backup.archive_invalid" } },
    ]),
  );
  expect(wake).toHaveBeenCalledWith("box.alert_mail");
});

it("removes a hold mark a failed save left behind when the shutdown is cancelled", async () => {
  const writeDurable = atomic.writeFileDurable;
  vi.spyOn(atomic, "writeFileDurable").mockImplementationOnce(async (...args) => {
    await writeDurable(...args);
    throw Object.assign(new Error("folder sync failed"), { code: "EIO" });
  });
  const { stateDir, duties } = await fixture();
  const mark = join(stateDir, "admin-shutdown.json");
  await duties.start(actor);
  await vi.waitFor(() => expect(duties.status()).toMatchObject({ phase: "paused" }));
  expect((await stat(mark)).isFile()).toBe(true);
  await duties.cancel();
  await expect(stat(mark)).rejects.toMatchObject({ code: "ENOENT" });
  expect(duties.status()).toEqual({ phase: "idle" });
});
