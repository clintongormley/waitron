import { mkdtempSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
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

  it("returns 1 and a non-leaking message on the wrong passphrase", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-badpass-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, join(dir, "out")],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS + "!" },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual(["recovery failed: wrong passphrase or corrupt bundle"]);
  });

  it("returns 1 and names the path when the envelope file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-missing-"));
    const envPath = join(dir, "does-not-exist.wrb");
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, join(dir, "out")],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([`cannot read bundle file: ${envPath}`]);
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

  it("returns 1 with the same one message when the bundle file is not a bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-corrupt-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, "this is not an envelope");
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, join(dir, "out")],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual(["recovery failed: wrong passphrase or corrupt bundle"]);
  });

  it("refuses a symbolic-link destination before reading the bundle, leaving its target as it was", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-link-"));
    const envPath = join(dir, "no-such-bundle.wrb");
    const real = join(dir, "real");
    await mkdir(real);
    await chmod(real, 0o755);
    const dest = join(dir, "link");
    await symlink(real, dest);
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, dest],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      `recovery refused: ${dest} is a symbolic link. Give the folder it points to, or a new folder.`,
    ]);
    expect((await stat(real)).mode & 0o777).toBe(0o755);
    expect(await readdir(real)).toEqual([]);
  });

  it("refuses a destination another user owns and leaves it as it was", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-notowned-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "shared");
    await mkdir(dest);
    await chmod(dest, 0o755);
    const owner = (await stat(dest)).uid;
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, dest],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
      uid: owner + 1,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      `recovery refused: ${dest} belongs to another user. Give a folder you own, or a new folder inside this one.`,
    ]);
    expect((await stat(dest)).mode & 0o777).toBe(0o755);
    expect(await readdir(dest)).toEqual([]);
  });

  it("unpacks into an existing folder it owns and makes it owner-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-owned-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "mine");
    await mkdir(dest);
    await chmod(dest, 0o755);
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, dest],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
      uid: (await stat(dest)).uid,
    });
    expect(code).toBe(0);
    expect((await stat(dest)).mode & 0o777).toBe(0o700);
    expect(await readFile(join(dest, "secrets.env"), "utf8")).toBe(FILES["secrets.env"]);
  });

  it("refuses a destination that is not a folder and leaves it as it was", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-file-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "a-file");
    await writeFile(dest, "keep me\n");
    const out: string[] = [];
    const code = await runRecoveryUnpack({
      argv: ["unpack", envPath, dest],
      env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      `recovery refused: ${dest} is not a folder. Give a folder, or a new one.`,
    ]);
    expect(await readFile(dest, "utf8")).toBe("keep me\n");
  });

  it("lets a failure checking the destination propagate before the bundle is read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-lstat-"));
    const envPath = join(dir, "no-such-bundle.wrb");
    // The destination's parent is a FILE. The unpack's own `mkdir` would fail with the same code,
    // so the syscall is what shows the check raised it.
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "");
    const out: string[] = [];
    await expect(
      runRecoveryUnpack({
        argv: ["unpack", envPath, join(blocker, "out")],
        env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
        out: (line) => out.push(line),
      }),
    ).rejects.toMatchObject({ code: "ENOTDIR", syscall: "lstat" });
    expect(out).toEqual([]);
  });

  it("lets an unexpected failure propagate rather than report it as a bad bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-unpack-blocked-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    // A FOLDER where the bundle's `secrets.env` goes: the bundle decrypts, and the unpack's rename
    // onto it fails with a raw EISDIR, not an AppError.
    const dest = join(dir, "out");
    await mkdir(join(dest, "secrets.env"), { recursive: true });
    const out: string[] = [];
    await expect(
      runRecoveryUnpack({
        argv: ["unpack", envPath, dest],
        env: { WAITRON_RECOVERY_PASSPHRASE: PASS },
        out: (line) => out.push(line),
      }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(out).toEqual([]);
  });
});
