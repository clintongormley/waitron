import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  failedAtFolderSync,
  mkdirDurable,
  stageFile,
  stageFileDurable,
  writeFileDurable,
} from "./fs-atomic.js";

vi.mock("node:fs/promises", { spy: true });

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const newDir = async () => {
  const d = await mkdtemp(join(tmpdir(), "fs-atomic-"));
  dirs.push(d);
  return d;
};

describe("stageFile", () => {
  it("writes a working copy beside the target at the given mode, leaving the target alone", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    await writeFile(target, "old");
    const staged = await stageFile(target, "new", 0o600);
    expect(staged).toBe(`${target}.tmp`);
    expect(await readFile(staged, "utf8")).toBe("new");
    expect(await readFile(target, "utf8")).toBe("old");
  });

  it("does not inherit a stale working copy's broader permissions", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });
    const staged = await stageFile(target, "fresh-secret", 0o600);
    expect((await stat(staged)).mode & 0o777).toBe(0o600);
  });
});

/** Each sync of an opened file or folder and each rename, in order, while `run` runs. */
async function syncsAndRenames(run: () => Promise<void>): Promise<string[]> {
  const events: string[] = [];
  const real = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await real.open(...args);
    const realSync = handle.sync.bind(handle);
    handle.sync = async () => {
      events.push(`sync ${String(args[0])}`);
      return realSync();
    };
    return handle;
  });
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    events.push(`rename ${String(from)} ${String(to)}`);
    return real.rename(from, to);
  });
  try {
    await run();
  } finally {
    vi.mocked(fs.open).mockReset();
    vi.mocked(fs.rename).mockReset();
  }
  return events;
}

describe("writeFileDurable", () => {
  it("syncs the working copy before renaming it onto the target, then syncs the folder", async () => {
    const d = await newDir();
    const target = join(d, "record.json");

    const events = await syncsAndRenames(() => writeFileDurable(target, "{}", 0o600));

    expect(events).toEqual([`sync ${target}.tmp`, `rename ${target}.tmp ${target}`, `sync ${d}`]);
    expect(await readFile(target, "utf8")).toBe("{}");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("syncs the real folder when the target's folder is a link to one", async () => {
    const d = await fs.realpath(await newDir());
    const real = join(d, "real-tls");
    await fs.mkdir(real);
    await fs.symlink(real, join(d, "tls"));
    const target = join(d, "tls", "server.key");

    const events = await syncsAndRenames(() => writeFileDurable(target, "key", 0o600));

    expect(events.at(-1)).toBe(`sync ${real}`);
    expect(await readFile(join(real, "server.key"), "utf8")).toBe("key");
  });

  it("does not inherit a stale working copy's broader permissions", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });

    await writeFileDurable(target, "fresh", 0o600);

    expect(await readFile(target, "utf8")).toBe("fresh");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("removes the working copy and throws the rename's error when the rename fails", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    await writeFile(target, "old");
    vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error("no"), { code: "EXDEV" }));
    await expect(writeFileDurable(target, "{}", 0o600)).rejects.toMatchObject({ code: "EXDEV" });
    expect(await readFile(target, "utf8")).toBe("old");
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws when the folder cannot be synced after the rename, leaving the file in place", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === d) throw Object.assign(new Error("no"), { code: "EIO" });
      return real.open(...args);
    });
    try {
      await expect(writeFileDurable(target, "{}", 0o600)).rejects.toMatchObject({ code: "EIO" });
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(await readFile(target, "utf8")).toBe("{}");
  });

  it("marks a folder-sync failure as one, and a failure before the rename as not", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === d) throw Object.assign(new Error("no"), { code: "EIO" });
      return real.open(...args);
    });
    let afterRename: unknown;
    try {
      await writeFileDurable(target, "{}", 0o600).catch((error: unknown) => (afterRename = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(failedAtFolderSync(afterRename)).toBe(true);

    const blocked = join(d, "blocked.json");
    await fs.mkdir(`${blocked}.tmp`);
    await fs.writeFile(join(`${blocked}.tmp`, "occupied"), "");
    const beforeRename = await writeFileDurable(blocked, "{}", 0o600).catch(
      (error: unknown) => error,
    );
    expect(beforeRename).toBeInstanceOf(Error);
    expect(failedAtFolderSync(beforeRename)).toBe(false);
  });

  it("marks a failure to resolve a linked folder after the rename as a folder-sync failure", async () => {
    const d = await newDir();
    await fs.mkdir(join(d, "real-tls"));
    await fs.symlink(join(d, "real-tls"), join(d, "tls"));
    const target = join(d, "tls", "record.json");
    const resolveError = Object.assign(new Error("no"), { code: "EIO" });
    vi.mocked(fs.realpath).mockRejectedValueOnce(resolveError);
    let thrown: unknown;
    try {
      await writeFileDurable(target, "{}", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.realpath).mockReset();
    }
    expect(thrown).toBe(resolveError);
    expect(failedAtFolderSync(thrown)).toBe(true);
    expect(await readFile(target, "utf8")).toBe("{}");
  });

  it("removes the working copy when its sync fails and throws the sync's error", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    const syncError = Object.assign(new Error("sync"), { code: "EIO" });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      handle.sync = async () => {
        throw syncError;
      };
      return handle;
    });
    let thrown: unknown;
    try {
      await writeFileDurable(target, "{}", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(thrown).toBe(syncError);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws the write's error, not the close's, when both fail", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    const writeError = Object.assign(new Error("write"), { code: "ENOSPC" });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      const realClose = handle.close.bind(handle);
      handle.writeFile = async () => {
        throw writeError;
      };
      handle.close = async () => {
        await realClose();
        throw Object.assign(new Error("close"), { code: "EBADF" });
      };
      return handle;
    });
    let thrown: unknown;
    try {
      await writeFileDurable(target, "{}", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(thrown).toBe(writeError);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws the close's error when only the close fails", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    const closeError = Object.assign(new Error("close"), { code: "EIO" });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      const realClose = handle.close.bind(handle);
      handle.close = async () => {
        await realClose();
        throw closeError;
      };
      return handle;
    });
    let thrown: unknown;
    try {
      await writeFileDurable(target, "{}", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(thrown).toBe(closeError);
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("stageFileDurable", () => {
  it("syncs a working copy beside the target at the given mode, leaving the target alone", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    await writeFile(target, "old");
    let staged = "";

    const events = await syncsAndRenames(async () => {
      staged = await stageFileDurable(target, "new", 0o600);
    });

    expect(staged).toBe(`${target}.tmp`);
    expect(events).toEqual([`sync ${target}.tmp`]);
    expect(await readFile(staged, "utf8")).toBe("new");
    expect((await stat(staged)).mode & 0o777).toBe(0o600);
    expect(await readFile(target, "utf8")).toBe("old");
  });

  it("does not inherit a stale working copy's broader permissions", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });
    const staged = await stageFileDurable(target, "fresh-secret", 0o600);
    expect(await readFile(staged, "utf8")).toBe("fresh-secret");
    expect((await stat(staged)).mode & 0o777).toBe(0o600);
  });

  it("removes the working copy and throws the sync's error when the sync fails", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    await writeFile(target, "old");
    const syncError = Object.assign(new Error("sync"), { code: "EIO" });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      handle.sync = async () => {
        throw syncError;
      };
      return handle;
    });
    let thrown: unknown;
    try {
      await stageFileDurable(target, "new", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(thrown).toBe(syncError);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(target, "utf8")).toBe("old");
  });

  it("removes the working copy and throws the close's error when only the close fails", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    const closeError = Object.assign(new Error("close"), { code: "EIO" });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      const realClose = handle.close.bind(handle);
      handle.close = async () => {
        await realClose();
        throw closeError;
      };
      return handle;
    });
    let thrown: unknown;
    try {
      await stageFileDurable(target, "new", 0o600).catch((error: unknown) => (thrown = error));
    } finally {
      vi.mocked(fs.open).mockReset();
    }
    expect(thrown).toBe(closeError);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("mkdirDurable", () => {
  it("creates the missing folders at the mode and syncs the folder above each, top down", async () => {
    const d = await newDir();
    const deepest = join(d, "a", "b");

    const events = await syncsAndRenames(() => mkdirDurable(deepest, 0o700));

    expect(events).toEqual([`sync ${d}`, `sync ${join(d, "a")}`]);
    expect((await stat(join(d, "a"))).mode & 0o777).toBe(0o700);
    expect((await stat(deepest)).mode & 0o777).toBe(0o700);
  });

  it("syncs nothing when the folder already exists", async () => {
    const d = await newDir();

    expect(await syncsAndRenames(() => mkdirDurable(d, 0o700))).toEqual([]);
  });

  it("syncs the real folder when the folder above a new one is a link to it", async () => {
    const d = await fs.realpath(await newDir());
    const real = join(d, "real-state");
    await fs.mkdir(real);
    await fs.symlink(real, join(d, "state"));

    const events = await syncsAndRenames(() => mkdirDurable(join(d, "state", "tls"), 0o700));

    expect(events).toEqual([`sync ${real}`]);
    expect((await stat(join(real, "tls"))).isDirectory()).toBe(true);
  });
});
