import "./errors.js";
import type { Context, Hono } from "hono";
import { createErrorBoundary, readJsonBody, requireString } from "@waitron/server-kit";
import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import { fencedOutNodeIds, servingPrimaryNodeId } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { boxRefusal, isCertificateRefusal, isRecord, postToBox } from "./boot-peer-check.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { signAsThisBox } from "./handover-signing.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { Logger } from "./logger.js";
import { mainServerUrl } from "./node-api.js";
import {
  PRINT_AGENT_ENROL_PATH,
  type AgentEnrolAnswer,
  type AgentEnrolBody,
} from "./print-agent-enrol-api.js";
import { requestProvenFromBox } from "./request-from-box.js";
import type { SpareSettingsExchange } from "./spare-settings.js";

export interface NodeEnrolApiDeps {
  db: Database;
  nodeId: string;
  /** Boot-captured: false on a mirror or a fenced node. */
  isPrimary: boolean;
  /**
   * Set on a mirror that is not fenced: a request is signed by this box and sent to the main box
   * its held chart names, whose token is passed on. Nothing is stored here.
   */
  spare?: { node: NodeDatabase; ring: KeyRing; exchange: SpareSettingsExchange };
  enrolRateLimiter?: EnrolRateLimiter;
  /** The fail-closed check for a request from this box; tests replace it. */
  requestProvenFromBox?: (c: Context) => boolean;
}

const STATUS = {
  "node.enrol_not_local": 403,
  "node.enrol_unavailable": 409,
  "device.join_revoked": 403,
  "device.join_rate_limited": 429,
  // `requireString` throws this; `readJsonBody` coerces a malformed body to `{}`.
  "management.request_invalid": 400,
} as const;

/** The refusals the main box's route answers; any other code it sends is not logged. */
const MAIN_REFUSALS: ReadonlySet<string> = new Set([
  "handover.request_invalid",
  "handover.peer_unknown",
  "node.enrol_unavailable",
  "device.join_revoked",
  "device.join_rate_limited",
]);

/**
 * `POST /api/node/enrol-self` — the loopback-only self-enrol a print agent running on this box
 * calls first; off a spare it then falls back to knock-and-accept. The rate limit and loopback gates refuse before
 * any database work. On a spare the token comes from the main box (`print-agent-enrol-api.ts`),
 * and any failure there answers `node.enrol_unavailable`, so the agent asks again next round.
 */
export function mountNodeEnrolApi(app: Hono, deps: NodeEnrolApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "node.failed");
  const limiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();
  const fromBox = deps.requestProvenFromBox ?? requestProvenFromBox;
  // The agent asks again every round while refused, so the forwarding warning is written only when
  // its reason changes; the error boundary still logs each refusal it answers.
  let lastFailure: string | undefined;

  async function askMainBox(spare: NonNullable<NodeEnrolApiDeps["spare"]>, name: string) {
    const held = await readNodeMembership(deps.db);
    const mainId = held === null ? undefined : servingPrimaryNodeId(held);
    const contactUrl = mainServerUrl(held);
    if (
      held === null ||
      mainId === undefined ||
      mainId === deps.nodeId ||
      contactUrl === null ||
      fencedOutNodeIds(held).has(deps.nodeId)
    )
      throw new AppError("node.enrol_unavailable", {});
    const failed = (reason: string): never => {
      if (reason !== lastFailure) log("warn", "node.enrol_forward_failed", { reason });
      lastFailure = reason;
      throw new AppError("node.enrol_unavailable", {});
    };
    const base = contactUrl.replace(/\/+$/, "");
    if (spare.exchange.fetch === undefined && URL.parse(base)?.protocol !== "https:")
      return failed("not_https");
    if (spare.exchange.fetch === undefined && spare.exchange.authorityOf?.(mainId) === undefined)
      return failed("no_authority");
    const body: AgentEnrolBody = { name, toNodeId: mainId };
    const envelope = await signAsThisBox(
      { node: spare.node, ring: spare.ring, nodeId: deps.nodeId },
      "agent-enrol",
      { ...body },
    );
    let answer: { status: number; text: string };
    try {
      answer = await postToBox(
        spare.exchange,
        mainId,
        `${base}${PRINT_AGENT_ENROL_PATH}`,
        JSON.stringify(envelope),
      );
    } catch (error) {
      return failed(isCertificateRefusal(error) ? "certificate" : "unreachable");
    }
    if (answer.status !== 201) {
      const code = boxRefusal(answer.text)?.code;
      return failed(code !== undefined && MAIN_REFUSALS.has(code) ? code : String(answer.status));
    }
    let answered: unknown;
    try {
      answered = JSON.parse(answer.text);
    } catch {
      answered = undefined;
    }
    if (!isRecord(answered) || typeof answered.token !== "string") return failed("malformed");
    log("info", "node.enrol_forwarded", { mainNodeId: mainId });
    lastFailure = undefined;
    const token: AgentEnrolAnswer = { token: answered.token };
    return token;
  }

  app.post("/api/node/enrol-self", (c) =>
    run(c, log, async () => {
      limiter.check(); // throws device.join_rate_limited (429)
      if (!fromBox(c)) throw new AppError("node.enrol_not_local", {});
      if (!deps.isPrimary && deps.spare === undefined)
        throw new AppError("node.enrol_unavailable", {});
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      if (deps.spare !== undefined) return c.json(await askMainBox(deps.spare, name), 201);
      const { token } = await withTransaction(deps.db, async (tx) => {
        return selfEnrolNodeAgent(tx, { nodeId: deps.nodeId, name });
      });
      return c.json({ token }, 201);
    }),
  );
}
