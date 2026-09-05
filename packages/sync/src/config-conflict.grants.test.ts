import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// Real Postgres, not PGlite: this suite proves the `sync_config_conflicts` grant SPLIT under genuine
// non-superuser roles — `row_image` is a jsonb copy of a rejected CONFIG row (tenant business data),
// so its READ surface is the dedicated NOLOGIN `sync_tailer` role, exactly the isolation `sync_log`
// enforces (0000_sync_outbox.sql:52-95). `app_user` may only RECORD a conflict (INSERT), never read
// it back cross-tenant — so `app_user` holds INSERT and NOT SELECT, while `sync_tailer` holds SELECT.
// PGlite connects every session as a superuser and bypasses all of it, a false pass here (CLAUDE.md
// §4). A refused privilege arrives as SQLSTATE 42501, wrapped by drizzle's DrizzleQueryError whose
// own `.message` is `Failed query: <sql>` — the "permission denied" text lives on `.cause`, so the
// negative control reads the code off it with pgErrorCode rather than matching the wrapper message
// (packages/db/src/testing/errors.ts). `app_login` is a LOGIN member of `app_user`, `sync_reader` a
// LOGIN member of `sync_tailer` — both created once in the shared-container global setup.
const postgres = useTemplateDb({ template: "manifest" });

describe("sync_config_conflicts grants", () => {
  it("sync_tailer can SELECT (the dedicated read surface)", async () => {
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      // No tenant_id / RLS on this table, so a bare count as sync_tailer is the whole read path
      // (box-status's readConfigConflictCount). It must succeed at the privilege layer.
      const sel = await reader.execute<{ count: number }>(
        sql`select count(*)::int as count from sync_config_conflicts`,
      );
      expect(sel.rows[0]!.count).toBeGreaterThanOrEqual(0);
    } finally {
      await reader.close();
    }
  });

  it("app_user can INSERT (records a rejected config row) but NOT SELECT (no cross-tenant read)", async () => {
    const app = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      // INSERT is granted — the apply path RECORDS a conflict through the app pool. No RETURNING:
      // RETURNING would need SELECT on the returned column, which app_user deliberately lacks.
      await app.execute(
        sql`insert into sync_config_conflicts (table_name, origin_id, lane, row_image)
            values ('products', gen_random_uuid(), 'ordered', ${JSON.stringify({ id: "p1", tenant_id: "t1" })}::jsonb)`,
      );
      // Negative control: SELECT is refused at the privilege layer (no SELECT grant to app_user) —
      // this is the isolation the finding is about. `row_image` carries every tenant's rejected row,
      // so the app role must never be able to read it back.
      expect(
        pgErrorCode(
          await captureError(() => app.execute(sql`select count(*) from sync_config_conflicts`)),
        ),
      ).toBe("42501");
    } finally {
      await app.close();
    }
  });
});
