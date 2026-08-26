import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// A non-superuser LOGIN role inheriting app_user's grants — the same probe persons.rls.test.ts uses.
// locale rides on the table-level GRANT SELECT, INSERT, UPDATE that persons already holds
// (drizzle/0001_identity_rls.sql), so a new nullable column needs no grant or RLS change: this suite
// proves the app role can write and read it under FORCE ROW LEVEL SECURITY, which PGlite (superuser,
// RLS-bypassing) cannot show.
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";

const PIN = hashPin("1234");

const suite = useTemplateDb({ template: "core_identity" });

describe("persons.locale under real row-level security", () => {
  it("app_user can set and read its own tenant's person.locale", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const personId = await withTenant(probe, tenantId, async (tx) => {
        const [row] = (
          await tx.execute<{ id: string }>(sql`
            insert into persons (tenant_id, display_name, pin_hash, locale)
            values (${tenantId}, 'Ana', ${PIN}, 'en-GB')
            returning id`)
        ).rows;
        return row!.id;
      });
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update persons set locale = 'es-ES' where id = ${personId}`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ locale: string }>(sql`select locale from persons where id = ${personId}`),
      );
      expect(rows.rows).toEqual([{ locale: "es-ES" }]);
    } finally {
      await probe.close();
    }
  });
});
