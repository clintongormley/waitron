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

  // "tls/ca.crt" is lexically fine, so only the realpath layer catches it. The guard never writes
  // file contents, so an empty `outside` proves nothing: the rejection is the real assertion.
  it("rejects a lexically-fine name whose parent is a symlink escaping destRoot", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "restore-guard-outside-"));
    await symlink(outside, join(dest, "tls"));
    await expect(assertSafeEntryName("tls/ca.crt", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "tls/ca.crt" },
    });
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a sibling dir that shares a name prefix with destRoot (the sep boundary)", async () => {
    // `<parent>/bad/x` starts with `<parent>/b`: a containment check without the trailing separator
    // would accept it.
    const parent = mkdtempSync(join(tmpdir(), "restore-guard-sibling-"));
    const dest = join(parent, "b");
    await mkdir(dest, { recursive: true });
    await expect(assertSafeEntryName("../bad/x", dest)).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
      params: { name: "../bad/x" },
    });
  });

  it("passes a normal source entry and returns a path under the root", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-ok-source-"));
    const target = await assertSafeEntryName("documents/abc123.bin", dest);
    expect(target.startsWith(dest + sep)).toBe(true);
    expect(target).toBe(join(dest, "documents", "abc123.bin"));
  });

  it("passes a normal secrets entry and returns a path under the root", async () => {
    const dest = mkdtempSync(join(tmpdir(), "restore-guard-ok-secrets-"));
    const target = await assertSafeEntryName("secrets/tls/ca.crt", dest);
    expect(target.startsWith(dest + sep)).toBe(true);
    expect(target).toBe(join(dest, "secrets", "tls", "ca.crt"));
  });
});
