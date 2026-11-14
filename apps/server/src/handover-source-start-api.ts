import { peerBodyLimit } from "./peer-route-limits.js";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { nodes, readNodeMembership, withTransaction } from "@waitron/db";
import {
  bindingFingerprint,
  isOperationId,
  refuseRequest,
  verifyEnvelope,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import {
  servingPrimaryNodeId,
  type CanonicalValue,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  readHandoverEvent,
  readHandoverOperation,
  readHandoverRestriction,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import {
  codeOf,
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, isAppError, isUuid } from "@waitron/shared";
import {
  askPeerStatus,
  boxRefusal,
  isRecord,
  originOf,
  postToBox,
  readVenueAuthority,
} from "./boot-peer-check.js";
import {
  imageMigrationsDigest,
  isManifestStateFile,
  readOfferSettings,
  type OfferSettings,
} from "./handover-manifest.js";
import { currentBinding, peerKeyOf, signAsThisBox } from "./handover-signing.js";
import type { HandoverGate } from "./handover-gate.js";
import { handoverPageAt, handoverPageOf } from "./handover-status-api.js";
import {
  abandonHandover,
  beginHandoverFromOffer,
  HANDOVER_EVENT,
  readHandoverEnvelope,
  storedRefusal,
  type HandoverRefusal,
} from "./handover-store.js";
import type { Logger } from "./logger.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

export interface HandoverSourceStartDeps extends PeerStatusApiDeps {
  stateDir: string;
  migrationsRoot: string | null;
  advertisedOrigin: string;
  /** Whether an enabled module can prepare the spare's promotion. */
  venueCanPromote: boolean;
  gate: Pick<HandoverGate, "isClosed">;
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
  "handover.destination_not_joined": 409,
  "handover.restarted_before_stepdown": 409,
  "handover.membership_changed": 409,
  "handover.backup_settings_differ": 409,
  "handover.modules_differ": 409,
  "handover.key_ring_mismatch": 409,
  "handover.settings_unreadable": 409,
  "handover.destination_settings_unreadable": 409,
  "handover.settings_changed": 409,
  "handover.superseded_during_start": 409,
  "handover.restriction_conflict": 409,
  "handover.step_out_of_order": 409,
  "server.internal": 500,
} as const;

const FIELD_NAME = /^[A-Za-z][A-Za-z.]{0,63}$/;

function isFieldName(value: unknown): boolean {
  return typeof value === "string" && FIELD_NAME.test(value);
}

// The refusals the offer route answers, and the one param each carries in the form it sends. A
// refusal is not signed, and its params reach this box's log, its answer and its stored detail.
const OFFER_REFUSALS: Readonly<
  Record<string, { name: string; isValid: (value: unknown) => boolean } | null>
> = {
  "handover.request_invalid": { name: "field", isValid: isFieldName },
  "handover.peer_unknown": null,
  "handover.not_a_spare": null,
  "handover.promotion_running": null,
  "handover.membership_mismatch": { name: "operationId", isValid: isOperationId },
  "handover.operation_in_progress": { name: "operationId", isValid: isOperationId },
  "handover.operation_conflict": { name: "operationId", isValid: isOperationId },
  "handover.backup_settings_differ": null,
  "handover.modules_differ": null,
  "handover.key_ring_mismatch": null,
  "handover.destination_settings_unreadable": { name: "file", isValid: isManifestStateFile },
};

interface StartRequest {
  operationId: string;
  destinationNodeId: string;
}

function parseRequest(raw: unknown): StartRequest {
  if (!isRecord(raw)) refuseRequest("body");
  const known = ["operationId", "destinationNodeId"];
  if (Object.keys(raw).some((key) => !known.includes(key))) refuseRequest("body");
  const { operationId, destinationNodeId } = raw;
  if (!isOperationId(operationId)) refuseRequest("operationId");
  if (typeof destinationNodeId !== "string" || !isUuid(destinationNodeId)) {
    refuseRequest("destinationNodeId");
  }
  return { operationId, destinationNodeId };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function refusalIn(text: string): HandoverRefusal | null {
  const refusal = boxRefusal(text);
  if (refusal === null || !Object.hasOwn(OFFER_REFUSALS, refusal.code)) return null;
  const param = OFFER_REFUSALS[refusal.code]!;
  const code = refusal.code as HandoverRefusal["code"];
  if (param === null) return { code, params: {} };
  const value = isRecord(refusal.params) ? refusal.params[param.name] : undefined;
  if (!param.isValid(value)) return null;
  return { code, params: { [param.name]: value as string } };
}

function refusalOf(error: unknown): HandoverRefusal {
  if (!isAppError(error)) return { code: "server.internal", params: {} };
  return { code: error.code, params: error.params as HandoverRefusal["params"] };
}

/** `id`'s entry in `held`, when the chart names it a spare. */
function spareIn(held: SignedMembershipDocument, id: string) {
  const entry = held.body.nodes.find((node) => node.nodeId === id);
  return entry?.standing === "serving-secondary" ? entry : null;
}

/**
 * Whether this box's own `nodes` holds `id` under the key the chart vouches for. The final copy is
 * this file's bytes, and the spare refuses a copy without that row, by when this box has stopped.
 */
async function holdsJoinedSpare(deps: HandoverSourceStartDeps, id: string): Promise<boolean> {
  const chartKey = (await peerKeyOf(deps))(id);
  const [row] = await deps.db
    .select({ publicKey: nodes.publicKey })
    .from(nodes)
    .where(eq(nodes.id, id));
  return chartKey !== undefined && row?.publicKey === chartKey;
}

/** `POST /management-api/handover` — a person holding `node.manage` starts a controlled handover. */
export function mountHandoverSourceStartApi(
  app: Hono,
  deps: HandoverSourceStartDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "handover-source-start.failed");
  const timeoutMs = deps.peerTimeoutMs ?? PEER_TIMEOUT_MS;
  const exchange = { timeoutMs, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) };
  // Read at each call, so a repaired authority is the one checked.
  const checkedExchange = async () => {
    const authority = await readVenueAuthority(deps.stateDir);
    return { ...exchange, authorityOf: () => authority };
  };
  // One request at a time, so one cannot record `abandoned` beneath another that goes on to step down.
  let running: string | null = null;

  const unreachable = (destinationNodeId: string): HandoverRefusal => ({
    code: "handover.destination_unreachable",
    params: { destinationNodeId },
  });

  const answerToOffer = async (
    binding: HandoverBinding,
    contactUrl: string,
    envelope: string,
  ): Promise<HandoverRefusal | null> => {
    const { destinationNodeId, operationId, sourceNodeId } = binding;
    let keyOf: Awaited<ReturnType<typeof peerKeyOf>>;
    let answer: { status: number; text: string };
    try {
      // Read before the offer goes, so a box that could not check the answer sends nothing.
      keyOf = await peerKeyOf(deps);
      answer = await postToBox(
        await checkedExchange(),
        destinationNodeId,
        `${trimTrailingSlashes(contactUrl)}${OFFER_PATH}`,
        envelope,
      );
    } catch (error) {
      // The one answer covers a fault in this box's own key too, so only this line tells them apart.
      log("warn", "handover-source-start.offer_not_sent", {
        operationId,
        destinationNodeId,
        error: String(error),
      });
      return unreachable(destinationNodeId);
    }
    if (answer.status < 200 || answer.status > 299) {
      return refusalIn(answer.text) ?? unreachable(destinationNodeId);
    }
    const verdict = verifyEnvelope<unknown>(parseJson(answer.text), "status", keyOf);
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

  const abandon = async (operationId: string, refusal: HandoverRefusal): Promise<never> => {
    await abandonHandover(deps, operationId, refusal);
    throw new AppError(refusal.code, refusal.params as never);
  };

  const stepDownFor = async (c: Context, binding: HandoverBinding): Promise<void> => {
    try {
      await deps.stepDownAfterOffer(c, binding);
    } catch (error) {
      // An open gate means nothing was stopped. Once it has closed the box is restarting, perhaps
      // already stepped down, so `abandoned` could be false.
      if (!deps.gate.isClosed()) {
        await abandonHandover(deps, binding.operationId, refusalOf(error));
        throw error;
      }
      // A restriction naming no operation came from a newer chart, which is no fault in Waitron.
      if (
        codeOf(error) === "handover.restriction_conflict" &&
        (await readHandoverRestriction(deps.node, deps.nodeId))?.operationId === null
      ) {
        throw new AppError("handover.superseded_during_start", {});
      }
      throw error;
    }
  };

  const offerThenStepDown = async (
    c: Context,
    binding: HandoverBinding,
    contactUrl: string,
    envelope: string,
  ): Promise<{ handoverPage: string }> => {
    const refused = await answerToOffer(binding, contactUrl, envelope);
    if (refused !== null) return abandon(binding.operationId, refused);
    await stepDownFor(c, binding);
    return { handoverPage: handoverPageAt(contactUrl, binding.operationId) };
  };

  const answerStored = async (
    c: Context,
    stored: HandoverOperation,
    request: StartRequest,
  ): Promise<{ handoverPage?: string }> => {
    const { operationId, destinationNodeId } = request;
    if (
      stored.role !== "source" ||
      stored.scenario !== "controlled" ||
      stored.destinationNodeId !== destinationNodeId
    ) {
      throw new AppError("handover.operation_conflict", { operationId });
    }
    if (stored.state === "abandoned") {
      const event = await readHandoverEvent(
        deps.node,
        deps.nodeId,
        operationId,
        HANDOVER_EVENT.abandoned,
      );
      // A fault in Waitron: moving to `abandoned` records this event in the same transaction.
      if (event === null) throw new Error(`no abandoned event for handover ${operationId}`);
      const { code, params } = storedRefusal(event.detail);
      throw new AppError(code, params as never);
    }
    if (stored.state !== "prepared") {
      return { handoverPage: await handoverPageOf(deps, stored) };
    }
    if (deps.gate.isClosed()) {
      // A stepped-down box records nothing and offers nothing: only the stepdown already under way
      // can say how this one ended.
      await stepDownFor(c, stored.binding as unknown as HandoverBinding);
      // A fault in Waitron: a stepdown for this operation moves it past `prepared` in its one write.
      throw new Error(`a stepdown replay succeeded for handover ${operationId} still at prepared`);
    }
    const held = await readNodeMembership(deps.db);
    if (held === null || servingPrimaryNodeId(held) !== deps.nodeId) {
      return abandon(operationId, { code: "handover.not_main_box", params: {} });
    }
    const destination = spareIn(held, destinationNodeId);
    if (destination === null) {
      return abandon(operationId, {
        code: "handover.destination_not_spare",
        params: { destinationNodeId },
      });
    }
    const binding = await currentBinding(
      deps,
      "controlled",
      deps.nodeId,
      destinationNodeId,
      operationId,
    );
    if (bindingFingerprint(binding) !== stored.fingerprint) {
      return abandon(operationId, { code: "handover.membership_changed", params: {} });
    }
    // Before the offer goes, as `answerToOffer` reads the same key: a read that fails sends nothing.
    const joined = await holdsJoinedSpare(deps, destinationNodeId).catch((error: unknown) => {
      // The refusal below reads as the other box's fault, so only this line names this box's own key.
      log("warn", "handover-source-start.spare_check_failed", {
        operationId,
        destinationNodeId,
        error: String(error),
      });
      return null;
    });
    if (joined === null) return abandon(operationId, unreachable(destinationNodeId));
    if (!joined) {
      return abandon(operationId, {
        code: "handover.destination_not_joined",
        params: { destinationNodeId },
      });
    }
    const offer = await readHandoverEnvelope(deps, operationId, HANDOVER_EVENT.offer);
    // A spare that recorded this offer answers from its store, comparing nothing, so a file that
    // went bad or changed since is found only here.
    let settings: OfferSettings;
    try {
      settings = await readOfferSettings(
        deps.stateDir,
        deps.ring,
        "handover.settings_unreadable",
        deps.db,
      );
    } catch (error) {
      return abandon(operationId, refusalOf(error));
    }
    const offered = (JSON.parse(offer) as { body: { settings: unknown } }).body.settings;
    if (!isDeepStrictEqual(offered, settings)) {
      return abandon(operationId, { code: "handover.settings_changed", params: {} });
    }
    return offerThenStepDown(c, binding, destination.contactUrl, offer);
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
    const destination = spareIn(held, destinationNodeId);
    if (destination === null) {
      throw new AppError("handover.destination_not_spare", { destinationNodeId });
    }
    const { contactUrl } = destination;
    if (contactUrl === "" || originOf(contactUrl) === originOf(deps.advertisedOrigin)) {
      throw new AppError("handover.destination_unaddressable", { destinationNodeId });
    }
    const status = await askPeerStatus({
      ...(await checkedExchange()),
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
    })({ nodeId: destinationNodeId, url: contactUrl, standing: destination.standing });
    if (status === null) {
      throw new AppError("handover.destination_unreachable", { destinationNodeId });
    }
    if (!(await holdsJoinedSpare(deps, destinationNodeId))) {
      throw new AppError("handover.destination_not_joined", { destinationNodeId });
    }
    const binding = await currentBinding(
      deps,
      "controlled",
      deps.nodeId,
      destinationNodeId,
      operationId,
    );
    const settings = await readOfferSettings(
      deps.stateDir,
      deps.ring,
      "handover.settings_unreadable",
      deps.db,
    );
    const envelope: SignedHandoverEnvelope<CanonicalValue> = await signAsThisBox(deps, "stepdown", {
      binding: binding as unknown as CanonicalValue,
      authorisedBy: personId,
      settings: settings as unknown as CanonicalValue,
      imageMigrations: imageMigrationsDigest(deps.migrationsRoot),
    });
    if (deps.gate.isClosed()) {
      // A stepped-down box records nothing and offers nothing. With no operation of its own open,
      // only a newer chart can have closed the gate.
      const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
      if (open !== null) {
        throw new AppError("handover.operation_in_progress", { operationId: open.operationId });
      }
      throw new AppError("handover.superseded_during_start", {});
    }
    await beginHandoverFromOffer(deps, binding, "source", envelope);
    return offerThenStepDown(c, binding, contactUrl, JSON.stringify(envelope));
  };

  app.use("/management-api/handover", peerBodyLimit(1048576));
  app.post("/management-api/handover", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const token = requireManagementSession(c);
      const personId = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: token,
          permission: "node.manage",
          touch: false,
        });
        // The old box steps down before the spare can check its password and current code.
        await requireFreshManagementSignIn(tx, token, { allowRecoveryCode: false });
        return authorizedBy;
      });
      const request = parseRequest(await readRawJsonBody<unknown>(c));
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
