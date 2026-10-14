import { packArchive } from "./backup-archive.js";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { stageRestoreRequest, runStagedRestore, type RestoreRequest } from "./restore-request.js";

const dirs: string[] = [];
const NODE_KEY_FILE = "restore-request.node-key";
const secret = "synthetic node credential";
const operation = {
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "offline-restore-1",
    sourceId: createHash("sha256").update("encrypted").digest("hex"),
    targetNodeId: "c0000000-0000-4000-8000-000000000001",
  },
  input: { allocation: { signed: "public" }, approval: { eventId: "offline-restore-1" } },
};
async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "staged-node-key-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
function archive() {
  return {
    artifact: Buffer.from("encrypted"),
    recoveryKey: "archive encryption key",
    environment: "preproduction" as const,
    recoveryOperation: operation,
    nodeRecoverySecret: secret,
  };
}
function deps(stateDir: string) {
  return { stateDir, venueDir: join(stateDir, "venue"), migrationsRoot: null, log: vi.fn() };
}

it.each(["marker", "directory"])(
  "refuses placement when its %s cannot be flushed",
  async (part) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    const originalOpen = nativeFs.open;
    vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (
        String(args[0]) === (part === "marker" ? join(stateDir, "restore-request.json") : stateDir)
      )
        handle.sync = async () => {
          throw new Error("injected placement sync failure");
        };
      return handle;
    });
    syncBuiltinESMExports();
    const restore = vi.fn(async () => {});
    await expect(runStagedRestore(deps(stateDir), restore)).rejects.toThrow(
      "injected placement sync failure",
    );
    expect(restore).not.toHaveBeenCalled();
  },
);

it.each(["archive", "stream"])(
  "stages a %s node credential separately from its public marker and archive key",
  async (kind) => {
    const stateDir = await fresh();
    let request: RestoreRequest & { nodeRecoverySecret: string } = archive();
    if (kind === "stream") {
      const databasePath = join(stateDir, "download.db");
      await writeFile(databasePath, "database");
      request = {
        kind: "stream",
        databasePath,
        entries: [],
        environment: "preproduction",
        recoveryOperation: {
          ...operation,
          binding: {
            ...operation.binding,
            sourceId:
              "stream-sha256:54b2b3d6fbc5b6f8bd2e4e71d9eb088ca223ce356df90279aaba7eeb0fb6fbc9",
          },
        },
        nodeRecoverySecret: secret,
      };
    }
    await stageRestoreRequest(stateDir, request);
    expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
    expect((await stat(join(stateDir, NODE_KEY_FILE))).mode & 0o777).toBe(0o600);
    const marker = await readFile(join(stateDir, "restore-request.json"), "utf8");
    expect(marker).not.toContain(secret);
    expect(JSON.parse(marker)).toMatchObject({
      nodeRecoveryKey: true,
      recoveryOperation: request.recoveryOperation,
    });
    if (kind === "archive")
      expect(await readFile(join(stateDir, "restore-request.key"), "utf8")).toBe(
        "archive encryption key",
      );
  },
);

it.each(["", " ", null, 42, "x".repeat(4097)])(
  "refuses malformed staged credentials before replacing a valid request %#",
  async (nodeRecoverySecret) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    const before = await readFile(join(stateDir, "restore-request.json"), "utf8");
    await expect(
      stageRestoreRequest(stateDir, {
        ...archive(),
        nodeRecoverySecret,
      } as unknown as RestoreRequest),
    ).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_NODE_RECOVERY_KEY", reason: "invalid_credential" },
    });
    expect(await readFile(join(stateDir, "restore-request.json"), "utf8")).toBe(before);
    expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
  },
);

it("refuses an unbound staged credential before creating restart files", async () => {
  const stateDir = await fresh();
  await expect(
    stageRestoreRequest(stateDir, { ...archive(), recoveryOperation: undefined }),
  ).rejects.toMatchObject({ code: "server.config_invalid" });
  expect(await readdir(stateDir)).toEqual([]);
});

it.each(["success", "refusal"])("clears the node credential after restore %s", async (outcome) => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  const restore = async () => {
    if (outcome === "refusal") throw new AppError("promotion.break_glass_invalid", {});
  };
  const context = deps(stateDir);
  const attempt = runStagedRestore(context, restore);
  if (outcome === "success") await expect(attempt).resolves.toBe(true);
  else await expect(attempt).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(context.log.mock.calls)).not.toContain(secret);
});

it("keeps the node credential when the venue lock refuses before placement", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await expect(
    runStagedRestore(deps(stateDir), async () => {
      throw new AppError("provisioning.database_in_use", { database: "venue" });
    }),
  ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
  expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
  expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toHaveProperty(
    "nodeRecoveryKey",
    true,
  );
});

it("a lock refusal leaves the next attempt as a fresh placement", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await expect(
    runStagedRestore(deps(stateDir), async () => {
      throw new AppError("provisioning.database_in_use", { database: "venue" });
    }),
  ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
  let resumed: unknown = "not called";
  await runStagedRestore(deps(stateDir), async (args) => {
    resumed = args.resumeOperation;
  });
  expect(resumed).toBeUndefined();
});

it("restaging without a node credential removes the old credential", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await stageRestoreRequest(stateDir, { ...archive(), nodeRecoverySecret: undefined });
  await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8")),
  ).not.toHaveProperty("nodeRecoveryKey");
});

it("a partial restage leaves neither a bootable marker nor its node credential", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await mkdir(join(stateDir, "restore-request.key.tmp", "blocked"), { recursive: true });
  await expect(stageRestoreRequest(stateDir, archive())).rejects.toThrow();
  await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["missing", "empty", "oversized"])(
  "refuses a %s staged key without restoring or falling back to the environment",
  async (kind) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    if (kind === "missing") await rm(join(stateDir, NODE_KEY_FILE), { force: true });
    else await writeFile(join(stateDir, NODE_KEY_FILE), kind === "empty" ? "" : "x".repeat(4097));
    const restore = vi.fn(async () => {});
    await expect(
      runStagedRestore({ ...deps(stateDir), recoverySecret: "environment fallback" }, restore),
    ).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_NODE_RECOVERY_KEY", reason: "invalid_credential" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["marker-json", "marker-shape", "operation", "archive-key", "stream-entries"])(
  "clears the private key when %s cannot be read at restart",
  async (part) => {
    const stateDir = await fresh();
    if (part === "stream-entries") {
      const databasePath = join(stateDir, "download.db");
      await writeFile(databasePath, "database");
      await stageRestoreRequest(stateDir, {
        kind: "stream",
        databasePath,
        entries: [],
        environment: "preproduction",
        recoveryOperation: {
          ...operation,
          binding: {
            ...operation.binding,
            sourceId:
              "stream-sha256:54b2b3d6fbc5b6f8bd2e4e71d9eb088ca223ce356df90279aaba7eeb0fb6fbc9",
          },
        },
        nodeRecoverySecret: secret,
      });
      await rm(join(stateDir, "restore-request.entries"));
    } else {
      await stageRestoreRequest(stateDir, archive());
      if (part === "archive-key") await rm(join(stateDir, "restore-request.key"));
      if (part === "marker-json") await writeFile(join(stateDir, "restore-request.json"), "{");
      if (part === "marker-shape" || part === "operation") {
        const marker = JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"));
        if (part === "marker-shape") marker.nodeRecoveryKey = false;
        else marker.recoveryOperation = { invalid: true };
        await writeFile(join(stateDir, "restore-request.json"), JSON.stringify(marker));
      }
    }
    const restore = vi.fn(async () => {});
    await expect(runStagedRestore(deps(stateDir), restore, restore)).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
    await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("clears a node credential left by interruption before the marker was written", async () => {
  const stateDir = await fresh();
  await writeFile(join(stateDir, NODE_KEY_FILE), secret, { mode: 0o600 });
  await writeFile(join(stateDir, `${NODE_KEY_FILE}.tmp`), secret, { mode: 0o600 });
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(deps(stateDir), restore)).resolves.toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(await readdir(stateDir)).toEqual([]);
});

it("refuses another backup's allocation source before replacing an existing staged request", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  const before = await readFile(join(stateDir, "restore-request.json"), "utf8");
  await expect(
    stageRestoreRequest(stateDir, { ...archive(), artifact: Buffer.from("different backup") }),
  ).rejects.toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "source_mismatch" },
  });
  expect(await readFile(join(stateDir, "restore-request.json"), "utf8")).toBe(before);
  expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
});

it("refuses changed archive bytes before invoking the restarted restore", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await writeFile(join(stateDir, "restore-request.artifact"), "different backup");
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(deps(stateDir), restore)).rejects.toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "source_mismatch" },
  });
  expect(restore).not.toHaveBeenCalled();
  await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["staging", "restart-db", "restart-entries"])(
  "binds a streamed request to the selected database and entries at %s",
  async (phase) => {
    const stateDir = await fresh();
    const databasePath = join(stateDir, "download.db");
    await writeFile(databasePath, "database");
    const request = {
      kind: "stream" as const,
      databasePath,
      entries: [],
      environment: "preproduction" as const,
      recoveryOperation: {
        ...operation,
        binding: {
          ...operation.binding,
          sourceId:
            "stream-sha256:54b2b3d6fbc5b6f8bd2e4e71d9eb088ca223ce356df90279aaba7eeb0fb6fbc9",
        },
      },
      nodeRecoverySecret: secret,
    };
    if (phase === "staging") {
      await writeFile(databasePath, "later point in the same generation");
      await expect(stageRestoreRequest(stateDir, request)).rejects.toMatchObject({
        code: "server.config_invalid",
        params: { reason: "source_mismatch" },
      });
      await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(databasePath, "utf8")).toBe("later point in the same generation");
      return;
    }
    await stageRestoreRequest(stateDir, request);
    if (phase === "restart-db") await writeFile(join(stateDir, "restore-request.db"), "changed");
    else
      await writeFile(
        join(stateDir, "restore-request.entries"),
        packArchive([{ name: "manifest.json", bytes: Buffer.from("changed") }]),
      );
    const restore = vi.fn(async () => {});
    await expect(runStagedRestore(deps(stateDir), restore, restore)).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { reason: "source_mismatch" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("erases the private key even when its restart marker cannot be read", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await rm(join(stateDir, "restore-request.json"));
  await mkdir(join(stateDir, "restore-request.json"));
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(deps(stateDir), restore)).rejects.toMatchObject({ code: "EISDIR" });
  expect(restore).not.toHaveBeenCalled();
  await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
});
