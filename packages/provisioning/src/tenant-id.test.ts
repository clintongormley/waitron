import { describe, expect, it } from "vitest";
import { obligadoTenantId } from "./tenant-id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("obligadoTenantId", () => {
  it("is a well-formed v5 UUID", () => {
    expect(obligadoTenantId("ES", "B12345678")).toMatch(UUID_RE);
  });

  it("is deterministic — same (country, tax_id) yields the same id", () => {
    expect(obligadoTenantId("ES", "B12345678")).toBe(obligadoTenantId("ES", "B12345678"));
  });

  it("distinguishes tax_id and country, and does not collide across the field boundary", () => {
    expect(obligadoTenantId("ES", "B12345678")).not.toBe(obligadoTenantId("ES", "B12345679"));
    expect(obligadoTenantId("ES", "B12345678")).not.toBe(obligadoTenantId("PT", "B12345678"));
    // The "\n" separator: ("ES","X") and ("E","SX") must not collide.
    expect(obligadoTenantId("ES", "X")).not.toBe(obligadoTenantId("E", "SX"));
  });
});
