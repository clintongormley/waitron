import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { deployment, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type OperationBinding,
} from "@waitron/module";
import * as hour from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { MODULE, PASSWORD, request } from "../test/first-fiscal.js";

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  options: {
    unavailable?: boolean;
    environment?: "production" | "preproduction";
    imported?: boolean;
    standardBase?: string;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "first-hour-facts-"));
  roots.push(root);
  let bound!: ModuleOperationHost;
  const modules = ALL_MODULES.map((module) => {
    if (module.name !== MODULE) return module;
    const initialSetup = module.provisioning!.initialSetup!;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...initialSetup,
          configure(host: ModuleOperationHost) {
            bound = host;
            return initialSetup.configure!(host);
          },
        },
      },
    };
  });
  const database = vi.fn(() => (options.unavailable ? undefined : venue.db));
  const args = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    environment: {},
    modules,
    database,
    freezeConfiguration: async () => ({ digest: "b".repeat(64), newTaxpayer: false }),
  };
  const host = createFirstSetupModuleHost(args);
  const nonce = randomBytes(32).toString("base64url");
  const claim = await host.owner.claimFirstSetup(
    {
      environment: options.environment ?? "preproduction",
      request: { ...request, seriesCode: options.standardBase ?? request.seriesCode },
      ...(options.imported ? { configurationImport: true } : {}),
    },
    nonce,
  );
  const state = (await host.store.read())!;
  const context = firstSetupModuleContext(state, MODULE);
  const read = (binding = context.binding) =>
    host.coordinator.run(() =>
      bound.withPreparationState!(binding, () => bound.readSetupFacts!(binding)),
    );
  return { host, bound, context, read, args, database, claim, nonce };
}

it("reads the frozen setup scope and real module history under the preparation hold", async () => {
  const f = await fixture();
  const facts = await f.read();
  expect(facts.context).toEqual(f.context);
  expect(facts.localHistory).toEqual({ reference: "venue", complete: true, records: [] });
  expect(facts.contextKey).toEqual(expect.any(String));
  expect(JSON.stringify(facts)).not.toContain(PASSWORD);
  (facts.context.bases as { code: string; purpose: string }[])[0]!.code = "changed";
  expect((await f.read()).context.bases).toEqual(f.context.bases);
});

it("uses the database stamp rather than an ambient environment", async () => {
  await stampDeployment(venue.db, "production");
  const f = await fixture({ environment: "preproduction" });
  await expect(f.read()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await venue.db.select().from(deployment)).toEqual([
    expect.objectContaining({ environment: "production" }),
  ]);
});

it("includes a revoked identity on another node in the actual local history", async () => {
  await seedTenants(venue.db);
  await stampDeployment(venue.db, "preproduction");
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(registroSif).values({
      id: "history-other-node",
      nodeId: TENANT_A.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "06RC",
      registradoEn: new Date("2026-10-16T12:01:00Z"),
      revocadoEn: new Date("2026-10-16T12:02:00Z"),
    });
  });
  const f = await fixture();
  expect(f.context.binding.targetNodeId).not.toBe(TENANT_A.nodeId);
  const facts = await f.read();
  expect(facts.localHistory).toMatchObject({
    complete: true,
    records: [
      expect.objectContaining({
        identity: "06RC",
        nodeId: TENANT_A.nodeId,
        softwareId: "OTHER",
        environment: "preproduction",
        recordedAtMs: Date.parse("2026-10-16T12:02:00Z"),
      }),
    ],
  });
});

it("cannot inspect setup facts outside their bound preparation hold", async () => {
  const f = await fixture();
  await expect(f.bound.readSetupFacts!(f.context.binding)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(f.database).not.toHaveBeenCalled();
  const foreign: OperationBinding = { ...f.context.binding, eventId: "foreign-event" };
  await expect(
    f.host.coordinator.run(() =>
      f.bound.withPreparationState!(f.context.binding, () => f.bound.readSetupFacts!(foreign)),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.database).not.toHaveBeenCalled();
});

it("does not invent empty history when the real database handle is unavailable", async () => {
  const f = await fixture({ unavailable: true });
  await expect(f.read()).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("refuses an asynchronous reader after its preparation callback has finished", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending!: Promise<unknown>;
  await f.host.coordinator.run(() =>
    f.bound.withPreparationState!(f.context.binding, async () => {
      pending = gate.then(() => f.bound.readSetupFacts!(f.context.binding));
    }),
  );
  const outcome = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  release();
  await outcome;
  expect(f.database).not.toHaveBeenCalled();
});

it("refuses facts after the selected module version changes", async () => {
  const f = await fixture();
  const changed = f.args.modules.map((module) =>
    module.name === MODULE ? { ...module, version: "99.0.0" } : module,
  );
  createFirstSetupModuleHost({ ...f.args, modules: changed });
  await expect(f.read()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("refuses facts when another enabled module's frozen version changes", async () => {
  const f = await fixture();
  const changed = f.args.modules.map((module) =>
    module.name === "catalogue" ? { ...module, version: "99.0.0" } : module,
  );
  createFirstSetupModuleHost({ ...f.args, modules: changed });
  await expect(f.read()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.database).not.toHaveBeenCalled();
});

function currentClock() {
  const instantMs = Date.parse("2026-10-16T11:40:00Z");
  return compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable" as const,
      instantMs,
      uncertaintyMs: 0,
      wallStartedMs: instantMs,
      wallFinishedMs: instantMs,
      monotonicStartedMs: 0,
      monotonicFinishedMs: 0,
    })),
    Date.parse("2026-10-15T00:00:00Z"),
  );
}
async function selectThroughHost(
  f: Awaited<ReturnType<typeof fixture>>,
  readClock = async () => ({ clock: currentClock() }),
) {
  const owner = { ...f.claim.state, capability: f.claim.capability };
  const reconfirmation = await f.host.owner.reconfirm(owner, PASSWORD, "block-use");
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => 0,
    readClock,
  });
  return f.host.coordinator.run((hold) =>
    f.host.withPreparationAuthorization(
      () => f.host.owner.consumeReconfirmation(owner, reconfirmation, "block-use", hold),
      () =>
        withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
          preparation.select({ binding: f.context.binding, authority, answer: "no" }),
        ),
    ),
  );
}

it.each(["production", "preproduction"] as const)(
  "the hosted selector derives %s names and all purposes from the frozen real host",
  async (environment) => {
    const f = await fixture({ environment });
    await stampDeployment(venue.db, environment);
    const selection = await selectThroughHost(f);
    expect(selection).toMatchObject({
      status: "selected",
      identity: "06RB",
      scope: { taxpayerNif: request.taxId, environment },
      input: {
        allocation: {
          environment,
          installationIdentity: "06RB",
          series: [
            { code: "A-06RB", purpose: "standard" },
            { code: "FF-06RB", purpose: "full" },
            { code: "R-06RB", purpose: "rectificative" },
          ],
        },
      },
    });
  },
);

it("the hosted selector refuses an older hour than another node's revoked real identity", async () => {
  await seedTenants(venue.db);
  await stampDeployment(venue.db, "preproduction");
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(registroSif).values({
      nodeId: TENANT_A.nodeId,
      nif: request.taxId,
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "06RC",
      registradoEn: new Date("2026-10-16T12:01:00Z"),
      revocadoEn: new Date("2026-10-16T12:02:00Z"),
    });
  });
  const f = await fixture();
  await expect(selectThroughHost(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
});

it("an imported setup retains its fresh host identity and exact configured base spelling", async () => {
  const f = await fixture({ environment: "production", imported: true, standardBase: "a/B_1.2-3" });
  const selection = await selectThroughHost(f);
  expect(selection).toMatchObject({
    status: "selected",
    binding: f.context.binding,
    input: {
      allocation: {
        installationIdentity: "06RB",
        environment: "production",
        series: [
          { code: "FF-06RB", purpose: "full" },
          { code: "R-06RB", purpose: "rectificative" },
          { code: "a/B_1.2-3-06RB", purpose: "standard" },
        ],
      },
    },
  });
  const facts = await f.read();
  expect(JSON.parse(facts.contextKey).at(-1)).toEqual({
    digest: "b".repeat(64),
    newTaxpayer: false,
  });
  expect((await f.host.store.read())!.inputs).toEqual({});
});

it("the hosted selector refuses an occupied inventory with no deployment stamp", async () => {
  await seedTenants(venue.db);
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(registroSif).values({
      nodeId: TENANT_A.nodeId,
      nif: request.taxId,
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "06RA",
    });
  });
  const f = await fixture();
  await expect(selectThroughHost(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
});

it("the context fingerprint survives the expected input-freezing state transition", async () => {
  const f = await fixture();
  const before = await f.read();
  const state = (await f.host.store.read())!;
  await f.host.store.update(state.frozen.attemptId, state.revision, { kind: "consumption-intent" });
  expect((await f.read()).contextKey).toBe(before.contextKey);
});

it.each(["readSetupFacts", "withPreparationState"] as const)(
  "there is no ambient preparation fallback when the host omits %s",
  (missing) => {
    const host: ModuleOperationHost = {
      environment: { WAITRON_FISCAL_CONFIRMATION_FILE: "ambient.json" },
      readPublicEvidence: async () => undefined,
      readSetupFacts: async () => {
        throw new Error("must not read");
      },
      withPreparationState: async () => {
        throw new Error("must not enter");
      },
    };
    delete host[missing];
    expect(() =>
      hour.createHostedHourPreparation(host, {
        monotonicNow: () => 0,
        readClock: async () => ({ clock: currentClock() }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      }),
    );
  },
);

it("owner recovery invalidates the previously selected setup fingerprint", async () => {
  const f = await fixture();
  const selected = await selectThroughHost(f);
  if (selected.status !== "selected") throw new Error("selection must be ready");
  const before = await f.read();
  await f.host.owner.resumeFirstSetup(f.nonce, { password: PASSWORD });
  expect((await f.read()).contextKey).not.toBe(before.contextKey);
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => 0,
    readClock: async () => ({ clock: currentClock() }),
  });
  const run = vi.fn(async () => "must not run");
  await expect(
    f.host.coordinator.run(() =>
      withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
        preparation.prepare({ binding: f.context.binding, authority, input: selected.input }, run),
      ),
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "event_mismatch" } });
  expect(run).not.toHaveBeenCalled();
});

it("a clock provider cannot replace the host's scope or bases", async () => {
  const f = await fixture();
  const owner = { ...f.claim.state, capability: f.claim.capability };
  const grant = await f.host.owner.reconfirm(owner, PASSWORD, "block-use");
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => 0,
    readClock: async (context) => {
      Object.assign(context, { taxId: "89890001K", environment: "production" });
      Object.assign(context.bases[0]!, { code: "changed" });
      return {
        clock: currentClock(),
        scope: { taxpayerNif: "89890001K", environment: "production" },
        bases: [
          { code: "injected", purpose: "standard" },
          { code: "FF", purpose: "full" },
          { code: "R", purpose: "rectificative" },
        ],
      };
    },
  });
  const selection = await f.host.coordinator.run((hold) =>
    f.host.withPreparationAuthorization(
      () => f.host.owner.consumeReconfirmation(owner, grant, "block-use", hold),
      () =>
        withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
          preparation.select({ binding: f.context.binding, authority, answer: "no" }),
        ),
    ),
  );
  expect(selection).toMatchObject({
    status: "selected",
    input: {
      allocation: {
        taxpayerNif: request.taxId,
        environment: "preproduction",
        series: [
          { code: "A-06RB", purpose: "standard" },
          { code: "FF-06RB", purpose: "full" },
          { code: "R-06RB", purpose: "rectificative" },
        ],
      },
    },
  });
});
