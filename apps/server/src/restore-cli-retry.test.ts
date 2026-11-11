import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { invoiceSeries, withTransaction, stampDeployment } from "@waitron/db";
import { nodeId } from "@waitron/shared";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { seedTradingVenue, TILL_ENV, copyMigrationsRoot } from "./testing/boot-harness.js";
import { ALL_MODULES } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { runRestore } from "./restore-command.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("runs the command-line restore again over a pending first start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-restore-retry-"));
  dirs.push(dir);
  await seedTradingVenue(suite.db);
  const node = { nodeId: nodeId(TILL_ENV.WAITRON_NODE_ID) };
  await suite.db.insert(invoiceSeries).values([
    { nodeId: node.nodeId, code: "FA", purpose: "standard" },
    { nodeId: node.nodeId, code: "FF", purpose: "full" },
  ]);
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: node.nodeId,
      nif: "90000001R",
      idSistemaInformatico: "WT",
      numeroInstalacion: "S000001",
    }),
  );
  await stampDeployment(suite.db, "preproduction");
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, node.nodeId);
  const source = join(dir, "source.db");
  const sourceNode = join(dir, "source-node.db");
  await suite.db.archiveTo(source);
  await suite.node.archiveTo(sourceNode);
  const key = "selected backup key";
  const artifact = join(dir, "backup.wrb");
  await writeFile(
    artifact,
    encryptArtifact(
      packArchive([
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify(
              await buildManifest({
                db: suite.db,
                node: suite.node,
                modules: ALL_MODULES,
                environment: "preproduction",
                now: new Date(),
              }),
            ),
          ),
        },
        { name: "db.dump", bytes: await readFile(source) },
        { name: "node.dump", bytes: await readFile(sourceNode) },
        { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${node.nodeId}\n`) },
        {
          name: "secrets/secrets.env",
          bytes: Buffer.from(
            "WAITRON_CREDENTIALS_KEY=" +
              Buffer.alloc(32, 5).toString("base64") +
              "\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
          ),
        },
      ]),
      key,
    ),
  );
  const migrations = join(dir, "migrations");
  await copyMigrationsRoot(migrations);
  const stateDir = join(dir, "state");
  const venueDir = join(stateDir, "venue");
  const allocation = allocationFixture({
    node,
    identity: "P000071",
    taxpayerNif: "90000001R",
    softwareId: "WT",
    recoveryKey: true,
    bases: [
      { code: "FA", purpose: "standard" },
      { code: "FF", purpose: "full" },
    ],
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 2) await writeFile(join(stateDir, "flows/restore/record.json"), "broken");
    const held = allocation.request("restore");
    const modules = ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: held.preparation } : module,
    );
    const output: string[] = [];
    const result = await runRestore({
      argv: ["restore", artifact, "--confirm-old-box-gone"],
      env: {
        WAITRON_ENV: "preproduction",
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_MIGRATIONS_DIR: migrations,
        WAITRON_BACKUP_RECOVERY_KEY: key,
      },
      withModuleOperations: createRecoveryRestoreRunner(
        modules,
        { binding: held.binding, input: held.input },
        secret,
      ),
      out: (line) => output.push(line),
    });
    expect({
      result,
      failures: output.filter((line) => line.startsWith("restore failed")),
    }).toEqual({ result: 0, failures: [] });
    expect(
      JSON.parse(await readFile(join(stateDir, "flows/restore/record.json"), "utf8")),
    ).toMatchObject({ phase: "first-start", firstStart: { source: "archive" } });
  }
}, 60_000);
