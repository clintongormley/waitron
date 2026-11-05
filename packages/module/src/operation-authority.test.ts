import { describe, expect, it } from "vitest";
import * as module from "./index.js";

const binding = {
  module: "test-regime",
  action: "promote",
  eventId: "takeover-1",
  sourceId: "archive-1",
  targetNodeId: "replacement-1",
};

describe("isOperationBinding", () => {
  it("control: takes the five fields", () => {
    expect(module.isOperationBinding(binding)).toBe(true);
  });

  it.each(["module", "action", "eventId", "sourceId", "targetNodeId"] as const)(
    "refuses a binding with %s missing, blank or not text",
    (key) => {
      const without = Object.fromEntries(Object.entries(binding).filter(([name]) => name !== key));
      expect(module.isOperationBinding(without)).toBe(false);
      expect(module.isOperationBinding({ ...without, other: "text" })).toBe(false);
      expect(module.isOperationBinding({ ...binding, [key]: "  " })).toBe(false);
      expect(module.isOperationBinding({ ...binding, [key]: 1 })).toBe(false);
    },
  );

  it("refuses a sixth field", () => {
    expect(module.isOperationBinding({ ...binding, extra: "text" })).toBe(false);
  });

  it.each([[null], ["text"], [1], [undefined], [Object.values(binding)]])(
    "refuses %j, which is not an object of fields",
    (value) => {
      expect(module.isOperationBinding(value)).toBe(false);
    },
  );

  it("names the five fields", () => {
    expect(module.OPERATION_BINDING_KEYS).toEqual(Object.keys(binding));
  });
});

describe("host operation authority", () => {
  it("detaches a recovery-key event from caller mutation and never attributes it to a person", async () => {
    const operator = {
      kind: "recovery-key" as const,
      nodeId: "replacement-1",
      eventId: "takeover-1",
    };
    await module.withOperationAuthority(binding, operator, async (token) => {
      operator.nodeId = "other";
      operator.eventId = "other";
      const verdict = module.readOperationAuthority(token, binding)!;
      expect(verdict).toEqual({
        operatorId: { kind: "recovery-key", nodeId: "replacement-1", eventId: "takeover-1" },
      });
      expect(Reflect.set(verdict.operatorId as object, "nodeId", "other")).toBe(false);
    });
  });

  it("supplies the verified operator only for the exact module, action, event, source and target", async () => {
    const authority = module;
    const result = await authority.withOperationAuthority(binding, "admin-1", async (token) => {
      expect(authority.readOperationAuthority(token, binding)).toEqual({ operatorId: "admin-1" });
      for (const key of Object.keys(binding) as (keyof typeof binding)[])
        expect(
          authority.readOperationAuthority(token, { ...binding, [key]: "other" }),
        ).toBeUndefined();
      return "activated";
    });
    expect(result).toBe("activated");
  });

  it("refuses JSON, copies, a matching plain object and a proxy around an issued token", async () => {
    const authority = module;
    await authority.withOperationAuthority(binding, "admin-1", async (token) => {
      for (const copied of [
        null,
        undefined,
        1,
        JSON.parse(JSON.stringify(token)),
        structuredClone(token),
        { ...binding, operatorId: "admin-1" },
        new Proxy(token as object, {}),
      ])
        expect(authority.readOperationAuthority(copied, binding)).toBeUndefined();
    });
  });

  it("revokes authority after a successful operation", async () => {
    const authority = module;
    const token = await authority.withOperationAuthority(
      binding,
      "admin-1",
      async (token) => token,
    );
    expect(authority.readOperationAuthority(token, binding)).toBeUndefined();
  });

  it("revokes authority after a refused operation", async () => {
    const authority = module;
    let retained: unknown;
    await expect(
      authority.withOperationAuthority(binding, "admin-1", async (token) => {
        retained = token;
        throw new Error("write refused");
      }),
    ).rejects.toThrow("write refused");
    expect(authority.readOperationAuthority(retained, binding)).toBeUndefined();
  });

  it("snapshots its binding and keeps the operator verdict immutable", async () => {
    const authority = module;
    const input = { ...binding };
    await authority.withOperationAuthority(input, "admin-1", async (token) => {
      input.targetNodeId = "caller-changed";
      const verdict = authority.readOperationAuthority(token, binding)!;
      expect(verdict).toEqual({ operatorId: "admin-1" });
      expect(Reflect.set(verdict, "operatorId", "caller-changed")).toBe(false);
      expect(authority.readOperationAuthority(token, binding)).toEqual({ operatorId: "admin-1" });
      expect(authority.readOperationAuthority(token, input)).toBeUndefined();
    });
  });

  it("revoking one concurrent operation does not revoke the other", async () => {
    const authority = module;
    let first: unknown;
    await authority.withOperationAuthority(binding, "admin-2", async (second) => {
      first = await authority.withOperationAuthority(binding, "admin-1", async (token) => token);
      expect(authority.readOperationAuthority(first, binding)).toBeUndefined();
      expect(authority.readOperationAuthority(second, binding)).toEqual({ operatorId: "admin-2" });
    });
  });
});
