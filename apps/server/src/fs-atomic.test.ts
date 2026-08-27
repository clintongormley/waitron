import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./fs-atomic.js";

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

  // The security property Copilot flagged: a stale `${path}.tmp` left by an earlier crash must NOT
  // have its (possibly broader) permissions carried onto the target. `writeFile` only applies `mode`
  // when it CREATES the file, so reusing/truncating a stale 0644 tmp would rename a 0644 secret into
  // place. writeFileAtomic removes the stale tmp first, so the write always creates a fresh 0600 file.
  it("does not inherit a stale tmp's broader permissions (secret-leak guard)", async () => {
    const d = await newDir();
    const target = join(d, "server.key");
    // Simulate a crash-leftover tmp with world-readable perms.
    await writeFile(`${target}.tmp`, "stale", { mode: 0o644 });
    expect((await stat(`${target}.tmp`)).mode & 0o777).toBe(0o644);

    await writeFileAtomic(target, "fresh-secret", 0o600);

    // The freshly-created file is 0600 — NOT the stale 0644. (Without the pre-write `rm`, `writeFile`
    // would truncate-and-reuse the 0644 tmp and rename 0644 into place.)
    expect(await readFile(target, "utf8")).toBe("fresh-secret");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
});
