import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  servingPrimaryNodeId,
  standingOf,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { DeploymentEnvironment } from "./config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { TradingAdmissionView } from "./trading-admission.js";

export interface NodeApiDeps {
  nodeId: string;
  /**
   * Captured at boot, not live, on purpose: a promotion takes effect on restart, so a
   * promoted-but-not-restarted process must keep answering false.
   */
  acceptingSales: boolean;
  readTradingAdmission?: () => TradingAdmissionView;
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
      c.header("cache-control", "no-store");
      const admission = deps.readTradingAdmission?.();
      if (admission !== undefined && admission.state !== "ready")
        return c.json({ acceptingSales: false });
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

/** The serving primary's address in `held`, or `null` when the chart names none. */
export function mainServerUrl(held: SignedMembershipDocument | null): string | null {
  const mainId = held === null ? undefined : servingPrimaryNodeId(held);
  return held?.body.nodes.find((n) => n.nodeId === mainId)?.contactUrl || null;
}

/**
 * `GET /api/node/main` — mounted on a spare only: the address its switch page tries before offering
 * the switch, so a main server the spare cannot reach but the person's device can is not switched
 * away from.
 */
export function mountMainServerApi(
  app: Hono,
  deps: Pick<NodeApiDeps, "readMembership">,
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "node.failed");
  app.get("/api/node/main", (c) =>
    run(c, log, async () => {
      c.header("cache-control", "no-store");
      return c.json({ mainUrl: mainServerUrl(await deps.readMembership()) });
    }),
  );
}
