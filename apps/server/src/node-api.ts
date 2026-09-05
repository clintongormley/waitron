import type { Hono } from "hono";
import type { NodeStanding, SignedMembershipDocument } from "@waitron/membership";

export interface NodeApiDeps {
  nodeId: string;
  /**
   * Boot-captured (till-reroute design §3.1): `mode === "primary" && singleton_role === "primary" &&
   * !fenced`, read once with the mount guards in boot.ts. Captured, not live, on purpose: a promotion
   * persists its corrected series before the point of no return and takes effect on restart, so a
   * promoted-but-not-restarted process must keep answering false.
   */
  acceptingSales: boolean;
  environment: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
}

export interface NodeProbe {
  nodeId: string;
  term: number | null;
  standing: NodeStanding | null;
  acceptingSales: boolean;
  environment: string;
}

/**
 * `GET /api/node` — the public role probe a till polls every few seconds on EVERY server it knows
 * (till-reroute design §3.1): "who are you, are you accepting sales". No auth, no DB write; the one DB
 * read is the whole-DB membership row. `term`/`standing` are null when no document is held, and
 * `standing` alone is null when a held document does not list this node.
 */
export function mountNodeApi(app: Hono, deps: NodeApiDeps): void {
  app.get("/api/node", async (c) => {
    const held = await deps.readMembership();
    const self = held?.body.nodes.find((n) => n.nodeId === deps.nodeId);
    const body: NodeProbe = {
      nodeId: deps.nodeId,
      term: held?.body.term ?? null,
      standing: self?.standing ?? null,
      acceptingSales: deps.acceptingSales,
      environment: deps.environment,
    };
    c.header("cache-control", "no-store");
    return c.json(body);
  });
}
