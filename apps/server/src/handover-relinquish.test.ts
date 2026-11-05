import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  CREDENTIALS_MIGRATIONS,
  type KeyRing,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  nodes,
  readTenant,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { persons } from "@waitron/identity";
import {
  canonicalize,
  endorseKey,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type MembershipNode,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import {
  advanceHandoverOperationTx,
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  readHandoverEvent,
  readHandoverOperation,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
} from "@waitron/node-db";
import type { StartedServer } from "./boot.js";
import { acceptFinalCopy, acceptedCopyPath } from "./handover-acceptance.js";
import {
  FINAL_STATE_EVENT,
  captureFinalCopy,
  finalCopyPath,
  type CaptureDeps,
} from "./handover-capture.js";
import { imageMigrationsDigest, readOfferSettings } from "./handover-manifest.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { advanceHandover, beginHandoverFromOffer } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHORISER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const MODULES = [
  {
    name: "core",
    version: "1.2.3",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
] as const satisfies readonly WaitronModule[];

interface RelinquishmentSeen {
  binding: unknown;
  indicatorDigest: string;
  acceptanceDigest: string;
  filingAssignedTo: string;
  authorisedBy: string;
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("the old box's acceptance route", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  });

  let stateDir: string;
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "waitron-relinquish-"));
  });
  afterEach(async () => {
    suite.node.run(sql`drop trigger if exists refuse_state_change`);
    await rm(stateDir, { recursive: true, force: true });
  });

  /** This box, with an offer stored, stepped down for OP to `destination` unless told otherwise. */
  async function rig({ steppedDown = true } = {}) {
    const db = suite.db;
    await seedVenue(db);
    const self = await seedNode(db);
    const destination = await seedNode(db);
    const bystander = await seedNode(db);
    for (const nodeId of [self, destination, bystander])
      await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const destinationKey = await readNodeIdentityKey(suite.node, RING, destination);
    const bystanderKey = await readNodeIdentityKey(suite.node, RING, bystander);
    const body: MembershipDocumentBody = {
      term: 3,
      nodes: [
        { nodeId: self, contactUrl: "https://box-0", standing: "serving-primary" },
        { nodeId: destination, contactUrl: "https://box-1", standing: "serving-secondary" },
        { nodeId: bystander, contactUrl: "https://box-2", standing: "serving-secondary" },
      ],
    };
    await writeNodeMembership(db, {
      body,
      signerNodeId: self,
      signature: signDocumentBody(body, selfKey),
      endorsements: [
        endorseKey(destination, nodeSigningPublicKey(destinationKey), self, selfKey),
        endorseKey(bystander, nodeSigningPublicKey(bystanderKey), self, selfKey),
      ],
    });
    const binding: HandoverBinding = {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: self,
      destinationNodeId: destination,
      membership: { term: 3, digest: "a".repeat(64) },
    };
    const signer = { nodeId: self, privateKey: selfKey };
    const store = { node: suite.node, nodeId: self };
    await beginHandoverFromOffer(
      store,
      binding,
      "source",
      signEnvelope(
        "stepdown",
        { binding: binding as unknown as CanonicalValue, authorisedBy: AUTHORISER },
        signer,
      ),
    );
    if (steppedDown) {
      await advanceHandover(store, OP, "source_stepped_down", {});
      await withNodeTransaction(suite.node, (tx) =>
        recordHandoverRestrictionTx(tx, {
          nodeId: self,
          operationId: OP,
          kind: "handed-over",
          successorNodeId: destination,
          membershipTerm: 3,
        }),
      );
    }
    const deps: CaptureDeps = {
      venue: db,
      node: suite.node,
      stateDir,
      ring: RING,
      nodeId: self,
      modules: MODULES,
    };
    const app = new Hono();
    mountHandoverSourceApi(app, deps, () => {});
    const destinationSigner = { nodeId: destination, privateKey: destinationKey };
    const post = (raw: unknown, operationId = OP): Promise<Response> =>
      Promise.resolve(
        app.request(`/api/node/handover/${operationId}/acceptance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(raw),
        }),
      );
    const acceptance = (
      indicatorDigest: string,
      {
        by = destinationSigner as { nodeId: string; privateKey: string },
        acceptedAtMs = 1,
        forBinding = binding,
      } = {},
    ) =>
      signEnvelope(
        "acceptance",
        {
          binding: forBinding as unknown as CanonicalValue,
          indicatorDigest,
          acceptedAtMs,
        },
        by,
      );
    const indicatorDigest = async () => envelopeDigest(await captureFinalCopy(deps, OP));
    const stored = () => readHandoverEvent(suite.node, self, OP, "filing_relinquished");
    const state = async () => (await readHandoverOperation(suite.node, self, OP))?.state;
    return {
      self,
      selfKey,
      destination,
      destinationSigner,
      bystanderSigner: { nodeId: bystander, privateKey: bystanderKey },
      signer,
      binding,
      store,
      post,
      acceptance,
      indicatorDigest,
      stored,
      state,
    };
  }

  it("records and answers a relinquishment bound to the indicator and the acceptance", async () => {
    const r = await rig();
    const digest = await r.indicatorDigest();
    const sent = r.acceptance(digest);
    const restrictionBefore = await readHandoverRestriction(suite.node, r.self);

    const response = await r.post(sent);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    const selfPublic = nodeSigningPublicKey(r.selfKey);
    const verdict = verifyEnvelope<RelinquishmentSeen>(JSON.parse(text), "relinquishment", (id) =>
      id === r.self ? selfPublic : undefined,
    );
    expect(verdict).toMatchObject({ valid: true, signerNodeId: r.self });
    expect((verdict as { body: RelinquishmentSeen }).body).toEqual({
      binding: r.binding,
      indicatorDigest: digest,
      acceptanceDigest: envelopeDigest(sent),
      filingAssignedTo: r.destination,
      authorisedBy: AUTHORISER,
    });
    expect(await r.state()).toBe("filing_relinquished");
    expect((await r.stored())?.envelope).toBe(text);
    expect(await readHandoverRestriction(suite.node, r.self)).toEqual(restrictionBefore);
  });

  describe("a repeat", () => {
    it("a repeated acceptance answers the same bytes and records nothing more", async () => {
      const r = await rig();
      const sent = r.acceptance(await r.indicatorDigest());
      const first = await (await r.post(sent)).text();
      const eventId = (await r.stored())?.eventId;

      const again = await r.post(sent);

      expect(again.status).toBe(200);
      expect(await again.text()).toBe(first);
      expect((await r.stored())?.eventId).toBe(eventId);
      expect(await r.state()).toBe("filing_relinquished");
    });

    it("another acceptance of the same indicator gets the first's answer, not a new one", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();
      const first = await (await r.post(r.acceptance(digest))).text();

      // Failing case: an answer signed afresh names this acceptance's digest instead.
      const later = await r.post(r.acceptance(digest, { acceptedAtMs: 2 }));

      expect(later.status).toBe(200);
      expect(await later.text()).toBe(first);
    });

    it("answers the text as stored, not an object written out again", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();
      // Canonical text and JSON.stringify of its parse are the same bytes, so only text no
      // serialiser would write tells them apart.
      const written = ` ${canonicalize(signEnvelope("relinquishment", { stored: true }, r.signer) as unknown as CanonicalValue)}\n`;
      await withNodeTransaction(suite.node, async (tx) => {
        await appendHandoverEventTx(tx, {
          nodeId: r.self,
          operationId: OP,
          kind: "filing_relinquished",
          detail: {},
          envelope: written,
        });
        await advanceHandoverOperationTx(tx, r.self, OP, "filing_relinquished", null);
      });

      const response = await r.post(r.acceptance(digest));

      expect(await response.text()).toBe(written);
    });

    it("is answered at a later state too", async () => {
      const r = await rig();
      const sent = r.acceptance(await r.indicatorDigest());
      const first = await (await r.post(sent)).text();
      await advanceHandover(r.store, OP, "return_pending", {});

      const again = await r.post(sent);

      expect(again.status).toBe(200);
      expect(await again.text()).toBe(first);
      expect(await r.state()).toBe("return_pending");
    });

    it("needs only the stored answer, so a lost offer does not stop it", async () => {
      const r = await rig();
      const sent = r.acceptance(await r.indicatorDigest());
      const first = await (await r.post(sent)).text();
      suite.node.run(sql`delete from node_handover_events where kind = 'offer'`);

      const again = await r.post(sent);

      expect(again.status).toBe(200);
      expect(await again.text()).toBe(first);
    });

    it("a stored step with no envelope is a fault in Waitron, not a new relinquishment", async () => {
      const r = await rig();
      const sent = r.acceptance(await r.indicatorDigest());
      await advanceHandover(r.store, OP, "filing_relinquished", {});

      const response = await r.post(sent);

      expect(response.status).toBe(500);
      expect((await r.stored())?.envelope).toBeNull();
    });

    it("two posts at once record one relinquishment, and both answer it", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();
      const answers = await Promise.all([
        r.post(r.acceptance(digest, { acceptedAtMs: 1 })),
        r.post(r.acceptance(digest, { acceptedAtMs: 2 })),
      ]);

      const texts = await Promise.all(answers.map((answer) => answer.text()));

      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
      expect(texts[1]).toBe(texts[0]);
      expect((await r.stored())?.envelope).toBe(texts[0]);
    });
  });

  describe("an acceptance that is refused leaves the box stepped down, having given up nothing", () => {
    const untouched = async (r: Awaited<ReturnType<typeof rig>>) => {
      expect(await r.state()).toBe("source_stepped_down");
      expect(await r.stored()).toBeNull();
    };

    it("one for another indicator", async () => {
      const r = await rig();
      await r.indicatorDigest();

      const response = await r.post(r.acceptance("e".repeat(64)));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "handover.indicator_mismatch", params: { field: "indicatorDigest" } },
      });
      await untouched(r);
    });

    it("one for another indicator after the relinquishment, which it does not get", async () => {
      const r = await rig();
      await r.post(r.acceptance(await r.indicatorDigest()));

      const response = await r.post(r.acceptance("e".repeat(64)));

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("handover.indicator_mismatch");
    });

    it("one when this box has stored no indicator", async () => {
      const r = await rig();
      // The digest of nothing this box signed: the failing case is any answer but the refusal.
      const response = await r.post(r.acceptance("e".repeat(64)));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "handover.indicator_mismatch", params: { field: FINAL_STATE_EVENT } },
      });
      await untouched(r);
    });

    it("one naming another operation's binding, over this operation's true indicator", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();

      const response = await r.post(
        r.acceptance(digest, { forBinding: { ...r.binding, operationId: OTHER_OP } }),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "handover.indicator_mismatch", params: { field: "binding" } },
      });
      await untouched(r);
    });

    it("one whose binding cannot be read", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();

      const response = await r.post(
        signEnvelope(
          "acceptance",
          { binding: { not: "a binding" }, indicatorDigest: digest, acceptedAtMs: 1 },
          r.destinationSigner,
        ),
      );

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("handover.indicator_mismatch");
      await untouched(r);
    });

    it("one signed by another box the chart lists", async () => {
      const r = await rig();
      const response = await r.post(
        r.acceptance(await r.indicatorDigest(), { by: r.bystanderSigner }),
      );

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
      await untouched(r);
    });

    it("one signed by this box itself", async () => {
      const r = await rig();
      const response = await r.post(r.acceptance(await r.indicatorDigest(), { by: r.signer }));

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
      await untouched(r);
    });

    it("one from a signer no stored key vouches for", async () => {
      const r = await rig();
      const response = await r.post(
        r.acceptance(await r.indicatorDigest(), {
          by: { nodeId: OTHER_OP, privateKey: r.selfKey },
        }),
      );

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
      await untouched(r);
    });

    it("one changed after it was signed", async () => {
      const r = await rig();
      const sent = r.acceptance(await r.indicatorDigest());

      const response = await r.post({ ...sent, body: { ...sent.body, acceptedAtMs: 9 } });

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
      await untouched(r);
    });

    it("an envelope of another kind, even signed by the destination", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();
      const response = await r.post(
        signEnvelope(
          "query",
          { binding: r.binding as unknown as CanonicalValue, indicatorDigest: digest },
          r.destinationSigner,
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "handover.request_invalid", params: { field: "envelope" } },
      });
      await untouched(r);
    });

    it.each([
      ["null", null],
      ["a list", []],
      ["a number", 5],
      ["no indicator digest", { binding: "x", acceptedAtMs: 1 }],
      ["a digest that is not text", { indicatorDigest: 5 }],
    ])("a signed acceptance whose body is %s", async (_name, body) => {
      const r = await rig();
      await r.indicatorDigest();

      const response = await r.post(
        signEnvelope("acceptance", body as CanonicalValue, r.destinationSigner),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "handover.request_invalid", params: { field: "body" } },
      });
      await untouched(r);
    });

    it("a body that is no envelope", async () => {
      const r = await rig();
      const response = await r.post({ indicatorDigest: "x" });

      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("handover.request_invalid");
      await untouched(r);
    });
  });

  describe("a box with nothing it can give up", () => {
    it("an operation this box does not hold is 404", async () => {
      const r = await rig();
      const response = await r.post(r.acceptance(await r.indicatorDigest()), OTHER_OP);

      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("handover.operation_unknown");
    });

    it("a box still selling, at prepared, is refused", async () => {
      const r = await rig({ steppedDown: false });
      const response = await r.post(r.acceptance("e".repeat(64)));

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("handover.not_stepped_down");
      expect(await r.state()).toBe("prepared");
      expect(await r.stored()).toBeNull();
    });

    it("an operation closed as replaced is refused, with nothing stored", async () => {
      const r = await rig();
      const digest = await r.indicatorDigest();
      await advanceHandover(r.store, OP, "replaced", {});

      const response = await r.post(r.acceptance(digest));

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("handover.not_stepped_down");
      expect(await r.state()).toBe("replaced");
      expect(await r.stored()).toBeNull();
    });
  });

  it("a write that fails records neither the step nor its envelope, and a retry gives up filing", async () => {
    const r = await rig();
    const sent = r.acceptance(await r.indicatorDigest());
    // Refuses the row's update, which comes after the event's insert: the failing case is an event
    // left behind by a write outside one transaction.
    suite.node.run(
      sql`create trigger refuse_state_change before update on node_handover_operations
          begin select raise(abort, 'the write fails here'); end`,
    );

    const refused = await r.post(sent);

    expect(refused.status).toBe(500);
    expect(await r.state()).toBe("source_stepped_down");
    expect(await r.stored()).toBeNull();

    suite.node.run(sql`drop trigger refuse_state_change`);
    const retried = await r.post(sent);
    expect(retried.status).toBe(200);
    expect(await r.state()).toBe("filing_relinquished");
  });

  it("an operation stored with no offer is a fault in Waitron, and gives up nothing", async () => {
    const r = await rig();
    const sent = r.acceptance(await r.indicatorDigest());
    suite.node.run(sql`delete from node_handover_events where kind = 'offer'`);

    const response = await r.post(sent);

    expect(response.status).toBe(500);
    expect(await r.state()).toBe("source_stepped_down");
    expect(await r.stored()).toBeNull();
  });
});

describe("two real starts: the old box restricted, the spare a mirror", () => {
  const migrations = migrationOptionsFor(manifestSets(), null);
  const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
  const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });
  const KEY_ENV = {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  };

  let main: StartedServer | undefined;
  let spare: StartedServer | undefined;
  const scratch: string[] = [];

  afterEach(async () => {
    await spare?.close();
    spare = undefined;
    await main?.close();
    main = undefined;
    for (const folder of scratch.splice(0)) await rm(folder, { recursive: true, force: true });
  });

  async function serverEnv(db: Database, nodeId: string): Promise<Record<string, string>> {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-relinquish-box-"));
    scratch.push(stateDir);
    const migrationsRoot = join(stateDir, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    return {
      ...KEY_ENV,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_MAX_TICK_MS: "600000",
      WAITRON_MIN_TICK_MS: "200",
    };
  }

  const chart = (
    mainId: string,
    mainUrl: string,
    spareId: string,
    { term = 3, standing = "serving-primary" as MembershipNode["standing"] } = {},
  ): MembershipDocumentBody => ({
    term,
    nodes: [
      { nodeId: mainId, contactUrl: mainUrl, standing },
      { nodeId: spareId, contactUrl: "https://spare.example", standing: "serving-secondary" },
    ],
  });

  /** Everything on disk for the old box to start restricted and the spare to take its copy. */
  async function prepared() {
    const ring = loadKeyRing(KEY_ENV);
    const mainVenue = await setupVenue(mainBox.db);
    const spareVenue = await setupVenue(spareBox.db);
    const mainId = mainVenue.cfg.nodeId;
    const spareId = spareVenue.cfg.nodeId;
    await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring }, mainId);
    await establishNodeIdentity({ ownerDb: spareBox.db, node: spareBox.node, ring }, spareId);
    const mainKey = await readNodeIdentityKey(mainBox.node, ring, mainId);
    const spareKey = await readNodeIdentityKey(spareBox.node, ring, spareId);
    const mainPublic = nodeSigningPublicKey(mainKey);
    const sparePublic = nodeSigningPublicKey(spareKey);
    await pinMainBoxKey(spareBox.node, spareId, { nodeId: mainId, publicKey: mainPublic });

    const signedChart = (body: MembershipDocumentBody) => ({
      body,
      signerNodeId: mainId,
      signature: signDocumentBody(body, mainKey),
      endorsements: [endorseKey(spareId, sparePublic, mainId, mainKey)],
    });
    const held = signedChart(chart(mainId, "https://box.example", spareId));
    await writeNodeMembership(mainBox.db, held);
    await stampDeployment(mainBox.db, "preproduction");
    await stampDeployment(spareBox.db, "preproduction");

    const [own] = await mainBox.db
      .select({ locationId: nodes.locationId })
      .from(nodes)
      .where(eq(nodes.id, mainId));
    await mainBox.db
      .insert(nodes)
      .values({ id: spareId, locationId: own!.locationId, name: "Spare", publicKey: sparePublic });
    const [owner] = await mainBox.db
      .insert(persons)
      .values({ displayName: "Owner", role: "admin", status: "active" })
      .returning({ id: persons.id });

    const tenant = (await readTenant(mainBox.db))!;
    const binding: HandoverBinding = {
      operationId: OP,
      scenario: "controlled",
      venue: { country: tenant.country, taxId: tenant.taxId, environment: "preproduction" },
      sourceNodeId: mainId,
      destinationNodeId: spareId,
      membership: {
        term: 3,
        digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)),
      },
    };
    const mainEnv = await serverEnv(mainBox.db, mainId);
    const spareEnv = await serverEnv(spareBox.db, spareId);
    const offer = signEnvelope(
      "stepdown",
      {
        binding: binding as unknown as CanonicalValue,
        authorisedBy: owner!.id,
        settings: (await readOfferSettings(
          mainEnv.WAITRON_STATE_DIR!,
          ring,
          "handover.settings_unreadable",
        )) as unknown as CanonicalValue,
        imageMigrations: imageMigrationsDigest(null),
      },
      { nodeId: mainId, privateKey: mainKey },
    );
    const mainStore = { node: mainBox.node, nodeId: mainId };
    await beginHandoverFromOffer(mainStore, binding, "source", offer);
    await advanceHandover(mainStore, OP, "source_stepped_down", {});
    await withNodeTransaction(mainBox.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: mainId,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: spareId,
        membershipTerm: 3,
      }),
    );
    await beginHandoverFromOffer(
      { node: spareBox.node, nodeId: spareId },
      binding,
      "destination",
      offer,
    );
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spareId, "mirror");
    await writeMirrorLink(spareBox.node, spareId, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: mintSelfSignedServerCert({
        hostnames: ["box.local"],
        ipAddresses: [],
        now: new Date(),
      }).caCertPem,
      originNodeId: mainId,
    });
    const writeSpareChart = (mainUrl: string, change: Parameters<typeof chart>[3] = {}) =>
      writeNodeMembership(spareBox.db, signedChart(chart(mainId, mainUrl, spareId, change)));
    const chartSignedBySpare = (mainUrl: string, term: number) => {
      const body = chart(mainId, mainUrl, spareId, { term });
      return {
        body,
        signerNodeId: spareId,
        signature: signDocumentBody(body, spareKey),
        endorsements: [endorseKey(mainId, mainPublic, spareId, spareKey)],
      };
    };
    return { mainId, spareId, mainEnv, spareEnv, mainPublic, writeSpareChart, chartSignedBySpare };
  }

  const refusesSales = async (port: number): Promise<void> => {
    const role = await fetch(`http://127.0.0.1:${port}/api/node`);
    expect(await role.json()).toMatchObject({ acceptingSales: false });
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await health.json()).toEqual({ ok: true, tradingAvailable: false });
  };

  const event = (node: NodeDatabase, nodeId: string, kind: string) =>
    readHandoverEvent(node, nodeId, OP, kind);

  it("a chart evicting the old box at copy_accepted: the real old box gives up nothing, and a chart naming it again carries on", async () => {
    const ring = loadKeyRing(KEY_ENV);
    const boxes = await prepared();
    const mainState = boxes.mainEnv.WAITRON_STATE_DIR!;
    const spareState = boxes.spareEnv.WAITRON_STATE_DIR!;
    const indicator = await captureFinalCopy(
      {
        venue: mainBox.db,
        node: mainBox.node,
        stateDir: mainState,
        ring,
        nodeId: boxes.mainId,
        modules: [],
      },
      OP,
    );
    const received = join(spareState, "received.db");
    await copyFile(finalCopyPath(mainState, OP), received);
    await mkdir(dirname(acceptedCopyPath(spareState, OP)), { recursive: true });
    await acceptFinalCopy(
      { node: spareBox.node, ring, nodeId: boxes.spareId, stateDir: spareState },
      (await readHandoverOperation(spareBox.node, boxes.spareId, OP))!,
      indicator,
      received,
    );
    beforeServerStarts();
    const restrictionBefore = await readHandoverRestriction(mainBox.node, boxes.mainId);

    main = await startServer(boxes.mainEnv, boxes.mainEnv);
    const mainPort = httpPort();
    await boxes.writeSpareChart(`http://127.0.0.1:${mainPort}`, { term: 4, standing: "evicted" });
    const restart = vi.fn();
    spare = await startServer(boxes.spareEnv, boxes.spareEnv, {
      peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
      stepdown: { mount: () => {}, restart },
    });
    const sparePort = httpPort();

    await vi.waitFor(
      async () =>
        expect(await readHandoverOperation(spareBox.node, boxes.spareId, OP)).toMatchObject({
          state: "copy_accepted",
          waitingReason: "handover.source_no_longer_main",
        }),
      { timeout: 60_000, interval: 200 },
    );
    expect((await readHandoverOperation(mainBox.node, boxes.mainId, OP))?.state).toBe(
      "source_stepped_down",
    );
    expect(await event(mainBox.node, boxes.mainId, "filing_relinquished")).toBeNull();
    await refusesSales(mainPort);
    expect(await readHandoverRestriction(mainBox.node, boxes.mainId)).toEqual(restrictionBefore);
    expect(restart).not.toHaveBeenCalled();

    const naming = await fetch(`http://127.0.0.1:${sparePort}/api/node/membership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document: boxes.chartSignedBySpare(`http://127.0.0.1:${mainPort}`, 5),
      }),
    });
    expect(await naming.json()).toMatchObject({ accepted: true });
    await vi.waitFor(
      async () =>
        expect(await readHandoverOperation(spareBox.node, boxes.spareId, OP)).toMatchObject({
          state: "filing_assumed",
          waitingReason: null,
        }),
      { timeout: 60_000, interval: 200 },
    );
    expect((await readHandoverOperation(mainBox.node, boxes.mainId, OP))?.state).toBe(
      "filing_relinquished",
    );
  }, 180_000);

  it("from fetch to acceptance on the real routes, the same bytes through a restart, restricted throughout", async () => {
    const boxes = await prepared();
    beforeServerStarts();
    const restrictionBefore = await readHandoverRestriction(mainBox.node, boxes.mainId);

    main = await startServer(boxes.mainEnv, boxes.mainEnv);
    const mainPort = httpPort();
    await refusesSales(mainPort);

    await boxes.writeSpareChart(`http://127.0.0.1:${mainPort}`);
    spare = await startServer(boxes.spareEnv, boxes.spareEnv, {
      peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
      stepdown: { mount: () => {}, restart: () => {} },
    });

    await vi.waitFor(
      async () => {
        const row = await readHandoverOperation(spareBox.node, boxes.spareId, OP);
        // Failing case: the row waits with one of the refusals named here.
        expect({ state: row?.state, reason: row?.waitingReason }).toEqual({
          state: "filing_assumed",
          reason: null,
        });
      },
      { timeout: 60_000, interval: 200 },
    );

    const relinquished = await event(mainBox.node, boxes.mainId, "filing_relinquished");
    const assumed = await event(spareBox.node, boxes.spareId, "filing_assumed");
    expect(assumed?.envelope).toBe(relinquished?.envelope);
    expect((await readHandoverOperation(mainBox.node, boxes.mainId, OP))?.state).toBe(
      "filing_relinquished",
    );
    const body = JSON.parse(relinquished!.envelope!) as SignedHandoverEnvelope<RelinquishmentSeen>;
    const acceptance = (await event(spareBox.node, boxes.spareId, "copy_accepted"))!.envelope!;
    expect(body.body.acceptanceDigest).toBe(
      envelopeDigest(JSON.parse(acceptance) as SignedHandoverEnvelope<unknown>),
    );
    await refusesSales(mainPort);
    expect(await readHandoverRestriction(mainBox.node, boxes.mainId)).toEqual(restrictionBefore);

    await main.close();
    main = undefined;
    main = await startServer(boxes.mainEnv, boxes.mainEnv);
    const restartedPort = httpPort();
    await refusesSales(restartedPort);

    const again = await fetch(
      `http://127.0.0.1:${restartedPort}/api/node/handover/${OP}/acceptance`,
      { method: "POST", headers: { "content-type": "application/json" }, body: acceptance },
    );

    expect(again.status).toBe(200);
    expect(await again.text()).toBe(relinquished!.envelope);
    expect((await event(mainBox.node, boxes.mainId, "filing_relinquished"))?.eventId).toBe(
      relinquished!.eventId,
    );
    await refusesSales(restartedPort);
    expect(await readHandoverRestriction(mainBox.node, boxes.mainId)).toEqual(restrictionBefore);

    // A different body refused on the restarted box: this route is really reading what it holds.
    const another = JSON.parse(acceptance) as SignedHandoverEnvelope<{ indicatorDigest: string }>;
    const spareSigner = {
      nodeId: boxes.spareId,
      privateKey: await readNodeIdentityKey(spareBox.node, loadKeyRing(KEY_ENV), boxes.spareId),
    };
    const refused = await fetch(
      `http://127.0.0.1:${restartedPort}/api/node/handover/${OP}/acceptance`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          signEnvelope(
            "acceptance",
            { ...another.body, indicatorDigest: "e".repeat(64) } as unknown as CanonicalValue,
            spareSigner,
          ),
        ),
      },
    );
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("handover.indicator_mismatch");
  }, 180_000);
});
