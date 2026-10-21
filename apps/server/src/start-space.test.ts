import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { VenueHolder } from "@waitron/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dumpFileName } from "./backup-keys.js";
import {
  CRASH_REPORT_KEEP_MS,
  START_FREE_SPACE_FLOOR,
  freeSpaceAtStart,
  lowestFreeBytes,
  type StartSpaceDeps,
} from "./start-space.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, stat: vi.fn(real.stat) };
});

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let stateDir: string;
let venueDir: string;
let logDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-start-space-"));
  stateDir = join(root, "state");
  venueDir = join(stateDir, "venue");
  logDir = join(stateDir, "logs");
  await mkdir(venueDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
});

afterEach(async () => {
  // Drops a queued one-off rejection a failed case left unused; stat delegates to the real one again.
  vi.mocked(stat).mockReset();
  await rm(root, { recursive: true, force: true });
});

async function touch(path: string, ageMs?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "x");
  if (ageMs !== undefined) {
    const at = new Date(NOW.getTime() - ageMs);
    await utimes(path, at, at);
  }
}

/** Answers per folder, in turn: the n-th call for a folder gets its n-th value, then the last. */
function statfsStub(answers: Record<string, (number | Error)[]>) {
  const calls: Record<string, number> = {};
  return (dir: string) => {
    const list = answers[dir];
    if (list === undefined) return Promise.reject(new Error(`unexpected ${dir}`));
    const index = Math.min(calls[dir] ?? 0, list.length - 1);
    calls[dir] = (calls[dir] ?? 0) + 1;
    const answer = list[index]!;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve({ bavail: answer, frsize: 1 });
  };
}

function deps(over: Partial<StartSpaceDeps> & { free?: number }): {
  deps: StartSpaceDeps;
  log: ReturnType<typeof vi.fn>;
} {
  const log = vi.fn();
  const free = over.free ?? 100;
  return {
    log,
    deps: {
      stateDir,
      venueDir,
      logDir,
      floor: 1000,
      now: () => NOW,
      statfs: statfsStub({ [stateDir]: [free], [venueDir]: [free] }),
      readVenueHolder: () => null,
      log,
      ...over,
    },
  };
}

const rotated = (n: number) => join(logDir, `waitron.log.${n}`);
const staging = () => join(stateDir, "backup-staging", "waitron-20261020T000000Z.dump");

function holder(heartbeatAgeMs: number): VenueHolder {
  return {
    kind: "server",
    pid: 4242,
    host: "box",
    lockedAt: new Date(NOW.getTime() - 60 * DAY_MS).toISOString(),
    heartbeatAt: new Date(NOW.getTime() - heartbeatAgeMs).toISOString(),
  };
}

describe("freeSpaceAtStart", () => {
  it("deletes rotated logs but the newest, week-old crash reports and backup staging below the floor", async () => {
    const kept = [
      join(logDir, "waitron.log"),
      rotated(1),
      join(logDir, "waitron.logs.2"),
      join(logDir, "crash-reports", "holder-frozen-b.json"),
      join(logDir, "crash-reports", "notes.txt"),
      join(stateDir, "recovery.json"),
      join(stateDir, "recovery.lock"),
      join(venueDir, "venue.lock"),
      join(venueDir, "venue.db"),
      join(stateDir, "restore-staging", "x"),
    ];
    const gone = [
      rotated(2),
      rotated(5),
      rotated(12),
      join(logDir, "crash-reports", "holder-frozen-a.json"),
      staging(),
      join(stateDir, "backup-staging", "backup-encrypt-x", "artifact"),
    ];
    for (const path of [...kept, ...gone]) await touch(path);
    await touch(join(logDir, "crash-reports", "holder-frozen-a.json"), 8 * DAY_MS);
    await touch(join(logDir, "crash-reports", "holder-frozen-b.json"), 6 * DAY_MS);
    await touch(join(logDir, "crash-reports", "notes.txt"), 30 * DAY_MS);

    const { deps: d, log } = deps({
      statfs: statfsStub({ [stateDir]: [100, 700], [venueDir]: [100, 900] }),
    });
    const result = await freeSpaceAtStart(d);

    for (const path of gone) expect(existsSync(path), path).toBe(false);
    expect(existsSync(join(stateDir, "backup-staging", "backup-encrypt-x"))).toBe(false);
    for (const path of kept) expect(existsSync(path), path).toBe(true);
    expect(result).toEqual({ freeBytes: 700, belowFloor: true });
    expect(log).toHaveBeenCalledWith("warn", "storage.start_space_low", {
      freeBytesBefore: 100,
      freeBytesAfter: 700,
      deleted: 6,
      floor: 1000,
    });
    expect(log).not.toHaveBeenCalledWith("warn", "storage.start_cleanup_failed", expect.anything());
  });

  it("reports not below the floor when the deletions freed enough", async () => {
    await touch(rotated(2));
    const { deps: d } = deps({
      statfs: statfsStub({ [stateDir]: [100, 1000], [venueDir]: [100, 1000] }),
    });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 1000, belowFloor: false });
  });

  it("deletes nothing when free space is exactly the floor", async () => {
    await touch(rotated(2));
    const { deps: d, log } = deps({ free: 1000 });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 1000, belowFloor: false });
    expect(existsSync(rotated(2))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("deletes when it is one byte under", async () => {
    await touch(rotated(2));
    const { deps: d } = deps({ free: 999 });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 999, belowFloor: true });
    expect(existsSync(rotated(2))).toBe(false);
  });

  it("decides by the folder with less room", async () => {
    await touch(rotated(2));
    const { deps: d } = deps({ statfs: statfsStub({ [stateDir]: [5000], [venueDir]: [10] }) });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 10, belowFloor: true });
    expect(existsSync(rotated(2))).toBe(false);
  });

  it("leaves out a folder that cannot report", async () => {
    await touch(rotated(2));
    const { deps: d } = deps({
      statfs: statfsStub({ [stateDir]: [new Error("ENOSYS")], [venueDir]: [10] }),
    });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 10, belowFloor: true });
    expect(existsSync(rotated(2))).toBe(false);
  });

  it("deletes nothing when no folder can report", async () => {
    await touch(rotated(2));
    const { deps: d, log } = deps({
      statfs: statfsStub({ [stateDir]: [new Error("x")], [venueDir]: [new Error("y")] }),
    });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: null, belowFloor: false });
    expect(existsSync(rotated(2))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps backup staging while a live process holds the venue folder", async () => {
    await touch(staging());
    await touch(rotated(2));
    const { deps: fresh } = deps({ readVenueHolder: () => holder(5_000) });
    await freeSpaceAtStart(fresh);
    expect(existsSync(staging())).toBe(true);
    expect(existsSync(rotated(2))).toBe(false);

    const readVenueHolder = vi.fn(() => holder(60_000));
    const { deps: stale } = deps({ readVenueHolder });
    await freeSpaceAtStart(stale);
    expect(existsSync(staging())).toBe(false);
    expect(readVenueHolder).toHaveBeenCalledWith(venueDir);
  });

  it("deletes backup staging under a fresh holder when this process holds the venue folder", async () => {
    await touch(staging());
    const readVenueHolder = vi.fn(() => holder(5_000));
    const { deps: d } = deps({ venueHeld: true, readVenueHolder });
    await freeSpaceAtStart(d);
    expect(existsSync(staging())).toBe(false);
    expect(readVenueHolder).not.toHaveBeenCalled();
  });

  it("judges the holder at the time it reads it, after a slow clean-up", async () => {
    await touch(staging());
    await touch(join(logDir, "crash-reports", "holder-frozen-a.json"), 8 * DAY_MS);
    // The deletions before the holder is read took a minute; the holder beat 50 ms ago.
    const later = new Date(NOW.getTime() + 60_000);
    const now = vi.fn(() => NOW);
    const readVenueHolder = vi.fn(() => {
      now.mockReturnValue(later);
      return { ...holder(0), heartbeatAt: new Date(later.getTime() - 50).toISOString() };
    });
    const { deps: d } = deps({ now, readVenueHolder });
    await freeSpaceAtStart(d);
    expect(existsSync(staging())).toBe(true);
    expect(existsSync(join(logDir, "crash-reports", "holder-frozen-a.json"))).toBe(false);
  });

  describe("above the floor", () => {
    const encryptFolder = () => join(stateDir, "backup-staging", "backup-encrypt-x");

    it("deletes backup staging, and keeps rotated logs and old crash reports", async () => {
      await touch(staging());
      await touch(join(encryptFolder(), "artifact"));
      await touch(rotated(2));
      await touch(join(logDir, "crash-reports", "holder-frozen-a.json"), 8 * DAY_MS);
      const { deps: d, log } = deps({ free: 5000 });

      expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 5000, belowFloor: false });

      expect(existsSync(staging())).toBe(false);
      expect(existsSync(encryptFolder())).toBe(false);
      expect(existsSync(rotated(2))).toBe(true);
      expect(existsSync(join(logDir, "crash-reports", "holder-frozen-a.json"))).toBe(true);
      expect(log.mock.calls).toEqual([
        ["info", "storage.backup_leftovers_deleted", { deleted: 2 }],
      ]);
    });

    it("keeps backup staging while a live process holds the venue folder", async () => {
      await touch(staging());
      const { deps: d, log } = deps({ free: 5000, readVenueHolder: () => holder(5_000) });
      await freeSpaceAtStart(d);
      expect(existsSync(staging())).toBe(true);
      expect(log).not.toHaveBeenCalled();
    });

    it("deletes backup staging under a fresh holder when this process holds the venue folder", async () => {
      await touch(staging());
      const { deps: d } = deps({
        free: 5000,
        venueHeld: true,
        readVenueHolder: () => holder(5_000),
      });
      await freeSpaceAtStart(d);
      expect(existsSync(staging())).toBe(false);
    });

    it("deletes backup staging when no folder can report free space", async () => {
      await touch(staging());
      await touch(rotated(2));
      const { deps: d, log } = deps({
        statfs: statfsStub({ [stateDir]: [new Error("x")], [venueDir]: [new Error("y")] }),
      });
      expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: null, belowFloor: false });
      expect(existsSync(staging())).toBe(false);
      expect(existsSync(rotated(2))).toBe(true);
      expect(log).toHaveBeenCalledWith("info", "storage.backup_leftovers_deleted", { deleted: 1 });
    });
  });

  it("deletes when told to, whatever the free space", async () => {
    await touch(rotated(2));
    const { deps: d, log } = deps({ free: 5000, force: true });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: 5000, belowFloor: false });
    expect(existsSync(rotated(2))).toBe(false);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_space_low", {
      freeBytesBefore: 5000,
      freeBytesAfter: 5000,
      deleted: 1,
      floor: 1000,
    });
  });

  it("deletes when told to even when no folder can report", async () => {
    await touch(rotated(2));
    const { deps: d, log } = deps({
      force: true,
      statfs: statfsStub({ [stateDir]: [new Error("x")], [venueDir]: [new Error("y")] }),
    });
    expect(await freeSpaceAtStart(d)).toEqual({ freeBytes: null, belowFloor: false });
    expect(existsSync(rotated(2))).toBe(false);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_space_low", {
      freeBytesBefore: null,
      freeBytesAfter: null,
      deleted: 1,
      floor: 1000,
    });
  });

  it("goes on past a deletion that fails, and names only its errno", async () => {
    await touch(join(rotated(3), "inside"));
    await touch(rotated(4));
    const { deps: d, log } = deps({});
    await freeSpaceAtStart(d);
    expect(existsSync(rotated(3))).toBe(true);
    expect(existsSync(rotated(4))).toBe(false);
    const failures = log.mock.calls.filter(([, event]) => event === "storage.start_cleanup_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]![0]).toBe("warn");
    const fields = failures[0]![2] as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(["errno"]);
    expect(fields.errno).toMatch(/^E[A-Z0-9_]+$/);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "storage.start_space_low",
      expect.objectContaining({ deleted: 1 }),
    );
  });

  it("names a null errno for a failure that carries no code", async () => {
    await touch(join(logDir, "crash-reports", "holder-frozen-a.json"), 8 * DAY_MS);
    const failing = Object.assign(new Error("no code"), { code: 42 });
    const { deps: d, log } = deps({});
    vi.mocked(stat).mockRejectedValueOnce(failing);
    await freeSpaceAtStart(d);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_failed", { errno: null });
  });

  it("reports a folder it cannot list", async () => {
    await rm(logDir, { recursive: true });
    await writeFile(logDir, "not a folder");
    const { deps: d, log } = deps({});
    await freeSpaceAtStart(d);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_failed", { errno: "ENOTDIR" });
  });

  it("deletes only the names a backup run makes in backup staging", async () => {
    const stagingDir = join(stateDir, "backup-staging");
    const dump = join(stagingDir, dumpFileName(new Date("2026-10-20T03:04:05Z")));
    await touch(dump);
    await touch(`${dump}.partial`);
    const encrypt = await mkdtemp(join(stagingDir, "backup-encrypt-"));
    await touch(join(encrypt, "artifact"));
    const kept = [
      // A local backup folder or a venue folder an operator set inside staging.
      join(
        stagingDir,
        "retained",
        "waitron-20261019T000000Z-1b4e28ba-2fa1-41d2-883f-0016d3cca427.backup.enc",
      ),
      join(stagingDir, "retained", dumpFileName(NOW)),
      join(stagingDir, "venue", "venue.db"),
      join(stagingDir, "waitron-20261019T000000Z-1b4e28ba-2fa1-41d2-883f-0016d3cca427.backup.enc"),
      join(stagingDir, "notes.txt"),
      join(stagingDir, `${dumpFileName(NOW)}.bak`),
    ];
    for (const path of kept) await touch(path);

    const { deps: d, log } = deps({});
    await freeSpaceAtStart(d);

    for (const path of [dump, `${dump}.partial`, encrypt])
      expect(existsSync(path), path).toBe(false);
    for (const path of kept) expect(existsSync(path), path).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "storage.start_space_low",
      expect.objectContaining({ deleted: 3 }),
    );
  });

  it("leaves alone a staging or crash-report folder that is a symbolic link, and what it points at", async () => {
    const elsewhere = join(root, "elsewhere");
    const dump = dumpFileName(new Date("2026-10-20T00:00:00Z"));
    await touch(join(elsewhere, "staging", dump));
    await touch(join(elsewhere, "crash", "holder-frozen-a.json"), 8 * DAY_MS);
    await symlink(join(elsewhere, "staging"), join(stateDir, "backup-staging"));
    await symlink(join(elsewhere, "crash"), join(logDir, "crash-reports"));
    await touch(rotated(2));

    const { deps: d, log } = deps({});
    await freeSpaceAtStart(d);

    expect(existsSync(join(elsewhere, "staging", dump))).toBe(true);
    expect(existsSync(join(elsewhere, "crash", "holder-frozen-a.json"))).toBe(true);
    expect(existsSync(rotated(2))).toBe(false);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_skipped", {
      folder: "backup-staging",
    });
    expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_skipped", {
      folder: "crash-reports",
    });
    expect(log).not.toHaveBeenCalledWith("warn", "storage.start_cleanup_skipped", {
      folder: "logs",
    });
  });

  it("leaves alone a log folder that is a symbolic link, with the crash reports inside it", async () => {
    const elsewhere = join(root, "elsewhere-logs");
    await touch(join(elsewhere, "waitron.log.2"));
    await touch(join(elsewhere, "crash-reports", "holder-frozen-a.json"), 8 * DAY_MS);
    const linked = join(stateDir, "linked-logs");
    await symlink(elsewhere, linked);

    const { deps: d, log } = deps({ logDir: linked });
    await freeSpaceAtStart(d);

    expect(existsSync(join(elsewhere, "waitron.log.2"))).toBe(true);
    expect(existsSync(join(elsewhere, "crash-reports", "holder-frozen-a.json"))).toBe(true);
    expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_skipped", { folder: "logs" });
    expect(log).toHaveBeenCalledWith(
      "warn",
      "storage.start_space_low",
      expect.objectContaining({ deleted: 0 }),
    );
  });

  it("does nothing to folders that do not exist", async () => {
    await rm(logDir, { recursive: true });
    const { deps: d, log } = deps({});
    await expect(freeSpaceAtStart(d)).resolves.toEqual({ freeBytes: 100, belowFloor: true });
    expect(log).not.toHaveBeenCalledWith("warn", "storage.start_cleanup_failed", expect.anything());
    expect(log).toHaveBeenCalledWith(
      "warn",
      "storage.start_space_low",
      expect.objectContaining({ deleted: 0 }),
    );
  });
});

describe("lowestFreeBytes", () => {
  it("lowestFreeBytes multiplies blocks by fragment size", async () => {
    const statfs = () => Promise.resolve({ bavail: 3, frsize: 4096 });
    expect(await lowestFreeBytes([stateDir], statfs)).toBe(12288);
  });
});

describe("defaults", () => {
  it("uses 256 MiB as the default floor", () => {
    expect(START_FREE_SPACE_FLOOR).toBe(268_435_456);
    expect(CRASH_REPORT_KEEP_MS).toBe(604_800_000);
  });
});
