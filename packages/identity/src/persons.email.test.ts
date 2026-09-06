import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { pgErrorCode } from "@waitron/db";
import type { Database } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// The subject is the functional partial index persons_tenant_email_uq: case-insensitive
// (lower(email)), keyed on tenant_id, and NULL-permissive. An index is enforced on any target, so
// this file is a candidate for the PGlite tier once the suites are re-tagged; it runs through the
// probe login below only because that is the connection this suite already had.
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";

const PIN = hashPin("1234");

const suite = useTemplateDb({ template: "core_identity" });

/** Insert one persons row for `tenantId`. Returns the insert promise so a caller can assert on
 * rejection (unique violation) or resolution. */
function insertPerson(
  probe: Database,
  tenantId: string,
  displayName: string,
  email: string | null,
): Promise<unknown> {
  return withTenant(probe, tenantId, (tx) =>
    tx.execute(sql`
      insert into persons (tenant_id, display_name, pin_hash, email)
      values (${tenantId}, ${displayName}, ${PIN}, ${email})`),
  );
}

describe("persons.email unique index (persons_tenant_email_uq)", () => {
  it("rejects a second person with the same email (case-insensitively) in one tenant", async () => {
    const t1 = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await insertPerson(probe, t1, "A", "Owner@x.com");
      // The differing case (Owner@x.com vs owner@x.com) is the point: lower(email) collides. drizzle
      // wraps the pg error, so its .message is a generic "Failed query…" — the unique-violation code
      // and the constraint name live on the underlying pg error, which `pgErrorCode` reaches by
      // walking `.cause`. 23505 = unique_violation.
      const error = await insertPerson(probe, t1, "B", "owner@x.com")
        .then(() => undefined)
        .catch((e: unknown) => e);
      expect(pgErrorCode(error)).toBe("23505");
      // Prove it is THIS index that fired, not some other unique constraint (id, say). The pg error
      // — with .constraint — is the DrizzleQueryError's cause, not the wrapper itself.
      expect((error as { cause?: { constraint?: string } }).cause?.constraint).toBe(
        "persons_tenant_email_uq",
      );
    } finally {
      await probe.close();
    }
  });

  it("allows the same email in different tenants", async () => {
    const t1 = await seedTenant(suite.admin);
    const t2 = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await insertPerson(probe, t1, "A", "owner@x.com");
      await expect(insertPerson(probe, t2, "A", "owner@x.com")).resolves.toBeDefined();
    } finally {
      await probe.close();
    }
  });

  it("allows multiple persons with NULL email in one tenant", async () => {
    const t1 = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await insertPerson(probe, t1, "A", null);
      await expect(insertPerson(probe, t1, "B", null)).resolves.toBeDefined();
    } finally {
      await probe.close();
    }
  });
});
