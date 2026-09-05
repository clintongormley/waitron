import { mkdtempSync } from "node:fs";
import { readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeEntryName, assertSafeEntryNames } from "./restore-entry-guard.js";

describe("assertSafeEntryName", () => {
  it("rejects a `../` traversal escape", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-escape-"));
    await expect(assertSafeEntryName("secrets/../../etc/x", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "secrets/../../etc/x" },
    });
  });

  it("rejects an absolute entry name", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-absolute-"));
    await expect(assertSafeEntryName("/etc/passwd", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "/etc/passwd" },
    });
  });

  // Proven by deletion (task-2-report.md): with the realpath-aware layer commented out, this is the
  // ONE case in the file that starts failing — "tls/ca.crt" is lexically fine (join/resolve never
  // see the symlink), so only a realpath check catches it. `readdir(outside)` staying empty is NOT
  // load-bearing evidence for THIS guard the way it is for `unpackBundleToDir`'s own symlink test:
  // `assertSafeEntryName` never writes file contents itself (it only validates and mkdirs the
  // parent), so `outside` would read empty regardless of whether the check ran — asserting only that
  // would "pass wrongly" even with the guard deleted. The rejection itself is the real assertion.
  it("rejects a lexically-fine name whose parent is a symlink escaping destRoot", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "restore-guard-outside-"));
    // Pre-existing destRoot/tls -> outside, mirroring state-secrets.test.ts's symlink case exactly:
    // "tls/ca.crt"'s dirname IS the symlink itself, so `mkdir(dirname(target), {recursive:true})` is
    // a no-op (the dir already "exists" through the link) rather than creating anything new — only
    // `realpath` can tell the parent's TRUE location is outside destRoot.
    await symlink(outside, join(dest, "tls"));
    await expect(assertSafeEntryName("tls/ca.crt", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "tls/ca.crt" },
    });
    // Sanity check only (see comment above) — not the proof.
    expect(await readdir(outside)).toEqual([]);
  });

  it("passes a normal media entry and returns a path under the root", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-ok-media-"));
    const target = await assertSafeEntryName("media/abc123.jpg", dest);
    expect(target.startsWith(dest + sep)).toBe(true);
    expect(target).toBe(join(dest, "media", "abc123.jpg"));
  });

  it("passes a normal secrets entry and returns a path under the root", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-ok-secrets-"));
    const target = await assertSafeEntryName("secrets/tls/ca.crt", dest);
    expect(target.startsWith(dest + sep)).toBe(true);
    expect(target).toBe(join(dest, "secrets", "tls", "ca.crt"));
  });
});

describe("assertSafeEntryNames", () => {
  it("rejects on the first unsafe name in the batch", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-batch-bad-"));
    await expect(
      assertSafeEntryNames(["media/a.jpg", "../escape", "secrets/tls/ca.crt"], dest),
    ).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "../escape" },
    });
  });

  it("resolves when every name in the batch is safe", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-batch-ok-"));
    await expect(
      assertSafeEntryNames(["db.dump", "media/a.jpg", "secrets/tls/ca.crt"], dest),
    ).resolves.toBeUndefined();
  });
});
