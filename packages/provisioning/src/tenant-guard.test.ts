import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertNoForeignTenant,
  assertNoOperationalVenue,
  assertOperationalVenue,
  type TenantIdentity,
} from "./tenant-guard.js";

const ES_A: TenantIdentity = { country: "ES", taxId: "B12345678" };
const ES_B: TenantIdentity = { country: "ES", taxId: "B99999999" };

describe("assertNoForeignTenant", () => {
  it("passes on an empty database — the first tenant", () => {
    expect(() => assertNoForeignTenant([], ES_A, "waitron")).not.toThrow();
  });

  it("passes when the only present identity is the SAME tenant", () => {
    expect(() => assertNoForeignTenant([ES_A], ES_A, "waitron")).not.toThrow();
  });

  it("throws provisioning.foreign_tenant when a DIFFERENT tenant is present", () => {
    const error = (() => {
      try {
        assertNoForeignTenant([ES_B], ES_A, "waitron_demo");
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");
    expect(isAppError(error) && error.params).toEqual({ database: "waitron_demo" });
  });

  it("refuses a foreign identity even when the applied one is ALSO present", () => {
    expect(() => assertNoForeignTenant([ES_A, ES_B], ES_A, "waitron")).toThrow();
  });
});

describe("operational venue guards", () => {
  it("accepts a present venue document", () => {
    expect(() => assertOperationalVenue(true)).not.toThrow();
  });

  it("refuses a trading boot with no venue document", () => {
    expect(() => assertOperationalVenue(false)).toThrowError(
      expect.objectContaining({ code: "provisioning.second_venue" }),
    );
  });

  it("requires a mirror target to contain no venue before native copy", () => {
    expect(() => assertNoOperationalVenue(false)).not.toThrow();
    expect(() => assertNoOperationalVenue(true)).toThrowError(
      expect.objectContaining({ code: "provisioning.second_venue" }),
    );
  });
});
