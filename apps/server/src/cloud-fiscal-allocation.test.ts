import { generateKeyPairSync } from "node:crypto";
import {
  signPaperBlock,
  signPaperConsumptionForBlock,
  paperCustodianFingerprint,
  verifyPaperEvidence,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  WAITRON_ID_SISTEMA as SOFTWARE_ID,
  VerifactuBackend,
  fiscalAllocations,
  registrosFacturacion,
} from "@waitron/fiscal-verifactu";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { readCloudAllocationReceipt } from "@waitron/fiscal-verifactu/src/cloud-evidence.js";
import { cloudReceiptFixture } from "@waitron/fiscal-verifactu/test/cloud-fixture.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { seriesId as brandSeriesId } from "@waitron/shared";
import { stagedHourCrash } from "./testing/staged-hour-crash.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let fixture: Awaited<ReturnType<typeof stagedHourCrash>> | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fixture?.cleanup();
  fixture = undefined;
});
async function stage(kind: "archive" | "stream") {
  fixture = await stagedHourCrash(suite.db, kind, "cloud-offline-restore");
  const original = await suite.db.select().from(registrosFacturacion);
  expect(original).toHaveLength(1);
  return { ...fixture, original };
}
function signedCloudInput(f: Awaited<ReturnType<typeof stage>>) {
  const receipt = cloudReceiptFixture((payload) => {
    Object.assign(payload.binding, {
      eventId: f.binding.eventId,
      sourceId: f.binding.sourceId,
      targetNodeId: f.binding.targetNodeId,
      operatorId: { kind: "recovery-key", nodeId: f.node.nodeId, eventId: f.binding.eventId },
      incidentEvidence: "outside/cloud-restore",
    });
    Object.assign(payload.approval!, payload.binding);
    Object.assign(payload.allocation, { softwareId: SOFTWARE_ID });
    Object.assign(payload.continuity.scope, { softwareId: SOFTWARE_ID });
  });
  expect(readCloudAllocationReceipt(receipt.packet, receipt.trust)).toEqual(receipt.receipt);
  const directory = join(f.root, "outside");
  mkdirSync(directory, { recursive: true });
  const trustPath = join(f.root, "legacy-cloud-trust.json");
  writeFileSync(
    trustPath,
    JSON.stringify({
      issuer: receipt.trust.issuer,
      fingerprint: receipt.receipt.keyId,
      publicKey: receipt.trust.keys.get(receipt.receipt.keyId),
    }),
  );
  vi.stubEnv("WAITRON_FISCAL_CLOUD_TRUST_FILE", trustPath);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_FINGERPRINT", receipt.receipt.keyId);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY", directory);
  const confirmationPath = join(f.root, "legacy-current.json");
  writeFileSync(
    confirmationPath,
    JSON.stringify({
      version: 1,
      binding: f.binding,
      operatorId: receipt.receipt.payload.binding.operatorId,
      allocationId: receipt.receipt.payload.allocation.allocationId,
      receiptId: receipt.receipt.payload.receiptId,
      priorActivation: "none",
      incidentEvidence: "outside/cloud-restore",
      requiredBases: [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
    }),
  );
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);

  return {
    allocation: receipt.receipt.payload.allocation,
    approval: receipt.receipt.payload.approval,
    receipt: receipt.packet,
  };
}
function signedPaperInput(f: Awaited<ReturnType<typeof stage>>) {
  const cloud = signedCloudInput(f);
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const allocation = {
    ...cloud.allocation,
    source: "paper" as const,
    installationIdentity: "P000042",
    series: [
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ],
  };
  Reflect.deleteProperty(allocation, "reservationEvidence");
  const recipientVenueId = "10000000-0000-4000-8000-000000000002";
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "outside-custodian",
      generationId: "generation-1",
      blockId: "block-1",
      packVersion: 1,
      recipientVenueId,
      allocations: [allocation],
    },
    privateKey,
  );
  const consumption = signPaperConsumptionForBlock(
    block,
    allocation.allocationId,
    {
      eventId: f.binding.eventId,
      operatorId: cloud.approval!.operatorId,
      sourceId: f.binding.sourceId,
      targetNodeId: f.node.nodeId,
      incidentEvidence: "outside/cloud-restore",
      consumedAt: "2026-10-13T10:00:00.000Z",
    },
    privateKey,
  );
  expect(
    verifyPaperEvidence(
      { block, consumption },
      {
        custodianId: "outside-custodian",
        publicKey,
        fingerprint: paperCustodianFingerprint(publicKey),
      },
      {
        allocationId: allocation.allocationId,
        taxpayerNif: allocation.taxpayerNif,
        softwareId: allocation.softwareId,
        environment: allocation.environment,
        recipientVenueId,
        generationId: "generation-1",
        blockId: "block-1",
        eventId: f.binding.eventId,
        operatorId: { kind: "recovery-key", nodeId: f.node.nodeId, eventId: f.binding.eventId },
        sourceId: f.binding.sourceId,
        targetNodeId: f.node.nodeId,
        incidentEvidence: "outside/cloud-restore",
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        requiredBases: [
          { code: "A", purpose: "standard" },
          { code: "FF", purpose: "full" },
          { code: "R", purpose: "rectificative" },
        ],
      },
    ),
  ).toEqual({ ok: true, allocation });
  const trustPath = join(f.root, "legacy-paper-trust.json");
  const fingerprint = paperCustodianFingerprint(publicKey)!;
  writeFileSync(
    trustPath,
    JSON.stringify({ custodianId: "outside-custodian", publicKey, fingerprint }),
  );
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", trustPath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
  writeFileSync(
    join(f.root, "legacy-current.json"),
    JSON.stringify({
      version: 1,
      binding: f.binding,
      operatorId: cloud.approval!.operatorId,
      allocationId: allocation.allocationId,
      priorActivation: "none",
      incidentEvidence: "outside/cloud-restore",
      requiredBases: [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
      recipientVenueId,
      generationId: "generation-1",
      blockId: "block-1",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    }),
  );
  return {
    allocation: { ...allocation, reservationEvidence: { block, consumption } },
    approval: cloud.approval,
  };
}
async function refuseLegacyInput(f: Awaited<ReturnType<typeof stage>>, input: unknown) {
  const markerPath = join(f.stateDir, "restore-request.json");
  const original = await readFile(markerPath, "utf8");
  const marker = JSON.parse(original);
  Reflect.deleteProperty(marker, "recoveryContext");
  marker.recoveryOperation = { binding: f.binding, input };
  await writeFile(markerPath, JSON.stringify(marker));
  try {
    await expect(f.run()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  } finally {
    await writeFile(markerPath, original);
  }
}

it.each(["archive", "stream"] as const)(
  "refuses retired signed Cloud authority and restores the actual %s through current hour authority without altering prior records",
  async (kind) => {
    const f = await stage(kind);
    const destination = await f.seedDestination();
    const retained = f.journal();
    await refuseLegacyInput(f, signedCloudInput(f));
    expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(destination.bytes);
    expect(await f.snapshot()).toEqual(destination.rows);
    expect(f.journal()).toBe(retained);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await f.run()).toBe(true);
    const restored = await f.snapshot();
    expect(restored.records).toEqual(f.original);
    expect(restored.allocations).toHaveLength(2);
    expect(restored.allocations.map((row) => row.installationIdentity)).toEqual(["06RB", "06RC"]);
    const activation = restored.allocations.find((row) => row.eventKey === f.binding.eventId)!;
    expect(activation.approval.operatorId).toEqual({
      kind: "recovery-key",
      nodeId: f.node.nodeId,
      eventId: f.binding.eventId,
    });
    expect(activation.result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-06RC", purpose: "standard" },
      { code: "FF-06RC", purpose: "full" },
      { code: "R-06RC", purpose: "rectificative" },
    ]);
    expect(f.journal()).not.toContain(f.key.secret);
    expect(f.journal()).not.toContain(f.encryptionKey);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_TILL_NODE_ID=${f.node.nodeId}`,
    );
  },
);
it("requires the selected copy's node key even when a valid consumed Cloud receipt is supplied", async () => {
  const f = await stage("archive");
  const destination = await f.seedDestination();
  const markerPath = join(f.stateDir, "restore-request.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  Reflect.deleteProperty(marker, "recoveryContext");
  marker.recoveryOperation = { binding: f.binding, input: signedCloudInput(f) };
  await writeFile(markerPath, JSON.stringify(marker));
  await writeFile(join(f.stateDir, "restore-request.node-key"), "wrong node recovery key");
  const retained = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(destination.bytes);
  expect(await f.snapshot()).toEqual(destination.rows);
  expect(f.journal()).toBe(retained);
  await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("completes a real sale after current-hour recovery without calling fetch or resolving a filing client", async () => {
  const f = await stage("archive");
  await f.run();
  const network = vi.fn(() => {
    throw new Error("unexpected registry request");
  });
  vi.stubGlobal("fetch", network);
  const copy = await openVenueDatabase(f.venueDir);
  try {
    const activation = (await copy.venue.select().from(fiscalAllocations)).find(
      (row) => row.eventKey === f.binding.eventId,
    )!;
    const standard = activation.result.series.find((row) => row.purpose === "standard")!;
    const backend = new VerifactuBackend({
      db: copy.venue,
      deploymentEnvironment: "preproduction",
      clock: steadyClock,
      resolveClient: async () => {
        throw new Error("sale attempted external filing");
      },
    });
    const sale = await withTransaction(copy.venue, (tx) =>
      recordSale(
        tx,
        backend,
        saleInput({ nodeId: f.node.nodeId, seriesId: brandSeriesId(standard.id) }),
      ),
    );
    const rows = await copy.venue
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, sale.saleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.numSerieFactura).toBe("A-06RC/1");
    expect(
      (await copy.venue.select().from(registrosFacturacion)).filter(
        (row) => row.saleId !== sale.saleId,
      ),
    ).toEqual(f.original);
    expect(network).toHaveBeenCalledTimes(0);
  } finally {
    await copy.close();
  }
});
it("refuses a fresh recovery of the older backup in an already spent hour", async () => {
  const f = await stage("archive");
  await f.run();
  const committed = await f.snapshot();
  const retained = f.journal();
  await expect(f.nextEvent()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  expect(await f.snapshot()).toEqual(committed);
  expect(committed.records).toEqual(f.original);
  expect(f.journal()).toBe(retained);
});
it("replays its exact committed result after trading-settings publication is interrupted", async () => {
  const f = await stage("archive");
  await expect(
    f.run((_level, event) => {
      if (event === "restore.hook.done")
        mkdirSync(join(f.stateDir, "trading.env"), { recursive: true });
    }),
  ).rejects.toMatchObject({ code: "EISDIR" });
  await f.advanceCounters();
  const before = await f.snapshot();
  expect(before.allocations).toHaveLength(2);
  await rm(join(f.stateDir, "trading.env"), { recursive: true });
  expect(await f.run()).toBe(true);
  expect(await f.snapshot()).toEqual(before);
  expect(before.records).toEqual(f.original);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(
    `WAITRON_TILL_NODE_ID=${f.node.nodeId}`,
  );
});
it("restores offline through current hour authority while retired paper input grants no authority", async () => {
  const f = await stage("archive");
  const retained = f.journal();
  await refuseLegacyInput(f, signedPaperInput(f));
  const network = vi.fn(() => {
    throw new Error("offline restore contacted the retired Cloud allocator");
  });
  vi.stubGlobal("fetch", network);
  expect(await f.run()).toBe(true);
  expect(network).toHaveBeenCalledTimes(0);
  const rows = await f.snapshot();
  expect(rows.allocations).toHaveLength(2);
  expect(rows.allocations[1]!.allocation.installationIdentity).toBe("06RC");
  expect(rows.records).toEqual(f.original);
  expect(f.journal()).toBe(retained);
});
