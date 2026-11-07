import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveEntry } from "./backup-archive.js";
import type { Logger } from "./logger.js";
import { stageSecrets } from "./restore-secrets.js";

vi.mock("node:fs/promises", { spy: true });

afterEach(() => {
  for (const spy of [fs.rename, fs.open, fs.rm, fs.lstat, fs.link]) vi.mocked(spy).mockReset();
});

async function failing<T>(code: string): Promise<T> {
  throw Object.assign(new Error(`injected ${code}`), { code });
}

function entry(name: string, text: string): ArchiveEntry {
  return { name, bytes: new TextEncoder().encode(text) };
}

const OLD = {
  "secrets.env": "old-secrets\n",
  "tls/server.key": "old-server-key\n",
  "trading.env": "old-trading\n",
} as const;

/** A state folder holding the old secrets, with no `tls/ca.crt`. */
async function seedState(): Promise<string> {
  const stateDir = mkdtempSync(join(tmpdir(), "restore-secrets-"));
  await mkdir(join(stateDir, "tls"));
  for (const [rel, text] of Object.entries(OLD)) await writeFile(join(stateDir, rel), text);
  return stateDir;
}

/** trading.env deliberately first: publish must still rename it last. */
const ENTRIES = [
  entry("secrets/trading.env", "new-trading\n"),
  entry("secrets/secrets.env", "new-secrets\n"),
  entry("secrets/tls/ca.crt", "new-ca\n"),
  entry("secrets/tls/server.key", "new-server-key\n"),
];

async function leftovers(stateDir: string): Promise<string[]> {
  const names = (await readdir(stateDir, { recursive: true })).map(String);
  return names.filter((name) => name.endsWith(".incoming") || name.endsWith(".previous"));
}

async function renamesDuring(run: () => Promise<unknown>): Promise<string[][]> {
  const real = await vi.importActual<typeof fs>("node:fs/promises");
  const renames: string[][] = [];
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    renames.push([String(from), String(to)]);
    return real.rename(from, to);
  });
  await run();
  return renames;
}

describe("stageSecrets", () => {
  it("stages every secrets/ entry beside its target, owner-only, leaving the targets as they were", async () => {
    const stateDir = await seedState();
    await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    for (const e of ENTRIES) {
      const staged = join(stateDir, `${e.name.slice("secrets/".length)}.incoming`);
      expect(await readFile(staged)).toEqual(Buffer.from(e.bytes));
      expect((await stat(staged)).mode & 0o777).toBe(0o600);
    }
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
    await expect(stat(join(stateDir, "tls/ca.crt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a target that exists as a folder before writing any staged file", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "restore-secrets-folder-"));
    await mkdir(join(stateDir, "tls/server.key"), { recursive: true });
    await expect(
      stageSecrets({
        entries: [entry("secrets/secrets.env", "s\n"), entry("secrets/tls/server.key", "k\n")],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "secrets/tls/server.key" },
    });
    expect(await readdir(stateDir)).toEqual(["tls"]);
  });

  it("refuses an entry that escapes the state folder, removing what it had staged", async () => {
    const parent = mkdtempSync(join(tmpdir(), "restore-secrets-escape-"));
    const stateDir = join(parent, "state");
    await mkdir(stateDir);
    await expect(
      stageSecrets({
        entries: [entry("secrets/secrets.env", "s\n"), entry("secrets/../x", "pwned\n")],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
    expect(await readdir(stateDir)).toEqual([]);
    expect(await readdir(parent)).toEqual(["state"]);
  });

  it("a write failure while staging removes what it had staged and throws the failure", async () => {
    const stateDir = await seedState();
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    const injected = Object.assign(new Error("injected open failure"), { code: "ENOSPC" });
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === join(stateDir, "tls/server.key.incoming.tmp")) throw injected;
      return real.open(...args);
    });
    await expect(stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() })).rejects.toBe(injected);
    expect(await leftovers(stateDir)).toEqual([]);
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
  });

  it("throws an lstat failure other than a missing target before staging anything", async () => {
    const stateDir = await seedState();
    vi.mocked(fs.lstat).mockImplementationOnce(() => failing("EACCES"));
    await expect(stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() })).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(await leftovers(stateDir)).toEqual([]);
  });

  it("publishes by renames, trading.env last, and leaves nothing staged or previous after finish", async () => {
    const stateDir = await seedState();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    const renames = await renamesDuring(() => staged.publish());
    await staged.finish();
    for (const e of ENTRIES)
      expect(await readFile(join(stateDir, e.name.slice("secrets/".length)))).toEqual(
        Buffer.from(e.bytes),
      );
    expect(await leftovers(stateDir)).toEqual([]);
    expect(renames.at(-1)).toEqual([
      join(stateDir, "trading.env.incoming"),
      join(stateDir, "trading.env"),
    ]);
    expect(renames).toHaveLength(ENTRIES.length);
  });

  it("a publish whose third rename fails puts back what it renamed and throws the failure", async () => {
    const stateDir = await seedState();
    const log = vi.fn<Logger>();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    const injected = Object.assign(new Error("injected rename failure"), { code: "EIO" });
    let count = 0;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      count += 1;
      if (count === 3) throw injected;
      return real.rename(from, to);
    });
    await expect(staged.publish()).rejects.toBe(injected);
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
    await expect(stat(join(stateDir, "tls/ca.crt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await leftovers(stateDir)).toEqual([]);
    expect(log).not.toHaveBeenCalledWith(
      expect.anything(),
      "restore.secrets.put_back_failed",
      expect.anything(),
    );
  });

  it("a failed rename onto a target that did not exist leaves it absent", async () => {
    const stateDir = await seedState();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to) === join(stateDir, "tls/ca.crt")) return failing("EIO");
      return real.rename(from, to);
    });
    await expect(staged.publish()).rejects.toMatchObject({ code: "EIO" });
    await expect(stat(join(stateDir, "tls/ca.crt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(OLD["secrets.env"]);
    expect(await leftovers(stateDir)).toEqual([]);
  });

  it("logs a put-back that also fails, naming the file", async () => {
    const stateDir = await seedState();
    const log = vi.fn<Logger>();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    const injected = Object.assign(new Error("injected rename failure"), { code: "EIO" });
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to) === join(stateDir, "tls/server.key")) throw injected;
      if (String(from) === join(stateDir, "secrets.env.previous"))
        throw Object.assign(new Error("injected put-back failure"), { code: "EACCES" });
      return real.rename(from, to);
    });
    await expect(staged.publish()).rejects.toBe(injected);
    expect(log).toHaveBeenCalledWith("warn", "restore.secrets.put_back_failed", {
      file: "secrets.env",
      errno: "EACCES",
    });
    expect(await readFile(join(stateDir, "secrets.env.previous"), "utf8")).toBe(OLD["secrets.env"]);
  });

  it("a target that cannot be kept as previous fails the publish with nothing replaced", async () => {
    const stateDir = await seedState();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    vi.mocked(fs.link).mockImplementationOnce(() => failing("EPERM"));
    await expect(staged.publish()).rejects.toMatchObject({ code: "EPERM" });
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
    expect(await leftovers(stateDir)).toEqual([]);
  });

  it("finish and discard log a file they cannot remove, and do not throw", async () => {
    const stateDir = await seedState();
    const log = vi.fn<Logger>();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log });
    vi.mocked(fs.rm).mockImplementation(() => failing("EBUSY"));
    await staged.discard();
    await staged.finish();
    expect(log).toHaveBeenCalledWith("warn", "restore.secrets.incoming_kept", {
      file: "secrets.env",
      errno: "EBUSY",
    });
    expect(log).toHaveBeenCalledWith("warn", "restore.secrets.previous_kept", {
      file: "secrets.env",
      errno: "EBUSY",
    });
  });

  it("stages, publishes and finishes through a tls folder that is a link, keeping the link", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "restore-secrets-link-"));
    await mkdir(join(stateDir, "real-tls"));
    await writeFile(join(stateDir, "real-tls/server.key"), OLD["tls/server.key"]);
    await symlink(join(stateDir, "real-tls"), join(stateDir, "tls"));
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    await staged.publish();
    await staged.finish();
    expect((await lstat(join(stateDir, "tls"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(stateDir, "real-tls/server.key"), "utf8")).toBe("new-server-key\n");
    expect(await readFile(join(stateDir, "real-tls/ca.crt"), "utf8")).toBe("new-ca\n");
    expect(await leftovers(join(stateDir, "real-tls"))).toEqual([]);
  });

  it("discard removes every staged file and nothing else", async () => {
    const stateDir = await seedState();
    const before = (await readdir(stateDir, { recursive: true })).map(String).sort();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    await staged.discard();
    expect((await readdir(stateDir, { recursive: true })).map(String).sort()).toEqual(before);
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
  });
});
