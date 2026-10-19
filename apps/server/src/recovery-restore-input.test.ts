import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { AppError } from "@waitron/shared";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { runEntry } from "./node-entry.js";
import { FRESH } from "./recovery-state.js";
import { runRestore } from "./restore-command.js";
import { restoreFromArtifactFile, type RestoreOperationRunner } from "./restore.js";
import { writeStreamRestore } from "./restore-stream.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import * as operations from "./recovery-module-operation.js";
const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
const request = {
  binding: {
    module: "test-regime",
    action: "restore",
    eventId: "restore-42",
    sourceId: "archive-42",
    targetNodeId: NODE,
  },
  input: { signed: "opaque" },
};
const pending = operations as typeof operations & {
  createRecoveryRestoreRunner(
    modules: readonly WaitronModule[],
    operation: typeof request,
    secret: unknown,
  ): RestoreOperationRunner;
};
const kit = {
  version: 1 as const,
  venueId: "c0000000-0000-4000-8000-000000000002",
  bucket: {
    endpoint: "https://s3.example.net",
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "waitron/",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "synthetic-secret-0123456789",
  },
  recoveryKey: "separate backup key",
  pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
};
let root: string;
let stateDir: string;
let databasePath: string;
let operationPath: string;
let nodeKey: string;
let collected: boolean;
let hookEntered: boolean;
let held: ModuleOperationInput | undefined;
let archivePath: string;
const secretEntries = [
  {
    name: "secrets/trading.env",
    bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
  },
];
const manifest = {
  manifestVersion: 1 as const,
  createdAt: "2026-10-13T09:00:00.000Z",
  environment: "preproduction" as const,
  modules: {},
};
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Original",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Restored" });
  await suite.db.insert(invoiceSeries).values([
    { nodeId: NODE, code: "A", purpose: "standard" },
    { nodeId: NODE, code: "FF", purpose: "full" },
  ]);
  nodeKey = await mintBreakGlassSecret(suite.db, NODE);
  root = await mkdtemp(join(tmpdir(), "restore-public-input-"));
  stateDir = join(root, "state");
  await mkdir(stateDir);
  databasePath = join(root, "backup.db");
  await suite.db.archiveTo(databasePath);
  operationPath = join(root, "operation.json");
  await writeFile(operationPath, JSON.stringify(request));
  archivePath = join(root, "artifact");
  await writeFile(
    archivePath,
    encryptArtifact(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.dump", bytes: await readFile(databasePath) },
        ...secretEntries,
      ]),
      kit.recoveryKey,
    ),
  );
  collected = false;
  hookEntered = false;
  held = undefined;
  modules.splice(0, modules.length, {
    ...fakeModule("test-regime", {
      operations: {
        prepare: async (operation, run) => {
          collected = true;
          expect(operation.input).toEqual({ signed: "opaque" });
          return run({ ...operation, input: "current-evidence" });
        },
      },
    }),
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    backup: {
      restore: async (tx, _node, operation) => {
        hookEntered = true;
        held = operation;
        expect(operation?.input).toBe("current-evidence");
        expect(readOperationAuthority(operation!.authority, request.binding)).toEqual({
          operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "restore-42" },
        });
        await tx.update(locations).set({ name: "Restored with current evidence" });
        return { report: "restored" };
      },
    },
  });
});
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
function target() {
  return {
    stateDir,
    venueDir: join(root, "venue"),
    stagingDir: root,
    migrationsRoot: null,
    modules,
    environment: "preproduction" as const,
    log: () => {},
    migrate: async () => {},
  };
}
async function restored() {
  const opened = await openVenueDatabase(join(root, "venue"));
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe(
      "Restored with current evidence",
    );
  } finally {
    await opened.close();
  }
  expect(readOperationAuthority(held!.authority, request.binding)).toBeUndefined();
  expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(NODE);
}
it("constructs a detached restore runner and authenticates only against the placed database", async () => {
  expect(pending.createRecoveryRestoreRunner).toBeTypeOf("function");
  const submitted = structuredClone(request);
  const runner = pending.createRecoveryRestoreRunner(modules, submitted, nodeKey);
  submitted.binding.eventId = "changed";
  submitted.input.signed = "changed";
  await mintBreakGlassSecret(suite.db, NODE);
  await restoreFromArtifactFile({
    ...target(),
    artifactPath: archivePath,
    recoveryKey: kit.recoveryKey,
    withModuleOperations: runner,
  });
  await restored();
});
it.each(["archive", "bucket"])(
  "builds the authenticated runner from %s command environment input",
  async (kind) => {
    const file = kind === "archive" ? archivePath : join(root, "kit");
    if (kind === "bucket") await writeFile(file, encodeRecoveryKit(kit));
    const lines: string[] = [];
    const result = await runRestore({
      argv: kind === "archive" ? ["restore", file] : ["restore", "--from-bucket", file],
      env: {
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: join(root, "venue"),
        WAITRON_BACKUP_RECOVERY_KEY: kit.recoveryKey,
        WAITRON_RECOVERY_OPERATION_FILE: operationPath,
        WAITRON_NODE_RECOVERY_KEY: nodeKey,
      },
      out: (line) => {
        lines.push(line);
      },
      restore: (args) =>
        restoreFromArtifactFile({
          ...args,
          ...target(),
          withModuleOperations: args.withModuleOperations,
        }),
      restoreStream: (args) =>
        writeStreamRestore({
          ...args,
          ...target(),
          databasePath,
          entries: [
            { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
            ...secretEntries,
          ],
        }),
    });
    expect(result).toBe(0);
    await restored();
    expect(lines.join("\n")).not.toContain(nodeKey);
    expect(lines.join("\n")).not.toContain(kit.recoveryKey);
  },
);
it.each(["archive", "bucket"])(
  "refuses a wrong node key through the %s command before outside collection or secrets publication",
  async (kind) => {
    const file = kind === "archive" ? archivePath : join(root, "kit");
    if (kind === "bucket") await writeFile(file, encodeRecoveryKit(kit));
    const lines: string[] = [];
    const result = await runRestore({
      argv: kind === "archive" ? ["restore", file] : ["restore", "--from-bucket", file],
      env: {
        WAITRON_STATE_DIR: stateDir,
        WAITRON_BACKUP_RECOVERY_KEY: kit.recoveryKey,
        WAITRON_RECOVERY_OPERATION_FILE: operationPath,
        WAITRON_NODE_RECOVERY_KEY: "wrong",
      },
      out: (line) => {
        lines.push(line);
      },
      restore: (args) =>
        restoreFromArtifactFile({
          ...args,
          ...target(),
          withModuleOperations: args.withModuleOperations,
        }),
      restoreStream: (args) =>
        writeStreamRestore({
          ...args,
          ...target(),
          databasePath,
          entries: [
            { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
            ...secretEntries,
          ],
        }),
    });
    expect(result).toBe(1);
    expect(collected).toBe(false);
    expect(hookEntered).toBe(false);
    expect(lines.join("\n")).toContain("promotion.break_glass_invalid");
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it.each(["archive", "stream"] as const)(
  "carries public operation input through a staged %s restart without storing the node key",
  async (kind) => {
    const submitted = structuredClone(request);
    await stageRestoreRequest(
      stateDir,
      kind === "stream"
        ? {
            kind: "stream",
            databasePath,
            entries: [
              { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
              ...secretEntries,
            ],
            environment: "preproduction",
            recoveryOperation: submitted,
          }
        : {
            artifact: await readFile(archivePath),
            recoveryKey: kit.recoveryKey,
            environment: "preproduction",
            recoveryOperation: submitted,
          },
    );
    submitted.binding.eventId = "changed";
    submitted.input.signed = "changed";
    const marker = JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"));
    expect(marker.recoveryOperation).toEqual(request);
    expect(JSON.stringify(marker)).not.toContain(nodeKey);
    expect(
      await runStagedRestore(
        { ...target(), recoverySecret: nodeKey } as Parameters<typeof runStagedRestore>[0] & {
          recoverySecret: unknown;
        },
        (args) =>
          restoreFromArtifactFile({
            ...args,
            ...target(),
            withModuleOperations: args.withModuleOperations,
          }),
        (args) =>
          writeStreamRestore({
            ...args,
            ...target(),
            withModuleOperations: args.withModuleOperations,
          }),
      ),
    ).toBe(true);
    await restored();
    await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["marker", "file"])(
  "reconstructs the staged runner from %s input and the entry process key before starting the server",
  async (source) => {
    await stageRestoreRequest(stateDir, {
      artifact: await readFile(archivePath),
      recoveryKey: kit.recoveryKey,
      environment: "preproduction",
      ...(source === "marker" ? { recoveryOperation: request } : {}),
    });
    let started = false;
    const entry = runEntry({
      args: [],
      baseEnv: {
        WAITRON_NODE_RECOVERY_KEY: nodeKey,
        ...(source === "file" ? { WAITRON_RECOVERY_OPERATION_FILE: operationPath } : {}),
      },
      stateDir,
      venueDir: join(root, "venue"),
      log: () => {},
      logDir: join(root, "logs"),
      readRecoveryState: async () => FRESH,
      writeRecoveryState: async () => {},
      withRecoveryLock: (_state, run) => run(),
      runStagedRestore: (deps) =>
        runStagedRestore(deps, (args) =>
          restoreFromArtifactFile({
            ...args,
            ...target(),
            withModuleOperations: args.withModuleOperations,
          }),
        ),
      runStagedReset: async () => false,
      assertNotAhead: async () => {},
      clearReplacedDatabases: async () => {},
      lockVenue: async () => ({ release: () => {} }),
      loadBoxEnv: async (env) => env,
      startServer: async () => {
        started = true;
        return { close: async () => {} };
      },
      installShutdownHandlers: () => {},
      scheduleStayedUp: () => {},
      serveRecovery: async () => {
        throw new Error("unexpected recovery page");
      },
    });
    await expect(entry).resolves.toBeUndefined();
    expect(started).toBe(true);
    await restored();
    expect(await readFile(join(root, "logs", "waitron.log"), "utf8")).not.toContain(nodeKey);
  },
);

it.each(["promote", "re-register"])(
  "refuses a %s operation before constructing a cold-restore runner",
  (action) => {
    expect(() =>
      pending.createRecoveryRestoreRunner(
        modules,
        { ...request, binding: { ...request.binding, action } },
        nodeKey,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "module.operation_invalid",
        params: { module: "test-regime" },
      }),
    );
  },
);
it("refuses an unselected restore module before constructing a runner", () => {
  expect(() => pending.createRecoveryRestoreRunner([], request, nodeKey)).toThrowError(
    expect.objectContaining({
      code: "module.operation_invalid",
      params: { module: "test-regime" },
    }),
  );
});
it("refuses a malformed operation before constructing a runner", () => {
  expect(() =>
    pending.createRecoveryRestoreRunner(modules, { ...request, input: undefined }, nodeKey),
  ).toThrowError(
    expect.objectContaining({
      code: "server.config_invalid",
      params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "invalid_operation" },
    }),
  );
});
it.each(["invalid", "wrong-action"])(
  "preserves the previous staged request when new operation input is %s",
  async (kind) => {
    await stageRestoreRequest(stateDir, {
      artifact: await readFile(archivePath),
      recoveryKey: kit.recoveryKey,
      environment: "preproduction",
    });
    const previous = await readFile(join(stateDir, "restore-request.json"));
    const recoveryOperation =
      kind === "invalid"
        ? { ...request, input: undefined }
        : { ...request, binding: { ...request.binding, action: "re-register" } };
    await expect(
      stageRestoreRequest(stateDir, {
        artifact: Buffer.from("new"),
        recoveryKey: "replacement",
        environment: "preproduction",
        recoveryOperation,
      }),
    ).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "invalid_operation" },
    });
    expect(await readFile(join(stateDir, "restore-request.json"))).toEqual(previous);
    expect(await readFile(join(stateDir, "restore-request.artifact"))).toEqual(
      await readFile(archivePath),
    );
  },
);

it.each(["archive", "stream"] as const)(
  "authenticates a browser-staged %s node key against the selected copy after a live-key change",
  async (kind) => {
    request.binding.sourceId =
      kind === "stream"
        ? await recoveryStreamSourceId(databasePath, [
            { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
            ...secretEntries,
          ])
        : recoveryArchiveSourceId(await readFile(archivePath));
    await stageRestoreRequest(
      stateDir,
      kind === "stream"
        ? {
            kind: "stream",
            databasePath,
            entries: [
              { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
              ...secretEntries,
            ],
            environment: "preproduction",
            recoveryOperation: request,
            nodeRecoverySecret: nodeKey,
          }
        : {
            artifact: await readFile(archivePath),
            recoveryKey: kit.recoveryKey,
            environment: "preproduction",
            recoveryOperation: request,
            nodeRecoverySecret: nodeKey,
          },
    );
    const replacementKey = await mintBreakGlassSecret(suite.db, NODE);
    const log = vi.fn();
    await expect(
      runStagedRestore(
        { ...target(), log, recoverySecret: replacementKey },
        (args) =>
          restoreFromArtifactFile({
            ...args,
            ...target(),
            log,
            withModuleOperations: args.withModuleOperations,
          }),
        (args) =>
          writeStreamRestore({
            ...args,
            ...target(),
            log,
            withModuleOperations: args.withModuleOperations,
          }),
      ),
    ).resolves.toBe(true);
    await restored();
    expect(collected).toBe(true);
    expect(hookEntered).toBe(true);
    await expect(readFile(join(stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(nodeKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(kit.recoveryKey);
  },
);

it.each(["wrong", "outside-refusal"])(
  "refuses a browser-staged key on %s without publishing a trading identity",
  async (mode) => {
    request.binding.sourceId = recoveryArchiveSourceId(await readFile(archivePath));
    await stageRestoreRequest(stateDir, {
      artifact: await readFile(archivePath),
      recoveryKey: kit.recoveryKey,
      environment: "preproduction",
      recoveryOperation: request,
      nodeRecoverySecret: mode === "wrong" ? "wrong-node-key" : nodeKey,
    });
    const stagedRequest = await readFile(join(stateDir, "restore-request.json"));
    if (mode === "outside-refusal")
      modules[0] = {
        ...modules[0]!,
        operations: {
          prepare: async () => {
            collected = true;
            throw new AppError("module.operation_invalid", { module: "test-regime" });
          },
        },
      };
    await expect(
      runStagedRestore({ ...target(), recoverySecret: nodeKey }, (args) =>
        restoreFromArtifactFile({
          ...args,
          ...target(),
          withModuleOperations: args.withModuleOperations,
        }),
      ),
    ).rejects.toMatchObject({
      code: mode === "wrong" ? "promotion.break_glass_invalid" : "module.operation_invalid",
    });
    expect(collected).toBe(mode === "outside-refusal");
    expect(hookEntered).toBe(false);
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "restore-request.node-key"), "utf8")).toBe(
      mode === "wrong" ? "wrong-node-key" : nodeKey,
    );
    expect(await readFile(join(stateDir, "restore-request.json"))).toEqual(stagedRequest);
  },
);

afterEach(() => {
  request.binding.sourceId = "archive-42";
});
