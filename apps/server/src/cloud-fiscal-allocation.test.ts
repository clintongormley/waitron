import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { deployment, invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  VerifactuBackend,
  fiscalAllocations,
  registrosFacturacion,
} from "@waitron/fiscal-verifactu";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { cloudReceiptFixture } from "@waitron/fiscal-verifactu/test/cloud-fixture.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import {
  signPaperBlock,
  signPaperConsumptionForBlock,
  paperCustodianFingerprint,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { reconcileCloudFiscalAllocation } from "./cloud-fiscal-allocation.js";
import { createCloudFiscalAllocationClient } from "./cloud-fiscal-allocation-client.js";
import { seriesId as brandSeriesId } from "@waitron/shared";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { ALL_MODULES } from "./modules.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
let root: string;
let stateDir: string;
let outside: string;
let databasePath: string;
let nodeKey: string;
const archiveKey = "synthetic archive key";
let original: unknown;

function backend(db: typeof suite.db) {
  return new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    db,
    clock: steadyClock,
    resolveClient: async () => {
      throw new Error("sale attempted external filing");
    },
  });
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  const series = await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: TENANT_A.nodeId })))
    .returning();
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: TENANT_A.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "WT",
      numeroInstalacion: "P000001",
    }),
  );
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend(suite.db),
      saleInput({
        nodeId: TENANT_A.nodeId,
        seriesId: brandSeriesId(series.find((s) => s.code === "A")!.id),
      }),
    ),
  );
  original = await suite.db.select().from(registrosFacturacion);
  nodeKey = await mintBreakGlassSecret(suite.db, TENANT_A.nodeId);
  root = await mkdtemp(join(tmpdir(), "cloud-fiscal-restore-"));
  stateDir = join(root, "state");
  outside = join(root, "outside");
  await mkdir(stateDir);
  await mkdir(outside);
  databasePath = join(root, "old-backup.db");
  await suite.db.archiveTo(databasePath);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});

async function stage(kind: "archive" | "stream", secret = nodeKey) {
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
    archiveKey,
  );
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "cloud-offline-restore",
    sourceId:
      kind === "archive"
        ? recoveryArchiveSourceId(artifact)
        : await recoveryStreamSourceId(databasePath, entries),
    targetNodeId: TENANT_A.nodeId,
  };
  const operatorId = { kind: "recovery-key", nodeId: TENANT_A.nodeId, eventId: binding.eventId };
  const fixture = cloudReceiptFixture((payload) => {
    Object.assign(payload.binding, {
      eventId: binding.eventId,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      operatorId,
      incidentEvidence: "outside/cloud-restore",
    });
    Object.assign(payload.approval!, payload.binding);
  });
  const recoveryOperation = {
    binding,
    input: {
      allocation: fixture.receipt.payload.allocation,
      approval: fixture.receipt.payload.approval,
      receipt: fixture.packet,
    },
  };
  const common = {
    environment: "preproduction" as const,
    recoveryOperation,
    nodeRecoverySecret: secret,
  };
  await stageRestoreRequest(
    stateDir,
    kind === "archive"
      ? { ...common, artifact, recoveryKey: archiveKey }
      : { ...common, kind: "stream", databasePath, entries },
  );
  const confirmation = {
    version: 1,
    binding,
    operatorId,
    allocationId: fixture.receipt.payload.allocation.allocationId,
    receiptId: fixture.receipt.payload.receiptId,
    priorActivation: "none",
    incidentEvidence: "outside/cloud-restore",
    requiredBases: bases,
  };
  const confirmationPath = join(root, "current.json");
  await writeFile(confirmationPath, JSON.stringify(confirmation));
  const trustPath = join(root, "trust.json");
  await writeFile(
    trustPath,
    JSON.stringify({
      issuer: fixture.trust.issuer,
      fingerprint: fixture.receipt.keyId,
      publicKey: fixture.trust.keys.get(fixture.receipt.keyId),
    }),
  );
  vi.stubEnv("WAITRON_FISCAL_CLOUD_TRUST_FILE", trustPath);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_FINGERPRINT", fixture.receipt.keyId);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY", outside);
  return { fixture, confirmation, confirmationPath, artifact, entries, recoveryOperation };
}
function restore(log: (level: string, event: string) => void = () => {}) {
  return runStagedRestore({ stateDir, venueDir: join(root, "venue"), migrationsRoot: null, log });
}

it.each(["archive", "stream"] as const)(
  "uses a signed Cloud packet through the actual %s recovery-key path without altering prior records",
  async (kind) => {
    const { fixture } = await stage(kind);
    expect(await restore()).toBe(true);
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      expect(await copy.venue.select().from(registrosFacturacion)).toEqual(original);
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.allocation).toEqual(fixture.receipt.payload.allocation);
      expect(rows[0]?.approval).toEqual(fixture.receipt.payload.approval);
      expect(rows[0]?.result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
        { code: "A-C000042", purpose: "standard" },
        { code: "FF-C000042", purpose: "full" },
        { code: "R-C000042", purpose: "rectificative" },
      ]);
    } finally {
      await copy.close();
    }
    const files = await readdir(outside);
    expect(files).toHaveLength(1);
    const retained = await readFile(join(outside, files[0]!), "utf8");
    expect(JSON.parse(retained).receipt).toEqual(fixture.receipt);
    expect(retained).not.toContain(nodeKey);
    expect(retained).not.toContain(archiveKey);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_TILL_NODE_ID=${TENANT_A.nodeId}`,
    );
  },
);
it("requires the local node key even for a valid consumed Cloud receipt", async () => {
  await stage("archive", "wrong node recovery key");
  await expect(restore()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(await readdir(outside)).toEqual([]);
  await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("completes a real sale with a throwing network recorder and no registry calls", async () => {
  await stage("archive");
  await restore();
  const network = vi.fn(() => {
    throw new Error("unexpected registry request");
  });
  vi.stubGlobal("fetch", network);
  const copy = await openVenueDatabase(join(root, "venue"));
  try {
    const activation = (await copy.venue.select().from(fiscalAllocations))[0]!;
    const standard = activation.result.series.find((s) => s.purpose === "standard")!;
    const sale = await withTransaction(copy.venue, (tx) =>
      recordSale(
        tx,
        backend(copy.venue),
        saleInput({ nodeId: TENANT_A.nodeId, seriesId: brandSeriesId(standard.id) }),
      ),
    );
    const rows = await copy.venue
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, sale.saleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.numSerieFactura).toBe("A-C000042/1");
    expect(network).toHaveBeenCalledTimes(0);
  } finally {
    await copy.close();
  }
});
it("refuses the old backup when the current outside source says the local activation already committed", async () => {
  const staged = await stage("archive");
  await restore();
  const receiptPath = join(
    outside,
    createHash("sha256")
      .update(staged.fixture.receipt.payload.allocation.allocationId)
      .digest("hex") + ".json",
  );
  const originalReceipt = await readFile(receiptPath, "utf8");
  await writeFile(
    staged.confirmationPath,
    JSON.stringify({ ...staged.confirmation, priorActivation: "committed" }),
  );
  const nextState = join(root, "old-backup-restore-state");
  await mkdir(nextState);
  await stageRestoreRequest(nextState, {
    environment: "preproduction",
    artifact: staged.artifact,
    recoveryKey: archiveKey,
    recoveryOperation: staged.recoveryOperation,
    nodeRecoverySecret: nodeKey,
  });
  await expect(
    runStagedRestore({
      stateDir: nextState,
      venueDir: join(root, "old-backup-target"),
      migrationsRoot: null,
      log: () => {},
    }),
  ).rejects.toMatchObject({
    code: "restore.hook_failed",
    params: { module: "fiscal-verifactu", code: "sif.allocation_invalid" },
  });
  expect(await readFile(receiptPath, "utf8")).toBe(originalReceipt);
  await expect(readFile(join(nextState, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("replays its exact committed result after trading-settings publication is interrupted", async () => {
  const staged = await stage("archive");
  await expect(
    restore((_level, event) => {
      if (event === "restore.hook.done")
        mkdirSync(join(stateDir, "trading.env"), { recursive: true });
    }),
  ).rejects.toMatchObject({ code: "EISDIR" });
  const copy = await openVenueDatabase(join(root, "venue"));
  let before: unknown;
  try {
    before = await copy.venue.select().from(fiscalAllocations);
    expect(before).toHaveLength(1);
  } finally {
    await copy.close();
  }
  await writeFile(
    staged.confirmationPath,
    JSON.stringify({ ...staged.confirmation, priorActivation: "committed" }),
  );
  await rm(join(stateDir, "trading.env"), { recursive: true });
  expect(await restore()).toBe(true);
  const resumed = await openVenueDatabase(join(root, "venue"));
  try {
    expect(await resumed.venue.select().from(fiscalAllocations)).toEqual(before);
    expect(await resumed.venue.select().from(registrosFacturacion)).toEqual(original);
  } finally {
    await resumed.close();
  }
  expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(
    `WAITRON_TILL_NODE_ID=${TENANT_A.nodeId}`,
  );
});

it("restores an offline paper allocation and later reports its original signed history once over HTTP", async () => {
  const staged = await stage("archive");
  const custodian = generateKeyPairSync("ed25519");
  const privateKey = custodian.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = custodian.publicKey.export({ type: "spki", format: "pem" }).toString();
  const allocation = {
    ...staged.fixture.receipt.payload.allocation,
    source: "paper",
    installationIdentity: "P000042",
    series: bases.map((base) => ({ ...base, code: `${base.code}-P000042` })),
  };
  Reflect.deleteProperty(allocation, "reservationEvidence");
  const venueId = "10000000-0000-4000-8000-000000000002";
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "outside-custodian",
      generationId: "generation-1",
      blockId: "block-1",
      packVersion: 1,
      recipientVenueId: venueId,
      allocations: [allocation],
    },
    privateKey,
  );
  const approval = staged.fixture.receipt.payload.approval!;
  const consumption = signPaperConsumptionForBlock(
    block,
    allocation.allocationId,
    { ...staged.fixture.receipt.payload.binding, consumedAt: "2026-10-13T10:00:00.000Z" },
    privateKey,
  );
  const input = {
    allocation: { ...allocation, reservationEvidence: { block, consumption } },
    approval,
  };
  await stageRestoreRequest(stateDir, {
    environment: "preproduction",
    artifact: staged.artifact,
    recoveryKey: archiveKey,
    recoveryOperation: { ...staged.recoveryOperation, input },
    nodeRecoverySecret: nodeKey,
  });
  const fingerprint = paperCustodianFingerprint(publicKey)!;
  const trustPath = join(root, "paper-trust.json");
  await writeFile(
    trustPath,
    JSON.stringify({ custodianId: "outside-custodian", publicKey, fingerprint }),
  );
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", trustPath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
  const paperConfirmation = { ...staged.confirmation };
  Reflect.deleteProperty(paperConfirmation, "receiptId");
  await writeFile(
    staged.confirmationPath,
    JSON.stringify({
      ...paperConfirmation,
      recipientVenueId: venueId,
      generationId: "generation-1",
      blockId: "block-1",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    }),
  );
  const network = vi.fn(() => {
    throw new Error("offline restore contacted Cloud");
  });
  vi.stubGlobal("fetch", network);
  expect(await restore()).toBe(true);
  expect(network).toHaveBeenCalledTimes(0);
  vi.unstubAllGlobals();
  const copy = await openVenueDatabase(join(root, "venue"));
  let result: unknown;
  try {
    const rows = await copy.venue.select().from(fiscalAllocations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.allocation.installationIdentity).toBe("P000042");
    result = rows[0]?.result;
    expect(await copy.venue.select().from(registrosFacturacion)).toEqual(original);
  } finally {
    await copy.close();
  }
  const paperHistory = {
    version: 1,
    operationId: "10000000-0000-4000-8000-000000000006",
    venueId,
    scope: { taxpayerNif: "89890001K", softwareId: "WT", environment: "preproduction" },
    custodyVersion: "custody-1",
    registerRevision: "1",
    previousDigest: "0".repeat(64),
    block,
    consumptions: [consumption],
    transfers: [],
  };
  const body = {
    venueId,
    scope: paperHistory.scope,
    receipt: null,
    paperHistory,
    activationEvidence: { version: 1, eventId: approval.eventId, nodeId: TENANT_A.nodeId, result },
  };
  const machine = generateKeyPairSync("ed25519");
  const requests: unknown[][] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      payload: string;
      signature: string;
    };
    expect(
      verify(
        null,
        Buffer.from(envelope.payload, "base64url"),
        machine.publicKey,
        Buffer.from(envelope.signature, "base64url"),
      ),
    ).toBe(true);
    requests.push(
      JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as unknown[],
    );
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ version: 1, state: "recorded", receiptId: null }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const directory = join(root, "reports");
    await mkdir(directory);
    const operation = { operationId: "10000000-0000-4000-8000-000000000007", body };
    const configuration = {
      directory,
      operation,
      transport: createCloudFiscalAllocationClient({ origin, environment: "dev" }),
      authenticate: async () => ({
        origin,
        environment: "dev" as const,
        installationId: "10000000-0000-4000-8000-000000000008",
        privateKey: machine.privateKey
          .export({ type: "pkcs8", format: "der" })
          .toString("base64url"),
        lease: {
          payload: "synthetic-current-machine-lease",
          signature: "synthetic-lease-signature",
        },
      }),
    };
    expect(await reconcileCloudFiscalAllocation(configuration)).toEqual({
      version: 1,
      state: "recorded",
      receiptId: null,
    });
    expect(await reconcileCloudFiscalAllocation(configuration)).toEqual({
      version: 1,
      state: "recorded",
      receiptId: null,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.[9]).toEqual(body);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
