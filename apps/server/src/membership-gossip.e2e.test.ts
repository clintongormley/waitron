import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateNodeKeyPair, type AcceptResult, type TrustSet } from "@waitron/membership";
import {
  readNodeMembership,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer, runSyncPull, type HttpClient } from "@waitron/sync";
import { adoptMembership } from "./membership-adopt.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";
import { realSleep } from "./loop.js";
import type { Logger } from "./logger.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

// The HONEST end-to-end consume proof (design §5): a document held on the SOURCE is advertised on its
// peer-authenticated /sync-api/hello, the SUBSCRIBER's REAL runSyncPull (Task 1) drains that peer,
// hands the advertised document to the REAL adoptMembership (Task 2 — the accept fence + term-guarded
// persist), and the row lands in the subscriber's OWN node_membership. It wires the real modules
// directly with a FIXTURE trust set, so the accept fence is driven from both directions here with a
// signer key held in-process. Since Slice 4, boot supplies this trust set for real
// (readMembershipTrustSet over nodes.public_key), so this suite mirrors the live mechanism rather than
// standing in for a dormant seam — a bare node with no stamped key yields an empty trust set (the
// untrusted control below), a provisioned/adopted one yields `{self}`/`{primary}`.
//
// Real Postgres × 3 (the persist runs as `sync_applier`, a member of `app_user` holding the Slice-3
// INSERT/UPDATE grant on node_membership — PGlite is a superuser and would not exercise that grant,
// CLAUDE.md §4): `source` (serves /hello + /log + /cursor), `subscriber` (adopts under the fixture
// trust set), and `untrusted` (the empty-trust-set control that must adopt nothing). Modelled on the
// two-node shape of `mirror-e2e.test.ts`, minus the tunnel — an in-process `HttpClient` routes
// every pull request straight to the source app's `request()`.
const log: Logger = () => {};

// The source's origin id (served on /hello, the id the subscriber pulls with `?originId=`) and the
// subscriber's own node id (the `subscriber_id` half of its sync cursor). Distinct nodes, distinct
// databases.
const SOURCE_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUBSCRIBER_NODE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// The signing identity of the held document. The FIXTURE trust set maps this signer to its public key,
// so verifyMembershipDocument passes; the EMPTY set makes the same document `untrusted_signer` — the
// behaviour boot produces for a bare node whose nodes.public_key trust set is empty.
const SIGNER = "source-primary";
const kp = generateNodeKeyPair();
const TRUST: TrustSet = { [SIGNER]: kp.publicKey };
const EMPTY: TrustSet = {};
const doc = (term: number) => signedMembershipDoc(term, { signerNodeId: SIGNER, keyPair: kp });

// The document the source advertises throughout the suite. Term 4 so the idempotent second round has a
// concrete "not newer than 4" to assert.
const SOURCE_TERM = 4;

const source = useTemplateDb({ template: "manifest" });
const subscriber = useTemplateDb({ template: "manifest" });
const untrusted = useTemplateDb({ template: "manifest" });

let sourceReader: Database; // sync_applier (app_user): the /hello handler reads node_membership through this
let subscriberPool: Database; // sync_applier: runSyncPull's localDb + the adoption persist pool
let untrustedPool: Database; // the empty-trust control's equivalent
let peerToken: string; // enrolled on the SOURCE; the Bearer every pull presents
let sourceApp: Hono;
let httpClient: HttpClient;

/** Route a pull request straight into the source app in-process (no socket/tunnel) — the minimal
 * `HttpClient` shape syncPullOnce/runSyncPull consume. `app.request` accepts the full URL and parses
 * the path; the Response it returns already exposes `status` + `text()`. */
function inProcessClient(app: Hono): HttpClient {
  return async (url, init) =>
    app.request(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
}

/** Drive ONE real pull round against the source and return the adoption outcome. The wrapped
 * `adoptMembership` runs the REAL accept fence + persist on `localDb`, then aborts the controller so
 * runSyncPull settles after the single per-peer drain (the loop checks `signal.aborted` before its
 * sleep) — deterministic, no timing wait. The subscriber's log is empty (source serves no captured
 * rows), so the drain breaks on the first empty page and the adopt fires exactly once. */
async function pullOneRound(localDb: Database, trustSet: TrustSet): Promise<AcceptResult> {
  const ac = new AbortController();
  let outcome: AcceptResult | undefined;
  await runSyncPull({
    localDb,
    subscriberId: SUBSCRIBER_NODE,
    tenantId: TENANT,
    localEnvironment: "preproduction",
    http: httpClient,
    batchLimit: 500,
    enrolments: ALL_SYNC_ENROLMENTS,
    moduleVersions: {},
    moduleByTable: new Map<string, string>(),
    peers: [{ nodeId: SOURCE_NODE, url: "http://source.local", token: peerToken }],
    sleep: realSleep,
    signal: ac.signal,
    minIdleMs: 50,
    maxBackoffMs: 200,
    log,
    lane: "ordered",
    adoptMembership: async (raw: unknown): Promise<void> => {
      outcome = await adoptMembership({ db: localDb, trustSet }, raw);
      ac.abort();
    },
  });
  // The adopt callback always runs (a /hello is fetched on every drain, and the empty log breaks the
  // drain immediately), so `outcome` is set. Fail loudly rather than return a phantom value if a future
  // regression ever skipped it.
  if (outcome === undefined) throw new Error("adoptMembership was never invoked");
  return outcome;
}

beforeAll(async () => {
  // The source serves node_membership through a sync_applier pool (app_user's SELECT), exactly as
  // boot.ts:1053 builds it. The subscriber/untrusted pools are the same role: runSyncPull reads
  // the cursor + applies as app_user, and the adoption persist runs as app_user (Slice-3 grant).
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  subscriberPool = await subscriber.pg.connectAs("sync_applier", "ap");
  untrustedPool = await untrusted.pg.connectAs("sync_applier", "ap");

  // applyBatch refuses to apply a peer's rows into an UNSTAMPED database (CLAUDE.md §5 — a mirror must
  // be environment-stamped first), and runSyncPull drains through applyBatch before it ever reaches the
  // adopt callback. Stamp both puller databases `preproduction` to match the source's advertised
  // environment, exactly as `mirror-e2e.test.ts` stamps its booted mirrors. The source needs no
  // stamp — it only SERVES its log + membership, advertising its environment from mountSyncApi's deps.
  await stampDeployment(subscriber.admin, "preproduction");
  await stampDeployment(untrusted.admin, "preproduction");

  // Enrol the puller as a peer on the SOURCE (its value is irrelevant to /hello + /log, which need only
  // a valid Bearer) and seed the held term-4 document the source advertises.
  peerToken = (await enrolPeer(source.admin, { subscriberId: "gossip-e2e", name: "gossip-e2e" }))
    .token;
  await writeNodeMembership(source.admin, doc(SOURCE_TERM));

  sourceApp = new Hono();
  mountSyncApi(
    sourceApp,
    {
      db: sourceReader,
      tenantId: TENANT,
      nodeId: SOURCE_NODE,
      environment: "preproduction",
      enrolments: ALL_SYNC_ENROLMENTS,
      moduleVersions: {},
    },
    log,
  );
  httpClient = inProcessClient(sourceApp);
}, 180_000);

afterAll(async () => {
  // Only the three connectAs pools this suite opened are closed here; the admin connections and all
  // three clone databases are owned and torn down by the `useTemplateDb` calls.
  if (sourceReader !== undefined) await sourceReader.close();
  if (subscriberPool !== undefined) await subscriberPool.close();
  if (untrustedPool !== undefined) await untrustedPool.close();
});

describe("membership gossip e2e — the pull-handshake consume path (design §5)", () => {
  it("a subscriber with a trusting trust set adopts the source's advertised document, and a re-pull is idempotent", async () => {
    // Precondition: the subscriber has adopted nothing yet.
    expect(await readNodeMembership(subscriber.admin)).toBeNull();

    // ROUND 1: the real runSyncPull drains the source, hands its advertised /hello document to the real
    // adoptMembership, and the term-4 row is PERSISTED into the subscriber's OWN node_membership. Read
    // back through the admin connection (not the callback's return) so the assertion is about the row on
    // disk — proof the adoption actually happened, not merely that a function was called.
    const first = await pullOneRound(subscriberPool, TRUST);
    expect(first.accepted).toBe(true);
    const held = await readNodeMembership(subscriber.admin);
    expect(held).not.toBeNull();
    expect(held!.body.term).toBe(SOURCE_TERM);
    expect(held!.signerNodeId).toBe(SIGNER);

    // ROUND 2: pulling the SAME document again is a no-op — the accept fence rejects it as not_newer and
    // the persisted row is unchanged (idempotent gossip).
    const second = await pullOneRound(subscriberPool, TRUST);
    expect(second).toEqual({ accepted: false, reason: "not_newer" });
    expect((await readNodeMembership(subscriber.admin))!.body.term).toBe(SOURCE_TERM);
  }, 90_000);

  it("with an EMPTY trust set the subscriber adopts nothing — a bare node with no stamped key yields an empty trust set", async () => {
    // Same source, same advertised term-4 document, but the subscriber trusts no signer: the accept
    // fence rejects it `untrusted_signer` and NOTHING is persisted. This is what boot's real trust set
    // produces on a bare node with no stamped nodes.public_key — proving the mechanism is gated on trust
    // rather than always-on.
    expect(await readNodeMembership(untrusted.admin)).toBeNull();
    const outcome = await pullOneRound(untrustedPool, EMPTY);
    expect(outcome).toEqual({ accepted: false, reason: "invalid", failure: "untrusted_signer" });
    expect(await readNodeMembership(untrusted.admin)).toBeNull();
  }, 90_000);
});
