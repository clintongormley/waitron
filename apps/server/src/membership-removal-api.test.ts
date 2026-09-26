import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  readMembershipTrustSet,
  readNodeMembership,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import {
  routableServers,
  verifyMembershipDocument,
  type MembershipNode,
} from "@waitron/membership";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import { establishNodeIdentity } from "./node-identity.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const BOX_URL = "https://box.deli.test";
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
  app: Hono;
}

/** A provisioned venue whose node holds its sealed identity key, and an admin's dashboard session. */
async function primary(): Promise<Primary> {
  const db = suite.db;
  const venue = await setupVenue(db);
  const nodeId = venue.cfg.nodeId;
  await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
  const publicKey = (await readMembershipTrustSet(db))[nodeId]!;
  const { adminPersonId, token } = await withTransaction(db, async (tx) => {
    const rows = tx.all<{ id: string }>(sql`select id from persons where role = 'admin'`);
    const personId = rows[0]!.id;
    const session = await startManagementSession(tx, { personId });
    return { adminPersonId: personId, token: session.token };
  });
  const lines: Primary["lines"] = [];
  const log: Logger = (level, event, fields) => lines.push({ level, event, fields });
  const app = new Hono();
  mountMembershipRemovalApi(app, { db, ring: RING, nodeId }, log);
  return {
    db,
    nodeId,
    locationId: venue.cfg.locationId,
    publicKey,
    adminPersonId,
    adminCookie: `${MANAGEMENT_COOKIE}=${token}`,
    managerCookie: venue.managerCookie,
    lines,
    app,
  };
}

/** The next chart, minted and signed by this node the way the product mints one. */
async function holdChart(p: Primary, nodes: readonly MembershipNode[]): Promise<void> {
  const held = await readNodeMembership(p.db);
  const document = await mintNextMembershipDocument(
    { db: p.db, ring: RING },
    { heldDocument: held, nodes, signerNodeId: p.nodeId },
  );
  await writeNodeMembership(p.db, document);
}

function self(p: Primary): MembershipNode {
  return { nodeId: p.nodeId, contactUrl: BOX_URL, standing: "serving-primary" };
}

function standby(nodeId: string = randomUUID(), contactUrl = CLOUD_URL): MembershipNode {
  return { nodeId, contactUrl, standing: "serving-secondary" };
}

async function remove(p: Primary, nodeId: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers["cookie"] = cookie;
  return p.app.request(`/management-api/servers/${nodeId}/remove`, { method: "POST", headers });
}

async function list(p: Primary, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers["cookie"] = cookie;
  return p.app.request("/management-api/servers", { method: "GET", headers });
}

async function errorOf(res: Response): Promise<{ code: string; params: unknown }> {
  return ((await res.json()) as { error: { code: string; params: unknown } }).error;
}

async function removals(db: Database): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`select removed_node_id, contact_url, person_id, term from membership_removals`,
  );
  return rows;
}

async function heldTerm(db: Database): Promise<number | undefined> {
  return (await readNodeMembership(db))?.body.term;
}

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
      const joinedId = await seedNode(p.db, brandLocationId(p.locationId));
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

    it("refuses a manager (no mirror.create) as authorization.not_permitted (403), for a real id and an unknown one alike", async () => {
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
             insert into nodes (id, location_id, name, created_at)
               select '${late.nodeId}', location_id, 'Joined late', created_at
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
          `create trigger test_removal_refused before insert on membership_removals
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

describe("GET /management-api/servers", () => {
  it("lists the held chart with removable set by the same rule the removal applies", async () => {
    const p = await primary();
    const neverJoined = standby();
    const joinedId = await seedNode(p.db, brandLocationId(p.locationId));
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
      nodes: [
        { ...self(p), isSelf: true, removable: false },
        { ...neverJoined, isSelf: false, removable: true },
        { ...joined, isSelf: false, removable: false },
        { ...former, isSelf: false, removable: false },
        { ...evicted, isSelf: false, removable: false },
      ],
    });
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

  it("answers term null and no nodes when no chart is held", async () => {
    const p = await primary();

    const res = await list(p, p.adminCookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ term: null, nodes: [] });
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
