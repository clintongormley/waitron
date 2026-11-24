import { allocationRows } from "@waitron/fiscal-verifactu/test/allocation-rows.js";
import { advanceSeriesTo, seriesWithNextNumber } from "@waitron/db/testing/seed.js";
import { seedModuleSettings } from "../../test/module-settings.js";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { recordSale } from "@waitron/core";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { seriesId as brandSeriesId } from "@waitron/shared";
import {
  invoiceSeries,
  readStandardSeriesId,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import {
  verifactuSubmissions,
  verifactuIdentities,
  verifactuRecords,
  VerifactuBackend,
} from "@waitron/fiscal-verifactu";
import { seedVenueNodes, TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { mintBreakGlassKey } from "../break-glass.js";
import { ALL_MODULES } from "../modules.js";
import { buildManifest } from "../backup-manifest.js";
import { packArchive } from "../backup-archive.js";
import { sealFixtureArtifact } from "../../test/fixture-salt.js";
import { previewRecoveryArchive } from "../recovery-backup-preview.js";
import { recoveryStreamSourceId } from "../recovery-source.js";
import { createSelectedRecoveryPreparation } from "../recovery-preparation.js";
import { runStagedRestore, stageRestoreRequest } from "../restore-request.js";
import { box } from "@waitron/node-db";
import { nodeDumpEntry } from "./node-copy.js";
import {
  createFakeTimersHourClock,
  recoverySelectPastWaits,
  selectPastWaits,
  type HourTestClock,
} from "./hour-test-clock.js";
import { SERIES_BASES } from "@waitron/db/testing/series-bases.js";

const bases = SERIES_BASES;
export async function stagedHourCrash(
  { db, node: nodeDb }: { db: Database; node: NodeDatabase },
  kind: "archive" | "stream",
  eventId: string,
  seams: {
    clock?: HourTestClock;
    /** Defaults to a browser on another device. */
    requestFromBox?: () => boolean;
  } = {},
) {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  // Each select starts two minutes before the minute it names: a setup or restore waits until a
  // minute start 90 to 150 seconds after its check.
  vi.setSystemTime(new Date("2026-10-16T11:38:00Z"));
  const clock = seams.clock ?? createFakeTimersHourClock();
  const client = { onBox: (seams.requestFromBox ?? (() => false))() };
  /** A clock of the suite's own keeps the faked `Date` beside it; the default one already is. */
  const follow = () => {
    if (clock.wall() !== Date.now()) vi.setSystemTime(clock.wall());
  };
  follow();
  const root = await mkdtemp(join(tmpdir(), "live-hour-restore-"));
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(roots.stateDir);
  await mkdir(roots.venueDir);
  const cleanup = async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await seedVenueNodes(db);
    await stampDeployment(db, "preproduction");
    const key = await mintBreakGlassKey({ venue: db, node: nodeDb }, TAXPAYER_A.nodeId);
    const node = { nodeId: TAXPAYER_A.nodeId };
    const initial: OperationBinding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "original",
      sourceId: "original",
      targetNodeId: node.nodeId,
    };
    let value: unknown = null;
    const setup = createHourPreparation({
      withState: async (_binding, body) =>
        body({
          get value() {
            return value;
          },
          history: [],
          async replace(next) {
            value = next;
          },
        }),
      monotonicNow: () => clock.monotonic(),
      read: async () => ({
        scope: { taxpayerNif: "89890001K", environment: "preproduction" },
        bases,
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable" as const,
            instantMs: clock.wall(),
            uncertaintyMs: 0,
            wallStartedMs: clock.wall(),
            wallFinishedMs: clock.wall(),
            monotonicStartedMs: clock.monotonic(),
            monotonicFinishedMs: clock.monotonic(),
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    await withOperationAuthority(initial, "administrator", async (authority) => {
      const selected = await selectPastWaits(clock, () => {
        follow();
        return setup.select({
          binding: initial,
          authority,
          comparisonId: "comparison",
          confirmed: true,
        });
      });
      if (selected.status !== "selected") throw new Error("initial hour not selected");
      await setup.prepare({ binding: initial, authority, input: selected.input }, (prepared) =>
        withTransaction(db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
      );
    });
    const saleSeries = await readStandardSeriesId(db, node.nodeId);
    const backend = new VerifactuBackend({
      db,
      deploymentEnvironment: "preproduction",
      clock: steadyClock,
    });
    await withTransaction(db, (tx) =>
      recordSale(
        tx,
        backend,
        saleInput({ nodeId: node.nodeId, seriesId: brandSeriesId(saleSeries) }),
      ),
    );
    await advanceSeriesTo(db, node.nodeId, 123);
    clock.set(Date.parse("2026-10-16T12:38:00Z"));
    follow();
    const encryptionKey = "synthetic archive encryption key";
    const databasePath = join(root, "backup.db");
    await seedModuleSettings(db, { "fiscal-none": false });
    const manifest = await buildManifest({
      db,
      node: nodeDb,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    const entries = [
      await nodeDumpEntry(nodeDb, root),
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_NODE_ID=${node.nodeId}\nWAITRON_ENV=preproduction\n`),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("synthetic sealed node key") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
    ];
    await db.archiveTo(databasePath);
    const artifact = sealFixtureArtifact(
      packArchive([...entries, { name: "db.dump", bytes: await readFile(databasePath) }]),
      encryptionKey,
    );
    const restore = {
      ...roots,
      stagingDir: root,
      migrationsRoot: null,
      modules: ALL_MODULES,
      environment: "preproduction" as const,
      artifact,
      recoveryKey: encryptionKey,
      log: () => {},
    };
    const preview = await previewRecoveryArchive(restore);
    const sourceId =
      kind === "archive" ? preview.sourceId : await recoveryStreamSourceId(databasePath, entries);
    const binding: OperationBinding = {
      module: "fiscal-verifactu",
      action: "restore",
      eventId,
      sourceId,
      targetNodeId: node.nodeId,
    };
    const selected = { ...preview, activationSourceId: sourceId };
    const options = {
      ...roots,
      modules: ALL_MODULES,
      coordinator: createFirstSetupCoordinator(),
      binding,
      node,
      secret: key.secret,
      database: () => db,
      nodeDatabase: () => nodeDb,
      selected,
      testClock: clock,
      readIsolation: async () => ({
        oldMachineAbsent: false,
        oldMachineOffline: true,
        noParallelRecovery: true,
      }),
    };
    const service = createSelectedRecoveryPreparation(options);
    const outcome = (await recoverySelectPastWaits(clock, service, client, follow)) as {
      input: unknown;
    };
    const common = {
      environment: "preproduction" as const,
      recoveryOperation: { binding, input: outcome.input },
      nodeRecoverySecret: key.secret,
      recoveryContext: {
        selectedSourceId: selected.sourceId,
        oldBoxGone: true,
        soleRecovery: true,
      },
    };
    await stageRestoreRequest(
      roots.stateDir,
      kind === "archive"
        ? { ...common, artifact, recoveryKey: encryptionKey }
        : { ...common, kind: "stream", databasePath, entries },
    );
    if (kind === "stream")
      await copyFile(join(roots.stateDir, "flows/restore/venue.db"), databasePath);
    const nextEvent = async () => {
      const next = createSelectedRecoveryPreparation({
        ...options,
        binding: { ...binding, eventId: binding.eventId + "-another" },
      });
      return recoverySelectPastWaits(clock, next, client, follow);
    };
    const journalPath = join(roots.stateDir, "module-records/fiscal-verifactu.json");
    const journal = () => readFileSync(journalPath, "utf8");
    const snapshot = async () => {
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        return {
          submissions: await copy.venue.select().from(verifactuSubmissions),
          nodeKeys: await copy.node.select().from(box),
          allocations: await allocationRows(copy.venue),
          registrations: await copy.venue.select().from(verifactuIdentities),
          series: await copy.venue.select(seriesWithNextNumber).from(invoiceSeries),
          records: await copy.venue.select().from(verifactuRecords),
        };
      } finally {
        await copy.close();
      }
    };
    const seedDestination = async () => {
      await db.archiveTo(join(roots.venueDir, "venue.db"));
      await nodeDb.archiveTo(join(roots.venueDir, "node.db"));
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        await advanceSeriesTo(copy.venue, node.nodeId, 777);
      } finally {
        await copy.close();
      }
      return { rows: await snapshot(), bytes: await readFile(join(roots.venueDir, "venue.db")) };
    };
    const advanceCounters = async () => {
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        await advanceSeriesTo(copy.venue, node.nodeId, 917);
      } finally {
        await copy.close();
      }
    };
    const freshStage = async () => {
      clock.set(Date.parse("2026-10-16T13:38:00Z"));
      follow();
      const freshBinding = { ...binding, eventId: "fresh-after-interruption" };
      const fresh = createSelectedRecoveryPreparation({ ...options, binding: freshBinding });
      const outcome = (await recoverySelectPastWaits(clock, fresh, client, follow)) as {
        input: unknown;
      };
      const freshCommon = {
        ...common,
        recoveryOperation: { binding: freshBinding, input: outcome.input },
      };
      await stageRestoreRequest(
        roots.stateDir,
        kind === "archive"
          ? { ...freshCommon, artifact, recoveryKey: encryptionKey }
          : { ...freshCommon, kind: "stream", databasePath, entries },
      );
    };
    return {
      ...roots,
      root,
      key,
      encryptionKey,
      binding,
      node,
      service,
      selected,
      restore,
      databasePath,
      freshStage,
      journalPath,
      journal,
      snapshot,
      seedDestination,
      advanceCounters,
      nextEvent,
      cleanup,
      run: (log: Parameters<typeof runStagedRestore>[0]["log"] = () => {}) =>
        runStagedRestore({ ...restore, log }),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
