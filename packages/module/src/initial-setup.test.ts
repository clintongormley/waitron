import { fakeModule } from "./testing/fake-module.js";
import { describe, expect, it } from "vitest";
import { initialSetupFor, configureModuleOperations } from "./index.js";
import type {
  WaitronModule,
  InitialSetupContribution,
  ModuleOperationHost,
  ModuleOperationPreparation,
} from "./index.js";

const seat = {
  candidates: (_context, proposal) => ({ otherRegime: proposal }),
  request: (_context, value) => value,
  inspect: (_context, input) => ({ input, summary: { otherRegime: true } }),
  enrol: (_context, key, comparison) => ({ key, comparison }),
  confirmation: (_context, _input, statement) => statement,
  committed: async () => null,
} satisfies InitialSetupContribution;
const alternate = fakeModule("alternate", { provisioning: { initialSetup: seat } });
const none = fakeModule("none");

describe("initial setup module selection", () => {
  it("reaches an alternate regime through its contribution", () => {
    expect(initialSetupFor([alternate, none], "alternate")).toBe(seat);
    expect(initialSetupFor([alternate, none], "none")).toBeUndefined();
  });
  it.each(["disabled", "unknown"])("refuses %s outside the selected module list", (name) => {
    expect(() => initialSetupFor([alternate, none], name)).toThrowError(
      expect.objectContaining({ code: "module.operation_invalid" }),
    );
  });
  it("configures a copy once without altering descriptors or seats with no factory", () => {
    const host: ModuleOperationHost = {
      environment: { TEST: "passed" },
      readPublicEvidence: async () => undefined,
    };
    const configured: ModuleOperationPreparation = {
      prepare: async (_operation, run) => run(_operation),
    };
    const original = {
      ...alternate,
      operations: {
        ...configured,
        configure: (actual) => {
          expect(actual).toBe(host);
          return configured;
        },
      },
    } satisfies WaitronModule;
    const result = configureModuleOperations([original, none], host);
    expect(result[0]).not.toBe(original);
    expect(result[0]?.operations).toBe(configured);
    expect(original.operations).not.toBe(configured);
    expect(result[0]?.provisioning?.initialSetup).toBe(seat);
    expect(result[1]).toBe(none);
  });
});
