import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
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
  it("persists a managed Cloud marker and passes it only to that cold restore", async () => {
    const stateDir = await fresh();
    const managedCloud = {
      requestId: "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e",
      pointId: "252998c0-69eb-4bbc-a0f9-a8ba6451db42",
    };
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1]),
      recoveryKey: "key",
      environment: "preproduction",
      managedCloud,
    });
    expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toEqual({
      version: 1,
      environment: "preproduction",
      managedCloud,
    });
    const restore = vi.fn(async () => {});
    const onManagedCloudRestored = vi.fn(async () => {});
    await runStagedRestore(
      {
        stateDir,
        venueDir: join(stateDir, "venue"),
        migrationsRoot: null,
        log: vi.fn(),
        onManagedCloudRestored,
      },
      restore,
    );
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ managedCloud }));
    expect(onManagedCloudRestored).toHaveBeenCalledWith(managedCloud);
  });
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

  it("validates the encrypted artifact before staging any restart request", async () => {
    const stateDir = await fresh();
    const validate = vi.fn(async () => {
      throw new Error("wrong recovery key");
    });

    await expect(
      stageRestoreRequest(
        stateDir,
        {
          artifact: Uint8Array.from([1, 2, 3]),
          recoveryKey: "wrong-key",
          environment: "production",
        },
        validate,
      ),
    ).rejects.toThrow("wrong recovery key");

    expect(validate).toHaveBeenCalledOnce();
    await expect(readFile(join(stateDir, "restore-request.artifact"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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
    const onManagedCloudRestored = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        {
          stateDir,
          venueDir: "/var/lib/waitron/venue",
          migrationsRoot: "/migrations",
          log: vi.fn(),
          onManagedCloudRestored,
        },
        restore,
      ),
    ).toBe(true);
    expect(onManagedCloudRestored).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({
        // A Buffer, not a bare Uint8Array: `runStagedRestore` hands `restore` exactly what
        // `readFile` returned, and deep equality here distinguishes the subclass.
        artifact: Buffer.from([4, 5]),
        recoveryKey: "recovery",
        environment: "preproduction",
        venueDir: "/var/lib/waitron/venue",
      }),
    );
    await expect(readFile(join(stateDir, "setup-operation.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("clears the staged request when restore fails so the next boot returns to recovery", async () => {
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
          venueDir: "/var/lib/waitron/venue",
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        async () => {
          throw new Error("restore failed");
        },
      ),
    ).rejects.toThrow("restore failed");
    await expect(readFile(join(stateDir, "restore-request.artifact"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps the staged request when another process holds the venue folder", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([9]),
      recoveryKey: "recovery",
      environment: "production",
    });
    await writeFile(join(stateDir, "setup-operation.json"), "restore receipt");
    await expect(
      runStagedRestore(
        {
          stateDir,
          venueDir: "/var/lib/waitron/venue",
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        async () => {
          throw new AppError("provisioning.database_in_use", {
            database: "/var/lib/waitron/venue",
          });
        },
      ),
    ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    // Refused before anything changed, so the request stays staged.
    expect(await readFile(join(stateDir, "restore-request.artifact"))).toEqual(Buffer.from([9]));
    expect(await readFile(join(stateDir, "restore-request.key"), "utf8")).toBe("recovery");
    expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toEqual({
      version: 1,
      environment: "production",
    });
    expect(await readFile(join(stateDir, "setup-operation.json"), "utf8")).toBe("restore receipt");
  });

  it("rejects with the read error, running no restore, when the request marker cannot be read", async () => {
    const stateDir = await fresh();
    await mkdir(join(stateDir, "restore-request.json"));
    const restore = vi.fn(async () => {});

    await expect(
      runStagedRestore(
        { stateDir, venueDir: "/var/lib/waitron/venue", migrationsRoot: null, log: vi.fn() },
        restore,
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(restore).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown version", { version: 2, environment: "production" }],
    ["an environment that is not a deployment", { version: 1, environment: "dev" }],
  ])("refuses a marker with %s and runs no restore", async (_label, marker) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([7]),
      recoveryKey: "recovery",
      environment: "production",
    });
    await writeFile(join(stateDir, "restore-request.json"), JSON.stringify(marker));
    const restore = vi.fn(async () => {});

    await expect(
      runStagedRestore(
        { stateDir, venueDir: "/var/lib/waitron/venue", migrationsRoot: null, log: vi.fn() },
        restore,
      ),
    ).rejects.toThrow("invalid staged restore request");
    expect(restore).not.toHaveBeenCalled();
  });
});
