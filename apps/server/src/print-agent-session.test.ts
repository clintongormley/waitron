import { randomUUID } from "node:crypto";
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
import type { MembershipDocumentBody, NodeStanding } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { hashDeviceToken } from "@waitron/identity";
import type { AppError } from "@waitron/shared";
import { selfEnrolNodeAgent } from "./join-requests.js";
import { requireAgent } from "./print-agent-session.js";

describe("requireAgent", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

  const MAIN = randomUUID();
  const SPARE = randomUUID();

  /** `readNodeMembership` does not check the signature, so the chart is written unsigned. */
  async function chart(term: number, spareStanding: NodeStanding | "revoked"): Promise<void> {
    const body: MembershipDocumentBody = {
      term,
      nodes: [
        { nodeId: MAIN, contactUrl: "https://box-0", standing: "serving-primary" },
        ...(spareStanding === "revoked"
          ? []
          : [{ nodeId: SPARE, contactUrl: "https://box-1", standing: spareStanding }]),
      ],
      ...(spareStanding === "revoked" ? { revoked: [SPARE] } : {}),
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: MAIN,
      signature: "placeholder",
      endorsements: [],
    });
  }

  /** The token the main box's print-agent route gives the box `nodeId`'s agent. */
  async function boxToken(nodeId: string): Promise<{ agentId: string; token: string }> {
    return withTransaction(suite.db, (tx) =>
      selfEnrolNodeAgent(tx, { nodeId, name: `Agent on ${nodeId}` }),
    );
  }

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

  describe("a print agent's token once its box is removed", () => {
    it.each(["evicted", "revoked"] as const)(
      "is refused once a newer chart marks the box %s",
      async (removal) => {
        await chart(3, "serving-secondary");
        const { token } = await boxToken(SPARE);
        expect((await asAgent(suite.db, token)).status).toBe(200);
        await chart(4, removal);
        expect(await asAgent(suite.db, token)).toEqual({
          status: 401,
          body: { code: "agent.unauthorized" },
        });
      },
    );

    it("is refused before its sighting is written, so it does not look recently seen", async () => {
      await chart(3, "evicted");
      const { agentId, token } = await boxToken(SPARE);
      expect((await asAgent(suite.db, token)).status).toBe(401);
      const [row] = await suite.db
        .select({ lastSeenAt: printAgents.lastSeenAt })
        .from(printAgents)
        .where(eq(printAgents.id, agentId));
      expect(row).toEqual({ lastSeenAt: null });
    });

    it("leaves the main box's own agent and an agent tied to no box working", async () => {
      await chart(3, "serving-secondary");
      const own = await boxToken(MAIN);
      const secret = "unboxed-secret";
      const [unboxed] = await suite.db
        .insert(printAgents)
        .values({ name: "Office agent", tokenHash: hashDeviceToken(secret) })
        .returning({ id: printAgents.id });
      await chart(4, "evicted");
      expect(await asAgent(suite.db, own.token)).toEqual({
        status: 200,
        body: { agentId: own.agentId },
      });
      expect(await asAgent(suite.db, `${unboxed!.id}.${secret}`)).toEqual({
        status: 200,
        body: { agentId: unboxed!.id },
      });
    });

    it("lets the box's agent enrol again once a newer chart lists the box again", async () => {
      await chart(3, "serving-secondary");
      const old = await boxToken(SPARE);
      await chart(4, "evicted");
      await chart(5, "serving-secondary");
      const fresh = await boxToken(SPARE);
      expect((await asAgent(suite.db, fresh.token)).status).toBe(200);
      expect((await asAgent(suite.db, old.token)).status).toBe(401);
    });
  });
});
