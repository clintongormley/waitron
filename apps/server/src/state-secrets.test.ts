import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { chmod, mkdir, writeFile, readFile, stat, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { RECOVERY_FILES, collectStateSecrets, unpackBundleToDir } from "./state-secrets.js";

vi.mock("node:fs/promises", { spy: true });

/** Each sync of an opened file or folder, each rename and each `mkdir` that created a folder, in
 * order, while `run` runs. */
async function syncsAndRenames(run: () => Promise<unknown>): Promise<string[]> {
  const events: string[] = [];
  const real = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.mkdir).mockImplementation((async (path, options) => {
    const created = await real.mkdir(path, options);
    if (created !== undefined) events.push(`mkdir ${String(path)}`);
    return created;
  }) as typeof fs.mkdir);
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
    vi.mocked(fs.mkdir).mockReset();
    vi.mocked(fs.open).mockReset();
    vi.mocked(fs.rename).mockReset();
  }
  return events;
}

/** Materialise a state dir holding every RECOVERY_FILES path with recognisable contents. */
async function seedStateDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "state-secrets-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) {
    await writeFile(join(dir, rel), `contents-of-${rel}\n`, { mode: 0o600 });
  }
  return dir;
}

describe("state-secrets", () => {
  it("gathers exactly the RECOVERY_FILES set, keyed by relative posix path", async () => {
    const dir = await seedStateDir();
    const files = await collectStateSecrets(dir);
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES].sort());
    expect(files["secrets.env"]).toBe("contents-of-secrets.env\n");
    expect(files["tls/ca.crt"]).toBe("contents-of-tls/ca.crt\n");
  });

  it("excludes a replacement's private Cloud recovery request from captured state", async () => {
    const dir = await seedStateDir();
    const privateKey = "distinct-private-signing-key";
    await writeFile(join(dir, "cloud-recovery.json"), JSON.stringify({ privateKey }), {
      mode: 0o600,
    });
    await writeFile(
      join(dir, "cloud-replacement.json"),
      JSON.stringify({ privateKey, peerPrivateKey: "distinct-private-peer-key" }),
      { mode: 0o600 },
    );
    const files = await collectStateSecrets(dir);
    expect(files).not.toHaveProperty("cloud-recovery.json");
    expect(files).not.toHaveProperty("cloud-replacement.json");
    expect(JSON.stringify(files)).not.toContain(privateKey);
    expect(JSON.stringify(files)).not.toContain("distinct-private-peer-key");
  });

  it("throws recovery.state_incomplete naming the first missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "state-secrets-empty-"));
    await expect(collectStateSecrets(dir)).rejects.toThrow(
      new AppError("recovery.state_incomplete", { missing: "secrets.env" }),
    );
  });

  it("propagates a non-ENOENT read failure raw, not as recovery.state_incomplete", async () => {
    // A `secrets.env` that is a DIRECTORY makes `readFile` throw EISDIR, not ENOENT.
    const dir = mkdtempSync(join(tmpdir(), "state-secrets-eisdir-"));
    await mkdir(join(dir, "secrets.env"), { recursive: true });
    const err = await collectStateSecrets(dir).then(
      () => {
        throw new Error("expected collectStateSecrets to reject");
      },
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(AppError);
    expect((err as NodeJS.ErrnoException).code).toBe("EISDIR");
  });

  it("rejects a bundle key that would escape destDir (traversal guard), writing nothing outside", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-escape-"));
    await expect(unpackBundleToDir({ "../escape": "pwned\n" }, dest)).rejects.toThrow(
      new AppError("recovery.bundle_invalid", { reason: "unsafe_path" }),
    );
    // The sibling path the traversal would have written to must not exist.
    await expect(readFile(join(dest, "..", "escape"), "utf8")).rejects.toThrow();
  });

  it("rejects a key whose parent is a symlink escaping destDir, writing nothing outside", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "state-secrets-outside-"));
    await chmod(outside, 0o755);
    // Pre-existing `destDir/tls -> outside`: the key `tls/server.key` is lexically fine, but writing
    // it would follow the symlink and land in `outside`. The symlink-aware guard must reject it.
    await symlink(outside, join(dest, "tls"));
    await expect(unpackBundleToDir({ "tls/server.key": "pwned\n" }, dest)).rejects.toThrow(
      new AppError("recovery.bundle_invalid", { reason: "unsafe_path" }),
    );
    // Nothing was written into the outside dir the symlink pointed at, and its mode is untouched.
    expect(await readdir(outside)).toEqual([]);
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
  });

  it("creates no folder through a link escaping destDir to a folder below the link", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-deep-link-"));
    const outside = mkdtempSync(join(tmpdir(), "state-secrets-deep-outside-"));
    await symlink(outside, join(dest, "tls"));
    let refusal: unknown;
    const events = await syncsAndRenames(() =>
      unpackBundleToDir({ "tls/sub/server.key": "pwned\n" }, dest).catch((err: unknown) => {
        refusal = err;
      }),
    );
    expect(refusal).toMatchObject({
      code: "recovery.bundle_invalid",
      params: { reason: "unsafe_path" },
    });
    expect(await readdir(outside)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("refuses an entry whose folder is swapped for an escaping link after the first check", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-swap-"));
    const outside = mkdtempSync(join(tmpdir(), "state-secrets-swap-outside-"));
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.mkdir).mockImplementation((async (path, options) => {
      if (path === join(dest, "tls")) await real.symlink(outside, path);
      return real.mkdir(path, options);
    }) as typeof fs.mkdir);
    try {
      await expect(unpackBundleToDir({ "tls/server.key": "pwned\n" }, dest)).rejects.toMatchObject({
        code: "recovery.bundle_invalid",
        params: { reason: "unsafe_path" },
      });
    } finally {
      vi.mocked(fs.mkdir).mockReset();
    }
    expect(await readdir(outside)).toEqual([]);
  });

  it("creates the missing folders between an existing one and an entry", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-deep-"));
    await unpackBundleToDir({ "a/b/c/k": "k\n" }, dest);
    expect(await readFile(join(dest, "a", "b", "c", "k"), "utf8")).toBe("k\n");
  });

  it("propagates an lstat failure other than a missing entry", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-lstat-eio-"));
    const failure = Object.assign(new Error("injected lstat failure"), { code: "EIO" });
    vi.mocked(fs.lstat).mockRejectedValueOnce(failure);
    await expect(unpackBundleToDir({ "a/k": "k\n" }, dest)).rejects.toBe(failure);
  });

  it("syncs each unpacked file before renaming it into place, and its folder after", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-durable-"));
    const events = await syncsAndRenames(() => unpackBundleToDir(files, dest));
    for (const rel of RECOVERY_FILES) {
      const target = join(dest, rel);
      const renamed = events.indexOf(`rename ${target}.tmp ${target}`);
      expect(events.slice(renamed - 1, renamed + 2), rel).toEqual([
        `sync ${target}.tmp`,
        `rename ${target}.tmp ${target}`,
        `sync ${dirname(target)}`,
      ]);
    }
  });

  it("syncs the destination after creating a tls folder in it", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-new-tls-"));
    const events = await syncsAndRenames(() => unpackBundleToDir(files, dest));
    const created = events.indexOf(`mkdir ${join(dest, "tls")}`);
    expect(created).not.toBe(-1);
    expect(events.indexOf(`sync ${dest}`, created)).toBeGreaterThan(created);
  });

  it("syncs the folder above each folder it creates for a missing destination", async () => {
    const above = mkdtempSync(join(tmpdir(), "state-secrets-new-dest-"));
    const dest = join(above, "a", "state");
    const events = await syncsAndRenames(() => unpackBundleToDir({ "secrets.env": "x\n" }, dest));
    const created = events.indexOf(`mkdir ${dest}`);
    expect(created).not.toBe(-1);
    expect(events.indexOf(`sync ${above}`, created)).toBeGreaterThan(created);
    expect(events.indexOf(`sync ${join(above, "a")}`, created)).toBeGreaterThan(created);
  });

  it("issues no sync at all when asked for a non-durable unpack", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const above = mkdtempSync(join(tmpdir(), "state-secrets-not-durable-"));
    const dest = join(above, "a", "state");
    const events = await syncsAndRenames(() => unpackBundleToDir(files, dest, { durable: false }));
    expect(events).toContain(`mkdir ${dest}`);
    expect(events).toContain(`mkdir ${join(dest, "tls")}`);
    expect(events).toContain(
      `rename ${join(dest, "trading.env")}.tmp ${join(dest, "trading.env")}`,
    );
    expect(events.filter((event) => event.startsWith("sync "))).toEqual([]);
    for (const rel of RECOVERY_FILES) {
      expect(await readFile(join(dest, rel), "utf8")).toBe(files[rel]);
      expect((await stat(join(dest, rel))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(dest)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dest, "tls"))).mode & 0o777).toBe(0o700);
  });

  it("unpacks into a tls that is a link to a folder inside the destination", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-linked-"));
    await mkdir(join(dest, "real-tls"));
    await symlink(join(dest, "real-tls"), join(dest, "tls"));
    await unpackBundleToDir({ "tls/server.key": "key\n" }, dest);
    expect(await readFile(join(dest, "real-tls", "server.key"), "utf8")).toBe("key\n");
  });

  it("unpacks a bundle to a dir with 0600 files and a tls/ subdir, round-tripping contents", async () => {
    const src = await seedStateDir();
    const files = await collectStateSecrets(src);
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-out-"));
    await unpackBundleToDir(files, dest);
    for (const rel of RECOVERY_FILES) {
      expect(await readFile(join(dest, rel), "utf8")).toBe(files[rel]);
      expect((await stat(join(dest, rel))).mode & 0o777).toBe(0o600);
    }
  });

  it("makes an EXISTING destination and entry folder owner-only", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-existing-"));
    await mkdir(join(dest, "tls"));
    await chmod(dest, 0o755);
    await chmod(join(dest, "tls"), 0o755);
    await unpackBundleToDir(files, dest);
    expect((await stat(dest)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dest, "tls"))).mode & 0o777).toBe(0o700);
  });

  it("makes every existing folder between the destination and an entry owner-only", async () => {
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-deep-"));
    await mkdir(join(dest, "a", "b"), { recursive: true });
    await chmod(dest, 0o755);
    await chmod(join(dest, "a"), 0o755);
    await chmod(join(dest, "a", "b"), 0o755);
    await unpackBundleToDir({ "a/b/key": "x\n" }, dest);
    expect((await stat(join(dest, "a"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dest, "a", "b"))).mode & 0o777).toBe(0o700);
  });

  it("creates a missing destination and entry folder owner-only", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const dest = join(mkdtempSync(join(tmpdir(), "state-secrets-fresh-")), "state");
    await unpackBundleToDir(files, dest);
    expect((await stat(dest)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dest, "tls"))).mode & 0o777).toBe(0o700);
  });

  it("leaves the folder above the destination as it was", async () => {
    const files = await collectStateSecrets(await seedStateDir());
    const above = mkdtempSync(join(tmpdir(), "state-secrets-above-"));
    await chmod(above, 0o755);
    const dest = join(above, "state");
    await mkdir(dest, { mode: 0o755 });
    await unpackBundleToDir(files, dest);
    expect((await stat(above)).mode & 0o777).toBe(0o755);
  });
});
