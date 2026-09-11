import "./errors.js";
import type { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createErrorBoundary, readJsonBody, requireString } from "@waitron/server-kit";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/** The loopback forms a same-host connection presents (design §2). `::ffff:127.0.0.1` is IPv4 mapped
 * into IPv6, which a dual-stack listener reports for a v4 loopback client. Anything else is off-box. */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface NodeEnrolApiDeps {
  db: Database;
  cfg: TillConfig;
  nodeId: string;
  /** Boot-captured `isSingletonPrimary && !fencedOrMirror` (the `acceptingSales` predicate). Only the
   * primary can write `print_agents`. On a mirror/fenced node the read-only gate refuses the POST with
   * `node.read_only` before this predicate is read; the `isPrimary` gate below is the defensive refusal
   * (`node.enrol_unavailable`) for a non-primary node the read-only gate does not cover. */
  isPrimary: boolean;
  enrolRateLimiter?: EnrolRateLimiter;
}

const STATUS = {
  "node.enrol_not_local": 403,
  "node.enrol_unavailable": 409,
  "device.join_revoked": 403,
  "device.join_rate_limited": 429,
  // `requireString(body.name, "name")` throws this (server-kit request-screens.ts), not
  // `shared.invalid_body`; `readJsonBody` coerces a malformed body to `{}` and never throws.
  "management.request_invalid": 400,
} as const;

/**
 * `POST /api/node/enrol-self` (design §1.1) — the loopback-only self-enrol a print agent running on
 * THIS box calls before it falls back to knock-and-accept. Mounted on every trading boot beside
 * `GET /api/node`, so a mirror/fenced node has the route too — but there the read-only gate
 * (`read-only-gate.ts`) refuses the POST with `node.read_only` BEFORE this route's `isPrimary` check
 * runs. The `isPrimary`→`node.enrol_unavailable` check is the defensive refusal for a non-primary node
 * the read-only gate does not cover; either refusal makes the agent fall back to the manual knock.
 * Order: rate-limit, then the loopback gate, then the primary gate, then the write — the two gates run
 * before any DB work so a flood or an off-box caller draws no connection from the pool.
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
      const { token } = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return selfEnrolNodeAgent(tx, deps.cfg, { nodeId: deps.nodeId, name });
      });
      return c.json({ token }, 201);
    }),
  );
}
