import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { deployment, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type OperationBinding,
} from "@waitron/module";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import * as hour from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { verifactuIdentities } from "@waitron/fiscal-verifactu/src/schema/verifactu-identities.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { readModulePreparationHistory } from "./module-preparation-state.js";
import { createFirstSetupRuntime as createFirstSetupModuleHost } from "./first-setup-runtime.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";

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
    setBoxClock?: Parameters<typeof createFirstSetupModuleHost>[0]["setBoxClock"];
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
    setBoxClock: options.setBoxClock,
    freezeConfiguration: async () => ({ digest: "b".repeat(64), newTaxpayer: false }),
  };
  const host = createFirstSetupModuleHost(args);
  const claim = await host.owner.claimFirstSetup({
    environment: options.environment ?? "preproduction",
    request: { ...request, seriesCode: options.standardBase ?? request.seriesCode },
    ...(options.imported ? { configurationImport: true } : {}),
  });
  const state = (await host.store.read())!;
  const context = firstSetupModuleContext(state, MODULE);
  const read = (binding = context.binding) =>
    host.coordinator.run(() =>
      bound.withPreparationState!(binding, () => bound.readSetupFacts!(binding)),
    );
  return { host, bound, context, read, args, database, claim };
}

const clockRequest = {
  offsetMs: 60_000,
  agreesWithinMs: 30_000,
  measuredAt: { wallMs: 1_794_571_200_000, monoMs: 1_000 },
  reading: {
    boxAt: "2026-11-13T12:00:00.000Z",
    witnessAt: "2026-11-13T12:01:00.000Z",
    uncertaintyMs: 40,
  },
};

it("attributes a setup clock request to the administrator held in setup state", async () => {
  const received: unknown[] = [];
  const f = await fixture({
    setBoxClock: async (input, person) => {
      received.push({ input, person: await person() });
      return { status: "refused", reason: "synchronised" };
    },
  });
  const administratorId = (await f.host.store.read())!.frozen.administratorId;
  expect(await f.bound.setBoxClock!(f.context.binding, structuredClone(clockRequest))).toEqual({
    status: "refused",
    reason: "synchronised",
  });
  expect(received).toEqual([
    { input: clockRequest, person: { id: administratorId, name: "Elena" } },
  ]);
});

it("refuses the clock requester lookup when setup state is absent", async () => {
  const f = await fixture({
    setBoxClock: async (_input, person) => {
      await person();
      return { status: "set" };
    },
  });
  await rm(f.args.stateDir, { recursive: true, force: true });
  await expect(f.bound.setBoxClock!(f.context.binding, clockRequest)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

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
  await seedTaxpayers(venue.db);
  await stampDeployment(venue.db, "preproduction");
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(verifactuIdentities).values({
      id: "history-other-node",
      nodeId: TAXPAYER_A.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "0CNPH",
      registradoEn: new Date("2026-10-16T12:01:00Z"),
      revocadoEn: new Date("2026-10-16T12:02:00Z"),
    });
  });
  const f = await fixture();
  expect(f.context.binding.targetNodeId).not.toBe(TAXPAYER_A.nodeId);
  const facts = await f.read();
  expect(facts.localHistory).toMatchObject({
    complete: true,
    records: [
      expect.objectContaining({
        identity: "0CNPH",
        nodeId: TAXPAYER_A.nodeId,
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
    module.name === "menu" ? { ...module, version: "99.0.0" } : module,
  );
  createFirstSetupModuleHost({ ...f.args, modules: changed });
  await expect(f.read()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.database).not.toHaveBeenCalled();
});

function currentClock(instantMs = Date.parse("2026-10-16T11:40:00Z")) {
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
type ReadClock = NonNullable<
  NonNullable<Parameters<typeof hour.createHostedHourPreparation>[1]>["readClock"]
>;
/**
 * Selects through the real host, each time with a fresh owner password grant, and while the
 * selection waits, moves its clocks (wall and monotonic together) 1 ms past the target and asks
 * again.
 */
async function selectThroughHost(
  f: Awaited<ReturnType<typeof fixture>>,
  readClock: (instantMs: number) => ReadClock = (instantMs) => async () => ({
    clock: currentClock(instantMs),
  }),
) {
  const owner = { ...f.claim.state, capability: f.claim.capability };
  let instantMs = Date.parse("2026-10-16T11:40:00Z");
  let monotonic = 0;
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => monotonic,
    readClock: (context) => readClock(instantMs)(context),
  });
  for (let round = 0; ; round++) {
    const reconfirmation = await f.host.owner.reconfirm(owner, PASSWORD, "block-use");
    const result = await f.host.coordinator.run((hold) =>
      f.host.withPreparationAuthorization(
        {
          intent: () =>
            f.host.owner.consumeReconfirmation(owner, reconfirmation, "block-use", hold),
          wait: () => f.host.owner.checkReconfirmation(owner, reconfirmation, "block-use", hold),
        },
        () =>
          withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
            preparation.select({
              binding: f.context.binding,
              authority,
              comparisonId: "comparison",
              confirmed: true,
            }),
          ),
      ),
    );
    if (result.status !== "waiting" || round === 3) return result;
    monotonic += result.targetMs + 1 - instantMs;
    instantMs = result.targetMs + 1;
  }
}

it.each(["production", "preproduction"] as const)(
  "the hosted selector derives %s names and all purposes from the frozen real host",
  async (environment) => {
    const f = await fixture({ environment });
    await stampDeployment(venue.db, environment);
    const selection = await selectThroughHost(f);
    expect(selection).toMatchObject({
      status: "selected",
      identity: "0CNNY",
      scope: { taxpayerNif: request.taxId, environment },
      input: {
        allocation: {
          environment,
          installationIdentity: "0CNNY",
          series: [
            { code: "A-0CNNY", purpose: "standard" },
            { code: "FF-0CNNY", purpose: "full" },
            { code: "R-0CNNY", purpose: "corrective" },
            { code: "RF-0CNNY", purpose: "full_corrective" },
          ],
        },
      },
    });
  },
);

it("the hosted selector refuses a minute another node's revoked identity already uses", async () => {
  await seedTaxpayers(venue.db);
  await stampDeployment(venue.db, "preproduction");
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(verifactuIdentities).values({
      nodeId: TAXPAYER_A.nodeId,
      nif: request.taxId,
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "0CNNY",
      registradoEn: new Date("2026-10-16T11:00:00Z"),
      revocadoEn: new Date("2026-10-16T11:30:00Z"),
    });
  });
  const f = await fixture();
  await expect(selectThroughHost(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_in_use" },
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
        installationIdentity: "0CNNY",
        environment: "production",
        series: [
          { code: "FF-0CNNY", purpose: "full" },
          { code: "R-0CNNY", purpose: "corrective" },
          { code: "RF-0CNNY", purpose: "full_corrective" },
          { code: "a/B_1.2-3-0CNNY", purpose: "standard" },
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
  await seedTaxpayers(venue.db);
  await withTransaction(venue.db, async (tx) => {
    await tx.insert(verifactuIdentities).values({
      nodeId: TAXPAYER_A.nodeId,
      nif: request.taxId,
      idSistemaInformatico: "OTHER",
      numeroInstalacion: "0CNM0",
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

it.each(["en", "es"] as const)(
  "keeps the fiscal continuation key unchanged by a %s working-language choice",
  async (staffLanguage) => {
    const f = await fixture();
    const before = await f.read();
    const state = (await f.host.store.read())!;
    const root = await mkdtemp(join(tmpdir(), "first-language-facts-"));
    roots.push(root);
    let bound!: ModuleOperationHost;
    const modules = ALL_MODULES.map((module) => {
      if (module.name !== MODULE) return module;
      const seat = module.provisioning!.initialSetup!;
      return {
        ...module,
        provisioning: {
          ...module.provisioning!,
          initialSetup: {
            ...seat,
            configure(host: ModuleOperationHost) {
              bound = host;
              return seat.configure!(host);
            },
          },
        },
      };
    });
    const host = createFirstSetupModuleHost({
      ...f.args,
      modules,
      stateDir: join(root, "state"),
      venueDir: join(root, "venue"),
    });
    await host.store.claim(
      { ...state.frozen, request: { ...state.frozen.request, staffLanguage } },
      state.ownerVerifier,
      state.capabilityHash,
    );
    const after = await host.coordinator.run(() =>
      bound.withPreparationState!(f.context.binding, () =>
        bound.readSetupFacts!(f.context.binding),
      ),
    );
    expect(after.continuationKey).toBe(before.continuationKey);
    expect(after.contextKey).toBe(before.contextKey);
    expect(after.context).toEqual(before.context);
  },
);

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

it("a clock provider cannot replace the host's scope or bases", async () => {
  const f = await fixture();
  const selection = await selectThroughHost(f, (instantMs) => async (context) => {
    Object.assign(context, { taxId: "89890001K", environment: "production" });
    Object.assign(context.bases[0]!, { code: "changed" });
    return {
      clock: currentClock(instantMs),
      scope: { taxpayerNif: "89890001K", environment: "production" },
      bases: [
        { code: "injected", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "corrective" },
        { code: "RF", purpose: "full_corrective" },
      ],
    };
  });
  expect(selection).toMatchObject({
    status: "selected",
    input: {
      allocation: {
        taxpayerNif: request.taxId,
        environment: "preproduction",
        series: [
          { code: "A-0CNNY", purpose: "standard" },
          { code: "FF-0CNNY", purpose: "full" },
          { code: "R-0CNNY", purpose: "corrective" },
          { code: "RF-0CNNY", purpose: "full_corrective" },
        ],
      },
    },
  });
});

it("cannot retain an hour selection without a fresh owner password grant", async () => {
  const f = await fixture();
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => 0,
    readClock: async () => ({ clock: currentClock() }),
  });
  await expect(
    f.host.coordinator.run(() =>
      withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
        preparation.select({
          binding: f.context.binding,
          authority,
          comparisonId: "comparison",
          confirmed: true,
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await f.host.store.read())!.status).toBe("claimed");
  expect((await f.host.store.read())!.inputs).toEqual({});
});

it("an hour selection written outside the host's password scope is refused", async () => {
  const f = await fixture();
  const owner = { ...f.claim.state, capability: f.claim.capability };
  let instantMs = Date.parse("2026-10-16T11:40:00Z");
  let monotonic = 0;
  const preparation = hour.createHostedHourPreparation(f.bound, {
    monotonicNow: () => monotonic,
    readClock: async () => ({ clock: currentClock(instantMs) }),
  });
  const select = () =>
    withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
      preparation.select({
        binding: f.context.binding,
        authority,
        comparisonId: "comparison",
        confirmed: true,
      }),
    );
  const reconfirmation = await f.host.owner.reconfirm(owner, PASSWORD, "block-use");
  const waiting = await f.host.coordinator.run((hold) =>
    f.host.withPreparationAuthorization(
      {
        intent: () => f.host.owner.consumeReconfirmation(owner, reconfirmation, "block-use", hold),
        wait: () => f.host.owner.checkReconfirmation(owner, reconfirmation, "block-use", hold),
      },
      select,
    ),
  );
  if (waiting.status !== "waiting") throw new Error("the first round must wait");
  monotonic += waiting.targetMs + 1 - instantMs;
  instantMs = waiting.targetMs + 1;
  await expect(f.host.coordinator.run(select)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

it("a module cannot read setup facts or enter preparation during host initialization", async () => {
  const f = await fixture();
  const checks: Promise<void>[] = [];
  let configured = false;
  const modules = f.args.modules.map((module) => {
    if (module.name !== MODULE) return module;
    const seat = module.provisioning!.initialSetup!;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...seat,
          configure(host: ModuleOperationHost) {
            configured = true;
            checks.push(
              expect(host.readSetupFacts!(f.context.binding)).rejects.toMatchObject({
                code: "setup.not_ready",
              }),
            );
            expect(() =>
              host.withPreparationState!(f.context.binding, async () => "must not run"),
            ).toThrowError(expect.objectContaining({ code: "setup.not_ready" }));
            return seat.configure!(host);
          },
        },
      },
    };
  });
  createFirstSetupModuleHost({ ...f.args, modules });
  await Promise.all(checks);
  expect(configured).toBe(true);
  expect((await f.host.store.read())!.revision).toBe(1);
});

it("hands a module the public evidence its host was given, for the binding the module names", async () => {
  const f = await fixture();
  let bound!: ModuleOperationHost;
  const modules = f.args.modules.map((module) => {
    if (module.name !== MODULE) return module;
    const seat = module.provisioning!.initialSetup!;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...seat,
          configure(host: ModuleOperationHost) {
            bound = host;
            return seat.configure!(host);
          },
        },
      },
    };
  });
  const evidence = { trust: "synthetic trust", current: "synthetic current" };
  const asked: OperationBinding[] = [];
  createFirstSetupModuleHost({
    ...f.args,
    modules,
    readPublicEvidence: async (binding) => {
      asked.push(binding);
      return evidence;
    },
  });
  expect(await bound.readPublicEvidence(f.context.binding)).toBe(evidence);
  expect(asked).toEqual([f.context.binding]);
});

it("pairs the box's boot id with this server start, and leaves an unknown boot id unknown", async () => {
  const f = await fixture();
  expect(f.bound.readBoot).toBeUndefined();
  let boot: { ms: number; id: string | null } = { ms: 1_234, id: "box-boot" };
  const start = () => {
    let bound!: ModuleOperationHost;
    const modules = f.args.modules.map((module) => {
      if (module.name !== MODULE) return module;
      const seat = module.provisioning!.initialSetup!;
      return {
        ...module,
        provisioning: {
          ...module.provisioning!,
          initialSetup: {
            ...seat,
            configure(host: ModuleOperationHost) {
              bound = host;
              return seat.configure!(host);
            },
          },
        },
      };
    });
    const host = createFirstSetupModuleHost({ ...f.args, modules, readBoot: () => boot });
    return { bootId: host.bootId, bound };
  };
  const first = start();
  const restarted = start();
  expect(first.bootId).not.toBe(restarted.bootId);
  expect(first.bound.readBoot!()).toEqual({ ms: 1_234, id: `box-boot ${first.bootId}` });
  expect(restarted.bound.readBoot!()).toEqual({ ms: 1_234, id: `box-boot ${restarted.bootId}` });
  boot = { ms: 5_678, id: null };
  expect(first.bound.readBoot!()).toEqual({ ms: 5_678, id: null });
});

it.each(["intent", "wait"] as const)(
  "accepts a %s write to preparation state until activation starts, and refuses it afterwards",
  async (purpose) => {
    const f = await fixture();
    const authority = { intent: vi.fn(async () => {}), wait: vi.fn(async () => {}) };
    const write = (value: string) =>
      f.host.coordinator.run(() =>
        f.host.withPreparationAuthorization(authority, () =>
          f.bound.withPreparationState!(f.context.binding, (state) =>
            state.replace({ value }, purpose),
          ),
        ),
      );
    await write("before activation");
    expect(authority[purpose]).toHaveBeenCalledTimes(1);
    const history = [{ value: "before activation" }];
    expect(await readModulePreparationHistory(f.args, MODULE)).toEqual(history);

    let state = (await f.host.store.read())!;
    state = await f.host.store.update(state.frozen.attemptId, state.revision, {
      kind: "consumption-intent",
    });
    await write("during consumption intent");
    expect(authority[purpose]).toHaveBeenCalledTimes(2);
    history.push({ value: "during consumption intent" });
    expect(await readModulePreparationHistory(f.args, MODULE)).toEqual(history);

    await f.host.store.update(state.frozen.attemptId, state.revision, {
      kind: "activation-started",
    });

    await expect(write("after activation")).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(authority[purpose]).toHaveBeenCalledTimes(2);
    expect(await readModulePreparationHistory(f.args, MODULE)).toEqual(history);
  },
);

it("refuses to read setup facts for a binding the current attempt no longer has", async () => {
  const f = await fixture();
  const current = (await f.host.store.read())!;
  let refusal: unknown;
  await expect(
    f.host.coordinator.run((hold) =>
      f.bound.withPreparationState!(f.context.binding, async () => {
        await f.host.store.update(
          current.frozen.attemptId,
          current.revision,
          { kind: "abandoned" },
          hold,
        );
        const attemptId = randomUUID();
        await f.host.store.claim(
          {
            ...current.frozen,
            attemptId,
            sourceId: `first-setup:${attemptId}`,
            administratorId: randomUUID(),
            nodeId: randomUUID(),
            modules: current.frozen.modules.map((module) => ({
              ...module,
              eventId: randomUUID(),
            })),
          },
          current.ownerVerifier,
          current.capabilityHash,
          hold,
        );
        refusal = await f.bound.readSetupFacts!(f.context.binding).catch((error: unknown) => error);
      }),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(refusal).toMatchObject({ code: "setup.attempt_conflict" });
});

it("leaves a module with no set of its own out of the sets an empty database must hold", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-setup-setless-"));
  roots.push(root);
  const venueDir = join(root, "venue");
  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
  const setless = fakeSetlessModule("synthetic-setless", "core", { requires: { core: "*" } });
  const host = createFirstSetupModuleHost({
    stateDir: join(root, "state"),
    venueDir,
    environment: {},
    modules: [...ALL_MODULES, setless],
  });
  expect(await host.resolution.inspectFirstSetupDatabase(["synthetic-setless"])).toMatchObject({
    emptyDatabase: false,
  });
  expect(await host.resolution.inspectFirstSetupDatabase()).toMatchObject({
    emptyDatabase: true,
  });
});
