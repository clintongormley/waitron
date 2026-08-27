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

  it("is casing- and whitespace-invariant — es/ES and stray spacing collapse to ONE id (§5)", () => {
    // The fiscal footgun this backstops: `es`/`ES` (or a taxId casing/spacing difference) for the
    // same business must derive the SAME obligado, or a differently-cased re-run mints a second,
    // permanent, unmergeable obligado. The functional fix is in planVenue; this makes the primitive
    // self-normalize so ANY caller (e.g. provisionVenue's double-provision guard, which recomputes
    // the id from the raw request) gets the canonical id.
    const canonical = obligadoTenantId("ES", "B12345678");
    expect(obligadoTenantId("es", "b12345678")).toBe(canonical);
    expect(obligadoTenantId(" ES ", " B12345678 ")).toBe(canonical);
    expect(obligadoTenantId("Es", "b12345678")).toBe(canonical); // mixed field casings too
  });

  it("leaves an ALREADY-canonical derivation UNCHANGED — normalization must not shift existing ids", () => {
    // Pinned literal, computed from the derivation for the canonical input by replicating the exact
    // uuidV5 algorithm. Normalizing a value that is already canonical must be a no-op, or every
    // obligado already derived under the old function would move to a new id.
    expect(obligadoTenantId("ES", "B12345678")).toBe("87ea1575-e289-5f61-8177-c288eb755b84");
  });
});
