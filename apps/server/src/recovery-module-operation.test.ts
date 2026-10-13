import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withTransaction,
  invoiceSeries,
  locations,
  nodes,
  tenants,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { readOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { locationId, nodeId } from "@waitron/shared";
import { withRecoveryModuleOperation } from "./recovery-module-operation.js";
import { mintBreakGlassSecret } from "./break-glass.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const target = {
  locationId: locationId("c0000000-0000-4000-8000-000000000001"),
  nodeId: nodeId("c0000000-0000-4000-8000-000000000002"),
};
const ADMIN = "c0000000-0000-4000-8000-000000000003";
const PASSWORD = "correct horse";
const HASH = hashPassword(PASSWORD);
const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-1",
  sourceId: "archive-1",
  targetNodeId: target.nodeId,
};
const input = { allocation: { opaque: true }, approval: { operatorId: "submitted" } };

beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Restaurant" });
  await suite.db.insert(locations).values({
    id: target.locationId,
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db
    .insert(nodes)
    .values({ id: target.nodeId, locationId: target.locationId, name: "Restored node" });
  await suite.db.insert(invoiceSeries).values([
    { nodeId: target.nodeId, code: "A", purpose: "standard" },
    { nodeId: target.nodeId, code: "FF", purpose: "full" },
    { nodeId: target.nodeId, code: "R", purpose: "rectificative" },
  ]);
  await suite.db
    .insert(persons)
    .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH });
});

function module(prepare: import("@waitron/module").ModuleOperationPreparation["prepare"]) {
  return fakeModule(binding.module, { operations: { prepare } });
}

it("collects for the real node key before opening the host transaction", async () => {
  const secret = await mintBreakGlassSecret(suite.db, target.nodeId);
  const owner = module(async (operation, run) => {
    expect(readOperationAuthority(operation.authority, operation.binding)).toEqual({
      operatorId: { kind: "recovery-key", nodeId: target.nodeId, eventId: binding.eventId },
    });
    await withTransaction(suite.db, (tx) => tx.update(locations).set({ name: "outside-write" }));
    return run({ ...operation, input: "collected-current" });
  });
  let captured!: ModuleOperationInput;
  const result = await withRecoveryModuleOperation(
    { db: suite.db, node: target, modules: [owner] },
    { binding, input, secret },
    async (tx, ready) => {
      captured = ready.get(binding.module)!;
      expect(captured.input).toBe("collected-current");
      expect((await tx.select().from(locations))[0]?.name).toBe("outside-write");
      await tx.update(locations).set({ name: "committed-recovery" });
      return "restored";
    },
  );
  expect(result).toBe("restored");
  expect((await suite.db.select().from(locations))[0]?.name).toBe("committed-recovery");
  expect(readOperationAuthority(captured.authority, binding)).toBeUndefined();
});

it("does not consult outside evidence for a wrong recovery key", async () => {
  await mintBreakGlassSecret(suite.db, target.nodeId);
  let consulted = false;
  const owner = module(async (operation, run) => {
    consulted = true;
    return run(operation);
  });
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, node: target, modules: [owner] },
      { binding, input, secret: "wrong-key" },
      async () => "unexpected",
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(consulted).toBe(false);
});

it("refuses a key replaced while the outside source is being collected", async () => {
  const secret = await mintBreakGlassSecret(suite.db, target.nodeId);
  let replacement = "";
  const owner = module(async (operation, run) => {
    replacement = await mintBreakGlassSecret(suite.db, target.nodeId);
    return run(operation);
  });
  let entered = false;
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, node: target, modules: [owner] },
      { binding, input, secret },
      async (tx) => {
        entered = true;
        await tx.update(locations).set({ name: "unexpected" });
      },
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(entered).toBe(false);
  expect(replacement).not.toBe(secret);
  expect((await suite.db.select().from(locations))[0]?.name).toBe("Restaurant");
});

it("keeps outside work and rolls back a refused host write", async () => {
  const secret = await mintBreakGlassSecret(suite.db, target.nodeId);
  const owner = module(async (operation, run) => {
    await withTransaction(suite.db, (tx) => tx.update(locations).set({ name: "outside-retained" }));
    return run(operation);
  });
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, node: target, modules: [owner] },
      { binding, input, secret },
      async (tx) => {
        await tx.update(locations).set({ name: "rolled-back" });
        throw new Error("later-write-refused");
      },
    ),
  ).rejects.toThrow("later-write-refused");
  expect((await suite.db.select().from(locations))[0]?.name).toBe("outside-retained");
});

it("passes only the declared operation scope to an outside source", async () => {
  const secret = await mintBreakGlassSecret(suite.db, target.nodeId);
  let fields: string[] = [];
  const owner = module(async (operation, run) => {
    fields = Object.keys(operation.binding).sort();
    return run(operation);
  });
  const supplied = { ...binding, password: "synthetic-extra-field" };
  await withRecoveryModuleOperation(
    { db: suite.db, node: target, modules: [owner] },
    { binding: supplied, input, secret },
    async () => "done",
  );
  expect(fields).toEqual(["action", "eventId", "module", "sourceId", "targetNodeId"]);
});
