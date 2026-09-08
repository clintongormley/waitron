// Real PostgreSQL: app_user's grants on `bookings`, read back from the live catalog (CLAUDE.md §3/§4).
// PGlite is a superuser holding every grant, so it cannot answer a privilege matrix. The whole-manifest
// matrix in @waitron/fiscal-verifactu pins the same row from the other side; this suite proves the
// MODULE's own set grants it correctly, applied over the whole manifest (the `manifest` template —
// bookings FKs into core, so the fixtures apply the whole chain).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { PRIVILEGES } from "./privileges.expected.js";

const suite = useTemplateDb({ template: "manifest" });

describe("app_user's privileges on bookings are exactly SELECT, INSERT, UPDATE", () => {
  it("holds S, I, U and NOT DELETE / TRUNCATE (has_table_privilege)", async () => {
    const { rows } = await suite.admin.execute<{ privs: string }>(sql`
      select
        (case when has_table_privilege('app_user', 'bookings', 'SELECT') then 'S' else '' end) ||
        (case when has_table_privilege('app_user', 'bookings', 'INSERT') then 'I' else '' end) ||
        (case when has_table_privilege('app_user', 'bookings', 'UPDATE') then 'U' else '' end) ||
        (case when has_table_privilege('app_user', 'bookings', 'DELETE') then 'D' else '' end) ||
        (case when has_table_privilege('app_user', 'bookings', 'TRUNCATE') then 'T' else '' end) as privs`);
    expect(rows[0]!.privs).toBe(PRIVILEGES.bookings); // "SIU"
  });

  it("the relacl grants app_user exactly arw, never d/D — the grant sits ON the role, not via membership", async () => {
    // CLAUDE.md §3: `has_table_privilege` can be satisfied through group membership and a failed GRANT
    // still materialises an ACL, so read the row's ACL back and confirm app_user's own entry is exactly
    // `arw`. ACL letters: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, D=TRUNCATE.
    const { rows } = await suite.admin.execute<{ acl: string }>(sql`
      select acl from (
        select unnest(relacl)::text as acl from pg_class where oid = 'public.bookings'::regclass
      ) entries
      where acl like 'app_user=%'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.acl).toMatch(/^app_user=arw\//);
  });
});
