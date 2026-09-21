// Two PostgreSQL nodes exercise the actual logical apply worker, which skips ordinary triggers.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { quoteLiteral } from "@waitron/shared";
import { createPostgresDb } from "./client.js";
import { installChangeFeed } from "./change-feed.js";
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
          // `change_log` by hand rather than by running the core migration set: this suite builds
          // its own probe table too, and the two columns below are the whole of
          // `packages/db/src/schema/change-log.ts`. What it must match is the column the trigger
          // writes, `payload`.
          await db.execute(
            sql`create table change_log (id uuid primary key default gen_random_uuid(), payload jsonb not null)`,
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
    // Read on node B, where the apply worker runs. Sorted by their rendered JSON: nothing
    // downstream reads the order two changes arrive in — the dashboard's live API gathers a
    // batch's identities into a `Map` and flushes the values (`apps/server/src/live-api.ts`,
    // `const pending = new Map<…>`). The assertions rest on the event COUNT and each event's
    // contents, not on their order.
    const changesOnB = async (): Promise<unknown[]> => {
      const rows = (await nodeB.query("select payload from change_log")) as { payload: unknown }[];
      return rows
        .map((row) => row.payload)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    };
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
      await vi.waitFor(async () =>
        expect(await changesOnB()).toEqual([
          {
            resources: [
              { type: "print_jobs", id: "job" },
              { type: "printers", id: "printer" },
            ],
          },
        ]),
      );
      await nodeB.run("delete from change_log");
      await nodeA.run("update live_replica_probe set printer_id = 'new-printer' where id = 'job'");
      await vi.waitFor(async () =>
        expect(await changesOnB()).toEqual([
          {
            resources: [
              { type: "print_jobs", id: "job" },
              { type: "printers", id: "new-printer" },
            ],
          },
          {
            resources: [
              { type: "print_jobs", id: "job" },
              { type: "printers", id: "printer" },
            ],
          },
        ]),
      );
      await nodeB.run("delete from change_log");
      await nodeA.run("delete from live_replica_probe where id = 'job'");
      await vi.waitFor(async () =>
        expect(await changesOnB()).toEqual([
          {
            resources: [
              { type: "print_jobs", id: "job" },
              { type: "printers", id: "new-printer" },
            ],
          },
        ]),
      );
    } finally {
      await nodeB.run("drop subscription live_probe_subscription");
    }
  }, 90_000);
});
