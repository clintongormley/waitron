import { mkdtempSync } from "node:fs";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeEntryName } from "./restore-entry-guard.js";

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

  it("rejects a sibling dir that shares a name prefix with destRoot (the sep boundary)", async () => {
    // destRoot ends in the segment `b`; `../bad/x` resolves to `<parent>/bad/x`, a SIBLING of destRoot
    // that shares the `b` prefix. A regression dropping the trailing `sep` — `target.startsWith(root)`
    // instead of `target.startsWith(root + sep)` — would ACCEPT it (`<parent>/bad/x` does start with
    // `<parent>/b`). With the `+ sep` boundary it is rejected. Pins `/a/b` vs `/a/bad`.
    const parent = mkdtempSync(join(tmpdir(), "restore-guard-sibling-"));
    const dest = join(parent, "b");
    await mkdir(dest, { recursive: true });
    await expect(assertSafeEntryName("../bad/x", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "../bad/x" },
    });
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
