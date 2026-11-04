import type { Context, Hono } from "hono";
import { readNodeMembership } from "@waitron/db";
import {
  isOperationId,
  verifyEnvelope,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { authorizeManager, type TotpKeyRing } from "@waitron/identity";
import { servingPrimaryNodeId, type CanonicalValue } from "@waitron/membership";
import { readHandoverEvent, readHandoverOperation, type HandoverOperation } from "@waitron/node-db";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, isUuid, type ErrorCode } from "@waitron/shared";
import { askPeerStatus, originOf, postToBox } from "./boot-peer-check.js";
import { confirmFreshSignIn } from "./fresh-sign-in.js";
import { currentBinding, peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { handoverPageAt, handoverPageOf } from "./handover-status-api.js";
import { advanceHandover, beginHandoverFromOffer } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { createPasswordThrottle } from "./password-throttle.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

export interface HandoverSourceStartDeps extends PeerStatusApiDeps {
  advertisedOrigin: string;
  credentialKeyRing: TotpKeyRing;
  rpId: string;
  origin: string;
  /** Whether an enabled module can prepare the spare's promotion. */
  venueCanPromote: boolean;
  /** Runs once the spare has accepted the offer. */
  stepDownAfterOffer: (c: Context, binding: HandoverBinding) => Promise<void>;
  peerTimeoutMs?: number;
  fetch?: typeof fetch;
}

const PEER_TIMEOUT_MS = 5000;

const OFFER_PATH = "/api/node/handover/offer";

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "password.invalid": 401,
  "password.throttled": 429,
  "totp.invalid": 401,
  "totp.required": 401,
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
  "handover.request_invalid": 400,
  "handover.peer_unknown": 403,
  "handover.not_a_spare": 409,
  "handover.promotion_running": 409,
  "handover.membership_mismatch": 409,
  "handover.operation_in_progress": 409,
  "handover.operation_conflict": 409,
  "handover.not_main_box": 409,
  "handover.venue_not_supported": 409,
  "handover.destination_not_spare": 409,
  "handover.destination_unaddressable": 409,
  "handover.destination_unreachable": 409,
} as const;

// The refusals the offer route answers, and the one param each carries. A refusal is not signed
// and its params reach this box's log, so nothing else from it is kept.
const OFFER_REFUSALS: Readonly<Record<string, string | null>> = {
  "handover.request_invalid": "field",
  "handover.peer_unknown": null,
  "handover.not_a_spare": null,
  "handover.promotion_running": null,
  "handover.membership_mismatch": "operationId",
  "handover.operation_in_progress": "operationId",
  "handover.operation_conflict": "operationId",
};

const REFUSAL_PARAM_MAX_LENGTH = 64;

interface StartRequest {
  operationId: string;
  destinationNodeId: string;
  signIn: unknown;
}

interface Refusal {
  code: ErrorCode;
  params: Record<string, string>;
}

function invalid(field: string): never {
  throw new AppError("handover.request_invalid", { field });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(raw: unknown): StartRequest {
  if (!isRecord(raw)) invalid("body");
  const known = ["operationId", "destinationNodeId", "signIn"];
  if (Object.keys(raw).some((key) => !known.includes(key))) invalid("body");
  const { operationId, destinationNodeId, signIn } = raw;
  if (!isOperationId(operationId)) invalid("operationId");
  if (typeof destinationNodeId !== "string" || !isUuid(destinationNodeId)) {
    invalid("destinationNodeId");
  }
  return { operationId, destinationNodeId, signIn };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function refusalIn(text: string): Refusal | null {
  const answer = parseJson(text);
  const error = isRecord(answer) ? answer.error : undefined;
  if (!isRecord(error) || typeof error.code !== "string") return null;
  if (!Object.hasOwn(OFFER_REFUSALS, error.code)) return null;
  const param = OFFER_REFUSALS[error.code]!;
  const code = error.code as ErrorCode;
  if (param === null) return { code, params: {} };
  const value = isRecord(error.params) ? error.params[param] : undefined;
  if (typeof value !== "string" || value.length > REFUSAL_PARAM_MAX_LENGTH) return null;
  return { code, params: { [param]: value } };
}

/** `POST /management-api/handover` — a person holding `node.promote` starts a controlled handover. */
export function mountHandoverSourceStartApi(
  app: Hono,
  deps: HandoverSourceStartDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "handover-source-start.failed");
  const throttle = createPasswordThrottle();
  const timeoutMs = deps.peerTimeoutMs ?? PEER_TIMEOUT_MS;
  const exchange = { timeoutMs, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) };
  // One request at a time, so one cannot record `abandoned` beneath another that goes on to step down.
  let running: string | null = null;

  const unreachable = (destinationNodeId: string): Refusal => ({
    code: "handover.destination_unreachable",
    params: { destinationNodeId },
  });

  const answerToOffer = async (
    binding: HandoverBinding,
    contactUrl: string,
    envelope: string,
  ): Promise<Refusal | null> => {
    const { destinationNodeId, operationId, sourceNodeId } = binding;
    let answer: { status: number; text: string };
    try {
      answer = await postToBox(
        exchange,
        destinationNodeId,
        `${contactUrl.replace(/\/+$/, "")}${OFFER_PATH}`,
        envelope,
      );
    } catch {
      return unreachable(destinationNodeId);
    }
    if (answer.status < 200 || answer.status > 299) {
      return refusalIn(answer.text) ?? unreachable(destinationNodeId);
    }
    const verdict = verifyEnvelope<unknown>(
      parseJson(answer.text),
      "status",
      await peerKeyOf(deps),
    );
    if (!verdict.valid || verdict.signerNodeId !== destinationNodeId) {
      return unreachable(destinationNodeId);
    }
    const body = verdict.body;
    // The signature says only who answered, not which route or operation it was about.
    if (
      !isRecord(body) ||
      body.operationId !== operationId ||
      body.role !== "destination" ||
      body.scenario !== "controlled" ||
      body.sourceNodeId !== sourceNodeId ||
      body.destinationNodeId !== destinationNodeId
    ) {
      return unreachable(destinationNodeId);
    }
    if (body.state !== "prepared") {
      return { code: "handover.destination_not_spare", params: { destinationNodeId } };
    }
    return null;
  };

  const offerThenStepDown = async (
    c: Context,
    binding: HandoverBinding,
    contactUrl: string,
    envelope: string,
  ): Promise<{ handoverPage: string }> => {
    const refused = await answerToOffer(binding, contactUrl, envelope);
    if (refused !== null) {
      await advanceHandover(deps, binding.operationId, "abandoned", {
        code: refused.code,
        params: refused.params,
      });
      throw new AppError(refused.code, refused.params as never);
    }
    await deps.stepDownAfterOffer(c, binding);
    return { handoverPage: handoverPageAt(contactUrl, binding.operationId) };
  };

  const answerStored = async (
    c: Context,
    stored: HandoverOperation,
    request: StartRequest,
  ): Promise<{ handoverPage?: string }> => {
    const { operationId } = request;
    if (
      stored.role !== "source" ||
      stored.scenario !== "controlled" ||
      stored.destinationNodeId !== request.destinationNodeId
    ) {
      throw new AppError("handover.operation_conflict", { operationId });
    }
    if (stored.state === "abandoned") {
      const event = await readHandoverEvent(deps.node, deps.nodeId, operationId, "abandoned");
      // A fault in Waitron: moving to `abandoned` records this event in the same transaction.
      if (event === null) throw new Error(`no abandoned event for handover ${operationId}`);
      const { code, params } = event.detail as unknown as Refusal;
      throw new AppError(code, params as never);
    }
    if (stored.state !== "prepared") {
      return { handoverPage: await handoverPageOf(deps, stored) };
    }
    const offer = await readHandoverEvent(deps.node, deps.nodeId, operationId, "offer");
    // A fault in Waitron: this route records the offer in the transaction that begins the operation.
    if (offer?.envelope == null) throw new Error(`no offer event for handover ${operationId}`);
    const held = await readNodeMembership(deps.db);
    const destination = held?.body.nodes.find(
      (entry) => entry.nodeId === request.destinationNodeId,
    );
    return offerThenStepDown(
      c,
      stored.binding as unknown as HandoverBinding,
      destination?.contactUrl ?? "",
      offer.envelope,
    );
  };

  const startNew = async (
    c: Context,
    request: StartRequest,
    personId: string,
  ): Promise<{ handoverPage: string }> => {
    const { operationId, destinationNodeId } = request;
    const held = await readNodeMembership(deps.db);
    if (held === null || servingPrimaryNodeId(held) !== deps.nodeId) {
      throw new AppError("handover.not_main_box", {});
    }
    if (!deps.venueCanPromote) throw new AppError("handover.venue_not_supported", {});
    const destination = held.body.nodes.find((entry) => entry.nodeId === destinationNodeId);
    if (destination?.standing !== "serving-secondary") {
      throw new AppError("handover.destination_not_spare", { destinationNodeId });
    }
    const { contactUrl } = destination;
    if (contactUrl === "" || originOf(contactUrl) === originOf(deps.advertisedOrigin)) {
      throw new AppError("handover.destination_unaddressable", { destinationNodeId });
    }
    const status = await askPeerStatus({
      ...exchange,
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
    })({ nodeId: destinationNodeId, url: contactUrl, standing: destination.standing });
    if (status === null) {
      throw new AppError("handover.destination_unreachable", { destinationNodeId });
    }
    const binding = await currentBinding(
      deps,
      "controlled",
      deps.nodeId,
      destinationNodeId,
      operationId,
    );
    const envelope: SignedHandoverEnvelope<CanonicalValue> = await signAsThisBox(deps, "stepdown", {
      binding: binding as unknown as CanonicalValue,
      authorisedBy: personId,
    });
    await beginHandoverFromOffer(deps, binding, "source", envelope);
    return offerThenStepDown(c, binding, contactUrl, JSON.stringify(envelope));
  };

  app.post("/management-api/handover", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "node.promote",
        touch: false,
      });
      const request = parseRequest(await readRawJsonBody<unknown>(c));
      const personId = await confirmFreshSignIn(
        {
          db: deps.db,
          throttle,
          keyRing: deps.credentialKeyRing,
          rpId: deps.rpId,
          origin: deps.origin,
        },
        token,
        request.signIn,
      );
      if (running !== null) {
        throw new AppError("handover.operation_in_progress", { operationId: running });
      }
      running = request.operationId;
      try {
        const stored = await readHandoverOperation(deps.node, deps.nodeId, request.operationId);
        const answer =
          stored === null
            ? await startNew(c, request, personId)
            : await answerStored(c, stored, request);
        return c.json(answer, 200);
      } finally {
        running = null;
      }
    }),
  );
}
