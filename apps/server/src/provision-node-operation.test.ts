import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { locationId, nodeId } from "@waitron/shared";
import { mintBreakGlassSecret } from "./break-glass.js";
import { provisionNode } from "./provision-till.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = nodeId("c0000000-0000-4000-8000-000000000001");
const LOCATION = locationId("c0000000-0000-4000-8000-000000000002");
const OTHER = locationId("c0000000-0000-4000-8000-000000000003");
const binding = {
  module: "test-regime",
  action: "re-register",
  eventId: "reimage-42",
  sourceId: "reimaged-box-42",
  targetNodeId: NODE,
};
let secret: string;
const input = { signed: "outside allocation" };
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await suite.db.insert(locations).values([
    { id: LOCATION, name: "Original", invoiceLocales: ["es"], operationDescription: "Venta" },
    { id: OTHER, name: "Other", invoiceLocales: ["es"], operationDescription: "Venta" },
  ]);
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Original" });
  secret = await mintBreakGlassSecret(suite.db, NODE);
});

function perform(modules: Parameters<typeof provisionNode>[2], scope = binding, key = secret) {
  const params = {
    nodeId: NODE,
    recovery: { binding: scope, input, secret: key },
  };
  return provisionNode(suite.db, params, modules);
}

it("collects for the real key outside the transaction, then passes scoped input to the node seed", async () => {
  let held: ModuleOperationInput | undefined;
  const module = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        expect(operation.input).toEqual(input);
        expect(readOperationAuthority(operation.authority, binding)).toEqual({
          operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "reimage-42" },
        });
        await withTransaction(suite.db, (tx) => tx.update(nodes).set({ name: "Collected" }));
        return run({ ...operation, input: "current evidence" });
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async (tx, node, operation) => {
          held = operation;
          expect(operation?.input).toBe("current evidence");
          expect(node).toEqual({ nodeId: NODE, locationId: LOCATION });
          expect((await tx.select().from(nodes))[0]!.name).toBe("Collected");
          await tx.update(nodes).set({ name: "Committed" });
          return "registered";
        },
      },
    },
  });
  await expect(perform([module])).resolves.toEqual([
    { module: "test-regime", report: "registered" },
  ]);
  expect((await suite.db.select().from(nodes))[0]!.name).toBe("Committed");
  expect(readOperationAuthority(held!.authority, binding)).toBeUndefined();
});

it("refuses a wrong key before collecting evidence or running any seed", async () => {
  let collected = false;
  let seeded = false;
  const module = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        collected = true;
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async () => {
          seeded = true;
          return "wrong";
        },
      },
    },
  });
  await expect(perform([module], binding, "wrong")).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
  expect(collected).toBe(false);
  expect(seeded).toBe(false);
});

it.each(["restore", "setup", "promote"])(
  "refuses a %s operation without running a seed",
  async (action) => {
    let entered = false;
    let collected = false;
    const module = fakeModule(binding.module, {
      operations: {
        prepare: async (operation, run) => {
          collected = true;
          return run(operation);
        },
      },
      provisioning: {
        seed: {
          summary: "seed",
          run: async () => {
            entered = true;
            return "wrong";
          },
        },
      },
    });
    await expect(perform([module], { ...binding, action })).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: "test-regime" },
    });
    expect(entered).toBe(false);
    expect(collected).toBe(false);
  },
);

it("retains outside evidence but rolls back every seed when a later seed refuses", async () => {
  const first = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        await withTransaction(suite.db, (tx) => tx.update(nodes).set({ name: "Outside" }));
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async (tx) => {
          await tx.update(nodes).set({ name: "Uncommitted" });
          return "first";
        },
      },
    },
  });
  const later = fakeModule("later", {
    provisioning: {
      seed: {
        summary: "seed",
        run: async () => {
          throw new Error("later-refused");
        },
      },
    },
  });
  await expect(perform([first, later])).rejects.toThrow("later-refused");
  expect((await suite.db.select().from(nodes))[0]!.name).toBe("Outside");
});

it("refuses a location changed while outside evidence is collected", async () => {
  let seeded = false;
  const module = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        await withTransaction(suite.db, (tx) => tx.update(nodes).set({ locationId: OTHER }));
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async () => {
          seeded = true;
          return "wrong";
        },
      },
    },
  });
  await expect(perform([module])).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "test-regime" },
  });
  expect(seeded).toBe(false);
});

it("rechecks the key after collection before entering the seeds", async () => {
  let seeded = false;
  const module = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        await mintBreakGlassSecret(suite.db, NODE);
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async () => {
          seeded = true;
          return "wrong";
        },
      },
    },
  });
  await expect(perform([module])).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(seeded).toBe(false);
});

it("refuses input for an unselected module before any seed runs", async () => {
  let entered = false;
  const module = fakeModule(binding.module, {
    provisioning: {
      seed: {
        summary: "seed",
        run: async () => {
          entered = true;
          return "wrong";
        },
      },
    },
  });
  await expect(perform([module], { ...binding, module: "unselected" })).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "unselected" },
  });
  expect(entered).toBe(false);
});
it("detaches the node, input, binding and module list before its first awaited read", async () => {
  const supplied = {
    nodeId: NODE,
    recovery: { binding: { ...binding }, input: { signed: "original" }, secret },
  };
  const module = fakeModule(binding.module, {
    operations: {
      prepare: async (operation, run) => {
        expect(operation.binding).toEqual(binding);
        expect(operation.input).toEqual({ signed: "original" });
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "seed",
        run: async (_tx, node) => {
          expect(node.nodeId).toBe(NODE);
          return "registered";
        },
      },
    },
  });
  const selected = [module];
  const attempt = provisionNode(suite.db, supplied, selected);
  supplied.nodeId = nodeId("c0000000-0000-4000-8000-000000000099");
  supplied.recovery.binding.eventId = "changed";
  supplied.recovery.input.signed = "changed";
  selected.splice(0);
  await expect(attempt).resolves.toEqual([{ module: "test-regime", report: "registered" }]);
});
