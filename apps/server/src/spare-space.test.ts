import { existsSync } from "node:fs";
import {
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
import { SPARE_SPACE_FILE, createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSpare, releaseSpareBeforeStartAgain, topUpSpare } from "./spare-space.js";

let root: string;
let stateDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-spare-space-"));
  stateDir = join(root, "state");
  await mkdir(stateDir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

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

  it("writes nothing when the state folder is missing", async () => {
    const missing = join(root, "missing");
    const log = vi.fn();
    await topUpSpare({ stateDir: missing, bytes: 4096, log });
    expect(existsSync(missing)).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_write_failed", { errno: "ENOENT" }]]);
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
  async function journal(phases: ("prepared" | "placement-started" | "abandoned" | "emptied")[]) {
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
    expect(log).toHaveBeenCalledWith("warn", "storage.spare_release_skipped", expect.anything());
  });
});
