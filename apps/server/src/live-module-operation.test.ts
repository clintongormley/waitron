import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  setBreakGlassVerifierTx,
  setSingletonRoleTx,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret } from "@waitron/identity";
import {
  readOperationAuthority,
  type ModuleOperationHost,
  type ModuleOperationPreparation,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { locationId, nodeId } from "@waitron/shared";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const node = {
  nodeId: nodeId("c0000000-0000-4000-8000-000000000002"),
  locationId: locationId("c0000000-0000-4000-8000-000000000001"),
};
const binding = {
  module: "test-regime",
  action: "conflict-switch",
  eventId: "event-1",
  sourceId: "conflict-1",
  targetNodeId: node.nodeId,
};
const isolation = { oldMachineOffline: true, noParallelRecovery: true };
const secret = "paper-key";
const verifier = hashSecret(secret);
let root: string | undefined;
let writable = true;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "live-module-operation-"));
  await stampDeployment(suite.db, "preproduction");
  await withTransaction(suite.db, (tx) =>
    setBreakGlassVerifierTx(tx, node.nodeId, verifier, "paper-1"),
  );
  writable = true;
});
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

function service(reader?: () => Promise<void>, modules?: readonly WaitronModule[]) {
  let host: ModuleOperationHost;
  const configured: ModuleOperationPreparation = {
    liveRecoveryActions: ["conflict-switch"],
    prepare: async (operation, run) => run(operation),
    recovery: async (operation) =>
      host.withPreparationState!(operation.binding, async () =>
        host.readRecoveryFacts!(operation.binding),
      ),
    readRecoveryState: async () => {
      await reader?.();
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
    node,
    modules: modules ?? [module],
    stateDir: join(root!, "state"),
    venueDir: join(root!, "venue"),
    coordinator: createFirstSetupCoordinator(),
    environment: {},
    isLiveWritable: () => writable,
  });
}

it("provides configured live recovery with key-only authority and the actual isolation answers", async () => {
  const s = service();
  const result = await s.withLiveRecovery(
    binding,
    secret,
    { oldMachineOffline: false, noParallelRecovery: false },
    async (scope) => {
      expect(scope.node).toEqual(node);
      expect(readOperationAuthority(scope.authority, binding)).toEqual({
        operatorId: {
          kind: "recovery-key",
          nodeId: "c0000000-0000-4000-8000-000000000002",
          eventId: "event-1",
        },
      });
      return scope.operations.recovery!(
        { binding, authority: scope.authority },
        {},
        { onBox: false },
      );
    },
  );
  expect(result).toMatchObject({
    oldMachineOffline: false,
    oldMachineAbsent: false,
    noParallelRecovery: false,
  });
});

it.each([
  "unknown-module",
  "unknown-action",
  "wrong-node",
  "disabled",
  "password",
  "wrong-key",
  "read-only",
])("refuses %s before the live body runs", async (reason) => {
  const s = service(undefined, reason === "disabled" ? [] : undefined);
  const altered = { ...binding };
  if (reason === "unknown-module") altered.module = "other";
  if (reason === "unknown-action") altered.action = "promote";
  if (reason === "wrong-node")
    altered.targetNodeId = nodeId("c0000000-0000-4000-8000-000000000003");
  if (reason === "read-only") writable = false;
  let entered = false;
  await expect(
    s.withLiveRecovery(
      altered,
      reason === "password"
        ? { personId: "admin", password: secret }
        : reason === "wrong-key"
          ? "wrong"
          : secret,
      isolation,
      async () => {
        entered = true;
      },
    ),
  ).rejects.toMatchObject({
    code: ["password", "wrong-key"].includes(reason)
      ? "promotion.break_glass_invalid"
      : reason === "read-only"
        ? "node.read_only"
        : "module.operation_invalid",
  });
  expect(entered).toBe(false);
});

it.each(["key", "role", "writable"])(
  "rechecks %s after an awaited preparation read",
  async (changed) => {
    const s = service(async () => {
      if (changed === "key")
        await withTransaction(suite.db, (tx) =>
          setBreakGlassVerifierTx(tx, node.nodeId, hashSecret("new-key"), "paper-2"),
        );
      if (changed === "role")
        await withTransaction(suite.db, (tx) => setSingletonRoleTx(tx, node.nodeId, "secondary"));
      if (changed === "writable") writable = false;
    });
    await expect(
      s.withLiveRecovery(binding, secret, isolation, (scope) =>
        scope.operations.recovery!({ binding, authority: scope.authority }, {}, { onBox: false }),
      ),
    ).rejects.toMatchObject({
      code: changed === "key" ? "promotion.break_glass_invalid" : "node.read_only",
    });
  },
);

it.each(["key", "role", "writable"])(
  "rechecks %s inside the committing transaction",
  async (changed) => {
    const s = service();
    let entered = false;
    await expect(
      s.withLiveRecovery(binding, secret, isolation, async (scope) => {
        if (changed === "key")
          await withTransaction(suite.db, (tx) =>
            setBreakGlassVerifierTx(tx, node.nodeId, hashSecret("new-key"), "paper-2"),
          );
        if (changed === "role")
          await withTransaction(suite.db, (tx) => setSingletonRoleTx(tx, node.nodeId, "secondary"));
        if (changed === "writable") writable = false;
        return scope.commit(async () => {
          entered = true;
        });
      }),
    ).rejects.toMatchObject({
      code: changed === "key" ? "promotion.break_glass_invalid" : "node.read_only",
    });
    expect(entered).toBe(false);
  },
);

it("revokes an escaped scope and snapshots caller binding and isolation before awaits", async () => {
  const s = service();
  let escaped: ((body: (tx: Transaction) => Promise<void>) => Promise<void>) | undefined;
  const supplied = { ...binding };
  const answers = { ...isolation };
  await s.withLiveRecovery(supplied, secret, answers, async (scope) => {
    supplied.sourceId = "changed";
    answers.oldMachineOffline = false;
    expect(scope.binding).toEqual(binding);
    expect(
      await scope.operations.recovery!(
        { binding, authority: scope.authority },
        {},
        { onBox: false },
      ),
    ).toMatchObject(isolation);
    await scope.commit(async () => undefined);
    escaped = scope.commit;
  });
  await expect(escaped!(async () => undefined)).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
});
