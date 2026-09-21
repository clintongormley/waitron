// Real PostgreSQL, not PGlite: the first case watches the change rows from a SECOND connection while
// the writing transaction is still open, and PGlite serialises every query onto its one backend, so
// there is no second session there to keep in the dark (CLAUDE.md §4). The older reason —
// notifications crossing connections — is retired: the trigger writes a row into `change_log`
// instead of signalling, and `withTransaction` delivers it in this process (`change-log.ts`).
//
// What the observer establishes about THIS code, rather than about PostgreSQL's visibility rules:
// that the trigger writes its row INSIDE the transaction that caused the change, and not out of band
// through some connection of its own. A session reading its own `change_log` sees the row either
// way, so no single-session read separates the two; an out-of-band write would be visible to this
// observer immediately, and what the first case asserts is that it sees nothing until the commit
// returns — which is also what stops another transaction's drain taking the row early. MVCC is what
// makes the observation possible; the trigger's placement is what is under test.
//
// Replica mode is NOT what keeps this suite on a container. Measured on PGlite 0.5.8 on 2026-09-21,
// with `installChangeFeed` over `locations` and the update run under
// `set local session_replication_role = replica`: the trigger left `ENABLE ALWAYS` wrote its two
// rows, and the same trigger downgraded to a plain `enable` wrote none. So PGlite honours the mode
// and its negative control fails the right way.
import pg from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "./testing/lifecycle.js";
import { installChangeFeed } from "./change-feed.js";

describe("database change feed", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.execute(sql`
      create table live_probe (id text primary key, tenant_id text not null, printer_id text, secret text);
      grant select, insert, update, delete on live_probe to app_user;
      create table live_probe_alone (id text primary key, tenant_id text not null);
      grant select, insert, update, delete on live_probe_alone to app_user
    `);
    await installChangeFeed(suite.admin, [
      {
        table: "live_probe",
        type: "print-job",
        related: [{ type: "printer", column: "printer_id" }],
      },
      // A source with no related objects at all — most of the real sources are this shape, and the
      // trigger takes its related list as a literal argument, so an omitted list has to become an
      // empty JSON array rather than the word "undefined".
      { table: "live_probe_alone", type: "alone" },
    ]);
  });

  /**
   * What the change log holds, read on the given connection.
   *
   * Sorted by their rendered JSON rather than read in table order. Nothing downstream reads the
   * order two changes arrive in: the dashboard's live API gathers a batch's identities into a
   * `Map` and flushes the values (`apps/server/src/live-api.ts`, `const pending = new Map<…>`).
   * What the assertions below rest on is the event COUNT and each event's contents; the sort
   * leaves both alone.
   */
  async function changeRows(connection: pg.Client): Promise<unknown[]> {
    const { rows } = await connection.query<{ payload: unknown }>("select payload from change_log");
    return rows
      .map((row) => row.payload)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  async function withObserver(body: (observer: pg.Client) => Promise<void>): Promise<void> {
    const observer = new pg.Client({ connectionString: suite.pg.uri });
    await observer.connect();
    try {
      await body(observer);
    } finally {
      await observer.end();
    }
  }

  it("writes identities no other session can see until the transaction commits, including a related object's", async () => {
    await withObserver(async (observer) => {
      await suite.admin.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        const role = await tx.execute<{ rolsuper: boolean }>(
          sql`select rolsuper from pg_roles where rolname = current_user`,
        );
        expect(role.rows).toEqual([{ rolsuper: false }]);
        await tx.execute(
          sql`insert into live_probe values ('j1', 'tenant-a', 'p1', 'must not leave database')`,
        );
        // The writing transaction can read its own change row back — that is what the drain does —
        // but nobody else may, because it is not committed yet.
        expect(await changeRows(observer)).toEqual([]);
      });
      expect(await changeRows(observer)).toEqual([
        {
          resources: [
            { type: "print-job", id: "j1" },
            { type: "printer", id: "p1" },
          ],
        },
      ]);
    });
  });

  it("records a source that declares no related objects, carrying only its own identity", async () => {
    await withObserver(async (observer) => {
      await suite.admin.execute(sql`insert into live_probe_alone values ('a1', 'tenant-a')`);
      expect(await changeRows(observer)).toEqual([{ resources: [{ type: "alone", id: "a1" }] }]);
    });
  });

  it("discards rolled-back changes, with a committed change as the control", async () => {
    await withObserver(async (observer) => {
      await expect(
        suite.admin.transaction(async (tx) => {
          await tx.execute(
            sql`insert into live_probe values ('rolled-back', 'tenant-a', null, null)`,
          );
          throw new Error("rollback probe");
        }),
      ).rejects.toThrow("rollback probe");
      await suite.admin.execute(
        sql`insert into live_probe values ('committed', 'tenant-a', null, null)`,
      );
      expect(await changeRows(observer)).toEqual([
        { resources: [{ type: "print-job", id: "committed" }] },
      ]);
    });
  });

  it("fires in replica mode and invalidates both sides of a relationship change", async () => {
    await withObserver(async (observer) => {
      await suite.admin.execute(
        sql`insert into live_probe values ('moving', 'tenant-a', 'p-before', null)`,
      );
      await suite.admin.execute(sql`delete from change_log`);
      await suite.admin.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update live_probe set printer_id = 'p-after' where id = 'moving'`);
      });
      expect(await changeRows(observer)).toEqual([
        {
          resources: [
            { type: "print-job", id: "moving" },
            { type: "printer", id: "p-after" },
          ],
        },
        {
          resources: [
            { type: "print-job", id: "moving" },
            { type: "printer", id: "p-before" },
          ],
        },
      ]);
    });
  });
});
