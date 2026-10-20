import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageFile, writeFileAtomic } from "./fs-atomic.js";

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
