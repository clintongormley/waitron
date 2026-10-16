import { vi } from "vitest";
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
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const fixtures: Awaited<ReturnType<typeof declaredFirstFiscalFixture>>[] = [];
afterEach(async () => {
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
  const activate = (owner = f.ownerAttempt) =>
    host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, body, hold));
  return {
    ...f,
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
    finish: (owner = f.ownerAttempt, suppliedBody = body) =>
      host.coordinator.run((hold) =>
        finishFirstFiscalSetup(
          host,
          { ...deps, provision: undefined, assertFiscalReady: undefined },
          owner,
          suppliedBody,
          hold,
        ),
      ),
    interrupt: () => {
      interrupt = true;
    },
    counts: () => ({ activations, publications }),
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
  await f.consult(true);
  await expect(f.finish(f.ownerAttempt)).rejects.toMatchObject({ code: "setup.owner_required" });
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
