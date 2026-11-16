import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectStateSecrets, RECOVERY_FILES } from "./state-secrets.js";
import { clearRestoreSecretFiles } from "./restore-secrets.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function seed() {
  const root = await mkdtemp(join(tmpdir(), "restore-cleanup-"));
  roots.push(root);
  const put = async (name: string, value = "live") => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), value);
  };
  for (const name of RECOVERY_FILES) await put(name);
  return { root, put };
}

it("removes only obsolete working files beside settled live secrets and module records", async () => {
  const { root, put } = await seed();
  await put("module-records/sample.json");
  for (const name of [...RECOVERY_FILES, "module-records/sample.json"])
    for (const suffix of [".tmp", ".incoming", ".incoming.tmp", ".restore-previous"])
      await put(name + suffix, "obsolete private key");
  await put("records/keep.incoming");
  await put("unknown.incoming");
  await clearRestoreSecretFiles(root, vi.fn());
  await clearRestoreSecretFiles(root, vi.fn());
  const names = await readdir(root, { recursive: true });
  expect(names.filter((name) => /\.(tmp|incoming|restore-previous)$/.test(name)).sort()).toEqual([
    "records/keep.incoming",
    "unknown.incoming",
  ]);
  expect(Object.values(await collectStateSecrets(root))).not.toContain("obsolete private key");
  expect(await readFile(join(root, "module-records/sample.json"), "utf8")).toBe("live");
});

it.each(["trading.env.replaced", "flows/restore/record.json"])(
  "preserves old keys while %s still marks recovery",
  async (marker) => {
    const { root, put } = await seed();
    await put(marker);
    await put("tls/ca.key.restore-previous", "old identity key");
    const log = vi.fn();
    await clearRestoreSecretFiles(root, log);
    expect(await readFile(join(root, "tls/ca.key.restore-previous"), "utf8")).toBe(
      "old identity key",
    );
    expect(log).toHaveBeenCalledWith(
      "warn",
      "restore.secrets.cleanup_deferred",
      expect.any(Object),
    );
  },
);

it("keeps working files whose live target is missing and never follows discovered links", async () => {
  const { root, put } = await seed();
  await rm(join(root, "trading.env"));
  await put("secrets.env.tmp", "keep until settled");
  await clearRestoreSecretFiles(root, vi.fn());
  expect(await readFile(join(root, "secrets.env.tmp"), "utf8")).toBe("keep until settled");
  await put("trading.env");
  await rm(join(root, "tls/ca.key"));
  await put("tls/ca.key.restore-previous", "only remaining key");
  await put("outside/sample.json.incoming", "external key");
  await symlink(join(root, "outside"), join(root, "module-records"));
  await symlink(join(root, "outside/sample.json.incoming"), join(root, "tls/server.pem.tmp"));
  const log = vi.fn();
  await clearRestoreSecretFiles(root, log);
  expect(await readFile(join(root, "tls/ca.key.restore-previous"), "utf8")).toBe(
    "only remaining key",
  );
  expect(await readFile(join(root, "tls/server.pem.tmp"), "utf8")).toBe("external key");
  expect(await readFile(join(root, "outside/sample.json.incoming"), "utf8")).toBe("external key");
  expect(log).toHaveBeenCalledWith("warn", "restore.secrets.working_kept", expect.any(Object));
  expect(log).toHaveBeenCalledWith("warn", "restore.secrets.working_kept", {
    file: "module-records",
  });
});

it("keeps a linked TLS folder and logs that its keys were not swept", async () => {
  const { root, put } = await seed();
  await rm(join(root, "tls"), { recursive: true });
  await put("external-tls/ca.key", "live key");
  await put("external-tls/ca.key.restore-previous", "old key");
  await symlink(join(root, "external-tls"), join(root, "tls"));
  const log = vi.fn();
  await clearRestoreSecretFiles(root, log);
  expect(await readFile(join(root, "tls/ca.key.restore-previous"), "utf8")).toBe("old key");
  expect(log).toHaveBeenCalledWith("warn", "restore.secrets.working_kept", { file: "tls/ca.key" });
});
