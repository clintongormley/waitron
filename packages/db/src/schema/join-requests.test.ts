import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("join_requests", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    // operation_description is Spanish test DATA, not a schema identifier, exactly as the sibling
    // devices/kitchen-stations tests use 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  it("accepts a device request and a print_agent request in the same tenant", async () => {
    await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into join_requests
          (tenant_id, location_id, kind, label, token_hash, verification_number, decoy_numbers)
        values
          (${TENANT_A}, ${LOCATION_A}, 'device', 'Bar till', 'h1', '47', array['12', '83']),
          (${TENANT_A}, ${LOCATION_A}, 'print_agent', 'Kitchen box', 'h2', '13', array['04', '91'])`);
      const rows = await tx.execute<{ kind: string; verification_number: string }>(
        sql`select kind, verification_number from join_requests order by kind`,
      );
      expect(rows.rows.map((r) => r.kind)).toEqual(["device", "print_agent"]);
    });
  });

  it("refuses an unknown kind", async () => {
    await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      const e = await captureError(() =>
        tx.execute(sql`
          insert into join_requests
            (tenant_id, location_id, kind, label, token_hash, verification_number, decoy_numbers)
          values (${TENANT_A}, ${LOCATION_A}, 'kitchen_sink', 'x', 'h', '00', array['01', '02'])`),
      );
      expect(pgErrorCode(e)).toBe("22P02"); // invalid_text_representation — not a valid enum label
    });
  });

  it("grants app_user SELECT, INSERT and DELETE but not UPDATE", async () => {
    const { rows } = await suite.admin.execute<{ privs: string }>(sql`
      select
        case when has_table_privilege('app_user','join_requests','SELECT') then 'S' else '' end ||
        case when has_table_privilege('app_user','join_requests','INSERT') then 'I' else '' end ||
        case when has_table_privilege('app_user','join_requests','UPDATE') then 'U' else '' end ||
        case when has_table_privilege('app_user','join_requests','DELETE') then 'D' else '' end
        as privs`);
    expect(rows[0]!.privs).toBe("SID");
  });
});
