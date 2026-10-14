import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { deployment, invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { fiscalAllocations, registroSif } from "@waitron/fiscal-verifactu";
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
const encryptionKey = "synthetic archive encryption key";
let root: string;
let stateDir: string;
let outside: string;
let databasePath: string;
let nodeKey: string;
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

async function stage(kind: "archive" | "stream", changedApproval = {}) {
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
    eventId: "emergency-offline-restore",
    sourceId:
      kind === "archive"
        ? recoveryArchiveSourceId(artifact)
        : await recoveryStreamSourceId(databasePath, entries),
    targetNodeId: TENANT_A.nodeId,
  };
  const operatorId = { kind: "recovery-key", nodeId: TENANT_A.nodeId, eventId: binding.eventId };
  const incidentEvidence = "outside/emergency-offline-restore";
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
  expect(await readdir(outside)).toEqual([]);
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

it.each(["archive", "stream"] as const)(
  "restores a staged %s with the selected backup's key and a freshly recorded emergency identity",
  async (kind) => {
    await stage(kind);
    await mintBreakGlassSecret(suite.db, TENANT_A.nodeId);
    const log = vi.fn();
    await expect(
      runStagedRestore({ stateDir, venueDir: join(root, "venue"), migrationsRoot: null, log }),
    ).resolves.toBe(true);
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.installationIdentity).toMatch(/^E[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(rows[0]?.approval.operatorId).toEqual({
        kind: "recovery-key",
        nodeId: TENANT_A.nodeId,
        eventId: "emergency-offline-restore",
      });
      const sif = await copy.venue.select().from(registroSif).where(isNull(registroSif.revocadoEn));
      expect(sif).toHaveLength(1);
      expect(sif[0]?.numeroInstalacion).toBe(rows[0]?.installationIdentity);
      const codes = await copy.venue
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(isNull(invoiceSeries.retiredAt))
        .orderBy(invoiceSeries.code);
      expect(codes.map(({ code }) => code)).toEqual([
        `A-${rows[0]!.installationIdentity}`,
        `FF-${rows[0]!.installationIdentity}`,
        `R-${rows[0]!.installationIdentity}`,
      ]);
      expect(
        await copy.venue.select().from(invoiceSeries).where(eq(invoiceSeries.code, "A")),
      ).toMatchObject([{ nextNumber: 1, retiredAt: expect.any(Date) }]);
      const files = await readdir(outside);
      const names = files.filter((name) => name.endsWith(".json"));
      expect(names).toHaveLength(1);
      expect(files.sort()).toEqual([names[0]!, `${names[0]!}.txt`].sort());
      const retained = await readFile(join(outside, names[0]!), "utf8");
      expect(JSON.parse(retained).allocation).toEqual(rows[0]?.allocation);
      expect(retained).not.toContain(nodeKey);
    } finally {
      await copy.close();
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(nodeKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(encryptionKey);
    await expect(readFile(join(stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("rereads the current outside confirmation after staging and refuses a changed event", async () => {
  await stage("archive");
  const current = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
  current.binding.eventId = "another-recovery";
  await writeFile(join(root, "current.json"), JSON.stringify(current));
  await expect(
    runStagedRestore({
      stateDir,
      venueDir: join(root, "venue"),
      migrationsRoot: null,
      log: () => {},
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "event_mismatch" } });
  expect(await readdir(outside)).toEqual([]);
});
