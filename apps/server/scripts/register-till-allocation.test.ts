import { FISCAL_OPERATIONS as historicalFiscalOperations } from "@waitron/fiscal-verifactu/src/allocation-configuration.js";
import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isNull } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { ALLOCATED_FISCAL_SEED, ALLOCATED_FISCAL_RESTORE } from "@waitron/fiscal-verifactu";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { WaitronModule } from "@waitron/module";
import { locationId, nodeId } from "@waitron/shared";
import { mintBreakGlassSecret } from "../src/break-glass.js";
import { registerTill } from "./register-till.js";
import { runRestore } from "../src/restore-command.js";
import { restoreFromArtifactFile } from "../src/restore.js";
import { writeStreamRestore } from "../src/restore-stream.js";
import { encryptArtifact } from "../src/artifact-cipher.js";
import { packArchive } from "../src/backup-archive.js";
import { encodeRecoveryKit } from "@waitron/stream";
const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("../src/modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NODE = nodeId("c0000000-0000-4000-8000-000000000001");
const LOCATION = locationId("c0000000-0000-4000-8000-000000000002");
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const binding = {
  module: "fiscal-verifactu",
  action: "re-register",
  eventId: "reimage-42",
  sourceId: "reimaged-box-42",
  targetNodeId: NODE,
};
const operatorId = { kind: "recovery-key" as const, nodeId: NODE, eventId: binding.eventId };
const candidate = {
  version: 1 as const,
  allocationId: "allocation-42",
  taxpayerNif: "50000000R",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  source: "paper" as const,
  issuedAt: "2026-10-13T09:00:00.000Z",
  series: bases.map(({ code, purpose }) => ({ code: `${code}-P000042`, purpose })),
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "custodian",
    generationId: "generation-1",
    blockId: "block-1",
    packVersion: 1,
    recipientVenueId: "venue-1",
    allocations: [candidate],
  },
  privateKey,
);
const approval = {
  version: 1 as const,
  eventId: binding.eventId,
  operatorId,
  sourceId: binding.sourceId,
  targetNodeId: NODE,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-13T10:00:00.000Z",
  incidentEvidence: "master/reimage-42",
};
const request = {
  binding,
  input: {
    allocation: {
      ...candidate,
      reservationEvidence: {
        block,
        consumption: signPaperConsumptionForBlock(
          block,
          candidate.allocationId,
          {
            eventId: binding.eventId,
            operatorId,
            sourceId: binding.sourceId,
            targetNodeId: NODE,
            incidentEvidence: approval.incidentEvidence,
            consumedAt: approval.confirmedAt,
          },
          privateKey,
        ),
      },
    },
    approval,
  },
};
const confirmation = {
  version: 1,
  allocationId: candidate.allocationId,
  binding,
  operatorId,
  priorActivation: "none",
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  recipientVenueId: "venue-1",
  generationId: "generation-1",
  blockId: "block-1",
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  currentEntryState: "consumed-for-event",
};
let root: string;
let venueDir: string;
let file: string;
let secret: string;
beforeEach(async () => {
  modules.splice(
    0,
    modules.length,
    fakeModule("fiscal-verifactu", {
      operations: historicalFiscalOperations,
      provisioning: { seed: ALLOCATED_FISCAL_SEED },
    }),
  );
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Restaurant" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Reimaged" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: NODE, nextNumber: 23 })));
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, { nodeId: NODE, nif: "50000000R", idSistemaInformatico: "W1" }),
  );
  secret = await mintBreakGlassSecret(suite.db, NODE);
  root = await mkdtemp(join(tmpdir(), "register-till-allocation-"));
  venueDir = join(root, "venue");
  await mkdir(venueDir);
  await suite.db.archiveTo(join(venueDir, "venue.db"));
  file = join(root, "operation.json");
  await writeFile(file, JSON.stringify(request));
  const custodianPath = join(root, "custodian.json");
  const confirmationPath = join(root, "current.json");
  await writeFile(
    custodianPath,
    JSON.stringify({ custodianId: "custodian", publicKey, fingerprint }),
  );
  await writeFile(confirmationPath, JSON.stringify(confirmation));
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", custodianPath);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
function env() {
  return {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_RECOVERY_OPERATION_FILE: file,
    WAITRON_NODE_RECOVERY_KEY: secret,
  };
}
async function rows() {
  const store = await openVenueDatabase(venueDir);
  try {
    return {
      sifs: await store.venue.select().from(registroSif),
      series: await store.venue.select().from(invoiceSeries).orderBy(invoiceSeries.code),
      allocations: await store.venue.select().from(fiscalAllocations),
    };
  } finally {
    await store.close();
  }
}
it("re-registers with the file's signed identity and the current node key through the historical harness", async () => {
  const before = await rows();
  const result = registerTill(NODE, env());
  await expect(result).resolves.toEqual([
    { module: "fiscal-verifactu", report: expect.stringContaining("installation P000042") },
  ]);
  const after = await rows();
  expect(after.sifs).toHaveLength(2);
  expect(after.sifs.find((row) => row.id === before.sifs[0]!.id)).toEqual({
    ...before.sifs[0],
    revocadoEn: expect.any(Date),
  });
  expect(after.sifs.find((row) => row.revocadoEn === null)).toMatchObject({
    numeroInstalacion: "P000042",
  });
  for (const old of before.series)
    expect(after.series.find((row) => row.id === old.id)).toEqual({
      ...old,
      retiredAt: expect.any(Date),
    });
  expect(
    after.series
      .filter((row) => row.retiredAt === null)
      .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
  ).toEqual([
    { code: "A-P000042", purpose: "standard", nextNumber: 1 },
    { code: "FF-P000042", purpose: "full", nextNumber: 1 },
    { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
  ]);
  expect(after.allocations.map((row) => row.approval)).toEqual([approval]);
});
it("uses the state-directory default and retains committed counters on an authorised replay", async () => {
  const args = { ...env(), WAITRON_VENUE_DIR: undefined, WAITRON_STATE_DIR: root };
  await expect(registerTill(NODE, args)).resolves.toHaveLength(1);
  const store = await openVenueDatabase(venueDir);
  try {
    await store.venue
      .update(invoiceSeries)
      .set({ nextNumber: 37 })
      .where(isNull(invoiceSeries.retiredAt));
  } finally {
    await store.close();
  }
  const before = await rows();
  await writeFile(
    join(root, "current.json"),
    JSON.stringify({ ...confirmation, priorActivation: "committed" }),
  );
  await expect(registerTill(NODE, args)).resolves.toHaveLength(1);
  expect(await rows()).toEqual(before);
});
it.each([undefined, "", "wrong"])(
  "refuses an absent or wrong node key %# before consulting missing outside evidence",
  async (key) => {
    const before = await rows();
    await rm(join(root, "current.json"));
    await expect(
      registerTill(NODE, { ...env(), WAITRON_NODE_RECOVERY_KEY: key }),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(await rows()).toEqual(before);
  },
);
it("refuses a restore request on the re-registration entry point", async () => {
  const before = await rows();
  await writeFile(file, JSON.stringify({ ...request, binding: { ...binding, action: "restore" } }));
  await expect(registerTill(NODE, env())).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "fiscal-verifactu" },
  });
  expect(await rows()).toEqual(before);
});
it("refuses malformed file input before creating the selected venue directory", async () => {
  await writeFile(file, "synthetic-secret-invalid-json");
  const absent = join(root, "absent-venue");
  await expect(registerTill(NODE, { ...env(), WAITRON_VENUE_DIR: absent })).rejects.toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "invalid_operation" },
  });
  await expect(readFile(join(absent, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("refuses a different target without consuming local allocation state", async () => {
  const before = await rows();
  await expect(registerTill("c0000000-0000-4000-8000-000000000099", env())).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await rows()).toEqual(before);
});
it("rolls back the allocated identity and all series when another module's seed refuses", async () => {
  const before = await rows();
  modules.push(
    fakeModule("later", {
      provisioning: {
        seed: {
          summary: "refuse",
          run: async () => {
            throw new Error("later-refused");
          },
        },
      },
    }),
  );
  await expect(registerTill(NODE, env())).rejects.toThrow("later-refused");
  expect(await rows()).toEqual(before);
  expect(JSON.parse(await readFile(join(root, "current.json"), "utf8")).currentEntryState).toBe(
    "consumed-for-event",
  );
});

it.each(["archive", "bucket"])(
  "activates signed fiscal recovery through the %s command and preserves its complete old series",
  async (kind) => {
    const before = await rows();
    const cold = { ...request, binding: { ...binding, action: "restore" } };
    await writeFile(file, JSON.stringify(cold));
    await writeFile(
      join(root, "current.json"),
      JSON.stringify({ ...confirmation, binding: cold.binding }),
    );
    modules[0] = { ...modules[0]!, backup: { restore: ALLOCATED_FISCAL_RESTORE } };
    const backupKey = "separate backup encryption key";
    const stateDir = join(root, "replacement-state");
    await mkdir(stateDir);
    const source = join(root, "source.db");
    await suite.db.archiveTo(source);
    const manifest = {
      manifestVersion: 1,
      createdAt: "2026-10-13T09:00:00.000Z",
      environment: "preproduction",
      modules: {},
    };
    const entries = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
      },
    ];
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
      recoveryKey: backupKey,
      pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
    };
    const artifact = join(root, "cold-input");
    await writeFile(
      artifact,
      kind === "bucket"
        ? encodeRecoveryKit(kit)
        : encryptArtifact(
            packArchive([...entries, { name: "db.dump", bytes: await readFile(source) }]),
            backupKey,
          ),
    );
    const replacement = join(root, "replacement-venue");
    const lines: string[] = [];
    let failure: unknown;
    const attempt = runRestore({
      argv: kind === "archive" ? ["restore", artifact] : ["restore", "--from-bucket", artifact],
      env: {
        ...env(),
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: replacement,
        WAITRON_BACKUP_RECOVERY_KEY: backupKey,
      },
      out: (line) => {
        lines.push(line);
      },
      restore: (args) =>
        restoreFromArtifactFile({ ...args, migrationsRoot: null, migrate: async () => {} }).catch(
          (error) => {
            failure = error;
            throw error;
          },
        ),
      restoreStream: (args) =>
        writeStreamRestore({
          ...args,
          migrationsRoot: null,
          databasePath: source,
          entries,
          migrate: async () => {},
        }).catch((error) => {
          failure = error;
          throw error;
        }),
    });
    const status = await attempt;
    expect(failure).toBeUndefined();
    expect(lines.at(-1)).not.toContain("restore failed");
    expect(status).toBe(0);
    venueDir = replacement;
    const after = await rows();
    expect(after.sifs).toHaveLength(2);
    expect(after.sifs.find((row) => row.id === before.sifs[0]!.id)).toEqual({
      ...before.sifs[0],
      revocadoEn: expect.any(Date),
    });
    expect(after.sifs.find((row) => row.revocadoEn === null)).toMatchObject({
      numeroInstalacion: "P000042",
    });
    for (const old of before.series)
      expect(after.series.find((row) => row.id === old.id)).toEqual({
        ...old,
        retiredAt: expect.any(Date),
      });
    expect(
      after.series
        .filter((row) => row.retiredAt === null)
        .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
    ).toEqual([
      { code: "A-P000042", purpose: "standard", nextNumber: 1 },
      { code: "FF-P000042", purpose: "full", nextNumber: 1 },
      { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
    ]);
    expect(after.allocations.map((row) => row.approval)).toEqual([approval]);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(NODE);
    expect(lines.join("\n")).not.toContain(secret);
    expect(lines.join("\n")).not.toContain(backupKey);
  },
);
