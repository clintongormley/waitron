import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PRIVILEGES } from "./privileges.expected.js";

/**
 * `app_user`'s table privileges, pinned to the matrix captured before the RLS drop
 * (`privileges.expected.ts`). Spec §1: dropping row-level security, the helper roles and the
 * migration chain must leave the app role's reach untouched, and this is what says so.
 *
 * It lives in this package, not `packages/db`, because the matrix must cover EVERY module's tables
 * and this package's shared template already migrates the whole manifest
 * (`src/testing/global-setup.ts`), so a table added by workforce or sync is in scope with no new
 * harness — the same reason `inmutabilidad.test.ts` beside it scans the whole catalog from here.
 * Other packages migrate the manifest too (`apps/server`, `@waitron/sync`, `@waitron/provisioning`);
 * this one is where the catalog-wide guards already live.
 *
 * Real Postgres rather than the PGlite target `inmutabilidad.test.ts` uses: CLAUDE.md §4 puts
 * anything about privileges on real Postgres, and the shared container runs `POSTGRES_IMAGE`
 * (`postgres:18-alpine`), the image the matrix was captured on. It is also the cheaper target here —
 * the template is migrated once in globalSetup and this suite only clones it, where PGlite would
 * boot a WASM cluster and re-apply every migration set.
 *
 * `has_table_privilege` answers TABLE-level privilege only, so column grants are out of scope; the
 * expectation file's header records that and points at what does cover them.
 */
const suite = useTemplateDb({ template: "manifest" });

describe("app_user's table privileges are exactly the captured matrix", () => {
  it("matches every table, and every table is in the matrix", async () => {
    const { rows } = await suite.admin.execute<{ relname: string; privs: string }>(sql`
      select c.relname,
        (case when has_table_privilege('app_user', c.oid, 'SELECT') then 'S' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'INSERT') then 'I' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'UPDATE') then 'U' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'DELETE') then 'D' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'TRUNCATE') then 'T' else '' end) as privs
      from pg_class c
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and c.relname not like '\\_\\_drizzle%'
      order by 1`);
    const live = Object.fromEntries(rows.map((r) => [r.relname, r.privs]));
    // toEqual, never toMatchObject: a key the matrix does not list is not checked at all by a
    // matcher (CLAUDE.md §4), so a new table arriving with grants would pass unnoticed — which is
    // half of what this guard is for. The other half is a table LOSING a grant.
    expect(live).toEqual(PRIVILEGES);
  });

  it("is not vacuous: the matrix names the fiscal table and grants it no UPDATE", () => {
    expect(PRIVILEGES.registros_facturacion).toBe("SI");
  });
});
