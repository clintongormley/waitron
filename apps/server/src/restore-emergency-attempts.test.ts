import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deployment, invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu";
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
  "retains the %s activation result before publishing trading settings",
  async (kind) => {
    await stage(kind);
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: () => {},
      }),
    ).resolves.toBe(true);
    const path = join(
      outside,
      `${createHash("sha256").update("emergency-offline-restore").digest("hex")}.json`,
    );
    const record = JSON.parse(await readFile(path, "utf8"));
    expect(record.attempts).toEqual([
      {
        id: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        outcome: "returned",
      },
    ]);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_TILL_NODE_ID=${TENANT_A.nodeId}`,
    );
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.allocation).toEqual(record.allocation);
    } finally {
      await copy.close();
    }
    expect(await readFile(path, "utf8")).not.toContain(nodeKey);
    expect(await readFile(path, "utf8")).not.toContain(encryptionKey);
  },
);

it.each(["archive", "stream"] as const)(
  "refuses %s trading settings when the outside result cannot be published after local commit",
  async (kind) => {
    await stage(kind);
    const path = join(
      outside,
      `${createHash("sha256").update("emergency-offline-restore").digest("hex")}.json`,
    );
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: (_level, event, fields) => {
          if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu")
            mkdirSync(`${path}.next`);
        },
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    const record = JSON.parse(await readFile(path, "utf8"));
    expect(record.attempts).toEqual([
      {
        id: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: null,
        outcome: "started",
      },
    ]);
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.allocation).toEqual(record.allocation);
    } finally {
      await copy.close();
    }
    expect(await readFile(path, "utf8")).not.toContain(nodeKey);
  },
);

it("retains a thrown archive attempt after the real hook transaction rolls back", async () => {
  await stage("archive");
  await expect(
    runStagedRestore({
      stateDir,
      venueDir: join(root, "venue"),
      migrationsRoot: null,
      log: (_level, event, fields) => {
        if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu")
          throw new Error("injected callback interruption");
      },
    }),
  ).rejects.toThrow("injected callback interruption");
  await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  const path = join(
    outside,
    `${createHash("sha256").update("emergency-offline-restore").digest("hex")}.json`,
  );
  const record = JSON.parse(await readFile(path, "utf8"));
  expect(record.attempts).toEqual([
    {
      id: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      outcome: "threw",
    },
  ]);
  expect(await readFile(path, "utf8")).not.toContain("injected callback interruption");
  const copy = await openVenueDatabase(join(root, "venue"));
  try {
    expect(await copy.venue.select().from(fiscalAllocations)).toEqual([]);
  } finally {
    await copy.close();
  }
});

it.each(["archive", "stream"] as const)(
  "retains the readable %s incident before activation and its final outcome before trading settings",
  async (kind) => {
    await stage(kind);
    const path = join(
      outside,
      `${createHash("sha256").update("emergency-offline-restore").digest("hex")}.json`,
    );
    let seenBeforeCommit = false;
    await runStagedRestore({
      stateDir,
      venueDir: join(root, "venue"),
      migrationsRoot: null,
      log: (_level, event, fields) => {
        if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu") {
          const text = readFileSync(`${path}.txt`, "utf8");
          expect(text).toContain('"outcome": "started"');
          expect(text).toContain('"finishedAt": null');
          expect(text).toContain('"sourceId":');
          expect(text).not.toContain(nodeKey);
          expect(text).not.toContain(encryptionKey);
          expect(existsSync(join(stateDir, "trading.env"))).toBe(false);
          seenBeforeCommit = true;
        }
      },
    });
    expect(seenBeforeCommit).toBe(true);
    const json = await readFile(path, "utf8");
    const text = await readFile(`${path}.txt`, "utf8");
    expect(text).toContain(createHash("sha256").update(json).digest("hex"));
    expect(text).toContain(JSON.stringify(JSON.parse(json), null, 2));
    expect(text).toContain('"outcome": "returned"');
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_TILL_NODE_ID=${TENANT_A.nodeId}`,
    );
  },
);

it.each(["archive", "stream"] as const)(
  "refuses %s trading publication when the readable result cannot be retained after local activation",
  async (kind) => {
    await stage(kind);
    const path = join(
      outside,
      `${createHash("sha256").update("emergency-offline-restore").digest("hex")}.json`,
    );
    await expect(
      runStagedRestore({
        stateDir,
        venueDir: join(root, "venue"),
        migrationsRoot: null,
        log: (_level, event, fields) => {
          if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu") {
            unlinkSync(`${path}.txt`);
            mkdirSync(`${path}.txt`);
          }
        },
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    const record = JSON.parse(await readFile(path, "utf8"));
    expect(record.attempts[0].outcome).toBe("returned");
    const copy = await openVenueDatabase(join(root, "venue"));
    try {
      const rows = await copy.venue.select().from(fiscalAllocations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.allocation).toEqual(record.allocation);
    } finally {
      await copy.close();
    }
  },
);
