import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { firstStartPending, readRestoreFlow, updateRestoreFlow } from "./restore-flow.js";
import { promisify } from "node:util";
import { AppError } from "@waitron/shared";
import { VENUE_LOCK_FILE } from "@waitron/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { holdVenueElsewhere } from "./testing/venue-held-elsewhere.js";

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
async function fresh(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-restore-request-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
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
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
    ).toEqual({
      version: 1,
      environment: "preproduction",
      managedCloud,
    });
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/admin-verifiers"), "utf8")),
    ).toEqual([]);
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
  it("fails start on Cloud bookkeeping failure and retries the whole restore", async () => {
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
    const deps = {
      stateDir,
      venueDir: join(stateDir, "venue"),
      migrationsRoot: null,
      log: vi.fn(),
    };
    let runs = 0;
    const restore: Parameters<typeof runStagedRestore>[1] = async (args) => {
      await args.beforeDatabaseMove?.();
      expect((await readRestoreFlow(stateDir))?.phase).toBe("placing");
      await writeFile(join(deps.venueDir, "venue.db"), `attempt ${++runs}`);
    };
    await expect(
      runStagedRestore(
        {
          ...deps,
          onManagedCloudRestored: async () => {
            throw new Error("Cloud bookkeeping unavailable");
          },
        },
        restore,
      ),
    ).rejects.toThrow("Cloud bookkeeping unavailable");
    expect((await readRestoreFlow(stateDir))?.request).toHaveProperty("managedCloud", managedCloud);
    await expect(runStagedRestore(deps, restore)).resolves.toBe(true);
    expect(runs).toBe(2);
    expect(await readFile(join(deps.venueDir, "venue.db"), "utf8")).toBe("attempt 2");
    expect(await readRestoreFlow(stateDir)).toEqual({
      version: 1,
      phase: "first-start",
      firstStart: { source: "archive" },
    });
  });

  it("clears only failed-attempt databases and decrypt scratch before retry, restoring the old identity", async () => {
    const stateDir = await fresh();
    const venueDir = join(stateDir, "venue");
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1]),
      recoveryKey: "key",
      environment: "production",
    });
    const flow = (await readRestoreFlow(stateDir))!;
    await updateRestoreFlow(stateDir, { ...flow, phase: "placing" });
    await mkdir(venueDir);
    const stale = [
      "venue.db",
      "venue.db-wal",
      "venue.db-shm",
      "venue.db.incoming",
      "node.db",
      "node.db-wal",
      "node.db-shm",
      "node.db.incoming",
    ];
    for (const name of stale) await writeFile(join(venueDir, name), "partial");
    await mkdir(join(venueDir, ".venue.db-litestream"));
    await writeFile(join(stateDir, "backup-room-note.json"), "stale note");
    await mkdir(join(stateDir, "scratch/restore/old-decryption"), { recursive: true });
    await writeFile(join(stateDir, "scratch/restore/old-decryption/key"), "private");
    await writeFile(join(stateDir, "trading.env"), "partial identity");
    await writeFile(join(stateDir, "trading.env.replaced"), "original identity");
    await runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: vi.fn() }, async () => {
      for (const name of [...stale, ".venue.db-litestream"])
        await expect(stat(join(venueDir, name))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(stateDir, "backup-room-note.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(stateDir, "scratch/restore/old-decryption"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe("original identity");
      expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(Buffer.from([1]));
      expect((await stat(join(venueDir, "venue.lock"))).isFile()).toBe(true);
    });
  });

  it("writes the encrypted artifact and recovery key owner-only, with the marker last", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1, 2, 3]),
      recoveryKey: "secret-key",
      environment: "production",
    });
    expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(await readFile(join(stateDir, "flows/restore/key"), "utf8")).toBe("secret-key");
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
    ).toEqual({
      version: 1,
      environment: "production",
    });
    for (const name of [
      "flows/restore/artifact",
      "flows/restore/key",
      "flows/restore/record.json",
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
    await expect(readFile(join(stateDir, "flows/restore/artifact"))).rejects.toMatchObject({
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
    await writeFile(join(stateDir, "flows/setup/operation.json"), "restore receipt");
    const restore = vi.fn(async () => {});
    const onManagedCloudRestored = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        {
          stateDir,
          venueDir: join(stateDir, "venue"),
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
        artifactPath: join(stateDir, "flows/restore/artifact"),
        recoveryKey: "recovery",
        environment: "preproduction",
        venueDir: join(stateDir, "venue"),
      }),
    );
    await expect(readFile(join(stateDir, "flows/setup/operation.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await firstStartPending(stateDir)).toEqual({ source: "archive" });
  });

  it("retains the staged request and source after a failed restore", async () => {
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
          venueDir: join(stateDir, "venue"),
          migrationsRoot: "/migrations",
          log: vi.fn(),
        },
        async () => {
          throw new Error("restore failed");
        },
      ),
    ).rejects.toThrow("restore failed");
    expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(Buffer.from([9]));
    expect((await readRestoreFlow(stateDir))?.request).toEqual({
      version: 1,
      environment: "production",
    });
  });

  it("keeps the staged request when another process holds the venue folder", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([9]),
      recoveryKey: "recovery",
      environment: "production",
    });
    await writeFile(join(stateDir, "flows/setup/operation.json"), "restore receipt");
    await expect(
      runStagedRestore(
        {
          stateDir,
          venueDir: join(stateDir, "venue"),
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
    expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(Buffer.from([9]));
    expect(await readFile(join(stateDir, "flows/restore/key"), "utf8")).toBe("recovery");
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
    ).toEqual({
      version: 1,
      environment: "production",
    });
    expect(await readFile(join(stateDir, "flows/setup/operation.json"), "utf8")).toBe("restore receipt");
  });

  it("refuses an unreadable restore flow without starting the box", async () => {
    const stateDir = await fresh();
    await mkdir(join(stateDir, "flows/restore/record.json"), { recursive: true });
    await writeFile(join(stateDir, "flows/restore/admin-verifiers"), "[]");
    const restore = vi.fn(async () => {});
    const log = vi.fn();
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log },
        restore,
      ),
    ).rejects.toMatchObject({ code: "restore.flow_unreadable" });
    expect(log).toHaveBeenCalledWith("error", "restore.flow_unreadable", {});
    await expect(firstStartPending(stateDir)).rejects.toMatchObject({
      code: "restore.flow_unreadable",
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("does not restart a restore after serving when its retained record becomes unreadable", async () => {
    const stateDir = await fresh();
    await mkdir(join(stateDir, "flows/restore"), { recursive: true });
    await writeFile(join(stateDir, "flows/restore/record.json"), "{ torn");
    const restore = vi.fn(async () => {
      throw new Error("must not restore over a served venue");
    });
    expect(
      await runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: vi.fn() },
        restore,
      ),
    ).toBe(false);
    expect(await firstStartPending(stateDir)).toEqual({ source: "unknown" });
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
    await writeFile(
      join(stateDir, "flows/restore/record.json"),
      JSON.stringify({ version: 1, phase: "staged", request: marker }),
    );
    const restore = vi.fn(async () => {});

    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: vi.fn() },
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
    await writeFile(
      join(stateDir, "flows/restore/record.json"),
      JSON.stringify({ version: 1, phase: "staged", request: marker }),
    );
    const restore = vi.fn(async () => {});
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: vi.fn() },
        restore,
      ),
    ).rejects.toThrow("invalid staged restore request");
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("staged restore requests from the bucket", () => {
  const entries = [{ name: "manifest.json", bytes: Buffer.from("{}") }];
  const STREAM_FILES = [
    "flows/restore/venue.db",
    "flows/restore/entries",
    "flows/restore/record.json",
  ];

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
    expect(await readFile(join(stateDir, "flows/restore/venue.db"), "utf8")).toBe("restored");
    await expect(readFile(downloaded)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
    ).toEqual({
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
    await writeFile(join(stateDir, "flows/setup/operation.json"), "restore receipt");
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    expect(
      await runStagedRestore(
        {
          stateDir,
          venueDir: join(stateDir, "venue"),
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
        databasePath: join(stateDir, "flows/restore/placement.db"),
        entries: [{ name: "manifest.json", bytes: Buffer.from("{}") }],
        environment: "production",
        venueDir: join(stateDir, "venue"),
        stateDir,
        stagingDir: join(stateDir, "scratch/restore"),
        migrationsRoot: "/migrations",
      }),
    );
    expect(await firstStartPending(stateDir)).toEqual({ source: "stream" });
    for (const name of [
      ...STREAM_FILES.filter((name) => !name.endsWith("record.json")),
      "flows/setup/operation.json",
    ]) {
      await expect(readFile(join(stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("forwards a staged file beyond 2 GiB without materializing it", async () => {
    const stateDir = await fresh();
    const databasePath = join(stateDir, "download.db");
    const size = 2 ** 31 + 4096;
    const source = await open(databasePath, "wx", 0o600);
    try {
      await source.truncate(size);
      await source.write(Buffer.from("FIRST"), 0, 5, 0);
      await source.write(Buffer.from("LAST"), 0, 4, size - 4);
    } finally {
      await source.close();
    }
    await stageRestoreRequest(stateDir, {
      kind: "stream",
      databasePath,
      entries,
      environment: "preproduction",
    });
    let observed = false;
    expect(
      await runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: () => {} },
        async () => {
          throw new Error("archive path selected");
        },
        async (args) => {
          expect(args.databasePath).toBe(join(stateDir, "flows/restore/placement.db"));
          expect((await stat(args.databasePath)).size).toBe(2147487744);
          expect(args).not.toHaveProperty("databaseBytes");
          const file = await open(args.databasePath, "r");
          try {
            const first = Buffer.alloc(5);
            const last = Buffer.alloc(4);
            await file.read(first, 0, 5, 0);
            await file.read(last, 0, 4, size - 4);
            expect(first.toString()).toBe("FIRST");
            expect(last.toString()).toBe("LAST");
          } finally {
            await file.close();
          }
          observed = true;
        },
      ),
    ).toBe(true);
    expect(observed).toBe(true);
    expect(await firstStartPending(stateDir)).toEqual({ source: "stream" });
    for (const name of STREAM_FILES.filter((name) => !name.endsWith("record.json"))) {
      await expect(stat(join(stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("retains the bucket source after placement consumes its copy and fails", async () => {
    const stateDir = await fresh();
    await staged(stateDir);
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: "/m", log: vi.fn() },
        async () => {},
        async (args) => {
          await args.beforeDatabaseMove?.();
          await rename(args.databasePath, join(stateDir, "venue/venue.db"));
          throw new Error("restore failed");
        },
      ),
    ).rejects.toThrow("restore failed");
    expect(await readFile(join(stateDir, "flows/restore/venue.db"), "utf8")).toBe("restored");
    expect((await readRestoreFlow(stateDir))?.phase).toBe("placing");
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: "/m", log: vi.fn() },
        async () => {},
        async (args) => {
          expect(await readFile(args.databasePath, "utf8")).toBe("restored");
          await args.beforeDatabaseMove?.();
        },
      ),
    ).resolves.toBe(true);
  });

  it("keeps a bucket request when another process holds the venue folder", async () => {
    const stateDir = await fresh();
    await staged(stateDir);
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: "/m", log: vi.fn() },
        async () => {},
        async () => {
          throw new AppError("provisioning.database_in_use", { database: "/v" });
        },
      ),
    ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    expect(await readFile(join(stateDir, "flows/restore/venue.db"), "utf8")).toBe("restored");
    expect((await stat(join(stateDir, "flows/restore/entries"))).isFile()).toBe(true);
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
    ).toEqual({
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
    await writeFile(
      join(stateDir, "flows/restore/record.json"),
      JSON.stringify({ version: 1, phase: "staged", request: marker }),
    );
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async () => {});
    await expect(
      runStagedRestore(
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: "/m", log: vi.fn() },
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
        { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: vi.fn() },
        restore,
        stream,
      ),
    ).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("restaging over an earlier request", () => {
  const deps = (stateDir: string) => ({
    stateDir,
    venueDir: join(stateDir, "venue"),
    migrationsRoot: null,
    log: vi.fn(),
  });

  it("a failed replacement keeps the original bucket request and its original entries", async () => {
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
    const originalOpen = nativeFs.open;
    vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/entries.tmp"))
        throw new Error("injected entries write failure");
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    await expect(
      stageRestoreRequest(stateDir, {
        kind: "stream",
        databasePath: join(scratch, "b.db"),
        entries: [{ name: "manifest.json", bytes: Buffer.from("NEW-ENTRIES") }],
        environment: "production",
      }),
    ).rejects.toThrow();
    const archive = vi.fn(async () => {});
    const stream = vi.fn(async (args) => {
      expect(await readFile(args.databasePath, "utf8")).toBe("OLD-DB");
    });
    expect(await runStagedRestore(deps(stateDir), archive, stream)).toBe(true);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [{ name: "manifest.json", bytes: Buffer.from("OLD-ENTRIES") }],
      }),
    );
    expect(archive).not.toHaveBeenCalled();
  });

  it("a failed replacement keeps the original archive and its original key", async () => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([1]),
      recoveryKey: "OLD-KEY",
      environment: "production",
    });
    const originalOpen = nativeFs.open;
    vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/key.tmp")) throw new Error("injected key write failure");
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    await expect(
      stageRestoreRequest(stateDir, {
        artifact: Uint8Array.from([2]),
        recoveryKey: "NEW-KEY",
        environment: "production",
      }),
    ).rejects.toThrow();
    const archive = vi.fn(async (args) => {
      expect(await readFile(args.artifactPath)).toEqual(Buffer.from([1]));
    });
    expect(await runStagedRestore(deps(stateDir), archive)).toBe(true);
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({ recoveryKey: "OLD-KEY" }));
  });
});

describe("a staged restore holds the venue folder", () => {
  /** Whether a second PROCESS can take `venueDir`'s lock the way `lockVenueDirectory` takes it. */
  async function lockableElsewhere(venueDir: string): Promise<boolean> {
    const script = `import { DatabaseSync } from "node:sqlite";
const connection = new DatabaseSync(process.argv[1]);
connection.exec("pragma busy_timeout = 0");
try { connection.exec("begin immediate"); process.stdout.write("free"); }
catch (error) { process.stdout.write(error.errcode === 5 ? "busy" : String(error)); }`;
    const { stdout } = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      join(venueDir, VENUE_LOCK_FILE),
    ]);
    if (stdout !== "free" && stdout !== "busy") throw new Error(stdout);
    return stdout === "free";
  }

  async function stagedArchive(): Promise<{ stateDir: string; venueDir: string }> {
    const stateDir = await fresh();
    const venueDir = join(stateDir, "venue");
    await mkdir(venueDir);
    await stageRestoreRequest(stateDir, {
      artifact: Uint8Array.from([9]),
      recoveryKey: "recovery",
      environment: "production",
    });
    return { stateDir, venueDir };
  }

  it("while the staged copy is checked, so another process cannot take the folder", async () => {
    const { stateDir, venueDir } = await stagedArchive();
    let duringRestore: boolean | undefined;
    await runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: vi.fn() }, async () => {
      duringRestore = await lockableElsewhere(venueDir);
    });
    expect(duringRestore).toBe(false);
    expect(await lockableElsewhere(venueDir)).toBe(true);
  });

  it("and gives it up when the restore fails", async () => {
    const { stateDir, venueDir } = await stagedArchive();
    await expect(
      runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: vi.fn() }, async () => {
        throw new Error("restore failed");
      }),
    ).rejects.toThrow("restore failed");
    expect(await lockableElsewhere(venueDir)).toBe(true);
  });

  it.each(["staged", "first-start"] as const)(
    "keeps the %s flow and attachments while another process holds the folder",
    async (phase) => {
      const { stateDir, venueDir } = await stagedArchive();
      if (phase === "first-start")
        await updateRestoreFlow(stateDir, { version: 1, phase, firstStart: { source: "archive" } });
      const holder = await holdVenueElsewhere(venueDir);
      const restore = vi.fn(async () => {});
      try {
        await expect(
          runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: vi.fn() }, restore),
        ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
      } finally {
        await holder.stop();
      }
      expect(restore).not.toHaveBeenCalled();
      expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(Buffer.from([9]));
      expect(await readFile(join(stateDir, "flows/restore/key"), "utf8")).toBe("recovery");
      const record = JSON.parse(
        await readFile(join(stateDir, "flows/restore/record.json"), "utf8"),
      );
      expect(record.phase).toBe(phase);
      if (phase === "staged")
        expect(record.request).toEqual({ version: 1, environment: "production" });
    },
  );
});
