import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { REPLACED_RESET_FILE, STATE_LAYOUT } from "@waitron/store";
import type { Logger } from "./logger.js";
import {
  finishReplacedReset,
  readReplacedResetMarker,
  readReplacedResetPhase,
  writeReplacedResetMarker,
} from "./replaced-reset.js";

const { failAt, removals, renameFail, renames, calls } = vi.hoisted(() => ({
  failAt: { index: -1 },
  removals: [] as string[],
  renameFail: { index: -1, code: "EIO" },
  renames: [] as string[],
  calls: { resume: 0, finish: 0 },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const watched =
    <A extends unknown[], R>(fn: (path: string, ...rest: A) => Promise<R>) =>
    async (path: string, ...rest: A): Promise<R> => {
      if (removals.push(String(path)) - 1 === failAt.index)
        throw Object.assign(new Error("power lost"), { code: "EIO" });
      return fn(path, ...rest);
    };
  return {
    ...actual,
    rm: watched(actual.rm),
    unlink: watched(actual.unlink),
    rmdir: watched(actual.rmdir),
  };
});

// The package's own removals do not pass through this file's `node:fs/promises` stand-in.
vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    // Counts every rename the Move begun here makes, its rename test's included.
    beginEnvironmentMove: (roots: Parameters<typeof actual.beginEnvironmentMove>[0]) =>
      actual.beginEnvironmentMove(roots, {
        ...realFs,
        rename: async (from: string, to: string) => {
          if (renames.push(from) - 1 === renameFail.index)
            throw Object.assign(new Error("rename refused"), { code: renameFail.code });
          await realFs.rename(from, to);
        },
      }),
    resumeEnvironmentMove: (roots: Parameters<typeof actual.resumeEnvironmentMove>[0]) => {
      calls.resume += 1;
      return actual.resumeEnvironmentMove(roots);
    },
    finishEnvironmentMove: (stateDir: string) => {
      calls.finish += 1;
      return actual.finishEnvironmentMove(stateDir);
    },
    deleteBackupRoomNote: async (stateDir: string) => {
      if (removals.push(join(stateDir, "backup-room-note.json")) - 1 === failAt.index)
        throw Object.assign(new Error("power lost"), { code: "EIO" });
      return actual.deleteBackupRoomNote(stateDir);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  failAt.index = -1;
  removals.length = 0;
  renameFail.index = -1;
  renameFail.code = "EIO";
  renames.length = 0;
  calls.resume = 0;
  calls.finish = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Survives the wipe: the never-touch list, `scratch/` (emptied by the start) and the lock files. */
const KEPT = [
  "state/logs/start.log",
  "state/recovery.json",
  "state/recovery.lock",
  "state/records/choices/one.json",
  "state/records/set-aside/1-old/venue.db",
  "state/scratch/backup/part",
  "state/spare-space",
  "state/spare-space.released",
  "state/venue/migrations.lock",
  "state/venue/venue.lock",
  "tunnel/staff.sock",
];

/** Kept by the wipe, or written only by a set-aside reset; the fixture holds them separately. */
const NOT_REMOVED = new Set([
  "environment-recovery-move.json",
  "logs",
  "records",
  "recovery.json",
  "recovery.lock",
  REPLACED_RESET_FILE,
  "scratch",
  "spare-space",
  "spare-space.released",
  "tls",
  "venue",
]);

/** Every state entry a plain reset deletes, built from the layout so a new entry is covered. */
const LAYOUT_REMOVED = STATE_LAYOUT.filter(
  (entry) => entry.reset === "deleted" && !NOT_REMOVED.has(entry.name),
).map((entry) =>
  entry.kind === "file"
    ? `state/${entry.name}`
    : entry.kind === "folder"
      ? `state/${entry.name}/retained`
      : `state/${entry.name}${"a".repeat(64)}/venue.db`,
);

const REMOVED = [
  ...LAYOUT_REMOVED,
  "backups/2026-11-01/venue.db",
  "backups/loose-file",
  "state/first-setup-deleting.json",
  "state/flows/tls-repair/step.json",
  "state/pair-copy/placed.json",
  "state/restore-entry-abc/venue.db",
  "state/stream-restore-abc/venue.db",
  "state/venue/.venue.db-litestream/generation",
  "state/venue/first-setup-selection.json",
  "state/venue/first-setup-workspaces/one/venue.db",
  "state/venue/node.db",
  "state/venue/node.db-journal",
  "state/venue/node.db-shm",
  "state/venue/node.db-wal",
  "state/venue/venue.db",
  "state/venue/venue.db-journal",
  "state/venue/venue.db-shm",
  "state/venue/venue.db-wal",
];

const TLS = ["state/tls/ca.crt", "state/tls/ca.key", "state/tls/server.pem"];

async function box(joined: boolean, setAside = false) {
  const root = await mkdtemp(join(tmpdir(), "replaced-reset-"));
  roots.push(root);
  const files = [...KEPT, ...REMOVED, ...TLS, ...(joined ? ["state/tls/joined.json"] : [])];
  for (const file of files) {
    if (file.endsWith("venue.lock")) continue;
    await mkdir(dirname(join(root, file)), { recursive: true });
    const body = file.endsWith("placed.json")
      ? JSON.stringify({ source: "selected-backup", sourceId: "b1" })
      : `${file} body`;
    await writeFile(join(root, file), body);
  }
  const deps = {
    stateDir: join(root, "state"),
    venueDir: join(root, "state", "venue"),
    backupsDir: join(root, "backups"),
    log: vi.fn<Logger>(),
  };
  (await lockVenueDatabase(deps.venueDir)).release();
  await writeReplacedResetMarker(deps.stateDir, { phase: "wiping", setAside });
  return { root, deps };
}

/** Every file and folder under `root`, with each file's bytes. */
async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(root, path)}/`] = "";
        await walk(path);
      } else out[relative(root, path)] = await readFile(path, "utf8");
    }
  }
  await walk(root);
  return out;
}

const files = (snapshot: Record<string, string>) =>
  Object.keys(snapshot)
    .filter((path) => !path.endsWith("/"))
    .sort();

describe("finishReplacedReset without set-aside", () => {
  it("removes exactly the shared list, each database's -journal included, and the marker", async () => {
    const { root, deps } = await box(true);
    const before = await tree(root);

    await expect(finishReplacedReset(deps)).resolves.toBe(true);

    const after = await tree(root);
    expect(files(after)).toEqual([...KEPT].sort());
    for (const path of KEPT) expect(after[path]).toBe(before[path]);
    // A joined box's tls/ goes whole; the backups folder stays, emptied.
    expect(after["state/tls/"]).toBeUndefined();
    expect(after["backups/"]).toBe("");
    expect(await readReplacedResetMarker(deps.stateDir)).toBeNull();
  });

  it("keeps tls/ on a box that never joined another", async () => {
    const { root, deps } = await box(false);

    await finishReplacedReset(deps);

    expect(files(await tree(root))).toEqual([...KEPT, ...TLS].sort());
  });

  it("removes the marker last", async () => {
    const { deps } = await box(true);

    await finishReplacedReset(deps);

    expect(removals.at(-1)).toBe(join(deps.stateDir, REPLACED_RESET_FILE));
    expect(removals.filter((path) => path.endsWith(REPLACED_RESET_FILE))).toHaveLength(1);
  });

  it("finishes at the next start after a stop at any removal, the marker kept until the end", async () => {
    const reference = await box(true);
    removals.length = 0;
    await finishReplacedReset(reference.deps);
    const finished = await tree(reference.root);
    const steps = removals.length;
    // Every removed file goes through a removal of its own or of a folder holding it.
    const removedPaths = removals.map((path) => relative(reference.root, path));
    for (const file of [...REMOVED, ...TLS, "state/tls/joined.json"])
      expect(
        removedPaths.some((path) => file === path || file.startsWith(`${path}/`)),
        file,
      ).toBe(true);

    for (let index = 0; index < steps; index += 1) {
      const { root, deps } = await box(true);
      removals.length = 0;
      failAt.index = index;
      await expect(finishReplacedReset(deps), `stop at removal ${index}`).rejects.toThrow(
        "power lost",
      );
      expect(await readReplacedResetMarker(deps.stateDir)).toEqual({
        phase: "wiping",
        setAside: false,
      });
      failAt.index = -1;
      await expect(finishReplacedReset(deps)).resolves.toBe(true);
      expect(await tree(root), `stop at removal ${index}`).toEqual(finished);
    }
  });

  it("does nothing without a marker, or with one that is not wiping", async () => {
    const { root, deps } = await box(true);
    await rm(join(deps.stateDir, REPLACED_RESET_FILE));
    const before = await tree(root);
    await expect(finishReplacedReset(deps)).resolves.toBe(false);
    await writeReplacedResetMarker(deps.stateDir, { phase: "set_aside_refused", setAside: true });
    await expect(finishReplacedReset(deps)).resolves.toBe(false);
    await rm(join(deps.stateDir, REPLACED_RESET_FILE));
    expect(await tree(root)).toEqual(before);
  });

  it("carries on when the backups folder is not there", async () => {
    const { root, deps } = await box(false);
    await rm(deps.backupsDir, { recursive: true });

    await expect(finishReplacedReset(deps)).resolves.toBe(true);
    expect(files(await tree(root))).toEqual([...KEPT, ...TLS].sort());
  });
});

/** Removed, not set aside: what the Move leaves, which a plain reset deletes all the same. */
const DELETED_BESIDE_MOVE = (file: string) =>
  file.startsWith("backups/") ||
  file === "state/backup-room-note.json" ||
  STATE_LAYOUT.some(
    (entry) =>
      entry.kind === "prefix" &&
      entry.reset === "deleted" &&
      file.startsWith(`state/${entry.name}`),
  );

/** Each file the set-aside reset moves, by where it lands under the set-aside folder. */
function movedBy(joined: boolean): Record<string, string> {
  const moved: Record<string, string> = {};
  for (const file of [
    ...REMOVED,
    "state/scratch/backup/part",
    ...(joined ? [...TLS, "state/tls/joined.json"] : []),
  ])
    if (!DELETED_BESIDE_MOVE(file))
      moved[file] = file.startsWith("state/venue/")
        ? `venue/${file.slice("state/venue/".length)}`
        : `state/${file.slice("state/".length)}`;
  return moved;
}

/** The one set-aside folder this reset made, beside the fixture's earlier `1-old`. */
async function newSetAside(root: string): Promise<string[]> {
  const names = await readdir(join(root, "state/records/set-aside"));
  return names.filter((name) => name !== "1-old");
}

/**
 * The tree with the new set-aside folder's numbered name replaced, so two runs compare. A Move
 * whose record write failed leaves its prepared folders empty under another number; `leftovers`
 * says how many such empty sets are allowed, and they are dropped.
 */
async function settled(root: string, leftovers = 0): Promise<Record<string, string>> {
  const all = await tree(root);
  const holding = (stem: string) =>
    Object.keys(all).filter((path) => path.includes(`/${stem}/`) && !path.endsWith("/"));
  const stems = await newSetAside(root);
  const filled = stems.filter((stem) => holding(stem).length > 0);
  expect(filled.length).toBeLessThanOrEqual(1);
  const empty = stems.filter((stem) => !filled.includes(stem));
  expect(empty).toHaveLength(leftovers);
  const out: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(all)) {
    if (empty.some((stem) => path.includes(`/${stem}/`))) continue;
    out[filled[0] === undefined ? path : path.replace(filled[0], "<stem>")] = bytes;
  }
  return out;
}

describe("finishReplacedReset with set-aside", () => {
  for (const joined of [true, false])
    it(`moves the shared list into one numbered set-aside folder (${joined ? "joined" : "own"} tls/)`, async () => {
      const { root, deps } = await box(joined, true);
      const before = await tree(root);

      await expect(finishReplacedReset(deps)).resolves.toBe(true);

      const after = await tree(root);
      const stems = await newSetAside(root);
      expect(stems).toHaveLength(1);
      const folder = `state/records/set-aside/${stems[0]}`;
      const moved = movedBy(joined);
      const kept = [...KEPT.filter((file) => !(file in moved)), ...(joined ? [] : TLS)];
      expect(files(after)).toEqual(
        [...kept, ...Object.values(moved).map((to) => `${folder}/${to}`)].sort(),
      );
      for (const path of kept) expect(after[path], path).toBe(before[path]);
      for (const [from, to] of Object.entries(moved))
        expect(after[`${folder}/${to}`], from).toBe(before[from]);
      expect(after["backups/"]).toBe("");
      expect(await readReplacedResetMarker(deps.stateDir)).toBeNull();
      expect(after["state/environment-recovery-move.json"]).toBeUndefined();
      expect(deps.log).not.toHaveBeenCalled();
    });

  it("finishes a Move cut after its record through the Move's resume, recovery.json unchanged", async () => {
    const reference = await box(true, true);
    renames.length = 0;
    await finishReplacedReset(reference.deps);
    const finished = await settled(reference.root);
    const steps = renames.length;
    // The first two renames are the rename test's, before the Move record exists.
    expect(renames.slice(0, 2).every((path) => path.includes("set-aside-probe"))).toBe(true);

    for (let index = 2; index < steps; index += 1) {
      const { root, deps } = await box(true, true);
      const recoveryBytes = await readFile(join(deps.stateDir, "recovery.json"));
      renames.length = 0;
      calls.resume = 0;
      calls.finish = 0;
      renameFail.index = index;
      await expect(finishReplacedReset(deps), `stop at rename ${index}`).rejects.toMatchObject({
        code: "setup.environment_move_unfinished",
      });
      expect(await readReplacedResetMarker(deps.stateDir)).toEqual({
        phase: "wiping",
        setAside: true,
      });
      renameFail.index = -1;

      await expect(finishReplacedReset(deps)).resolves.toBe(true);

      expect(calls, `stop at rename ${index}`).toEqual({ resume: 2, finish: 1 });
      expect(await settled(root), `stop at rename ${index}`).toEqual(finished);
      expect(await readFile(join(deps.stateDir, "recovery.json"))).toEqual(recoveryBytes);
    }
  });

  it("finishes at the next start after a stop at any removal, the marker kept until the end", async () => {
    const reference = await box(true, true);
    removals.length = 0;
    await finishReplacedReset(reference.deps);
    const finished = await settled(reference.root);
    const steps = removals.length;
    // Only the Move record's own write removes anything before the Move's first step.
    const firstAfterRecord = removals.findIndex((path) => path.endsWith("backup-room-note.json"));
    expect(firstAfterRecord).toBeGreaterThan(0);

    for (let index = firstAfterRecord; index < steps; index += 1) {
      const { root, deps } = await box(true, true);
      removals.length = 0;
      failAt.index = index;
      await expect(finishReplacedReset(deps), `stop at removal ${index}`).rejects.toThrow();
      expect(await readReplacedResetMarker(deps.stateDir)).toEqual({
        phase: "wiping",
        setAside: true,
      });
      failAt.index = -1;
      await expect(finishReplacedReset(deps)).resolves.toBe(true);
      expect(await settled(root), `stop at removal ${index}`).toEqual(finished);
    }
  });

  it("goes up and finishes at the next start when the Move fails before its record for another reason", async () => {
    const reference = await box(true, true);
    await finishReplacedReset(reference.deps);
    const finished = await settled(reference.root);

    for (const stop of ["first rename", "second rename", "record write"] as const) {
      const { root, deps } = await box(true, true);
      if (stop === "record write") failAt.index = 0;
      else renameFail.index = stop === "first rename" ? 0 : 1;
      removals.length = 0;
      renames.length = 0;

      await expect(finishReplacedReset(deps), stop).rejects.toMatchObject({ code: "EIO" });
      expect(await readReplacedResetMarker(deps.stateDir), stop).toEqual({
        phase: "wiping",
        setAside: true,
      });
      failAt.index = -1;
      renameFail.index = -1;

      await expect(finishReplacedReset(deps), stop).resolves.toBe(true);
      expect(await settled(root, stop === "record write" ? 1 : 0), stop).toEqual(finished);
      expect(deps.log, stop).not.toHaveBeenCalled();
    }
  });

  it("moves nothing and carries on when the rename test is refused, and later starts wipe nothing", async () => {
    const { root, deps } = await box(true, true);
    const before = await tree(root);
    renameFail.code = "EXDEV";
    renameFail.index = 0;

    await expect(finishReplacedReset(deps)).resolves.toBe(false);

    expect(await readReplacedResetMarker(deps.stateDir)).toEqual({
      phase: "set_aside_refused",
      setAside: true,
    });
    const after = await tree(root);
    expect({ ...after, [`state/${REPLACED_RESET_FILE}`]: "" }).toEqual({
      ...before,
      [`state/${REPLACED_RESET_FILE}`]: "",
    });
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("warn", "replaced-reset.set_aside_unavailable", {
      errorCode: "setup.start_again_set_aside_unavailable",
    });

    renameFail.index = -1;
    await expect(finishReplacedReset(deps)).resolves.toBe(false);
    expect(await tree(root)).toEqual(after);
    expect(deps.log).toHaveBeenCalledTimes(1);
  });
});

describe("readReplacedResetPhase", () => {
  it("reads the marker's phase, or null when there is no marker", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "replaced-reset-phase-"));
    try {
      await expect(readReplacedResetPhase(stateDir)).resolves.toBeNull();
      await writeReplacedResetMarker(stateDir, { phase: "set_aside_refused", setAside: true });
      await expect(readReplacedResetPhase(stateDir)).resolves.toBe("set_aside_refused");
      await writeReplacedResetMarker(stateDir, { phase: "wiping", setAside: false });
      await expect(readReplacedResetPhase(stateDir)).resolves.toBe("wiping");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
