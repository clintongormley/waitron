import * as filesystem from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import { Agent } from "undici";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { serveRecovery, startServerOrFirstSetupResolution } from "./node-entry.js";
import { freePorts } from "./testing/free-ports.js";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, sales, saleLines, withTransaction, openVenueDatabase } from "@waitron/db";
import { recordSale } from "@waitron/core";
import { nodeId, seriesId } from "@waitron/shared";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import {
  saleInput,
  steadyClock,
  fakeClient,
  staticResolver,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { cadenas } from "@waitron/fiscal-verifactu/src/schema/cadenas.js";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { envios } from "@waitron/fiscal-verifactu/src/schema/envios.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  resolveFirstSetupWorkspace,
  assertFirstSetupBootTarget,
} from "@waitron/provisioning";
import { MODULE, PASSWORD, request } from "../test/first-fiscal.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { activateFirstFiscal, finishFirstFiscalSetup } from "./first-fiscal-activation.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { parseEnvFile } from "./env-file.js";
import type { SetupDeps } from "./setup-api.js";
import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";

vi.mock("node:fs/promises", { spy: true });
const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
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
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hour-finish-"));
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  let owner = { ...claim.state, capability: claim.capability };
  await host.preparation.prepare(owner, MODULE, { action: "compare-clocks", browser: null });
  const selected = await host.preparation.select(
    owner,
    MODULE,
    { answer: "no" },
    await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
  owner = { ...owner, revision: selected.state.revision };
  const input = (firstSetupModuleContext(selected.state, MODULE).request as { input: unknown })
    .input;
  const imported = await host.preparation.import(owner, MODULE, input);
  owner = { ...owner, revision: imported.revision };
  await keepHourRecoveryDocument(host, owner, PASSWORD);
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 21).toString("base64") });
  let activations = 0,
    publications = 0,
    interrupt = true;
  const publication = { mode: "live" };
  const deps: SetupDeps = {
    environment: "preproduction",
    db: suite.db,
    ring,
    provision: async (req, beforeTransaction) => {
      activations++;
      return provisionVenue(
        {
          ownerDb: suite.db,
          stateDir,
          database: "synthetic",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, host.modules),
            request.location.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      );
    },
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    establishIdentity: async (nodeId) => {
      if (interrupt) {
        interrupt = false;
        throw new Error("synthetic after commit");
      }
      await establishNodeIdentity({ ownerDb: suite.db, ring }, nodeId);
    },
    seedMembership: (nodeId) =>
      seedTermZeroMembership({ db: suite.db, ring }, nodeId, "https://test.example"),
    persistTrading: async () => {
      publications++;
    },
  };
  const activate = () =>
    host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, publication, hold));
  const recover = async () => {
    const inspection = await host.resolution.inspectFirstSetupResolution();
    const next = await host.owner.recoverFirstSetupOwner({
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
      password: PASSWORD,
      clientClaimNonce: randomBytes(32).toString("base64url"),
    });
    owner = { ...next.state, capability: next.capability };
    return owner;
  };
  const finish = () =>
    host.coordinator.run((hold) =>
      finishFirstFiscalSetup(host, { ...deps, provision: undefined }, owner, publication, hold),
    );
  const facts = async (database = suite.db) => ({
    series: await database.select().from(invoiceSeries),
    sales: await database.select().from(sales),
    saleLines: await database.select().from(saleLines),
    records: await database.select().from(registrosFacturacion),
    chains: await database.select().from(cadenas),
    filing: await database.select().from(envios),
    allocations: await database.select().from(fiscalAllocations),
    sif: await database.select().from(registroSif),
    journal: await readFile(join(stateDir, "module-preparation-state.json"), "utf8"),
  });
  return {
    root,
    venueDir,
    deps,
    publication,
    host,
    owner: () => owner,
    refreshOwner: async () => {
      const current = (await host.store.read())!;
      owner = { ...owner, revision: current.revision, ownerGeneration: current.ownerGeneration };
    },
    activate,
    finish,
    recover,
    facts,
    stateDir,
    counts: () => ({ activations, publications }),
    allowPublication: () => {
      interrupt = false;
    },
  };
}

it("exact hour Finish publishes after password recovery without register consultation or another identity", async () => {
  const f = await fixture();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const before = await f.facts();
  await f.recover();
  await expect(f.finish()).resolves.toMatchObject({ nodeId: f.owner().nodeId });
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await f.facts()).toEqual(before);
  expect((await f.host.store.read())?.status).toBe("complete");
  const store = createFirstSetupResolutionStore({
    stateDir: f.stateDir,
    venueDir: (await f.host.store.read())!.venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  const records = (
    await Promise.all(
      (await readdir(join(f.stateDir, "first-setup-resolutions"))).map((id) => store.read(id)),
    )
  ).find((records) => records[0]?.action === "finish-publication")!;
  expect(records).toBeDefined();
  expect(
    records.map(({ phase, database, authority, register }) => ({
      phase,
      database,
      authority,
      register,
    })),
  ).toEqual([
    {
      phase: "prepared",
      database: "committed-exact",
      authority: "original-password",
      register: null,
    },
    {
      phase: "applied",
      database: "committed-exact",
      authority: "original-password",
      register: null,
    },
  ]);
});

it("empty never-activated hour restart retains originals and burns the entire hour on every base", async () => {
  const f = await fixture();
  await f.host.keys.stageInitialNodeKey(
    f.owner(),
    await f.host.owner.reconfirm(f.owner(), PASSWORD, "block-use"),
  );
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const before = await f.host.resolution.captureFirstSetupOriginals();
  expect(before.inspection.emptyDatabase).toBe(true);
  const journal = await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8");
  const actions = createFirstSetupResolutionActions({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    host: f.host,
  });
  const restart = {
    inspectionId: before.inspection.inspectionId,
    revision: before.inspection.revision!,
    ownerGeneration: before.inspection.ownerGeneration!,
  };
  const binding = await actions.startAgainFirstSetup(
    restart as Parameters<typeof actions.startAgainFirstSetup>[0],
  );
  expect(binding.venueDir).not.toBe(f.venueDir);
  expect(await resolveFirstSetupWorkspace({ stateDir: f.stateDir, venueDir: f.venueDir })).toEqual({
    venueDir: binding.venueDir,
    stateDir: binding.stateDir,
    binding,
  });
  await expect(
    assertFirstSetupBootTarget({ stateDir: f.stateDir, venueDir: f.venueDir }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  const archive = createFirstSetupResolutionStore({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  expect(await archive.readOriginals(binding.resolutionId)).toEqual(before.originals);
  expect(
    (await archive.read(binding.resolutionId)).map(({ phase, action, register }) => ({
      phase,
      action,
      register,
    })),
  ).toEqual([
    { phase: "prepared", action: "retire", register: null },
    { phase: "applied", action: "retire", register: null },
    { phase: "prepared", action: "select-workspace", register: null },
    { phase: "applied", action: "select-workspace", register: null },
  ]);
  for (const original of before.originals) {
    if (original.bytes === null || !/^(state|venue)\//.test(original.name)) continue;
    const [which, ...parts] = original.name.split("/");
    expect(await readFile(join(which === "state" ? f.stateDir : f.venueDir, ...parts))).toEqual(
      original.bytes,
    );
  }
  expect(await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8")).toBe(journal);
  await expect(f.host.owner.status(f.owner())).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  const next = createFirstSetupModuleHost({
    ...binding,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...request,
        seriesCode: "B",
        fullSeriesCode: "FULL",
        rectificativeSeriesCode: "RECT",
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  await next.preparation.prepare(owner, MODULE, { action: "compare-clocks", browser: null });
  await expect(
    next.preparation.select(
      owner,
      MODULE,
      { answer: "no" },
      await next.owner.reconfirm(owner, PASSWORD, "block-use"),
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "hour_not_later" } });
  vi.setSystemTime("2026-10-16T12:01:00Z");
  await next.preparation.prepare(owner, MODULE, { action: "compare-clocks", browser: null });
  const selected = await next.preparation.select(
    owner,
    MODULE,
    { answer: "no" },
    await next.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
  expect(firstSetupModuleContext(selected.state, MODULE).request).toMatchObject({
    identity: "06RC",
    input: {
      allocation: {
        series: [
          { code: "B-06RC", purpose: "standard" },
          { code: "FULL-06RC", purpose: "full" },
          { code: "RECT-06RC", purpose: "rectificative" },
        ],
      },
    },
  });
});

it.each([
  [
    "catalogue",
    "insert into catalogues(id, name, created_at, updated_at) values ('menu', 'Retained', '2026-10-16', '2026-10-16')",
  ],
  [
    "invoice counter",
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
  ["unknown table", "create table unknown_rows(value text)"],
  ["partial schema", "drop table catalogues"],
] as const)(
  "hour restart refuses retained %s before selecting any replacement",
  async (_name, sql) => {
    const f = await fixture();
    await suite.db.archiveTo(join(f.venueDir, "venue.db"));
    const db = new DatabaseSync(join(f.venueDir, "venue.db"));
    try {
      db.exec("pragma foreign_keys=off");
      db.exec(sql);
    } finally {
      db.close();
    }
    const snapshot = await f.host.resolution.captureFirstSetupOriginals();
    expect(snapshot.inspection.emptyDatabase).toBe(false);
    const actions = createFirstSetupResolutionActions({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      host: f.host,
    });
    await expect(
      actions.startAgainFirstSetup({
        inspectionId: snapshot.inspection.inspectionId,
        revision: snapshot.inspection.revision!,
        ownerGeneration: snapshot.inspection.ownerGeneration!,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect((await f.host.resolution.captureFirstSetupOriginals()).originals).toEqual(
      snapshot.originals,
    );
    await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["missing", "corrupt"])(
  "password-free hour restart refuses a %s database",
  async (kind) => {
    const f = await fixture();
    if (kind === "corrupt") await writeFile(join(f.venueDir, "venue.db"), "not a database");
    const snapshot = await f.host.resolution.captureFirstSetupOriginals();
    expect(snapshot.inspection.database).toBe(kind);
    const actions = createFirstSetupResolutionActions({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      host: f.host,
    });
    await expect(
      actions.startAgainFirstSetup({
        inspectionId: snapshot.inspection.inspectionId,
        revision: snapshot.inspection.revision!,
        ownerGeneration: snapshot.inspection.ownerGeneration!,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect((await f.host.resolution.captureFirstSetupOriginals()).originals).toEqual(
      snapshot.originals,
    );
  },
);

it("HTTPS hour restart takes local observations without a register declaration", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: ["localhost"],
    now: () => new Date(),
    listIpv4: () => ["127.0.0.1"],
  });
  const actions = createFirstSetupResolutionActions({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    host: f.host,
  });
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: (request) => actions.startAgainFirstSetup(request),
  });
  const [port] = await freePorts(1);
  const server = await serveRecovery(app, {
    stateDir: f.stateDir,
    port,
    httpHost: "127.0.0.1",
    log: () => {},
  });
  const agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
  try {
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    const response = await fetch(
      `https://127.0.0.1:${port}/setup-api/first-setup/resolution/start-again`,
      {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: `https://127.0.0.1:${port}` },
        body: JSON.stringify({
          inspectionId: inspected.inspectionId,
          revision: inspected.revision,
          ownerGeneration: inspected.ownerGeneration,
        }),
      } as RequestInit,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selectionGeneration: 1, restarting: true });
  } finally {
    await agent.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("a missing hour database needs freshly recovered ownership before retirement", async () => {
  const f = await fixture();
  await f.recover();
  const snapshot = await f.host.resolution.captureFirstSetupOriginals();
  const actions = createFirstSetupResolutionActions({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    host: f.host,
  });
  const input = {
    inspectionId: snapshot.inspection.inspectionId,
    revision: snapshot.inspection.revision!,
    ownerGeneration: snapshot.inspection.ownerGeneration!,
    owner: f.owner(),
  };
  const pending = actions.startAgainFirstSetup(input);
  await expect(pending).resolves.toMatchObject({ selectionGeneration: 1 });
  const binding = await pending;
  const store = createFirstSetupResolutionStore({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  expect(
    (await store.read(binding.resolutionId)).map(({ database, authority, register }) => ({
      database,
      authority,
      register,
    })),
  ).toEqual(
    Array.from({ length: 4 }, () => ({
      database: "missing",
      authority: "original-password",
      register: null,
    })),
  );
  expect(await store.readOriginals(binding.resolutionId)).toEqual(snapshot.originals);
});

it("hour Finish requires fresh recovery and cannot activate an uncommitted attempt", async () => {
  const f = await fixture();
  await f.recover();
  await expect(f.finish()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  const committed = await fixture();
  await expect(committed.activate()).rejects.toThrow("synthetic after commit");
  await committed.refreshOwner();
  await expect(committed.finish()).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(committed.counts()).toEqual({ activations: 1, publications: 0 });
});

it.each(["venue", "module", "publication"] as const)(
  "hour Finish refuses mismatched %s agreement without allocating",
  async (kind) => {
    const f = await fixture();
    await expect(f.activate()).rejects.toThrow("synthetic after commit");
    await f.recover();
    const before = await f.facts();
    const recover = f.deps.recoverProvision!;
    if (kind === "venue")
      f.deps.recoverProvision = async (request) => ({
        ...(await recover(request)),
        locationId: "changed-location" as never,
      });
    if (kind === "module") {
      const module = f.host.modules.find((entry) => entry.name === MODULE)!;
      const seat = module.provisioning!.initialSetup!;
      const committed = seat.committed;
      vi.spyOn(seat, "committed").mockImplementation(async (...args) => ({
        ...((await committed(...args)) as object),
        activationEventId: "changed-event",
      }));
    }
    if (kind === "publication")
      Object.assign(f.publication, {
        email: {
          server: "smtp.example.test",
          port: 465,
          encryption: "tls",
          user: "",
          password: "",
          from: "venue@example.test",
        },
      });
    await expect(f.finish()).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(f.counts()).toEqual({ activations: 1, publications: 0 });
    expect(await f.facts()).toEqual(before);
  },
);

it("hour Finish reads back the exact committed result after losing the host result write", async () => {
  const f = await fixture();
  const update = f.host.store.update;
  vi.spyOn(f.host.store, "update").mockImplementation(async (...args) => {
    if (args[2].kind === "committed") throw new Error("synthetic lost host result");
    return update(...args);
  });
  await expect(f.activate()).rejects.toThrow("synthetic lost host result");
  vi.restoreAllMocks();
  expect((await f.host.store.read())?.status).toBe("activation-started");
  const before = await f.facts();
  f.allowPublication();
  await f.recover();
  await expect(f.finish()).resolves.toMatchObject({ nodeId: f.owner().nodeId });
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await f.facts()).toEqual(before);
});

it.each(["activation-started", "uncertain"] as const)(
  "hour restart refuses retained %s history even beside a positive empty proof",
  async (status) => {
    const f = await fixture();
    let state = (await f.host.store.read())!;
    state = await f.host.store.update(state.frozen.attemptId, state.revision, {
      kind: "activation-started",
    });
    if (status === "uncertain")
      state = await f.host.store.update(state.frozen.attemptId, state.revision, {
        kind: "uncertain",
      });
    await f.host.store.update(state.frozen.attemptId, state.revision, { kind: "abandoned" });
    await suite.db.archiveTo(join(f.venueDir, "venue.db"));
    const snapshot = await f.host.resolution.captureFirstSetupOriginals();
    expect(snapshot.inspection.emptyDatabase).toBe(true);
    const actions = createFirstSetupResolutionActions({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      host: f.host,
    });
    await expect(
      actions.startAgainFirstSetup({
        inspectionId: snapshot.inspection.inspectionId,
        revision: snapshot.inspection.revision!,
        ownerGeneration: snapshot.inspection.ownerGeneration!,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect((await f.host.resolution.captureFirstSetupOriginals()).originals).toEqual(
      snapshot.originals,
    );
  },
);

it("hour Finish preserves issued records, their chain, filing outbox and advanced counters", async () => {
  const f = await fixture();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const series = (await suite.db.select().from(invoiceSeries)).find(
    (row) => row.code === "A-06RB",
  )!;
  const clock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date("2026-10-16T11:41:00Z") }),
  };
  const backend = new VerifactuBackend({
    db: suite.db,
    deploymentEnvironment: "preproduction",
    clock,
    resolveClient: staticResolver(fakeClient),
  });
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({ nodeId: nodeId(f.owner().nodeId), seriesId: seriesId(series.id), clock }),
    ),
  );
  const before = await f.facts();
  expect(before.records).toHaveLength(1);
  expect(before.chains).toMatchObject([{ secuencia: 1 }]);
  expect(before.filing).toHaveLength(1);
  expect(before.series.find((row) => row.id === series.id)?.nextNumber).toBe(2);
  await f.recover();
  await expect(f.finish()).resolves.toMatchObject({ nodeId: f.owner().nodeId });
  expect(await f.facts()).toEqual(before);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
});

it.each(
  ["000001.json", "000002.json"].flatMap((name) => [false, true].map((after) => ({ name, after }))),
)(
  "hour Finish retries a $name rename failure after=$after without allocating",
  async ({ name, after }) => {
    const f = await fixture();
    await expect(f.activate()).rejects.toThrow("synthetic after commit");
    await f.recover();
    const before = await f.facts();
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    let faults = 0;
    vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      if (
        String(to).includes("/first-setup-resolutions/") &&
        String(to).endsWith(`/${name}`) &&
        faults === 0
      ) {
        faults++;
        if (after) await actual.rename(from, to);
        throw new Error("synthetic finish audit rename");
      }
      await actual.rename(from, to);
    });
    await expect(f.finish()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(faults).toBe(1);
    vi.mocked(filesystem.rename).mockImplementation(actual.rename);
    expect(f.counts()).toEqual({ activations: 1, publications: name === "000002.json" ? 1 : 0 });
    expect(await f.facts()).toEqual(before);
    await f.recover();
    await expect(f.finish()).resolves.toMatchObject({ nodeId: f.owner().nodeId });
    expect(f.counts()).toEqual({ activations: 1, publications: name === "000002.json" ? 2 : 1 });
    expect(await f.facts()).toEqual(before);
    expect((await f.host.store.read())?.status).toBe("complete");
  },
);

it("hour restart can resume an interrupted workspace selection using its archived positive empty proof", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const before = await f.host.resolution.captureFirstSetupOriginals();
  const actions = createFirstSetupResolutionActions({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    host: f.host,
  });
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  let faults = 0;
  vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (String(to).endsWith("/first-setup-workspace.json") && faults === 0) {
      faults++;
      throw new Error("synthetic selection interruption");
    }
    await actual.rename(from, to);
  });
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: before.inspection.inspectionId,
      revision: before.inspection.revision!,
      ownerGeneration: before.inspection.ownerGeneration!,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(faults).toBe(1);
  vi.mocked(filesystem.rename).mockImplementation(actual.rename);
  const pending = await actions.inspectWorkspaceSelection();
  expect(pending).not.toBeNull();
  await expect(actions.resumeWorkspaceSelection(pending!)).resolves.toMatchObject({
    workspaceId: pending!.workspaceId,
    selectionGeneration: 1,
  });
  const selected = await resolveFirstSetupWorkspace({ stateDir: f.stateDir, venueDir: f.venueDir });
  expect(selected.binding?.workspaceId).toBe(pending!.workspaceId);
  const archive = createFirstSetupResolutionStore({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  expect(await archive.readOriginals(selected.binding!.resolutionId)).toEqual(before.originals);
  await expect(
    assertFirstSetupBootTarget({ stateDir: f.stateDir, venueDir: f.venueDir }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
});

it("real HTTPS resolution boot finishes the retained hour database without document consultation", async () => {
  const f = await fixture();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: ["localhost"],
    now: () => new Date(),
    listIpv4: () => ["127.0.0.1"],
  });
  const before = await f.facts();
  const [port] = await freePorts(1);
  let restarts = 0;
  const server = await startServerOrFirstSetupResolution(
    {
      WAITRON_ENV: "preproduction",
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 21).toString("base64"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    },
    {},
    {
      requestRestart: () => {
        restarts++;
      },
    },
  );
  const agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
  const origin = `https://127.0.0.1:${port}`;
  const post = (
    action: string,
    body: unknown,
    owner?: {
      capability: string;
      state: { attemptId: string; revision: number; ownerGeneration: number };
    },
  ) =>
    fetch(`${origin}/setup-api/first-setup/resolution/${action}`, {
      dispatcher: agent,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(owner === undefined
          ? {}
          : {
              "X-Waitron-Setup-Owner": owner.capability,
              "X-Waitron-Setup-Attempt": owner.state.attemptId,
              "X-Waitron-Setup-Revision": String(owner.state.revision),
              "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
            }),
      },
      body: JSON.stringify(body),
    } as RequestInit);
  const snapshot = async () => {
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    return {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    };
  };
  try {
    const recovered = await post("recover", {
      ...(await snapshot()),
      password: PASSWORD,
      clientClaimNonce: randomBytes(32).toString("base64url"),
    });
    expect(recovered.status).toBe(200);
    const owner = await recovered.json();
    const response = await post(
      "finish",
      { ...(await snapshot()), publication: f.publication },
      owner,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provisioned: true, restarting: true });
    expect(parseEnvFile(await readFile(join(f.stateDir, "trading.env"), "utf8"))).toMatchObject({
      WAITRON_TILL_NODE_ID: owner.state.nodeId,
      WAITRON_ENV: "preproduction",
      WAITRON_ONBOARDING_INTENT: "live",
    });
    expect((await f.host.store.read())?.status).toBe("complete");
    await vi.waitFor(() => expect(restarts).toBe(1));
    const opened = await openVenueDatabase(f.venueDir);
    try {
      expect(await f.facts(opened.venue)).toEqual(before);
    } finally {
      await opened.close();
    }
  } finally {
    await agent.close();
    await server.close();
  }
});
