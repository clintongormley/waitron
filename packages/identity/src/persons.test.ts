import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// What survives here is a COLUMN DEFAULT, not a privilege: this is the only insert of a person
// anywhere in the repo that omits `role` — every fixture passes it explicitly (test/fixtures.ts's
// seedPerson) — so `person_role DEFAULT 'staff'` has no other guard. A default is enforced on any
// target, so this file is a candidate for the PGlite tier once the suites are re-tagged; it still
// runs through the probe login below only because that is the connection this suite already had.
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";

const PIN = hashPin("1234");

// A clone of the `core_identity` template (CORE + IDENTITY).
const suite = useTemplateDb({ template: "core_identity" });

describe("persons column defaults", () => {
  it("a person inserted without a role reads back with the column default 'staff'", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${tenantId}, 'Ana', ${PIN})`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ display_name: string; role: string }>(sql`
          select display_name, role from persons where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ display_name: "Ana", role: "staff" }]);
    } finally {
      await probe.close();
    }
  });
});
