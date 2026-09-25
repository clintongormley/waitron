import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { standingOf, type NodeStanding, type SignedMembershipDocument } from "@waitron/membership";
import type { DeploymentEnvironment } from "./config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

export interface NodeApiDeps {
  nodeId: string;
  /**
   * Captured at boot, not live, on purpose: a promotion takes effect on restart, so a
   * promoted-but-not-restarted process must keep answering false.
   */
  acceptingSales: boolean;
  /** Echoed so a till can refuse to follow a server in a different environment from the one it was
   * provisioned into. */
  environment: DeploymentEnvironment;
  /** The held membership document, or `null` when this node holds none. */
  readMembership: () => Promise<SignedMembershipDocument | null>;
}

interface NodeProbe {
  nodeId: string;
  term: number | null;
  standing: NodeStanding | null;
  acceptingSales: boolean;
  environment: DeploymentEnvironment;
}

/** Empty: the probe takes no input, so it answers no client-fault code. */
const STATUS: Record<string, ContentfulStatusCode> = {};

/**
 * `GET /api/node` — the public, unauthenticated role probe a till polls on every server it knows:
 * "who are you, are you accepting sales". `term`/`standing` are null when no document is held, and
 * `standing` alone is null when a held document does not list this node.
 */
export function mountNodeApi(app: Hono, deps: NodeApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "node.failed");

  app.get("/api/node", (c) =>
    run(c, log, async () => {
      const held = await deps.readMembership();
      const body: NodeProbe = {
        nodeId: deps.nodeId,
        term: held?.body.term ?? null,
        standing: held === null ? null : (standingOf(held, deps.nodeId) ?? null),
        acceptingSales: deps.acceptingSales,
        environment: deps.environment,
      };
      c.header("cache-control", "no-store");
      return c.json(body);
    }),
  );
}
