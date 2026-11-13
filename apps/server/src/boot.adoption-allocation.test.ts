import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { invoiceSeries, locations, nodes, stampDeployment, tenants } from "@waitron/db";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  sealNodeSigningKeyTx,
  writePairLinkTx,
} from "@waitron/credentials";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import { withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedNode,
  seedVenue,
  seedVenueSettings,
  seedBusinessDay,
} from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { tenantCredentials } from "@waitron/credentials";
import { managementSessions } from "@waitron/identity";
import type { ModuleOperationInput, WaitronModule } from "@waitron/module";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  readPendingAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import { freePorts } from "./testing/free-ports.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { httpsVia } from "./testing/boot-harness.js";
import { writeTlsSet } from "./testing/box-tls.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import type { PeerStatusBody } from "./peer-status-api.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();
// Whether `fiscal-none` stands in for a module whose spare needs its own allocation.
const allocation = vi.hoisted(() => ({ dependent: true }));

vi.mock("./modules.js", async (original) => {
  const real = await original<typeof import("./modules.js")>();
  return {
    ...real,
    ALL_MODULES: real.ALL_MODULES.map((module) =>
      module.name !== "fiscal-none"
        ? module
        : ({
            ...module,
            get operations() {
              if (!allocation.dependent) return undefined;
              return {
                async prepare<T>(
                  operation: ModuleOperationInput,
                  run: (prepared: ModuleOperationInput) => Promise<T>,
                ): Promise<T> {
                  return run(operation);
                },
              };
            },
            provisioning: {
              standby: {
                series: "on-activation",
                async reserve() {
                  return { state: {} };
                },
                async establish() {},
              },
            },
          } satisfies WaitronModule),
    ),
  };
});
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const LOCATION = "a8000000-0000-4000-8000-000000000001";
const PRIMARY = "a8000000-0000-4000-8000-000000000002";
const STANDBY = "a8000000-0000-4000-8000-000000000003";
it("boot retains allocation-dependent adoption as pending without an ambient session or selling identity", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Boot Adoption SL" });
  await suite.db.insert(locations).values({
    id: LOCATION,
  });
  await seedVenueSettings(suite.db, {
    name: "Venue",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await seedBusinessDay(suite.db, {});
  await suite.db.insert(nodes).values({
    id: PRIMARY,
    name: "Primary",
    filingModule: "none",
    taxModule: "vat",
  });
  await stampDeployment(suite.db, "preproduction");
  await setNodeMode({ venue: suite.db, node: suite.node }, STANDBY, "mirror");
  const pending: PendingAdoption = {
    originNodeId: PRIMARY,
    standby: { nodeId: STANDBY, publicKey: "synthetic-public" },
    nodeName: "Spare",
    filingModule: "none",
    taxModule: "vat",
    reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
  };
  const scratch = await mkdtemp(join(tmpdir(), "boot-adoption-allocation-"));
  let server: StartedServer | undefined;
  try {
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": false } }),
    );
    await writePendingAdoption(scratch, pending);
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: STANDBY,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "dev",
    });
    await vi.waitFor(async () => {
      const lines = (await readFile(join(scratch, "logs", "waitron.log"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { level: string; event: string; code?: string });
      expect(
        lines
          .filter((line) => line.event.startsWith("adoption."))
          .map(({ level, event, code }) => ({ level, event, code })),
      ).toEqual([
        {
          level: "error",
          event: "adoption.establish_failed",
          code: "mirror.standby_series_unsupported",
        },
      ]);
    });
    const response = await fetch(`http://127.0.0.1:${httpPort()}/api/box/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adoption: "pending" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await readPendingAdoption(scratch)).toEqual(pending);
    expect((await suite.db.select().from(nodes)).map((node) => node.id)).toEqual([PRIMARY]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await suite.db.select().from(managementSessions)).toEqual([]);
    expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("the pending-adoption start answers the main box's signed query", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Boot Adoption SL" });
  await suite.db.insert(locations).values({
    id: LOCATION,
  });
  await seedVenueSettings(suite.db, { operationDescription: "Hospitality" });
  await seedBusinessDay(suite.db, {});
  await suite.db.insert(nodes).values({
    id: PRIMARY,
    name: "Primary",
    filingModule: "none",
    taxModule: "vat",
  });
  await stampDeployment(suite.db, "preproduction");
  await setNodeMode({ venue: suite.db, node: suite.node }, STANDBY, "mirror");
  const keyEnv = {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  };
  const standby = generateNodeKeyPair();
  const main = { nodeId: PRIMARY, ...generateNodeKeyPair() };
  await withNodeTransaction(suite.node, (tx) =>
    sealNodeSigningKeyTx(tx, loadKeyRing(keyEnv), STANDBY, standby.privateKey),
  );
  await pinMainBoxKey(suite.node, STANDBY, main);
  const scratch = await mkdtemp(join(tmpdir(), "boot-adoption-peer-status-"));
  let server: StartedServer | undefined;
  try {
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": false } }),
    );
    await writePendingAdoption(scratch, {
      originNodeId: PRIMARY,
      standby: { nodeId: STANDBY, publicKey: standby.publicKey },
      nodeName: "Spare",
      filingModule: "none",
      taxModule: "vat",
      reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
    });
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      ...keyEnv,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: STANDBY,
      WAITRON_ENV: "dev",
    });
    const nonce = "p".repeat(32);
    const response = await fetch(`http://127.0.0.1:${httpPort()}/api/node/peer-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope("query", { nonce, atMs: 1 }, main)),
    });
    expect(response.status).toBe(200);
    const verified = verifyEnvelope<PeerStatusBody>(await response.json(), "status", (id) =>
      id === STANDBY ? nodeSigningPublicKey(standby.privateKey) : undefined,
    );
    expect(verified).toEqual({
      valid: true,
      signerNodeId: STANDBY,
      body: {
        heldMembership: null,
        restriction: null,
        openOperation: null,
        requestedOperation: null,
        joining: true,
        nonce,
      },
    });
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("the pending-adoption start is handed a chart through its own route", async () => {
  await seedVenue(suite.db);
  const origin = await seedNode(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await setNodeMode({ venue: suite.db, node: suite.node }, STANDBY, "mirror");
  const scratch = await mkdtemp(join(tmpdir(), "boot-adoption-membership-"));
  let server: StartedServer | undefined;
  try {
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": false } }),
    );
    await writePendingAdoption(scratch, {
      originNodeId: origin,
      standby: { nodeId: STANDBY, publicKey: "synthetic-public" },
      nodeName: "Spare",
      filingModule: "none",
      taxModule: "vat",
      reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
    });
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: STANDBY,
      WAITRON_ENV: "dev",
    });
    const response = await fetch(`http://127.0.0.1:${httpPort()}/api/node/membership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: { accepted: false },
    });
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("joining finishes when the copy holds this box's row, and the next start is a mirror", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Boot Adoption SL" });
  await suite.db.insert(locations).values({ id: LOCATION });
  await seedVenueSettings(suite.db, { operationDescription: "Hospitality" });
  await seedBusinessDay(suite.db, {});
  const standby = generateNodeKeyPair();
  const main = { nodeId: PRIMARY, ...generateNodeKeyPair() };
  await suite.db.insert(nodes).values([
    { id: PRIMARY, name: "Primary", filingModule: "none", taxModule: "vat" },
    { id: STANDBY, name: "Spare", publicKey: standby.publicKey },
  ]);
  await stampDeployment(suite.db, "preproduction");
  await setNodeMode({ venue: suite.db, node: suite.node }, STANDBY, "mirror");
  const keyEnv = {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  };
  // A joining spare's production shape: it serves its main box a store, under the venue's `tls/`.
  await withNodeTransaction(suite.node, async (tx) => {
    await sealNodeSigningKeyTx(tx, loadKeyRing(keyEnv), STANDBY, standby.privateKey);
    await writePairLinkTx(tx, loadKeyRing(keyEnv), STANDBY, {
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: PRIMARY,
      peerPublicKey: main.publicKey,
      storeUrl: "https://main-box.local:7443",
      venueId: "venue",
      accessKeyId: "waitron0123456789abcdef",
      secretAccessKey: "c".repeat(64),
    });
  });
  await pinMainBoxKey(suite.node, STANDBY, main);
  await writeMirrorLink(suite.node, STANDBY, {
    originUrl: "http://127.0.0.1:1/",
    boxHostname: "main-box.local",
    boxCaPem: "unused",
    originNodeId: PRIMARY,
  });
  const scratch = await mkdtemp(join(tmpdir(), "boot-adoption-finishes-"));
  let server: StartedServer | undefined;
  allocation.dependent = false;
  try {
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": false } }),
    );
    await writePendingAdoption(scratch, {
      originNodeId: PRIMARY,
      standby: { nodeId: STANDBY, publicKey: standby.publicKey },
      nodeName: "Spare",
      filingModule: "none",
      taxModule: "vat",
      reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
    });
    const tls = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: ["127.0.0.1"],
      now: new Date(),
    });
    await writeTlsSet(scratch, tls);
    const versitygw = join(scratch, "versitygw");
    await writeFile(versitygw, "#!/bin/sh\nexec sleep 60\n", { mode: 0o700 });
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port, loopbackPort, storePort] = await freePorts(3);
    const env = {
      ...keyEnv,
      WAITRON_VERSITYGW_BIN: versitygw,
      WAITRON_SPARE_STORE_LOOPBACK_PORT: String(loopbackPort),
      WAITRON_SPARE_STORE_PORT: String(storePort),
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: STANDBY,
      WAITRON_ENV: "dev",
    };
    let restarts = 0;
    server = await startServer(
      env,
      {},
      { stepdown: { mount() {}, restart: () => (restarts += 1) } },
    );
    await vi.waitFor(() => expect(restarts).toBe(1));
    expect(await readPendingAdoption(scratch)).toBeNull();
    await server.close();
    server = undefined;

    server = await startServer(env);
    const { via, close } = httpsVia(tls.caCertPem);
    try {
      const probe = await fetch(`https://127.0.0.1:${httpPort()}/api/node`, via);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({ acceptingSales: false });
    } finally {
      await close();
    }
  } finally {
    allocation.dependent = true;
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
