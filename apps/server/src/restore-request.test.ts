import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";

const dirs: string[] = [];
async function fresh(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-restore-request-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("staged restore requests", () => {
  it("writes the encrypted artifact and recovery key owner-only, with the marker last", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1, 2, 3]),
      recoveryKey: "secret-key",
      environment: "production",
    });
    expect(await readFile(join(stateDir, "restore-request.artifact"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(await readFile(join(stateDir, "restore-request.key"), "utf8")).toBe("secret-key");
    expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toEqual({
      version: 1,
      environment: "production",
    });
    for (const name of [
      "restore-request.artifact",
      "restore-request.key",
      "restore-request.json",
    ]) {
      expect((await stat(join(stateDir, name))).mode & 0o777).toBe(0o600);
    }
  });

  it("runs before boot and removes the request only after success", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([4, 5]),
      recoveryKey: "recovery",
      environment: "preproduction",
    });
    await writeFile(join(stateDir, "setup-operation.json"), "restore receipt");
    const restore = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        {
          stateDir,
          databaseUrl: "postgres://migrator",
          mediaDir: join(stateDir, "media"),
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        restore,
      ),
    ).toBe(true);
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: Uint8Array.from([4, 5]),
        recoveryKey: "recovery",
        environment: "preproduction",
        databaseUrl: "postgres://migrator",
      }),
    );
    await expect(readFile(join(stateDir, "setup-operation.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains the staged request when restore fails", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([9]),
      recoveryKey: "recovery",
      environment: "production",
    });
    await expect(
      runStagedRestore(
        {
          stateDir,
          databaseUrl: "postgres://migrator",
          mediaDir: join(stateDir, "media"),
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        async () => {
          throw new Error("restore failed");
        },
      ),
    ).rejects.toThrow("restore failed");
    expect(await readFile(join(stateDir, "restore-request.artifact"))).toEqual(Buffer.from([9]));
  });
});
