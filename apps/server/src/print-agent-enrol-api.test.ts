import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  printAgents,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { signEnvelope, type HandoverKind } from "@waitron/handover";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type NodeStanding,
} from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { authenticateAgent } from "@waitron/printing";
import { hashDeviceToken } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { ENROL_RATE_MAX, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { requireAgent } from "./print-agent-session.js";
import {
  PRINT_AGENT_ENROL_PATH,
  mountPrintAgentEnrolApi,
  type AgentEnrolAnswer,
  type AgentEnrolBody,
} from "./print-agent-enrol-api.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const STRANGER = { nodeId: "33333333-3333-4333-8333-333333333333", ...generateNodeKeyPair() };

describe("POST /api/node/print-agent", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

  interface Boxes {
    db: Database;
    self: string;
    selfKey: string;
    spare: { nodeId: string; privateKey: string };
    app: Hono;
    chart: (term: number, spareStanding: NodeStanding | "revoked") => Promise<void>;
  }

  async function boxes(
    opts: {
      spareStanding?: NodeStanding;
      selfStanding?: NodeStanding;
      isPrimary?: boolean;
      limiter?: EnrolRateLimiter;
    } = {},
  ): Promise<Boxes> {
    const db = suite.db;
    await seedVenue(db, { name: "Main room", invoiceLocales: ["es-ES"] });
    const self = await seedNode(db);
    const spareId = await seedNode(db);
    for (const nodeId of [self, spareId])
      await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const spareKey = await readNodeIdentityKey(suite.node, RING, spareId);
    const chart = async (term: number, spareStanding: NodeStanding | "revoked") => {
      const body: MembershipDocumentBody = {
        term,
        nodes: [
          {
            nodeId: self,
            contactUrl: "https://box-0",
            standing: opts.selfStanding ?? "serving-primary",
          },
          ...(spareStanding === "revoked"
            ? []
            : [{ nodeId: spareId, contactUrl: "https://box-1", standing: spareStanding }]),
        ],
        ...(spareStanding === "revoked" ? { revoked: [spareId] } : {}),
      };
      await writeNodeMembership(db, {
        body,
        signerNodeId: self,
        signature: signDocumentBody(body, selfKey),
        endorsements: [endorseKey(spareId, nodeSigningPublicKey(spareKey), self, selfKey)],
      });
    };
    await chart(3, opts.spareStanding ?? "serving-secondary");
    const app = new Hono();
    mountPrintAgentEnrolApi(
      app,
      {
        db,
        node: suite.node,
        ring: RING,
        nodeId: self,
        isPrimary: opts.isPrimary ?? true,
        ...(opts.limiter === undefined ? {} : { enrolRateLimiter: opts.limiter }),
      },
      () => {},
    );
    return { db, self, selfKey, spare: { nodeId: spareId, privateKey: spareKey }, app, chart };
  }

  function envelope(
    signer: { nodeId: string; privateKey: string },
    body: Record<string, unknown>,
    kind: HandoverKind = "agent-enrol",
  ) {
    return signEnvelope(kind, body as CanonicalValue, signer);
  }

  async function send(app: Hono, raw: unknown): Promise<{ status: number; body: unknown }> {
    const response = await app.request(PRINT_AGENT_ENROL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof raw === "string" ? raw : JSON.stringify(raw),
    });
    return { status: response.status, body: await response.json() };
  }

  function refusal(status: number, code: string, params: object = {}) {
    return { status, body: { error: { code, params } } };
  }

  async function agentRows(db: Database) {
    return db
      .select({ id: printAgents.id, nodeId: printAgents.nodeId, name: printAgents.name })
      .from(printAgents);
  }

  it("gives a box the chart lists a token that authenticates as an agent under its node id", async () => {
    const { app, self, spare, db } = await boxes();
    const request: AgentEnrolBody = { name: "Spare agent", toNodeId: self };
    const { status, body } = await send(app, envelope(spare, { ...request }));
    expect(status).toBe(201);
    const { token } = body as AgentEnrolAnswer;
    const { agentId } = await authenticateAgent(db, token);
    expect(await agentRows(db)).toEqual([
      { id: agentId, nodeId: spare.nodeId, name: "Spare agent" },
    ]);
  });

  it("reuses the signer's row on a second request, and only the new token works", async () => {
    const { app, self, spare, db } = await boxes();
    const first = (await send(app, envelope(spare, { name: "Spare agent", toNodeId: self })))
      .body as AgentEnrolAnswer;
    const second = await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }));
    expect(second.status).toBe(201);
    const { token } = second.body as AgentEnrolAnswer;
    const { agentId } = await authenticateAgent(db, token);
    expect((await agentRows(db)).map((row) => row.id)).toEqual([agentId]);
    await expect(authenticateAgent(db, first.token)).rejects.toMatchObject({
      code: "agent.unauthorized",
    });
  });

  it("refuses a signer whose agent row was deleted", async () => {
    const { app, self, spare, db } = await boxes();
    await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }));
    await db.update(printAgents).set({ active: false }).where(eq(printAgents.nodeId, spare.nodeId));
    expect(await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }))).toEqual(
      refusal(403, "device.join_revoked"),
    );
  });

  it("refuses an unsigned or malformed request", async () => {
    const { app, self, db } = await boxes();
    expect(await send(app, { name: "Spare agent", toNodeId: self })).toEqual(
      refusal(400, "handover.request_invalid", { field: "envelope" }),
    );
    expect(await send(app, "not json")).toEqual(
      refusal(400, "handover.request_invalid", { field: "envelope" }),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses an envelope signed for another purpose", async () => {
    const { app, self, spare, db } = await boxes();
    expect(
      await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }, "backup-settings")),
    ).toEqual(refusal(400, "handover.request_invalid", { field: "envelope" }));
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a signer the chart does not list", async () => {
    const { app, self, db } = await boxes();
    expect(await send(app, envelope(STRANGER, { name: "Stranger", toNodeId: self }))).toEqual(
      refusal(401, "handover.peer_unknown"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a signer the chart has removed", async () => {
    const { app, self, spare, db } = await boxes({ spareStanding: "evicted" });
    expect(await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }))).toEqual(
      refusal(401, "handover.peer_unknown"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a request addressed to another box", async () => {
    const { app, spare, db } = await boxes();
    expect(
      await send(app, envelope(spare, { name: "Spare agent", toNodeId: STRANGER.nodeId })),
    ).toEqual(refusal(400, "handover.request_invalid", { field: "toNodeId" }));
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a body with a missing name or an extra field", async () => {
    const { app, self, spare } = await boxes();
    expect(await send(app, envelope(spare, { toNodeId: self }))).toEqual(
      refusal(400, "handover.request_invalid", { field: "body" }),
    );
    expect(await send(app, envelope(spare, { name: 7, toNodeId: self }))).toEqual(
      refusal(400, "handover.request_invalid", { field: "name" }),
    );
    expect(
      await send(app, envelope(spare, { name: "Spare agent", toNodeId: self, extra: true })),
    ).toEqual(refusal(400, "handover.request_invalid", { field: "body" }));
  });

  it("refuses on a box that is not the main box", async () => {
    const { app, self, spare, db } = await boxes({ isPrimary: false });
    expect(await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }))).toEqual(
      refusal(409, "node.enrol_unavailable"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses on a box its held chart does not name the serving main box", async () => {
    const { app, self, spare, db } = await boxes({
      selfStanding: "serving-secondary",
      spareStanding: "serving-primary",
    });
    expect(await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }))).toEqual(
      refusal(409, "node.enrol_unavailable"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a request signed by this box itself", async () => {
    const { app, self, selfKey, db } = await boxes();
    expect(
      await send(
        app,
        envelope({ nodeId: self, privateKey: selfKey }, { name: "Main agent", toNodeId: self }),
      ),
    ).toEqual(refusal(401, "handover.peer_unknown"));
    expect(await agentRows(db)).toEqual([]);
  });

  it("refuses a listed box's envelope whose body was changed after signing", async () => {
    const { app, self, spare, db } = await boxes();
    const signed = envelope(spare, { name: "Spare agent", toNodeId: self });
    expect(await send(app, { ...signed, body: { name: "Other agent", toNodeId: self } })).toEqual(
      refusal(401, "handover.peer_unknown"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("counts only signed requests against the enrol rate limit", async () => {
    const { app, self, spare, db } = await boxes();
    for (let i = 0; i < ENROL_RATE_MAX + 1; i += 1) {
      expect((await send(app, envelope(STRANGER, { name: "x", toNodeId: self }))).status).toBe(401);
      expect((await send(app, "not json")).status).toBe(400);
    }
    expect((await send(app, envelope(spare, { name: "Spare agent", toNodeId: self }))).status).toBe(
      201,
    );
    expect(await agentRows(db)).toHaveLength(1);
  });

  it("checks the enrol rate limit once the signature is verified, before the body", async () => {
    const { app, self, spare, db } = await boxes({
      limiter: {
        check: () => {
          throw new AppError("device.join_rate_limited", {});
        },
      },
    });
    expect(await send(app, "not json")).toEqual(
      refusal(400, "handover.request_invalid", { field: "envelope" }),
    );
    expect(await send(app, envelope(spare, { toNodeId: self }))).toEqual(
      refusal(429, "device.join_rate_limited"),
    );
    expect(await agentRows(db)).toEqual([]);
  });

  it("logs an unexpected failure under this route's own name", async () => {
    const lines: [string, string][] = [];
    const failing = new Proxy({} as Database, {
      get() {
        throw new Error("boom");
      },
    });
    const app = new Hono();
    mountPrintAgentEnrolApi(
      app,
      { db: failing, node: suite.node, ring: RING, nodeId: STRANGER.nodeId, isPrimary: true },
      (level, event) => lines.push([level, event]),
    );
    expect(await send(app, envelope(STRANGER, { name: "x", toNodeId: STRANGER.nodeId }))).toEqual({
      status: 500,
      body: { error: { code: "server.internal" } },
    });
    expect(lines).toEqual([["error", "print-agent-enrol.failed"]]);
  });

  describe("a print agent's token once its box is removed", () => {
    /** One route behind the print-agent API's bearer guard. */
    function agentApp(db: Database): Hono {
      const app = new Hono();
      app.get("/agent", async (c) => {
        try {
          return c.json(await requireAgent({ db }, c));
        } catch (error) {
          return c.json({ code: (error as AppError).code }, 401);
        }
      });
      return app;
    }

    async function asAgent(db: Database, token: string) {
      const response = await agentApp(db).request("/agent", {
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: response.status, body: await response.json() };
    }

    async function spareToken(app: Hono, self: string, spare: Boxes["spare"]): Promise<string> {
      const { status, body } = await send(
        app,
        envelope(spare, { name: "Spare agent", toNodeId: self }),
      );
      expect(status).toBe(201);
      return (body as AgentEnrolAnswer).token;
    }

    it.each(["evicted", "revoked"] as const)(
      "is refused once a newer chart marks the box %s",
      async (removal) => {
        const { app, self, spare, db, chart } = await boxes();
        const token = await spareToken(app, self, spare);
        expect((await asAgent(db, token)).status).toBe(200);
        await chart(4, removal);
        expect(await asAgent(db, token)).toEqual({
          status: 401,
          body: { code: "agent.unauthorized" },
        });
      },
    );

    it("leaves the main box's own agent and an agent tied to no box working", async () => {
      const { self, db, chart } = await boxes();
      const own = await withTransaction(db, (tx) =>
        selfEnrolNodeAgent(tx, { nodeId: self, name: "Main agent" }),
      );
      const secret = "unboxed-secret";
      const [unboxed] = await db
        .insert(printAgents)
        .values({ name: "Office agent", tokenHash: hashDeviceToken(secret) })
        .returning({ id: printAgents.id });
      await chart(4, "evicted");
      expect(await asAgent(db, own.token)).toEqual({
        status: 200,
        body: { agentId: own.agentId },
      });
      expect(await asAgent(db, `${unboxed!.id}.${secret}`)).toEqual({
        status: 200,
        body: { agentId: unboxed!.id },
      });
    });

    it("lets the box's agent enrol again once a newer chart lists the box again", async () => {
      const { app, self, spare, db, chart } = await boxes();
      const old = await spareToken(app, self, spare);
      await chart(4, "evicted");
      await chart(5, "serving-secondary");
      const fresh = await spareToken(app, self, spare);
      expect((await asAgent(db, fresh)).status).toBe(200);
      expect((await asAgent(db, old)).status).toBe(401);
    });
  });
});
