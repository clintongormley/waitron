import "undici";
import "@waitron/credentials";
import "../src/node-identity.js";
import "../src/box-secrets.js";
import "../src/rebuild-first-start.js";
import "../src/boot.js";
import "../src/testing/free-ports.js";
import "node:net";
import "node:tls";
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi, type Mock } from "vitest";
import { invoiceSeries, stampDeployment, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { readHourHistory } from "@waitron/fiscal-verifactu/src/hour-history-reader.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { locationId, seriesId } from "@waitron/shared";
import { mintBreakGlassKey } from "../src/break-glass.js";
import "../src/recovery-module-operation.js";
import { validateArtifact } from "../src/restore.js";
import {
  createSelectedRecoveryPreparation,
  createInteractiveRecoveryPreparation,
} from "../src/recovery-preparation.js";
import "../src/operation-authentication.js";
import { buildManifest } from "../src/backup-manifest.js";
import { packArchive, unpackArchive } from "../src/backup-archive.js";
import { decryptArtifact, encryptArtifact } from "../src/artifact-cipher.js";
import { previewRecoveryArchive, previewRecoveryStream } from "../src/recovery-backup-preview.js";
import { restoreFromStream } from "../src/restore-stream.js";
import { recoveryStreamSourceId } from "../src/recovery-source.js";
import "../src/restore-command.js";
import "../src/archive-recovery-pack.js";
import { stageRestoreRequest } from "../src/restore-request.js";
import { Hono } from "hono";
import { mountSetup, type SetupDeps } from "../src/setup-api.js";
import { eq, sql } from "drizzle-orm";
import "node:child_process";
import "node:util";
import { createHash } from "node:crypto";
import { recordSale } from "@waitron/core";
import { assertValid, computeHuella } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { createCloudRecoveryClient } from "../src/cloud-recovery.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "../src/sealed-state.js";

const mocked = vi.hoisted(() => ({ internet: vi.fn() }));
export const external: { internet: Mock } = mocked;
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: mocked.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
export const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
export const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
export const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "durable-recovery",
  sourceId: "exact-selected-backup",
  targetNodeId: node.nodeId,
};
export const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
export const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
export let root: string;
export let key: { secret: string; name: string };
let value: unknown;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hour-recovery-host-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "unavailable",
    reason: "offline",
  }));
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  key = await mintBreakGlassKey(suite.db, node.nodeId);
  value = null;
  const first = { ...binding, action: "setup", eventId: "original" };
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => 0,
    read: async () => ({
      scope,
      bases,
      contextKey: "first",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        [
          {
            source: "box",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          },
          {
            source: "browser",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          },
        ],
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  await withOperationAuthority(first, "administrator", async (authority) => {
    const selected = await setup.select({ binding: first, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("initial selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
  });
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});
export async function host() {
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const facts = {
    country: "ES",
    taxId: scope.taxpayerNif,
    environment: scope.environment,
    bases,
    contextKey: JSON.stringify([binding, key.name]),
    history: [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))],
    oldMachineAbsent: false,
    oldMachineOffline: true,
    noParallelRecovery: true,
    priorActivation: "none" as "none" | "committed",
  };
  const selected = {
    sourceId: binding.sourceId,
    createdAt: "2026-10-16T11:40:00Z",
    environment: "preproduction" as const,
    nodeId: node.nodeId,
    nodeRecoveryKeyName: key.name,
    taxpayer: { legalName: "Selected business", taxId: scope.taxpayerNif },
    locationName: "Selected venue",
    fiscalSelection: {
      country: "ES",
      fiscalTerritory: "ES-common",
      timeZone: "Europe/Madrid",
      module: binding.module,
    },
  };
  const options = {
    ...roots,
    coordinator: createFirstSetupCoordinator(),
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    binding,
    node,
    secret: key.secret,
    database: () => suite.db,
    selected,
    readRecoveryFacts: async () => facts,
  };
  const service = createSelectedRecoveryPreparation(options);
  const configured = service.modules;
  const prepare = (proposal: unknown, secret = key.secret) =>
    (secret === key.secret
      ? service
      : createSelectedRecoveryPreparation({ ...options, secret })
    ).prepare(proposal);
  const compare = async () => {
    const challenge = (await prepare({ action: "clock-challenge" })) as { id: string };
    return prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
  };
  return { configured, facts, prepare, compare, roots, service, selected, options };
}
export async function archiveHost(kind: "archive" | "stream" = "archive") {
  const f = await host();
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date(),
  });
  const database = join(root, "archive.db");
  await suite.db.archiveTo(database);
  const artifact = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(database) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          `WAITRON_TILL_NODE_ID=${node.nodeId}\nWAITRON_TILL_LOCATION_ID=${node.locationId}\n`,
        ),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("synthetic sealed node key") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
      {
        name: "secrets/modules.json",
        bytes: Buffer.from(
          JSON.stringify({ modules: { "fiscal-verifactu": true, "fiscal-none": false } }),
        ),
      },
    ]),
    "archive password",
  );
  const restore = {
    ...f.roots,
    stagingDir: root,
    migrationsRoot: null,
    modules: ALL_MODULES,
    environment: "preproduction" as const,
    artifact,
    recoveryKey: "archive password",
    log: () => {},
  };
  let selected = await previewRecoveryArchive(restore);
  const entries = unpackArchive(decryptArtifact(artifact, "archive password")).filter(
    (entry) => entry.name !== "db.dump",
  );
  if (kind === "stream")
    selected = {
      ...selected,
      sourceId: "stream:venue:original-generation",
      activationSourceId: await recoveryStreamSourceId(database, entries),
    };
  const { readRecoveryFacts: omitted, ...base } = f.options;
  void omitted;
  const isolation = {
    oldMachineAbsent: false,
    oldMachineOffline: true,
    noParallelRecovery: true,
  };
  const options = {
    ...base,
    modules: ALL_MODULES,
    selected,
    binding: { ...binding, sourceId: selected.activationSourceId ?? selected.sourceId },
    readIsolation: async () => isolation,
  };
  const service = createSelectedRecoveryPreparation(options);
  const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
  await service.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  const outcome = (await service.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as {
    input: unknown;
  };
  return { ...f, restore, options, isolation, service, outcome, database, entries };
}

export async function archiveCommand(f: Awaited<ReturnType<typeof archiveHost>>) {
  const artifactPath = join(root, "entry.backup.enc");
  const operationPath = join(root, "entry-operation.json");
  const migrationRoot = join(root, "migrations");
  await mkdir(migrationRoot);
  const sets = manifestSets();
  const folders = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries())
    await symlink(folders[index]!.migrationsFolder, join(migrationRoot, set.name));
  await writeFile(artifactPath, f.restore.artifact);
  await writeFile(
    operationPath,
    JSON.stringify({ binding: f.options.binding, input: f.outcome.input }),
  );
  return {
    artifactPath,
    operationPath,
    argv: ["restore", artifactPath, "--confirm-old-box-gone", "--confirm-sole-recovery"],
    env: {
      WAITRON_ENV: "dev",
      WAITRON_STATE_DIR: f.roots.stateDir,
      WAITRON_VENUE_DIR: f.roots.venueDir,
      WAITRON_MIGRATIONS_DIR: migrationRoot,
      WAITRON_BACKUP_RECOVERY_KEY: "archive password",
      WAITRON_RECOVERY_OPERATION_FILE: operationPath,
      WAITRON_NODE_RECOVERY_KEY: key.secret,
    },
  };
}

export async function bucketCommand() {
  const f = await archiveHost("stream");
  const command = await archiveCommand(f);
  const signer = generateNodeKeyPair();
  const generation = `gen-0-${node.nodeId}-20261016T124000Z`;
  const kit = {
    version: 1 as const,
    venueId: node.locationId,
    bucket: {
      region: "eu-west-1",
      bucket: "synthetic-hour-recovery",
      prefix: "",
      accessKeyId: "synthetic-access",
      secretAccessKey: "synthetic-secret",
    },
    recoveryKey: "separate bucket password",
    pointerSignerPublicKey: signer.publicKey,
  };
  await writeSealedStateRow(
    suite.db,
    node.nodeId,
    await sealNodeState(f.entries, kit.recoveryKey),
    new Date(),
  );
  await suite.db.archiveTo(f.database);
  const kitPath = join(root, "bucket-kit.txt");
  await writeFile(kitPath, encodeRecoveryKit(kit));
  const store = createMemoryObjectStore({ now: () => new Date() });
  await writePointer(
    store,
    kit.venueId,
    signPointer(
      {
        venueId: kit.venueId,
        nodeId: node.nodeId,
        generation,
        term: 0,
        writtenAt: new Date().toISOString(),
      },
      signer.privateKey,
    ),
    null,
  );
  const selected = await previewRecoveryStream({
    ...f.restore,
    kit,
    oldBoxGone: true,
    now: () => new Date(),
    litestreamBin: "/unused",
    openStore: () => store,
    restoreGeneration: async ({ outPath }) => {
      await copyFile(f.database, outPath);
    },
  });
  const operationBinding = {
    ...f.options.binding,
    sourceId: selected.activationSourceId!,
    eventId: "bucket-entry",
  };
  vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    binding: operationBinding,
    selected,
  });
  const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
  await service.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  const outcome = (await service.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as {
    input: unknown;
  };
  await writeFile(
    command.operationPath,
    JSON.stringify({ binding: operationBinding, input: outcome.input }),
  );
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  const failures: unknown[] = [];
  return {
    f,
    command,
    kitPath,
    kit,
    failures,
    deps: {
      env: command.env,
      argv: [
        "restore",
        "--from-bucket",
        kitPath,
        "--confirm-venue",
        scope.taxpayerNif,
        "--confirm-old-box-gone",
        "--confirm-sole-recovery",
      ],
      openStore: () => store,
      restoreStream: (args: Parameters<typeof restoreFromStream>[0]) =>
        restoreFromStream({
          ...args,
          restoreGeneration: async ({ outPath }) => {
            await copyFile(f.database, outPath);
          },
        }).catch((error) => {
          failures.push(error);
          throw error;
        }),
    },
  };
}

export function agreeInternet() {
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
}

export function restoreApp(deps: Partial<SetupDeps> = {}) {
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      firstSetup: {
        coordinator: createFirstSetupCoordinator(),
        assertOtherAllowed: async () => {},
      },
      requestRestart() {},
      ...deps,
    },
    () => {},
  );
  return app;
}

export function archiveForm(f: Awaited<ReturnType<typeof archiveHost>>, context: unknown) {
  const form = new FormData();
  form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "selected.wbk");
  form.set("recoveryKey", "archive password");
  form.set("environment", "preproduction");
  form.set("oldBoxGone", "1");
  form.set(
    "recoveryOperation",
    JSON.stringify({ binding: f.options.binding, input: f.outcome.input }),
  );
  form.set("nodeRecoverySecret", key.secret);
  form.set("recoveryContext", JSON.stringify(context));
  return form;
}

export async function recordedRecoveryRows(db: Database) {
  return {
    sales: (await db.execute(sql`select * from sales order by id`)).rows,
    lines: (await db.execute(sql`select * from sale_lines order by sale_id, line_no`)).rows,
    tenders: (await db.execute(sql`select * from tenders order by id`)).rows,
    settlements: (await db.execute(sql`select * from sale_settlements order by id`)).rows,
    records: (await db.execute(sql`select * from registros_facturacion order by secuencia`)).rows,
    submissions: (await db.execute(sql`select * from envios order by registro_id`)).rows,
  };
}

export async function recoveryInvoices() {
  const clock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(), offsetMinutes: 120 }),
  };
  const aeat = createFakeAeat({ serverNow: new Date() });
  const backend = new VerifactuBackend({
    db: suite.db,
    clock,
    deploymentEnvironment: "preproduction",
    environment: "preproduction",
    resolveClient: async () => aeat.client(),
  });
  const [standard] = await suite.db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.code, "A-06RB"));
  const sell = () =>
    withTransaction(suite.db, (tx) =>
      recordSale(
        tx,
        backend,
        saleInput({
          nodeId: node.nodeId,
          seriesId: seriesId(standard!.id),
          clock,
          settlement: {
            kind: "immediate",
            tenders: [
              { method: "card", amount: "16.31", tipAmount: "1.90", settledAt: new Date() },
            ],
          },
        }),
      ),
    );
  await sell();
  expect(
    (
      await drain(
        {
          db: suite.db,
          resolveClient: async () => aeat.client(),
          environment: "preproduction",
          skipRetryMs: 300_000,
        },
        new Date(),
      )
    ).recordsAccepted,
  ).toBe(1);
  await sell();
  const rows = await recordedRecoveryRows(suite.db);
  expect(rows.records.map((row) => row.num_serie_factura)).toEqual(["A-06RB/123", "A-06RB/124"]);
  expect(rows.submissions.find((row) => row.registro_id === rows.records[0]?.id)).toMatchObject({
    estado: "aceptado",
    intentos: 1,
    csv: expect.any(String),
  });
  expect(rows.submissions.find((row) => row.registro_id === rows.records[1]?.id)).toMatchObject({
    estado: "pendiente",
    intentos: 0,
    csv: null,
  });
  for (const row of rows.records) {
    const record = fromRegistroRow(decodeRegistroRow(row));
    assertValid(record);
    expect(computeHuella(record)).toBe(row.huella);
  }
  return rows;
}

export async function managedHttp(f: Awaited<ReturnType<typeof archiveHost>>) {
  const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
  const point = {
    id: pointId,
    venueId: node.locationId,
    capturedAt: new Date().toISOString(),
    modules: (
      await buildManifest({
        db: suite.db,
        modules: ALL_MODULES,
        environment: "preproduction",
        now: new Date(),
      })
    ).modules,
    digest: createHash("sha256").update(f.restore.artifact).digest("hex"),
    size: f.restore.artifact.length,
    objectKey: `snapshots/${pointId}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const expiresAt = new Date(Date.now() + 900_000).toISOString();
  const options = {
    stateDir: f.roots.stateDir,
    origin: "https://cloud.example.test",
    environment: "preproduction" as const,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const action = new URL(String(url)).pathname.split("/").at(-1);
      const body = JSON.parse(String(init?.body)) as { payload: string };
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
      if (action === "start" || action === "status")
        return Response.json({
          requestId,
          state: action === "start" ? "awaiting_owner" : "approved",
          expiresAt,
          operationId: action === "start" ? null : requestId,
        });
      if (action === "info") return Response.json({ point, operationExpiresAt: expiresAt });
      if (action === "read")
        return Response.json({
          point,
          location: { endpoint: "https://store.example.test", bucket: "copy", region: "local" },
          credentials: {
            accessKeyId: "unused",
            secretAccessKey: "unused",
            sessionToken: "unused",
          },
          recoveryKey: "archive password",
          expiresAt,
          operationExpiresAt: expiresAt,
        });
      if (action === "restored") return Response.json({ status: "restored" });
      throw new Error(`unexpected recovery action ${action}`);
    },
    download: async () => f.restore.artifact,
  };
  const client = () => createCloudRecoveryClient(options);
  await client().start();
  await client().status();
  const app = restoreApp({
    cloudRecovery: client(),
    stageRestore: (request) => stageRestoreRequest(f.roots.stateDir, request),
  });
  const context = {
    selectedSourceId: f.options.selected.sourceId,
    oldBoxGone: true,
    soleRecovery: true,
  };
  const response = await app.request("https://box.test/setup-api/cloud-recovery/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pointId,
      oldBoxGone: true,
      recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
      nodeRecoverySecret: key.secret,
      recoveryContext: context,
    }),
  });
  expect(response.status).toBe(202);
  return { client, pointId, context };
}

export async function interactiveHost() {
  const f = await archiveHost();
  vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
  const coordinator = createFirstSetupCoordinator();
  const options = { ...f.roots, coordinator, modules: ALL_MODULES, migrationsRoot: null };
  const session = createInteractiveRecoveryPreparation(options);
  const request = {
    binding: { ...f.options.binding, eventId: "interactive-browser" },
    context: {
      selectedSourceId: f.options.selected.sourceId,
      oldBoxGone: true,
      soleRecovery: true,
    },
    nodeRecoverySecret: key.secret,
    proposal: { action: "clock-challenge" },
  };
  const invoke = async (
    proposal: unknown,
    override: Partial<typeof request> = {},
    current = session,
  ) => {
    const copy = await validateArtifact(f.restore);
    try {
      return await coordinator.run((hold) =>
        current.prepare(
          copy,
          f.options.selected.sourceId,
          { ...request, ...override, proposal },
          hold,
        ),
      );
    } finally {
      await copy.discard();
    }
  };
  const compare = async (override: Partial<typeof request> = {}) => {
    const challenge = (await invoke({ action: "clock-challenge" }, override)) as { id: string };
    return invoke(
      { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: Date.now() } },
      override,
    );
  };
  return { ...f, session, options, request, invoke, compare };
}
