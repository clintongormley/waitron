import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { BACKUP_ENV_FILE, FIRST_SETUP_FILE } from "@waitron/store";
import { afterEach, expect, it } from "vitest";
import { updateSetupFlowSection } from "./setup-flow-record.js";
import { deleteStagedBackupKey } from "./staged-backup-key-file.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function staged(): Promise<{ stateDir: string; id: string }> {
  const stateDir = await mkdtemp(join(tmpdir(), "staged-backup-key-"));
  dirs.push(stateDir);
  const publicKey = sealingPublicKey(makeMasterKey());
  await updateSetupFlowSection(stateDir, "attempt", () => ({}) as never);
  await updateSetupFlowSection(stateDir, "nodeKey", () => ({
    masterKeyPublicKey: publicKey.toString("base64"),
  }));
  return { stateDir, id: masterKeyId(publicKey).toString("hex") };
}

const held = (id: string) =>
  `WAITRON_BACKUP_RECOVERY_KEY=key\nWAITRON_BACKUP_KEY_NUMBER=1\nWAITRON_BACKUP_MASTER_KEY_ID=${id}\n`;

it("deletes a backup.env naming the staged master key", async () => {
  const { stateDir, id } = await staged();
  await writeFile(join(stateDir, BACKUP_ENV_FILE), held(id));
  await deleteStagedBackupKey(stateDir);
  await expect(readFile(join(stateDir, BACKUP_ENV_FILE))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  ["another master key", held("0123456789abcdef")],
  ["no master key", "WAITRON_BACKUP_RECOVERY_KEY=key\n"],
])("keeps a backup.env naming %s", async (_, text) => {
  const { stateDir } = await staged();
  await writeFile(join(stateDir, BACKUP_ENV_FILE), text);
  await deleteStagedBackupKey(stateDir);
  expect(await readFile(join(stateDir, BACKUP_ENV_FILE), "utf8")).toBe(text);
});

it("keeps backup.env when no key is staged, or the setup record is unusable", async () => {
  const { stateDir, id } = await staged();
  await writeFile(join(stateDir, BACKUP_ENV_FILE), held(id));
  await updateSetupFlowSection(stateDir, "nodeKey", () => "no key");
  await deleteStagedBackupKey(stateDir);
  await writeFile(join(stateDir, FIRST_SETUP_FILE), JSON.stringify({ version: 2 }));
  await deleteStagedBackupKey(stateDir);
  await rm(join(stateDir, FIRST_SETUP_FILE));
  await deleteStagedBackupKey(stateDir);
  expect(await readFile(join(stateDir, BACKUP_ENV_FILE), "utf8")).toBe(held(id));
});

it("a missing backup.env is not an error, and an unreadable one is thrown", async () => {
  const { stateDir } = await staged();
  await expect(deleteStagedBackupKey(stateDir)).resolves.toBeUndefined();
  await mkdir(join(stateDir, BACKUP_ENV_FILE));
  await expect(deleteStagedBackupKey(stateDir)).rejects.toMatchObject({ code: "EISDIR" });
});
