import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readDeploymentAxes,
  readNodeMembership,
  setSingletonRole,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPin } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { enrolPeer } from "@waitron/sync";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { roleUrl } from "./testing/postgres.js";

// Membership rejoin R1 (design §6) boot integration: a returned ex-primary whose held membership
// document marks it sell-only/evicted must come up FENCED — its saved singleton axis reconciled DOWN to
// 'secondary' (so the existing isSingletonPrimary gates suppress the submitter/reconciler/config-writer
// AND the authoritative sync source) and its whole write surface behind the read-only gate. Real
// Postgres is mandatory (CLAUDE.md §4): the demote is an OWNER-role write on `deployment` (app_user
// holds no UPDATE), and the singleton-source mount is served through the non-superuser `app_login`
// pool — both false passes on PGlite (every PGlite connection is a superuser).

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode. The NODE id
// is the one the fence read (`isFenced(held, config.till.nodeId)`) looks up in the held chart.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A media dir under this suite's own temp root so boot's `mkdirSync(mediaDir)` never writes into
// `apps/server/src`. Created synchronously so `KEY_ENV` can reference it; torn down in `afterAll`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-fence-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
  ...TILL_ENV,
};

// Short ticks so the boot loop's first (empty) pass lands inside the poll budget without a long idle
// sleep. No fiscal work is seeded, so no drain ever dials AEAT.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// A dead loopback sync peer so `loadSyncConfig` turns sync ON (sync is enabled iff WAITRON_SYNC_PEERS is
// a non-empty array — config.ts) and `mountSyncApi` is reached: the singleton SOURCE the fence must
// suppress. The pull worker dials this dead port in the background and backs off; it never blocks boot.
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

// A clone of the full-manifest template — this suite's own database (each `useTemplateDb` call clones
// afresh), so the deployment stamp + singleton_role flips it performs are isolated to this file.
const suite = useTemplateDb({ template: "manifest" });

// A SECOND clone, the live gossip PEER for Case C/D: a plain sync source that advertises a signed
// membership document on its /sync-api/hello. The booted primary's REAL pull worker drains this peer
// and hands the advertised document to the REAL adoptMembership callback (boot.ts) — the runtime path
// that must schedule the restart-into-fenced when the document supersedes-and-fences this node. It
// only SERVES (never stamped); its held node_membership is rewritten per test.
const peerSource = useTemplateDb({ template: "manifest" });

// The peer's origin id (served on /hello, the id the booted primary pulls with `?originId=`).
const PEER_SOURCE_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// A trusted SIGNER identity distinct from the till node: its public half is stamped on a `nodes` row in
// the booted primary's tenant (below), so `readMembershipTrustSet` trusts a document this key signs,
// exactly as it trusts the till's own key. The private half signs the advertised documents in-process.
const SIGNER_NODE_ID = "77777777-7777-4777-8777-777777777777";
const SIGNER_KP = generateNodeKeyPair();

// The CARRIER (the current serving-primary) that a fenced node drains its own-origin tail onto
// (membership rejoin R2). Named `serving-primary` in the held document Case E boots with, so
// `servingPrimaryNodeId(heldMembership)` resolves it, and enrolled as a `sync_peers` subscriber under
// THIS node so its Bearer authenticates against the fenced node's drain source. The disposal reader
// keys its `sync_cursor` lookup on this id (`subscriber_id`), so the enrolled subscriberId IS this id.
const CARRIER_NODE_ID = "88888888-8888-4888-8888-888888888888";

// A `manager`-role person in the till tenant (role `manager` holds `till.configure`, the permission
// `GET /api/box/status` authorizes). Seeded once by `seedTillIdentity`; each case that reads box-status
// mints a fresh `management_sessions` row for it (`managerCookie`) rather than logging in over HTTP —
// login is a POST, which the fenced node's read-only gate would 403 (Case A proves that), so a session
// is seeded owner-side directly, the shape a promote/adopt path persists an already-authenticated one.
const MANAGER_ID = "99999999-9999-4999-8999-999999999999";

/** A membership document (design §3/§5) signed by the trusted SIGNER key, naming THIS node with
 * `standing` at `term`. Advertised by the live peer on /hello; the booted primary re-runs the accept
 * fence against it (membership-adopt.ts) and persists it iff strictly newer. `term: 6` supersedes the
 * held term-5 self-doc the primary boots with. */
function peerDoc(
  term: number,
  standing: "sell-only" | "serving-primary",
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
  };
  return {
    body,
    signerNodeId: SIGNER_NODE_ID,
    signature: signDocumentBody(body, SIGNER_KP.privateKey),
    endorsements: [],
  };
}

// The box key ring `establishNodeIdentity` seals under, built from the SAME credentials key boot loads.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let migrationsRoot: string;
let appDatabaseUrl: string;
let syncDatabaseUrl: string;

// The live gossip peer (Case C/D): a real HTTP server serving the peer clone's /sync-api, the Bearer
// every pull presents, and the reader pool the /hello + /log handlers read through.
let peerSourceReader: Database;
let peerToken: string;
let peerServer: ServerType;
let peerBaseUrl: string;

/** Seed the boot till's tenant + location + node (so boot's `readOrderFlow` / `readVenueLocale` reads
 * resolve) plus a node identity, mirroring boot.promote.test.ts's `seedTillIdentity`. */
async function seedTillIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90111111H', 'Fence Till SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Fence node')
    on conflict do nothing`);
  // A manager the box-status cases resolve a seeded session against (role `manager` holds
  // `till.configure`). `pin_hash` is NOT NULL so a value is supplied; `password_hash` stays null — no
  // case logs in by password (the fenced node's gate would 403 the POST anyway).
  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, pin_hash, role)
    values (${MANAGER_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Fence Manager', ${hashPin("1234")},
            'manager')
    on conflict do nothing`);
  await establishNodeIdentity(
    { ownerDb: admin, ring: RING },
    TILL_ENV.WAITRON_TILL_TENANT_ID,
    TILL_ENV.WAITRON_TILL_NODE_ID,
  );
}

/** A held membership document (design §3/§5) naming THIS node with `standing`. The fence read is
 * UNVERIFIED (`readNodeMembership` returns the blob whole), so the placeholder signature is fine — we
 * write it directly through the plain-upsert setter, exactly as an owner/promote path would persist an
 * already-verified document. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  return membershipDoc([{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }]);
}

/** A held document (design §3/§5) marking THIS node `sell-only` (the fence) AND the CARRIER
 * `serving-primary`, so boot fences this node AND `servingPrimaryNodeId(heldMembership)` resolves the
 * carrier the disposal reader drains onto (membership rejoin R2). Written directly through the
 * plain-upsert setter, as an owner/promote path persists an already-verified document. */
function fencedWithCarrierDoc(): SignedMembershipDocument {
  return membershipDoc([
    { nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing: "sell-only" },
    { nodeId: CARRIER_NODE_ID, contactUrl: "", standing: "serving-primary" },
  ]);
}

/** The shared term-5 self-signed envelope both `selfDoc` and `fencedWithCarrierDoc` build — they
 * differ only in `nodes`. Signature is the placeholder the plain-upsert setter accepts (the fence read
 * is UNVERIFIED). */
function membershipDoc(nodes: readonly MembershipNode[]): SignedMembershipDocument {
  return {
    body: { term: 5, nodes },
    signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

/**
 * Mint a fresh management session for the seeded manager and return the cookie pair the
 * box-status route reads (`requireManagementSession` → the session id). Seeded owner-side so no
 * HTTP login POST is needed — the fenced node's read-only gate would 403 that POST.
 */
async function managerCookie(): Promise<string> {
  const res = await suite.admin.execute<{ id: string }>(sql`
    insert into management_sessions (tenant_id, person_id)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, ${MANAGER_ID})
    returning id`);
  return `${MANAGEMENT_COOKIE}=${res.rows[0]!.id}`;
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.promote.test.ts does: boot's from-source default does
  // not exist under source, so `WAITRON_MIGRATIONS_DIR` must point `applyMigrations` at the real
  // journal content per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-fence-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  await seedTillIdentity(suite.admin);
  // Stamp production (matching WAITRON_ENV so the boot guard passes); singleton_role keeps its column
  // default 'primary' (the baseline) — so this clone is a PRIMARY, the state a returned ex-primary is
  // in before its held fence is reconciled.
  await stampDeployment(suite.admin, "production");

  appDatabaseUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
  syncDatabaseUrl = roleUrl(suite.pg.uri, "sync_applier", "ap");

  // Stand up the live gossip peer for Case C/D. The /hello + /log handlers read through a
  // sync_applier pool (app_user's SELECT), exactly as boot builds the source reader; the peer enrols
  // the Bearer the booted primary presents from WAITRON_SYNC_PEERS. Stamp the primary's `nodes` row
  // with the trusted SIGNER public key so its `readMembershipTrustSet` accepts the advertised document
  // (the till + location the FK references were seeded above by `seedTillIdentity`).
  peerSourceReader = await peerSource.pg.connectAs("sync_applier", "ap");
  peerToken = (
    await enrolPeer(peerSource.admin, { subscriberId: "fence-gossip", name: "fence-gossip" })
  ).token;
  await suite.admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name, public_key)
    values (${SIGNER_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID},
            'Peer signer', ${SIGNER_KP.publicKey})
    on conflict do nothing`);
  const app = new Hono();
  mountSyncApi(
    app,
    {
      db: peerSourceReader,
      tenantId: TILL_ENV.WAITRON_TILL_TENANT_ID,
      nodeId: PEER_SOURCE_NODE,
      environment: "production",
      enrolments: ALL_SYNC_ENROLMENTS,
      moduleVersions: {},
    },
    () => {},
  );
  const peerPort = await new Promise<number>((resolve) => {
    peerServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) =>
      resolve(info.port),
    );
  });
  peerBaseUrl = `http://127.0.0.1:${peerPort}`;
}, 180_000);

afterAll(async () => {
  if (peerServer !== undefined)
    await new Promise<void>((resolve) => peerServer.close(() => resolve()));
  if (peerSourceReader !== undefined) await peerSourceReader.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

/** The WAITRON_SYNC_PEERS JSON pointing the booted primary at the live gossip peer (Case C/D). */
function livePeers(): string {
  return JSON.stringify([{ nodeId: PEER_SOURCE_NODE, url: peerBaseUrl, token: peerToken }]);
}

/** An OS-assigned free port, released before use (boot.promote.test.ts's helper — WAITRON_HTTP_PORT
 * rejects "0", so the host cannot bind an ephemeral port itself). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Boot a trading server against this clone with sync enabled (a dead peer), the shared env for both
 * cases. */
async function bootFenceServer(port: number, syncPeers: string = SYNC_PEERS) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    DATABASE_URL: appDatabaseUrl,
    // Superuser: boot's fenced demote opens a short-lived owner pool from this URL for the
    // `setSingletonRole` write (app_user holds no UPDATE on `deployment`), and boot re-runs the
    // (idempotent) migrations over it too.
    WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_PEERS: syncPeers,
    WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
  });
}

describe("boot fence (real Postgres): a held sell-only membership doc fences a returned primary", () => {
  it("Case A: a held sell-only self-doc demotes the singleton axis, gates writes, and unmounts the source", async () => {
    // A fresh primary starting point (a prior test may have demoted the shared clone).
    await setSingletonRole(suite.admin, "primary");
    // The held document marks THIS node sell-only — the fence.
    await writeNodeMembership(suite.admin, selfDoc("sell-only"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Reconciled: boot demoted the singleton axis DOWN to 'secondary' (mode stays 'primary' — the
      // (primary, secondary) pair is valid, deployment_role_valid_ck).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "secondary" });

      // A write verb is refused by the read-only gate BEFORE the route (a cookieless POST 403s), the
      // error-boundary shape.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The sync SOURCE that IS mounted on a fenced node is the OWN-ORIGIN DRAIN source (membership
      // rejoin R2): the `else if (fenced)` branch mounts `mountSyncApi(..., ownOriginOnly: true)`, so a
      // tokenless request reaches the peer-auth screen (401 sync.node_unauthorized), NOT a 404. This
      // REVERSES the R1 posture (a fenced node mounted no source at all, 404) — a fenced node now serves
      // its own tail so a carrier can drain it. The drain source mounts whether or not a carrier is
      // named (this self-doc names none); the carrier gates only the disposal READER (Case E). The
      // isSingletonPrimary gate still suppresses the FULL authoritative source and the singleton workers.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(401);

      // The operational PRINT surface, by contrast, is NOT mounted: a fenced node is `mode='primary'`, so
      // the verb-based read-only gate alone would let `GET /print-api/agent/jobs` (a write behind a GET —
      // `claimPrintJobs`) through. The `!fenced` half of boot.ts's `!isMirror && !fenced` mount guard
      // un-mounts the device/print groups, so the route is absent: 404 (route not mounted), NOT the 401
      // a mounted-but-unauthenticated agent GET would return — the 404-not-401 tell the sync source USED
      // to share before R2 mounted the drain source above.
      const printJobs = await fetch(`${base}/print-api/agent/jobs`);
      expect(printJobs.status).toBe(404);

      // Fenced ⇒ acceptingSales:false; Case B is the control on the same identity.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: false,
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("Case B: a held serving-primary self-doc does NOT fence — primary stays open and sources", async () => {
    // A fresh primary starting point, then a held document that keeps this node SERVING — not fenced.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Unfenced: the singleton axis stays 'primary' (no demote fired).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "primary" });

      // Writes are open — the read-only gate is not mounted, so a POST reaches its OWN auth screen: the
      // management-session cookie is missing → 401, NOT the gate's 403 and NOT a 404 (the route exists).
      // Asserting the exact 401 (like the sync-source control below) proves the request passed the gate
      // and reached the real handler, which `.not.toBe(403)` alone would not (a 404/500 passes that too).
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(401);

      // The singleton sync SOURCE IS mounted (isSingletonPrimary true): a tokenless request reaches the
      // peer-auth screen (401 sync.node_unauthorized), NOT a 404 — the route exists. This is the control
      // proving Case A's 404 is the fence's doing, not a missing route.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(401);

      // The disposal control (membership rejoin R2): an UNFENCED serving node wires NO readDisposal
      // (`lagPool !== undefined && fenced` is false), so box-status reports `disposal.applicable:false`.
      // This is the negative control for Case E's `applicable:true`.
      const status = await fetch(`${base}/api/box/status`, {
        headers: { cookie: await managerCookie() },
      });
      expect(status.status).toBe(200);
      expect((await status.json()).disposal).toEqual({ applicable: false });

      // Unfenced ⇒ acceptingSales:true — the control for Case A's false.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        standing: "serving-primary",
        acceptingSales: true,
      });
    } finally {
      await server.close();
    }
  }, 60_000);
});

describe("boot fence drain (real Postgres): a fenced node serves its own-origin tail and surfaces disposal", () => {
  it("Case E: a fenced node mounts the own-origin drain source, exempts the cursor report, and reports disposal", async () => {
    // 1. A fresh primary whose held document marks THIS node sell-only (the fence) AND a SECOND node
    //    serving-primary (the carrier) — so boot fences AND servingPrimaryNodeId resolves the carrier.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, fencedWithCarrierDoc());

    // 2. Enrol the carrier as a sync_peers subscriber under THIS node (subscriberId = the carrier's node
    //    id, the id the disposal reader keys the cursor on), so its Bearer authenticates against the
    //    fenced node's drain source and its cursor report records under `subscriber_id = CARRIER_NODE_ID`.
    const carrierToken = (
      await enrolPeer(suite.admin, { subscriberId: CARRIER_NODE_ID, name: "fence-carrier" })
    ).token;
    const carrierAuth = { Authorization: `Bearer ${carrierToken}` };

    // 3. Seed an own-origin sync_log row on the ordered lane (table `catalogues`) as the
    // superuser. `seq` is GENERATED ALWAYS AS IDENTITY and monotonic, so this row is the origin's
    // high-water on that lane regardless of any rows a prior case left — a deterministic
    // ownTailSeq.
    const logRes = await suite.admin.execute<{ seq: string }>(sql`
      insert into sync_log (origin_id, table_name, op, tenant_id, row_image)
      values (${TILL_ENV.WAITRON_TILL_NODE_ID}::uuid, 'catalogues', 'insert',
              ${TILL_ENV.WAITRON_TILL_TENANT_ID}::uuid, '{}'::jsonb)
      returning seq::text as seq`);
    const ownSeq = logRes.rows[0]!.seq;

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Fenced: singleton axis demoted to secondary, exactly as Case A.
      expect(await readDeploymentAxes(suite.admin)).toEqual({
        mode: "primary",
        singletonRole: "secondary",
      });

      // 4. The own-origin DRAIN SOURCE is mounted on a fenced node (which R1 alone did NOT do — Case A
      //    asserts a fenced node 404s the source). The carrier's Bearer authenticates: /hello 200, and
      //    /log?originId=<self> 200 (ownOriginOnly forces self regardless of the query).
      const hello = await fetch(`${base}/sync-api/hello`, { headers: carrierAuth });
      expect(hello.status).toBe(200);
      const logGet = await fetch(
        `${base}/sync-api/log?originId=${TILL_ENV.WAITRON_TILL_NODE_ID}&after=0`,
        { headers: carrierAuth },
      );
      expect(logGet.status).toBe(200);

      // 5. POST /sync-api/cursor with the carrier's Bearer → 200, NOT the gate's 403: the read-only-gate's
      //    single-route `POST /sync-api/cursor` exemption lets the carrier report how far it has drained
      //    through the fence. The report records sync_cursor(subscriber=CARRIER, origin=self, ordered) =
      //    ownSeq — the carrier has fully drained this node's tail.
      const cursor = await fetch(`${base}/sync-api/cursor`, {
        method: "POST",
        headers: { ...carrierAuth, "content-type": "application/json" },
        body: JSON.stringify({ lane: "ordered", lastAppliedSeq: ownSeq }),
      });
      expect(cursor.status).toBe(200);

      // 6. box-status surfaces the disposal verdict: applicable (fenced + a carrier named), the carrier,
      //    and drained=true because the carrier's reported cursor reached the own tail's high-water.
      const status = await fetch(`${base}/api/box/status`, {
        headers: { cookie: await managerCookie() },
      });
      expect(status.status).toBe(200);
      expect((await status.json()).disposal).toEqual({
        applicable: true,
        carrierNodeId: CARRIER_NODE_ID,
        drained: true,
        ownTailSeq: ownSeq,
        carrierAppliedSeq: ownSeq,
      });

      // 7a. Prove the read-only gate is ACTIVE in THIS boot (not only in Case A's): a NON-exempt write
      //     POST is refused before its route — the same cookieless `POST /management-api/catalogues`
      //     Case A uses. So this one case proves both halves: the gate rejects an ordinary write, and
      //     retire is exempted from it.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // 7. The read-only-gate exemption (retire/evict R3): POST /api/box/retire is the ONE management
      //    write a fenced node serves. The read-only gate IS mounted (this node is fenced, as Case A's
      //    403 on POST /management-api/catalogues proves), yet this POST is NOT rejected with
      //    node.read_only — the single-route `fenced && POST /api/box/retire` exemption lets it reach the
      //    handler, which authorizes the seeded manager and self-evicts the fully-drained node. Proven
      //    end-to-end (not `.not.toBe(403)`): the 200 body evicts this node and bumps the held term 5→6,
      //    which a gate-rejection or a route-not-mounted could never produce.
      const retire = await fetch(`${base}/api/box/retire`, {
        method: "POST",
        headers: { cookie: await managerCookie() },
      });
      expect(retire.status).toBe(200);
      expect(await retire.json()).toEqual({ evicted: true, term: 6 }); // held term 5 → minted 6
      // The eviction persisted to disk: self now reads `evicted` in the held chart.
      const evicted = await readNodeMembership(suite.admin);
      expect(
        evicted!.body.nodes.find((n) => n.nodeId === TILL_ENV.WAITRON_TILL_NODE_ID)?.standing,
      ).toBe("evicted");
    } finally {
      await server.close();
    }
  }, 60_000);
});

describe("boot fence gossip (real Postgres): a superseding document adopted at runtime restarts into the fenced posture", () => {
  it("Case C: an unfenced running primary adopts a superseding sell-only document → schedules a restart-into-fenced", async () => {
    // The primary boots UNFENCED: singleton axis 'primary' and a held self-doc that keeps it serving.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    // The live peer advertises a strictly-newer (term 6 > 5) document marking THIS node sell-only.
    await writeNodeMembership(peerSource.admin, peerDoc(6, "sell-only"));

    // SAFETY (CLAUDE.md §4): the fencing adopt schedules `setTimeout(() => process.kill(pid, "SIGTERM"), 0)`.
    // Spy on process.kill so the restart NEVER fires a real SIGTERM at the vitest worker; assert it was
    // scheduled. Installed BEFORE boot so the next-tick timer hits the spy, restored in `finally`.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const port = await freePort();
    const server = await bootFenceServer(port, livePeers());
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // The pull worker drained the peer, verified the trusted document, and PERSISTED it: this node's
      // held membership bumps to term 6 — read back through the admin connection (the row on disk, not
      // the callback's return), the honest proof the adoption actually happened.
      const held = await poll(async () => {
        const m = await readNodeMembership(suite.admin);
        return m !== null && m.body.term === 6 ? m : undefined;
      });
      expect(held).not.toBeNull();
      expect(held!.body.term).toBe(6);

      // ...and because the newly-adopted document fences a node that booted unfenced, the next-tick
      // restart-into-fenced was scheduled: process.kill fired into the spy, never a real SIGTERM.
      await poll(async () => (killSpy.mock.calls.length > 0 ? true : undefined));
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      await server.close();
      killSpy.mockRestore();
    }
  }, 60_000);

  it("Case D (negative control): a superseding document that keeps this node serving-primary is adopted but schedules NO restart", async () => {
    // Same unfenced boot, but the advertised strictly-newer document keeps this node SERVING — the adopt
    // must persist (term bumps) WITHOUT scheduling a restart (shouldFenceRestart is false: not fenced).
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    await writeNodeMembership(peerSource.admin, peerDoc(6, "serving-primary"));

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const port = await freePort();
    const server = await bootFenceServer(port, livePeers());
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // The adopt DID happen — the held document bumps to term 6 (the branch was reached and evaluated).
      const held = await poll(async () => {
        const m = await readNodeMembership(suite.admin);
        return m !== null && m.body.term === 6 ? m : undefined;
      });
      expect(held!.body.term).toBe(6);

      // Give any erroneously-scheduled next-tick restart timer ample time to fire, then prove it did not:
      // a serving-primary document does not fence, so process.kill is never called at all on this path
      // (the spy has no other legitimate caller here).
      await delay(300);
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      await server.close();
      killSpy.mockRestore();
    }
  }, 60_000);
});

/** Polls `predicate` up to ~10s for its first defined value, THROWING on timeout so a call site can
 * never silently proceed on an unmet condition (a `poll` that returned `undefined` let a test continue
 * as if the background loop had recorded a pass — Copilot #214). boot.promote.test.ts's shape, hardened. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~10s");
}
