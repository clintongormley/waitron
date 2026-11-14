import { seedModuleSettings } from "../test/module-settings.js";
import { readSetupFlowRecord, updateSetupFlowSection } from "@waitron/provisioning";
import { dirname, join } from "node:path";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { type RegisterAnswer, type StartAgainSummary } from "@waitron/provisioning";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { expectStartAgainDeleted, startAgainUnchanged } from "../test/start-again-deleted.js";
import { firstFiscalPublicDigest as publicDigest } from "./first-fiscal-delivery.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFakeTimersHourClock } from "./testing/hour-test-clock.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
const fixtures: Awaited<ReturnType<typeof hourFirstFiscalFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture(workspace?: { root: string; stateDir: string; venueDir: string }) {
  if (workspace !== undefined) vi.setSystemTime(new Date(Date.now() + 3_600_000));
  const f = await hourFirstFiscalFixture({
    clock: createFakeTimersHourClock(),
    database: () => suite.db,
    ...(workspace === undefined ? {} : { workspace }),
  });
  fixtures.push(f);
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const host = f.host;
  const actions = createFirstSetupResolutionActions({ ...f, host });
  const answer = (status: "Consumed" | "Not consumed" | "Unknown" = "Consumed") => ({
    kind: "current-master" as const,
    status,
    custodian: "Elena",
    reference: f.staged.ref.bindingDigest,
    consultedAt: "2026-10-16T12:20:00.000Z",
  });
  const start = async (
    register: RegisterAnswer = answer(),
    shown: { recoveryRecordDamagedShown?: true } = {},
  ) => {
    const inspected = await host.resolution.inspectFirstSetupResolution();
    return actions.startAgainFirstSetup({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
      register,
      ...shown,
    });
  };
  return { ...f, host, actions, start, answer };
}
it.each(["Consumed", "Not consumed", "Unknown"] as const)(
  "a never-activated box with a delivered PDF can start again after answering %s",
  async (status) => {
    const f = await fixture();
    await f.start(f.answer(status));
    await expectStartAgainDeleted(f);
    await expect(f.host.owner.status(f.ownerAttempt)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
  },
);
it.each(["activation-started", "uncertain"] as const)(
  "a retained %s event keeps the PDF reset unavailable even beside an empty database",
  async (kind) => {
    const f = await fixture();
    const changed = await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
      kind,
    });
    await f.store.update(f.ownerAttempt.attemptId, changed.revision, { kind: "abandoned" });
    await expect(f.start()).rejects.toMatchObject({ code: "setup.not_ready" });
  },
);
it("an unused PDF remains eligible after a publication binding was staged but activation never started", async () => {
  const f = await fixture();
  await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
    kind: "publication-binding",
    digest: "a".repeat(64),
  });
  await expect(f.start()).resolves.toBeUndefined();
});
it("three never-activated PDFs start again in the same folders", async () => {
  const first = await fixture();
  const folders = { root: first.root, venueDir: first.venueDir, stateDir: first.stateDir };
  await first.start();
  const second = await fixture(folders);
  await second.start();
  const third = await fixture(folders);
  await expect(third.start()).resolves.toBeUndefined();
  await expectStartAgainDeleted(folders);
});
const CONFIRMATIONS = "first-setup-start-again-confirmations";
async function abandonedWithMissingDatabase(
  changes: readonly ("activation-started" | "committed")[],
) {
  const f = await fixture();
  let revision = f.ownerAttempt.revision;
  for (const kind of changes) {
    const state = await f.store.update(
      f.ownerAttempt.attemptId,
      revision,
      kind === "committed" ? { kind, result: {} } : { kind },
    );
    revision = state.revision;
  }
  await f.store.update(f.ownerAttempt.attemptId, revision, { kind: "abandoned" });
  const name = (
    firstSetupModuleContext((await f.store.read())!, f.module).request as { identity: string }
  ).identity;
  await rm(join(f.venueDir, "venue.db"));
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const startAgain = (shown?: StartAgainSummary) =>
    f.actions.startAgainFirstSetup({
      ...ids,
      register: f.answer(),
      ...(shown === undefined
        ? {}
        : { confirmMissingDatabase: { nothingFiledOrSold: true as const, shown } }),
    });
  const attemptFiles = () =>
    Promise.all([join(f.stateDir, "flows/setup/record.json")].map((path) => readFile(path)));
  const confirmations = () =>
    readdir(join(f.stateDir, CONFIRMATIONS)).catch((error: { code?: string }) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const summary = () => f.actions.startAgainSummary(ids);
  return { f, name, ids, startAgain, summary, attemptFiles, confirmations };
}
it("an abandoned activation with a missing database starts again only once confirmed", async () => {
  const { startAgain, summary, attemptFiles, confirmations } = await abandonedWithMissingDatabase([
    "activation-started",
  ]);
  const before = await attemptFiles();
  await expect(startAgain()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await attemptFiles()).toEqual(before);
  expect(await confirmations()).toEqual([]);
  const shown = await summary();
  expect(shown).toEqual({ reached: "fiscal-started" });
  await expect(startAgain({ reached: "named" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await attemptFiles()).toEqual(before);
  expect(await confirmations()).toEqual([]);
  await startAgain(shown);
  expect(await confirmations()).toEqual([]);
});
it("an attempt committed before it was abandoned, with a missing database, is shown as fiscal-finished and starts again on confirmation", async () => {
  const { startAgain, summary, confirmations } = await abandonedWithMissingDatabase([
    "activation-started",
    "committed",
  ]);
  const shown = await summary();
  expect(shown).toEqual({ reached: "fiscal-finished" });
  await startAgain(shown);
  expect(await confirmations()).toEqual([]);
});
it.each([
  "no-master",
  "key",
  "stage",
  "modules",
  "missing-db",
  "unknown-input",
  "orphan-document",
  "orphan-manifest",
  "bare-module-file",
] as const)("unused-PDF reset refuses %s evidence", async (why) => {
  const f = await fixture();
  const directory = join(f.stateDir, "flows/setup/documents");
  if (why === "orphan-manifest")
    await updateSetupFlowSection(f.stateDir, "recoveryManifests", (current) => ({
      ...current,
      unknown: {},
    }));
  if (why === "bare-module-file") {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, f.module), "{}");
  }
  if (why === "key") {
    await updateSetupFlowSection(f.stateDir, "nodeKey", () => ({}));
  }
  if (why === "stage") {
    const key = JSON.parse(JSON.stringify((await readSetupFlowRecord(f.stateDir))?.nodeKey));
    key.stageId = "11111111-1111-4111-8111-111111111111";
    await updateSetupFlowSection(f.stateDir, "nodeKey", () => key);
  }
  if (why === "modules") await seedModuleSettings(f.venueDir, {});
  if (why === "missing-db") await rm(join(f.venueDir, "venue.db"));
  if (why === "unknown-input") {
    const path = join(f.stateDir, "flows/setup/record.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.attempt.inputs.unknown = { evidence: "not understood" };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state));
  }
  if (why === "orphan-document") {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "unknown.json"), "{}");
  }
  const unchanged = await startAgainUnchanged(f);
  await expect(
    f.start(why === "no-master" ? { kind: "no-current-master", confirmed: true } : f.answer()),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await unchanged();
});
it.each([
  [
    "catalogue",
    "insert into catalogues(id, name, created_at, updated_at) values ('menu', 'Retained', '2026-10-16', '2026-10-16')",
  ],
  [
    "used invoice name",
    "insert into invoice_series(id, node_id, code, next_number) values ('series', 'node', 'A', 2)",
  ],
  [
    "sale",
    "insert into sales(id, source, series_id, node_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values ('sale', 'operator_script', 'series', 'node', 1, '2026-10-16T12:00:00Z', 0, 100, '[]', 'en', '[\"en\"]', 'none', 'not_applicable')",
  ],
  [
    "filing",
    "insert into filing_cases(id, registro_id, cause, evidence, opened_at) values ('filing', 'registro', 'retained', '{}', 1)",
  ],
])("a retained %s independently refuses password-free unused-PDF reset", async (_name, sql) => {
  const f = await fixture();
  const connection = new DatabaseSync(join(f.venueDir, "venue.db"), {
    enableForeignKeyConstraints: false,
  });
  try {
    connection.exec(sql);
  } finally {
    connection.close();
  }
  const before = await readFile(join(f.venueDir, "venue.db"));
  await expect(f.start()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(before);
});
it.each(["manifest", "binding"] as const)(
  "a damaged recovery-key record (%s) without the warning shown is refused setup.attempt_conflict, and nothing changes; with it, Start again deletes the setup",
  async (why) => {
    const f = await fixture();
    await damageRecord(f, why);
    const unchanged = await startAgainUnchanged(f);
    await expect(f.start(f.answer())).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    await unchanged();
    await expect(
      f.start(f.answer(), { recoveryRecordDamagedShown: true }),
    ).resolves.toBeUndefined();
    await expectStartAgainDeleted(f);
  },
);
async function damageRecord(
  f: Awaited<ReturnType<typeof fixture>>,
  why: "manifest" | "binding" | "rehashed",
) {
  if (why === "manifest")
    await updateSetupFlowSection(f.stateDir, "recoveryManifests", () => ({ [f.module]: {} }));
  if (why === "binding") {
    const manifest = JSON.parse(
      JSON.stringify((await readSetupFlowRecord(f.stateDir))?.recoveryManifests?.[f.module]),
    );
    manifest.bindingDigest = "0".repeat(64);
    await updateSetupFlowSection(f.stateDir, "recoveryManifests", (current) => ({
      ...current,
      [f.module]: manifest,
    }));
  }
  if (why === "rehashed") {
    const manifest = JSON.parse(
      JSON.stringify((await readSetupFlowRecord(f.stateDir))?.recoveryManifests?.[f.module]),
    );
    expect(manifest.kind).toBe("recovery-key-delivery");
    manifest.statement.nodeKey.name = "different-recovery-key";
    manifest.bindingDigest = publicDigest(manifest.statement);
    await updateSetupFlowSection(f.stateDir, "recoveryManifests", (current) => ({
      ...current,
      [f.module]: manifest,
    }));
  }
}
/** The ids a page holds after reading the inspection, with the venue database left in place. */
async function inspectionIds(f: Awaited<ReturnType<typeof fixture>>) {
  const current = await f.host.resolution.inspectFirstSetupResolution();
  return {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
}
it("a rehashed document with an invalid module confirmation is refused without the warning shown, and starts again with it", async () => {
  const f = await fixture();
  const manifest = JSON.parse(
    JSON.stringify((await readSetupFlowRecord(f.stateDir))?.recoveryManifests?.[f.module]),
  );
  expect(manifest.kind).toBe("recovery-key-delivery");
  manifest.statement.nodeKey.name = "different-recovery-key";
  manifest.bindingDigest = publicDigest(manifest.statement);
  await updateSetupFlowSection(f.stateDir, "recoveryManifests", (current) => ({
    ...current,
    [f.module]: manifest,
  }));
  const unchanged = await startAgainUnchanged(f);
  await expect(f.start()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await unchanged();
  await expect(f.start(f.answer(), { recoveryRecordDamagedShown: true })).resolves.toBeUndefined();
  await expectStartAgainDeleted(f);
});
it.each(["manifest", "binding", "rehashed"] as const)(
  "with the warning shown, a damaged recovery-key record (%s) starts again",
  async (why) => {
    const f = await fixture();
    await damageRecord(f, why);
    const ids = await inspectionIds(f);
    await expect(
      f.actions.startAgainFirstSetup({
        ...ids,
        register: f.answer(),
        recoveryRecordDamagedShown: true,
      }),
    ).resolves.toBeUndefined();
    await expectStartAgainDeleted(f);
  },
);
it("without the warning shown, a damaged record is refused, and nothing changes", async () => {
  const f = await fixture();
  await damageRecord(f, "manifest");
  const ids = await inspectionIds(f);
  const unchanged = await startAgainUnchanged(f);
  await expect(
    f.actions.startAgainFirstSetup({ ...ids, register: f.answer() }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await unchanged();
});
it("the warning flag on a box whose record reads cleanly is refused, and nothing changes", async () => {
  const f = await fixture();
  const ids = await inspectionIds(f);
  const unchanged = await startAgainUnchanged(f);
  await expect(
    f.actions.startAgainFirstSetup({
      ...ids,
      register: f.answer(),
      recoveryRecordDamagedShown: true,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await unchanged();
});
it("the warning flag with the database missing is refused", async () => {
  const { f, ids, summary, attemptFiles, confirmations } = await abandonedWithMissingDatabase([
    "activation-started",
  ]);
  const shown = await summary();
  const before = await attemptFiles();
  await expect(
    f.actions.startAgainFirstSetup({
      ...ids,
      register: f.answer(),
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      recoveryRecordDamagedShown: true,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles()).toEqual(before);
  expect(await confirmations()).toEqual([]);
});
it.each(["key", "stage", "unknown-input", "orphan-document"] as const)(
  "other damaged evidence (%s) still refuses setup.not_ready",
  async (why) => {
    const f = await fixture();
    const directory = join(f.stateDir, "flows/setup/documents");
    if (why === "key") {
      await updateSetupFlowSection(f.stateDir, "nodeKey", () => ({}));
    }
    if (why === "stage") {
      const key = JSON.parse(JSON.stringify((await readSetupFlowRecord(f.stateDir))?.nodeKey));
      key.stageId = "11111111-1111-4111-8111-111111111111";
      await updateSetupFlowSection(f.stateDir, "nodeKey", () => key);
    }
    if (why === "unknown-input") {
      const path = join(f.stateDir, "flows/setup/record.json");
      const state = JSON.parse(await readFile(path, "utf8"));
      state.attempt.inputs.unknown = { evidence: "not understood" };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state));
    }
    if (why === "orphan-document") {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "unknown.json"), "{}");
    }
    const ids = await inspectionIds(f);
    const unchanged = await startAgainUnchanged(f);
    await expect(
      f.actions.startAgainFirstSetup({
        ...ids,
        register: f.answer(),
        recoveryRecordDamagedShown: true,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await unchanged();
  },
);
it("a damaged record and no staged node key is refused setup.not_ready, and nothing changes", async () => {
  const f = await fixture();
  await damageRecord(f, "manifest");
  await updateSetupFlowSection(f.stateDir, "nodeKey", () => undefined);
  const ids = await inspectionIds(f);
  const unchanged = await startAgainUnchanged(f);
  const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
  await expect(
    f.actions.startAgainFirstSetup({
      ...ids,
      register: f.answer(),
      recoveryRecordDamagedShown: true,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await unchanged();
  expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
});
it("a damaged record beside a refused artifact refuses setup.not_ready", async () => {
  const f = await fixture();
  await damageRecord(f, "manifest");
  await writeFile(join(f.stateDir, "trading.env"), "X=1");
  const unchanged = await startAgainUnchanged(f);
  await expect(f.start(f.answer())).rejects.toMatchObject({ code: "setup.not_ready" });
  await unchanged();
});
it("a damaged recovery-key record alone is refused with no params without the warning shown, and starts again with it", async () => {
  const f = await fixture();
  await damageRecord(f, "manifest");
  const refused = await f.start().then(
    () => null,
    (error: unknown) => error,
  );
  expect(refused).toMatchObject({ code: "setup.attempt_conflict" });
  expect((refused as { params: unknown }).params).toEqual({});
  await expect(f.start(f.answer(), { recoveryRecordDamagedShown: true })).resolves.toBeUndefined();
  await expectStartAgainDeleted(f);
});
