import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { runRecoveryUnpack } from "./recovery-unpack-command.js";

const FILES: BundleFiles = { "secrets.env": "WAITRON_CREDENTIALS_KEY=k\n", "tls/ca.crt": "PEM\n" };
const PASS = "correct horse battery";

describe("waitron-recovery unpack", () => {
  it("decrypts an envelope file, writes its contents under destDir, and returns 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "out");
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, dest],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(await readFile(join(dest, "secrets.env"), "utf8")).toBe(FILES["secrets.env"]);
    expect(await readFile(join(dest, "tls/ca.crt"), "utf8")).toBe(FILES["tls/ca.crt"]);
    expect(out).toEqual([`unpacked 2 file(s) to ${dest}`]);
  });

  it("returns 2 and prints guidance when the passphrase env var is missing", async () => {
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", "x", "y"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/WAITRON_RECOVERY_PASSPHRASE/)]);
  });

  it("returns 2 and prints usage on an unknown subcommand", async () => {
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["frobnicate"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });
});
