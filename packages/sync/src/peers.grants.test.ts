import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// Real Postgres, not PGlite: this suite proves the sync_peers grant SPLIT under genuine
// non-superuser roles — sync_retention holds SELECT/INSERT/UPDATE but not DELETE, and sync_tailer
// holds only SELECT plus a COLUMN-level UPDATE(last_seen_at), so it can stamp a sighting but cannot
// flip `active` (the revocation control). PGlite connects every session as a superuser and bypasses
// all of it, so it is a false pass here (CLAUDE.md §4). A refused privilege arrives as SQLSTATE
// 42501, wrapped by drizzle's DrizzleQueryError whose own `.message` is `Failed query: <sql>` — the
// "permission denied" text lives on `.cause`, so the negative controls read the code off it with
// pgErrorCode rather than matching the wrapper message (packages/db/src/testing/errors.ts).
const postgres = useTemplateDb({ template: "manifest" });

describe("sync_peers grants", () => {
  it("sync_retention can INSERT/SELECT/UPDATE but NOT DELETE", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
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
      await pruner.close();
    }
  });

  it("sync_tailer can SELECT and UPDATE(last_seen_at) but NOT flip active, INSERT or DELETE", async () => {
    // Seed a row as admin (superuser bypasses grants for setup).
    const seeded = await postgres.admin.execute<{ id: string }>(
      sql`insert into sync_peers (subscriber_id, name, token_hash)
          values ('peerB', 'Peer B', 'scrypt$aa$bb') returning id`,
    );
    const id = seeded.rows[0]!.id;
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const sel = await tailer.execute(sql`select 1 from sync_peers where id = ${id}::uuid`);
      expect(sel.rows.length).toBe(1);
      // last_seen_at write is allowed (column grant)
      await tailer.execute(sql`update sync_peers set last_seen_at = now() where id = ${id}::uuid`);
      // flipping active is refused (column grant does not cover it)
      expect(
        pgErrorCode(
          await captureError(() =>
            tailer.execute(sql`update sync_peers set active = false where id = ${id}::uuid`),
          ),
        ),
      ).toBe("42501");
      // INSERT is refused (no INSERT grant)
      expect(
        pgErrorCode(
          await captureError(() =>
            tailer.execute(
              sql`insert into sync_peers (subscriber_id, name, token_hash) values ('x','x','x')`,
            ),
          ),
        ),
      ).toBe("42501");
      // DELETE is refused (no DELETE grant)
      expect(
        pgErrorCode(
          await captureError(() =>
            tailer.execute(sql`delete from sync_peers where id = ${id}::uuid`),
          ),
        ),
      ).toBe("42501");
    } finally {
      await tailer.close();
    }
  });
});
