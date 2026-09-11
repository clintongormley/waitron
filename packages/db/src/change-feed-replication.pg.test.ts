// Two PostgreSQL nodes exercise the actual logical apply worker, which skips ordinary triggers.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { quoteLiteral } from "@waitron/shared";
import { createPostgresDb } from "./client.js";
import { installChangeFeed } from "./change-feed.js";
import { startChangeListener } from "./change-listener.js";
import { startTwoNodeCluster, type TwoNodeCluster } from "./testing/two-node.js";

import { startTwoNodeWireguardCluster } from "./testing/two-node-wireguard.js";

describe.each(["LAN", "WireGuard"] as const)("replicated change feed over %s", (transport) => {
  let cluster: TwoNodeCluster | undefined;
  beforeAll(async () => {
    const start = transport === "LAN" ? startTwoNodeCluster : startTwoNodeWireguardCluster;
    cluster = await start({
      dockerRequired: true,
      migrate: async (uri) => {
        const db = await createPostgresDb(uri);
        try {
          await db.execute(
            sql`create table live_replica_probe (id text primary key, tenant_id text not null, printer_id text)`,
          );
          await installChangeFeed(db, [
            {
              table: "live_replica_probe",
              type: "print_jobs",
              related: [{ type: "printers", column: "printer_id" }],
            },
          ]);
        } finally {
          await db.close();
        }
      },
    });
  }, 300_000);
  afterAll(async () => {
    await cluster?.stop();
  });

  it("publishes printer identities when a mirror applies a replicated job", async () => {
    const { nodeA, nodeB } = cluster!;
    await nodeA.run("create publication live_probe_publication for table live_replica_probe");
    const upstream = new URL(nodeA.uri);
    upstream.hostname = "tunnelHost" in nodeA ? String(nodeA.tunnelHost) : nodeA.networkHost;
    upstream.port = "5432";
    await nodeB.run(
      `create subscription live_probe_subscription connection ${quoteLiteral(upstream.href)} publication live_probe_publication`,
    );
    const changed = vi.fn();
    const listener = await startChangeListener(nodeB.uri, { onChange: changed, onReset: () => {} });
    try {
      await vi.waitFor(
        async () =>
          expect(await nodeB.query("select srsubstate from pg_subscription_rel")).toEqual([
            { srsubstate: "r" },
          ]),
        { timeout: 15_000 },
      );
      await nodeA.run("insert into live_replica_probe values ('job', 'tenant', 'printer')");
      await vi.waitFor(
        async () =>
          expect(await nodeB.query("select id from live_replica_probe")).toEqual([{ id: "job" }]),
        { timeout: 15_000 },
      );
      await vi.waitFor(() =>
        expect(changed).toHaveBeenCalledWith({
          tenantId: "tenant",
          resources: [
            { type: "print_jobs", id: "job" },
            { type: "printers", id: "printer" },
          ],
        }),
      );
      changed.mockClear();
      await nodeA.run("update live_replica_probe set printer_id = 'new-printer' where id = 'job'");
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
      expect(changed.mock.calls.map(([event]) => event)).toEqual([
        {
          tenantId: "tenant",
          resources: [
            { type: "print_jobs", id: "job" },
            { type: "printers", id: "printer" },
          ],
        },
        {
          tenantId: "tenant",
          resources: [
            { type: "print_jobs", id: "job" },
            { type: "printers", id: "new-printer" },
          ],
        },
      ]);
      changed.mockClear();
      await nodeA.run("delete from live_replica_probe where id = 'job'");
      await vi.waitFor(() =>
        expect(changed).toHaveBeenCalledExactlyOnceWith({
          tenantId: "tenant",
          resources: [
            { type: "print_jobs", id: "job" },
            { type: "printers", id: "new-printer" },
          ],
        }),
      );
    } finally {
      await listener.close();
      await nodeB.run("drop subscription live_probe_subscription");
    }
  }, 30_000);
});
