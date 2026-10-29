import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageFile, writeFileAtomic, writeFileDurable } from "./fs-atomic.js";

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

describe("writeFileAtomic", () => {
  it("writes the content at the given mode and leaves no .tmp behind", async () => {
    const d = await newDir();
    const target = join(d, "secret.env");
    await writeFileAtomic(target, "K=v\n", 0o600);
    expect(await readFile(target, "utf8")).toBe("K=v\n");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expect(stat(`${target}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  // A stale `${path}.tmp` must NOT carry its broader permissions onto the target: `writeFile` applies
  // `mode` only when it CREATES the file.
  it("does not inherit a stale tmp's broader permissions (secret-leak guard)", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    // Simulate a crash-leftover tmp with world-readable perms.
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });
    expect((await stat(`${target}.tmp`)).mode & 0o777).toBe(0o644);

    await writeFileAtomic(target, "fresh-secret", 0o600);

    // The freshly-created file is 0600 — NOT the stale 0644.
    expect(await readFile(target, "utf8")).toBe("fresh-secret");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
});

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

  it("does not inherit a stale working copy's broader permissions", async () => {
    const d = await newDir();
    const target = join(d, "record.json");
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });

    await writeFileDurable(target, "fresh", 0o600);

    expect(await readFile(target, "utf8")).toBe("fresh");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
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
});
