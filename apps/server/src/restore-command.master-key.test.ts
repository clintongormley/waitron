import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupKey, makeMasterKey } from "@waitron/credentials";
import { AppError, encodeMasterKeyCode } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryPackPdf } from "../test/recovery-pack-pdf.js";
import { decryptBackupFile } from "./artifact-cipher-file.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import type { RestoreFileDeps } from "./restore.js";
import { runRestore } from "./restore-command.js";
import { heldBackupKey, heldBackupKeyName } from "./testing/backup-key.js";
import { writeMasterKeyArchive } from "./testing/master-key-archive.js";

vi.mock("./recovery-module-operation.js", async (original) => {
  const actual = await original<typeof import("./recovery-module-operation.js")>();
  return {
    ...actual,
    readRecoveryOperationFile: vi.fn(async () => ({})),
    createRecoveryRestoreRunner: vi.fn(() => vi.fn()),
  };
});

const PLAINTEXT = new TextEncoder().encode("the backup's bytes");
const MASTER_KEY = makeMasterKey();
const MASTER_KEY_TEXT = encodeMasterKeyCode(MASTER_KEY);
const KEY_NUMBER = 3;
const RECOVERY_KEY = "a cloud copy's recovery key";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "restore-command-master-key-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function backupFile(masterKey = MASTER_KEY): Promise<string> {
  const path = join(dir, "backup.enc");
  await writeMasterKeyArchive(path, PLAINTEXT, masterKey, KEY_NUMBER);
  return path;
}

async function cloudCopy(): Promise<string> {
  const path = join(dir, "cloud-copy.enc");
  await writeFile(path, encryptArtifact(PLAINTEXT, RECOVERY_KEY));
  return path;
}

/** Runs the command with a restore that opens the file under the key the command hands it. */
async function run(argv: string[], env: NodeJS.ProcessEnv) {
  const out: string[] = [];
  const opened: Buffer[] = [];
  const restore = vi.fn(async (args: RestoreFileDeps) => {
    const plain = join(dir, "opened");
    await decryptBackupFile(args.artifactPath, plain, args.recoveryKey);
    opened.push(await readFile(plain));
  });
  const code = await runRestore({
    argv,
    env: { WAITRON_STATE_DIR: join(dir, "state"), ...env },
    out: (line) => out.push(line),
    lockVenue: async () => ({ release: () => {} }),
    restore,
  });
  return { code, out, opened, restore };
}

describe("waitron-restore restore <file> and the master key", () => {
  it("opens a backup file with WAITRON_MASTER_KEY", async () => {
    const path = await backupFile();
    const { code, out, opened, restore } = await run(["restore", path], {
      WAITRON_MASTER_KEY: MASTER_KEY_TEXT,
    });
    expect(code).toBe(0);
    expect(opened).toEqual([Buffer.from(PLAINTEXT)]);
    expect(restore.mock.calls[0]![0].recoveryKey).toBe(
      backupKey(MASTER_KEY, KEY_NUMBER).toString("base64url"),
    );
    expect(out.at(-1)).toBe(`restored ${path}`);
    expect(out.join("\n")).not.toContain(MASTER_KEY_TEXT);
  });

  it("opens a backup file with --master-key-file holding the key as text", async () => {
    const path = await backupFile();
    const keyFile = join(dir, "master-key.txt");
    await writeFile(keyFile, `  ${MASTER_KEY_TEXT.toLowerCase()}\n`);
    const { code, out, opened } = await run(["restore", path, "--master-key-file", keyFile], {});
    expect(code).toBe(0);
    expect(opened).toEqual([Buffer.from(PLAINTEXT)]);
    expect(out.join("\n")).not.toContain(MASTER_KEY_TEXT);
  });

  it("opens a backup file with --master-key-file naming the recovery pack PDF", async () => {
    const path = await backupFile();
    const pack = join(dir, "pack.pdf");
    await writeFile(
      pack,
      await recoveryPackPdf({
        bucketCode: null,
        archiveCode: null,
        masterKey: MASTER_KEY_TEXT,
        masterKeyName: heldBackupKeyName(MASTER_KEY),
      }),
    );
    const { code, opened } = await run(["restore", "--master-key-file", pack, path], {});
    expect(code).toBe(0);
    expect(opened).toEqual([Buffer.from(PLAINTEXT)]);
  });

  it("refuses a recovery pack PDF that does not hold the master key", async () => {
    const path = await backupFile();
    const pack = join(dir, "pack.pdf");
    await writeFile(pack, await recoveryPackPdf({ bucketCode: null, archiveCode: null }));
    const { code, out, restore } = await run(["restore", path, "--master-key-file", pack], {});
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: the recovery pack PDF does not hold the master key; give the pack that holds it, or a file with the key",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  const UNREADABLE_KEY_FILE =
    "cannot read the master key file: give a readable file holding the master key, or the recovery pack PDF";

  it("refuses a master key file it cannot read", async () => {
    const path = await backupFile();
    const keyFile = join(dir, "missing.txt");
    const { code, out, restore } = await run(["restore", path, "--master-key-file", keyFile], {});
    expect(code).toBe(1);
    expect(out).toEqual([UNREADABLE_KEY_FILE]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("never prints a master key pasted after --master-key-file in place of a path", async () => {
    const path = await backupFile();
    const pasted = encodeMasterKeyCode(makeMasterKey());
    const { code, out, restore } = await run(["restore", path, "--master-key-file", pasted], {});
    expect(code).toBe(1);
    expect(out).toEqual([UNREADABLE_KEY_FILE]);
    expect(out.some((line) => line.includes(pasted))).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });

  it("refuses --master-key-file and WAITRON_MASTER_KEY together", async () => {
    const path = await backupFile();
    const keyFile = join(dir, "master-key.txt");
    await writeFile(keyFile, MASTER_KEY_TEXT);
    const { code, out, restore } = await run(["restore", path, "--master-key-file", keyFile], {
      WAITRON_MASTER_KEY: MASTER_KEY_TEXT,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: give the master key once: --master-key-file or WAITRON_MASTER_KEY, not both",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("refuses a master key given as a flag value, and the usage names only the file flag", async () => {
    const path = await backupFile();
    const { code, out, restore } = await run(
      ["restore", path, "--master-key", MASTER_KEY_TEXT],
      {},
    );
    expect(code).toBe(2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^usage: /);
    expect(out[0]).toContain("restore <artifact-path> [--master-key-file <path>]");
    expect(out[0]).not.toMatch(/--master-key(?!-file)/);
    expect(out[0]).not.toContain(MASTER_KEY_TEXT);
    expect(restore).not.toHaveBeenCalled();
  });

  it("refuses --master-key-file with the bucket form", async () => {
    const keyFile = join(dir, "master-key.txt");
    await writeFile(keyFile, MASTER_KEY_TEXT);
    const { code, out } = await run(
      ["restore", "--from-bucket", join(dir, "kit.txt"), "--master-key-file", keyFile],
      {},
    );
    expect(code).toBe(2);
    expect(out[0]).toMatch(/^usage: /);
  });

  it("refuses a master key made after the backup, naming the backup's key", async () => {
    const older = makeMasterKey();
    const path = await backupFile(older);
    const { code, out, restore } = await run(["restore", path], {
      WAITRON_MASTER_KEY: MASTER_KEY_TEXT,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      `restore failed: promotion.break_glass_invalid — wrong master key; use the one dated ${heldBackupKeyName(older)}`,
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("refuses text that is not a master key as a wrong key, naming the backup's key", async () => {
    const path = await backupFile();
    const { code, out, restore } = await run(["restore", path], {
      WAITRON_MASTER_KEY: "not a master key",
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      `restore failed: promotion.break_glass_invalid — wrong master key; use the one dated ${heldBackupKeyName(MASTER_KEY)}`,
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("never opens a backup file with WAITRON_BACKUP_RECOVERY_KEY, even its own backup key", async () => {
    const path = await backupFile();
    const { code, out, restore } = await run(["restore", path], {
      WAITRON_BACKUP_RECOVERY_KEY: heldBackupKey(MASTER_KEY, KEY_NUMBER).key,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: this backup file opens with the master key; set WAITRON_MASTER_KEY or give --master-key-file",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("asks for a key when none is given", async () => {
    const path = await backupFile();
    const { code, out, restore } = await run(["restore", path], {});
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: give the master key: set WAITRON_MASTER_KEY or give --master-key-file (a Waitron Cloud copy opens with WAITRON_BACKUP_RECOVERY_KEY)",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("says a backup file the right master key does not open is damaged", async () => {
    const path = await backupFile();
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", path],
      env: { WAITRON_STATE_DIR: join(dir, "state"), WAITRON_MASTER_KEY: MASTER_KEY_TEXT },
      out: (line) => out.push(line),
      lockVenue: async () => ({ release: () => {} }),
      restore: async () => {
        throw new AppError("recovery.passphrase_invalid", {});
      },
    });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe(
      "restore failed: the backup file is damaged, or was changed after it was made; choose another backup",
    );
  });

  it("still opens a Cloud copy (version 1) with WAITRON_BACKUP_RECOVERY_KEY", async () => {
    const path = await cloudCopy();
    const { code, opened, restore } = await run(["restore", path], {
      WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
    });
    expect(code).toBe(0);
    expect(opened).toEqual([Buffer.from(PLAINTEXT)]);
    expect(restore.mock.calls[0]![0].recoveryKey).toBe(RECOVERY_KEY);
  });

  it("asks for WAITRON_BACKUP_RECOVERY_KEY for a Cloud copy given only the master key", async () => {
    const path = await cloudCopy();
    const { code, out, restore } = await run(["restore", path], {
      WAITRON_MASTER_KEY: MASTER_KEY_TEXT,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: this file is a Waitron Cloud copy, which opens with its recovery key; set WAITRON_BACKUP_RECOVERY_KEY to it",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("says a file that is not a backup file is not one, given only the master key", async () => {
    const path = join(dir, "junk.enc");
    await writeFile(path, "not a backup file at all");
    const { code, out, restore } = await run(["restore", path], {
      WAITRON_MASTER_KEY: MASTER_KEY_TEXT,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: this file is not a Waitron backup file, or it is damaged; choose another backup",
    ]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("hands the master key from --master-key-file to the recovery operation as well", async () => {
    const path = await backupFile();
    const keyFile = join(dir, "master-key.txt");
    await writeFile(keyFile, `${MASTER_KEY_TEXT}\n`);
    const { code } = await run(["restore", path, "--master-key-file", keyFile], {
      WAITRON_RECOVERY_OPERATION_FILE: join(dir, "operation.json"),
    });
    expect(code).toBe(0);
    expect(vi.mocked(createRecoveryRestoreRunner).mock.calls.at(-1)![2]).toBe(MASTER_KEY_TEXT);
  });
});
