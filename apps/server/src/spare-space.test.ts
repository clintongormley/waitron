import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPARE_SPACE_FILE } from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSpare, topUpSpare } from "./spare-space.js";

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
