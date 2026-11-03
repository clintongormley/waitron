import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_MIGRATIONS, stampDeployment, withNodeTransaction } from "@waitron/db";
import { setNodeModeTx, setRecoveryKeyTx, NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret } from "@waitron/identity";
import type { ModuleOperationHost, ModuleOperationPreparation } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { locationId, nodeId } from "@waitron/shared";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const node = {
  nodeId: nodeId("c0000000-0000-4000-8000-000000000002"),
  locationId: locationId("c0000000-0000-4000-8000-000000000001"),
};
const promote = {
  module: "test-regime",
  action: "promote",
  eventId: "event-1",
  sourceId: "promotion-1",
  targetNodeId: node.nodeId,
};
const secret = "paper-key";
let root: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "node-operation-preparation-"));
  await stampDeployment(suite.db, "preproduction");
  await withNodeTransaction(suite.node, (tx) =>
    setRecoveryKeyTx(tx, node.nodeId, hashSecret(secret), "paper-1"),
  );
});
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

function service() {
  let host: ModuleOperationHost;
  const configured: ModuleOperationPreparation = {
    liveRecoveryActions: ["conflict-switch"],
    prepare: async (operation, run) => run(operation),
    recovery: async (operation) =>
      host.withPreparationState!(operation.binding, async () =>
        host.readRecoveryFacts!(operation.binding),
      ),
    readRecoveryState: async () => ({
      country: "ES",
      taxId: "B12345678",
      environment: "preproduction",
      bases: [{ code: "A", purpose: "standard" }],
      history: [],
      priorActivation: "none",
    }),
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
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, node.nodeId, "mirror"));
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
