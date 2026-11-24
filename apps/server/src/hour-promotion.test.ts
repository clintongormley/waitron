import { allocationRows } from "@waitron/fiscal-verifactu/test/allocation-rows.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import {
  seedVenueSettings,
  seedBusinessDay,
  seriesWithNextNumber,
  advanceSeriesTo,
} from "@waitron/db/testing/seed.js";
import { SERIES_BASES } from "@waitron/db/testing/series-bases.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { invoiceSeries, nodes, stampDeployment, taxpayer, withTransaction } from "@waitron/db";
import { readNodeMode, setNodeMode } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type OperationBinding,
} from "@waitron/module";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu/src/allocated-standby.js";
import { verifactuIdentities } from "@waitron/fiscal-verifactu/src/schema/verifactu-identities.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword } from "@waitron/identity";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintMasterKey, WRONG_MASTER_KEY } from "./testing/master-key.js";
import { establishNodeIdentity } from "./node-identity.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { nodeId as brandNodeId } from "@waitron/shared";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const spare = useVenueDb({ migrations });
const primary = { nodeId: TAXPAYER_A.nodeId };
const standby = { nodeId: TAXPAYER_A.nodeId2 };
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const PASSWORD = "synthetic-promotion-password";
const hash = hashPassword(PASSWORD);
const credentials = { personId: ADMIN, password: PASSWORD };
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const bases = SERIES_BASES;
const joinBinding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "reserve",
  eventId: "admission",
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
const binding: OperationBinding = { ...joinBinding, action: "promote", eventId: "promotion" };
const context = { oldNodeNeutralised: true, noParallelRecovery: true };
let root: string;
/** The last clock comparison taken, which the next select names. */
let comparisonId = "";
let key: { name: string; secret: string };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hour-promotion-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Promotion SL" });
  await seedVenueSettings(suite.db, {
    name: "Restaurant",
    invoiceLocales: ["en"],
  });
  await seedBusinessDay(suite.db, { timeZone: "Europe/Madrid" });
  await suite.db.insert(nodes).values(
    [primary, standby].map((node) => ({
      id: node.nodeId,
      name: node === primary ? "Primary" : "Standby",
      filingModule: "verifactu",
      taxModule: "vat",
    })),
  );
  await stampDeployment(suite.db, "preproduction");
  await seedPersons(suite.db, {
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: hash,
  });
  let value: unknown = null;
  const first = { ...joinBinding, action: "setup", eventId: "first", targetNodeId: primary.nodeId };
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => performance.now(),
    read: async () => ({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      bases,
      contextKey: "first",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        ["box", "browser"].map((source) => ({
          source: source as "box" | "browser",
          result: "usable",
          instantMs: Date.now(),
          uncertaintyMs: 0,
          wallStartedMs: Date.now(),
          wallFinishedMs: Date.now(),
          monotonicStartedMs: 0,
          monotonicFinishedMs: 0,
        })),
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  await withOperationAuthority(first, ADMIN, async (authority) => {
    let selected = await setup.select({
      binding: first,
      authority,
      comparisonId: "comparison",
      confirmed: true,
    });
    if (selected.status === "waiting") {
      vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
      selected = await setup.select({
        binding: first,
        authority,
        comparisonId: "comparison",
        confirmed: true,
      });
    }
    if (selected.status !== "selected") throw new Error("first setup selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (ready) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
    );
  });
  await advanceSeriesTo(suite.db, primary.nodeId, 123);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, standby.nodeId);
  await setNodeMode({ venue: suite.db, node: suite.node }, standby.nodeId, "mirror", "adopt");
  key = await mintMasterKey(suite.db);
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});

async function service(modules = ALL_MODULES.filter((module) => module.name === binding.module)) {
  return createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    nodeDb: suite.node,
    node: standby,
    modules,
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}
async function admit(s: Awaited<ReturnType<typeof service>>) {
  let state: unknown;
  await s.withOperation(
    { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (ready) =>
        withTransaction(suite.db, async (tx) => {
          state = (
            await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, ready.get(binding.module))
          ).state;
        }),
      ),
  );
  const establish = { ...joinBinding, action: "establish" };
  await s.withOperation(
    { binding: establish, input: state },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (ready) =>
        withTransaction(suite.db, (tx) =>
          ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(binding.module)),
        ),
      ),
  );
  return state;
}
async function compare(
  s: Awaited<ReturnType<typeof service>>,
  auth: unknown = credentials,
  held = binding,
) {
  const challenge = (await s.prepareWithDormantSetup(
    held,
    auth,
    context,
    { action: "clock-challenge" },
    { onBox: true },
  )) as {
    id: string;
  };
  const compared = (await s.prepareWithDormantSetup(
    held,
    auth,
    context,
    {
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    },
    { onBox: true },
  )) as { id: string };
  comparisonId = compared.id;
  return compared;
}
async function rows() {
  return {
    series: await suite.db.select(seriesWithNextNumber).from(invoiceSeries),
    allocations: await allocationRows(suite.db),
    sif: await suite.db.select().from(verifactuIdentities),
  };
}
async function promote(
  s: Awaited<ReturnType<typeof service>>,
  input: unknown,
  auth: unknown = credentials,
) {
  return s.withPromotion({ binding, input }, auth, context, (modules, runner) =>
    promoteMirrorToPrimary(
      {
        db: suite.db,
        node: suite.node,
        nodeId: standby.nodeId,
        ring,
        modules,
        holders: createDeploymentHolders("mirror", "secondary"),
        log: () => {},
        withModuleOperations: runner,
      },
      { oldNodeNeutralised: true },
    ),
  );
}

it("a signed-in manager selects and activates a promotion after dormant admission", async () => {
  const s = await service();
  const before = await rows();
  await admit(s);
  expect(await rows()).toEqual(before);
  expect(
    await readModulePreparationHistory(
      { stateDir: join(root, "state"), venueDir: join(root, "venue") },
      binding.module,
    ),
  ).toEqual([
    expect.objectContaining({ entries: [], dormant: [expect.objectContaining({ bases })] }),
  ]);
  await compare(s);
  const selected = (await s.prepareWithDormantSetup(
    binding,
    credentials,
    context,
    {
      action: "select",
      comparisonId,
    },
    { onBox: true },
  )) as { input: unknown };
  expect(selected).toMatchObject({ status: "selected", identity: "0CNQR", bases });
  expect(await rows()).toEqual(before);
  expect(await promote(s, selected.input)).toMatchObject({ alreadyPrimary: false });
  const after = await rows();
  expect(after.allocations).toHaveLength(2);
  expect(after.series.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.series);
  expect(
    after.series
      .filter((row) => row.nodeId === standby.nodeId)
      .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
  ).toEqual(bases.map((base) => ({ ...base, code: `${base.code}-0CNQR`, nextNumber: 1 })));
  expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("primary");
  expect((await readNodeMode(suite.node, standby.nodeId)).singletonRole).toBe("primary");
  expect(await promote(s, selected.input)).toMatchObject({ alreadyPrimary: true });
  expect(await rows()).toEqual(after);
  expect(
    await readFile(join(root, "state/module-records/fiscal-verifactu.json"), "utf8"),
  ).not.toContain(PASSWORD);
});

it.each(["key", "isolation", "parallel", "source", "node"])(
  "refuses changed %s before selection writes",
  async (fault) => {
    const s = await service();
    await admit(s);
    const held = {
      ...binding,
      ...(fault === "source" ? { sourceId: "changed" } : {}),
      ...(fault === "node" ? { targetNodeId: primary.nodeId } : {}),
    };
    const before = await readFile(join(root, "state/module-records/fiscal-verifactu.json"), "utf8");
    await expect(
      s.prepare(
        held,
        { breakGlass: fault === "key" ? WRONG_MASTER_KEY : key.secret },
        {
          ...context,
          ...(fault === "isolation" ? { oldNodeNeutralised: false } : {}),
          ...(fault === "parallel" ? { noParallelRecovery: false } : {}),
        },
        { action: "clock-challenge" },
        { onBox: true },
      ),
    ).rejects.toMatchObject({
      code:
        fault === "key"
          ? "promotion.break_glass_invalid"
          : fault === "node"
            ? "module.operation_invalid"
            : fault === "isolation"
              ? "promotion.fence_not_attested"
              : fault === "parallel"
                ? "module.operation_invalid"
                : "sif.allocation_invalid",
    });
    expect(await readFile(join(root, "state/module-records/fiscal-verifactu.json"), "utf8")).toBe(
      before,
    );
  },
);

it("retains the selected hour across restart but discards transient comparison authority", async () => {
  const first = await service();
  await admit(first);
  await compare(first);
  const selected = (await first.prepareWithDormantSetup(
    binding,
    credentials,
    context,
    {
      action: "select",
      comparisonId,
    },
    { onBox: true },
  )) as { input: unknown };
  const next = await service();
  await expect(promote(next, selected.input)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await compare(next);
  expect(
    await next.prepareWithDormantSetup(
      binding,
      credentials,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).toEqual(selected);
  await promote(next, selected.input);
  expect((await rows()).allocations).toHaveLength(2);
});

it.each(["standard", "full", "corrective", "full_corrective"])(
  "refuses a second %s prefix before dormant admission or hour selection",
  async (purpose) => {
    await suite.db.insert(invoiceSeries).values({
      nodeId: primary.nodeId,
      code: "a/B_1.2-3-0CNNW",
      purpose,
    });
    const s = await service();
    const before = await rows();
    await expect(admit(s)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "series_configuration_unsupported" },
    });
    expect(await rows()).toEqual(before);
    expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("mirror");
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        binding.module,
      ),
    ).toEqual([]);
  },
);

it("a promotion beside a leftover start-again note file is not held back by the file's floor", async () => {
  const stateDir = join(root, "state");
  const s = await service();
  await admit(s);
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "first-setup-start-again.json"),
    JSON.stringify({
      version: 1,
      floorMs: Date.now() + 10 * 60_000,
      lastName: "0CNQT",
      module: binding.module,
    }),
  );
  const recovery = binding;
  const auth = credentials;
  await compare(s, auth, recovery);
  expect(
    await s.prepareWithDormantSetup(
      recovery,
      auth,
      context,
      { action: "select", comparisonId },
      { onBox: true },
    ),
  ).toMatchObject({ status: "selected" });
});

it("a promotion takes its current minute although a later installation name is recorded", async () => {
  const s = await service();
  await admit(s);
  const [live] = await suite.db.select().from(verifactuIdentities);
  await suite.db.insert(verifactuIdentities).values({
    nodeId: primary.nodeId,
    nif: live!.nif,
    idSistemaInformatico: live!.idSistemaInformatico,
    numeroInstalacion: encodeMinuteIdentity(Date.now() + 10 * 60_000),
    registradoEn: new Date(Date.now() - 60 * 60_000),
    revocadoEn: new Date(Date.now() - 30 * 60_000),
  });
  await compare(s);
  expect(
    await s.prepareWithDormantSetup(
      binding,
      credentials,
      context,
      { action: "select", comparisonId },
      { onBox: true },
    ),
  ).toMatchObject({ status: "selected", identity: encodeMinuteIdentity(Date.now()) });
});

it("a key-only operation service refuses administrator credentials without a credential key ring", async () => {
  const s = createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    nodeDb: suite.node,
    node: standby,
    modules: ALL_MODULES,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
  const before = await rows();
  await expect(
    s.withOperation(
      { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
      credentials,
      {},
      async () => "unexpected-activation",
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await rows()).toEqual(before);
});

it("invalidates an earlier comparison when the named recovery key changes", async () => {
  const s = await service();
  await admit(s);
  await compare(s);
  key = await mintMasterKey(suite.db);
  await expect(
    s.prepareWithDormantSetup(
      binding,
      credentials,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } });
  await compare(s);
  expect(
    await s.prepareWithDormantSetup(
      binding,
      credentials,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).toMatchObject({ identity: "0CNQR" });
});

it("establishes the real reserved node and identity while keeping its fiscal state dormant", async () => {
  const identity = generateStandbyIdentity();
  const target = { nodeId: brandNodeId(identity.nodeId) };
  const held = { ...joinBinding, targetNodeId: target.nodeId };
  const options = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    node: target,
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  };
  const reserving = createNodeOperationPreparation({
    ...options,
    db: suite.db,
    nodeDb: suite.node,
  });
  let state: unknown;
  await reserving.withOperation(
    { binding: held, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    (modules, operations) =>
      withPreparedModuleOperations(modules, operations, target.nodeId, "reserve", (ready) =>
        withTransaction(suite.db, async (tx) => {
          state = (
            await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, target, ready.get(binding.module))
          ).state;
        }),
      ),
  );
  const primaryKeys = generateNodeKeyPair();
  await spare.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Promotion SL" });
  await seedVenueSettings(spare.db, {});
  await seedBusinessDay(spare.db, {});
  await spare.db.insert(nodes).values({
    id: primary.nodeId,
    name: "Original",
    publicKey: primaryKeys.publicKey,
    filingModule: "verifactu",
    taxModule: "vat",
  });
  await seedPersons(spare.db, {
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: hash,
  });
  await stampDeployment(spare.db, "preproduction");
  await withTransaction(spare.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: primary.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: "0CNNW",
    }),
  );
  await spare.db.insert(invoiceSeries).values(
    bases.map((base) => ({
      ...base,
      nodeId: primary.nodeId,
      code: `${base.code}-0CNNW`,
    })),
  );
  await advanceSeriesTo(spare.db, primary.nodeId, 123);
  const baseline = {
    series: await spare.db.select(seriesWithNextNumber).from(invoiceSeries),
    sif: await spare.db.select().from(verifactuIdentities),
  };
  const s = createNodeOperationPreparation({ ...options, db: spare.db, nodeDb: spare.node });
  const operation = { binding: { ...held, action: "establish" }, input: state };
  const endorsement = endorseKey(
    identity.nodeId,
    identity.publicKey,
    primary.nodeId,
    primaryKeys.privateKey,
  );
  const establish = () =>
    s.withOperation(operation, credentials, {}, (modules, moduleOperations) =>
      establishReservedStandbyIdentity(
        { ownerDb: spare.db },
        {
          standby: identity,
          nodeName: "New spare",
          filingModule: "verifactu",
          taxModule: "vat",
          modules,
          moduleOperations,
          reserved: { modules: { [binding.module]: state }, series: [], endorsement },
        },
      ),
    );
  await establish();
  expect(await spare.db.select().from(nodes).where(eq(nodes.id, target.nodeId))).toEqual([
    expect.objectContaining({ id: target.nodeId, publicKey: identity.publicKey, endorsement }),
  ]);
  expect(await spare.db.select(seriesWithNextNumber).from(invoiceSeries)).toEqual(baseline.series);
  expect(await spare.db.select().from(verifactuIdentities)).toEqual(baseline.sif);
  expect(await allocationRows(spare.db)).toEqual([]);
  const saved = await readModulePreparationHistory(options, binding.module);
  expect(saved).toEqual([{ version: 1, entries: [], dormant: [state] }]);
  await establish();
  expect(await readModulePreparationHistory(options, binding.module)).toEqual(saved);
  expect(await spare.db.select(seriesWithNextNumber).from(invoiceSeries)).toEqual(baseline.series);
});

it("refuses promotion preparation without retained dormant admission", async () => {
  const s = await service();
  const before = await rows();
  await expect(
    s.prepare(binding, credentials, context, { action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  expect(await rows()).toEqual(before);
  expect(
    await readModulePreparationHistory(
      { stateDir: join(root, "state"), venueDir: join(root, "venue") },
      binding.module,
    ),
  ).toEqual([]);
});

it.each(["identity", "allocation-id", "bases", "purpose", "approval", "binding"])(
  "refuses altered selected %s before promotion commits",
  async (fault) => {
    const s = await service();
    await admit(s);
    await compare(s);
    const selected = (await s.prepareWithDormantSetup(
      binding,
      credentials,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    )) as {
      input: {
        allocation: {
          installationIdentity: string;
          allocationId: string;
          series: { code: string; purpose: string }[];
        };
        approval: { oldMachineOffline: boolean };
      };
    };
    const input = structuredClone(selected.input);
    if (fault === "identity") input.allocation.installationIdentity = "0CNSM";
    if (fault === "allocation-id") input.allocation.allocationId = "changed-allocation";
    if (fault === "bases") input.allocation.series.pop();
    if (fault === "purpose") input.allocation.series[0]!.purpose = "full";
    if (fault === "approval") input.approval.oldMachineOffline = false;
    const before = await rows();
    await expect(
      fault === "binding"
        ? s.withPromotion(
            { binding: { ...binding, eventId: "other" }, input },
            credentials,
            context,
            (modules, runner) =>
              promoteMirrorToPrimary(
                {
                  db: suite.db,
                  node: suite.node,
                  nodeId: standby.nodeId,
                  ring,
                  modules,
                  holders: createDeploymentHolders("mirror", "secondary"),
                  log: () => {},
                  withModuleOperations: runner,
                },
                { oldNodeNeutralised: true },
              ),
          )
        : promote(s, input),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await rows()).toEqual(before);
    expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("mirror");
  },
);

it.each(["module", "operation-action", "prepare-action", "promotion-action"])(
  "refuses an unbound %s request before preparation writes",
  async (fault) => {
    const s = await service();
    const operation = { binding: { ...binding, action: "setup" }, input: {} };
    await expect(
      fault === "module"
        ? s.prepareWithDormantSetup(
            { ...binding, module: "unknown" },
            credentials,
            context,
            {
              action: "clock-challenge",
            },
            { onBox: true },
          )
        : fault === "operation-action"
          ? s.withOperation(operation, credentials, context, async () => "unexpected")
          : fault === "prepare-action"
            ? s.prepareWithDormantSetup(joinBinding, credentials, context, {}, { onBox: true })
            : s.withPromotion(
                { ...operation, binding: joinBinding },
                credentials,
                context,
                async () => "unexpected",
              ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        binding.module,
      ),
    ).toEqual([]);
  },
);

it.each(["database", "node"])(
  "refuses a promotion runner used with a different %s",
  async (fault) => {
    const s = await service();
    await expect(
      s.withPromotion({ binding, input: {} }, credentials, context, async (_modules, runner) =>
        runner(
          {
            db: fault === "database" ? spare.db : suite.db,
            nodeDb: fault === "database" ? spare.node : suite.node,
            node: fault === "node" ? primary : standby,
          },
          async () => "unexpected",
        ),
      ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
  },
);

it("refuses a configured preparation module after its authenticated call ends", async () => {
  const s = await service();
  const configured = await s.withOperation(
    { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    async (modules) => modules,
  );
  await expect(
    withOperationAuthority(
      binding,
      { kind: "recovery-key", nodeId: standby.nodeId, eventId: binding.eventId },
      (authority) =>
        configured[0]!.operations!.recovery!(
          { binding, authority },
          { action: "clock-challenge" },
          { onBox: true },
        ),
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses an operation contribution with no recovery preparation", async () => {
  const modules = ALL_MODULES.filter((module) => module.name === binding.module).map((module) => ({
    ...module,
    operations: {
      async prepare<T>(
        operation: import("@waitron/module").ModuleOperationInput,
        run: (ready: import("@waitron/module").ModuleOperationInput) => Promise<T>,
      ) {
        return run(operation);
      },
    },
  }));
  const s = await service(modules);
  await expect(compare(s)).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses a recovery module that cannot read the current database state", async () => {
  const modules = ALL_MODULES.filter((module) => module.name === binding.module).map((module) => ({
    ...module,
    operations: { ...module.operations!, readRecoveryState: undefined },
  }));
  const s = await service(modules);
  await expect(compare(s)).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses a recovery key rotated while a comparison is in flight", async () => {
  const s = await service();
  await admit(s);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  external.internet.mockImplementationOnce(async () => {
    entered();
    await gate;
    return { source: "internet", result: "unavailable", reason: "offline" };
  });
  const before = await readFile(join(root, "state/module-records/fiscal-verifactu.json"), "utf8");
  const pending = compare(s, { breakGlass: key.secret });
  await started;
  key = await mintMasterKey(suite.db);
  const refused = expect(pending).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  release();
  await refused;
  expect(await readFile(join(root, "state/module-records/fiscal-verifactu.json"), "utf8")).toBe(
    before,
  );
});
