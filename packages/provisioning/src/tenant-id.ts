import { createHash } from "node:crypto";

/**
 * A fixed, arbitrary namespace UUID. NEVER change it: the derived tenant ids are how a re-run
 * finds the obligado it created before. The country and tax id determine the id
 * used by the tenant insert and its dependent location rows.
 */
const OBLIGADO_NAMESPACE = "6f9c1e2a-3b4d-4e6f-8a9b-0c1d2e3f4a5b";

/** RFC 4122 v5 (SHA-1) UUID of `name` within `namespace`. Deterministic, no dependency. */
function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const digest = createHash("sha1").update(ns).update(name, "utf8").digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The obligado's stable tenant id, derived from its fiscal identity.
 *
 * INVARIANT: any future PRODUCTION tenant-creation path MUST derive its id through this function,
 * never a random one. `applyVenue`'s re-run idempotency uses this derived id and
 * inserts the tenant with `ON CONFLICT DO NOTHING` (venue-apply.ts), and `locations.tenant_id`
 * FK-references `tenants.id` (packages/db/drizzle/0000_baseline.sql) — a second path that minted a RANDOM id for the same
 * (country, tax_id) would make the re-run's ON CONFLICT a no-op while the scope adopts the derived
 * id, so every location insert would fail the FK. `venue` is the only such path today; `seedTenant`
 * and the fixtures use `defaultRandom()` ids but are test-only.
 *
 * CASING / LEADING-TRAILING-WHITESPACE INVARIANT: the id is invariant to letter case and to leading
 * or trailing whitespace ONLY. Both arguments are `.trim().toUpperCase()`d before the hash, so `es`/
 * `ES` and stray surrounding spaces derive the SAME id —
 * `obligadoTenantId(" es ", " b12345678 ") === obligadoTenantId("ES", "B12345678")`. INTERNAL
 * whitespace is NOT normalized (and must not be — a taxId's inner content is not ours to alter):
 * `"B123 45678"` and `"B12345678"` remain DISTINCT obligados. Any caller gets the canonical id. This
 * is a no-op for the primary caller (`planVenue`, which canonicalizes country/taxId itself before it
 * builds the tenant row), and required by the secondary one: `provisionVenue`'s double-provision
 * guard (apps/server) recomputes the id from the RAW request to look the obligado up by id, and
 * normalizing here keeps that lookup aligned with the id `planVenue`/`applyVenue` stored. Without it,
 * `es`/`ES` for one business would derive two ids and mint two permanent, unmergeable obligados — a
 * re-run meant to add a shop would silently start a second SIF/hash chain (§5). ISO-3166 alpha-2 is
 * upper-case by convention; there is no data to preserve either way (pre-production, no backfill).
 */
export function obligadoTenantId(country: string, taxId: string): string {
  const canonicalCountry = country.trim().toUpperCase();
  const canonicalTaxId = taxId.trim().toUpperCase();
  return uuidV5(`${canonicalCountry}\n${canonicalTaxId}`, OBLIGADO_NAMESPACE);
}
