import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { constraintTarget, withTransaction } from "@waitron/db";
import { pgErrorCode } from "@waitron/db";
import type { Database } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { PERSONS_EMAIL } from "./person-constraints.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// Real PostgreSQL checks INSERT and unique-index behavior through an app_user member login.
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";

const PIN = hashPin("1234");

const suite = useTemplateDb({ template: "core_identity" });

/** Insert one persons row. Returns the insert promise so a caller can assert on rejection (unique
 * violation) or resolution. */
function insertPerson(
  probe: Database,
  displayName: string,
  email: string | null,
): Promise<unknown> {
  return withTransaction(probe, (tx) =>
    tx.execute(sql`
      insert into persons (display_name, pin_hash, email)
      values (${displayName}, ${PIN}, ${email})`),
  );
}

describe("persons.email unique index (persons_tenant_email_uq)", () => {
  it("rejects a second person with the same email, case-insensitively", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await insertPerson(probe, "A", "Owner@x.com");
      // The differing case (Owner@x.com vs owner@x.com) is the point: lower(email) collides. drizzle
      // wraps the pg error, so its .message is a generic "Failed query…" — the unique-violation code
      // and the key that collided live on the underlying pg error, which `pgErrorCode` and
      // `constraintTarget` both reach by walking `.cause`. 23505 = unique_violation.
      const error = await insertPerson(probe, "B", "owner@x.com")
        .then(() => undefined)
        .catch((e: unknown) => e);
      expect(pgErrorCode(error)).toBe("23505");
      // Prove it is THIS index that fired, not some other unique constraint (id, say). Asked as the
      // table and key PostgreSQL reports, which is the identity `asEmailTaken` compares on, rather
      // than as the constraint NAME this branch retired.
      expect(constraintTarget(error)).toEqual(PERSONS_EMAIL);
    } finally {
      await probe.close();
    }
  });

  it("allows multiple persons with NULL email", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await insertPerson(probe, "A", null);
      await expect(insertPerson(probe, "B", null)).resolves.toBeDefined();
    } finally {
      await probe.close();
    }
  });
});
