import type { Context, Hono } from "hono";
import { readNodeMembership } from "@waitron/db";
import {
  bindingFingerprint,
  parseBinding,
  verifyEnvelope,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { servingPrimaryNodeId } from "@waitron/membership";
import { readHandoverOperation, readNodeMode } from "@waitron/node-db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import {
  offerSettingsDifference,
  parseOfferSettings,
  readOfferSettings,
  type OfferSettings,
} from "./handover-manifest.js";
import { currentBinding, peerKeyOf } from "./handover-signing.js";
import { signedHandoverStatus } from "./handover-status-api.js";
import { recordOfferInTurn } from "./handover-promotion-turn.js";
import { beginHandoverFromOffer } from "./handover-store.js";
import type { Logger } from "./logger.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

const STATUS = {
  "handover.request_invalid": 400,
  "handover.peer_unknown": 403,
  "handover.not_a_spare": 409,
  "handover.promotion_running": 409,
  "handover.membership_mismatch": 409,
  "handover.operation_in_progress": 409,
  "handover.operation_conflict": 409,
  "handover.backup_settings_differ": 409,
  "handover.modules_differ": 409,
  "handover.key_ring_mismatch": 409,
  "handover.destination_settings_unreadable": 409,
} as const;

export interface HandoverDestinationDeps extends PeerStatusApiDeps {
  stateDir: string;
}

interface OfferBody {
  binding: HandoverBinding;
  settings: OfferSettings;
}

interface VerifiedOffer extends OfferBody {
  envelope: SignedHandoverEnvelope<unknown>;
}

function invalid(field: string): never {
  throw new AppError("handover.request_invalid", { field });
}

function offerBodyOf(body: unknown): OfferBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) invalid("body");
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).sort().join() !== "authorisedBy,binding,settings") invalid("body");
  if (typeof fields.authorisedBy !== "string" || !isUuid(fields.authorisedBy)) {
    invalid("authorisedBy");
  }
  return { binding: parseBinding(fields.binding), settings: parseOfferSettings(fields.settings) };
}

async function verifiedOffer(c: Context, deps: PeerStatusApiDeps): Promise<VerifiedOffer> {
  const raw = await readRawJsonBody<unknown>(c);
  const verdict = verifyEnvelope<unknown>(raw, "stepdown", await peerKeyOf(deps));
  if (!verdict.valid) {
    if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose") invalid("envelope");
    throw new AppError("handover.peer_unknown", {});
  }
  const { binding, settings } = offerBodyOf(verdict.body);
  if (verdict.signerNodeId !== binding.sourceNodeId) invalid("sourceNodeId");
  if (binding.destinationNodeId !== deps.nodeId) invalid("destinationNodeId");
  if (binding.scenario !== "controlled") invalid("scenario");
  return { envelope: raw as SignedHandoverEnvelope<unknown>, binding, settings };
}

async function matchesThisBox(deps: PeerStatusApiDeps, binding: HandoverBinding): Promise<boolean> {
  // `currentBinding` treats a box with no chart as a fault; a spare may simply not hold one yet.
  const held = await readNodeMembership(deps.db);
  if (held === null) return false;
  if (servingPrimaryNodeId(held) !== binding.sourceNodeId) return false;
  const own = await currentBinding(
    deps,
    binding.scenario,
    binding.sourceNodeId,
    binding.destinationNodeId,
    binding.operationId,
  );
  return bindingFingerprint(own) === bindingFingerprint(binding);
}

/** `POST /api/node/handover/offer` — a spare receives a main box's offer to hand the venue over. */
export function mountHandoverDestinationApi(
  app: Hono,
  deps: HandoverDestinationDeps,
  log: Logger,
  onOfferRecorded: () => void = () => {},
): void {
  const run = createErrorBoundary(STATUS, "handover-destination.failed");

  app.post("/api/node/handover/offer", (c) =>
    run(c, log, async () => {
      const { envelope, binding, settings } = await verifiedOffer(c, deps);
      const { operationId } = binding;
      const stored = await readHandoverOperation(deps.node, deps.nodeId, operationId);
      // Before the mode and the chart: a retry must still answer once this box has moved on.
      if (stored?.fingerprint === bindingFingerprint(binding)) {
        return c.json(await signedHandoverStatus(deps, stored), 200);
      }
      await recordOfferInTurn(deps.node, operationId, async () => {
        const { mode } = await readNodeMode(deps.node, deps.nodeId);
        if (mode !== "mirror") throw new AppError("handover.not_a_spare", {});
        if (!(await matchesThisBox(deps, binding))) {
          throw new AppError("handover.membership_mismatch", { operationId });
        }
        const own = await readOfferSettings(
          deps.stateDir,
          deps.ring,
          "handover.destination_settings_unreadable",
        );
        const difference = offerSettingsDifference(settings, own);
        if (difference !== null) throw new AppError(difference, {});
        await beginHandoverFromOffer(deps, binding, "destination", envelope);
      });
      const recorded = await readHandoverOperation(deps.node, deps.nodeId, operationId);
      // A fault in Waitron: the transaction above recorded this row or found it recorded.
      if (recorded === null) throw new Error(`no handover operation ${operationId} after begin`);
      onOfferRecorded();
      return c.json(await signedHandoverStatus(deps, recorded), 200);
    }),
  );
}
