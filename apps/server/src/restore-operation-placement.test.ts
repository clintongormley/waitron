import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { AppError } from "@waitron/shared";
import { mintBreakGlassSecret } from "./break-glass.js";
import { ALL_MODULES } from "./modules.js";
import { runRestore } from "./restore-command.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { writeStreamRestore } from "./restore-stream.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { withRecoveryKeyOperation } from "./operation-authentication.js";
import { restoreFromArtifactFile, writeValidated, type PlacementDeps } from "./restore.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-42",
  sourceId: "archive-42",
  targetNodeId: NODE,
};
const input = { signedAllocation: "opaque-module-payload" };
const dirs: string[] = [];
let nodeKey: string;
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Restaurant" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Restored node" });
  await suite.db.insert(invoiceSeries).values([
    { nodeId: NODE, code: "A", purpose: "standard" },
    { nodeId: NODE, code: "FF", purpose: "full" },
    { nodeId: NODE, code: "R", purpose: "rectificative" },
  ]);
  nodeKey = await mintBreakGlassSecret(suite.db, NODE);
});
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(module: WaitronModule) {
  const root = await mkdtemp(join(tmpdir(), "restore-operation-placement-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(stateDir);
  const databasePath = join(root, "archive.db");
  await suite.db.archiveTo(databasePath);
  const validated = {
    databasePath,
    discard: async () => {},
    manifest: {
      manifestVersion: 1 as const,
      createdAt: "2026-10-12T09:00:00.000Z",
      environment: "preproduction" as const,
      modules: {},
    },
    secretEntries: [
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
      },
    ],
  };
  const deps: PlacementDeps = {
    stateDir,
    venueDir: join(root, "venue"),
    stagingDir: root,
    migrationsRoot: null,
    modules: [module],
    environment: "preproduction",
    migrate: async () => {},
    log: () => {},
    withModuleOperations: ({ db, node }, run) =>
      withRecoveryKeyOperation({ db, nodeId: node.nodeId }, binding, nodeKey, (tx, authority) =>
        run(tx, new Map([[binding.module, { input, binding, authority }]])),
      ),
  };
  return { validated, deps };
}

function regime(hook: NonNullable<WaitronModule["backup"]>["restore"]): WaitronModule {
  return {
    ...fakeModule(binding.module),
    migrations: ALL_MODULES.find((m) => m.name === "core")!.migrations,
    backup: { restore: hook },
  };
}

it("authenticates against the placed database and keeps the scoped authority alive through its hook", async () => {
  let held: ModuleOperationInput | undefined;
  const f = await fixture(
    regime(async (tx, _node, operation) => {
      held = operation;
      expect(operation).toBeDefined();
      expect(operation!.input).toEqual(input);
      expect(readOperationAuthority(operation!.authority, binding)).toEqual({
        operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "restore-42" },
      });
      await tx.update(locations).set({ name: "Restored through authority" });
      return { report: "restored" };
    }),
  );
  await writeValidated(f.validated, f.deps);
  expect(readOperationAuthority(held!.authority, binding)).toBeUndefined();
  const opened = await openVenueDatabase(f.deps.venueDir);
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe(
      "Restored through authority",
    );
    expect((await opened.venue.select().from(invoiceSeries)).map((row) => row.code).sort()).toEqual(
      ["A", "FF", "R"],
    );
  } finally {
    await opened.close();
  }
  expect(await readFile(join(f.deps.stateDir, "trading.env"), "utf8")).toContain(NODE);
});

it("refuses a wrong node key before hooks or restored identity are published", async () => {
  let entered = false;
  const f = await fixture(
    regime(async () => {
      entered = true;
      return { report: "unexpected" };
    }),
  );
  nodeKey = "wrong";
  await expect(writeValidated(f.validated, f.deps)).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
  expect(entered).toBe(false);
  await expect(readFile(join(f.deps.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rolls authentication and earlier hook writes back together when a later module refuses", async () => {
  const f = await fixture(
    regime(async (tx) => {
      expect((await tx.select().from(nodes))[0]!.name).toBe("authentication write");
      await tx.update(locations).set({ name: "hook write" });
      return { report: "first" };
    }),
  );
  f.deps = {
    ...f.deps,
    modules: [
      ...f.deps.modules,
      {
        ...fakeModule("second"),
        migrations: ALL_MODULES.find((m) => m.name === "identity")!.migrations,
        backup: {
          restore: async () => {
            throw new AppError("restore.series_conflict", { modules: "second" });
          },
        },
      },
    ],
    withModuleOperations: ({ db, node }, run) =>
      withRecoveryKeyOperation(
        { db, nodeId: node.nodeId },
        binding,
        nodeKey,
        async (tx, authority) => {
          await tx.update(nodes).set({ name: "authentication write" });
          return run(tx, new Map([[binding.module, { input, binding, authority }]]));
        },
      ),
  };
  await expect(writeValidated(f.validated, f.deps)).rejects.toMatchObject({
    code: "restore.hook_failed",
    params: { module: "second", code: "restore.series_conflict" },
  });
  const opened = await openVenueDatabase(f.deps.venueDir);
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe("Restaurant");
    expect((await opened.venue.select().from(nodes))[0]!.name).toBe("Restored node");
  } finally {
    await opened.close();
  }
  await expect(readFile(join(f.deps.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("never authenticates or calls hooks when the restore keeps the target identity", async () => {
  let entered = false;
  const f = await fixture(
    regime(async () => {
      entered = true;
      return { report: "unexpected" };
    }),
  );
  await writeFile(join(f.deps.stateDir, "trading.env"), "target identity");
  await writeValidated(f.validated, {
    ...f.deps,
    skipSecrets: true,
    withModuleOperations: async () => {
      throw new Error("unexpected authentication");
    },
  });
  expect(entered).toBe(false);
  expect(await readFile(join(f.deps.stateDir, "trading.env"), "utf8")).toBe("target identity");
});

it("snapshots operation inputs issued by the host before an earlier restore hook awaits", async () => {
  const suppliedBinding = { ...binding };
  const f = await fixture(
    regime(async (tx, _node, operation) => {
      expect(operation!.binding).toEqual(binding);
      expect(operation!.input).toEqual(input);
      await tx.update(locations).set({ name: "Snapshot kept" });
      return { report: "restored" };
    }),
  );
  await expect(
    writeValidated(f.validated, {
      ...f.deps,
      withModuleOperations: ({ db, node }, run) =>
        withRecoveryKeyOperation({ db, nodeId: node.nodeId }, binding, nodeKey, (tx, authority) => {
          const operations = new Map([
            [binding.module, { input, binding: suppliedBinding, authority }],
          ]);
          return run(tx, operations);
        }),
      modules: [
        {
          ...fakeModule("earlier"),
          migrations: ALL_MODULES.find((m) => m.name === "identity")!.migrations,
          backup: {
            restore: async () => {
              suppliedBinding.eventId = "changed";
              return { report: "first" };
            },
          },
        },
        ...f.deps.modules,
      ],
    }),
  ).resolves.toBeUndefined();
  const opened = await openVenueDatabase(f.deps.venueDir);
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe("Snapshot kept");
  } finally {
    await opened.close();
  }
});

it.each(["archive", "stream"] as const)(
  "reconstructs operation authority after a staged %s request, without persisting the node key",
  async (kind) => {
    const f = await fixture(
      regime(async (tx, _node, operation) => {
        expect(operation).toBeDefined();
        await tx.update(locations).set({ name: "Staged with authority" });
        return { report: "restored" };
      }),
    );
    await stageRestoreRequest(
      f.deps.stateDir,
      kind === "archive"
        ? {
            artifact: Buffer.from("encrypted artifact"),
            recoveryKey: "backup-key",
            environment: "preproduction",
          }
        : {
            kind: "stream",
            databasePath: f.validated.databasePath,
            entries: f.validated.secretEntries,
            environment: "preproduction",
          },
    );
    const apply = async (args: {
      withModuleOperations?: PlacementDeps["withModuleOperations"];
    }) => {
      await writeValidated(
        {
          ...f.validated,
          databasePath:
            kind === "stream"
              ? join(f.deps.stateDir, "restore-request.db")
              : f.validated.databasePath,
        },
        { ...f.deps, withModuleOperations: args.withModuleOperations },
      );
    };
    expect(await readFile(join(f.deps.stateDir, "restore-request.json"), "utf8")).not.toContain(
      nodeKey,
    );
    expect(
      await runStagedRestore(
        {
          stateDir: f.deps.stateDir,
          venueDir: f.deps.venueDir,
          migrationsRoot: null,
          log: () => {},
          withModuleOperations: f.deps.withModuleOperations,
        },
        apply,
        apply,
      ),
    ).toBe(true);
    const opened = await openVenueDatabase(f.deps.venueDir);
    try {
      expect((await opened.venue.select().from(locations))[0]!.name).toBe("Staged with authority");
    } finally {
      await opened.close();
    }
  },
);

it.each(["archive", "bucket"] as const)(
  "passes the trusted operation runner through the %s command without using its backup key as node authority",
  async (kind) => {
    const f = await fixture(
      regime(async (tx, _node, operation) => {
        expect(operation).toBeDefined();
        await tx.update(locations).set({ name: "CLI with authority" });
        return { report: "restored" };
      }),
    );
    const file = join(f.deps.stagingDir, "command-input");
    const kit = {
      version: 1 as const,
      venueId: "c0000000-0000-4000-8000-000000000002",
      bucket: {
        endpoint: "https://s3.example.net",
        region: "eu-west-1",
        bucket: "venue-copy",
        prefix: "waitron/",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "not-a-real-secret-0123456789",
      },
      recoveryKey: "recovery-key-one-strong",
      pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
    };
    await writeFile(file, kind === "bucket" ? encodeRecoveryKit(kit) : "encrypted artifact");
    const apply = async (args: { withModuleOperations?: PlacementDeps["withModuleOperations"] }) =>
      writeValidated(f.validated, { ...f.deps, withModuleOperations: args.withModuleOperations });
    const lines: string[] = [];
    expect(
      await runRestore({
        argv: kind === "archive" ? ["restore", file] : ["restore", "--from-bucket", file],
        env: { WAITRON_BACKUP_RECOVERY_KEY: "backup-key" },
        out: (line) => {
          lines.push(line);
        },
        restore: apply,
        restoreStream: apply,
        withModuleOperations: f.deps.withModuleOperations,
      }),
    ).toBe(0);
    const opened = await openVenueDatabase(f.deps.venueDir);
    try {
      expect((await opened.venue.select().from(locations))[0]!.name).toBe("CLI with authority");
    } finally {
      await opened.close();
    }
    expect(lines.join("\n")).not.toContain(nodeKey);
  },
);

it("carries the runner through real stream validation and placement", async () => {
  const f = await fixture(
    regime(async (tx, _node, operation) => {
      expect(operation).toBeDefined();
      await tx.update(locations).set({ name: "Stream with authority" });
      return { report: "restored" };
    }),
  );
  await writeStreamRestore({
    ...f.deps,
    databasePath: f.validated.databasePath,
    entries: [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(f.validated.manifest)) },
      ...f.validated.secretEntries,
    ],
  });
  const opened = await openVenueDatabase(f.deps.venueDir);
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe("Stream with authority");
  } finally {
    await opened.close();
  }
});

it("carries the runner through encrypted file validation and placement with a separate backup key", async () => {
  const f = await fixture(
    regime(async (tx, _node, operation) => {
      expect(operation).toBeDefined();
      await tx.update(locations).set({ name: "Archive with authority" });
      return { report: "restored" };
    }),
  );
  const artifactPath = join(f.deps.stagingDir, "encrypted-backup");
  const recoveryKey = "backup encryption key, not the node key";
  await writeFile(
    artifactPath,
    encryptArtifact(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(f.validated.manifest)) },
        { name: "db.dump", bytes: await readFile(f.validated.databasePath) },
        ...f.validated.secretEntries,
      ]),
      recoveryKey,
    ),
  );
  await restoreFromArtifactFile({ ...f.deps, artifactPath, recoveryKey });
  const opened = await openVenueDatabase(f.deps.venueDir);
  try {
    expect((await opened.venue.select().from(locations))[0]!.name).toBe("Archive with authority");
  } finally {
    await opened.close();
  }
});
