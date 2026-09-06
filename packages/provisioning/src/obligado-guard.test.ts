import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertNoForeignObligado, type ObligadoIdentity } from "./obligado-guard.js";

const ES_A: ObligadoIdentity = { country: "ES", taxId: "B12345678" };
const ES_B: ObligadoIdentity = { country: "ES", taxId: "B99999999" };

describe("assertNoForeignObligado", () => {
  it("passes on an empty database — the first obligado", () => {
    expect(() => assertNoForeignObligado([], ES_A, "waitron")).not.toThrow();
  });

  it("passes when the only present identity is the SAME obligado", () => {
    expect(() => assertNoForeignObligado([ES_A], ES_A, "waitron")).not.toThrow();
  });

  it("throws provisioning.foreign_obligado when a DIFFERENT obligado is present", () => {
    const error = (() => {
      try {
        assertNoForeignObligado([ES_B], ES_A, "waitron_demo");
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_obligado");
    // The refusal echoes the database name it was handed — never a secret.
    expect(isAppError(error) && error.params).toEqual({ database: "waitron_demo" });
  });

  it("refuses a foreign identity even when the applied one is ALSO present", () => {
    expect(() => assertNoForeignObligado([ES_A, ES_B], ES_A, "waitron")).toThrow();
  });
});
