import { describe, expect, it } from "vitest";
import { deriveTenantId } from "./tenant-id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deriveTenantId", () => {
  it("is a well-formed v5 UUID", () => {
    expect(deriveTenantId("ES", "B12345678")).toMatch(UUID_RE);
  });

  it("is deterministic — same (country, tax_id) yields the same id", () => {
    expect(deriveTenantId("ES", "B12345678")).toBe(deriveTenantId("ES", "B12345678"));
  });

  it("distinguishes tax_id and country, and does not collide across the field boundary", () => {
    expect(deriveTenantId("ES", "B12345678")).not.toBe(deriveTenantId("ES", "B12345679"));
    expect(deriveTenantId("ES", "B12345678")).not.toBe(deriveTenantId("PT", "B12345678"));
    // The "\n" separator: ("ES","X") and ("E","SX") must not collide.
    expect(deriveTenantId("ES", "X")).not.toBe(deriveTenantId("E", "SX"));
  });

  it("is invariant to case and to leading/trailing whitespace — es/ES and surrounding spaces give ONE id (§5)", () => {
    // The fiscal footgun this backstops: `es`/`ES` (or a taxId differing only in letter case or in
    // leading/trailing whitespace) for the same business must derive the SAME tenant, or such a
    // re-run mints a second, permanent, unmergeable tenant. `.trim().toUpperCase()` collapses case
    // and SURROUNDING whitespace only — internal whitespace is left intact (a taxId's inner content
    // is not ours to alter), asserted below. The functional fix is in planVenue; this makes the
    // primitive self-normalize so ANY caller (e.g. provisionVenue's double-provision guard, which
    // recomputes the id from the raw request) gets the canonical id.
    const canonical = deriveTenantId("ES", "B12345678");
    expect(deriveTenantId("es", "b12345678")).toBe(canonical);
    expect(deriveTenantId(" ES ", " B12345678 ")).toBe(canonical); // surrounding whitespace
    expect(deriveTenantId("Es", "b12345678")).toBe(canonical); // mixed field casings too
    // Internal whitespace is NOT normalized: a space inside the taxId is a DISTINCT identity.
    expect(deriveTenantId("ES", "B123 45678")).not.toBe(canonical);
  });

  it("leaves an ALREADY-canonical derivation UNCHANGED — normalization must not shift existing ids", () => {
    // Pinned literal, computed from the derivation for the canonical input by replicating the exact
    // uuidV5 algorithm. Normalizing a value that is already canonical must be a no-op, or every
    // tenant already derived under the old function would move to a new id.
    expect(deriveTenantId("ES", "B12345678")).toBe("87ea1575-e289-5f61-8177-c288eb755b84");
  });
});
