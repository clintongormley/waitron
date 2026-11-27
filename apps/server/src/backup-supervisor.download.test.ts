import { recordSale } from "@waitron/core";
import {
  invoiceSeries,
  openVenueDatabase,
  sales,
  withNodeTransaction,
  withTransaction,
} from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import {
  saleInput,
  steadyClock,
  storedRecord,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { readNodeModeRow, setPrimaryRoleTx } from "@waitron/node-db";
import { decodeMasterKeyCode, seriesId } from "@waitron/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { agreeInternet, clock, host, key, node, root, suite } from "../test/hour-recovery-host.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { createStagingTurn } from "./backup-staging-turn.js";
import { BackupSupervisor } from "./backup-supervisor.js";
import { ALL_MODULES } from "./modules.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";
import { restoreFromArtifactFile } from "./restore.js";
import { receiveSetupArchive } from "./setup-archive-upload.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { backupKeySettings, heldBackupKey } from "./testing/backup-key.js";
import { TRADING_BOOT_KEY_ENV } from "./testing/boot-trading-fixture.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { formatEnvFile } from "./env-file.js";

it("restores the latest sale, fiscal record and local role from the checked shutdown download", async () => {
  const f = await host();
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  const [standard] = await suite.db
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.purpose, "standard"), isNull(invoiceSeries.retiredAt)));
  const saleClock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(clock.wall()) }),
  };
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: saleClock,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
  });
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({ nodeId: node.nodeId, seriesId: seriesId(standard.id), clock: saleClock }),
    ),
  );
  const fiscal = await storedRecord(suite.db, sale.fiscal.recordId);
  expect(fiscal).toBeDefined();
  await withNodeTransaction(suite.node, (tx) => setPrimaryRoleTx(tx, node.nodeId, "adopt"));
  const source = join(root, "source-state");
  for (const file of RECOVERY_FILES) {
    const output = join(source, file);
    await mkdir(dirname(output), { recursive: true });
    const value =
      file === "secrets.env"
        ? formatEnvFile(TRADING_BOOT_KEY_ENV)
        : file === "trading.env"
          ? formatEnvFile({ WAITRON_NODE_ID: node.nodeId, WAITRON_ENV: "preproduction" })
          : "Synthetic recovery fixture";
    await writeFile(output, value);
  }
  const held = heldBackupKey(decodeMasterKeyCode(key.secret));
  await replaceBackupSettings(source, backupKeySettings(held));
  const venueFile = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const supervisor = new BackupSupervisor({
    buildConfig: async () => undefined,
    readSingletonRole: () => "primary",
    venueDir: dirname(venueFile),
    modules: ALL_MODULES,
    environment: "preproduction",
    stateDir: source,
    nodeId: node.nodeId,
    jitterSeed: "checked-download",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    log: () => {},
    stagingTurn: createStagingTurn(),
  });
  try {
    const archive = await supervisor.runForShutdownDownload(
      new AbortController().signal,
      held,
      null,
    );
    try {
      const bytes = await readFile(archive.path);
      expect(archive.bytes).toBe(bytes.byteLength);
      expect(archive.name).toMatch(/\.backup\.enc$/);
      const stagingDir = join(root, "upload-staging");
      const upload = await receiveSetupArchive(
        new Request("https://setup.test/restore", { method: "POST", body: new Uint8Array(bytes) }),
        stagingDir,
      );
      try {
        const restore = {
          ...f.roots,
          artifactPath: upload.artifactPath,
          recoveryKey: held.key,
          stagingDir,
          migrationsRoot: null,
          modules: ALL_MODULES,
          environment: "preproduction" as const,
          log: () => {},
        };
        const selected = await previewRecoveryArchive(restore);
        const { readRecoveryFacts: omitted, ...options } = f.options;
        void omitted;
        const recovery = createSelectedRecoveryPreparation({
          ...options,
          ...restore,
          selected,
          binding: { ...options.binding, sourceId: selected.sourceId },
          readIsolation: async () => ({
            oldMachineAbsent: false,
            oldMachineOffline: true,
            noParallelRecovery: true,
          }),
        });
        agreeInternet();
        const prepared = (await recoverySelectPastWaits(clock, recovery, { onBox: false })) as {
          input: unknown;
        };
        await restoreFromArtifactFile({
          ...restore,
          modules: recovery.modules,
          withModuleOperations: recovery.runner(prepared.input),
        });
      } finally {
        await upload.dispose();
      }
      const restored = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(
          await restored.venue
            .select({ id: sales.id })
            .from(sales)
            .where(eq(sales.id, sale.saleId)),
        ).toEqual([{ id: sale.saleId }]);
        expect(await storedRecord(restored.venue, sale.fiscal.recordId)).toEqual(fiscal);
        expect(await readNodeModeRow(restored.node, node.nodeId)).toEqual({
          mode: "primary",
          singletonRole: "primary",
        });
      } finally {
        await restored.close();
      }
    } finally {
      await archive.remove();
    }
    expect(await readdir(join(source, "scratch", "restore"))).toEqual([]);
  } finally {
    await supervisor.stop();
  }
});
