import * as fs from "node:fs/promises";
import { loadKeyRing } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createFiscalReadinessStore,
  fiscalReadinessDatabaseKey,
  stageConfigurationImport,
  encodeConfigurationBundle,
  updateSetupFlowSection,
  writeDurableHostJson,
  type FiscalReadinessInput,
} from "@waitron/provisioning";
import { configurationBundle } from "@waitron/provisioning/testing/configuration-bundle";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { clock, external } from "../test/hour-recovery-host.js";
import { heldSetup } from "../test/held-setup-database.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { request } from "../test/first-fiscal.js";
import { mkdir, mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { emptyScratch } from "./scratch.js";

vi.mock("node:fs/promises", { spy: true });
const early = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it.each([
  "claimed",
  "consumption-intent",
  "activation-started",
  "committed",
  "publication",
] as const)("Start again after %s leaves only the box's own files", async (status) => {
  let host: ReturnType<typeof createFirstSetupModuleHost>;
  let folders: { stateDir: string; venueDir: string };
  if (status === "committed" || status === "publication") {
    let injected = false;
    if (status === "publication") {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (
          !injected &&
          String(to).endsWith("/flows/setup/record.json") &&
          JSON.parse(await actual.readFile(from, "utf8")).attempt?.status === "complete"
        ) {
          injected = true;
          throw new Error("final setup record write interrupted");
        }
        return actual.rename(from, to);
      });
    }
    const held = await heldSetup({ status, tradingSettings: status === "publication" });
    host = held.host;
    folders = held.roots;
    if (status === "publication") expect(injected).toBe(true);
  } else {
    const root = await mkdtemp(join(tmpdir(), "setup-stage-leftovers-"));
    roots.push(root);
    folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
    await mkdir(folders.venueDir);
    if (status === "claimed") {
      host = createFirstSetupModuleHost({
        ...folders,
        modules: ALL_MODULES,
        environment: {},
        database: () => early.db,
        testClock: clock,
      });
      await host.owner.claimFirstSetup({ environment: "production", request });
    } else {
      external.internet.mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: Date.now(),
        uncertaintyMs: 500,
        wallStartedMs: Date.now(),
        wallFinishedMs: Date.now(),
        monotonicStartedMs: performance.now(),
        monotonicFinishedMs: performance.now(),
      }));
      const prepared = await hourFirstFiscalFixture({
        database: () => early.db,
        clock,
        workspace: { root, ...folders },
      });
      host = prepared.host;
      if (status === "activation-started") {
        const state = (await host.store.read())!;
        await host.store.update(state.frozen.attemptId, state.revision, {
          kind: "activation-started",
        });
      }
    }
  }
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 8).toString("base64") });
  const readiness: FiscalReadinessInput = {
    requirement: "accepted-test-submission",
    fiscalModule: "fiscal-verifactu",
    country: request.country,
    taxId: request.taxId,
    legalName: request.legalName,
    fiscalTerritory: request.fiscalTerritory,
    submissionTarget: "preproduction",
    certificateFingerprint: null,
    certificateKind: null,
    moduleVersions: {},
    applicationVersion: "test",
  };
  await createFiscalReadinessStore(
    folders.stateDir,
    async () => ({ status: "accepted" }),
    ring.current.key,
  ).run(readiness);
  const readinessFolder = `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readiness)}`;
  await applyMigrations(
    join(folders.stateDir, readinessFolder),
    migrationOptionsFor(manifestSets(), null),
  );
  const readinessBefore = await readFile(join(folders.stateDir, readinessFolder, "venue.db"));
  const passphrase = "synthetic import passphrase";
  await stageConfigurationImport(
    folders.stateDir,
    ring,
    encodeConfigurationBundle(configurationBundle(), passphrase),
    passphrase,
    async () => {},
  );
  await updateSetupFlowSection(folders.stateDir, "publicEvidence", () => ({
    version: 1,
    modules: {},
    history: [],
  }));
  if (status === "committed" || status === "publication")
    await writeDurableHostJson(
      join(folders.stateDir, "flows/setup/documents/attachment.json"),
      { data: "setup attachment" },
      8192,
    );
  expect(await readFile(join(folders.stateDir, "flows/setup/readiness.json"))).toBeInstanceOf(
    Buffer,
  );
  expect(await readFile(join(folders.stateDir, "flows/setup/import/artifact"))).toBeInstanceOf(
    Buffer,
  );
  expect((await host.store.read())?.status).toBe(status);
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...folders, host });
  const shown = await actions.startAgainSummary(ids);
  await actions.startAgainFirstSetup({
    ...ids,
    ...(inspected.database === "missing"
      ? { confirmMissingDatabase: { nothingFiledOrSold: true, shown } }
      : {}),
  });
  await emptyScratch(folders.stateDir, () => {});
  const allowed = [
    "backup.env",
    "flows",
    "module-records",
    "records",
    "recovery.json",
    "recovery.lock",
    "scratch",
    "secrets.env",
    "spare-space",
    "spare-space.released",
    "tls",
    "venue",
  ];
  expect(
    (await readdir(folders.stateDir)).filter(
      (name) => !allowed.includes(name) && name !== readinessFolder,
    ),
  ).toEqual([]);
  expect(await readdir(join(folders.stateDir, "flows"))).toEqual([]);
  expect(await readFile(join(folders.stateDir, readinessFolder, "venue.db"))).toEqual(
    readinessBefore,
  );
  expect(
    await readdir(join(folders.stateDir, "scratch")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }),
  ).toEqual([]);
  expect(
    (await readdir(folders.venueDir)).filter(
      (name) =>
        ![
          "venue.lock",
          "venue.lock-journal",
          "venue.holder.json",
          "migrations.lock",
          "recovery.lock",
        ].includes(name),
    ),
  ).toEqual([]);
});
