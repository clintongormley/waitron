import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  nodes,
  readNodeMembership,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { endorseKey } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { emptyDrainResult } from "@waitron/fiscal";
import { enabledModules } from "@waitron/module";
import { readNodeMode } from "@waitron/node-db";
import { planVenue } from "@waitron/provisioning";
import { applyAllocatedTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { adoptFromPrimary, type AdoptCredential } from "./adopt.js";
import type { StartedServer } from "./boot.js";
import { readPendingAdoption } from "./finish-adoption.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { boxExchange, CheckedAddresses } from "./mirror-bundle-fetch.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// The fiscal drain files nothing; these cases look only at how the box starts.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: () => Promise.resolve(emptyDrainResult()),
    }),
  };
});

const latch = vi.hoisted(() => ({ dropJoining: false }));

// The control case leaves the joining field out of every mount, as the start did before D19.
vi.mock("./peer-status-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./peer-status-api.js")>();
  return {
    ...actual,
    mountPeerStatusApi: (...[app, deps, log]: Parameters<typeof actual.mountPeerStatusApi>) => {
      actual.mountPeerStatusApi(
        app,
        latch.dropJoining ? { ...deps, joining: undefined } : deps,
        log,
      );
    },
  };
});

const { startServer, startConfiguredServer } = ephemeralServerFixture();

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const RING: KeyRing = loadKeyRing(KEY_ENV);
const MAIN_URL = "https://main.test";
const PASSWORD = "correct horse";

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });

let mainState: string;
let spareState: string;
let migrationsRoot: string;
let fakeStoreDir: string;
const running: StartedServer[] = [];

beforeEach(async () => {
  latch.dropJoining = false;
  mainState = await mkdtemp(join(tmpdir(), "joining-spare-main-"));
  spareState = await mkdtemp(join(tmpdir(), "joining-spare-spare-"));
  migrationsRoot = await mkdtemp(join(tmpdir(), "joining-spare-migrations-"));
  fakeStoreDir = await mkdtemp(join(tmpdir(), "joining-spare-versitygw-"));
  for (const [index, set] of manifestSets().entries())
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
});
afterEach(async () => {
  try {
    while (running.length > 0) await running.pop()!.close();
  } finally {
    for (const dir of [mainState, spareState, migrationsRoot, fakeStoreDir])
      await rm(dir, { recursive: true, force: true });
  }
});

/** A stand-in for the spare store's versitygw, which the latch start runs: it waits to be stopped. */
function fakeVersitygw(): string {
  const bin = join(fakeStoreDir, "versitygw");
  writeFileSync(bin, "#!/bin/sh\nexec sleep 60\n", { mode: 0o700 });
  return bin;
}

/**
 * A main box, and a spare joined to it through the real bundle route and the real
 * `adoptFromPrimary`, as probe P35 built them. The spare's `nodes` row is written on the main box as
 * the join step will write it (Task 6.2), so the main box counts the spare.
 */
async function joinedPair() {
  await writeModuleConfig(mainState, { overrides: new Map([["fiscal-verifactu", false]]) });
  const modules = enabledModules(ALL_MODULES, await readModuleConfig(mainState));
  const venue = await applyAllocatedTestVenue(
    planVenue(
      {
        country: "ES",
        taxId: "81000001K",
        legalName: "Two Boxes SL",
        name: "Main box",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Sale",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "FA",
        rectificativeSeriesCode: "RF",
        admin: {
          displayName: "Owner",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(PASSWORD),
          email: "owner@example.test",
        },
      },
      modules,
    ),
    { db: mainBox.db, modules },
  );
  await stampDeployment(mainBox.db, "preproduction");
  await mkdir(join(mainState, "tls"), { recursive: true });
  const authority = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  });
  await writeFile(join(mainState, "tls", "ca.crt"), authority.caCertPem);
  await writeFile(join(mainState, "tls", "ca.key"), authority.caKeyPem);
  await holdRecoveryKey(mainState);
  const mainId: string = venue.nodeId;
  await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring: RING }, mainId);
  const mainKey = await readNodeIdentityKey(mainBox.node, RING, mainId);
  await writeNodeMembership(
    mainBox.db,
    signedMembershipDoc(1, {
      signerNodeId: mainId,
      keyPair: { publicKey: nodeSigningPublicKey(mainKey), privateKey: mainKey },
      nodes: [{ nodeId: mainId, contactUrl: MAIN_URL, standing: "serving-primary" }],
    }),
  );
  const session = await openManagementSession(mainBox.db, "admin");
  await withTransaction(mainBox.db, (tx) => setFreshManagementSignIn(tx, session.token));
  const bundleApp = new Hono();
  mountMirrorBundleApi(bundleApp, {
    appDb: mainBox.db,
    node: mainBox.node,
    ring: RING,
    stateDir: mainState,
    boxHostname: "waitron.local",
    advertisedOrigin: MAIN_URL,
    designated: { nodeId: mainId },
    accountKey: Buffer.alloc(32, 9).toString("base64"),
    credentialKeyRing: TOTP_KEY_RING,
    wakeSpareJoin: () => {},
  });

  // The spare's chart entry names its own box name at a fixed port; its leaf covers that name,
  // under the venue authority the join copied to it.
  const [sparePort, loopbackPort, storePort] = await freePorts(3);
  let standby!: { nodeId: string; publicKey: string };
  let spareId!: string;
  await adoptFromPrimary(
    {
      ownerDb: spareBox.db,
      ownerNode: spareBox.node,
      ring: RING,
      persistCredentialsRing: async () => {},
      fetchBundle: async (_url, credential: AdoptCredential, sent) => {
        standby = { nodeId: sent.nodeId, publicKey: sent.publicKey };
        const response = await bundleApp.request("/management-api/mirror-bundle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            personId: credential.personId,
            password: credential.password,
            standbyNodeId: sent.nodeId,
            standbyPublicKey: sent.publicKey,
            standbyContactUrl: sent.contactUrl,
            standbyStoreUrl: sent.storeUrl,
            standbyAt: sent.at,
          }),
        });
        const bundle = await response.json();
        expect(response.status, JSON.stringify(bundle)).toBe(200);
        return bundle as MirrorBundle;
      },
      advertisedOrigin: `https://waitron.local:${sparePort}`,
      spareStorePort: storePort!,
      environment: "preproduction",
      persistTrading: async (args) => {
        spareId = args.nodeId;
      },
      persistBackupSettings: async () => {},
      persistModuleConfig: async (config) => {
        await writeModuleConfig(spareState, config);
      },
      stateDir: spareState,
      database: "spare",
      listIpv4: () => [],
      now: () => new Date(),
    },
    { primaryUrl: MAIN_URL, credential: { personId: session.personId, password: PASSWORD } },
    { beforeFirstWrite: async () => {} },
  );
  expect((await readNodeMode(spareBox.node, spareId)).mode).toBe("mirror");
  const spareUrl = (await readNodeMembership(mainBox.db))!.body.nodes.find(
    (n) => n.nodeId === spareId,
  )!.contactUrl;
  expect(await readPendingAdoption(spareState)).not.toBeNull();

  const [main] = await mainBox.db.select().from(nodes).where(eq(nodes.id, mainId));
  await withTransaction(mainBox.db, (tx) =>
    insertReservedNodeTx(tx, {
      id: spareId,
      name: `${main!.name} (standby)`,
      filingModule: main!.filingModule,
      taxModule: main!.taxModule,
      publicKey: standby.publicKey,
      endorsement: endorseKey(spareId, standby.publicKey, mainId, mainKey),
    }),
  );

  // The join refuses a Veri*Factu venue (`assertAdoptionModules`); the main box starts under the
  // filing module its node was set up with, as `boot.start-check.test.ts`'s main box does.
  await writeModuleConfig(mainState, { overrides: new Map([["fiscal-none", false]]) });

  const venueDirOf = (db: typeof mainBox.db) =>
    dirname(db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const versitygw = fakeVersitygw();

  /** The spare's real start over its files: `pending-adoption.json` makes it the latch start. */
  const startSpare = async () => {
    const server = await startConfiguredServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDirOf(spareBox.db),
      WAITRON_STATE_DIR: spareState,
      WAITRON_LOG_DIR: join(spareState, "logs"),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_HTTP_PORT: String(sparePort),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: spareId,
      WAITRON_ENV: "preproduction",
      WAITRON_VERSITYGW_BIN: versitygw,
      WAITRON_SPARE_STORE_LOOPBACK_PORT: String(loopbackPort),
      WAITRON_SPARE_STORE_PORT: String(storePort),
    });
    running.push(server);
    // The main box reaches the spare's box name at loopback, under the venue authority, and keeps
    // that address in its state folder, as it would after reaching it on the venue's network.
    const checked = new CheckedAddresses();
    const letGo = await checked.rememberIn(mainState, (error) => {
      throw error;
    });
    try {
      const status = await boxExchange(new URL(`${spareUrl}/api/box/status`), {
        method: "GET",
        trust: {
          ca: await readFile(join(mainState, "tls", "ca.crt"), "utf8"),
          rejectUnauthorized: true,
        },
        signal: AbortSignal.timeout(5000),
        checked,
        lookup: async () => ({ addresses: ["127.0.0.1"], remembered: false }),
      });
      expect(JSON.parse(status.text)).toEqual({ adoption: "pending", copy: "waiting" });
    } finally {
      await letGo();
    }
    return server;
  };

  /** The main box's real start; returns it and its `handover.start_check` lines. */
  const startMain = async () => {
    const env = {
      ...KEY_ENV,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: mainState,
      WAITRON_VENUE_DIR: venueDirOf(mainBox.db),
      WAITRON_NODE_ID: mainId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_MAX_TICK_MS: "600000",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    };
    const lines: Record<string, unknown>[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        try {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // Not a log line.
        }
      }
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    let server: StartedServer;
    try {
      server = await startServer(env, env);
      running.push(server);
    } finally {
      process.stdout.write = original;
    }
    const checks = lines
      .filter((l) => l.event === "handover.start_check")
      .map(({ result, peers }) => ({ result, peers }));
    return { server, checks };
  };

  const closeMain = async (server: StartedServer) => {
    running.splice(running.indexOf(server), 1);
    await server.close();
  };

  return { spareId, startSpare, startMain, closeMain };
}

describe("a main box whose spare is still joining (D19)", () => {
  it("a main box restarted while its spare is still joining starts without waiting", async () => {
    const pair = await joinedPair();
    await pair.startSpare();
    const { server, checks } = await pair.startMain();
    expect(checks).toEqual([
      { result: "proceed", peers: [{ nodeId: pair.spareId, answer: "J", counted: false }] },
    ]);
    expect(server.fullyStarted).toBeUndefined();
  }, 120_000);

  it("a spare stuck in its latch start never makes the main box wait", async () => {
    const pair = await joinedPair();
    await pair.startSpare();
    for (let start = 0; start < 3; start++) {
      const { server, checks } = await pair.startMain();
      expect({ start, checks }).toEqual({
        start,
        checks: [
          { result: "proceed", peers: [{ nodeId: pair.spareId, answer: "J", counted: false }] },
        ],
      });
      expect(server.fullyStarted).toBeUndefined();
      await pair.closeMain(server);
    }
  }, 180_000);

  it("control: the same with the joining field left out of the latch start's mount waits", async () => {
    latch.dropJoining = true;
    const pair = await joinedPair();
    await pair.startSpare();
    const { server, checks } = await pair.startMain();
    expect(checks).toEqual([
      {
        result: "wait",
        peers: [{ nodeId: pair.spareId, answer: "S", counted: true, why: "no_chart" }],
      },
    ]);
    expect(server.fullyStarted).toBeDefined();
  }, 120_000);

  it("a counted spare that is switched off still makes the main box wait", async () => {
    const pair = await joinedPair();
    const spare = await pair.startSpare();
    running.splice(running.indexOf(spare), 1);
    await spare.close();
    const { server, checks } = await pair.startMain();
    expect(checks).toMatchObject([
      { result: "wait", peers: [{ nodeId: pair.spareId, answer: "S", counted: true }] },
    ]);
    expect(server.fullyStarted).toBeDefined();
  }, 120_000);
});
