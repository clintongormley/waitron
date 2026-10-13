import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { runOnce } from "./backup-sweep.js";
import { parseBackupArchiveKey } from "./backup-keys.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import { ARCHIVE_MAX_METADATA_BYTES } from "./backup-archive-file.js";
import type { StorageCall } from "./storage-backend.js";
const guard = vi.hoisted(() => ({ forbidden: new Set<string>() }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
      if (guard.forbidden.has(String(path))) throw new Error("bulk backup read");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preserve overload forwarding
      return (actual.readFile as any)(path, ...args);
    },
  };
});
const dirs: string[] = [];
afterEach(async () => {
  guard.forbidden.clear();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sweep-file-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `${rel}-contents`);
  return { root, stateDir, stagingDir: join(root, "staging") };
}
const stamp = new Date("2026-10-06T00:00:00Z");
const call: StorageCall = { signal: new AbortController().signal };
const manifest = {
  manifestVersion: 1 as const,
  createdAt: stamp.toISOString(),
  environment: "preproduction" as const,
  modules: { core: 3 },
};
/** The one archive this tick stored in `dir`; its nonce is random. */
async function storedKey(dir: string): Promise<string> {
  const keys = (await readdir(dir)).filter(
    (k) => parseBackupArchiveKey(k)?.timestamp.getTime() === stamp.getTime(),
  );
  expect(keys).toHaveLength(1);
  return keys[0];
}
function deps(f: Awaited<ReturnType<typeof fixture>>, backends: LocalFsBackend[]) {
  return {
    ...f,
    backends,
    db: {} as Database,
    modules: [],
    environment: "preproduction" as const,
    resolvers: {},
    recoveryKey: "key",
    retain: 3,
    retainDays: 30,
    destinationTimeoutMs: 60_000,
    signal: new AbortController().signal,
    log: vi.fn(),
    now: () => stamp,
    buildManifest: async () => manifest,
    archive: async (path: string) => {
      await writeFile(path, "DATABASE");
      await chmod(path, 0o644);
    },
  };
}
it("streams capture once to independent file destinations and leaves no staging data", async () => {
  const f = await fixture();
  const artifactModes: number[] = [];
  class FileOnly extends LocalFsBackend {
    override async put(): Promise<void> {
      throw new Error("byte backend used");
    }
    override async putFile(name: string, path: string, call: StorageCall) {
      guard.forbidden.add(path);
      artifactModes.push((await stat(path)).mode & 0o777);
      expect((await stat(join(f.stagingDir, "waitron-20261006T000000Z.dump"))).mode & 0o777).toBe(
        0o600,
      );
      await super.putFile(name, path, call);
    }
  }
  const a = new FileOnly("a", join(f.root, "a"));
  const b = new FileOnly("b", join(f.root, "b"));
  guard.forbidden.add(join(f.stagingDir, "waitron-20261006T000000Z.dump"));
  await runOnce(deps(f, [a, b]));
  const key = await storedKey(join(f.root, "a"));
  expect(await storedKey(join(f.root, "b"))).toBe(key);
  const bytes = await a.get(key, call);
  expect(await b.get(key, call)).toEqual(bytes);
  expect(artifactModes).toEqual([0o600, 0o600]);
  const entries = unpackArchive(decryptArtifact(bytes, "key"));
  expect(entries.map((e) => e.name)).toEqual([
    "manifest.json",
    "db.dump",
    ...RECOVERY_FILES.map((rel) => `secrets/${rel}`),
  ]);
  expect(Buffer.from(entries[1].bytes).toString()).toBe("DATABASE");
  expect(await readdir(f.stagingDir)).toEqual([]);
});
it("isolates a failed copy, retains stored success after a prune refusal and cleans ciphertext", async () => {
  const f = await fixture();
  class Failed extends LocalFsBackend {
    override async putFile(): Promise<void> {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    }
  }
  class PruneFailed extends LocalFsBackend {
    override async list(): Promise<never> {
      throw new Error("prune failed");
    }
  }
  const good = new PruneFailed("good", join(f.root, "good"));
  const outcomes = { failed: new Map<string, { at: string }>() };
  const onStored = vi.fn();
  await runOnce({ ...deps(f, [new Failed("bad", join(f.root, "bad")), good]), outcomes, onStored });
  expect(
    unpackArchive(
      decryptArtifact(await good.get(await storedKey(join(f.root, "good")), call), "key"),
    )[1].name,
  ).toBe("db.dump");
  expect(outcomes.failed.has("bad")).toBe(true);
  expect(outcomes.failed.has("good")).toBe(false);
  expect(onStored).toHaveBeenCalledOnce();
  expect(await readdir(f.stagingDir)).toEqual([]);
});
it("refuses excessive metadata before archiving and publishes no destination", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "backup.env"), Buffer.alloc(ARCHIVE_MAX_METADATA_BYTES));
  const backend = new LocalFsBackend("a", join(f.root, "a"));
  const archive = vi.fn();
  await expect(runOnce({ ...deps(f, [backend]), archive })).rejects.toMatchObject({
    code: "backup.archive_invalid",
  });
  expect(archive).not.toHaveBeenCalled();
  expect(await backend.list("waitron-", call)).toEqual([]);
});
it("removes partial ciphertext when a staged database becomes unreadable", async () => {
  const f = await fixture();
  const backend = new LocalFsBackend("a", join(f.root, "a"));
  await expect(
    runOnce({ ...deps(f, [backend]), archive: async (path: string) => mkdir(path) }),
  ).rejects.toBeDefined();
  expect(await backend.list("waitron-", call)).toEqual([]);
  // An invalid injected archive is a directory: the archive seam promises a completed regular file.
  expect((await readdir(f.stagingDir)).filter((name) => name.endsWith(".enc"))).toEqual([]);
});
