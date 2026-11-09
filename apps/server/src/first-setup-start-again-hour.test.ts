import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import { Agent } from "undici";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { serveRecovery } from "./node-entry.js";
import { freePorts } from "./testing/free-ports.js";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing, readNodeSigningKey, sealNodeSigningKeyTx } from "@waitron/credentials";
import { readMembershipTrustSet, withNodeTransaction } from "@waitron/db";
import { generateNodeKeyPair } from "@waitron/membership";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readStartAgainMarker } from "@waitron/provisioning";
import { MODULE, PASSWORD, request } from "../test/first-fiscal.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { activateFirstFiscal } from "./first-fiscal-activation.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import type { SetupDeps } from "./setup-api.js";
import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";
import { expectStartAgainDeleted, startAgainUnchanged } from "../test/start-again-deleted.js";
import {
  createFakeTimersHourClock,
  selectPastWaits,
  type HourTestClock,
} from "./testing/hour-test-clock.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
let clock: HourTestClock;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
  clock = createFakeTimersHourClock();
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: clock.wall(),
    wallFinishedMs: clock.wall(),
    monotonicStartedMs: clock.monotonic(),
    monotonicFinishedMs: clock.monotonic(),
  }));
});
type Host = ReturnType<typeof createFirstSetupModuleHost>;
async function compareAndSelect(host: Host, owner: Parameters<Host["preparation"]["select"]>[0]) {
  const compared = (await host.preparation.prepare(
    owner,
    MODULE,
    { action: "compare-clocks", browser: null },
    { onBox: true },
  )) as { id: string };
  return host.preparation.select(
    owner,
    MODULE,
    { comparisonId: compared.id },
    await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
}
function chooseMinute(host: Host, owner: Parameters<Host["preparation"]["select"]>[0]) {
  return selectPastWaits(clock, () => compareAndSelect(host, owner));
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "start-again-hour-"));
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
  const claim = await host.owner.claimFirstSetup({ environment: "preproduction", request });
  let owner = { ...claim.state, capability: claim.capability };
  const selected = await chooseMinute(host, owner);
  owner = { ...owner, revision: selected.state.revision };
  const input = (firstSetupModuleContext(selected.state, MODULE).request as { input: unknown })
    .input;
  const imported = await host.preparation.import(owner, MODULE, input);
  owner = { ...owner, revision: imported.revision };
  await keepHourRecoveryDocument(host, owner, PASSWORD);
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 21).toString("base64") });
  const publication = { mode: "live" };
  const deps: SetupDeps = {
    environment: "preproduction",
    db: suite.db,
    node: suite.node,
    ring,
    provision: (req, beforeTransaction) =>
      provisionVenue(
        {
          ownerDb: suite.db,
          stateDir,
          database: "synthetic",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, host.modules),
            request.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      ),
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    establishIdentity: (nodeId) =>
      establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId),
    seedMembership: (nodeId) =>
      seedTermZeroMembership(
        { db: suite.db, node: suite.node, ring },
        nodeId,
        "https://test.example",
      ),
    persistTrading: async () => {},
  };
  const activate = () =>
    host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, publication, hold));
  return {
    venueDir,
    deps,
    host,
    owner: () => owner,
    refreshOwner: async () => {
      const current = (await host.store.read())!;
      owner = { ...owner, revision: current.revision, ownerGeneration: current.ownerGeneration };
    },
    activate,
    stateDir,
  };
}

it("with the outside statement faked as committed, a setup interrupted after the key was sealed and before it was stamped stamps it on the next run, and the stamped key matches", async () => {
  const f = await fixture();
  const ring = f.deps.ring!;
  const sealed = generateNodeKeyPair();
  f.deps.establishIdentity = async (nodeId) => {
    f.deps.establishIdentity = (id) =>
      establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, id);
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, ring, nodeId, sealed.privateKey),
    );
    throw new Error("synthetic after seal");
  };
  await expect(f.activate()).rejects.toThrow("synthetic after seal");
  await f.refreshOwner();
  const nodeId = f.owner().nodeId!;
  expect((await readMembershipTrustSet(suite.db))[nodeId]).toBeUndefined();
  vi.spyOn(f.host.evidence, "read").mockResolvedValue({
    current: { priorActivation: "committed" },
  } as never);

  await expect(f.activate()).resolves.toMatchObject({ nodeId });

  expect((await readMembershipTrustSet(suite.db))[nodeId]).toBe(sealed.publicKey);
  expect(await readNodeSigningKey(suite.node, ring, nodeId)).toBe(sealed.privateKey);
});

it("empty never-activated hour restart deletes the attempt and burns the entire hour on every base", async () => {
  const f = await fixture();
  await f.host.keys.stageInitialNodeKey(
    f.owner(),
    await f.host.owner.reconfirm(f.owner(), PASSWORD, "block-use"),
  );
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const before = await f.host.resolution.captureFirstSetupOriginals();
  expect(before.inspection.emptyDatabase).toBe(true);
  await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8");
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
  await actions.startAgainFirstSetup(restart as Parameters<typeof actions.startAgainFirstSetup>[0]);
  await expect(
    readFile(join(f.stateDir, "module-preparation-state.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expectStartAgainDeleted(f);
  const next = createFirstSetupModuleHost({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup({
    environment: "preproduction",
    request: {
      ...request,
      seriesCode: "B",
      fullSeriesCode: "FULL",
      rectificativeSeriesCode: "RECT",
    },
  });
  const owner = { ...claim.state, capability: claim.capability };
  vi.setSystemTime("2026-10-16T12:01:00Z");
  const selected = await chooseMinute(next, owner);
  expect(firstSetupModuleContext(selected.state, MODULE).request).toMatchObject({
    identity: "0CNPK",
    input: {
      allocation: {
        series: [
          { code: "B-0CNPK", purpose: "standard" },
          { code: "FULL-0CNPK", purpose: "full" },
          { code: "RECT-0CNPK", purpose: "rectificative" },
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
    const unchanged = await startAgainUnchanged(f);
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
    await unchanged();
  },
);

it.each([
  ["missing", "setup.not_ready"],
  ["corrupt", "setup.attempt_conflict"],
])("password-free hour restart refuses a %s database %s", async (kind, code) => {
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
  ).rejects.toMatchObject({ code });
  expect((await f.host.resolution.captureFirstSetupOriginals()).originals).toEqual(
    snapshot.originals,
  );
});

it("HTTPS hour restart takes local observations without a register declaration", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: ["localhost", "waitron.local"],
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
    expect(await response.json()).toEqual({ restarting: true });
  } finally {
    await agent.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("a missing hour database starts again only once confirmed, and records the confirmation", async () => {
  const f = await fixture();
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
  };
  await expect(actions.startAgainFirstSetup(input)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  const shown = await actions.startAgainSummary(input);
  expect(shown).toEqual(HOUR_SHOWN);
  const at = new Date().toISOString();
  const state = (await f.host.store.read())!;
  const pending = actions.startAgainFirstSetup({
    ...input,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expect(pending).resolves.toBeUndefined();
  const confirmations = await readdir(join(f.stateDir, "first-setup-start-again-confirmations"));
  expect(confirmations).toEqual([`${Date.parse(at)}-${state.frozen.attemptId}.json`]);
  expect(
    JSON.parse(
      await readFile(
        join(f.stateDir, "first-setup-start-again-confirmations", confirmations[0]!),
        "utf8",
      ),
    ),
  ).toEqual({
    version: 2,
    at,
    attemptId: state.frozen.attemptId,
    database: "missing",
    setupAdministrator: {
      displayName: state.frozen.request.admin.displayName,
      email: state.frozen.request.admin.email,
    },
    confirmedOn: "repair-page",
    signedIn: false,
    ownerGeneration: f.owner().ownerGeneration,
    shown,
  });
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

const HOUR_SHOWN = { reached: "named" as const };

it("a missing hour database: a confirmed Start again with no owner goes ahead", async () => {
  const f = await fixture();
  await f.refreshOwner();
  const snapshot = await f.host.resolution.captureFirstSetupOriginals();
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
      confirmMissingDatabase: { nothingFiledOrSold: true, shown: HOUR_SHOWN },
    }),
  ).resolves.toBeUndefined();
  expect(await readdir(join(f.stateDir, "first-setup-start-again-confirmations"))).toHaveLength(1);
  await expectStartAgainDeleted(f);
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
