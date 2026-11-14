import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  readMembershipTrustSet,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import {
  loadKeyRing,
  setPairLinkStateTx,
  tryGetCredential,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import { beginHandoverOperationTx, readPairLink } from "@waitron/node-db";
import { startManagementSession } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  MAX_REVOKED,
  routableServers,
  verifyMembershipDocument,
  type MembershipNode,
} from "@waitron/membership";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import { createTurns } from "./backup-turns.js";
import { mountStreamApi } from "./stream-api.js";
import { establishNodeIdentity } from "./node-identity.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";

const pause = { beforeChartMint: undefined as (() => Promise<void>) | undefined };

vi.mock("./membership-mint.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./membership-mint.js")>();
  return {
    ...actual,
    mintNextMembershipDocument: async (
      ...args: Parameters<typeof actual.mintNextMembershipDocument>
    ) => {
      const hook = pause.beforeChartMint;
      pause.beforeChartMint = undefined;
      await hook?.();
      return actual.mintNextMembershipDocument(...args);
    },
  };
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const BOX_URL = "https://box.deli.test";
const FINGERPRINT =
  "3F:A1:9C:0B:7E:22:D4:51:88:6A:E0:13:BC:47:F9:2D:65:0E:A8:31:DC:74:5B:96:C2:0F:E7:38:41:AD:9B:16";
const CLOUD_URL = "https://cloud.deli.test";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Primary {
  db: Database;
  nodeId: string;
  locationId: string;
  publicKey: string;
  adminPersonId: string;
  adminCookie: string;
  managerCookie: string;
  lines: { level: string; event: string; fields: Record<string, unknown> | undefined }[];
  reloadStream: ReturnType<typeof vi.fn<() => Promise<void>>>;
  app: Hono;
}

/** A provisioned venue whose node holds its sealed identity key, and an admin's dashboard session. */
async function primary(
  authorityFingerprint: () => Promise<string | null> = async () => FINGERPRINT,
): Promise<Primary> {
  const db = suite.db;
  const venue = await setupVenue(db);
  const nodeId = venue.cfg.nodeId;
  await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  const publicKey = (await readMembershipTrustSet(db))[nodeId]!;
  const { adminPersonId, token } = await withTransaction(db, async (tx) => {
    const rows = tx.all<{ id: string }>(
      sql`select id from persons where email = 'owner@example.test'`,
    );
    const personId = rows[0]!.id;
    const session = await startManagementSession(tx, { personId });
    await setFreshManagementSignIn(tx, session.token);
    return { adminPersonId: personId, token: session.token };
  });
  const lines: Primary["lines"] = [];
  const log: Logger = (level, event, fields) => lines.push({ level, event, fields });
  const app = new Hono();
  const reloadStream = vi.fn(async () => {});
  mountMembershipRemovalApi(
    app,
    { db, node: suite.node, ring: RING, nodeId, authorityFingerprint, reloadStream },
    log,
  );
  return {
    db,
    nodeId,
    locationId: venue.cfg.locationId,
    publicKey,
    adminPersonId,
    adminCookie: `${MANAGEMENT_COOKIE}=${token}`,
    managerCookie: venue.managerCookie,
    lines,
    reloadStream,
    app,
  };
}

/** The next chart, minted and signed by this node the way the product mints one. */
async function holdChart(p: Primary, nodes: readonly MembershipNode[]): Promise<void> {
  const held = await readNodeMembership(p.db);
  const document = await mintNextMembershipDocument(
    { db: p.db, node: suite.node, ring: RING },
    { heldDocument: held, nodes, signerNodeId: p.nodeId, verifyHeld: "none" },
  );
  await writeNodeMembership(p.db, document);
}

function self(p: Primary): MembershipNode {
  return { nodeId: p.nodeId, contactUrl: BOX_URL, standing: "serving-primary" };
}

function standby(nodeId: string = randomUUID(), contactUrl = CLOUD_URL): MembershipNode {
  return { nodeId, contactUrl, standing: "serving-secondary" };
}

const DECLARED = { spareSwitchedOff: true, noParallelRecovery: true };

/** `body` is sent as JSON; a string is sent as it is, so a malformed body can be tried. */
async function remove(
  p: Primary,
  nodeId: string,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers["cookie"] = cookie;
  if (body === undefined) {
    return p.app.request(`/management-api/servers/${nodeId}/remove`, { method: "POST", headers });
  }
  headers["content-type"] = "application/json";
  return p.app.request(`/management-api/servers/${nodeId}/remove`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function clear(p: Primary, nodeId: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers["cookie"] = cookie;
  return p.app.request(`/management-api/servers/${nodeId}/clear`, { method: "POST", headers });
}

async function list(p: Primary, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers["cookie"] = cookie;
  return p.app.request("/management-api/servers", { method: "GET", headers });
}

async function errorOf(res: Response): Promise<{ code: string; params: unknown }> {
  return ((await res.json()) as { error: { code: string; params: unknown } }).error;
}

function errorEvents(p: Primary): string[] {
  return p.lines.filter((l) => l.level === "error").map((l) => l.event);
}

async function removals(db: Database): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`select subject_id as removed_node_id, json_extract(data, '$.contactUrl') as contact_url, person_id, json_extract(data, '$.term') as term from activity_log where kind = 'membership.node_removed' order by at, rowid`,
  );
  return rows;
}

async function clearances(db: Database): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`select subject_id as cleared_node_id, person_id, json_extract(data, '$.term') as term from activity_log where kind = 'membership.node_cleared' order by at, rowid`,
  );
  return rows;
}

function evicted(nodeId: string = randomUUID(), contactUrl = CLOUD_URL): MembershipNode {
  return { nodeId, contactUrl, standing: "evicted" };
}

/** Holds the next chart with `revoked` as its revoked list, minted and signed by this node. */
async function holdChartRevoking(
  p: Primary,
  nodes: readonly MembershipNode[],
  revoked: readonly string[],
): Promise<void> {
  const held = await readNodeMembership(p.db);
  const document = await mintNextMembershipDocument(
    { db: p.db, node: suite.node, ring: RING },
    { heldDocument: held, nodes, signerNodeId: p.nodeId, revoked, verifyHeld: "none" },
  );
  await writeNodeMembership(p.db, document);
}

async function heldTerm(db: Database): Promise<number | undefined> {
  return (await readNodeMembership(db))?.body.term;
}

async function linkTo(p: Primary, peerNodeId: string): Promise<void> {
  await withNodeTransaction(suite.node, (tx) =>
    writePairLinkTx(tx, RING, p.nodeId, {
      role: "streams",
      state: "pending",
      peerNodeId,
      peerPublicKey: "pub",
      storeUrl: "https://box-7777.waitron.local:7443",
      venueId: "venue",
      accessKeyId: "spare-access-key",
      secretAccessKey: "spare-secret-key",
    }),
  );
}

it.each(["remove", "clear"] as const)(
  "requires confirmation before a server %s changes the chart",
  async (action) => {
    const p = await primary();
    const target = action === "remove" ? standby() : evicted();
    await holdChart(p, [self(p), target]);
    await withTransaction(p.db, (tx) => setFreshManagementSignIn(tx, p.adminCookie, false));
    const before = await readNodeMembership(p.db);
    expect((await list(p, p.adminCookie)).status).toBe(200);
    const response = await (action === "remove" ? remove : clear)(p, target.nodeId, p.adminCookie);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      code: "management_session.proof_required",
      params: {},
    });
    expect(await readNodeMembership(p.db)).toEqual(before);
    expect(await removals(p.db)).toEqual([]);
    expect(await clearances(p.db)).toEqual([]);
  },
);

describe("POST /management-api/servers/:nodeId/remove", () => {
  it("marks a standby that never finished joining evicted in a new chart this node signs, and records who did it", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    const before = (await readNodeMembership(p.db))!;

    const res = await remove(p, gone.nodeId, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, term: before.body.term + 1 });
    const after = (await readNodeMembership(p.db))!;
    expect(after.body.term).toBe(before.body.term + 1);
    expect(after.body.nodes).toEqual([self(p), { ...gone, standing: "evicted" }]);
    expect(after.signerNodeId).toBe(p.nodeId);
    const verdict = verifyMembershipDocument(after, { [p.nodeId]: p.publicKey });
    expect(verdict.valid ? "valid" : verdict.reason).toBe("valid");
    expect(routableServers(before).map((s) => s.url)).toContain(CLOUD_URL);
    expect(routableServers(after).map((s) => s.url)).toEqual([BOX_URL]);
    expect(await removals(p.db)).toEqual([
      {
        removed_node_id: gone.nodeId,
        contact_url: CLOUD_URL,
        person_id: p.adminPersonId,
        term: before.body.term + 1,
      },
    ]);
    expect(p.lines).toEqual([
      {
        level: "info",
        event: "membership.node_removed",
        fields: { nodeId: gone.nodeId, term: before.body.term + 1, personId: p.adminPersonId },
      },
    ]);
  });

  it("answers an already-evicted node removed:false, without re-signing the chart or a second record", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    expect((await remove(p, gone.nodeId, p.adminCookie)).status).toBe(200);
    const held = await readNodeMembership(p.db);

    const again = await remove(p, gone.nodeId, p.adminCookie);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ removed: false, term: held!.body.term });
    expect(await readNodeMembership(p.db)).toEqual(held);
    expect(await removals(p.db)).toHaveLength(1);
  });

  describe("refusals leave the chart and the record untouched", () => {
    async function expectRefused(
      p: Primary,
      nodeId: string,
      status: number,
      code: string,
    ): Promise<void> {
      const before = await readNodeMembership(p.db);
      const res = await remove(p, nodeId, p.adminCookie);
      expect(res.status).toBe(status);
      expect((await errorOf(res)).code).toBe(code);
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await removals(p.db)).toEqual([]);
    }

    it("refuses an id the chart does not list as membership.node_not_found (404)", async () => {
      const p = await primary();
      await holdChart(p, [self(p), standby()]);
      await expectRefused(p, randomUUID(), 404, "membership.node_not_found");
    });

    it("refuses a malformed id as membership.node_not_found (404)", async () => {
      const p = await primary();
      await holdChart(p, [self(p), standby()]);
      await expectRefused(p, "not-a-uuid", 404, "membership.node_not_found");
    });

    it("refuses any id as membership.node_not_found (404) when no chart is held", async () => {
      const p = await primary();
      expect(await readNodeMembership(p.db)).toBeNull();
      await expectRefused(p, randomUUID(), 404, "membership.node_not_found");
    });

    it("refuses this node, the serving primary, as membership.node_is_primary (409)", async () => {
      const p = await primary();
      await holdChart(p, [self(p), standby()]);
      await expectRefused(p, p.nodeId, 409, "membership.node_is_primary");
    });

    it("refuses a former primary (sell-only) as membership.node_has_served (409)", async () => {
      const p = await primary();
      const former: MembershipNode = {
        nodeId: randomUUID(),
        contactUrl: "https://old.deli.test",
        standing: "sell-only",
      };
      await holdChart(p, [self(p), former]);
      await expectRefused(p, former.nodeId, 409, "membership.node_has_served");
    });

    it("refuses a standby this database holds a node row for as membership.standby_joined (409)", async () => {
      const p = await primary();
      const joinedId = await seedNode(p.db);
      await holdChart(p, [self(p), standby(joinedId)]);
      await expectRefused(p, joinedId, 409, "membership.standby_joined");
    });

    it("refuses on a node that is not the chart's serving primary as membership.not_primary (409), even for a removable standby", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [
        {
          nodeId: randomUUID(),
          contactUrl: "https://elsewhere.deli.test",
          standing: "serving-primary",
        },
        { ...self(p), standing: "serving-secondary" },
        gone,
      ]);
      await expectRefused(p, gone.nodeId, 409, "membership.not_primary");
    });

    it("refuses 409 membership.revoked_node_listed when the held chart lists the standby in both lists, so no chart can be minted", async () => {
      const p = await primary();
      const both = standby();
      await writeNodeMembership(
        p.db,
        signedMembershipDoc(1, {
          signerNodeId: p.nodeId,
          nodes: [self(p), both],
          revoked: [both.nodeId],
        }),
      );
      await expectRefused(p, both.nodeId, 409, "membership.revoked_node_listed");
    });
  });

  describe("who may remove", () => {
    it("refuses a request with no dashboard session as management_session.required (401)", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);

      const res = await remove(p, gone.nodeId);

      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe("management_session.required");
      expect(await readNodeMembership(p.db)).toEqual(before);
    });

    it("refuses a manager (no node.manage) as authorization.not_permitted (403), for a real id and an unknown one alike", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);

      for (const nodeId of [gone.nodeId, randomUUID(), "not-a-uuid"]) {
        const res = await remove(p, nodeId, p.managerCookie);
        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("authorization.not_permitted");
      }
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await removals(p.db)).toEqual([]);
    });
  });

  describe("the term-guarded chart write", () => {
    it("re-reads and re-signs when a newer chart lands between its read and its write, keeping the machine that chart added", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [self(p), gone]);
      const seedTerm = (await heldTerm(p.db))!;
      const added = standby(randomUUID(), "https://added.deli.test");
      // Stands in for another writer, once: the first write is skipped and the held chart moves one
      // term on, with a machine added, so the round that read `seedTerm` loses its guard. The marker
      // row stops the trigger firing on its own update, since the store turns recursive triggers on.
      await p.db.execute(sql.raw("create table test_newer_landed (done integer)"));
      await p.db.execute(
        sql.raw(
          `create trigger test_membership_newer_lands before update on node_membership
           when not exists (select 1 from test_newer_landed)
           begin
             insert into test_newer_landed values (1);
             update node_membership set term = term + 1,
               document = json_insert(
                 json_set(document, '$.body.term', term + 1),
                 '$.body.nodes[#]',
                 json('${JSON.stringify(added)}')
               ) where id = 1;
             select raise(ignore);
           end`,
        ),
      );
      let res: Response;
      try {
        res = await remove(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_membership_newer_lands"));
        await p.db.execute(sql.raw("drop table test_newer_landed"));
      }

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ removed: true, term: seedTerm + 2 });
      const after = (await readNodeMembership(p.db))!;
      expect(after.body.term).toBe(seedTerm + 2);
      expect(after.body.nodes).toEqual([self(p), { ...gone, standing: "evicted" }, added]);
      const verdict = verifyMembershipDocument(after, { [p.nodeId]: p.publicKey });
      expect(verdict.valid ? "valid" : verdict.reason).toBe("valid");
      expect(await removals(p.db)).toEqual([
        expect.objectContaining({ removed_node_id: gone.nodeId, term: seedTerm + 2 }),
      ]);
    });

    it("refuses as membership.standby_joined (409) when the standby's node row lands after the first check, changing nothing", async () => {
      const p = await primary();
      const late = standby();
      await holdChart(p, [self(p), late]);
      const before = await readNodeMembership(p.db);
      // The row lands during the chart write, inside the removal's transaction and after the check
      // the removal made before minting.
      await p.db.execute(
        sql.raw(
          `create trigger test_standby_joins before update on node_membership
           begin
             insert into nodes (id, name, created_at)
               select '${late.nodeId}', 'Joined late', created_at
               from nodes where id = '${p.nodeId}';
           end`,
        ),
      );
      let res: Response;
      try {
        res = await remove(p, late.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_standby_joins"));
      }

      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("membership.standby_joined");
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await removals(p.db)).toEqual([]);
    });

    it("commits the chart and its removal record together: a refused record leaves the chart unmoved", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);
      await p.db.execute(
        sql.raw(
          `create trigger test_removal_refused before insert on activity_log when new.kind = 'membership.node_removed'
           begin select raise(abort, 'test: removal record refused'); end`,
        ),
      );
      let res: Response;
      try {
        res = await remove(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_removal_refused"));
      }

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "server.internal" } });
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await removals(p.db)).toEqual([]);
      expect(p.lines.map((l) => l.event)).not.toContain("membership.node_removed");
      expect(errorEvents(p)).toEqual(["membership.removal_failed"]);
    });

    it("gives up with 503 membership.write_contended when every round loses, recording nothing", async () => {
      const p = await primary();
      const gone = standby();
      await holdChart(p, [self(p), gone]);
      const seedTerm = await heldTerm(p.db);
      await p.db.execute(
        sql.raw(
          "create trigger test_membership_contended before update on node_membership begin select raise(ignore); end",
        ),
      );
      let res: Response;
      try {
        res = await remove(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_membership_contended"));
      }

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: "membership.write_contended", params: { attempts: 8 } },
      });
      expect(await heldTerm(p.db)).toBe(seedTerm);
      expect(await removals(p.db)).toEqual([]);
    });
  });
});

describe("removing the standby this box's pair link names", () => {
  function mountBucketCopy(p: Primary): void {
    mountStreamApi(
      p.app,
      {
        db: p.db,
        node: suite.node,
        nodeId: p.nodeId,
        ring: RING,
        stream: { reload: async () => {}, status: () => ({ state: "off" }) },
        isPrimary: () => true,

        readRecoveryKey: async () => "recovery-key-one-strong",
        writeRecoveryKey: async () => {},
        sealedState: { refresh: async () => "sealed" as const },
        probe: async () => ({ ok: true as const }),
        prepareEncryption: async () => ({ ok: true as const }),
        turns: createTurns(),
      },
      () => {},
    );
  }

  async function saveBucket(p: Primary): Promise<Response> {
    return p.app.request("/api/backup/stream", {
      method: "PUT",
      headers: { cookie: p.adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://s3.example.net",
        region: "eu-west-1",
        bucket: "venue-copy",
        prefix: "",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "not-a-real-secret-0123456789",
      }),
    });
  }

  it("removing a standby that never finished joining deletes the pair link, and bucket settings can then be saved", async () => {
    const p = await primary();
    mountBucketCopy(p);
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    await linkTo(p, gone.nodeId);
    expect((await saveBucket(p)).status).toBe(409);

    const res = await remove(p, gone.nodeId, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
    expect(p.lines).toContainEqual({
      level: "info",
      event: "membership.pair_link_deleted",
      fields: { nodeId: gone.nodeId },
    });
    expect((await saveBucket(p)).status).toBe(200);
    expect(
      await withTransaction(p.db, (tx) => tryGetCredential(tx, RING, { purpose: "backup.stream" })),
    ).not.toBeNull();
  });

  it.each([
    ["the cleared spare's", 200],
    ["an active spare's", 409],
  ] as const)(
    "after Clear of a retired joined spare, bucket Save answers %s streaming link with %i",
    async (whose, status) => {
      const p = await primary();
      mountBucketCopy(p);
      const retired = evicted(await seedNode(p.db));
      const active = standby();
      await holdChart(p, [self(p), retired, active]);
      const linked = whose === "the cleared spare's" ? retired : active;
      await linkTo(p, linked.nodeId);
      await withNodeTransaction(suite.node, (tx) => setPairLinkStateTx(tx, p.nodeId, "streaming"));
      expect((await saveBucket(p)).status).toBe(409);

      expect((await clear(p, retired.nodeId, p.adminCookie)).status).toBe(200);

      const save = await saveBucket(p);
      expect(save.status).toBe(status);
      if (status === 409)
        expect(await errorOf(save)).toMatchObject({ code: "backup.spare_stream_active" });
    },
  );

  it("a standby with a nodes row is still refused removal, and its pair link stays", async () => {
    const p = await primary();
    const joinedId = await seedNode(p.db);
    await holdChart(p, [self(p), standby(joinedId)]);
    await linkTo(p, joinedId);

    const res = await remove(p, joinedId, p.adminCookie);

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "membership.standby_joined", params: {} });
    expect((await readPairLink(suite.node, p.nodeId))?.peerNodeId).toBe(joinedId);
    expect(p.reloadStream).not.toHaveBeenCalled();
  });

  it("removing another standby leaves the pair link and the copy alone", async () => {
    const p = await primary();
    const linked = standby();
    const other = standby(randomUUID(), "https://other.deli.test");
    await holdChart(p, [self(p), linked, other]);
    await linkTo(p, linked.nodeId);

    expect((await remove(p, other.nodeId, p.adminCookie)).status).toBe(200);

    expect((await readPairLink(suite.node, p.nodeId))?.peerNodeId).toBe(linked.nodeId);
    expect(p.reloadStream).toHaveBeenCalledOnce();
    expect(p.lines.map((l) => l.event)).not.toContain("membership.pair_link_deleted");
  });

  it("a second removal deletes a pair link the first left behind", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), { ...gone, standing: "evicted" }]);
    await linkTo(p, gone.nodeId);

    const res = await remove(p, gone.nodeId, p.adminCookie);

    expect(await res.json()).toMatchObject({ removed: false });
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
  });

  it("a reload that fails after the pair link is deleted is logged by its code, and the removal still answers 200", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    await linkTo(p, gone.nodeId);
    p.reloadStream.mockRejectedValueOnce(new AppError("backup.reload_in_progress", {}));

    const res = await remove(p, gone.nodeId, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true });
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
    expect(p.lines).toContainEqual({
      level: "warn",
      event: "membership.stream_reload_failed",
      fields: { nodeId: gone.nodeId, errorCode: "backup.reload_in_progress" },
    });
  });
});

describe("retiring a spare that finished joining", () => {
  async function hasNodeRow(db: Database, nodeId: string): Promise<boolean> {
    const { rows } = await db.execute(sql`select id from nodes where id = ${nodeId}`);
    return rows.length === 1;
  }

  async function openHandover(p: Primary, sourceNodeId: string, destinationNodeId: string) {
    await withNodeTransaction(suite.node, (tx) =>
      beginHandoverOperationTx(tx, {
        nodeId: p.nodeId,
        operationId: randomUUID(),
        role: "source",
        scenario: "controlled",
        sourceNodeId,
        destinationNodeId,
        binding: {},
        fingerprint: "f",
        state: "prepared",
        waitingReason: null,
      }),
    );
  }

  it("removes a joined spare once both declarations are true, keeping its node row", async () => {
    const p = await primary();
    const joinedId = await seedNode(p.db);
    const joined = standby(joinedId);
    await holdChart(p, [self(p), joined]);
    const term = (await heldTerm(p.db))! + 1;

    const res = await remove(p, joinedId, p.adminCookie, DECLARED);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, term });
    expect((await readNodeMembership(p.db))!.body.nodes).toEqual([
      self(p),
      { ...joined, standing: "evicted" },
    ]);
    expect(await removals(p.db)).toEqual([
      { removed_node_id: joinedId, contact_url: CLOUD_URL, person_id: p.adminPersonId, term },
    ]);
    expect(await hasNodeRow(p.db, joinedId)).toBe(true);
    expect(p.reloadStream).toHaveBeenCalledOnce();
  });

  it("removes a former primary that now serves as a spare the same way", async () => {
    const p = await primary();
    const formerId = await seedNode(p.db);
    const oldUrl = "https://old.deli.test";
    await holdChart(p, [
      { nodeId: formerId, contactUrl: oldUrl, standing: "serving-primary" },
      { ...self(p), standing: "serving-secondary" },
    ]);
    await holdChart(p, [self(p), standby(formerId, oldUrl)]);

    const res = await remove(p, formerId, p.adminCookie, DECLARED);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true });
    expect((await readNodeMembership(p.db))!.body.nodes).toEqual([
      self(p),
      { nodeId: formerId, contactUrl: oldUrl, standing: "evicted" },
    ]);
    expect(await removals(p.db)).toHaveLength(1);
    expect(await hasNodeRow(p.db, formerId)).toBe(true);
  });

  it.each([
    ["no body", undefined],
    ["an empty object", {}],
    ["an unparsable body", "{not json"],
    ["false", { spareSwitchedOff: false, noParallelRecovery: false }],
    ["null", { spareSwitchedOff: null, noParallelRecovery: null }],
    ['"true"', { spareSwitchedOff: "true", noParallelRecovery: "true" }],
    ["[true]", { spareSwitchedOff: [true], noParallelRecovery: [true] }],
    ["only spareSwitchedOff", { spareSwitchedOff: true, noParallelRecovery: false }],
    ["only noParallelRecovery", { spareSwitchedOff: false, noParallelRecovery: true }],
    ["only spareSwitchedOff, other missing", { spareSwitchedOff: true }],
    ["only noParallelRecovery, other missing", { noParallelRecovery: true }],
  ])("refuses a joined spare as membership.standby_joined (409) with %s", async (_, body) => {
    const p = await primary();
    const joinedId = await seedNode(p.db);
    await holdChart(p, [self(p), standby(joinedId)]);
    await linkTo(p, joinedId);
    const before = await readNodeMembership(p.db);

    const res = await remove(p, joinedId, p.adminCookie, body);

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "membership.standby_joined", params: {} });
    expect(await readNodeMembership(p.db)).toEqual(before);
    expect(await removals(p.db)).toEqual([]);
    expect((await readPairLink(suite.node, p.nodeId))?.peerNodeId).toBe(joinedId);
    expect(p.reloadStream).not.toHaveBeenCalled();
  });

  it("accepts the declarations for a spare that never joined, which needs none", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);

    expect((await remove(p, gone.nodeId, p.adminCookie, DECLARED)).status).toBe(200);
    expect(await removals(p.db)).toHaveLength(1);
  });

  it.each(["source", "destination"] as const)(
    "refuses as handover.operation_in_progress (409) while an open handover names the spare as its %s, writing nothing",
    async (side) => {
      const p = await primary();
      const joinedId = await seedNode(p.db);
      await holdChart(p, [self(p), standby(joinedId)]);
      await linkTo(p, joinedId);
      if (side === "source") await openHandover(p, joinedId, p.nodeId);
      else await openHandover(p, p.nodeId, joinedId);
      const before = await readNodeMembership(p.db);

      const res = await remove(p, joinedId, p.adminCookie, DECLARED);

      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("handover.operation_in_progress");
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await removals(p.db)).toEqual([]);
      expect((await readPairLink(suite.node, p.nodeId))?.peerNodeId).toBe(joinedId);
      expect(p.reloadStream).not.toHaveBeenCalled();
    },
  );

  it("removes the spare while an open handover names two other machines", async () => {
    const p = await primary();
    const joinedId = await seedNode(p.db);
    await holdChart(p, [self(p), standby(joinedId)]);
    await openHandover(p, randomUUID(), randomUUID());

    const res = await remove(p, joinedId, p.adminCookie, DECLARED);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true });
  });

  it("answers an already-removed spare named in an open handover removed:false, and deletes its link", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChart(p, [self(p), gone]);
    await linkTo(p, gone.nodeId);
    await openHandover(p, gone.nodeId, p.nodeId);

    const res = await remove(p, gone.nodeId, p.adminCookie, DECLARED);

    expect(await res.json()).toMatchObject({ removed: false });
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
  });

  it("holds node.db's lock through the chart commit: a node.db write started mid-round waits for it", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    const before = (await heldTerm(p.db))!;
    // Run from outside the removal's async context, as another request's write would be.
    const outside = AsyncLocalStorage.snapshot();
    let waiting: Promise<number | undefined> | undefined;
    pause.beforeChartMint = async () => {
      waiting = outside(() => withNodeTransaction(suite.node, () => heldTerm(p.db)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    expect((await remove(p, gone.nodeId, p.adminCookie, DECLARED)).status).toBe(200);

    expect(await waiting).toBe(before + 1);
  });
});

describe("the stream reload after Remove and Clear", () => {
  it("Remove reloads on every already-removed answer, with no link left to delete", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChart(p, [self(p), gone]);

    for (let call = 1; call <= 2; call += 1) {
      const res = await remove(p, gone.nodeId, p.adminCookie);
      expect(await res.json()).toMatchObject({ removed: false });
      expect(p.reloadStream).toHaveBeenCalledTimes(call);
    }
  });

  it("Clear deletes a pair link a cleared machine left behind, and reloads", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChartRevoking(p, [self(p)], [gone.nodeId]);
    await linkTo(p, gone.nodeId);

    const res = await clear(p, gone.nodeId, p.adminCookie);

    expect(await res.json()).toMatchObject({ cleared: false });
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
  });

  it("Clear deletes the cleared machine's pair link as it clears it", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChart(p, [self(p), gone]);
    await linkTo(p, gone.nodeId);

    expect(await (await clear(p, gone.nodeId, p.adminCookie)).json()).toMatchObject({
      cleared: true,
    });
    expect(await readPairLink(suite.node, p.nodeId)).toBeNull();
    expect(p.reloadStream).toHaveBeenCalledOnce();
  });

  it("Clear reloads on every answer, and leaves a link naming another machine alone", async () => {
    const p = await primary();
    const gone = evicted();
    const linked = standby();
    await holdChart(p, [self(p), gone, linked]);
    await linkTo(p, linked.nodeId);

    expect(await (await clear(p, gone.nodeId, p.adminCookie)).json()).toMatchObject({
      cleared: true,
    });
    expect(p.reloadStream).toHaveBeenCalledTimes(1);
    expect(await (await clear(p, gone.nodeId, p.adminCookie)).json()).toMatchObject({
      cleared: false,
    });
    expect(p.reloadStream).toHaveBeenCalledTimes(2);
    expect((await readPairLink(suite.node, p.nodeId))?.peerNodeId).toBe(linked.nodeId);
  });

  it("a failed reload keeps the 200 answer, and the next Remove reloads again", async () => {
    const p = await primary();
    const gone = standby();
    await holdChart(p, [self(p), gone]);
    p.reloadStream.mockRejectedValueOnce(new AppError("backup.reload_in_progress", {}));

    const first = await remove(p, gone.nodeId, p.adminCookie);
    expect(first.status).toBe(200);
    expect(p.lines).toContainEqual({
      level: "warn",
      event: "membership.stream_reload_failed",
      fields: { nodeId: gone.nodeId, errorCode: "backup.reload_in_progress" },
    });

    const second = await remove(p, gone.nodeId, p.adminCookie);
    expect(second.status).toBe(200);
    expect(p.reloadStream).toHaveBeenCalledTimes(2);
  });

  it("a refused Clear does not reload", async () => {
    const p = await primary();
    const live = standby();
    await holdChart(p, [self(p), live]);

    expect((await clear(p, live.nodeId, p.adminCookie)).status).toBe(409);
    expect(p.reloadStream).not.toHaveBeenCalled();
  });
});

describe("POST /management-api/servers/:nodeId/remove on a cleared machine", () => {
  it("answers removed:false for an id the chart has cleared, without re-signing or a record", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChartRevoking(p, [self(p)], [gone.nodeId]);
    const held = await readNodeMembership(p.db);

    const res = await remove(p, gone.nodeId, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: false, term: held!.body.term });
    expect(await readNodeMembership(p.db)).toEqual(held);
    expect(await removals(p.db)).toEqual([]);
  });
});

describe("POST /management-api/servers/:nodeId/clear", () => {
  it("moves a removed machine from the chart's machines to its revoked list in a new chart this node signs, and records who did it", async () => {
    const p = await primary();
    const gone = evicted();
    const live = standby(randomUUID(), "https://live.deli.test");
    await holdChartRevoking(p, [self(p), gone, live], []);
    const before = (await readNodeMembership(p.db))!;

    const res = await clear(p, gone.nodeId, p.adminCookie);

    expect(res.status).toBe(200);
    const term = before.body.term + 1;
    expect(await res.json()).toEqual({ cleared: true, term });
    const after = (await readNodeMembership(p.db))!;
    expect(after.body).toEqual({ term, nodes: [self(p), live], revoked: [gone.nodeId] });
    expect(after.signerNodeId).toBe(p.nodeId);
    const verdict = verifyMembershipDocument(after, { [p.nodeId]: p.publicKey });
    expect(verdict.valid ? "valid" : verdict.reason).toBe("valid");
    expect(await clearances(p.db)).toEqual([
      { cleared_node_id: gone.nodeId, person_id: p.adminPersonId, term },
    ]);
    expect(await removals(p.db)).toEqual([]);
    expect(p.lines).toEqual([
      {
        level: "info",
        event: "membership.node_cleared",
        fields: { nodeId: gone.nodeId, term, personId: p.adminPersonId },
      },
    ]);
  });

  it("keeps the ids an earlier clearing revoked", async () => {
    const p = await primary();
    const earlier = randomUUID();
    const gone = evicted();
    await holdChartRevoking(p, [self(p), gone], [earlier]);

    expect((await clear(p, gone.nodeId, p.adminCookie)).status).toBe(200);

    expect((await readNodeMembership(p.db))!.body.revoked).toEqual([earlier, gone.nodeId]);
  });

  it("answers an already-cleared machine cleared:false, without re-signing the chart or a second record", async () => {
    const p = await primary();
    const gone = evicted();
    await holdChartRevoking(p, [self(p), gone], []);
    expect((await clear(p, gone.nodeId, p.adminCookie)).status).toBe(200);
    const held = await readNodeMembership(p.db);

    const again = await clear(p, gone.nodeId, p.adminCookie);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ cleared: false, term: held!.body.term });
    expect(await readNodeMembership(p.db)).toEqual(held);
    expect(await clearances(p.db)).toHaveLength(1);
  });

  describe("refusals leave the chart and the record untouched", () => {
    async function expectRefused(
      p: Primary,
      nodeId: string,
      status: number,
      code: string,
    ): Promise<{ code: string; params: unknown }> {
      const before = await readNodeMembership(p.db);
      const res = await clear(p, nodeId, p.adminCookie);
      expect(res.status).toBe(status);
      const error = await errorOf(res);
      expect(error.code).toBe(code);
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await clearances(p.db)).toEqual([]);
      return error;
    }

    it("refuses a live standby as membership.node_not_removed (409)", async () => {
      const p = await primary();
      const live = standby();
      await holdChart(p, [self(p), live]);
      await expectRefused(p, live.nodeId, 409, "membership.node_not_removed");
    });

    it("refuses a former primary (sell-only) as membership.node_not_removed (409)", async () => {
      const p = await primary();
      const former: MembershipNode = {
        nodeId: randomUUID(),
        contactUrl: "https://old.deli.test",
        standing: "sell-only",
      };
      await holdChart(p, [self(p), former]);
      await expectRefused(p, former.nodeId, 409, "membership.node_not_removed");
    });

    it("refuses this node, the serving primary, as membership.node_is_primary (409)", async () => {
      const p = await primary();
      await holdChart(p, [self(p), evicted()]);
      await expectRefused(p, p.nodeId, 409, "membership.node_is_primary");
    });

    it("refuses an id the chart does not list as membership.node_not_found (404)", async () => {
      const p = await primary();
      await holdChart(p, [self(p), evicted()]);
      await expectRefused(p, randomUUID(), 404, "membership.node_not_found");
    });

    it("refuses any id as membership.node_not_found (404) when no chart is held", async () => {
      const p = await primary();
      expect(await readNodeMembership(p.db)).toBeNull();
      await expectRefused(p, randomUUID(), 404, "membership.node_not_found");
    });

    it("refuses on a node that is not the chart's serving primary as membership.not_primary (409), even for a removed machine", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [
        {
          nodeId: randomUUID(),
          contactUrl: "https://elsewhere.deli.test",
          standing: "serving-primary",
        },
        { ...self(p), standing: "serving-secondary" },
        gone,
      ]);
      await expectRefused(p, gone.nodeId, 409, "membership.not_primary");
    });

    it("refuses when the cleared-machine list is full as membership.cleared_list_full (409)", async () => {
      const p = await primary();
      const gone = evicted();
      const full = Array.from({ length: MAX_REVOKED }, () => randomUUID());
      await holdChartRevoking(p, [self(p), gone], full);

      const error = await expectRefused(p, gone.nodeId, 409, "membership.cleared_list_full");

      expect(error.params).toEqual({ count: MAX_REVOKED + 1, limit: MAX_REVOKED });
    });
  });

  describe("who may clear", () => {
    it("refuses a request with no dashboard session as management_session.required (401)", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);

      const res = await clear(p, gone.nodeId);

      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe("management_session.required");
      expect(await readNodeMembership(p.db)).toEqual(before);
    });

    it("refuses a manager (no node.manage) as authorization.not_permitted (403), for a real id and an unknown one alike", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);

      for (const nodeId of [gone.nodeId, randomUUID()]) {
        const res = await clear(p, nodeId, p.managerCookie);
        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("authorization.not_permitted");
      }
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await clearances(p.db)).toEqual([]);
    });
  });

  describe("the term-guarded chart write", () => {
    it("re-reads and re-signs when a newer chart lands between its read and its write, keeping the machine that chart added", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [self(p), gone]);
      const seedTerm = (await heldTerm(p.db))!;
      const added = standby(randomUUID(), "https://added.deli.test");
      await p.db.execute(sql.raw("create table test_newer_landed (done integer)"));
      await p.db.execute(
        sql.raw(
          `create trigger test_membership_newer_lands before update on node_membership
           when not exists (select 1 from test_newer_landed)
           begin
             insert into test_newer_landed values (1);
             update node_membership set term = term + 1,
               document = json_insert(
                 json_set(document, '$.body.term', term + 1),
                 '$.body.nodes[#]',
                 json('${JSON.stringify(added)}')
               ) where id = 1;
             select raise(ignore);
           end`,
        ),
      );
      let res: Response;
      try {
        res = await clear(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_membership_newer_lands"));
        await p.db.execute(sql.raw("drop table test_newer_landed"));
      }

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cleared: true, term: seedTerm + 2 });
      const after = (await readNodeMembership(p.db))!;
      expect(after.body).toEqual({
        term: seedTerm + 2,
        nodes: [self(p), added],
        revoked: [gone.nodeId],
      });
      const verdict = verifyMembershipDocument(after, { [p.nodeId]: p.publicKey });
      expect(verdict.valid ? "valid" : verdict.reason).toBe("valid");
      expect(await clearances(p.db)).toEqual([
        expect.objectContaining({ cleared_node_id: gone.nodeId, term: seedTerm + 2 }),
      ]);
    });

    it("commits the chart and its clearance record together: a refused record leaves the chart unmoved", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [self(p), gone]);
      const before = await readNodeMembership(p.db);
      await p.db.execute(
        sql.raw(
          `create trigger test_clearance_refused before insert on activity_log when new.kind = 'membership.node_cleared'
           begin select raise(abort, 'test: clearance record refused'); end`,
        ),
      );
      let res: Response;
      try {
        res = await clear(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_clearance_refused"));
      }

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "server.internal" } });
      expect(await readNodeMembership(p.db)).toEqual(before);
      expect(await clearances(p.db)).toEqual([]);
      expect(p.lines.map((l) => l.event)).not.toContain("membership.node_cleared");
      expect(errorEvents(p)).toEqual(["membership.clearance_failed"]);
    });

    it("gives up with 503 membership.write_contended when every round loses, recording nothing", async () => {
      const p = await primary();
      const gone = evicted();
      await holdChart(p, [self(p), gone]);
      const seedTerm = await heldTerm(p.db);
      await p.db.execute(
        sql.raw(
          "create trigger test_membership_contended before update on node_membership begin select raise(ignore); end",
        ),
      );
      let res: Response;
      try {
        res = await clear(p, gone.nodeId, p.adminCookie);
      } finally {
        await p.db.execute(sql.raw("drop trigger test_membership_contended"));
      }

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: "membership.write_contended", params: { attempts: 8 } },
      });
      expect(await heldTerm(p.db)).toBe(seedTerm);
      expect(await clearances(p.db)).toEqual([]);
    });
  });
});

describe("GET /management-api/servers", () => {
  it("lists the held chart with removable set by the same rule the removal applies", async () => {
    const p = await primary();
    const neverJoined = standby();
    const joinedId = await seedNode(p.db);
    const joined = standby(joinedId, "https://joined.deli.test");
    const former: MembershipNode = {
      nodeId: randomUUID(),
      contactUrl: "https://old.deli.test",
      standing: "sell-only",
    };
    const evicted: MembershipNode = {
      nodeId: randomUUID(),
      contactUrl: "https://gone.deli.test",
      standing: "evicted",
    };
    await holdChart(p, [self(p), neverJoined, joined, former, evicted]);

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      term: await heldTerm(p.db),
      authorityFingerprint: FINGERPRINT,
      nodes: [
        {
          ...self(p),
          isSelf: true,
          removable: false,
          canClear: false,
          requiresRetirementConfirmation: false,
        },
        {
          ...neverJoined,
          isSelf: false,
          removable: true,
          canClear: false,
          requiresRetirementConfirmation: false,
        },
        {
          ...joined,
          isSelf: false,
          removable: true,
          canClear: false,
          requiresRetirementConfirmation: true,
        },
        {
          ...former,
          isSelf: false,
          removable: false,
          canClear: false,
          requiresRetirementConfirmation: false,
        },
        {
          ...evicted,
          isSelf: false,
          removable: false,
          canClear: true,
          requiresRetirementConfirmation: false,
        },
      ],
    });
  });

  it("asks for the retirement declarations only for a joined spare that is not this node", async () => {
    const p = await primary();
    const joinedFormerId = await seedNode(p.db);
    const joinedEvictedId = await seedNode(p.db);
    await holdChart(p, [
      self(p),
      standby(),
      { nodeId: joinedFormerId, contactUrl: "https://old.deli.test", standing: "sell-only" },
      evicted(joinedEvictedId),
    ]);

    const res = await list(p, p.adminCookie);

    const body = (await res.json()) as {
      nodes: { nodeId: string; requiresRetirementConfirmation: boolean }[];
    };
    expect(body.nodes.map((n) => n.requiresRetirementConfirmation)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("does not ask this node to declare itself retired when it is a joined spare", async () => {
    const p = await primary();
    const other = standby(randomUUID(), "https://elsewhere.deli.test");
    await holdChart(p, [
      { ...other, standing: "serving-primary" },
      { ...self(p), standing: "serving-secondary" },
    ]);

    const body = (await (await list(p, p.adminCookie)).json()) as {
      nodes: { nodeId: string; requiresRetirementConfirmation: boolean }[];
    };
    expect(body.nodes.map((n) => [n.nodeId, n.requiresRetirementConfirmation])).toEqual([
      [other.nodeId, false],
      [p.nodeId, false],
    ]);
  });

  it("marks nothing removable on a node that is not the serving primary", async () => {
    const p = await primary();
    const other: MembershipNode = {
      nodeId: randomUUID(),
      contactUrl: "https://elsewhere.deli.test",
      standing: "serving-primary",
    };
    const neverJoined = standby();
    await holdChart(p, [other, { ...self(p), standing: "serving-secondary" }, neverJoined]);

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: { nodeId: string; removable: boolean }[] };
    expect(body.nodes.map((n) => [n.nodeId, n.removable])).toEqual([
      [other.nodeId, false],
      [p.nodeId, false],
      [neverJoined.nodeId, false],
    ]);
  });

  it("marks canClear only on removed machines, and lists no cleared one", async () => {
    const p = await primary();
    const live = standby();
    const former: MembershipNode = {
      nodeId: randomUUID(),
      contactUrl: "https://old.deli.test",
      standing: "sell-only",
    };
    const gone = evicted();
    const cleared = randomUUID();
    await holdChartRevoking(p, [self(p), live, former, gone], [cleared]);

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: { nodeId: string; canClear: boolean }[] };
    expect(body.nodes.map((n) => [n.nodeId, n.canClear])).toEqual([
      [p.nodeId, false],
      [live.nodeId, false],
      [former.nodeId, false],
      [gone.nodeId, true],
    ]);
  });

  it("marks nothing clearable on a node that is not the serving primary", async () => {
    const p = await primary();
    const other: MembershipNode = {
      nodeId: randomUUID(),
      contactUrl: "https://elsewhere.deli.test",
      standing: "serving-primary",
    };
    const gone = evicted();
    await holdChart(p, [other, { ...self(p), standing: "serving-secondary" }, gone]);

    const res = await list(p, p.adminCookie);

    const body = (await res.json()) as { nodes: { nodeId: string; canClear: boolean }[] };
    expect(body.nodes.map((n) => [n.nodeId, n.canClear])).toEqual([
      [other.nodeId, false],
      [p.nodeId, false],
      [gone.nodeId, false],
    ]);
  });

  it("answers term null and no nodes when no chart is held", async () => {
    const p = await primary();

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ term: null, authorityFingerprint: FINGERPRINT, nodes: [] });
  });

  it("answers this box's authority fingerprint, or null when it serves no authority", async () => {
    const p = await primary(async () => null);
    await holdChart(p, [self(p)]);

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { authorityFingerprint: unknown }).authorityFingerprint,
    ).toBeNull();
  });

  it("refuses no session with 401 and a manager with 403", async () => {
    const p = await primary();
    await holdChart(p, [self(p), standby()]);

    const anonymous = await list(p);
    expect(anonymous.status).toBe(401);
    expect((await errorOf(anonymous)).code).toBe("management_session.required");

    const manager = await list(p, p.managerCookie);
    expect(manager.status).toBe(403);
    expect((await errorOf(manager)).code).toBe("authorization.not_permitted");
  });
});
