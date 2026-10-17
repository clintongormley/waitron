import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { parseModuleConfig } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { readBreakGlassVerifier } from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { activateFirstFiscal } from "./first-fiscal-activation.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { request, MODULE, PASSWORD } from "../test/first-fiscal.js";
import type { SetupDeps } from "./setup-api.js";
import { mountSetup } from "./setup-api.js";
import { Hono } from "hono";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { collectStateSecrets } from "./state-secrets.js";

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
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(publicDocumentSeat = true) {
  const root = await mkdtemp(join(tmpdir(), "recovery-delivery-"));
  roots.push(root);
  const modules = ALL_MODULES.filter((module) =>
    ["core", MODULE, "fiscal-none"].includes(module.name),
  ).map((module) => {
    const initial = module.provisioning?.initialSetup;
    if (initial === undefined || !publicDocumentSeat) return module;
    return {
      ...module,
      provisioning: {
        ...module.provisioning,
        initialSetup: {
          ...initial,
          configure(host: Parameters<NonNullable<typeof initial.configure>>[0]) {
            return {
              ...initial.configure!(host),
              recoveryDocument: (
                _context: unknown,
                _input: unknown,
                document: { statement: unknown },
              ) => structuredClone(document.statement),
            };
          },
        },
      },
    };
  });
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir,
    modules,
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
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 39).toString("base64") });
  let activations = 0,
    publications = 0;
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
            parseModuleConfig({}, modules),
            req.venue.location.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      );
    },
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    establishIdentity: (nodeId) => establishNodeIdentity({ ownerDb: suite.db, ring }, nodeId),
    seedMembership: (nodeId) =>
      seedTermZeroMembership({ db: suite.db, ring }, nodeId, "https://test.example"),
    persistTrading: async () => {
      publications++;
    },
  };
  return {
    root,
    stateDir,
    venueDir,
    host,
    owner,
    input,
    modules,
    deps,
    activate: () =>
      host.coordinator.run((hold) =>
        activateFirstFiscal(host, deps, owner, { mode: "live" }, hold),
      ),
    counts: () => ({ activations, publications }),
  };
}

it("requires an explicit kept recovery document before the first fiscal activation", async () => {
  const f = await fixture();
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("the real hour contribution requires a kept recovery document before activation", async () => {
  const f = await fixture(false);
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

async function documentFixture() {
  const f = await fixture(false);
  const staged = await f.host.keys.stageInitialNodeKey(
    f.owner,
    await f.host.owner.reconfirm(f.owner, PASSWORD, "block-use"),
  );
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
    taxpayerName: request.legalName,
    venueName: request.location.name,
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: staged.key.nodeId, name: staged.key.name },
  };
  const ref = {
    module: MODULE,
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(f.input),
    bindingDigest: firstFiscalPublicDigest(statement),
    documentDigest: "a".repeat(64),
  };
  const register = (value = { ...ref, statement }) =>
    f.host.recoveryDelivery.registerRecoveryDocumentDelivery(f.owner, value);
  const kept = async (value = { ...ref, kept: true as const }) =>
    f.host.recoveryDelivery.confirmRecoveryDocumentKept(
      f.owner,
      value,
      await f.host.owner.reconfirm(f.owner, PASSWORD, "activation"),
    );
  return {
    ...f,
    staged,
    ref,
    statement,
    register,
    kept,
    path: join(f.stateDir, "first-fiscal-documents", `${MODULE}.recovery.json`),
  };
}

it("saving public delivery metadata alone never grants activation", async () => {
  const f = await documentFixture();
  await f.register();
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
});

it.each(["scope", "node", "key-name", "taxpayer-name", "venue-name", "secret"])(
  "even a rehashed %s mismatch refuses before public metadata is saved",
  async (field) => {
    const f = await documentFixture();
    const statement = structuredClone(f.statement);
    if (field === "scope") statement.scope.taxpayerNif = "B12345674";
    else if (field === "node") statement.nodeKey.nodeId = "another-node";
    else if (field === "key-name") statement.nodeKey.name = "another-key";
    else if (field === "taxpayer-name") statement.taxpayerName = "Another taxpayer";
    else if (field === "venue-name") statement.venueName = "Another venue";
    else Object.assign(statement.nodeKey, { secret: f.staged.key.secret });
    await expect(
      f.register({ ...f.ref, bindingDigest: firstFiscalPublicDigest(statement), statement }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  },
);

it("kept confirmation installs the delivered verifier once, with only public metadata persisted", async () => {
  const f = await documentFixture();
  await f.register();
  await f.kept();
  await f.activate();
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  const verifier = await readBreakGlassVerifier(suite.db, f.staged.key.nodeId);
  expect(verifier).toBe(f.staged.stage.verifier);
  expect(await verifySecretAsync(f.staged.key.secret, verifier!)).toBe(true);
  const snapshot = await f.host.resolution.captureFirstSetupOriginals();
  const originals = snapshot.originals.filter((entry) => entry.bytes !== null);
  expect(originals.some((entry) => entry.name.endsWith(`${MODULE}.recovery.json`))).toBe(true);
  for (const entry of originals) {
    expect(Buffer.from(entry.bytes!).toString()).not.toContain(f.staged.key.secret);
    expect(Buffer.from(entry.bytes!).toString()).not.toContain(PASSWORD);
    expect(Buffer.from(entry.bytes!).toString()).not.toContain("%PDF-");
  }
  expect(await readdir(join(f.stateDir, "first-fiscal-documents"))).toEqual([
    `${MODULE}.recovery.json`,
  ]);
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
});

it("the backup state collector carries neither the delivery binding nor a saved secret PDF", async () => {
  const f = await documentFixture();
  await f.register();
  await mkdir(join(f.stateDir, "tls"), { recursive: true });
  for (const name of [
    "secrets.env",
    "trading.env",
    "tls/ca.crt",
    "tls/ca.key",
    "tls/server.crt",
    "tls/server.key",
  ])
    await writeFile(join(f.stateDir, name), `synthetic ${name}`);
  await writeFile(join(f.stateDir, "saved-recovery.pdf"), `%PDF-1.7\n${f.staged.key.secret}`);
  const files = await collectStateSecrets(f.stateDir);
  expect(Object.keys(files).sort()).toEqual([
    "secrets.env",
    "tls/ca.crt",
    "tls/ca.key",
    "tls/server.crt",
    "tls/server.key",
    "trading.env",
  ]);
  expect(JSON.stringify(files)).not.toContain(f.staged.key.secret);
  expect(JSON.stringify(files)).not.toContain("%PDF-");
  expect(JSON.stringify(files)).not.toContain("recovery-key-delivery");
});

it("a refused secret-bearing API document logs no raw key, password or PDF", async () => {
  const f = await documentFixture();
  const events: unknown[] = [];
  const app = new Hono();
  mountSetup(app, { ...f.deps, firstFiscal: f.host }, (...entry) => {
    events.push(entry);
  });
  const statement = {
    ...f.statement,
    nodeKey: { ...f.statement.nodeKey, secret: f.staged.key.secret },
  };
  const response = await app.request("/setup-api/first-setup/recovery-document", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Waitron-Setup-Owner": f.owner.capability,
      "X-Waitron-Setup-Attempt": f.owner.attemptId,
      "X-Waitron-Setup-Revision": String(f.owner.revision),
      "X-Waitron-Setup-Generation": String(f.owner.ownerGeneration),
    },
    body: JSON.stringify({
      ...f.ref,
      bindingDigest: firstFiscalPublicDigest(statement),
      statement,
    }),
  });
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).toMatchObject({
    error: { code: "sif.allocation_invalid", params: { reason: "outside_confirmation_missing" } },
  });
  for (const secret of [f.staged.key.secret, PASSWORD, f.owner.capability, "%PDF-"]) {
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain(secret);
  }
});

it.each(["stageId", "inputDigest", "bindingDigest", "documentDigest"] as const)(
  "a changed %s cannot confirm keeping another document",
  async (field) => {
    const f = await documentFixture();
    await f.register();
    await expect(
      f.kept({
        ...f.ref,
        [field]: field === "stageId" ? "00000000-0000-4000-8000-000000000000" : "b".repeat(64),
        kept: true,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  },
);

it("a declined kept flag refuses without starting activation", async () => {
  const f = await documentFixture();
  await f.register();
  await expect(f.kept({ ...f.ref, kept: false as never })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
});

it("an edited public statement cannot reuse the original document binding", async () => {
  const f = await documentFixture();
  await expect(
    f.register({ ...f.ref, statement: { ...f.statement, createdAt: "2026-10-16T11:41:00.000Z" } }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
});

it.each(["stageId", "inputDigest"] as const)(
  "registration refuses a different %s before saving metadata",
  async (field) => {
    const f = await documentFixture();
    const value = field === "stageId" ? "00000000-0000-4000-8000-000000000000" : "b".repeat(64);
    await expect(
      f.register({ ...f.ref, [field]: value, statement: f.statement }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("an expired kept grant refuses and a fresh explicit kept confirmation restores the delivery grant", async () => {
  const f = await documentFixture();
  await f.register();
  await f.kept();
  vi.advanceTimersByTime(300000);
  await expect(f.host.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  await f.kept();
  await expect(f.host.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
});

it("a reconstructed host cannot reuse an earlier process's kept grant", async () => {
  const f = await documentFixture();
  await f.register();
  await f.kept();
  const host = createFirstSetupModuleHost({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    environment: {},
    modules: f.modules,
    database: () => suite.db,
  });
  await expect(
    host.coordinator.run((hold) =>
      activateFirstFiscal(host, f.deps, f.owner, { mode: "live" }, hold),
    ),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
});

it("a replaced manifest invalidates the kept grant before any fiscal write", async () => {
  const f = await documentFixture();
  await f.register();
  await f.kept();
  const manifest = JSON.parse(await readFile(f.path, "utf8"));
  manifest.documentDigest = "b".repeat(64);
  await writeFile(f.path, JSON.stringify(manifest));
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("the owned API saves public recovery bindings and requires explicit kept confirmation", async () => {
  const f = await documentFixture();
  const app = new Hono();
  mountSetup(app, { ...f.deps, firstFiscal: f.host }, () => {});
  const post = (action: string, value: unknown, extra: Record<string, string> = {}) =>
    app.request(`/setup-api/first-setup/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": f.owner.capability,
        "X-Waitron-Setup-Attempt": f.owner.attemptId,
        "X-Waitron-Setup-Revision": String(f.owner.revision),
        "X-Waitron-Setup-Generation": String(f.owner.ownerGeneration),
        ...extra,
      },
      body: JSON.stringify(value),
    });
  const registered = await post("recovery-document", { ...f.ref, statement: f.statement });
  expect(registered.status).toBe(200);
  expect({ status: registered.status, body: await registered.json() }).toEqual({
    status: 200,
    body: { accepted: true },
  });
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  const confirmation = await f.host.owner.reconfirm(f.owner, PASSWORD, "activation");
  const kept = await post("recovery-document-kept", {
    ...f.ref,
    kept: true,
    reconfirmation: confirmation,
  });
  expect({ status: kept.status, body: await kept.json() }).toEqual({
    status: 200,
    body: { accepted: true },
  });
  expect(kept.headers.get("Cache-Control")).toBe("no-store");
  await f.activate();
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
});

it("an empty never-activated setup retains its public recovery binding when starting again", async () => {
  const f = await documentFixture();
  await f.register();
  await f.kept();
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const before = await f.host.resolution.captureFirstSetupOriginals();
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspection.emptyDatabase).toBe(true);
  const binding = await createFirstSetupResolutionActions(f).startAgainFirstSetup({
    inspectionId: inspection.inspectionId,
    revision: inspection.revision!,
    ownerGeneration: inspection.ownerGeneration!,
  });
  expect(binding.venueDir).not.toBe(f.venueDir);
  expect(await readFile(f.path)).toEqual(
    before.originals.find((entry) => entry.name.endsWith(`${MODULE}.recovery.json`))!.bytes,
  );
  const next = createFirstSetupModuleHost({
    ...binding,
    environment: {},
    modules: f.modules,
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  await expect(
    next.preparation.prepare(owner, MODULE, { action: "compare-clocks", browser: null }),
  ).resolves.toBeDefined();
});
