import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { chmod, lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveEntry } from "./backup-archive.js";
import type { Logger } from "./logger.js";
import { stageSecrets } from "./restore-secrets.js";

vi.mock("node:fs/promises", { spy: true });

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const spy of [fs.rename, fs.open, fs.rm, fs.stat]) vi.mocked(spy).mockReset();
  const real = await vi.importActual<typeof fs>("node:fs/promises");
  for (const dir of tempDirs.splice(0)) await real.rm(dir, { recursive: true, force: true });
});

async function failing<T>(code: string): Promise<T> {
  throw Object.assign(new Error(`injected ${code}`), { code });
}

function entry(name: string, text: string): ArchiveEntry {
  return { name, bytes: new TextEncoder().encode(text) };
}

const OLD = {
  "secrets.env": "old-secrets\n",
  "tls/server.pem": "old-server-key\n",
  "trading.env": "old-trading\n",
} as const;

/** A state folder holding the old secrets, with no `tls/ca.crt`. */
async function seedState(): Promise<string> {
  const stateDir = tempDir("restore-secrets-");
  await mkdir(join(stateDir, "tls"));
  for (const [rel, text] of Object.entries(OLD)) await writeFile(join(stateDir, rel), text);
  return stateDir;
}

/** trading.env deliberately first: publish must still rename it last. */
const ENTRIES = [
  entry("secrets/trading.env", "new-trading\n"),
  entry("secrets/secrets.env", "new-secrets\n"),
  entry("secrets/tls/ca.crt", "new-ca\n"),
  entry("secrets/tls/server.pem", "new-server-key\n"),
];

async function leftovers(stateDir: string): Promise<string[]> {
  const names = (await readdir(stateDir, { recursive: true })).map(String);
  return names.filter((name) => name.endsWith(".incoming") || name.endsWith(".restore-previous"));
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

/** Every rename (`from → to`) and every folder opened to be synced (`sync <folder>`), in order,
 * paths relative to `stateDir`; calls go on to any failure already injected. */
async function renamesAndSyncsDuring(
  stateDir: string,
  run: () => Promise<unknown>,
): Promise<string[]> {
  const real = await vi.importActual<typeof fs>("node:fs/promises");
  const rename = vi.mocked(fs.rename).getMockImplementation() ?? real.rename;
  const open = vi.mocked(fs.open).getMockImplementation() ?? real.open;
  const folders = new Set([stateDir, join(stateDir, "tls")]);
  const events: string[] = [];
  const rel = (path: unknown) => String(path).slice(stateDir.length + 1);
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    events.push(`${rel(from)} → ${rel(to)}`);
    return rename(from, to);
  });
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (folders.has(String(args[0]))) events.push(`sync ${rel(args[0]) || "."}`);
    return open(...args);
  });
  await run();
  return events;
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
    const stateDir = tempDir("restore-secrets-folder-");
    await mkdir(join(stateDir, "tls/server.pem"), { recursive: true });
    await expect(
      stageSecrets({
        entries: [entry("secrets/secrets.env", "s\n"), entry("secrets/tls/server.pem", "k\n")],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "secrets/tls/server.pem" },
    });
    expect(await readdir(stateDir)).toEqual(["tls"]);
  });

  it("refuses a target that is a link to a folder before writing any staged file", async () => {
    const stateDir = tempDir("restore-secrets-folder-link-");
    await mkdir(join(stateDir, "elsewhere"));
    await symlink(join(stateDir, "elsewhere"), join(stateDir, "secrets.env"));
    await expect(
      stageSecrets({
        entries: [entry("secrets/trading.env", "t\n"), entry("secrets/secrets.env", "s\n")],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "secrets/secrets.env" },
    });
    expect((await readdir(stateDir)).sort()).toEqual(["elsewhere", "secrets.env"]);
    expect(await readdir(join(stateDir, "elsewhere"))).toEqual([]);
  });

  it("refuses an entry named like another entry's staged file, so it cannot replace the identity", async () => {
    const stateDir = await seedState();
    const before = (await readdir(stateDir, { recursive: true })).map(String).sort();
    await expect(
      stageSecrets({
        entries: [
          entry("secrets/trading.env", "VALIDATED-IDENTITY\n"),
          entry("secrets/trading.env.incoming", "UNCHECKED\n"),
        ],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "secrets/trading.env.incoming" },
    });
    expect((await readdir(stateDir, { recursive: true })).map(String).sort()).toEqual(before);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(OLD["trading.env"]);
  });

  // `.replaced` is the set-aside identity's name; `.tmp` a staged file's working copy.
  it.each([
    "secrets/trading.env.replaced",
    "secrets/secrets.env.restore-previous",
    "secrets/tls/server.pem.incoming.tmp",
    "secrets/tls/server.pem.tmp",
    "secrets/trading.env.INCOMING",
  ])("refuses %s, a name a restore uses for its own working files", async (name) => {
    const stateDir = await seedState();
    const before = (await readdir(stateDir, { recursive: true })).map(String).sort();
    await expect(
      stageSecrets({ entries: [...ENTRIES, entry(name, "UNCHECKED\n")], stateDir, log: vi.fn() }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path", params: { name } });
    expect((await readdir(stateDir, { recursive: true })).map(String).sort()).toEqual(before);
  });

  it("refuses an entry that escapes the state folder, removing what it had staged", async () => {
    const parent = tempDir("restore-secrets-escape-");
    const stateDir = join(parent, "state");
    await mkdir(stateDir);
    await expect(
      stageSecrets({
        entries: [entry("secrets/secrets.env", "s\n"), entry("secrets/../x", "pwned\n")],
        stateDir,
        log: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "recovery.archive_path_unsafe", params: {} });
    expect(await readdir(stateDir)).toEqual([]);
    expect(await readdir(parent)).toEqual(["state"]);
  });

  it("a write failure while staging removes what it had staged and throws the failure", async () => {
    const stateDir = await seedState();
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    const injected = Object.assign(new Error("injected open failure"), { code: "ENOSPC" });
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === join(stateDir, "tls/server.pem.incoming.tmp")) throw injected;
      return real.open(...args);
    });
    await expect(stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() })).rejects.toBe(injected);
    expect(await leftovers(stateDir)).toEqual([]);
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
  });

  it("throws a stat failure other than a missing target before staging anything", async () => {
    const stateDir = await seedState();
    vi.mocked(fs.stat).mockImplementationOnce(() => failing("EACCES"));
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
    expect(renames.filter(([from]) => from.endsWith(".incoming"))).toHaveLength(ENTRIES.length);
  });

  it.each(["publishes", "fails to publish"])(
    "keeps an unrelated certificate copy when it %s a server.pem",
    async (outcome) => {
      const stateDir = await seedState();
      const boxCopy = join(stateDir, "tls/unrelated-certificate.pem");
      await writeFile(join(stateDir, "tls/server.pem"), "old-server-crt\n");
      await writeFile(boxCopy, "reissue's copy of the certificate before\n");
      const staged = await stageSecrets({
        entries: ENTRIES.map((item) =>
          item.name === "secrets/tls/server.pem" ? entry(item.name, "new-server-crt\n") : item,
        ),
        stateDir,
        log: vi.fn(),
      });
      if (outcome === "publishes") {
        await staged.publish();
        await staged.finish();
      } else {
        const real = await vi.importActual<typeof fs>("node:fs/promises");
        vi.mocked(fs.rename).mockImplementation(async (from, to) => {
          if (String(to) === join(stateDir, "trading.env")) return failing("EIO");
          return real.rename(from, to);
        });
        await expect(staged.publish()).rejects.toMatchObject({ code: "EIO" });
        expect(await readFile(join(stateDir, "tls/server.pem"), "utf8")).toBe("old-server-crt\n");
      }
      expect(await readFile(boxCopy, "utf8")).toBe("reissue's copy of the certificate before\n");
    },
  );

  // Eight rename calls: each target set aside (tls/ca.crt has none to set aside), then placed.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "a publish whose rename %i fails puts back what it renamed and throws the failure",
    async (failing) => {
      const stateDir = await seedState();
      const log = vi.fn<Logger>();
      const staged = await stageSecrets({ entries: ENTRIES, stateDir, log });
      const real = await vi.importActual<typeof fs>("node:fs/promises");
      const injected = Object.assign(new Error("injected rename failure"), { code: "EIO" });
      let count = 0;
      vi.mocked(fs.rename).mockImplementation(async (from, to) => {
        count += 1;
        if (count === failing) throw injected;
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
    },
  );

  it("syncs every other secret's folder before trading.env is renamed, and the state folder after", async () => {
    const stateDir = await seedState();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    expect(await renamesAndSyncsDuring(stateDir, () => staged.publish())).toEqual([
      "secrets.env → secrets.env.restore-previous",
      "secrets.env.incoming → secrets.env",
      "tls/ca.crt → tls/ca.crt.restore-previous",
      "tls/ca.crt.incoming → tls/ca.crt",
      "tls/server.pem → tls/server.pem.restore-previous",
      "tls/server.pem.incoming → tls/server.pem",
      "sync .",
      "sync tls",
      "trading.env → trading.env.restore-previous",
      "trading.env.incoming → trading.env",
      "sync .",
    ]);
  });

  it("a publish whose folder sync fails puts the old secrets back, then syncs the folders", async () => {
    const stateDir = await seedState();
    const log = vi.fn<Logger>();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    const injected = Object.assign(new Error("injected folder sync failure"), { code: "EIO" });
    let failed = false;
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (!failed && String(args[0]) === join(stateDir, "tls")) {
        failed = true;
        throw injected;
      }
      return real.open(...args);
    });
    const events = await renamesAndSyncsDuring(stateDir, async () => {
      await expect(staged.publish()).rejects.toBe(injected);
    });
    for (const [rel, text] of Object.entries(OLD))
      expect(await readFile(join(stateDir, rel), "utf8")).toBe(text);
    await expect(stat(join(stateDir, "tls/ca.crt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await leftovers(stateDir)).toEqual([]);
    expect(
      events.slice(events.lastIndexOf("tls/server.pem.restore-previous → tls/server.pem")),
    ).toEqual([
      "tls/server.pem.restore-previous → tls/server.pem",
      "secrets.env.restore-previous → secrets.env",
      "sync tls",
      "sync .",
    ]);
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
      if (String(from) === join(stateDir, "tls/server.pem.incoming")) throw injected;
      if (String(from) === join(stateDir, "secrets.env.restore-previous"))
        throw Object.assign(new Error("injected put-back failure"), { code: "EACCES" });
      return real.rename(from, to);
    });
    await expect(staged.publish()).rejects.toBe(injected);
    expect(log).toHaveBeenCalledWith("warn", "restore.secrets.put_back_failed", {
      file: "secrets.env",
      errno: "EACCES",
    });
    expect(await readFile(join(stateDir, "secrets.env.restore-previous"), "utf8")).toBe(
      OLD["secrets.env"],
    );
  });

  it("a target that cannot be set aside as previous fails the publish with nothing replaced", async () => {
    const stateDir = await seedState();
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to) === join(stateDir, "tls/server.pem.restore-previous")) return failing("EPERM");
      return real.rename(from, to);
    });
    await expect(staged.publish()).rejects.toMatchObject({ code: "EPERM" });
    await expect(stat(join(stateDir, "tls/ca.crt"))).rejects.toMatchObject({ code: "ENOENT" });
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
    const stateDir = tempDir("restore-secrets-link-");
    await mkdir(join(stateDir, "real-tls"));
    await writeFile(join(stateDir, "real-tls/server.pem"), OLD["tls/server.pem"]);
    await symlink(join(stateDir, "real-tls"), join(stateDir, "tls"));
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    await staged.publish();
    await staged.finish();
    expect((await lstat(join(stateDir, "tls"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(stateDir, "real-tls/server.pem"), "utf8")).toBe("new-server-key\n");
    expect(await readFile(join(stateDir, "real-tls/ca.crt"), "utf8")).toBe("new-ca\n");
    expect(await leftovers(join(stateDir, "real-tls"))).toEqual([]);
  });

  it("stages, publishes and finishes over what a killed restore left, staged files owner-only", async () => {
    const stateDir = await seedState();
    const stale = [
      "secrets.env.incoming",
      "tls/server.pem.incoming.tmp",
      "trading.env.restore-previous",
      "tls/server.pem.restore-previous",
    ];
    for (const rel of stale) {
      await writeFile(join(stateDir, rel), "stale\n");
      await chmod(join(stateDir, rel), 0o644);
    }
    const staged = await stageSecrets({ entries: ENTRIES, stateDir, log: vi.fn() });
    for (const e of ENTRIES) {
      const path = join(stateDir, `${e.name.slice("secrets/".length)}.incoming`);
      expect(await readFile(path)).toEqual(Buffer.from(e.bytes));
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await staged.publish();
    await staged.finish();
    for (const e of ENTRIES)
      expect(await readFile(join(stateDir, e.name.slice("secrets/".length)))).toEqual(
        Buffer.from(e.bytes),
      );
    expect(await leftovers(stateDir)).toEqual([]);
    expect(
      (await readdir(stateDir, { recursive: true })).map(String).filter((n) => n.endsWith(".tmp")),
    ).toEqual([]);
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
