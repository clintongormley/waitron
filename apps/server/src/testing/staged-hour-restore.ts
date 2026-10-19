import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { locationId } from "@waitron/shared";
import {
  invoiceSeries,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
  type Database,
} from "@waitron/db";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { fiscalAllocations, registroSif } from "@waitron/fiscal-verifactu";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { mintBreakGlassKey } from "../break-glass.js";
import { ALL_MODULES } from "../modules.js";
import { buildManifest } from "../backup-manifest.js";
import { packArchive } from "../backup-archive.js";
import { encryptArtifact } from "../artifact-cipher.js";
import { previewRecoveryArchive } from "../recovery-backup-preview.js";
import { recoveryStreamSourceId } from "../recovery-source.js";
import { createSelectedRecoveryPreparation } from "../recovery-preparation.js";
import { runStagedRestore, stageRestoreRequest } from "../restore-request.js";

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
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
export async function stagedHourRestore(db: Database, kind: "archive" | "stream", eventId: string) {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  const root = await mkdtemp(join(tmpdir(), "live-hour-restore-"));
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(roots.stateDir);
  await mkdir(roots.venueDir);
  const cleanup = async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await seedTenants(db);
    await stampDeployment(db, "preproduction");
    const key = await mintBreakGlassKey(db, TENANT_A.nodeId);
    const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
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
      monotonicNow: () => performance.now(),
      read: async () => ({
        scope: { taxpayerNif: "89890001K", environment: "preproduction" },
        bases,
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable" as const,
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    await withOperationAuthority(initial, "administrator", async (authority) => {
      const selected = await setup.select({ binding: initial, authority, answer: "no" });
      if (selected.status !== "selected") throw new Error("initial hour not selected");
      await setup.prepare({ binding: initial, authority, input: selected.input }, (prepared) =>
        withTransaction(db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
      );
    });
    await db.update(invoiceSeries).set({ nextNumber: 123 });
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    const encryptionKey = "synthetic archive encryption key";
    const databasePath = join(root, "backup.db");
    const manifest = await buildManifest({
      db,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    const entries = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          `WAITRON_TILL_NODE_ID=${node.nodeId}\nWAITRON_TILL_LOCATION_ID=${node.locationId}\nWAITRON_ENV=preproduction\n`,
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
    ];
    await db.archiveTo(databasePath);
    const artifact = encryptArtifact(
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
      selected,
      readIsolation: async () => ({
        oldMachineAbsent: false,
        oldMachineOffline: true,
        noParallelRecovery: true,
      }),
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
    })) as { input: unknown };
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
    const nextEvent = async () => {
      const next = createSelectedRecoveryPreparation({
        ...options,
        binding: { ...binding, eventId: binding.eventId + "-another" },
      });
      const challenge = (await next.prepare({ action: "clock-challenge" })) as { id: string };
      await next.prepare({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      return next.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] });
    };
    const journalPath = join(roots.stateDir, "module-preparation-state.json");
    const journal = () => readFileSync(journalPath, "utf8");
    const snapshot = async () => {
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        return {
          allocations: await copy.venue.select().from(fiscalAllocations),
          registrations: await copy.venue.select().from(registroSif),
          series: await copy.venue.select().from(invoiceSeries),
        };
      } finally {
        await copy.close();
      }
    };
    const seedDestination = async () => {
      await db.archiveTo(join(roots.venueDir, "venue.db"));
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        await copy.venue.update(invoiceSeries).set({ nextNumber: 777 });
      } finally {
        await copy.close();
      }
      return { rows: await snapshot(), bytes: await readFile(join(roots.venueDir, "venue.db")) };
    };
    const advanceCounters = async () => {
      const copy = await openVenueDatabase(roots.venueDir);
      try {
        await copy.venue.update(invoiceSeries).set({ nextNumber: 917 });
      } finally {
        await copy.close();
      }
    };
    return {
      ...roots,
      root,
      key,
      encryptionKey,
      binding,
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
