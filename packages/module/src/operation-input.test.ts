import { describe, expect, it } from "vitest";
import * as module from "./index.js";

const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-1",
  sourceId: "archive-1",
  targetNodeId: "replacement-1",
};

describe("module-owned operation input", () => {
  it.each(["module", "action", "targetNodeId"] as const)(
    "refuses genuinely issued authority for another %s",
    async (key) => {
      const wrong = { ...binding, [key]: "other" };
      await module.withOperationAuthority(wrong, "admin-1", async (authority) => {
        const operations = module.snapshotModuleOperations(
          new Map([[binding.module, { binding: wrong, authority, input: "opaque" }]]),
        );
        expect(() =>
          module.moduleOperationFor(operations, binding.module, binding.targetNodeId, "restore"),
        ).toThrow(expect.objectContaining({ code: "module.operation_invalid" }));
      });
    },
  );
  it("carries opaque input and its authority without copying either", async () => {
    const input = { allocation: new Map([["opaque", "value"]]) };
    await module.withOperationAuthority(binding, "admin-1", async (authority) => {
      const operations = module.snapshotModuleOperations(
        new Map([[binding.module, { binding, authority, input }]]),
      );
      const operation = module.moduleOperationFor(
        operations,
        binding.module,
        binding.targetNodeId,
        "restore",
      )!;
      expect(operation.input).toBe(input);
      expect(operation.authority).toBe(authority);
      expect(module.readOperationAuthority(operation.authority, operation.binding)).toEqual({
        operatorId: "admin-1",
      });
      expect(Object.isFrozen(operation)).toBe(true);
      expect(Object.isFrozen(operation.binding)).toBe(true);
    });
  });

  it("snapshots map entries and binding before the host awaits work", async () => {
    const supplied = { ...binding };
    await module.withOperationAuthority(binding, "admin-1", async (authority) => {
      const source = new Map([[binding.module, { binding: supplied, authority, input: "first" }]]);
      const operations = module.snapshotModuleOperations(source);
      supplied.eventId = "changed";
      source.set(binding.module, { binding: supplied, authority, input: "second" });
      const operation = module.moduleOperationFor(
        operations,
        binding.module,
        binding.targetNodeId,
        "restore",
      )!;
      expect(operation.input).toBe("first");
      expect(operation.binding).toEqual(binding);
    });
  });

  it.each(["module", "action", "targetNodeId"] as const)(
    "refuses input for the wrong %s before the hook can use it",
    async (key) => {
      await module.withOperationAuthority(binding, "admin-1", async (authority) => {
        const changed = { ...binding, [key]: "other" };
        const operations = module.snapshotModuleOperations(
          new Map([[binding.module, { binding: changed, authority, input: "opaque" }]]),
        );
        expect(() =>
          module.moduleOperationFor(operations, binding.module, binding.targetNodeId, "restore"),
        ).toThrow(
          expect.objectContaining({
            code: "module.operation_invalid",
            params: { module: binding.module },
          }),
        );
      });
    },
  );

  it("refuses expired authority and a plain copy of an issued authority", async () => {
    let operations: ReturnType<typeof module.snapshotModuleOperations>;
    await module.withOperationAuthority(binding, "admin-1", async (authority) => {
      operations = module.snapshotModuleOperations(
        new Map([[binding.module, { binding, authority, input: "opaque" }]]),
      );
      const copied = module.snapshotModuleOperations(
        new Map([[binding.module, { binding, authority: { ...authority }, input: "opaque" }]]),
      );
      expect(() =>
        module.moduleOperationFor(copied, binding.module, binding.targetNodeId, "restore"),
      ).toThrow(expect.objectContaining({ code: "module.operation_invalid" }));
    });
    expect(() =>
      module.moduleOperationFor(operations!, binding.module, binding.targetNodeId, "restore"),
    ).toThrow(expect.objectContaining({ code: "module.operation_invalid" }));
  });

  it("leaves an absent module input absent instead of borrowing another module's", async () => {
    expect(
      module.moduleOperationFor(
        module.snapshotModuleOperations(undefined),
        "other",
        binding.targetNodeId,
        "restore",
      ),
    ).toBeUndefined();
    await module.withOperationAuthority(binding, "admin-1", async (authority) => {
      const operations = module.snapshotModuleOperations(
        new Map([[binding.module, { binding, authority, input: "opaque" }]]),
      );
      expect(
        module.moduleOperationFor(operations, "other", binding.targetNodeId, "restore"),
      ).toBeUndefined();
    });
  });
});
