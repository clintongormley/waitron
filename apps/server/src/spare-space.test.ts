import { execFileSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { lockVenueDatabase } from "@waitron/db";
import {
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
  createFirstSetupBackupWorkspace,
} from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  releaseSpare,
  releaseSpareBeforeStartAgain,
  spareReleased,
  spareRestorer,
  topUpSpare,
} from "./spare-space.js";
import { FULL_DISK_BYTES } from "./boot-failure.js";

let root: string;
let stateDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-spare-space-"));
  stateDir = join(root, "state");
  await mkdir(stateDir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const marker = () => join(stateDir, SPARE_SPACE_RELEASED_FILE);

describe("releaseSpare", () => {
  it("deletes the spare, logs storage.spare_released and answers the bytes it held", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(4096);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_released", { bytes: 4096 }]]);
  });

  it("answers 0 and logs nothing when there is no spare", async () => {
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves a symbolic link at the spare's path, and its target, alone and logs storage.spare_unusable", async () => {
    const outside = join(root, "outside");
    await writeFile(outside, "kept");
    await symlink(outside, join(stateDir, SPARE_SPACE_FILE));
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("kept");
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "link" }]]);
  });

  it("leaves a folder at the spare's path alone and logs storage.spare_unusable", async () => {
    await mkdir(join(stateDir, SPARE_SPACE_FILE));
    await writeFile(join(stateDir, SPARE_SPACE_FILE, "inside"), "kept");
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE, "inside"))).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "folder" }]]);
  });

  it("logs storage.spare_release_failed with the errno when the spare cannot be deleted, and answers 0", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(16, 1));
    const log = vi.fn();
    const refused = Object.assign(new Error("denied"), { code: "EACCES" });
    expect(await releaseSpare(stateDir, log, { unlink: () => Promise.reject(refused) })).toBe(0);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_release_failed", { errno: "EACCES" }]]);
  });

  it("logs a refused delete with no errno as errno null", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(16, 1));
    const log = vi.fn();
    expect(
      await releaseSpare(stateDir, log, { unlink: () => Promise.reject(new Error("x")) }),
    ).toBe(0);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_release_failed", { errno: null }]]);
  });

  it("deletes an empty spare without logging a release", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), "");
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("writes the marker after deleting a spare that held bytes", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    await releaseSpare(stateDir, vi.fn());
    const info = await lstat(marker());
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(0);
  });

  it("writes no marker when there is no spare, an empty spare, or a link or folder at the spare's path", async () => {
    const log = vi.fn();
    await releaseSpare(stateDir, log);
    expect(existsSync(marker())).toBe(false);
    await writeFile(join(stateDir, SPARE_SPACE_FILE), "");
    await releaseSpare(stateDir, log);
    expect(existsSync(marker())).toBe(false);
    await symlink(join(root, "outside"), join(stateDir, SPARE_SPACE_FILE));
    await releaseSpare(stateDir, log);
    expect(existsSync(marker())).toBe(false);
    await rm(join(stateDir, SPARE_SPACE_FILE));
    await mkdir(join(stateDir, SPARE_SPACE_FILE));
    await releaseSpare(stateDir, log);
    expect(existsSync(marker())).toBe(false);
  });

  it("a marker that cannot be written is logged as storage.spare_marker_write_failed with its errno, and the release still answers the bytes", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    const log = vi.fn();
    const full = () => Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" }));
    expect(await releaseSpare(stateDir, log, { open: full })).toBe(4096);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
    expect(existsSync(marker())).toBe(false);
    expect(log.mock.calls).toEqual([
      ["warn", "storage.spare_released", { bytes: 4096 }],
      ["warn", "storage.spare_marker_write_failed", { errno: "ENOSPC" }],
    ]);
  });
  it("never writes the marker through a link", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    const outside = join(root, "outside");
    await writeFile(outside, "kept");
    await symlink(outside, marker());
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(4096);
    expect(await readFile(outside, "utf8")).toBe("kept");
    expect((await lstat(marker())).isSymbolicLink()).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "storage.spare_released", { bytes: 4096 }],
      ["warn", "storage.spare_marker_write_failed", { errno: "EEXIST", kind: "link" }],
    ]);
  });

  it("never truncates a file hard-linked at the marker's path, and counts the link as the marker", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    const outside = join(root, "outside");
    await writeFile(outside, "must survive");
    await link(outside, marker());
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(4096);
    expect(await readFile(outside, "utf8")).toBe("must survive");
    expect((await lstat(marker())).isFile()).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_released", { bytes: 4096 }]]);
  });

  it("does not wait on a FIFO at the marker's path: leaves it and logs storage.spare_marker_write_failed", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    execFileSync("mkfifo", [marker()]);
    const log = vi.fn();
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      releaseSpare(stateDir, log),
      new Promise<"stuck">((settle) => (timer = setTimeout(() => settle("stuck"), 2000))),
    ]);
    clearTimeout(timer);
    if (outcome === "stuck") {
      // Opening a reader lets the blocked writer's open return, so the suite does not hang.
      await (await open(marker(), constants.O_RDONLY | constants.O_NONBLOCK)).close();
    }
    expect(outcome).toBe(4096);
    expect((await lstat(marker())).isFIFO()).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "storage.spare_released", { bytes: 4096 }],
      ["warn", "storage.spare_marker_write_failed", { errno: "EEXIST", kind: "other" }],
    ]);
  });

  it("an existing marker is kept as it is, with only the release logged", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    await writeFile(marker(), "");
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(4096);
    expect((await lstat(marker())).isFile()).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_released", { bytes: 4096 }]]);
  });
});

describe("topUpSpare", () => {
  const spare = () => join(stateDir, SPARE_SPACE_FILE);
  const MiB = 1024 * 1024;

  it("writes random bytes up to the cap", async () => {
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 3 * MiB + 5, log });
    const first = await readFile(spare());
    expect(first.length).toBe(3 * MiB + 5);
    await rm(spare());
    await topUpSpare({ stateDir, bytes: 3 * MiB + 5, log });
    const second = await readFile(spare());
    expect(second.length).toBe(3 * MiB + 5);
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(0, 4096).equals(Buffer.alloc(4096))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("tops a short spare up and leaves a full one alone", async () => {
    const log = vi.fn();
    await writeFile(spare(), Buffer.alloc(1000, 7));
    await topUpSpare({ stateDir, bytes: 4096, log });
    const topped = await readFile(spare());
    expect(topped.length).toBe(4096);
    expect(topped.subarray(0, 1000).equals(Buffer.alloc(1000, 7))).toBe(true);
    const before = (await stat(spare())).mtimeMs;
    await topUpSpare({ stateDir, bytes: 4096, log });
    expect((await readFile(spare())).equals(topped)).toBe(true);
    expect((await stat(spare())).mtimeMs).toBe(before);
    expect(log).not.toHaveBeenCalled();
  });

  it("never writes through a symbolic link", async () => {
    const outside = join(root, "outside");
    await writeFile(outside, "kept");
    await symlink(outside, spare());
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log });
    expect(await readFile(outside, "utf8")).toBe("kept");
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "link" }]]);
  });

  it("a refused write keeps what was written and logs storage.spare_write_failed with its errno", async () => {
    const log = vi.fn();
    let written = 0;
    const refusing: Parameters<typeof topUpSpare>[0]["open"] = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      return {
        stat: () => handle.stat(),
        sync: () => handle.sync(),
        close: () => handle.close(),
        write: async (chunk: Buffer) => {
          if (written >= MiB) throw Object.assign(new Error("no space"), { code: "ENOSPC" });
          written += chunk.length;
          return handle.write(chunk);
        },
      };
    };
    await topUpSpare({ stateDir, bytes: 4 * MiB, log, open: refusing });
    expect((await stat(spare())).size).toBe(MiB);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_write_failed", { errno: "ENOSPC" }]]);
  });

  it("a write that stores part of a chunk is carried on until the spare holds the cap", async () => {
    const log = vi.fn();
    const halving: Parameters<typeof topUpSpare>[0]["open"] = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      return {
        stat: () => handle.stat(),
        sync: () => handle.sync(),
        close: () => handle.close(),
        write: (chunk: Buffer) => handle.write(chunk.subarray(0, Math.ceil(chunk.length / 2))),
      };
    };
    await topUpSpare({ stateDir, bytes: 4 * MiB, log, open: halving });
    expect((await stat(spare())).size).toBe(4 * MiB);
    expect(log).not.toHaveBeenCalled();
  });

  it("asks whether there is room only when the spare is short, and writes nothing when there is not", async () => {
    const log = vi.fn();
    const noRoom = vi.fn(async () => false);
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: noRoom });
    expect(noRoom).toHaveBeenCalledOnce();
    expect(existsSync(spare())).toBe(false);
    await writeFile(spare(), Buffer.alloc(1000, 7));
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: noRoom });
    expect((await stat(spare())).size).toBe(1000);
    const room = vi.fn(async () => true);
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: room });
    expect((await stat(spare())).size).toBe(4096);
    room.mockClear();
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: room });
    expect(room).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("a folder at the spare's path on a disk without room is left unlogged", async () => {
    await mkdir(spare());
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: async () => false });
    expect(log).not.toHaveBeenCalled();
  });

  it("two top-ups running at once leave the spare at most one chunk over the cap", async () => {
    let arrived = 0;
    let bothRead!: () => void;
    const gate = new Promise<void>((resolve) => {
      bothRead = resolve;
    });
    const together: Parameters<typeof topUpSpare>[0]["open"] = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      let first = true;
      return {
        stat: async () => {
          const info = await handle.stat();
          if (first) {
            first = false;
            if (++arrived === 2) bothRead();
            await gate;
          }
          return info;
        },
        write: (chunk: Buffer) => handle.write(chunk),
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    };
    await Promise.all(
      [1, 2].map(() => topUpSpare({ stateDir, bytes: 8 * MiB, log: vi.fn(), open: together })),
    );
    expect((await stat(spare())).size).toBeLessThanOrEqual(9 * MiB);
  });

  it("deletes the marker once the spare is whole, and logs storage.spare_restored", async () => {
    await writeFile(spare(), Buffer.alloc(1000, 7));
    await writeFile(marker(), "");
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log });
    expect((await stat(spare())).size).toBe(4096);
    expect(existsSync(marker())).toBe(false);
    expect(log.mock.calls).toEqual([["info", "storage.spare_restored", { bytes: 4096 }]]);
  });

  it("deletes the marker when the spare is already whole", async () => {
    await writeFile(spare(), Buffer.alloc(4096, 7));
    await writeFile(marker(), "");
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: async () => false });
    expect(existsSync(marker())).toBe(false);
    expect(log.mock.calls).toEqual([["info", "storage.spare_restored", { bytes: 4096 }]]);
  });

  it("keeps the marker when it writes nothing for want of room, and when its write is refused part way", async () => {
    await writeFile(marker(), "");
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: async () => false });
    expect(existsSync(marker())).toBe(true);
    const refusing: Parameters<typeof topUpSpare>[0]["open"] = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      return {
        stat: () => handle.stat(),
        sync: () => handle.sync(),
        close: () => handle.close(),
        write: () => Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" })),
      };
    };
    await topUpSpare({ stateDir, bytes: 4096, log, open: refusing });
    expect(existsSync(marker())).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_write_failed", { errno: "ENOSPC" }]]);
  });

  it("deletes the marker when, with room, the spare's path is a link or a folder, and still logs storage.spare_unusable", async () => {
    await mkdir(spare());
    await writeFile(marker(), "");
    const log = vi.fn();
    await topUpSpare({ stateDir, bytes: 4096, log, hasRoom: async () => false });
    expect(existsSync(marker())).toBe(true);
    await topUpSpare({ stateDir, bytes: 4096, log });
    expect(existsSync(marker())).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "folder" }]]);
    await rm(spare(), { recursive: true });
    await symlink(join(root, "outside"), spare());
    await writeFile(marker(), "");
    await topUpSpare({ stateDir, bytes: 4096, log });
    expect(existsSync(marker())).toBe(false);
  });

  it("a marker that cannot be deleted is logged as storage.spare_marker_delete_failed with its errno, and the spare stays whole", async () => {
    await writeFile(spare(), Buffer.alloc(1000, 7));
    await writeFile(marker(), "");
    const log = vi.fn();
    const refused = Object.assign(new Error("denied"), { code: "EACCES" });
    await topUpSpare({ stateDir, bytes: 4096, log, unlink: () => Promise.reject(refused) });
    expect((await stat(spare())).size).toBe(4096);
    expect(existsSync(marker())).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "storage.spare_marker_delete_failed", { errno: "EACCES" }],
    ]);
  });

  it("writes nothing when the state folder is missing", async () => {
    const missing = join(root, "missing");
    const log = vi.fn();
    await topUpSpare({ stateDir: missing, bytes: 4096, log });
    expect(existsSync(missing)).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_write_failed", { errno: "ENOENT" }]]);
  });
});

describe("spareReleased", () => {
  it("answers whether the marker is a regular file there", async () => {
    const log = vi.fn();
    expect(await spareReleased(stateDir, log)).toBe(false);
    await writeFile(marker(), "");
    expect(await spareReleased(stateDir, log)).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("a folder or a link at the marker's path answers false, and nothing is logged", async () => {
    const log = vi.fn();
    await mkdir(marker());
    expect(await spareReleased(stateDir, log)).toBe(false);
    await rm(marker(), { recursive: true });
    const outside = join(root, "outside");
    await writeFile(outside, "");
    await symlink(outside, marker());
    expect(await spareReleased(stateDir, log)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("a marker that cannot be read answers true and logs storage.spare_marker_unread with its errno", async () => {
    const file = join(root, "a-file");
    await writeFile(file, "");
    const log = vi.fn();
    expect(await spareReleased(file, log)).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_marker_unread", { errno: "ENOTDIR" }]]);
  });
});

describe("spareRestorer", () => {
  const spare = () => join(stateDir, SPARE_SPACE_FILE);
  const venueDir = () => join(root, "venue");
  function restorer(free: (dir: string) => number) {
    const asked: string[] = [];
    const log = vi.fn();
    const restore = spareRestorer({
      stateDir,
      venueDir: venueDir(),
      bytes: 4096,
      log,
      statfs: async (dir) => {
        asked.push(dir);
        return { bavail: free(dir), frsize: 1 };
      },
    });
    return { restore, asked, log };
  }

  it("while no marker exists, writes nothing and reads no free space", async () => {
    const r = restorer(() => 2 ** 40);
    await r.restore();
    expect(existsSync(spare())).toBe(false);
    expect(r.asked).toEqual([]);
  });

  it("with the marker and the spare plus 16 MiB free in both folders, writes the spare and deletes the marker", async () => {
    await writeFile(marker(), "");
    const r = restorer(() => 4096 + FULL_DISK_BYTES);
    await r.restore();
    expect((await stat(spare())).size).toBe(4096);
    expect(existsSync(marker())).toBe(false);
    expect(r.asked).toEqual([stateDir, venueDir()]);
    expect(r.log.mock.calls).toEqual([["info", "storage.spare_restored", { bytes: 4096 }]]);
  });

  it("writes nothing while the venue folder has one byte under the spare plus 16 MiB, whatever the state folder has", async () => {
    await writeFile(marker(), "");
    const r = restorer((dir) => (dir === stateDir ? 2 ** 40 : 4096 + FULL_DISK_BYTES - 1));
    await r.restore();
    expect(existsSync(spare())).toBe(false);
    expect(existsSync(marker())).toBe(true);
  });

  it("two calls at once write the spare once and log storage.spare_restored once", async () => {
    await writeFile(marker(), "");
    const r = restorer(() => 2 ** 40);
    await Promise.all([r.restore(), r.restore()]);
    expect((await stat(spare())).size).toBe(4096);
    expect(r.log.mock.calls).toEqual([["info", "storage.spare_restored", { bytes: 4096 }]]);
    await writeFile(marker(), "");
    await rm(spare());
    await r.restore();
    expect((await stat(spare())).size).toBe(4096);
  });
});

describe("releaseSpareBeforeStartAgain", () => {
  const MiB = 1024 * 1024;
  const ROOT = "/setup-api/first-setup/resolution";
  const roots = () => ({ stateDir, venueDir: join(root, "venue") });
  const spare = () => join(stateDir, SPARE_SPACE_FILE);
  const free = (bytes: number) => async () => ({ bavail: bytes, frsize: 1 });

  // The journal records its folders resolved through links.
  beforeEach(async () => {
    root = await realpath(root);
    stateDir = join(root, "state");
  });

  /** A backup recovery's journal in `roots()`, its records going through `phases` in turn. */
  async function journal(
    phases: ("prepared" | "placement-started" | "restored" | "abandoned" | "emptied")[],
  ) {
    const anchor = roots();
    await mkdir(anchor.venueDir, { recursive: true });
    const id = randomUUID();
    const base = join(stateDir, "first-setup-resolutions", "backup-recovery", id);
    const target = {
      recoveryId: id,
      anchor,
      source: anchor,
      target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
      generation: 1,
    };
    const workspace = createFirstSetupBackupWorkspace(anchor);
    const input = {
      target,
      observation: {
        inspectionId: "a".repeat(64),
        revision: null,
        ownerGeneration: null,
        originalsDigest: await workspace.inspect(id),
      },
      sourceId: "b".repeat(64),
      activationSourceId: "c".repeat(64),
      binding: {
        module: "synthetic",
        action: "restore" as const,
        eventId: randomUUID(),
        sourceId: "c".repeat(64),
        targetNodeId: randomUUID(),
      },
      input: null,
      retainedEvidenceDigest: "d".repeat(64),
      phase: "prepared" as const,
    };
    for (const phase of phases) {
      if (phase === "prepared") await workspace.append(input);
      if (phase === "placement-started") {
        await workspace.append({ ...input, input: { accepted: true }, phase });
        (await lockVenueDatabase(target.target.venueDir)).release();
      }
      if (phase === "restored")
        await workspace.append({ ...input, input: { accepted: true }, phase });
      if (phase === "abandoned") await workspace.abandon(id);
      if (phase === "emptied") {
        const { emptyAbandonedBackupRecovery } = await import("@waitron/provisioning");
        await emptyAbandonedBackupRecovery(anchor, id);
      }
    }
  }

  function app(over: { statfs?: ReturnType<typeof free>; running?: boolean } = {}) {
    const log = vi.fn();
    const a = new Hono();
    a.use(
      "*",
      releaseSpareBeforeStartAgain({
        stateDir,
        roots: roots(),
        statfs: over.statfs ?? free(MiB),
        recovery: { runningInMemory: () => over.running ?? false },
        log,
      }),
    );
    a.all("*", (c) => c.text("ok"));
    return { app: a, log };
  }

  const STEPS = [
    ["GET", ROOT],
    ["POST", `${ROOT}/recover`],
    ["POST", `${ROOT}/start-again/summary`],
    ["POST", `${ROOT}/start-again`],
  ] as const;

  it.each(STEPS)(
    "a stopped recovery on a nearly full disk: %s %s releases the spare",
    async (method, path) => {
      await journal(["prepared", "placement-started"]);
      await writeFile(spare(), Buffer.alloc(4096, 1));
      const { app: a, log } = app();
      expect((await a.request(path, { method })).status).toBe(200);
      expect(existsSync(spare())).toBe(false);
      expect(log).toHaveBeenCalledWith("warn", "storage.spare_released", { bytes: 4096 });
    },
  );

  it.each([
    [["prepared"]],
    [["prepared", "placement-started"]],
    [["prepared", "placement-started", "restored"]],
  ] as const)("a recovery stopped after %j: released", async (phases) => {
    await journal([...phases]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app();
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(false);
  });

  it("a POST under /resolution/backup/ releases nothing", async () => {
    await journal(["prepared"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app();
    expect((await a.request(`${ROOT}/backup/start`, { method: "POST" })).status).toBe(200);
    expect(existsSync(spare())).toBe(true);
  });

  it("a GET of the Start-again path releases nothing", async () => {
    await journal(["prepared"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app();
    expect((await a.request(`${ROOT}/start-again`)).status).toBe(200);
    expect(existsSync(spare())).toBe(true);
  });

  it("a recovery running in this process: nothing is released", async () => {
    await journal(["prepared"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app({ running: true });
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(true);
  });

  it("asks afresh on each request whether a recovery runs: one that stops, as a failed placement does, lets the next request release", async () => {
    await journal(["prepared", "placement-started"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    let running = true;
    const a = new Hono();
    a.use(
      "*",
      releaseSpareBeforeStartAgain({
        stateDir,
        roots: roots(),
        statfs: free(MiB),
        recovery: { runningInMemory: () => running },
        log: vi.fn(),
      }),
    );
    a.all("*", (c) => c.text("ok"));
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(true);
    running = false;
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(false);
  });

  it("16 MiB or more free: nothing is released", async () => {
    await journal(["prepared"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app({ statfs: free(16 * MiB) });
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(true);
  });

  it("no recovery in the journal: nothing is released", async () => {
    await mkdir(roots().venueDir, { recursive: true });
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a, log } = app();
    expect((await a.request(ROOT)).status).toBe(200);
    expect(existsSync(spare())).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("an abandoned recovery not yet emptied: released", async () => {
    await journal(["prepared", "placement-started", "abandoned"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app();
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(false);
  });

  it("an abandoned recovery already emptied: nothing is released", async () => {
    await journal(["prepared", "placement-started", "abandoned", "emptied"]);
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a } = app();
    await a.request(ROOT);
    expect(existsSync(spare())).toBe(true);
  });

  it("a journal that cannot be read is logged and the request is still served", async () => {
    await mkdir(join(stateDir, "first-setup-resolutions", "backup-recovery"), { recursive: true });
    await writeFile(
      join(stateDir, "first-setup-resolutions", "backup-recovery", "selected.json"),
      "{not json",
    );
    await writeFile(spare(), Buffer.alloc(4096, 1));
    const { app: a, log } = app();
    expect((await a.request(ROOT)).status).toBe(200);
    expect(existsSync(spare())).toBe(true);
    expect(log.mock.calls).toEqual([
      [
        "warn",
        "storage.spare_release_skipped",
        { errno: null, errorCode: "setup.attempt_uncertain" },
      ],
    ]);
  });
});
