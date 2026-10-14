import { describe, expect, it } from "vitest";
import { fakeModule } from "./testing/fake-module.js";
import { withOperationAuthority, type OperationBinding } from "./operation-authority.js";
import { type ModuleOperationInput, type ModuleOperations } from "./operation-input.js";
import * as preparation from "./operation-preparation.js";
import type { WaitronModule } from "./module.js";

const binding: OperationBinding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-1",
  sourceId: "archive-1",
  targetNodeId: "replacement-1",
};

function prepare<T>(
  modules: readonly WaitronModule[],
  operations: ModuleOperations,
  run: (ready: ModuleOperations) => Promise<T>,
) {
  return preparation.withPreparedModuleOperations(
    modules,
    operations,
    binding.targetNodeId,
    binding.action,
    run,
  );
}

describe("module operation preparation before a host write", () => {
  it("does not repeat the host through a captured continuation after preparation closes", async () => {
    let later!: () => Promise<unknown>;
    const module = fakeModule(binding.module, {
      operations: {
        async prepare(operation, run) {
          later = () => run(operation);
          return run(operation);
        },
      },
    });
    let writes = 0;
    await withOperationAuthority(binding, "admin-1", async (authority) => {
      await prepare(
        [module],
        new Map([[binding.module, { binding, authority, input: "input" }]]),
        async () => {
          writes++;
          return "written";
        },
      );
      await expect(later()).rejects.toMatchObject({ code: "module.operation_invalid" });
    });
    expect(writes).toBe(1);
  });

  it("does not replace the authenticated operator with another live authority for the same binding", async () => {
    await withOperationAuthority(binding, "admin-2", async (other) => {
      const module = fakeModule(binding.module, {
        operations: {
          async prepare(operation, run) {
            return run({ ...operation, authority: other });
          },
        },
      });
      await withOperationAuthority(binding, "admin-1", async (authority) => {
        await expect(
          prepare(
            [module],
            new Map([[binding.module, { binding, authority, input: "input" }]]),
            async () => "unexpected",
          ),
        ).rejects.toMatchObject({ code: "module.operation_invalid" });
      });
    });
  });
  it("uses the module's collected input while its preparation scope is open", async () => {
    const module = fakeModule(binding.module, {
      operations: {
        async prepare(operation, run) {
          return run({ ...operation, input: { collected: "outside-confirmation" } });
        },
      },
    });
    const result = await withOperationAuthority(binding, "admin-1", (authority) =>
      prepare(
        [module],
        new Map([[binding.module, { binding, authority, input: "submitted" }]]),
        async (ready) => ready.get(binding.module)?.input,
      ),
    );
    expect(result).toEqual({ collected: "outside-confirmation" });
  });

  it("keeps every preparation scope open until the host finishes", async () => {
    const events: string[] = [];
    const modules = ["test-regime", "other-regime"].map((name) =>
      fakeModule(name, {
        operations: {
          async prepare(operation, run) {
            events.push(`${name}:open`);
            try {
              return await run(operation);
            } finally {
              events.push(`${name}:close`);
            }
          },
        },
      }),
    );
    await withOperationAuthority(binding, "admin-1", (first) =>
      withOperationAuthority({ ...binding, module: "other-regime" }, "admin-2", (second) =>
        prepare(
          modules,
          new Map([
            [binding.module, { binding, authority: first, input: "first" }],
            [
              "other-regime",
              {
                binding: { ...binding, module: "other-regime" },
                authority: second,
                input: "second",
              },
            ],
          ]),
          async () => {
            events.push("host");
          },
        ),
      ),
    );
    expect(events).toEqual([
      "test-regime:open",
      "other-regime:open",
      "host",
      "other-regime:close",
      "test-regime:close",
    ]);
  });

  it("does not enter the host after the source refuses", async () => {
    let entered = false;
    const module = fakeModule(binding.module, {
      operations: {
        async prepare() {
          throw new Error("outside-source-unavailable");
        },
      },
    });
    await withOperationAuthority(binding, "admin-1", async (authority) => {
      await expect(
        prepare(
          [module],
          new Map([[binding.module, { binding, authority, input: "submitted" }]]),
          async () => {
            entered = true;
          },
        ),
      ).rejects.toThrow("outside-source-unavailable");
    });
    expect(entered).toBe(false);
  });

  it.each(["module", "action", "eventId", "sourceId", "targetNodeId"] as const)(
    "refuses substituted %s before entering the host",
    async (key) => {
      let entered = false;
      const module = fakeModule(binding.module, {
        operations: {
          async prepare(operation, run) {
            return run({ ...operation, binding: { ...operation.binding, [key]: "other" } });
          },
        },
      });
      await withOperationAuthority(binding, "admin-1", async (authority) => {
        await expect(
          prepare(
            [module],
            new Map([[binding.module, { binding, authority, input: "submitted" }]]),
            async () => {
              entered = true;
            },
          ),
        ).rejects.toMatchObject({
          code: "module.operation_invalid",
          params: { module: binding.module },
        });
      });
      expect(entered).toBe(false);
    },
  );

  it("refuses a plain authority copy supplied by preparation", async () => {
    let entered = false;
    const module = fakeModule(binding.module, {
      operations: {
        async prepare(operation, run) {
          return run({ ...operation, authority: { ...operation.authority } });
        },
      },
    });
    await withOperationAuthority(binding, "admin-1", async (authority) => {
      await expect(
        prepare(
          [module],
          new Map([[binding.module, { binding, authority, input: "submitted" }]]),
          async () => {
            entered = true;
          },
        ),
      ).rejects.toMatchObject({ code: "module.operation_invalid" });
    });
    expect(entered).toBe(false);
  });

  it("refuses revoked authority before the source is consulted", async () => {
    let sourceRead = false;
    const module = fakeModule(binding.module, {
      operations: {
        async prepare(operation, run) {
          sourceRead = true;
          return run(operation);
        },
      },
    });
    const authority = await withOperationAuthority(binding, "admin-1", async (value) => value);
    await expect(
      prepare(
        [module],
        new Map([[binding.module, { binding, authority, input: "submitted" }]]),
        async () => "unexpected",
      ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(sourceRead).toBe(false);
  });

  it("snapshots all entries before an earlier preparation awaits", async () => {
    const other = { ...binding, module: "other-regime" };
    const modules = [
      fakeModule(binding.module, {
        operations: {
          async prepare(operation, run) {
            other.eventId = "changed";
            entries.clear();
            return run(operation);
          },
        },
      }),
      fakeModule("other-regime"),
    ];
    let entries!: Map<string, ModuleOperationInput>;
    await withOperationAuthority(binding, "admin-1", (first) =>
      withOperationAuthority(other, "admin-2", async (second) => {
        entries = new Map([
          [binding.module, { binding, authority: first, input: "first" }],
          [other.module, { binding: other, authority: second, input: "second" }],
        ]);
        const result = await prepare(modules, entries, async (ready) => ready.get("other-regime"));
        expect(result?.binding).toEqual({ ...binding, module: "other-regime" });
        expect(result?.input).toBe("second");
      }),
    );
  });

  it("leaves independent modules without input and carries input through a module without preparation", async () => {
    const independent = fakeModule("other-regime", {
      operations: {
        async prepare() {
          throw new Error("borrowed-input");
        },
      },
    });
    await withOperationAuthority(binding, "admin-1", async (authority) => {
      const input = { opaque: "unchanged" };
      const result = await prepare(
        [independent, fakeModule(binding.module)],
        new Map([[binding.module, { binding, authority, input }]]),
        async (ready) => ready,
      );
      expect(result.has("other-regime")).toBe(false);
      expect(result.get(binding.module)?.input).toBe(input);
    });
  });
});
