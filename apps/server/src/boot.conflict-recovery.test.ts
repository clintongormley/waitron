import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { locations, nodes, withTransaction } from "@waitron/db";
import { withNodeTransaction } from "@waitron/db";
import { setRecoveryKeyTx } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret } from "@waitron/identity";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import {
  seedLiveConflict,
  liveConflictNode,
} from "@waitron/fiscal-verifactu/test/live-conflict-fixture.js";
import { TENANT_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@waitron/module", async (original) => {
  const actual = await original<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: async () => emptyDrainResult(),
    }),
  };
});
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const { startServer, beforeServerStarts } = serverFixture();
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

it("serves the cold recovery URL and authenticates its enabled module route at real HTTPS boot without a session", async () => {
  beforeServerStarts();
  let wall = Date.now() - 120_000;
  let monotonic = 0;
  const conflict = await seedLiveConflict(suite.db, {
    wall: () => wall,
    monotonic: () => monotonic,
    advance: (ms) => {
      wall += ms;
      monotonic += ms;
    },
  });
  await withTransaction(suite.db, async (tx) => {
    await tx.delete(nodes).where(eq(nodes.id, TENANT_B.nodeId));
    await tx.delete(locations).where(eq(locations.id, TENANT_B.locationId));
  });
  const key = "synthetic-boot-current-recovery-key";
  await withNodeTransaction(suite.node, (tx) =>
    setRecoveryKeyTx(tx, liveConflictNode.nodeId, hashSecret(key), "boot-key-1"),
  );
  const scratch = await mkdtemp(join(tmpdir(), "conflict-boot-"));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
  await copyMigrationsRoot(join(scratch, "migrations"));
  await mkdir(join(scratch, "dashboard"));
  await writeFile(
    join(scratch, "dashboard/index.html"),
    "<html><body>recovery-dashboard-entry</body></html>",
  );
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const material = mintMtlsMaterial();
  await writeFile(join(scratch, "server.crt"), material.serverCertPem);
  await writeFile(join(scratch, "server.key"), material.serverKeyPem);
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  const server = await startServer({
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: liveConflictNode.nodeId,
    WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
    WAITRON_ENV: "preproduction",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_TLS_CERT_FILE: join(scratch, "server.crt"),
    WAITRON_TLS_KEY_FILE: join(scratch, "server.key"),
    WAITRON_DASHBOARD_APP_DIR: join(scratch, "dashboard"),
  });
  cleanups.push(() => server.close());
  const { via, close } = httpsVia(material.caPem);
  cleanups.push(close);
  const origin = `https://127.0.0.1:${port}`;
  const cold = await fetch(`${origin}/manage/recovery/fiscal-conflict`, {
    ...via,
    headers: { accept: "text/html" },
  });
  expect(cold.status).toBe(200);
  expect(await cold.text()).toBe("<html><body>recovery-dashboard-entry</body></html>");
  await expect(
    fetch(`http://127.0.0.1:${port}/api/module-recovery/fiscal-verifactu/conflict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    }),
  ).rejects.toBeInstanceOf(TypeError);
  const inspect = (recoveryKey: string) =>
    fetch(`${origin}/api/module-recovery/fiscal-verifactu/conflict`, {
      ...via,
      method: "POST",
      headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({
        recoveryKey,
        eventId: "boot-inspection",
        oldMachineOffline: false,
        noParallelRecovery: false,
        command: { kind: "status" },
      }),
    });
  const refused = await inspect("wrong-key");
  expect(refused.status).toBe(401);
  expect(await refused.json()).toMatchObject({ error: { code: "promotion.break_glass_invalid" } });
  const response = await inspect(key);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    kind: "status",
    active: [{ ...conflict }],
    event: { kind: "none" },
  });
});
