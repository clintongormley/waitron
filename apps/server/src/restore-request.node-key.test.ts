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
import { ALL_MODULES } from "./modules.js";
import { firstStartPending } from "./restore-flow.js";
import { emptyScratch } from "./scratch.js";
import { writeValidated } from "./restore.js";

const dirs: string[] = [];
const NODE_KEY_FILE = "flows/restore/node-key";
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
        String(args[0]) ===
        (part === "marker"
          ? join(stateDir, "flows/restore/record.json.tmp")
          : join(stateDir, "flows/restore"))
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
    const marker = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
    expect(marker).not.toContain(secret);
    expect(JSON.parse(marker).request).toMatchObject({
      nodeRecoveryKey: true,
      recoveryOperation: request.recoveryOperation,
    });
    if (kind === "archive")
      expect(await readFile(join(stateDir, "flows/restore/key"), "utf8")).toBe(
        "archive encryption key",
      );
  },
);

it.each(["", " ", null, 42, "x".repeat(4097)])(
  "refuses malformed staged credentials before replacing a valid request %#",
  async (nodeRecoverySecret) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    const before = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
    await expect(
      stageRestoreRequest(stateDir, {
        ...archive(),
        nodeRecoverySecret,
      } as unknown as RestoreRequest),
    ).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_NODE_RECOVERY_KEY", reason: "invalid_credential" },
    });
    expect(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).toBe(before);
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

it.each(["success", "refusal"])(
  "handles the staged credential after restore %s",
  async (outcome) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    const restore = async (args: { onDatabasePlaced?: () => void }) => {
      args.onDatabasePlaced?.();
      if (outcome === "refusal") throw new AppError("promotion.break_glass_invalid", {});
    };
    const context = deps(stateDir);
    const attempt = runStagedRestore(context, restore);
    if (outcome === "success") await expect(attempt).resolves.toBe(true);
    else await expect(attempt).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    if (outcome === "success")
      await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({
        code: "ENOENT",
      });
    else {
      expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
      expect(
        JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")),
      ).toHaveProperty("phase", "placing");
    }
    expect(JSON.stringify(context.log.mock.calls)).not.toContain(secret);
  },
);

it.each(["", " and the clean-up then fails too"])(
  "a started request whose placement changed nothing gets its marker back%s",
  async (cleanUp) => {
    const stateDir = await fresh();
    await stageRestoreRequest(stateDir, archive());
    const before = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
    const writeFailure = Object.assign(new Error("injected secrets write failure"), {
      code: "ENOSPC",
    });
    const cleanUpFailure = Object.assign(new Error("injected clean-up failure"), { code: "EIO" });
    const failure = cleanUp === "" ? writeFailure : cleanUpFailure;
    let originalOpenMocked = false;
    const originalOpen = nativeFs.open;
    vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === join(stateDir, "secrets.env.incoming.tmp")) {
        originalOpenMocked = true;
        throw writeFailure;
      }
      return originalOpen(...args);
    });
    const originalRm = nativeFs.rm;
    vi.spyOn(nativeFs, "rm").mockImplementation(async (...args) => {
      if (
        cleanUp !== "" &&
        originalOpenMocked &&
        String(args[0]) === join(stateDir, "flows/restore/record.json.tmp")
      ) {
        originalOpenMocked = false;
        throw cleanUpFailure;
      }
      return originalRm(...args);
    });
    syncBuiltinESMExports();
    const restore = async (args: Parameters<typeof writeValidated>[1]) => {
      // The real placement, from a copy already validated: the fake archive above cannot be opened.
      const databasePath = join(stateDir, "validated.db");
      await writeFile(databasePath, "database", { mode: 0o600 });
      await writeValidated(
        {
          manifest: {
            manifestVersion: 1,
            createdAt: "2026-11-07T00:00:00.000Z",
            environment: "preproduction",
            modules: {},
          },
          databasePath,
          nodeDump: Buffer.from("node"),
          discard: async () => {},
          secretEntries: [
            { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_VAULT_MASTER_KEY=1\n") },
            {
              name: "secrets/trading.env",
              bytes: Buffer.from(`WAITRON_NODE_ID=${operation.binding.targetNodeId}\n`),
            },
          ],
        },
        { ...args, modules: ALL_MODULES, withModuleOperations: undefined },
      );
    };
    await expect(runStagedRestore(deps(stateDir), restore)).rejects.toBe(failure);
    expect(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).toBe(before);
    expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
  },
);

it("writes a started request's marker back durably: the file synced before it is renamed into place, then its folder", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  const before = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
  const events: string[] = [];
  const rel = (path: unknown) => String(path).slice(stateDir.length + 1) || ".";
  const originalOpen = nativeFs.open;
  vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      events.push(`sync ${rel(args[0])}`);
      return sync();
    };
    return handle;
  });
  const originalRename = nativeFs.rename;
  vi.spyOn(nativeFs, "rename").mockImplementation(async (from, to) => {
    events.push(`${rel(from)} → ${rel(to)}`);
    return originalRename(from, to);
  });
  syncBuiltinESMExports();
  await expect(
    runStagedRestore(deps(stateDir), async () => {
      throw new Error("injected failure before placement");
    }),
  ).rejects.toThrow("injected failure before placement");
  expect(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).toBe(before);
  const writeBack = events.lastIndexOf("flows/restore/record.json.tmp → flows/restore/record.json");
  expect(events.slice(writeBack - 1)).toEqual([
    "sync flows/restore/record.json.tmp",
    "flows/restore/record.json.tmp → flows/restore/record.json",
    "sync flows/restore",
  ]);
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
  expect(
    JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
  ).toHaveProperty("nodeRecoveryKey", true);
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
    JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).request,
  ).not.toHaveProperty("nodeRecoveryKey");
});

it("a failed replacement keeps its original request and node credential", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  const before = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
  const originalOpen = nativeFs.open;
  vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("/key.tmp")) throw new Error("injected key write failure");
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  await expect(stageRestoreRequest(stateDir, archive())).rejects.toThrow(
    "injected key write failure",
  );
  expect(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).toBe(before);
  expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
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
    await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject({
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
      await rm(join(stateDir, "flows/restore/entries"));
    } else {
      await stageRestoreRequest(stateDir, archive());
      if (part === "archive-key") await rm(join(stateDir, "flows/restore/key"));
      if (part === "marker-json") await writeFile(join(stateDir, "flows/restore/record.json"), "{");
      if (part === "marker-shape" || part === "operation") {
        const marker = JSON.parse(
          await readFile(join(stateDir, "flows/restore/record.json"), "utf8"),
        );
        if (part === "marker-shape") marker.request.nodeRecoveryKey = false;
        else marker.request.recoveryOperation = { invalid: true };
        await writeFile(join(stateDir, "flows/restore/record.json"), JSON.stringify(marker));
      }
    }
    const restore = vi.fn(async () => {});
    if (part === "marker-json") {
      await expect(runStagedRestore(deps(stateDir), restore, restore)).resolves.toBe(false);
      expect(await firstStartPending(stateDir)).toEqual({ source: "unknown" });
      expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
      expect(restore).not.toHaveBeenCalled();
      return;
    }
    await expect(runStagedRestore(deps(stateDir), restore, restore)).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
    await expect(readFile(join(stateDir, NODE_KEY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("the next start clears a node credential in unpublished scratch staging", async () => {
  const stateDir = await fresh();
  const staged = join(stateDir, "scratch/restore-flow-interrupted");
  await mkdir(staged, { recursive: true });
  await writeFile(join(staged, "node-key"), secret, { mode: 0o600 });
  await writeFile(join(staged, "node-key.tmp"), secret, { mode: 0o600 });
  await emptyScratch(stateDir, vi.fn());
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(deps(stateDir), restore)).resolves.toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("refuses another backup's allocation source before replacing an existing staged request", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  const before = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
  await expect(
    stageRestoreRequest(stateDir, { ...archive(), artifact: Buffer.from("different backup") }),
  ).rejects.toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "source_mismatch" },
  });
  expect(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")).toBe(before);
  expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
});

it("refuses changed archive bytes before invoking the restarted restore", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await writeFile(join(stateDir, "flows/restore/artifact"), "different backup");
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
      await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(databasePath, "utf8")).toBe("later point in the same generation");
      return;
    }
    await stageRestoreRequest(stateDir, request);
    if (phase === "restart-db")
      await writeFile(join(stateDir, "flows/restore/venue.db"), "changed");
    else
      await writeFile(
        join(stateDir, "flows/restore/entries"),
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

it("an unreadable restart record retains the key until its unknown first start ends", async () => {
  const stateDir = await fresh();
  await stageRestoreRequest(stateDir, archive());
  await rm(join(stateDir, "flows/restore/record.json"));
  await mkdir(join(stateDir, "flows/restore/record.json"));
  const restore = vi.fn(async () => {});
  await expect(runStagedRestore(deps(stateDir), restore)).resolves.toBe(false);
  expect(await firstStartPending(stateDir)).toEqual({ source: "unknown" });
  expect(restore).not.toHaveBeenCalled();
  expect(await readFile(join(stateDir, NODE_KEY_FILE), "utf8")).toBe(secret);
});
