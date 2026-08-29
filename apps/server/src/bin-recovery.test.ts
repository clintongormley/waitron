import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { runRecoveryUnpack } from "./bin-recovery.js";

const FILES: BundleFiles = { "secrets.env": "WAITRON_CREDENTIALS_KEY=k\n", "tls/ca.crt": "PEM\n" };
const PASS = "correct horse battery";

describe("waitron-recovery unpack", () => {
  it("decrypts an envelope file and writes its contents under destDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bin-recovery-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "out");
    await runRecoveryUnpack(["unpack", envPath, dest], { WAITRON_RECOVERY_PASSPHRASE: PASS });
    expect(await readFile(join(dest, "secrets.env"), "utf8")).toBe(FILES["secrets.env"]);
    expect(await readFile(join(dest, "tls/ca.crt"), "utf8")).toBe(FILES["tls/ca.crt"]);
  });

  it("rejects a missing passphrase env var", async () => {
    await expect(runRecoveryUnpack(["unpack", "x", "y"], {})).rejects.toThrow(
      /WAITRON_RECOVERY_PASSPHRASE/,
    );
  });

  it("rejects an unknown subcommand", async () => {
    await expect(runRecoveryUnpack(["frobnicate"], {})).rejects.toThrow(/usage/i);
  });
});
