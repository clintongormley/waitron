import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { encodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { archiveNamespace } from "./archive-settings.js";
import { backupArchiveKey } from "./backup-keys.js";
import { runRestore } from "./restore-command.js";
import type { RestoreFileDeps } from "./restore.js";

it("resolves the archive target before downloading and removes its downloaded file after restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "archive-resolved-target-"));
  const key = backupArchiveKey(new Date("2026-10-01T03:00:00Z"));
  const packPath = join(root, "pack.txt");
  const payload = Buffer.from("downloaded archive bytes");
  const stateDir = join(root, "state");
  let received: RestoreFileDeps | undefined;
  const out: string[] = [];
  try {
    await writeFile(
      packPath,
      encodeArchiveRecoveryPack({
        version: 1,
        format: "WBK1",
        venueId: "venue-1",
        bucket: {
          region: "eu-west-1",
          bucket: "owner-bucket",
          prefix: "waitron",
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: "synthetic-secret",
        },
        archivePrefix: archiveNamespace("waitron", "venue-1"),
        recoveryKey: "synthetic-backup-key",
      }),
    );
    const unused = async (): Promise<never> => {
      throw new Error("unexpected file-store operation");
    };
    const code = await runRestore({
      argv: ["restore", "--from-archive", packPath, "--archive-key", key],
      env: { WAITRON_STATE_DIR: stateDir, WAITRON_ENV: "preproduction" },
      out: (line) => out.push(line),
      openArchiveFiles: () => ({
        putFile: unused,
        putBytes: unused,
        readStream: unused,
        deleteMany: unused,
        list: async () => [{ key, size: payload.length, lastModified: new Date() }],
        getFile: async (_key, path) => writeFile(path, payload),
        close() {},
      }),
      restore: async (deps) => {
        received = deps;
        expect(await readFile(deps.artifactPath)).toEqual(payload);
      },
    });
    expect(code, out.join("\n")).toBe(0);
    expect(received?.venueDir).toBe(join(stateDir, "venue"));
    expect(received?.stateDir).toBe(stateDir);
    expect(received?.recoveryKey).toBe("synthetic-backup-key");
    expect(await readdir(join(stateDir, "restore-staging"))).toEqual([]);
    expect(out.at(-1)).toBe(`restored archive ${key} from the bucket named in ${packPath}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
