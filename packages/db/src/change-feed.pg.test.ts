// Real PostgreSQL is required: notifications cross connections and arrive at transaction commit.
import pg from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTemplateDb } from "./testing/lifecycle.js";
import { installChangeFeed } from "./change-feed.js";
import { startChangeListener } from "./change-listener.js";

describe("database change feed", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.execute(sql`
      create table live_probe (id text primary key, tenant_id text not null, printer_id text, secret text);
      grant select, insert, update, delete on live_probe to app_user
    `);
    await installChangeFeed(suite.admin, [
      {
        table: "live_probe",
        type: "print-job",
        related: [{ type: "printer", column: "printer_id" }],
      },
    ]);
  });

  it("publishes identities only after commit, including a related object's identity", async () => {
    const listener = new pg.Client({ connectionString: suite.pg.uri });
    const received: unknown[] = [];
    await listener.connect();
    try {
      listener.on("notification", (notification) =>
        received.push(JSON.parse(notification.payload!)),
      );
      await listener.query("listen waitron_changes");
      await suite.admin.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        const role = await tx.execute<{ rolsuper: boolean }>(
          sql`select rolsuper from pg_roles where rolname = current_user`,
        );
        expect(role.rows).toEqual([{ rolsuper: false }]);
        await tx.execute(
          sql`insert into live_probe values ('j1', 'tenant-a', 'p1', 'must not leave database')`,
        );
        await listener.query("select 1");
        expect(received).toEqual([]);
      });
      await vi.waitFor(() =>
        expect(received).toEqual([
          {
            tenantId: "tenant-a",
            resources: [
              { type: "print-job", id: "j1" },
              { type: "printer", id: "p1" },
            ],
          },
        ]),
      );
    } finally {
      await listener.end();
    }
  });

  it("discards rolled-back changes, with a committed change as the delivery control", async () => {
    const listener = new pg.Client({ connectionString: suite.pg.uri });
    const received: unknown[] = [];
    await listener.connect();
    try {
      listener.on("notification", (notification) =>
        received.push(JSON.parse(notification.payload!)),
      );
      await listener.query("listen waitron_changes");
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
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received).toEqual([
        { tenantId: "tenant-a", resources: [{ type: "print-job", id: "committed" }] },
      ]);
    } finally {
      await listener.end();
    }
  });

  it("fires in replica mode and invalidates both sides of a relationship change", async () => {
    const listener = new pg.Client({ connectionString: suite.pg.uri });
    const received: unknown[] = [];
    await listener.connect();
    try {
      await suite.admin.execute(
        sql`insert into live_probe values ('moving', 'tenant-a', 'p-before', null)`,
      );
      listener.on("notification", (notification) =>
        received.push(JSON.parse(notification.payload!)),
      );
      await listener.query("listen waitron_changes");
      await suite.admin.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update live_probe set printer_id = 'p-after' where id = 'moving'`);
      });
      await vi.waitFor(() => expect(received).toHaveLength(2));
      expect(received).toEqual([
        {
          tenantId: "tenant-a",
          resources: [
            { type: "print-job", id: "moving" },
            { type: "printer", id: "p-before" },
          ],
        },
        {
          tenantId: "tenant-a",
          resources: [
            { type: "print-job", id: "moving" },
            { type: "printer", id: "p-after" },
          ],
        },
      ]);
    } finally {
      await listener.end();
    }
  });

  it("reconnects a terminated listener and signals a snapshot refresh", async () => {
    const changed = vi.fn();
    const reset = vi.fn();
    const listener = await startChangeListener(suite.pg.uri, { onChange: changed, onReset: reset });
    try {
      expect(reset).toHaveBeenCalledOnce();
      await suite.admin.execute(
        sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and application_name = 'waitron-live-updates'`,
      );
      await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(2), { timeout: 5000 });
      await suite.admin.execute(
        sql`insert into live_probe values ('after-reconnect', 'tenant-a', null, null)`,
      );
      await vi.waitFor(() =>
        expect(changed).toHaveBeenCalledWith({
          tenantId: "tenant-a",
          resources: [{ type: "print-job", id: "after-reconnect" }],
        }),
      );
    } finally {
      await listener.close();
    }
    const connections = await suite.admin.execute<{ count: number }>(
      sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and application_name = 'waitron-live-updates'`,
    );
    expect(connections.rows).toEqual([{ count: 0 }]);
  });
});
