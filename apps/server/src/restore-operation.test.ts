import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, locations, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  readOperationAuthority,
  withOperationAuthority,
  type ModuleOperationInput,
  type RestoreHook,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { locationId, nodeId } from "@waitron/shared";
import { runRestoreHooks } from "./restore.js";
import { withAuthenticatedOperation } from "./operation-authentication.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

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

function regime(hook: RestoreHook, name = binding.module): WaitronModule {
  return { ...fakeModule(name), backup: { restore: hook } };
}

describe("authenticated opaque restore seat", () => {
  it("passes a freshly authenticated operator and only that module's opaque input", async () => {
    let retained: ModuleOperationInput | undefined;
    const module = regime(async (_tx, node, operation) => {
      expect(node).toEqual(target);
      expect(operation).toBeDefined();
      retained = operation;
      expect(operation!.input).toBe(input);
      expect(operation!.binding).toEqual(binding);
      expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
        operatorId: ADMIN,
      });
      return { report: "restored" };
    });
    const result = await withAuthenticatedOperation(
      { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
      { binding, permission: "node.promote" },
      { personId: ADMIN, password: PASSWORD },
      async (authority) =>
        runRestoreHooks({
          db: suite.db,
          modules: [module],
          node: target,
          log: noopLog,
          moduleOperations: new Map([[binding.module, { input, binding, authority }]]),
        }),
    );
    expect(result.reports).toEqual(["test-regime: restored"]);
    expect(readOperationAuthority(retained!.authority, retained!.binding)).toBeUndefined();
  });

  it.each(["module", "action", "targetNodeId"] as const)(
    "refuses another %s's context without running its hook",
    async (key) => {
      const wrong = { ...binding, [key]: "other" };
      let entered = false;
      const module = regime(async () => {
        entered = true;
        return { report: "unexpected" };
      });
      await withOperationAuthority(wrong, ADMIN, async (authority) => {
        await expect(
          runRestoreHooks({
            db: suite.db,
            modules: [module],
            node: target,
            log: noopLog,
            moduleOperations: new Map([[binding.module, { input, binding: wrong, authority }]]),
          }),
        ).rejects.toMatchObject({
          code: "restore.hook_failed",
          params: { module: binding.module, code: "module.operation_invalid" },
        });
      });
      expect(entered).toBe(false);
    },
  );

  it("refuses expired authority before entering the restore hook", async () => {
    let entered = false;
    const module = regime(async () => {
      entered = true;
      return { report: "unexpected" };
    });
    const authority = await withOperationAuthority(binding, ADMIN, async (token) => token);
    await expect(
      runRestoreHooks({
        db: suite.db,
        modules: [module],
        node: target,
        log: noopLog,
        moduleOperations: new Map([[binding.module, { input, binding, authority }]]),
      }),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { code: "module.operation_invalid" },
    });
    expect(entered).toBe(false);
  });

  it("leaves another module's absent input undefined", async () => {
    const module = regime(async (_tx, _node, operation) => {
      expect(operation).toBeUndefined();
      return { report: "independent" };
    }, "other-regime");
    await withOperationAuthority(binding, ADMIN, async (authority) => {
      expect(
        (
          await runRestoreHooks({
            db: suite.db,
            modules: [module],
            node: target,
            log: noopLog,
            moduleOperations: new Map([[binding.module, { input, binding, authority }]]),
          })
        ).reports,
      ).toEqual(["other-regime: independent"]);
    });
  });

  it("snapshots the supplied entries before an earlier hook awaits", async () => {
    const supplied = { ...binding };
    await withOperationAuthority(binding, ADMIN, async (authority) => {
      const operations = new Map([[binding.module, { input, binding: supplied, authority }]]);
      const first = regime(async () => {
        supplied.eventId = "changed";
        operations.clear();
        return { report: "first" };
      }, "other-regime");
      const second = regime(async (_tx, _node, operation) => {
        expect(operation!.binding).toEqual(binding);
        expect(operation!.input).toBe(input);
        return { report: "second" };
      });
      expect(
        (
          await runRestoreHooks({
            db: suite.db,
            modules: [first, second],
            node: target,
            log: noopLog,
            moduleOperations: operations,
          })
        ).reports,
      ).toEqual(["other-regime: first", "test-regime: second"]);
    });
  });

  it("rolls back an earlier hook's writes when the later authority is wrong", async () => {
    const first = regime(async (tx) => {
      await tx.update(locations).set({ name: "written-in-hook" });
      return { report: "first" };
    }, "other-regime");
    const second = regime(async () => ({ report: "unexpected" }));
    const wrong = { ...binding, targetNodeId: "another-node" };
    await withOperationAuthority(wrong, ADMIN, async (authority) => {
      await expect(
        runRestoreHooks({
          db: suite.db,
          modules: [first, second],
          node: target,
          log: noopLog,
          moduleOperations: new Map([[binding.module, { input, binding: wrong, authority }]]),
        }),
      ).rejects.toMatchObject({ code: "restore.hook_failed" });
    });
    expect((await suite.db.select().from(invoiceSeries)).map((row) => row.code).sort()).toEqual([
      "A",
      "FF",
      "R",
    ]);
    expect((await suite.db.select().from(locations)).map((row) => row.name)).toEqual([
      "Restaurant",
    ]);
  });
});
