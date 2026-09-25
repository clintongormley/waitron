import "./errors.js";
import type { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createErrorBoundary, readJsonBody, requireString } from "@waitron/server-kit";
import { withTransaction, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/** `::ffff:127.0.0.1` is IPv4 mapped into IPv6, which a dual-stack listener reports for a v4
 * loopback client. */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface NodeEnrolApiDeps {
  db: Database;
  cfg: TillConfig;
  nodeId: string;
  /** Boot-captured. On a mirror or fenced node the read-only gate refuses the POST with
   * `node.read_only` before this is read; this is the defensive refusal for a non-primary node the
   * read-only gate does not cover. */
  isPrimary: boolean;
  enrolRateLimiter?: EnrolRateLimiter;
}

const STATUS = {
  "node.enrol_not_local": 403,
  "node.enrol_unavailable": 409,
  "device.join_revoked": 403,
  "device.join_rate_limited": 429,
  // `requireString` throws this; `readJsonBody` coerces a malformed body to `{}`.
  "management.request_invalid": 400,
} as const;

/**
 * `POST /api/node/enrol-self` — the loopback-only self-enrol a print agent running on this box
 * calls before it falls back to knock-and-accept. The rate limit, loopback and primary gates all
 * refuse before any database work.
 */
export function mountNodeEnrolApi(app: Hono, deps: NodeEnrolApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "node.failed");
  const limiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  app.post("/api/node/enrol-self", (c) =>
    run(c, log, async () => {
      limiter.check(); // throws device.join_rate_limited (429)
      const address = getConnInfo(c).remote.address;
      if (address === undefined || !LOOPBACK.has(address)) {
        throw new AppError("node.enrol_not_local", {});
      }
      if (!deps.isPrimary) throw new AppError("node.enrol_unavailable", {});
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const { token } = await withTransaction(deps.db, async (tx) => {
        return selfEnrolNodeAgent(tx, deps.cfg, { nodeId: deps.nodeId, name });
      });
      return c.json({ token }, 201);
    }),
  );
}
