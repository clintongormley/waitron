import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  withTransaction,
  invoiceSeries,
  locations,
  nodes,
  tenants,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { withOperationAuthority } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { locationId, nodeId } from "@waitron/shared";
import { runRestoreHooks } from "./restore.js";

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
const noopLog = () => {};

beforeEach(async () => {
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

function regime(
  prepare: NonNullable<import("@waitron/module").WaitronModule["operations"]>["prepare"],
  hook: import("@waitron/module").RestoreHook,
) {
  return { ...fakeModule(binding.module, { operations: { prepare } }), backup: { restore: hook } };
}

it("collects outside evidence before restore hooks open their write transaction", async () => {
  const module = regime(
    async (operation, run) => {
      await withTransaction(suite.db, (tx) =>
        tx.update(locations).set({ name: "outside-source-collected" }),
      );
      return run({ ...operation, input: "collected" });
    },
    async (tx, _node, operation) => {
      expect(operation?.input).toBe("collected");
      expect((await tx.select().from(locations))[0]?.name).toBe("outside-source-collected");
      await tx.update(locations).set({ name: "restore-committed" });
      return { report: "restored with current evidence" };
    },
  );
  const result = await withOperationAuthority(binding, ADMIN, (authority) =>
    runRestoreHooks({
      db: suite.db,
      modules: [module],
      node: target,
      log: noopLog,
      moduleOperations: new Map([[binding.module, { binding, authority, input }]]),
    }),
  );
  expect(result.reports).toEqual(["test-regime: restored with current evidence"]);
  expect((await suite.db.select().from(locations))[0]?.name).toBe("restore-committed");
});

it("leaves restore rows unchanged when the outside source refuses", async () => {
  let entered = false;
  const module = regime(
    async () => {
      throw new Error("outside-source-refused");
    },
    async () => {
      entered = true;
      return { report: "unexpected" };
    },
  );
  await withOperationAuthority(binding, ADMIN, async (authority) => {
    await expect(
      runRestoreHooks({
        db: suite.db,
        modules: [module],
        node: target,
        log: noopLog,
        moduleOperations: new Map([[binding.module, { binding, authority, input }]]),
      }),
    ).rejects.toThrow("outside-source-refused");
  });
  expect(entered).toBe(false);
  expect((await suite.db.select().from(locations))[0]?.name).toBe("Restaurant");
});

it("names the expired earlier module when a later hook finishes", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const laterEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = regime(
    async (operation, run) => run(operation),
    async (tx) => {
      await tx.update(locations).set({ name: "first-uncommitted" });
      return { report: "first" };
    },
  );
  const later = {
    ...fakeModule("independent"),
    backup: {
      restore: async () => {
        entered();
        await wait;
        return { report: "later" };
      },
    },
  };
  let attempt!: ReturnType<typeof runRestoreHooks>;
  await withOperationAuthority(binding, ADMIN, async (authority) => {
    attempt = runRestoreHooks({
      db: suite.db,
      modules: [first, later],
      node: target,
      log: noopLog,
      moduleOperations: new Map([[binding.module, { binding, authority, input }]]),
    });
    await laterEntered;
  });
  release();
  await expect(attempt).rejects.toMatchObject({
    code: "restore.hook_failed",
    params: { module: binding.module, code: "module.operation_invalid" },
  });
  expect((await suite.db.select().from(locations))[0]?.name).toBe("Restaurant");
});

it("rolls back hook writes when authority expires while a hook awaits", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let written!: () => void;
  const writes = new Promise<void>((resolve) => {
    written = resolve;
  });
  const module = regime(
    async (operation, run) => run(operation),
    async (tx) => {
      await tx.update(locations).set({ name: "uncommitted" });
      written();
      await wait;
      return { report: "unexpected" };
    },
  );
  let laterRan = false;
  const later = {
    ...fakeModule("later-independent"),
    backup: {
      restore: async () => {
        laterRan = true;
        return { report: "later" };
      },
    },
  };
  let attempt!: ReturnType<typeof runRestoreHooks>;
  await withOperationAuthority(binding, ADMIN, async (authority) => {
    attempt = runRestoreHooks({
      db: suite.db,
      modules: [module, later],
      node: target,
      log: noopLog,
      moduleOperations: new Map([[binding.module, { binding, authority, input }]]),
    });
    await writes;
  });
  release();
  await expect(attempt).rejects.toMatchObject({
    code: "restore.hook_failed",
    params: { module: binding.module, code: "module.operation_invalid" },
  });
  expect(laterRan).toBe(false);
  expect((await suite.db.select().from(locations))[0]?.name).toBe("Restaurant");
});
