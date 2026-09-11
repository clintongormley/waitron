// Two PostgreSQL nodes exercise the actual logical apply worker, which skips ordinary triggers.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { quoteLiteral } from "@waitron/shared";
import { createPostgresDb } from "./client.js";
import { installChangeFeed } from "./change-feed.js";
import { startChangeListener } from "./change-listener.js";
import { startTwoNodeCluster, type TwoNodeCluster } from "./testing/two-node.js";

let cluster: TwoNodeCluster | undefined;
beforeAll(async () => {
  cluster = await startTwoNodeCluster({
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
}, 180_000);
afterAll(async () => {
  await cluster?.stop();
});

it("publishes printer identities when a mirror applies a replicated job", async () => {
  const { nodeA, nodeB } = cluster!;
  await nodeA.run("create publication live_probe_publication for table live_replica_probe");
  const upstream = new URL(nodeA.uri);
  upstream.hostname = nodeA.networkHost;
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
  } finally {
    await listener.close();
    await nodeB.run("drop subscription live_probe_subscription");
  }
}, 30_000);
