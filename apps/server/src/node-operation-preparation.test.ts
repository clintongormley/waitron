import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_MIGRATIONS, stampDeployment, withNodeTransaction } from "@waitron/db";
import * as db from "@waitron/db";
import { setNodeModeTx, NODE_MIGRATIONS } from "@waitron/node-db";
import * as provisioning from "@waitron/provisioning";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import type { ModuleOperationHost, ModuleOperationPreparation } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { nodeId } from "@waitron/shared";
import type { ClockSetAnswer, ClockSetInput } from "./clock-correction.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintMasterKey } from "./testing/master-key.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const node = {
  nodeId: nodeId("c0000000-0000-4000-8000-000000000002"),
};
const promote = {
  module: "test-regime",
  action: "promote",
  eventId: "event-1",
  sourceId: "promotion-1",
  targetNodeId: node.nodeId,
};
let secret: string;
let keyName: string;
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const PASSWORD = "synthetic-clock-password";
let root: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "node-operation-preparation-"));
  await stampDeployment(suite.db, "preproduction");
  ({ secret, name: keyName } = await mintMasterKey(suite.db));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

function service(
  hooks: {
    readState?(): Promise<void>;
    facts?(): void;
    beforeFacts?(): Promise<void>;
    clockCorrection?: Parameters<typeof createNodeOperationPreparation>[0]["clockCorrection"];
    signIn?: boolean;
  } = {},
) {
  let host: ModuleOperationHost;
  const configured: ModuleOperationPreparation = {
    liveRecoveryActions: ["conflict-switch"],
    prepare: async (operation, run) => run(operation),
    recovery: async (operation, proposal) =>
      host.withPreparationState!(operation.binding, async () => {
        if (proposal === "set-clock")
          return host.setBoxClock!(operation.binding, {
            offsetMs: 45_000,
            agreesWithinMs: 12_345,
            measuredAt: { wallMs: Date.now(), monoMs: performance.now() },
            reading: { boxAt: "2026-10-16T12:40:00.000Z", witnessAt: "", uncertaintyMs: 0 },
          });
        await hooks.beforeFacts?.();
        const facts = await host.readRecoveryFacts!(operation.binding);
        hooks.facts?.();
        return facts;
      }),
    readRecoveryState: async () => {
      await hooks.readState?.();
      return {
        country: "ES",
        taxId: "B12345678",
        environment: "preproduction",
        bases: [{ code: "A", purpose: "standard" }],
        history: [],
        priorActivation: "none",
      };
    },
  };
  const module = fakeModule("test-regime", {
    operations: {
      ...configured,
      configure(value) {
        host = value;
        return configured;
      },
    },
  });
  return createNodeOperationPreparation({
    db: suite.db,
    nodeDb: suite.node,
    node,
    modules: [module],
    stateDir: join(root!, "state"),
    venueDir: join(root!, "venue"),
    coordinator: createFirstSetupCoordinator(),
    environment: {},
    isLiveWritable: () => true,
    ...(hooks.clockCorrection === undefined ? {} : { clockCorrection: hooks.clockCorrection }),
    ...(hooks.signIn === true ? { credentialKeyRing: TOTP_KEY_RING } : {}),
  });
}

const prepare = (context: Record<string, unknown>) =>
  service().prepare(
    promote,
    { breakGlass: secret },
    { oldNodeNeutralised: true, noParallelRecovery: true, ...context },
    {},
    { onBox: false },
  );

it("hands a mirror's promotion that says the old box relinquished to the module as relinquished, not offline, without the live-box check", async () => {
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, node.nodeId, "mirror", "adopt"));
  expect(await prepare({ oldMachineRelinquished: true })).toMatchObject({
    oldMachineOffline: false,
    oldMachineRelinquished: true,
    noParallelRecovery: true,
  });
});

it("hands a promotion that does not mention relinquishment to the module as offline and not relinquished", async () => {
  expect(await prepare({})).toMatchObject({
    oldMachineOffline: true,
    oldMachineRelinquished: false,
  });
});

it("refuses to set the clock under the recovery key, which names no person, and never asks the setter", async () => {
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, node.nodeId, "mirror", "adopt"));
  const set = vi.fn();
  const answer = await service({ clockCorrection: { set, steps: () => 0 } }).prepare(
    promote,
    { breakGlass: secret },
    { oldNodeNeutralised: true, noParallelRecovery: true },
    "set-clock",
    { onBox: false },
  );
  expect(answer).toEqual({ status: "refused", reason: "not_admitted" });
  expect(set).not.toHaveBeenCalled();
});

it("hands boot's setter the agreement limit the module sent, as the signed-in person", async () => {
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, node.nodeId, "mirror", "adopt"));
  await seedPersons(suite.db, {
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: hashPassword(PASSWORD),
  });
  const set = vi.fn<(input: ClockSetInput) => Promise<ClockSetAnswer>>(async () => ({
    set: true,
    confirmationId: null,
    stepMs: 45_000,
    confirmedAt: new Date().toISOString(),
  }));
  const answer = await service({
    clockCorrection: { set, steps: () => 3 },
    signIn: true,
  }).prepare(
    promote,
    { personId: ADMIN, password: PASSWORD },
    { oldNodeNeutralised: true, noParallelRecovery: true },
    "set-clock",
    { onBox: false },
  );
  expect(answer).toEqual({ status: "set" });
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: "start",
      source: "admin",
      stepsSeen: 3,
      agreesWithinMs: 12_345,
      requester: { source: "admin", person: ADMIN },
    }),
  );
});

it("refuses a promotion whose relinquishment answer is not a boolean", async () => {
  await expect(prepare({ oldMachineRelinquished: "yes" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
});

it("hands a conflict switch to the module with its isolation answers and not relinquished", async () => {
  const binding = { ...promote, action: "conflict-switch", sourceId: "conflict-1" };
  const result = await service().withLiveRecovery(
    binding,
    secret,
    { oldMachineOffline: false, noParallelRecovery: false },
    (scope) =>
      scope.operations.recovery!({ binding, authority: scope.authority }, {}, { onBox: false }),
  );
  expect(result).toMatchObject({
    oldMachineOffline: false,
    noParallelRecovery: false,
    oldMachineRelinquished: false,
  });
});

it.each([
  {
    scenario: "refuses rotation after the history read",
    rotateAfter: "history",
    steps: ["history"],
  },
  {
    scenario: "refuses rotation after the state read",
    rotateAfter: "state",
    steps: ["history", "state"],
  },
  {
    scenario: "refuses rotation after the key read",
    rotateAfter: "key",
    steps: ["history", "state", "key"],
  },
  {
    scenario: "accepts an unchanged key",
    rotateAfter: "none",
    steps: ["history", "state", "key", "delivered"],
  },
])("live preparation: $scenario", async ({ rotateAfter, steps }) => {
  const seen: string[] = [];
  const afterRead = async (step: string) => {
    seen.push(step);
    if (rotateAfter === step) {
      await mintMasterKey(suite.db);
    }
  };
  const readHistory = provisioning.readModulePreparationHistory;
  vi.spyOn(provisioning, "readModulePreparationHistory").mockImplementation(async (...args) => {
    const result = await readHistory(...args);
    await afterRead("history");
    return result;
  });
  // After the state read, the first master-key read is the re-check and the second supplies the
  // context key's name.
  const readKey = db.readCurrentMasterKey;
  let readsAfterState = 0;
  vi.spyOn(db, "readCurrentMasterKey").mockImplementation(async (...args) => {
    const result = await readKey(...args);
    if (seen.at(-1) === "state" && ++readsAfterState === 2) await afterRead("key");
    return result;
  });
  const preparation = service({
    readState: () => afterRead("state"),
    facts: () => seen.push("delivered"),
  });
  const binding = { ...promote, action: "conflict-switch", sourceId: "conflict-1" };
  const result = preparation.withLiveRecovery(
    binding,
    secret,
    { oldMachineOffline: false, noParallelRecovery: false },
    (scope) =>
      scope.operations.recovery!({ binding, authority: scope.authority }, {}, { onBox: false }),
  );

  if (rotateAfter === "none") {
    await expect(result).resolves.toMatchObject({
      contextKey: expect.stringContaining(keyName),
    });
  } else {
    await expect(result).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    await expect(result).rejects.toHaveProperty("params", {});
  }
  expect(seen).toEqual(steps);
});

it("a new master key made between preparation and run refuses the run", async () => {
  const delivered = vi.fn();
  const preparation = service({
    beforeFacts: async () => {
      await mintMasterKey(suite.db);
    },
    facts: delivered,
  });
  const result = preparation.prepare(
    promote,
    { breakGlass: secret },
    { oldNodeNeutralised: true, noParallelRecovery: true },
    {},
    { onBox: false },
  );
  await expect(result).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(delivered).not.toHaveBeenCalled();
});

it.each([
  ["fiscal-verifactu", true],
  ["fiscal-none", false],
])("says whether %s can prepare a promotion, from the module as configured", (name, expected) => {
  const module = ALL_MODULES.find((candidate) => candidate.name === name)!;
  const preparation = createNodeOperationPreparation({
    db: suite.db,
    nodeDb: suite.node,
    node,
    modules: [module],
    stateDir: join(root!, "state"),
    venueDir: join(root!, "venue"),
    coordinator: createFirstSetupCoordinator(),
    environment: {},
    isLiveWritable: () => true,
  });
  expect(preparation.hasRecoveryOperation).toBe(expected);
});
