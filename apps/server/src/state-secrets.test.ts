import { mkdtempSync } from "node:fs";
import { mkdir, writeFile, readFile, stat, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { RECOVERY_FILES, collectStateSecrets, unpackBundleToDir } from "./state-secrets.js";

/** Materialise a state dir holding the always-present RECOVERY_FILES with recognisable contents.
 * `withCredentialsKey` also writes `secrets.env` (the vault key an "embedded"/on-prem box holds on
 * disk); an "external"/cloud box's dir has none. */
async function seedStateDir(withCredentialsKey = true): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "state-secrets-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) {
    await writeFile(join(dir, rel), `contents-of-${rel}\n`, { mode: 0o600 });
  }
  if (withCredentialsKey) {
    await writeFile(join(dir, "secrets.env"), "contents-of-secrets.env\n", { mode: 0o600 });
  }
  return dir;
}

describe("state-secrets", () => {
  it("embedded: gathers RECOVERY_FILES + secrets.env, keyed by relative posix path", async () => {
    const dir = await seedStateDir();
    const files = await collectStateSecrets(dir, { credentialsKey: "embedded" });
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES, "secrets.env"].sort());
    expect(files["secrets.env"]).toBe("contents-of-secrets.env\n");
    expect(files["tls/ca.crt"]).toBe("contents-of-tls/ca.crt\n");
  });

  it("external: skips secrets.env — a dir with none succeeds and the map has no secrets.env key", async () => {
    const dir = await seedStateDir(false);
    const files = await collectStateSecrets(dir, { credentialsKey: "external" });
    expect(files["secrets.env"]).toBeUndefined();
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES].sort());
  });

  it("embedded: still throws recovery.state_incomplete when secrets.env is missing", async () => {
    const dir = await seedStateDir(false);
    await expect(collectStateSecrets(dir, { credentialsKey: "embedded" })).rejects.toThrow(
      new AppError("recovery.state_incomplete", { missing: "secrets.env" }),
    );
  });

  it("throws recovery.state_incomplete naming the first missing always-present file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "state-secrets-empty-"));
    await expect(collectStateSecrets(dir, { credentialsKey: "embedded" })).rejects.toThrow(
      new AppError("recovery.state_incomplete", { missing: "trading.env" }),
    );
  });

  it("propagates a non-ENOENT read failure raw, not as recovery.state_incomplete", async () => {
    // A `secrets.env` that is a DIRECTORY makes `readFile` throw EISDIR, not ENOENT — the branch the
    // catch must distinguish. Mirrors discovery-api.test.ts / media-api.test.ts's non-ENOENT case.
    // Seed the always-present files too so the embedded read reaches `secrets.env` (read last).
    const dir = await seedStateDir(false);
    await mkdir(join(dir, "secrets.env"), { recursive: true });
    const err = await collectStateSecrets(dir, { credentialsKey: "embedded" }).then(
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
    // Pre-existing `destDir/tls -> outside`: the key `tls/server.key` is lexically fine, but writing
    // it would follow the symlink and land in `outside`. The symlink-aware guard must reject it.
    await symlink(outside, join(dest, "tls"));
    await expect(unpackBundleToDir({ "tls/server.key": "pwned\n" }, dest)).rejects.toThrow(
      new AppError("recovery.bundle_invalid", { reason: "unsafe_path" }),
    );
    // Nothing was written into the outside dir the symlink pointed at.
    expect(await readdir(outside)).toEqual([]);
  });

  it("unpacks a bundle to a dir with 0600 files and a tls/ subdir, round-tripping contents", async () => {
    const src = await seedStateDir();
    const files = await collectStateSecrets(src, { credentialsKey: "embedded" });
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-out-"));
    await unpackBundleToDir(files, dest);
    for (const rel of [...RECOVERY_FILES, "secrets.env"]) {
      expect(await readFile(join(dest, rel), "utf8")).toBe(files[rel]);
      expect((await stat(join(dest, rel))).mode & 0o777).toBe(0o600);
    }
  });
});
