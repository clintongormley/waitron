import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { standingOf, type NodeStanding, type SignedMembershipDocument } from "@waitron/membership";
import type { DeploymentEnvironment } from "./config.js";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";

export interface NodeApiDeps {
  /** This node's own id (`config.till.nodeId`) — what the probe answers as `nodeId`, and the id whose
   * standing is looked up in the held document. */
  nodeId: string;
  /**
   * Boot-captured (till-reroute design §3.1): `mode === "primary" && singleton_role === "primary" &&
   * !fenced`, read once with the mount guards in boot.ts. Captured, not live, on purpose: a promotion
   * persists its corrected series before the point of no return and takes effect on restart, so a
   * promoted-but-not-restarted process must keep answering false.
   */
  acceptingSales: boolean;
  /** This node's deployment environment (`config.environment`) — echoed so a till can refuse to follow
   * a server that is not in the same environment it was provisioned into (CLAUDE.md §5). */
  environment: DeploymentEnvironment;
  /** Reads the held membership document, or `null` when this node holds none. Injected because these
   * deps carry no `db`: the probe's one read is the whole-DB `node_membership` singleton, which has no
   * tenant scope and so belongs outside any `withTenant` block. */
  readMembership: () => Promise<SignedMembershipDocument | null>;
}

interface NodeProbe {
  nodeId: string;
  term: number | null;
  standing: NodeStanding | null;
  acceptingSales: boolean;
  environment: DeploymentEnvironment;
}

/**
 * EMPTY on purpose (the per-surface STATUS convention): the probe takes no input, so it answers no
 * client-fault code at all. Its only failure is the membership read, which reaches `run` as a
 * non-AppError and becomes the opaque `server.internal` 500 every other surface answers — logged at
 * `error` under the `node.failed` tag, which is a LOG TAG and not a registered code (no boundary tag
 * is; see `error-boundary.ts`). A till reads any non-200 here as "unreachable" and moves on.
 */
const STATUS: Record<string, ContentfulStatusCode> = {};

/**
 * `GET /api/node` — the public role probe a till polls every few seconds on EVERY server it knows
 * (till-reroute design §3.1): "who are you, are you accepting sales". No auth, no DB write; the one DB
 * read is the whole-DB membership row. `term`/`standing` are null when no document is held, and
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
