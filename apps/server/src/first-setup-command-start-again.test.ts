import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import {
  deploymentTableExists,
  openVenueDatabase,
  readDeploymentEnvironment,
  stampDeployment,
  type Database,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loadKeyRing } from "@waitron/credentials";
import {
  applyVenue,
  createFiscalReadinessStore,
  createFirstSetupCommandDeployment,
  encodeConfigurationBundle,
  fiscalReadinessDatabaseKey,
  stageConfigurationImport,
  type FiscalReadinessInput,
  createFirstSetupRuntime,
  readTenantIdentities,
  runCli,
  type CliDeps,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { PASSWORD, request } from "../test/first-fiscal.js";
import { diskSnapshot, expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

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

const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const environment = {
  WAITRON_MANAGEMENT_ORIGIN: "https://olivo.example.test:3443",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
};

/**
 * Where the command is cut off. `activation-started` also stands in for the box stopping there:
 * the setup record is written no further.
 */
type CutOff = "before-activation" | "activation-started" | "uncertain";

/** The venue command as `bin.ts` wires it, on real files, with its waits passed on the faked clock. */
function command(
  root: string,
  cutOff: CutOff | null,
): { args: string[]; deps: CliDeps; output: string[]; refusals: () => number } {
  const refuseBeforeActivation = cutOff !== null;
  const stateDir = join(root, "state");
  const venueDir = join(root, "venue");
  const output: string[] = [];
  let refusals = 0;
  let database: Database | undefined;
  const args = [
    "venue",
    "--venue-dir",
    venueDir,
    "--country",
    request.country,
    "--tax-id",
    request.taxId,
    "--legal-name",
    request.legalName,
    "--taxpayer-domicile",
    request.taxpayerDomicile,
    "--venue-name",
    request.name,
    "--territory",
    request.fiscalTerritory,
    "--locale",
    "es-ES",
    "--operation-description",
    request.operationDescription,
    "--address-line1",
    request.addressLine1,
    "--address-line2",
    "",
    "--postal-code",
    request.postalCode,
    "--city",
    request.city,
    "--province",
    request.province,
    "--time-zone",
    request.timeZone,
    "--day-cutover",
    request.dayCutover,
    "--series-code",
    "A",
    "--rectificative-code",
    "R",
    "--admin-name",
    request.admin.displayName,
    "--admin-email",
    request.admin.email,
    "--recovery-pdf",
    join(root, refuseBeforeActivation ? "refused.pdf" : "recovery.pdf"),
    "--yes",
  ];
  const deps: CliDeps = {
    io: {
      stdout: (line) => void output.push(line),
      stderr: (line) => void output.push(line),
      prompt: async (question) => (question.startsWith("Have you kept") ? "yes" : "no"),
      promptSecret: async () => PASSWORD,
      clearScreen() {},
    },
    env: { WAITRON_ADMIN_PIN: request.admin.pin, WAITRON_ADMIN_PASSWORD: PASSWORD },
    openVenue: async (directory) => {
      const store = await openVenueDatabase(directory);
      database = store.venue;
      return {
        ...store,
        async close() {
          database = undefined;
          await store.close();
        },
      };
    },
    firstSetupDeployment: ({ runtime, db, node }) => {
      const deployment = createFirstSetupCommandDeployment({ runtime, db, node, environment });
      if (!refuseBeforeActivation) return deployment;
      // Before activation: stands in for a refusal after the deployment adapter starts
      // provisioning, such as a module's own last check. After it: for a failed stamp write.
      return {
        ...deployment,
        provision: (provisionRequest, beforeTransaction) =>
          deployment.provision(provisionRequest, async () => {
            if (cutOff !== "before-activation") await beforeTransaction();
            refusals++;
            throw new AppError("setup.not_ready", {});
          }),
      };
    },
    applyVenue,
    modules: ALL_MODULES,
    configureFirstSetup: () => {
      const runtime = createFirstSetupRuntime({
        environment: {},
        stateDir,
        venueDir,
        modules: ALL_MODULES,
        database: () => database,
      });
      if (cutOff === "activation-started") {
        const update = runtime.store.update.bind(runtime.store);
        runtime.store.update = (attemptId, revision, change, hold) =>
          ["uncertain", "committed"].includes(change.kind)
            ? Promise.reject(new Error("test: the box stopped"))
            : update(attemptId, revision, change, hold);
      }
      return runtime;
    },
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
    sleep: async (ms) => void vi.advanceTimersByTime(ms),
  };
  return { args, deps, output, refusals: () => refusals };
}

async function stamped(venueDir: string) {
  const opened = await openVenueDatabase(venueDir);
  try {
    return await readDeploymentEnvironment(opened.venue);
  } finally {
    await opened.close();
  }
}

async function migratedVenue(root: string) {
  await mkdir(join(root, "state"), { recursive: true });
  await applyMigrations(join(root, "venue"), migrationOptionsFor(manifestSets(), null));
}

it("a command refused before activation leaves a setup Start again deletes, and the next command run completes", async () => {
  const root = await mkdtemp(join(tmpdir(), "command-start-again-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await migratedVenue(root);

  const refused = command(root, "before-activation");
  expect(await runCli(refused.args, refused.deps), JSON.stringify(refused.output)).toBe(1);
  expect(refused.output.at(-1)).toBe("setup.not_ready {}");
  expect(refused.refusals()).toBe(1);
  expect(await stamped(folders.venueDir)).toBeNull();

  const host = createFirstSetupModuleHost({ ...folders, modules: ALL_MODULES, environment: {} });
  expect((await host.store.read())!.status).toBe("consumption-intent");
  const actions = createFirstSetupResolutionActions({ ...folders, host });
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  expect(await actions.startAgainSummary(ids)).toMatchObject({ reached: expect.any(String) });
  await actions.startAgainFirstSetup(ids);
  await expectStartAgainDeleted(folders);

  await migratedVenue(root);
  const next = command(root, null);
  expect(await runCli(next.args, next.deps), JSON.stringify(next.output)).toBe(0);
  const done = createFirstSetupModuleHost({ ...folders, modules: ALL_MODULES, environment: {} });
  expect((await done.store.read())!.status).toBe("complete");
  expect(await stamped(folders.venueDir)).toBe("preproduction");
});

/** Runs the command cut off at `cutOff`, and opens the server's Start again over what it left. */
async function cutOffSetup(cutOff: CutOff) {
  const root = await mkdtemp(join(tmpdir(), "command-start-again-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await migratedVenue(root);
  const refused = command(root, cutOff);
  const exit = runCli(refused.args, refused.deps);
  if (cutOff === "activation-started") await expect(exit).rejects.toThrow("test: the box stopped");
  else expect(await exit, JSON.stringify(refused.output)).toBe(1);
  expect(refused.refusals()).toBe(1);
  expect(await stamped(folders.venueDir)).toBeNull();
  const host = createFirstSetupModuleHost({ ...folders, modules: ALL_MODULES, environment: {} });
  expect((await host.store.read())!.status).toBe(cutOff);
  const actions = () => createFirstSetupResolutionActions({ ...folders, host });
  const ids = async () => {
    const inspected = await host.resolution.inspectFirstSetupResolution();
    return {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
    };
  };
  return { root, folders, host, actions, ids };
}

/** Both the summary and Start again refuse with `refusal`, and nothing on disk changes. */
async function expectBothRefused(
  f: Awaited<ReturnType<typeof cutOffSetup>>,
  refusal: Record<string, unknown>,
  reason: RegExp | undefined,
) {
  // Inspecting first: its read may leave the database's empty journal pair beside it.
  const ids = await f.ids();
  const before = await diskSnapshot(f.folders);
  for (const send of [f.actions().startAgainSummary, f.actions().startAgainFirstSetup]) {
    const error = await send(ids).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject(refusal);
    if (reason === undefined) expect((error as AppError).reason).toBeUndefined();
    else expect((error as AppError).reason).toMatch(reason);
  }
  expect(await diskSnapshot(f.folders)).toEqual(before);
}

it.each(["activation-started", "uncertain"] as const)(
  "a command cut off at %s before its stamp, with an empty database and nothing outside it: Start again deletes it, and the next command run completes",
  async (cutOff) => {
    const f = await cutOffSetup(cutOff);
    expect(await f.actions().startAgainSummary(await f.ids())).toEqual({
      reached: "fiscal-started",
    });
    await f.actions().startAgainFirstSetup(await f.ids());
    await expectStartAgainDeleted(f.folders);

    await migratedVenue(f.root);
    const next = command(f.root, null);
    expect(await runCli(next.args, next.deps), JSON.stringify(next.output)).toBe(0);
    const done = createFirstSetupModuleHost({
      ...f.folders,
      modules: ALL_MODULES,
      environment: {},
    });
    expect((await done.store.read())!.status).toBe("complete");
    expect(await stamped(f.folders.venueDir)).toBe("preproduction");
  },
);

it.each(["activation-started", "uncertain"] as const)(
  "a command cut off at %s with one kept row in its database: Start again refuses kept-records and deletes nothing",
  async (cutOff) => {
    const f = await cutOffSetup(cutOff);
    const db = new DatabaseSync(join(f.folders.venueDir, "venue.db"));
    try {
      db.prepare(
        "insert into bill_number_allocations (id, party_id, working_order_id, number, allocated_at) values (?, ?, ?, ?, ?)",
      ).run(randomUUID(), randomUUID(), randomUUID(), 1, "2026-10-16T11:40:00.000Z");
    } finally {
      db.close();
    }
    await expectBothRefused(
      f,
      { code: "setup.start_again_refused", params: { cause: "kept-records" } },
      /^rows=1 kept=1 records=0 accepted=0$/,
    );
  },
);

it.each(["activation-started", "uncertain"] as const)(
  "a command cut off at %s with an empty database and the module selection publication writes: Start again refuses and deletes nothing",
  async (cutOff) => {
    const f = await cutOffSetup(cutOff);
    // What `publishSelection` writes first once activation has committed.
    await writeFile(join(f.folders.stateDir, "modules.json"), '{"modules":{}}\n', { mode: 0o600 });
    await expectBothRefused(f, { code: "setup.not_ready", params: {} }, undefined);
  },
);

it.each(["activation-started", "uncertain"] as const)(
  "a command cut off at %s after its stamp: the stamp is a row of the database, and Start again deletes it as before",
  async (cutOff) => {
    const f = await cutOffSetup(cutOff);
    const opened = await openVenueDatabase(f.folders.venueDir);
    try {
      await stampDeployment(opened.venue, "preproduction");
    } finally {
      await opened.close();
    }
    await f.actions().startAgainFirstSetup(await f.ids());
    await expectStartAgainDeleted(f.folders);
  },
);

it("a command cut off before its stamp, beside an earlier attempt that had begun activation: Start again refuses and deletes nothing", async () => {
  const f = await cutOffSetup("uncertain");
  // Stands in for an earlier attempt kept in the record: this attempt as it is, past activation.
  const path = join(f.folders.stateDir, "flows/setup/record.json");
  const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
    previous: unknown[];
  };
  const {
    version: _version,
    venueDir: _venueDir,
    stateDir: _stateDir,
    previous,
    ...attempt
  } = record;
  void _version;
  void _venueDir;
  void _stateDir;
  record.previous = [...previous, attempt];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record), { mode: 0o600 });
  expect((await f.host.store.read())!.previous.at(-1)!.status).toBe("uncertain");
  await expectBothRefused(f, { code: "setup.not_ready", params: {} }, undefined);
});

/** Every file under `dir` with a digest of its bytes, and every folder; lock files left out. */
async function files(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (/\.(lock|holder)/.test(entry.name)) continue;
    if (entry.isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await files(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}

async function filesBeforeActivation(stateDir: string) {
  const ring = loadKeyRing(environment);
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
  expect(
    await createFiscalReadinessStore(
      stateDir,
      async () => ({ status: "accepted" }),
      ring.current.key,
    ).run(readiness),
  ).toMatchObject({ status: "accepted" });
  await applyMigrations(
    join(stateDir, `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readiness)}`),
    migrationOptionsFor(manifestSets(), null),
  );
  const bundle = {
    version: 27 as const,
    contentLanguages: null,
    holidayArea: null,
    settings: {},
    createdAt: "2026-10-16T11:00:00.000Z",
    sourceOperatorId: "source-admin",
    venue: {
      country: request.country,
      taxId: request.taxId,
      legalName: request.legalName,
      taxpayerDomicile: request.taxpayerDomicile,
      name: request.name,
      invoiceLocales: ["es-ES"],
      operationDescription: request.operationDescription,
      fiscalTerritory: request.fiscalTerritory,
      addressLine1: request.addressLine1,
      addressLine2: null,
      postalCode: request.postalCode,
      city: request.city,
      province: request.province,
      timeZone: request.timeZone,
      dayCutover: request.dayCutover,
      seriesCode: "F",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
    },
    privacyContact: { privacyNoticeUrl: null, privacyEmail: null },
    modules: { core: 1 },
    tables: {},
    reconnect: [],
  };
  const passphrase = "a strong passphrase";
  await stageConfigurationImport(
    stateDir,
    ring,
    encodeConfigurationBundle(bundle, passphrase),
    passphrase,
    async () => {},
  );
}

it.each(["activation-started", "uncertain"] as const)(
  "a command cut off at %s: Start again removes readiness and import, keeps the readiness database and recovery pack unchanged, and the next command run completes",
  async (cutOff) => {
    const f = await cutOffSetup(cutOff);
    await filesBeforeActivation(f.folders.stateDir);
    const kept = await files(f.folders.stateDir);
    expect(Object.keys(kept)).toEqual(
      expect.arrayContaining([
        "flows/setup/readiness.json",
        "flows/setup/import/artifact",
        "flows/setup/import/key",
        "flows/setup/import/marker.json",
      ]),
    );
    expect(Object.keys(kept).some((name) => name.startsWith("fiscal-readiness-db-"))).toBe(true);
    const pdf = join(f.root, "refused.pdf");
    const pack = createHash("sha256")
      .update(await readFile(pdf))
      .digest("hex");

    await f.actions().startAgainFirstSetup(await f.ids());
    await expectStartAgainDeleted(f.folders);
    const left = await files(f.folders.stateDir);
    expect(left).toEqual(
      Object.fromEntries(
        Object.entries(kept).filter(
          ([name]) => name === "flows/" || name.startsWith("fiscal-readiness-db-"),
        ),
      ),
    );
    for (const name of ["flows/setup/", "flows/setup/readiness.json", "flows/setup/import/"])
      expect(left[name], name).toBeUndefined();
    expect(await files(f.folders.venueDir)).toEqual({});
    expect(
      createHash("sha256")
        .update(await readFile(pdf))
        .digest("hex"),
    ).toBe(pack);

    await migratedVenue(f.root);
    const next = command(f.root, null);
    expect(await runCli(next.args, next.deps), JSON.stringify(next.output)).toBe(0);
    const done = createFirstSetupModuleHost({
      ...f.folders,
      modules: ALL_MODULES,
      environment: {},
    });
    expect((await done.store.read())!.status).toBe("complete");
  },
);
