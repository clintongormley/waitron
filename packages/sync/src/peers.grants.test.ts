import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// PostgreSQL exercises app_user's peer grants through a LOGIN member. Peers deactivate via active;
// DELETE remains refused. PGlite's superuser sessions cannot check these privileges. SQLSTATE is
// read from the wrapped PostgreSQL error, rather than Drizzle's generic query-error message.
const postgres = useTemplateDb({ template: "manifest" });

describe("sync_peers grants", () => {
  it("app_user can INSERT/SELECT/UPDATE but NOT DELETE", async () => {
    const pruner = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const ins = await pruner.execute<{ id: string }>(
        sql`insert into sync_peers (subscriber_id, name, token_hash)
            values ('peerA', 'Peer A', 'scrypt$aa$bb') returning id`,
      );
      const id = ins.rows[0]!.id;
      await pruner.execute(sql`update sync_peers set active = false where id = ${id}::uuid`);
      const sel = await pruner.execute(sql`select 1 from sync_peers where id = ${id}::uuid`);
      expect(sel.rows.length).toBe(1);
      // Negative control: DELETE is refused at the privilege layer (no DELETE grant).
      expect(
        pgErrorCode(
          await captureError(() =>
            pruner.execute(sql`delete from sync_peers where id = ${id}::uuid`),
          ),
        ),
      ).toBe("42501");
    } finally {
      try {
        await postgres.admin.execute(sql`delete from sync_peers`);
      } finally {
        await pruner.close();
      }
    }
  });
});
