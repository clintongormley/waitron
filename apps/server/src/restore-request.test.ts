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
  it.each([
    [
      "production environment",
      {
        version: 1,
        environment: "production",
        managedCloud: {
          requestId: "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e",
          pointId: "252998c0-69eb-4bbc-a0f9-a8ba6451db42",
        },
      },
    ],
    ["null binding", { version: 1, environment: "preproduction", managedCloud: null }],
    ["non-object binding", { version: 1, environment: "preproduction", managedCloud: "cloud" }],
    [
      "malformed request ID",
      {
        version: 1,
        environment: "preproduction",
        managedCloud: { requestId: "wrong", pointId: "252998c0-69eb-4bbc-a0f9-a8ba6451db42" },
      },
    ],
    [
      "malformed point ID",
      {
        version: 1,
        environment: "preproduction",
        managedCloud: { requestId: "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e", pointId: "wrong" },
      },
    ],
  ])("refuses a managed Cloud marker with %s", async (_label, marker) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([7]),
      recoveryKey: "recovery",
      environment: "preproduction",
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

describe("staged restore requests from the bucket", () => {
  const entries = [{ name: "manifest.json", bytes: Buffer.from("{}") }];
  const STREAM_FILES = ["restore-request.db", "restore-request.entries", "restore-request.json"];

  async function staged(stateDir: string): Promise<string> {
    const scratch = join(stateDir, "stream-restore");
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, "venue.db"), "restored");
    await stageRestoreRequest(stateDir, {
      kind: "stream",
      databasePath: join(scratch, "venue.db"),
      entries,
      environment: "production",
    });
    return join(scratch, "venue.db");
  }

  it("moves the restored database in, writes the entries owner-only, and the marker last", async () => {
    const stateDir = await fresh();
    const downloaded = await staged(stateDir);
    expect(await readFile(join(stateDir, "restore-request.db"), "utf8")).toBe("restored");
    await expect(readFile(downloaded)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toEqual({
      version: 1,
      environment: "production",
      kind: "stream",
    });
    for (const name of STREAM_FILES) {
      expect((await stat(join(stateDir, name))).mode & 0o777).toBe(0o600);
    }
  });

  it("validates a bucket request before moving anything", async () => {
    const stateDir = await fresh();
    const scratch = join(stateDir, "stream-restore");
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, "venue.db"), "restored");
    await expect(
      stageRestoreRequest(
        stateDir,
        {
          kind: "stream",
          databasePath: join(scratch, "venue.db"),
          entries,
          environment: "production",
        },
        async () => {
          throw new Error("not this venue");
        },
      ),
    ).rejects.toThrow("not this venue");
    expect(await readFile(join(scratch, "venue.db"), "utf8")).toBe("restored");
    for (const name of STREAM_FILES) {
      await expect(readFile(join(stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("runs the bucket source through its own restore, never the archive's, and clears it", async () => {
    const stateDir = await fresh();
    await staged(stateDir);
    await writeFile(join(stateDir, "setup-operation.json"), "restore receipt");
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        {
          stateDir,
          venueDir: "/var/lib/waitron/venue",
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        archive,
        stream,
      ),
    ).toBe(true);
    expect(archive).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseBytes: Buffer.from("restored"),
        entries: [{ name: "manifest.json", bytes: Buffer.from("{}") }],
        environment: "production",
        venueDir: "/var/lib/waitron/venue",
        stateDir,
        stagingDir: join(stateDir, "restore-staging"),
        migrationsRoot: "/migrations",
      }),
    );
    for (const name of [...STREAM_FILES, "setup-operation.json"]) {
      await expect(readFile(join(stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("clears a failed bucket restore so the next boot returns to setup", async () => {
    const stateDir = await fresh();
    await staged(stateDir);
    await expect(
      runStagedRestore(
        { stateDir, venueDir: "/v", migrationsRoot: "/m", log: vi.fn() },
        async () => {},
        async () => {
          throw new Error("restore failed");
        },
      ),
    ).rejects.toThrow("restore failed");
    for (const name of STREAM_FILES) {
      await expect(readFile(join(stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("keeps a bucket request when another process holds the venue folder", async () => {
    const stateDir = await fresh();
    await staged(stateDir);
    await expect(
      runStagedRestore(
        { stateDir, venueDir: "/v", migrationsRoot: "/m", log: vi.fn() },
        async () => {},
        async () => {
          throw new AppError("provisioning.database_in_use", { database: "/v" });
        },
      ),
    ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    expect(await readFile(join(stateDir, "restore-request.db"), "utf8")).toBe("restored");
    expect((await stat(join(stateDir, "restore-request.entries"))).isFile()).toBe(true);
    expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toEqual({
      version: 1,
      environment: "production",
      kind: "stream",
    });
  });

  it.each([
    [
      "a source it does not know",
      { version: 1, environment: "production", kind: "carrier-pigeon" },
    ],
    [
      "a bucket source carrying a managed Cloud binding",
      {
        version: 1,
        environment: "preproduction",
        kind: "stream",
        managedCloud: {
          requestId: "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e",
          pointId: "252998c0-69eb-4bbc-a0f9-a8ba6451db42",
        },
      },
    ],
  ])("refuses a marker naming %s and runs no restore", async (_label, marker) => {
    const stateDir = await fresh();
    await staged(stateDir);
    await writeFile(join(stateDir, "restore-request.json"), JSON.stringify(marker));
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    await expect(
      runStagedRestore(
        { stateDir, venueDir: "/v", migrationsRoot: "/m", log: vi.fn() },
        archive,
        stream,
      ),
    ).rejects.toThrow("invalid staged restore request");
    expect(archive).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("staged restore requests, the edges", () => {
  it("reports that nothing is staged, running no restore", async () => {
    const stateDir = await fresh();
    const restore = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        { stateDir, venueDir: "/v", migrationsRoot: null, log: vi.fn() },
        restore,
        stream,
      ),
    ).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("still reports a restore done when telling the managed Cloud fails", async () => {
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
    const onManagedCloudRestored = vi.fn(async () => {
      throw new Error("cloud unreachable");
    });
    expect(
      await runStagedRestore(
        { stateDir, venueDir: "/v", migrationsRoot: null, log: vi.fn(), onManagedCloudRestored },
        async () => {},
      ),
    ).toBe(true);
    expect(onManagedCloudRestored).toHaveBeenCalledWith(managedCloud);
  });
});

describe("restaging over an earlier request", () => {
  const deps = (stateDir: string) => ({
    stateDir,
    venueDir: "/v",
    migrationsRoot: null,
    log: vi.fn(),
  });

  it("a second bucket request that fails part-way leaves no request, never the new copy with the old entries", async () => {
    const stateDir = await fresh();
    const scratch = join(stateDir, "scratch");
    await mkdir(scratch);
    await writeFile(join(scratch, "a.db"), "OLD-DB");
    await stageRestoreRequest(stateDir, {
      kind: "stream",
      databasePath: join(scratch, "a.db"),
      entries: [{ name: "manifest.json", bytes: Buffer.from("OLD-ENTRIES") }],
      environment: "production",
    });
    await writeFile(join(scratch, "b.db"), "NEW-DB");
    // A directory where the entries' working copy goes: the second request's entries write fails
    // after its database has been moved in.
    await mkdir(join(stateDir, "restore-request.entries.tmp", "in-the-way"), { recursive: true });
    await expect(
      stageRestoreRequest(stateDir, {
        kind: "stream",
        databasePath: join(scratch, "b.db"),
        entries: [{ name: "manifest.json", bytes: Buffer.from("NEW-ENTRIES") }],
        environment: "production",
      }),
    ).rejects.toThrow();
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    expect(await runStagedRestore(deps(stateDir), archive, stream)).toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it("a second archive request that fails part-way leaves no request, never the new artifact with the old key", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1]),
      recoveryKey: "OLD-KEY",
      environment: "production",
    });
    await mkdir(join(stateDir, "restore-request.key.tmp", "in-the-way"), { recursive: true });
    await expect(
      stageRestoreRequest(stateDir, {
        artifact: Uint8Array.from([2]),
        recoveryKey: "NEW-KEY",
        environment: "production",
      }),
    ).rejects.toThrow();
    const archive = vi.fn(async () => {});
    expect(await runStagedRestore(deps(stateDir), archive)).toBe(false);
    expect(archive).not.toHaveBeenCalled();
  });
});
