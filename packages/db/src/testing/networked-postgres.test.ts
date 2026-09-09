import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Network, type StartedNetwork } from "testcontainers";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { dockerAvailable } from "./harness.js";
import { networkedPostgresContainer, networkNodeName } from "./postgres.js";

describe.runIf(dockerAvailable())("networked PostgreSQL", () => {
  let network: StartedNetwork | undefined;
  let container: StartedPostgreSqlContainer | undefined;

  beforeAll(async () => {
    network = await new Network().start();
    container = await networkedPostgresContainer(network, "probe").start();
  });

  afterAll(async () => {
    if (container !== undefined) await container.stop();
    if (network !== undefined) await network.stop();
  });

  it("has only one Ethernet interface, with its name resolvable on that network", async () => {
    const interfaces = await container!.exec(["sh", "-c", "ls /sys/class/net | sed -n '/^eth/p'"]);
    expect(interfaces.exitCode).toBe(0);
    expect(interfaces.output.trim().split("\n")).toEqual(["eth0"]);
    const resolved = await container!.exec(["getent", "hosts", networkNodeName(network!, "probe")]);
    expect(resolved.exitCode).toBe(0);
  });

  it("round-trips a host query larger than an Ethernet frame", async () => {
    const client = new pg.Client({
      connectionString: container!.getConnectionUri(),
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    await client.connect();
    try {
      const payload = "x".repeat(100_000);
      expect((await client.query("SELECT $1::text AS payload", [payload])).rows).toEqual([
        { payload },
      ]);
    } finally {
      await client.end();
    }
  });
});
