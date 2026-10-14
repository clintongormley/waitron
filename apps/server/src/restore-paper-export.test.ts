import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isNull } from "drizzle-orm";
import { deployment, invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { fiscalAllocations, registroSif } from "@waitron/fiscal-verifactu";
import { runPaperCustodian } from "@waitron/fiscal-verifactu/src/paper-custodian.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { ALL_MODULES } from "./modules.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import { parseRecoveryOperationInput } from "./recovery-module-operation.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const encryptionKey = "synthetic archive encryption key";
let root: string;
let stateDir: string;
let databasePath: string;
let nodeKey: string;
let outsideCurrent: string;
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
  root = await mkdtemp(join(tmpdir(), "paper-export-restore-"));
  stateDir = join(root, "state");
  await mkdir(stateDir);
  await mkdir(join(root, "outside"));
  databasePath = join(root, "backup.db");
  await suite.db.archiveTo(databasePath);
  outsideCurrent = join(root, "outside", "current.json");
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", join(root, "outside", "public.json"));
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", outsideCurrent);
  vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function stage(kind: "archive" | "stream") {
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
    eventId: "paper-offline-restore",
    sourceId:
      kind === "archive"
        ? recoveryArchiveSourceId(artifact)
        : await recoveryStreamSourceId(databasePath, entries),
    targetNodeId: TENANT_A.nodeId,
  };
  const operatorId = { kind: "recovery-key", nodeId: TENANT_A.nodeId, eventId: binding.eventId };
  const approval = {
    version: 1,
    eventId: binding.eventId,
    operatorId,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-14T18:25:00.000Z",
    incidentEvidence: "outside/paper-offline-restore",
  };
  const allocation = {
    version: 1 as const,
    allocationId: "paper-42",
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
    installationIdentity: "P000042",
    series: [
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ],
    source: "paper" as const,
    issuedAt: "2026-10-14T08:00:00.000Z",
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "external-custodian",
      generationId: "current-generation",
      blockId: "current-block",
      packVersion: 1,
      recipientVenueId: "source-venue",
      allocations: [allocation],
    },
    privateKey,
  );
  const consumption = signPaperConsumptionForBlock(
    block,
    allocation.allocationId,
    {
      eventId: binding.eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  const confirmation = {
    version: 1,
    allocationId: allocation.allocationId,
    binding,
    operatorId,
    priorActivation: "none",
    incidentEvidence: approval.incidentEvidence,
    requiredBases: bases,
    recipientVenueId: "source-venue",
    generationId: "current-generation",
    blockId: "current-block",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  };
  const files = {
    block: join(root, "outside", "block.json"),
    consumption: join(root, "outside", "consumption.json"),
    input: join(root, "approval.json"),
    custodian: join(root, "outside", "public.json"),
    confirmation: outsideCurrent,
    output: join(root, "operation.json"),
  };
  for (const [name, value] of Object.entries({
    block,
    consumption,
    input: approval,
    custodian: { custodianId: "external-custodian", publicKey, fingerprint },
    confirmation,
  }))
    await writeFile(files[name as keyof typeof files], JSON.stringify(value));
  const errors: string[] = [];
  expect(
    await runPaperCustodian(
      [
        "prepare-recovery",
        ...Object.entries(files).flatMap(([name, path]) => [`--${name}`, path]),
        "--fingerprint",
        fingerprint,
        "--taxpayer",
        "89890001K",
        "--environment",
        "preproduction",
        "--action",
        "restore",
      ],
      { stdout: () => {}, stderr: (line) => errors.push(line) },
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
  const recoveryOperation = parseRecoveryOperationInput(
    JSON.parse(await readFile(files.output, "utf8")),
  );
  expect(recoveryOperation).not.toBeNull();
  const common = {
    environment: "preproduction" as const,
    recoveryOperation: recoveryOperation!,
    nodeRecoverySecret: nodeKey,
  };
  await stageRestoreRequest(
    stateDir,
    kind === "archive"
      ? { ...common, artifact, recoveryKey: encryptionKey }
      : { ...common, kind: "stream", databasePath, entries },
  );
  return confirmation;
}

it.each(["archive", "stream"] as const)(
  "restores the staged %s with a custodian export and the selected copy's older node key",
  async (kind) => {
    const current = await stage(kind);
    await mintBreakGlassSecret(suite.db, TENANT_A.nodeId);
    const log = vi.fn();
    expect(
      await runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log,
      }),
    ).toBe(true);
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.installationIdentity).toBe("P000042");
      expect(rows[0]?.approval.operatorId).toEqual(current.operatorId);
      expect(
        (await copy.venue.select().from(registroSif).where(isNull(registroSif.revocadoEn))).map(
          (row) => row.numeroInstalacion,
        ),
      ).toEqual(["P000042"]);
      expect(
        await copy.venue
          .select({
            code: invoiceSeries.code,
            purpose: invoiceSeries.purpose,
            nextNumber: invoiceSeries.nextNumber,
          })
          .from(invoiceSeries)
          .where(isNull(invoiceSeries.retiredAt))
          .orderBy(invoiceSeries.code),
      ).toEqual([
        { code: "A-P000042", purpose: "standard", nextNumber: 1 },
        { code: "FF-P000042", purpose: "full", nextNumber: 1 },
        { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
      ]);
    } finally {
      await copy.close();
    }
    expect(JSON.parse(await readFile(outsideCurrent, "utf8"))).toEqual(current);
    expect(JSON.stringify(log.mock.calls)).not.toContain(nodeKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(encryptionKey);
    await expect(readFile(join(stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["retired", "consumed-elsewhere", "abandoned"])(
  "rereads the current outside register at restart and refuses an exported %s entry",
  async (currentEntryState) => {
    const current = await stage("archive");
    await writeFile(outsideCurrent, JSON.stringify({ ...current, currentEntryState }));
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: () => {},
      }),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: {
        code: "sif.allocation_invalid",
        module: "fiscal-verifactu",
      },
    });
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      expect(await copy.venue.select().from(fiscalAllocations)).toEqual([]);
      expect(
        (await copy.venue.select().from(registroSif).where(isNull(registroSif.revocadoEn))).map(
          (row) => row.numeroInstalacion,
        ),
      ).toEqual(["P000001"]);
    } finally {
      await copy.close();
    }
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(outsideCurrent, "utf8"))).toEqual({
      ...current,
      currentEntryState,
    });
  },
);

it("refuses the archive encryption key as node authentication for an exported paper operation", async () => {
  const current = await stage("archive");
  await writeFile(join(stateDir, "restore-request.node-key"), encryptionKey);
  const log = vi.fn();
  await expect(
    runStagedRestore({ stateDir, venueDir: join(root, "venue"), migrationsRoot: null, log }),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  const copy = await openVenueDatabase(join(root, "venue"));
  try {
    expect(await copy.venue.select().from(fiscalAllocations)).toEqual([]);
    expect(
      (await copy.venue.select().from(registroSif).where(isNull(registroSif.revocadoEn))).map(
        (row) => row.numeroInstalacion,
      ),
    ).toEqual(["P000001"]);
  } finally {
    await copy.close();
  }
  expect(JSON.parse(await readFile(outsideCurrent, "utf8"))).toEqual(current);
  await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(stateDir, "restore-request.node-key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(nodeKey);
  expect(JSON.stringify(log.mock.calls)).not.toContain(encryptionKey);
});
