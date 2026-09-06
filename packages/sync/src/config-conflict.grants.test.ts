import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// PostgreSQL exercises app_user's conflict INSERT/SELECT grants and withheld UPDATE/DELETE grants.
// PGlite's superuser sessions cannot check these privileges. SQLSTATE is read from the wrapped
// PostgreSQL error, rather than Drizzle's generic query-error message.
const postgres = useTemplateDb({ template: "manifest" });

describe("sync_config_conflicts grants", () => {
  it("app_user can INSERT and SELECT a rejected config row, but cannot UPDATE or DELETE it", async () => {
    const app = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      await app.execute(
        sql`insert into sync_config_conflicts (table_name, origin_id, lane, row_image)
            values ('products', gen_random_uuid(), 'ordered', '{"id":"p1","tenant_id":"t1"}'::jsonb)`,
      );
      const rows = await app.execute<{ row_image: unknown }>(
        sql`select row_image from sync_config_conflicts`,
      );
      expect(rows.rows).toEqual([{ row_image: { id: "p1", tenant_id: "t1" } }]);
      for (const statement of [
        sql`update sync_config_conflicts set lane = 'fast'`,
        sql`delete from sync_config_conflicts`,
      ]) {
        expect(pgErrorCode(await captureError(() => app.execute(statement)))).toBe("42501");
      }
    } finally {
      try {
        await postgres.admin.execute(sql`delete from sync_config_conflicts`);
      } finally {
        await app.close();
      }
    }
  });
});
