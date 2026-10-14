import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deployment,
  invoiceSeries,
  openVenueDatabase,
  readStandardSeriesId,
  sales,
  withTransaction,
} from "@waitron/db";
import { eq, sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import {
  fiscalAllocations,
  registrosFacturacion,
  VerifactuBackend,
} from "@waitron/fiscal-verifactu";
import { recordSale } from "@waitron/core";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { orderedMigrationSets } from "@waitron/module";
import { locationId, seriesId as brandSeriesId } from "@waitron/shared";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { ALL_MODULES } from "./modules.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { runRestoreHooks } from "./restore.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { migrationOptionsFor } from "@waitron/migrations";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const encryptionKey = "synthetic archive encryption key";
let root: string;
let stateDir: string;
let outside: string;
let databasePath: string;
let nodeKey: string;
let originalRecords: (typeof registrosFacturacion.$inferSelect)[];
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: TENANT_A.nodeId })));
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: TENANT_A.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: "P000001",
    }),
  );
  nodeKey = await mintBreakGlassSecret(suite.db, TENANT_A.nodeId);
  const backend = new VerifactuBackend({
    db: suite.db,
    deploymentEnvironment: "preproduction",
    clock: steadyClock,
    resolveClient: async () => {
      throw new Error("the source backup has no network");
    },
  });
  const seriesId = await readStandardSeriesId(suite.db, TENANT_A.nodeId);
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({ nodeId: TENANT_A.nodeId, seriesId: brandSeriesId(seriesId) }),
    ),
  );
  originalRecords = await suite.db.select().from(registrosFacturacion);
  expect(originalRecords).toHaveLength(1);
  root = await mkdtemp(join(tmpdir(), "emergency-restore-"));
  stateDir = join(root, "state");
  outside = join(root, "outside-register");
  await mkdir(stateDir);
  await mkdir(outside);
  databasePath = join(root, "backup.db");
  await suite.db.archiveTo(databasePath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", undefined);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", undefined);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", join(root, "current.json"));
  vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", outside);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function stage(
  kind: "archive" | "stream",
  changedApproval = {},
  eventId = "emergency-offline-restore",
) {
  const previousOutside = await readdir(outside);
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date("2026-10-01T08:00:00.000Z"),
  });
  const entries = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    {
      name: "secrets/trading.env",
      bytes: Buffer.from(
        `WAITRON_TILL_NODE_ID=${TENANT_A.nodeId}\nWAITRON_TILL_LOCATION_ID=${TENANT_A.locationId}\nWAITRON_ENV=preproduction\n`,
      ),
    },
  ];
  const artifact = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(databasePath) }]),
    encryptionKey,
  );
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId,
    sourceId:
      kind === "archive"
        ? recoveryArchiveSourceId(artifact)
        : await recoveryStreamSourceId(databasePath, entries),
    targetNodeId: TENANT_A.nodeId,
  };
  const operatorId = { kind: "recovery-key", nodeId: TENANT_A.nodeId, eventId: binding.eventId };
  const incidentEvidence = `outside/${eventId}`;
  const recoveryOperation = {
    binding,
    input: {
      emergency: { version: 1 },
      approval: {
        version: 1,
        eventId: binding.eventId,
        operatorId,
        sourceId: binding.sourceId,
        targetNodeId: TENANT_A.nodeId,
        oldMachineOffline: true,
        oldMachineAbsent: false,
        noParallelRecovery: true,
        confirmedAt: "2026-10-14T18:25:00.000Z",
        incidentEvidence,
        ...changedApproval,
      },
    },
  };
  const common = {
    environment: "preproduction" as const,
    recoveryOperation,
    nodeRecoverySecret: nodeKey,
  };
  await stageRestoreRequest(
    stateDir,
    kind === "archive"
      ? { ...common, artifact, recoveryKey: encryptionKey }
      : { ...common, kind: "stream", databasePath, entries },
  );
  expect(await readdir(outside)).toEqual(previousOutside);
  await writeFile(
    join(root, "current.json"),
    JSON.stringify({
      version: 1,
      priorActivation: "none",
      binding,
      operatorId,
      taxpayerNif: "89890001K",
      environment: "preproduction",
      requiredBases: bases,
      incidentEvidence,
      knownIdentities: null,
      uncertaintyRecorded: true,
    }),
  );
}

it("refuses a resumed database from a newer image before migration or outside consumption", async () => {
  await stage("archive");
  const venueDir = join(root, "venue");
  await mkdir(venueDir);
  await cp(databasePath, join(venueDir, "venue.db"));
  const target = await openVenueDatabase(venueDir);
  try {
    await target.venue.run(
      sql`insert into __drizzle_migrations_db (hash, created_at) values (${"f".repeat(64)}, 99999999999999)`,
    );
  } finally {
    await target.close();
  }
  const markerPath = join(stateDir, "restore-request.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  await writeFile(markerPath, JSON.stringify({ ...marker, placementStarted: true }));
  await expect(
    runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: () => {} }),
  ).rejects.toMatchObject({ code: "provisioning.database_ahead" });
  expect(await readdir(outside)).toEqual([]);
  expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
});

it("refuses a resume without a placed database instead of treating the stage marker as permission", async () => {
  await stage("archive");
  const markerPath = join(stateDir, "restore-request.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  await writeFile(markerPath, JSON.stringify({ ...marker, placementStarted: true }));
  await expect(
    runStagedRestore({
      stateDir,
      venueDir: join(root, "venue"),
      migrationsRoot: null,
      log: () => {},
    }),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readdir(outside)).toEqual([]);
});

it.each(["archive", "stream"] as const)(
  "a %s stage marker cannot substitute for a committed activation",
  async (kind) => {
    await stage(kind);
    const venueDir = join(root, "venue");
    await mkdir(venueDir);
    await cp(
      kind === "stream" ? join(stateDir, "restore-request.db") : databasePath,
      join(venueDir, "venue.db"),
    );
    const markerPath = join(stateDir, "restore-request.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    await writeFile(markerPath, JSON.stringify({ ...marker, placementStarted: true }));
    await expect(
      runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: () => {} }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "prior_activation_requires_replay" },
    });
    const copy = await openVenueDatabase(venueDir);
    try {
      expect(await copy.venue.select().from(fiscalAllocations)).toEqual([]);
    } finally {
      await copy.close();
    }
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["archive", "stream"] as const)(
  "keeps the committed %s activation after a process is killed before publishing trading settings",
  async (kind) => {
    await stage(kind);
    const venueDir = join(root, "venue");
    const previousIdentity = `# existing physical box\nWAITRON_TILL_NODE_ID=${TENANT_A.nodeId}\nWAITRON_TILL_LOCATION_ID=${TENANT_A.locationId}\nWAITRON_ENV=preproduction\n`;
    await writeFile(join(stateDir, "trading.env"), previousIdentity, { mode: 0o600 });
    await mkdir(venueDir);
    await cp(
      kind === "stream" ? join(stateDir, "restore-request.db") : databasePath,
      join(venueDir, "venue.db"),
    );
    const output = await killRestore("before-publication");
    expect(output).not.toContain(nodeKey);
    expect(output).not.toContain(encryptionKey);
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    const marker = JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"));
    const confirmationPath = join(root, "current.json");
    const confirmation = JSON.parse(await readFile(confirmationPath, "utf8"));
    await writeFile(
      confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "committed" }),
    );
    let committed: unknown[];
    const copy = await openVenueDatabase(venueDir);
    try {
      committed = await copy.venue.select().from(fiscalAllocations);
      expect(committed).toHaveLength(1);
      // The same current outside confirmation and key can replay against the placed database.
      await runRestoreHooks({
        db: copy.venue,
        node: { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
        modules: ALL_MODULES,
        log: () => {},
        withModuleOperations: createRecoveryRestoreRunner(
          ALL_MODULES,
          marker.recoveryOperation,
          nodeKey,
        ),
      });
      expect(await copy.venue.select().from(fiscalAllocations)).toEqual(committed);
    } finally {
      await copy.close();
    }
    const attempt = () =>
      runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: () => {} });
    const expectRetained = async () => {
      const current = await openVenueDatabase(venueDir);
      try {
        expect(await current.venue.select().from(fiscalAllocations)).toEqual(committed);
        expect(await current.venue.select().from(registrosFacturacion)).toEqual(originalRecords);
      } finally {
        await current.close();
      }
      expect(
        JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8")).placementStarted,
      ).toBe(true);
      await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    };
    await writeFile(
      confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "uncertain" }),
    );
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "uncertain_prior_activation" },
    });
    await expectRetained();
    await writeFile(
      confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "committed" }),
    );
    await writeFile(join(stateDir, "restore-request.node-key"), "wrong-node-key");
    await expect(attempt()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expectRetained();
    await writeFile(join(stateDir, "restore-request.node-key"), nodeKey);
    const originalMarker = await readFile(join(stateDir, "restore-request.json"), "utf8");
    await writeFile(
      join(stateDir, "restore-request.json"),
      JSON.stringify({
        ...marker,
        recoveryOperation: {
          ...marker.recoveryOperation,
          binding: { ...marker.recoveryOperation.binding, sourceId: "different-copy" },
        },
      }),
    );
    await expect(attempt()).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { reason: "source_mismatch" },
    });
    await expectRetained();
    await writeFile(join(stateDir, "restore-request.json"), originalMarker);
    let retryError: unknown;
    try {
      await runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: () => {} });
    } catch (error) {
      retryError = error;
    }
    const after = await openVenueDatabase(venueDir);
    try {
      expect(
        await after.venue.select().from(fiscalAllocations),
        "restart must preserve the exact locally committed recovery result",
      ).toEqual(committed);
    } finally {
      await after.close();
    }
    expect(retryError).toBeUndefined();
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(TENANT_A.nodeId);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(TENANT_A.locationId);
    expect(await readFile(join(stateDir, "trading.env.replaced"), "utf8")).toBe(previousIdentity);
    expect(await attempt()).toBe(false);
    const selling = await openVenueDatabase(venueDir);
    let networkCalls = 0;
    try {
      const backend = new VerifactuBackend({
        db: selling.venue,
        deploymentEnvironment: "preproduction",
        clock: steadyClock,
        resolveClient: async () => {
          networkCalls++;
          throw new Error("recovery test has no network");
        },
      });
      const seriesId = await readStandardSeriesId(selling.venue, TENANT_A.nodeId);
      const result = await withTransaction(selling.venue, (tx) =>
        recordSale(
          tx,
          backend,
          saleInput({ nodeId: TENANT_A.nodeId, seriesId: brandSeriesId(seriesId) }),
        ),
      );
      const [sale] = await selling.venue.select().from(sales).where(eq(sales.id, result.saleId));
      expect(sale?.invoiceNumber).toBe(1);
      const rows = await selling.venue.select().from(registrosFacturacion);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.saleId !== result.saleId)).toEqual(originalRecords);
      const allocation = (await selling.venue.select().from(fiscalAllocations))[0]!;
      const issued = rows.find((row) => row.saleId === result.saleId);
      expect(issued).toMatchObject({
        saleId: result.saleId,
        sifId: allocation.sifId,
        primerRegistro: true,
        secuencia: 2,
      });
      expect(issued!.numSerieFactura).toBe(
        `${allocation.allocation.series.find((series) => series.purpose === "standard")!.code}/1`,
      );
      expect(networkCalls).toBe(0);
    } finally {
      await selling.close();
    }
  },
);

async function killRestore(phase: string) {
  const migrationsRoot = join(root, "migrations");
  const sets = orderedMigrationSets(ALL_MODULES);
  const options = migrationOptionsFor(sets, null);
  for (let i = 0; i < options.length; i++)
    await cp(options[i]!.migrationsFolder, join(migrationsRoot, sets[i]!.name), {
      recursive: true,
    });
  const entry = join(root, "crash-entry.mjs");
  const binary = join(root, "crash-binary.mjs");
  await writeFile(
    entry,
    `
      import nativeFs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import { join } from "node:path";
      import { writeSync } from "node:fs";
      import { runStagedRestore } from ${JSON.stringify(resolve("src/restore-request.ts"))};
      const [stateDir, venueDir, migrationsRoot, phase] = process.argv.slice(2);
      const wait = async () => { console.log("RECOVERY_CRASH_GATE"); await new Promise(() => { setInterval(() => {}, 1000); }); };
      if (phase === "staged") await wait();
      const original = nativeFs.writeFile;
      const openOriginal = nativeFs.open;
      nativeFs.open = async (path, flags, ...rest) => {
        if (phase === "outside-consumed" && String(path).startsWith(process.env.WAITRON_FISCAL_EMERGENCY_DIRECTORY + "/") && String(path).endsWith(".json") && flags === "r") await wait();
        return openOriginal(path, flags, ...rest);
      };
      nativeFs.writeFile = async (path, ...args) => {
        if (phase === "before-publication" && String(path) === join(stateDir, "trading.env.tmp")) {
          console.log("RECOVERY_CRASH_GATE");
          await new Promise(() => { setInterval(() => {}, 1000); });
        }
        return original(path, ...args);
      };
      syncBuiltinESMExports();
      await runStagedRestore({ stateDir, venueDir, migrationsRoot, log: (_level,event,fields) => {
        if (phase === "before-commit" && event === "restore.hook.done" && fields?.module === "fiscal-verifactu") {
          writeSync(1,"RECOVERY_CRASH_GATE\\n"); process.kill(process.pid,"SIGSTOP");
        }
      } });
      if (phase === "before-first-sale") await wait();
      throw new Error("publication gate was not reached");
    `,
  );
  const built = spawnSync(
    process.execPath,
    [resolve("../../scripts/bundle-node.mjs"), `${entry}=${binary}`],
    { encoding: "utf8", timeout: 30_000 },
  );
  expect(built.status, built.stderr).toBe(0);
  const venueDir = join(root, "venue");
  const child = spawn(process.execPath, [binary, stateDir, venueDir, migrationsRoot, phase], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  let output = "";
  const ready = new Promise<void>((resolveReady) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("RECOVERY_CRASH_GATE\n")) resolveReady();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  });
  const deadline = AbortSignal.timeout(15_000);
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline.addEventListener("abort", () => reject(new Error(`crash gate timed out: ${output}`)), {
      once: true,
    });
  });
  try {
    await Promise.race([
      ready,
      timedOut,
      exited.then((result) => {
        throw new Error(`child exited before gate: ${JSON.stringify(result)} ${output}`);
      }),
    ]);
    expect(child.pid).toBeGreaterThan(0);
    expect(child.kill("SIGKILL")).toBe(true);
    await expect(exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
  return output;
}

it.each(["archive", "stream"] as const)(
  "a %s restore stopped after staging can start normally",
  async (kind) => {
    await stage(kind);
    await killRestore("staged");
    expect(await readdir(outside)).toEqual([]);
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: () => {},
      }),
    ).resolves.toBe(true);
  },
);
it.each(["archive", "stream"] as const)(
  "a completed %s restore stopped before its first sale does not activate twice",
  async (kind) => {
    await stage(kind);
    await killRestore("before-first-sale");
    const before = await readdir(outside);
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: () => {},
      }),
    ).resolves.toBe(false);
    expect(await readdir(outside)).toEqual(before);
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      expect(await copy.venue.select().from(fiscalAllocations)).toHaveLength(1);
      expect(await copy.venue.select().from(registrosFacturacion)).toEqual(originalRecords);
    } finally {
      await copy.close();
    }
  },
);
for (const kind of ["archive", "stream"] as const)
  for (const phase of ["outside-consumed", "before-commit"]) {
    it(`burns the ${kind} identity when killed at ${phase} without a local committed result`, async () => {
      await stage(kind);
      await killRestore(phase);
      const before = await readdir(outside);
      const incident = before.find((name) => name.endsWith(".json"))!;
      const consumed = await readFile(join(outside, incident), "utf8");
      const oldIdentity = JSON.parse(consumed).allocation.installationIdentity;
      const copy = await openVenueDatabase(join(root, "venue"));
      try {
        expect(await copy.venue.select().from(fiscalAllocations)).toEqual([]);
        expect(await copy.venue.select().from(registrosFacturacion)).toEqual(originalRecords);
      } finally {
        await copy.close();
      }
      await expect(
        runStagedRestore({
          stateDir,
          venueDir: join(root, "venue"),
          migrationsRoot: null,
          log: () => {},
        }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "allocation_consumed" },
      });
      expect(await readFile(join(outside, incident), "utf8")).toBe(consumed);
      await suite.db.archiveTo(databasePath);
      await stage(kind, {}, "fresh-after-interruption");
      await expect(
        runStagedRestore({
          stateDir,
          venueDir: join(root, "venue"),
          migrationsRoot: null,
          log: () => {},
        }),
      ).resolves.toBe(true);
      expect(await readFile(join(outside, incident), "utf8")).toBe(consumed);
      const active = await openVenueDatabase(join(root, "venue"));
      try {
        const rows = await active.venue.select().from(fiscalAllocations);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.installationIdentity).not.toBe(oldIdentity);
        expect(rows[0]!.eventKey).toBe("fresh-after-interruption");
        expect(await active.venue.select().from(registrosFacturacion)).toEqual(originalRecords);
      } finally {
        await active.close();
      }
    });
  }
