import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  handoverActivations,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { appendHandoverEventTx, beginHandoverOperationTx } from "@waitron/node-db";
import { startManagementSession } from "@waitron/identity";
import type { MembershipNode } from "@waitron/membership";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import { recordReturnBatchTx } from "./return-completion.js";
import { returnDigest } from "./return-records.js";
import { readResetOrderFor } from "./reset-order.js";
import { establishNodeIdentity } from "./node-identity.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Primary {
  db: Database;
  nodeId: string;
  adminPersonId: string;
  adminCookie: string;
  managerCookie: string;
  lines: { level: string; event: string }[];
  app: Hono;
}

async function primary(): Promise<Primary> {
  const db = suite.db;
  const venue = await setupVenue(db);
  const nodeId = venue.cfg.nodeId;
  await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  const { adminPersonId, token } = await withTransaction(db, async (tx) => {
    const rows = tx.all<{ id: string }>(
      sql`select id from persons where email = 'owner@example.test'`,
    );
    const personId = rows[0]!.id;
    const session = await startManagementSession(tx, { method: "password", personId });
    await setFreshManagementSignIn(tx, session.token);
    return { adminPersonId: personId, token: session.token };
  });
  const lines: Primary["lines"] = [];
  const log: Logger = (level, event) => lines.push({ level, event });
  const app = new Hono();
  mountMembershipRemovalApi(
    app,
    { db, node: suite.node, ring: RING, nodeId, reloadStream: vi.fn(async () => {}) },
    log,
  );
  return {
    db,
    nodeId,
    adminPersonId,
    adminCookie: `${MANAGEMENT_COOKIE}=${token}`,
    managerCookie: venue.managerCookie,
    lines,
    app,
  };
}

async function holdChart(p: Primary, nodes: readonly MembershipNode[]): Promise<void> {
  const held = await readNodeMembership(p.db);
  const document = await mintNextMembershipDocument(
    { db: p.db, node: suite.node, ring: RING },
    { heldDocument: held, nodes, signerNodeId: p.nodeId, verifyHeld: "none" },
  );
  await writeNodeMembership(p.db, document);
}

function self(p: Primary): MembershipNode {
  return { nodeId: p.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" };
}

function former(nodeId: string): MembershipNode {
  return { nodeId, contactUrl: "https://old.deli.test", standing: "sell-only" };
}

/**
 * A replaced old main box, listed `sell-only` in the chart this box holds, whose key this box
 * pinned when it joined.
 */
async function withFormer(p: Primary): Promise<string> {
  const oldMain = await seedNode(p.db);
  await holdChart(p, [self(p), former(oldMain)]);
  await pinMainBoxKey(suite.node, p.nodeId, { nodeId: oldMain, publicKey: "old-main" });
  return oldMain;
}

async function takeover(
  p: Primary,
  sourceNodeId: string,
  state: "activated" | "return_pending" | "copy_accepted" = "activated",
): Promise<string> {
  const operationId = randomUUID();
  await withNodeTransaction(suite.node, (tx) =>
    beginHandoverOperationTx(tx, {
      nodeId: p.nodeId,
      operationId,
      role: "destination",
      scenario: state === "copy_accepted" ? "controlled" : "emergency",
      sourceNodeId,
      destinationNodeId: p.nodeId,
      binding: {},
      fingerprint: "f",
      state,
      waitingReason: null,
    }),
  );
  return operationId;
}

/** A completed return from `sourceNodeId` to this box, against a closed takeover. */
async function completedReturn(p: Primary, sourceNodeId: string): Promise<string> {
  const operationId = randomUUID();
  const digests = ["first", "second"].map((payload) => returnDigest({ module: "m", payload }));
  const inventory = returnDigest(digests);
  await withTransaction(p.db, async (tx) => {
    await tx.insert(handoverActivations).values({
      operationId,
      sourceNodeId,
      destinationNodeId: p.nodeId,
      scenario: "emergency",
      evidence: {
        purpose: "waitron.handover.declaration.v1",
        body: {},
        signerNodeId: p.nodeId,
        signature: "signature",
      },
      personId: "person",
      activatedAt: "2026-11-12T10:00:00.000Z",
    });
    for (const [index, digest] of digests.entries()) {
      await recordReturnBatchTx(tx, { operationId, inventory, index, count: 2, digest });
    }
  });
  return operationId;
}

async function order(
  p: Primary,
  nodeId: string,
  body: unknown,
  cookie: string | null = p.adminCookie,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== null) headers["cookie"] = cookie;
  return p.app.request(`/management-api/servers/${nodeId}/reset`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function orderWithLoss(p: Primary, nodeId: string): Promise<Response> {
  return order(p, nodeId, { acceptLoss: true });
}

async function errorOf(res: Response): Promise<{ code: string; params: unknown }> {
  return ((await res.json()) as { error: { code: string; params: unknown } }).error;
}

async function activities(db: Database, kind: string) {
  const { rows } = await db.execute<{
    id: string;
    subject_id: string;
    person_id: string;
    data: string;
  }>(
    sql`select id, subject_id, person_id, data from activity_log where kind = ${kind} order by at, rowid`,
  );
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as unknown }));
}

function resetEvents(p: Primary) {
  return suite.node
    .all<{ operation_id: string; detail: string }>(
      sql`select operation_id, detail from node_handover_events where node_id = ${p.nodeId} and kind = 'reset_ordered' order by rowid`,
    )
    .map((r) => ({ operationId: r.operation_id, detail: JSON.parse(r.detail) as unknown }));
}

function operationState(p: Primary, operationId: string): string | undefined {
  return suite.node.all<{ state: string }>(
    sql`select state from node_handover_operations where node_id = ${p.nodeId} and operation_id = ${operationId}`,
  )[0]?.state;
}

async function expectNothingWritten(p: Primary): Promise<void> {
  expect(await activities(p.db, "handover.reset_ordered")).toEqual([]);
  expect(await activities(p.db, "handover.return_abandoned")).toEqual([]);
  expect(resetEvents(p)).toEqual([]);
}

const orderIdOf = (operationId: string, acceptLoss: boolean) =>
  returnDigest({ kind: "handover.reset_order", operationId, acceptLoss });

describe("POST /management-api/servers/:nodeId/reset", () => {
  describe("refusals write nothing", () => {
    it("refuses no session (401), a manager (403) and a stale sign-in (400)", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      await takeover(p, oldMain);

      const anonymous = await order(p, oldMain, { acceptLoss: true }, null);
      expect(anonymous.status).toBe(401);
      expect((await errorOf(anonymous)).code).toBe("management_session.required");

      const manager = await order(p, oldMain, { acceptLoss: true }, p.managerCookie);
      expect(manager.status).toBe(403);
      expect((await errorOf(manager)).code).toBe("authorization.not_permitted");

      await withTransaction(p.db, (tx) => setFreshManagementSignIn(tx, p.adminCookie, false));
      const stale = await order(p, oldMain, { acceptLoss: true });
      expect(stale.status).toBe(400);
      expect((await errorOf(stale)).code).toBe("management_session.proof_required");

      await expectNothingWritten(p);
    });

    it.each([
      ["no body field", {}],
      ['"true"', { acceptLoss: "true" }],
      ["null", { acceptLoss: null }],
    ])("refuses a malformed body (%s) as management.request_invalid (400)", async (_, body) => {
      const p = await primary();
      const oldMain = await withFormer(p);
      await takeover(p, oldMain);

      const res = await order(p, oldMain, body);

      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({
        code: "management.request_invalid",
        params: { field: "acceptLoss" },
      });
      await expectNothingWritten(p);
    });

    it("orders a loss reset through the route: 200 with acceptLoss: true, and the awaiting takeover reads return_abandoned", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain);

      const res = await order(p, oldMain, { acceptLoss: true });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ orderId: orderIdOf(operationId, true), acceptLoss: true });
      expect(operationState(p, operationId)).toBe("return_abandoned");
    });

    it("refuses on a box that is not the chart's serving primary as membership.not_primary (409)", async () => {
      const p = await primary();
      const oldMain = await seedNode(p.db);
      const otherMain = await seedNode(p.db);
      await holdChart(p, [
        { ...self(p), standing: "serving-secondary" },
        { nodeId: otherMain, contactUrl: "https://main.deli.test", standing: "serving-primary" },
        former(oldMain),
      ]);
      await takeover(p, oldMain);

      const res = await orderWithLoss(p, oldMain);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({ code: "membership.not_primary", params: {} });
      await expectNothingWritten(p);
    });

    it("refuses a former main box no takeover here or activation replaced as membership.node_not_replaced (409)", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);

      const res = await orderWithLoss(p, oldMain);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({ code: "membership.node_not_replaced", params: {} });
      await expectNothingWritten(p);
    });

    it("refuses a box the chart does not list as membership.node_not_found (404)", async () => {
      const p = await primary();
      await withFormer(p);

      const res = await orderWithLoss(p, randomUUID());

      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("membership.node_not_found");
      await expectNothingWritten(p);
    });

    it.each(["serving-secondary", "evicted", "serving-primary"] as const)(
      "refuses a box standing %s as membership.node_not_replaced (409)",
      async (standing) => {
        const p = await primary();
        const target = standing === "serving-primary" ? p.nodeId : await seedNode(p.db);
        await holdChart(
          p,
          standing === "serving-primary"
            ? [self(p)]
            : [self(p), { nodeId: target, contactUrl: "https://spare.deli.test", standing }],
        );

        const res = await orderWithLoss(p, target);

        expect(res.status).toBe(409);
        expect(await errorOf(res)).toEqual({
          code: "membership.node_not_replaced",
          params: {},
        });
        await expectNothingWritten(p);
      },
    );

    it("refuses an order without loss when no return is complete as handover.reset_loss_unaccepted (409)", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain);

      const res = await order(p, oldMain, { acceptLoss: false });

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({
        code: "handover.reset_loss_unaccepted",
        params: {},
      });
      expect(operationState(p, operationId)).toBe("activated");
      await expectNothingWritten(p);
    });

    it("refuses an open handover naming the box that is not waiting for its return as handover.operation_in_progress (409)", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      await completedReturn(p, oldMain);
      const operationId = await takeover(p, oldMain, "copy_accepted");

      const res = await orderWithLoss(p, oldMain);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({
        code: "handover.operation_in_progress",
        params: { operationId },
      });
      expect(operationState(p, operationId)).toBe("copy_accepted");
      await expectNothingWritten(p);
    });
  });

  it.each(["activated", "return_pending"] as const)(
    "a loss order on a takeover in %s waiting for this box's return closes it as return_abandoned, and the box is then removable",
    async (state) => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain, state);
      const orderId = orderIdOf(operationId, true);

      const res = await orderWithLoss(p, oldMain);

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect(await res.json()).toEqual({ orderId, acceptLoss: true });
      expect(operationState(p, operationId)).toBe("return_abandoned");
      expect(await activities(p.db, "handover.reset_ordered")).toEqual([
        {
          id: returnDigest({ kind: "handover.reset_ordered", orderId }),
          subject_id: oldMain,
          person_id: p.adminPersonId,
          data: { orderId, operationId, acceptLoss: true },
        },
      ]);
      expect(await activities(p.db, "handover.return_abandoned")).toEqual([
        {
          id: returnDigest({ kind: "handover.return_abandoned", orderId }),
          subject_id: oldMain,
          person_id: p.adminPersonId,
          data: { operationId, sourceNodeId: oldMain },
        },
      ]);
      expect(resetEvents(p)).toEqual([
        {
          operationId,
          detail: { targetNodeId: oldMain, orderId, acceptLoss: true, personId: p.adminPersonId },
        },
      ]);
      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toEqual({
        orderId,
        acceptLoss: true,
      });

      const removed = await p.app.request(`/management-api/servers/${oldMain}/remove`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: p.adminCookie },
        body: JSON.stringify({ resetStatement: true }),
      });
      expect(removed.status, JSON.stringify(await removed.clone().json())).toBe(200);
    },
  );

  it("an order without loss after a completed return names the latest activation and closes nothing", async () => {
    const p = await primary();
    const oldMain = await withFormer(p);
    const operationId = await completedReturn(p, oldMain);
    const orderId = orderIdOf(operationId, false);

    const res = await order(p, oldMain, { acceptLoss: false });

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await res.json()).toEqual({ orderId, acceptLoss: false });
    expect(await activities(p.db, "handover.return_abandoned")).toEqual([]);
    expect((await activities(p.db, "handover.reset_ordered")).map((a) => a.data)).toEqual([
      { orderId, operationId, acceptLoss: false },
    ]);
    expect(resetEvents(p)).toEqual([
      {
        operationId,
        detail: { targetNodeId: oldMain, orderId, acceptLoss: false, personId: p.adminPersonId },
      },
    ]);
  });

  describe("the two commits", () => {
    it("a failure after the venue.db commit leaves the operation as it was, and a retry adds no second entry or event", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain);
      const orderId = orderIdOf(operationId, true);
      suite.node.run(
        sql`create trigger refuse_return_abandoned before update on node_handover_operations when new.state = 'return_abandoned' begin select raise(abort, 'test node write failed'); end`,
      );
      try {
        const failed = await orderWithLoss(p, oldMain);
        expect(failed.status).toBe(500);
        expect(p.lines.filter((l) => l.level === "error").map((l) => l.event)).toEqual([
          "handover.reset_order_failed",
        ]);
        expect(operationState(p, operationId)).toBe("activated");
        expect(await activities(p.db, "handover.reset_ordered")).toHaveLength(1);
        expect(await activities(p.db, "handover.return_abandoned")).toHaveLength(1);
        expect(resetEvents(p)).toEqual([]);
      } finally {
        suite.node.run(sql`drop trigger refuse_return_abandoned`);
      }

      const retried = await orderWithLoss(p, oldMain);

      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual({ orderId, acceptLoss: true });
      expect(operationState(p, operationId)).toBe("return_abandoned");
      expect(await activities(p.db, "handover.reset_ordered")).toHaveLength(1);
      expect(await activities(p.db, "handover.return_abandoned")).toHaveLength(1);
      expect(resetEvents(p)).toHaveLength(1);
    });

    it("pressing again returns the existing order and writes nothing more", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain);
      const orderId = orderIdOf(operationId, true);
      expect((await orderWithLoss(p, oldMain)).status).toBe(200);

      const again = await orderWithLoss(p, oldMain);

      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ orderId, acceptLoss: true });
      expect(await activities(p.db, "handover.reset_ordered")).toHaveLength(1);
      expect(resetEvents(p)).toHaveLength(1);
    });
  });

  describe("which order stands", () => {
    it("a loss order replaces one without, and a later press without loss returns the loss order", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await completedReturn(p, oldMain);
      expect((await order(p, oldMain, { acceptLoss: false })).status).toBe(200);

      const loss = await orderWithLoss(p, oldMain);
      expect(loss.status).toBe(200);
      const lossOrder = { orderId: orderIdOf(operationId, true), acceptLoss: true };
      expect(await loss.json()).toEqual(lossOrder);
      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toEqual(lossOrder);

      const noLoss = await order(p, oldMain, { acceptLoss: false });
      expect(noLoss.status).toBe(200);
      expect(await noLoss.json()).toEqual(lossOrder);
      expect(resetEvents(p)).toHaveLength(2);
      expect(await activities(p.db, "handover.reset_ordered")).toHaveLength(2);
    });

    it("a press without loss after a loss order returns the loss order, though no return is complete", async () => {
      const p = await primary();
      const oldMain = await withFormer(p);
      const operationId = await takeover(p, oldMain);
      expect((await orderWithLoss(p, oldMain)).status).toBe(200);

      const res = await order(p, oldMain, { acceptLoss: false });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ orderId: orderIdOf(operationId, true), acceptLoss: true });
      expect(resetEvents(p)).toHaveLength(1);
    });

    it("the peer-side reader picks the loss order from the two rows, the first without loss otherwise, reads only orders for that box and skips a malformed row", async () => {
      const p = await primary();
      const oldMain = randomUUID();
      const other = randomUUID();
      const operationId = randomUUID();
      const append = (targetNodeId: string, orderId: string, acceptLoss: boolean) =>
        withNodeTransaction(suite.node, (tx) =>
          appendHandoverEventTx(tx, {
            nodeId: p.nodeId,
            operationId,
            kind: "reset_ordered",
            detail: { targetNodeId, orderId, acceptLoss },
            envelope: null,
          }),
        );

      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toBeNull();
      await withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: p.nodeId,
          operationId,
          kind: "reset_ordered",
          detail: { targetNodeId: oldMain, orderId: 7, acceptLoss: "yes" },
          envelope: null,
        }),
      );
      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toBeNull();
      await append(oldMain, "first-without", false);
      await append(other, "other-loss", true);
      await append(oldMain, "second-without", false);
      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toEqual({
        orderId: "first-without",
        acceptLoss: false,
      });
      await append(oldMain, "loss", true);
      expect(await readResetOrderFor(suite.node, p.nodeId, oldMain)).toEqual({
        orderId: "loss",
        acceptLoss: true,
      });
    });
  });
});
