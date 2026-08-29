import { mkdtempSync } from "node:fs";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { RECOVERY_FILES, collectStateSecrets, unpackBundleToDir } from "./state-secrets.js";

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

  it("throws recovery.state_incomplete naming the first missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "state-secrets-empty-"));
    await expect(collectStateSecrets(dir)).rejects.toThrow(
      new AppError("recovery.state_incomplete", { missing: "secrets.env" }),
    );
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
});
