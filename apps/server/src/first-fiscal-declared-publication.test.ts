import { vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
} from "@waitron/provisioning";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readBreakGlassVerifier } from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { parseModuleConfig } from "@waitron/module";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { activateFirstFiscal, finishFirstFiscalSetup } from "./first-fiscal-activation.js";
import type { SetupDeps } from "./setup-api.js";
vi.mock("node:fs/promises", { spy: true });
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const fixtures: Awaited<ReturnType<typeof declaredFirstFiscalFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.rename).mockImplementation(actual.rename);
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture() {
  const f = await declaredFirstFiscalFixture();
  fixtures.push(f);
  const modules = f.modules.map((m) =>
    m.name !== f.module
      ? m
      : {
          ...m,
          fiscal: {
            ...m.fiscal!,
            provisioningSecret: { required: () => false, validate: () => {}, seal: async () => {} },
          },
        },
  );
  const host = createFirstSetupModuleHost({
    environment: {},
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    modules,
  });
  const staged = await host.keys.stageInitialNodeKey(
    f.ownerAttempt,
    await host.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
  );
  const ref = {
    module: f.module,
    stageId: staged.stage.stageId,
    inputDigest: publicDigest(f.input),
    historyDigest: f.statement.delivery.historyDigest,
    documentDigest: f.statement.delivery.documentDigest,
  };
  const consult = async (replay = false, recovered = f.ownerAttempt) => {
    const state = (await host.store.read())!,
      owner = {
        ...recovered,
        revision: state.revision,
        ownerGeneration: state.ownerGeneration,
      };
    const statement = {
      ...f.statement,
      priorActivation: replay ? ("committed" as const) : ("none" as const),
    };
    await host.delivery.registerFirstFiscalDelivery(owner, { ...ref, statement });
    await host.delivery.confirmFirstFiscalDocumentKept(
      owner,
      { ...ref, kept: true },
      await host.owner.reconfirm(owner, f.password, "activation"),
    );
    return owner;
  };
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64") });
  let activations = 0,
    publications = 0,
    interrupt = false;
  let publicationProbe: (() => Promise<void>) | undefined;
  const deps: SetupDeps = {
    environment: "production",
    db: suite.db,
    ring,
    firstFiscal: host,
    provision: async (req, beforeTransaction) => {
      activations++;
      return provisionVenue(
        {
          ownerDb: suite.db,
          stateDir: f.stateDir,
          database: "synthetic",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, f.modules),
            req.venue.location.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      );
    },
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    assertFiscalReady: async () => {},
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
      await publicationProbe?.();
      const verifier = await readBreakGlassVerifier(suite.db, staged.key.nodeId);
      expect(verifier).not.toBeNull();
      expect(await verifySecretAsync(staged.key.secret, verifier!)).toBe(true);
      publications++;
    },
  };
  const body = {
    mode: "live",
    email: {
      server: "smtp.example.test",
      port: 465,
      encryption: "tls",
      user: "",
      password: "",
      from: "venue@example.test",
    },
  };
  const register = {
    kind: "current-master" as const,
    status: "Consumed" as const,
    custodian: "Elena",
    reference: f.statement.delivery.historyDigest,
    consultedAt: "2026-10-16T00:00:00.000Z",
  };
  const activate = (owner = f.ownerAttempt) =>
    host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, body, hold));
  return {
    ...f,
    register,
    host,
    staged,
    consult,
    activate,
    recover: async () => {
      const inspection = await host.resolution.inspectFirstSetupResolution();
      const rebound = await host.owner.recoverFirstSetupOwner({
        inspectionId: inspection.inspectionId,
        revision: inspection.revision!,
        ownerGeneration: inspection.ownerGeneration!,
        clientClaimNonce: Buffer.alloc(32, 82).toString("base64url"),
        password: f.password,
      });
      return {
        attemptId: rebound.state.attemptId,
        revision: rebound.state.revision,
        ownerGeneration: rebound.ownerGeneration,
        capability: rebound.capability,
      };
    },
    finish: (owner = f.ownerAttempt, suppliedBody = body, answer: unknown = register) =>
      host.coordinator.run((hold) =>
        finishFirstFiscalSetup(
          host,
          { ...deps, provision: undefined, assertFiscalReady: undefined },
          owner,
          suppliedBody,
          hold,
          answer,
        ),
      ),
    interrupt: () => {
      interrupt = true;
    },
    counts: () => ({ activations, publications }),
    observePublication: (probe: () => Promise<void>) => {
      publicationProbe = probe;
    },
  };
}
it("installs the staged named verifier after exact fiscal commit and before trading", async () => {
  const f = await fixture();
  await f.consult();
  const result = await f.activate();
  expect(result.nodeId).toBe(f.staged.key.nodeId);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("Finish retains the consulted register and exact originals before publication, then records completion", async () => {
  const f = await fixture();
  await f.consult();
  f.interrupt();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const owner = await f.recover();
  await f.consult(true, owner);
  const before = await f.host.resolution.captureFirstSetupOriginals();
  const allocations = await suite.db.select().from(fiscalAllocations);
  f.observePublication(async () => {
    const store = createFirstSetupResolutionStore({
      ...f,
      coordinator: createFirstSetupCoordinator(),
    });
    const ids = await fs.readdir(join(f.stateDir, "first-setup-resolutions"));
    const audits = await Promise.all(ids.map((id) => store.read(id)));
    const records = audits.find((records) => records[0]?.action === "finish-publication");
    expect(records?.map((record) => record.phase)).toEqual(["prepared"]);
    expect((await f.host.store.read())?.status).toBe("committed");
  });
  await f.finish(owner);
  const store = createFirstSetupResolutionStore({
    ...f,
    coordinator: createFirstSetupCoordinator(),
  });
  const ids = await fs.readdir(join(f.stateDir, "first-setup-resolutions"));
  const audits = await Promise.all(ids.map((id) => store.read(id)));
  const records = audits.find((records) => records[0]?.action === "finish-publication");
  expect(records?.map(({ action, phase }) => [action, phase])).toEqual([
    ["finish-publication", "prepared"],
    ["finish-publication", "applied"],
  ]);
  const prepared = records![0]!;
  expect(prepared).toMatchObject({
    attemptId: owner.attemptId,
    observedRevision: owner.revision,
    observedOwnerGeneration: owner.ownerGeneration,
    authority: "original-password",
    database: "committed-exact",
    register: f.register,
    nextWorkspace: null,
    previousRecordDigest: null,
  });
  expect(records![1]!.previousRecordDigest).toBe(
    createHash("sha256").update(JSON.stringify(prepared)).digest("hex"),
  );
  const originals = await store.readOriginals(prepared.resolutionId);
  expect(originals.filter((entry) => entry.name !== "checked-commit.json")).toEqual(
    before.originals,
  );
  expect(
    JSON.parse(originals.find((entry) => entry.name === "checked-commit.json")!.bytes!.toString()),
  ).toMatchObject({ venue: { nodeId: f.staged.key.nodeId } });
  expect(
    (
      await fs.stat(
        join(f.stateDir, "first-setup-resolutions", prepared.resolutionId, "000001.json"),
      )
    ).mode & 0o777,
  ).toBe(0o600);
  for (const secret of [f.password, owner.capability])
    expect(JSON.stringify(records)).not.toContain(secret);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(allocations);
});

it.each(
  ["000001.json", "000002.json"].flatMap((name) => [false, true].map((after) => ({ name, after }))),
)(
  "Finish retries after $name rename interruption after=$after, retaining the incomplete action",
  async ({ name, after }) => {
    const f = await fixture();
    await f.consult();
    f.interrupt();
    await expect(f.activate()).rejects.toThrow("synthetic after commit");
    const owner = await f.recover();
    await f.consult(true, owner);
    const before = await fs.readFile(join(f.stateDir, "first-setup.json"));
    const allocations = await suite.db.select().from(fiscalAllocations);
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    let faults = 0;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (
        String(to).endsWith(`/${name}`) &&
        String(to).includes("/first-setup-resolutions/") &&
        faults === 0
      ) {
        faults++;
        if (after) await actual.rename(from, to);
        throw new Error("synthetic finish audit rename");
      }
      await actual.rename(from, to);
    });
    await expect(f.finish(owner)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(faults).toBe(1);
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    expect(f.counts()).toEqual({ activations: 1, publications: name === "000002.json" ? 1 : 0 });
    expect((await f.host.store.read())?.status).toBe(
      name === "000002.json" ? "publication" : "committed",
    );
    if (name === "000001.json")
      expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    const retained: [string, Buffer][] = [];
    for (const id of await fs.readdir(join(f.stateDir, "first-setup-resolutions"))) {
      const path = join(f.stateDir, "first-setup-resolutions", id, "000001.json");
      const bytes = await fs.readFile(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (bytes !== null) retained.push([path, bytes]);
    }
    const recovered = await f.recover();
    await f.consult(true, recovered);
    await f.finish(recovered);
    for (const [path, bytes] of retained) expect(await fs.readFile(path)).toEqual(bytes);
    expect((await f.host.store.read())?.status).toBe("complete");
    expect(f.counts()).toEqual({ activations: 1, publications: name === "000002.json" ? 2 : 1 });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(allocations);
  },
);

it.each([
  null,
  { kind: "no-current-master", confirmed: true },
  {
    kind: "current-master",
    status: "Unknown",
    custodian: "Elena",
    reference: "a".repeat(64),
    consultedAt: "2026-10-16T00:00:00.000Z",
  },
])(
  "Finish refuses an unavailable consumed-register answer %j without publication",
  async (answer) => {
    const f = await fixture();
    await f.consult();
    f.interrupt();
    await expect(f.activate()).rejects.toThrow("synthetic after commit");
    const owner = await f.recover();
    await f.consult(true, owner);
    const before = await fs.readFile(join(f.stateDir, "first-setup.json"));
    await expect(f.finish(owner, undefined, answer)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    expect(f.counts()).toEqual({ activations: 1, publications: 0 });
  },
);
it("publication after interruption preserves the staged verifier with zero further fiscal activations", async () => {
  const f = await fixture();
  await f.consult();
  f.interrupt();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const verifier = await readBreakGlassVerifier(suite.db, f.staged.key.nodeId);
  expect(verifier).toBe(f.staged.stage.verifier);
  const owner = await f.consult(true);
  await f.activate(owner);
  expect(await readBreakGlassVerifier(suite.db, f.staged.key.nodeId)).toBe(verifier);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("Finish setup is a separate publication-only path after original-password recovery", async () => {
  const f = await fixture();
  await f.consult();
  f.interrupt();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const rows = await suite.db.select().from(fiscalAllocations);
  const owner = await f.recover();
  await f.consult(true, owner);
  const result = await f.finish(owner);
  expect(result.nodeId).toBe(f.staged.key.nodeId);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(rows);
});
it("Finish setup refuses before activation and cannot spend a fresh allocation", async () => {
  const f = await fixture();
  const owner = await f.recover();
  await f.consult(false, owner);
  await expect(f.finish(owner)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(f.counts()).toEqual({ activations: 0, publications: 0 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it("Finish setup needs a fresh outside committed confirmation and the original password", async () => {
  const f = await fixture();
  await f.consult();
  f.interrupt();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const beforeRecovery = await f.consult(true);
  await expect(f.finish(beforeRecovery)).rejects.toMatchObject({ code: "setup.owner_required" });
  const owner = await f.recover();
  await expect(f.finish(owner)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(f.counts()).toEqual({ activations: 1, publications: 0 });
});

it("Finish setup recovers the exact committed result when the host result write was interrupted", async () => {
  const f = await fixture();
  await f.consult();
  const original = f.host.store.update;
  const update = vi.spyOn(f.host.store, "update").mockImplementation(async (...args) => {
    if (args[2].kind === "committed") {
      update.mockRestore();
      throw new Error("synthetic lost host result");
    }
    return original(...args);
  });
  try {
    await expect(f.activate()).rejects.toThrow("synthetic lost host result");
  } finally {
    update.mockRestore();
  }
  expect((await f.host.store.read())?.status).toBe("activation-started");
  const rows = await suite.db.select().from(fiscalAllocations);
  const owner = await f.recover();
  await f.consult(true, owner);
  await f.finish(owner);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(rows);
});
it("Finish setup refuses changed publication inputs after exact commitment", async () => {
  const f = await fixture();
  await f.consult();
  f.interrupt();
  await expect(f.activate()).rejects.toThrow("synthetic after commit");
  const owner = await f.recover();
  await f.consult(true, owner);
  await expect(
    f.finish(owner, {
      mode: "live",
      email: {
        server: "different.example",
        port: 465,
        encryption: "tls",
        user: "",
        password: "",
        from: "venue@example.test",
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(f.counts()).toEqual({ activations: 1, publications: 0 });
});
