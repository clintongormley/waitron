import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { readVenue } from "@waitron/db";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
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
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword } from "@waitron/identity";
import { readOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { nodeId } from "@waitron/shared";
import { withRecoveryModuleOperation } from "./recovery-module-operation.js";
import { mintBreakGlassSecret } from "./break-glass.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const target = {
  locationId: "c0000000-0000-4000-8000-000000000001",
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
  });
  await seedVenueSettings(suite.db, {
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await seedBusinessDay(suite.db, {});
  await suite.db.insert(nodes).values({ id: target.nodeId, name: "Restored node" });
  await suite.db.insert(invoiceSeries).values([
    { nodeId: target.nodeId, code: "A", purpose: "standard" },
    { nodeId: target.nodeId, code: "FF", purpose: "full" },
    { nodeId: target.nodeId, code: "R", purpose: "rectificative" },
  ]);
  await seedPersons(suite.db, {
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: HASH,
  });
});

function module(prepare: import("@waitron/module").ModuleOperationPreparation["prepare"]) {
  return fakeModule(binding.module, { operations: { prepare } });
}

it("collects for the real node key before opening the host transaction", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
  const owner = module(async (operation, run) => {
    expect(readOperationAuthority(operation.authority, operation.binding)).toEqual({
      operatorId: { kind: "recovery-key", nodeId: target.nodeId, eventId: binding.eventId },
    });
    await withTransaction(suite.db, (tx) => seedVenueSettings(tx, { name: "outside-write" }));
    return run({ ...operation, input: "collected-current" });
  });
  let captured!: ModuleOperationInput;
  const result = await withRecoveryModuleOperation(
    { db: suite.db, nodeDb: suite.node, node: target, modules: [owner] },
    { binding, input, secret },
    async (tx, ready) => {
      captured = ready.get(binding.module)!;
      expect(captured.input).toBe("collected-current");
      expect((await readVenue(tx)).name).toBe("outside-write");
      await seedVenueSettings(tx, { name: "committed-recovery" });
      return "restored";
    },
  );
  expect(result).toBe("restored");
  expect((await readVenue(suite.db)).name).toBe("committed-recovery");
  expect(readOperationAuthority(captured.authority, binding)).toBeUndefined();
});

it("does not consult outside evidence for a wrong recovery key", async () => {
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
  let consulted = false;
  const owner = module(async (operation, run) => {
    consulted = true;
    return run(operation);
  });
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, nodeDb: suite.node, node: target, modules: [owner] },
      { binding, input, secret: "wrong-key" },
      async () => "unexpected",
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(consulted).toBe(false);
});

it("refuses a key replaced while the outside source is being collected", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
  let replacement = "";
  const owner = module(async (operation, run) => {
    replacement = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
    return run(operation);
  });
  let entered = false;
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, nodeDb: suite.node, node: target, modules: [owner] },
      { binding, input, secret },
      async (tx) => {
        entered = true;
        await seedVenueSettings(tx, { name: "unexpected" });
      },
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(entered).toBe(false);
  expect(replacement).not.toBe(secret);
  expect((await readVenue(suite.db)).name).toBe("Restaurant");
});

it("keeps outside work and rolls back a refused host write", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
  const owner = module(async (operation, run) => {
    await withTransaction(suite.db, (tx) => seedVenueSettings(tx, { name: "outside-retained" }));
    return run(operation);
  });
  await expect(
    withRecoveryModuleOperation(
      { db: suite.db, nodeDb: suite.node, node: target, modules: [owner] },
      { binding, input, secret },
      async (tx) => {
        await seedVenueSettings(tx, { name: "rolled-back" });
        throw new Error("later-write-refused");
      },
    ),
  ).rejects.toThrow("later-write-refused");
  expect((await readVenue(suite.db)).name).toBe("outside-retained");
});

it("passes only the declared operation scope to an outside source", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, target.nodeId);
  let fields: string[] = [];
  const owner = module(async (operation, run) => {
    fields = Object.keys(operation.binding).sort();
    return run(operation);
  });
  const supplied = { ...binding, password: "synthetic-extra-field" };
  await withRecoveryModuleOperation(
    { db: suite.db, nodeDb: suite.node, node: target, modules: [owner] },
    { binding: supplied, input, secret },
    async () => "done",
  );
  expect(fields).toEqual(["action", "eventId", "module", "sourceId", "targetNodeId"]);
});
