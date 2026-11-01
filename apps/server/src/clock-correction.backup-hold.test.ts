// A backup run while the box sets its own clock, with the real correction and the real run.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Transaction } from "@waitron/db";
import type { ClockStep, ClockStepRecorded, ClockStopState, TrustedReading } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { BackupManifest } from "./backup-manifest.js";
import { backupArchiveKey } from "./backup-keys.js";
import { runOnce } from "./backup-sweep.js";
import type { ClockSetAnswer } from "./box-host-client.js";
import { clockCorrection, latestClockStepFor } from "./clock-correction.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";
import { STUB_NODE } from "./testing/node-copy.js";

const DAY = 86_400_000;
const START_MS = Date.parse("2026-09-05T00:00:00.000Z");
const STEP_MS = 400 * DAY;
const TX = {} as Transaction;

const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: { core: 3 },
};

const STOPPED: ClockStopState = {
  clockAt: "2026-09-05T00:00:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-09-05T01:00:00.000Z",
  lastRecordOffsetMinutes: 60,
  recordId: "record-1",
  gapMs: STEP_MS,
  proof: "contrary",
  agreeing: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
  confirmation: null,
};

class MemoryBackend implements StorageBackend {
  readonly id = "local";
  objects = new Map<string, Buffer>();
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
  }
  async putFile(key: string, path: string) {
    await this.put(key, await readFile(path));
  }
  async getFile(key: string, path: string) {
    await writeFile(path, this.objects.get(key)!);
  }
  async get(key: string) {
    return this.objects.get(key)!;
  }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.keys()]
      .reverse()
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k, size: 0, mtimeMs: 0 }));
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async deleteMany(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }
  close() {}
}

let staging: string;
let stateDir: string;

beforeEach(async () => {
  staging = await mkdtemp(join(tmpdir(), "clock-hold-staging-"));
  stateDir = await mkdtemp(join(tmpdir(), "clock-hold-state-"));
  for (const rel of RECOVERY_FILES) {
    await mkdir(join(stateDir, dirname(rel)), { recursive: true });
    await writeFile(join(stateDir, rel), `${rel}-contents`);
  }
});

afterEach(async () => {
  await rm(staging, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

function box(options: { seatFails?: number } = {}) {
  let wallMs = START_MS;
  const monoMs = 0;
  let recorded: ClockStep | null = null;
  let seatFails = options.seatFails ?? 0;
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let hostCalled!: () => void;
  const moved = new Promise<void>((resolve) => (hostCalled = resolve));

  const correction = clockCorrection({
    host: {
      clockStatus: async () => ({
        available: true,
        service: "on",
        unit: "chrony.service",
        synchronised: false,
        lastSyncAt: null,
      }),
      setClock: async ({ targetMs }): Promise<ClockSetAnswer> => {
        const beforeMs = wallMs;
        wallMs = targetMs;
        hostCalled();
        await answered;
        return { available: true, beforeMs, afterMs: wallMs };
      },
    },
    backend: {
      clockStopState: async () => STOPPED,
      assertRecordableAt: () => {},
      confirmClockStep: async (_tx, input): Promise<ClockStepRecorded> => {
        if (seatFails > 0) {
          seatFails--;
          throw new AppError("storage.disk_full", {});
        }
        recorded = { confirmedAt: input.after.instant.toISOString(), stepMs: input.stepMs };
        return { confirmation: null, corrected: null };
      },
    },
    store: { clear: () => {}, witnesses: () => [] },
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => ({ ms: monoMs, id: "boot-1" }) },
    read: (fn) => fn(TX),
    transaction: (fn) => fn(TX),
    nodeId: "node-1",
    log: vi.fn(),
  });

  const backend = new MemoryBackend();
  const earlier = [
    backupArchiveKey(new Date(START_MS - 2 * DAY)),
    backupArchiveKey(new Date(START_MS - DAY)),
  ];
  for (const key of earlier) backend.objects.set(key, Buffer.from("old"));

  const backup = () =>
    runOnce({
      backends: [backend],
      db: {} as Database,
      node: STUB_NODE,
      modules: ALL_MODULES,
      environment: "preproduction",
      resolvers: {},
      stateDir,
      buildManifest: async () => MANIFEST,
      recoveryKey: "recovery-key-1",
      stagingDir: staging,
      retain: 7,
      retainDays: 7,
      latestClockStep: latestClockStepFor(correction, async () => recorded),
      destinationTimeoutMs: 60_000,
      signal: new AbortController().signal,
      log: vi.fn(),
      now: () => new Date(wallMs),
      archive: async (outFile) => writeFile(outFile, "DUMP-BYTES"),
    });

  const set = () =>
    correction.set({
      reason: "behind_chain",
      source: "authority",
      offsetMs: STEP_MS,
      measuredAt: { wallMs, monoMs },
      stepsSeen: correction.steps(),
      witnesses: [],
      requester: { source: "authority" },
    });

  return {
    correction,
    backup,
    set,
    moved,
    answer,
    survived: () => earlier.map((key) => backend.objects.has(key)),
    recorded: () => recorded,
  };
}

describe("a backup run while the box sets its clock 400 days on", () => {
  it("keeps the earlier archives while the host has moved the clock and not yet answered", async () => {
    const b = box();
    const setting = b.set();
    await b.moved;

    await b.backup();
    expect(b.survived()).toEqual([true, true]);

    b.answer();
    expect(await setting).toMatchObject({ set: true });
  });

  it("keeps them once the step's row is written (the control)", async () => {
    const b = box();
    const setting = b.set();
    await b.moved;
    b.answer();
    await setting;
    expect(b.recorded()).not.toBeNull();

    await b.backup();
    expect(b.survived()).toEqual([true, true]);
  });

  it("keeps them while the step's row waits to be written, and after it is", async () => {
    const b = box({ seatFails: 1 });
    const setting = b.set();
    await b.moved;
    b.answer();
    await setting;
    expect(b.recorded()).toBeNull();

    await b.backup();
    expect(b.survived()).toEqual([true, true]);

    await b.correction.writePending();
    expect(b.recorded()).not.toBeNull();
    await b.backup();
    expect(b.survived()).toEqual([true, true]);
  });
});
