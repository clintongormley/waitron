import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { inTurn } from "@waitron/provisioning";
import { readNodeMembership, nowIso, type Database, type NodeDatabase } from "@waitron/db";
import {
  insertHandoverActivationTx,
  readHandoverActivation,
  type HandoverState,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  readHandoverEvent,
  readHandoverOperation,
  readMirrorLink,
  readNodeMode,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { oldBoxStillMain } from "./handover-chart.js";
import { usableBase } from "./handover-destination-duty.js";
import {
  assertBindingNamesOperation,
  handoverPromotionContext,
  OPERATION_ID_MAX_LENGTH,
  readOperationReadyToPromote,
  signInCredentials,
} from "./handover-preparation.js";
import { advanceHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { CHART_MINT_REFUSALS } from "./membership-mint.js";
import { assertHeldDocumentReadable, HELD_DOCUMENT_REFUSALS } from "./membership-trust.js";
import { boxExchange } from "./mirror-bundle-fetch.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import type { createNodeOperationPreparation } from "./node-operation-preparation.js";
import type { FenceAttestation, PromotionOperationRunner } from "./promote.js";
import type { PromoteRunResult } from "./promote-api.js";
import { parseStandbyOperationInput } from "./recovery-module-operation.js";

export interface HandoverActivationDeps {
  node: NodeDatabase;
  nodeId: string;
  appDb: Database;
  nodePreparation: ReturnType<typeof createNodeOperationPreparation>;
  run: (
    attestation: FenceAttestation,
    operation: PromotionOperationRunner,
    beforeRestart: () => Promise<void>,
  ) => Promise<PromoteRunResult>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "authorization.not_permitted": 403,
  "handover.request_invalid": 400,
  "handover.operation_unknown": 404,
  "handover.step_out_of_order": 409,
  "handover.source_no_longer_main": 409,
  "module.operation_invalid": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
  ...CHART_MINT_REFUSALS,
  ...HELD_DOCUMENT_REFUSALS,
};

const ALREADY_ACTIVATED: ReadonlySet<HandoverState> = new Set<HandoverState>([
  "activated",
  "return_pending",
  "return_complete",
  "return_abandoned",
]);

const ALREADY_ANSWER = { activated: true, restarting: false } as const;

async function alreadyActivated(deps: HandoverActivationDeps, operationId: string) {
  const stored = await readHandoverOperation(deps.node, deps.nodeId, operationId);
  return stored?.role === "destination" && ALREADY_ACTIVATED.has(stored.state);
}

/** The signed step that let this box go ahead: a stored event's envelope, read here, never sent. */
async function storedEvidence(
  deps: HandoverActivationDeps,
  operation: HandoverOperation,
): Promise<SignedHandoverEnvelope<unknown>> {
  const event = await readHandoverEvent(
    deps.node,
    deps.nodeId,
    operation.operationId,
    operation.state,
  );
  if (event?.envelope == null) {
    // A fault in Waitron: `advanceHandover` stores the envelope with the step this box checked.
    throw new Error(`the operation ${operation.operationId} has no stored ${operation.state}`);
  }
  return JSON.parse(event.envelope) as SignedHandoverEnvelope<unknown>;
}

async function activate(
  deps: HandoverActivationDeps,
  operationId: string,
  body: { moduleOperation?: unknown; signIn?: unknown },
): Promise<{ activated: true; restarting: boolean }> {
  if (await alreadyActivated(deps, operationId)) return ALREADY_ANSWER;
  const operation = await readOperationReadyToPromote(deps, operationId);
  const moduleOperation = parseStandbyOperationInput(body.moduleOperation);
  if (moduleOperation === null)
    throw new AppError("module.operation_invalid", { module: "unknown" });
  assertBindingNamesOperation(moduleOperation.binding, operation, deps.nodeId);
  // The committed promotion names this box the main box, and a repeat comes here to finish it.
  const committed = (await readHandoverActivation(deps.appDb, operationId)) !== null;
  const assertOldBoxStillMain = async (db: Parameters<typeof readNodeMembership>[0]) => {
    const held = await readNodeMembership(db);
    assertHeldDocumentReadable(held);
    if (!oldBoxStillMain(held, operation.sourceNodeId))
      throw new AppError("handover.source_no_longer_main", { operationId });
  };
  if (!committed) await assertOldBoxStillMain(deps.appDb);
  const credentials = await signInCredentials(deps.appDb, body.signIn);
  const evidence = await storedEvidence(deps, operation);
  const result = await deps.nodePreparation.withPromotion(
    moduleOperation,
    credentials,
    handoverPromotionContext(operation),
    (_modules, runner) =>
      deps.run(
        { oldNodeNeutralised: true },
        (context, consume) =>
          runner(context, async (tx, operations) => {
            // In the transaction that writes the chart: a chart taken after this waits behind it.
            await assertOldBoxStillMain(tx);
            const series = await consume(tx, operations);
            await insertHandoverActivationTx(tx, {
              operationId,
              scenario: operation.scenario,
              sourceNodeId: operation.sourceNodeId,
              destinationNodeId: operation.destinationNodeId,
              evidence,
              personId: credentials.personId,
              activatedAt: nowIso(),
            });
            return series;
          }),
        // Venue first, node after: a repeat finishes this record from the committed row, and no record
        // can claim a promotion that did not commit.
        () => advanceHandover(deps, operationId, "activated", {}),
      ),
    // The password check takes long enough for the operation to move on.
    async () => {
      await readOperationReadyToPromote(deps, operationId);
    },
  );
  if (!result.alreadyPrimary) return { activated: true, restarting: result.restarting };
  if ((await readHandoverActivation(deps.appDb, operationId)) === null)
    throw new AppError("handover.step_out_of_order", {
      from: operation.state,
      to: "activated",
    });
  await advanceHandover(deps, operationId, "activated", {});
  return ALREADY_ANSWER;
}

/**
 * `POST /api/node/handover/:operationId/activate`: a fresh sign-in against the placed copy, then
 * this box takes on its own filing identity under the name its preparation selected.
 */
export function mountHandoverActivationApi(
  app: Hono,
  deps: HandoverActivationDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "handover-activation.failed");

  app.post("/api/node/handover/:operationId/activate", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const operationId = c.req.param("operationId");
      if (operationId.length > OPERATION_ID_MAX_LENGTH)
        throw new AppError("handover.request_invalid", { field: "operationId" });
      const body = await readJsonBody<{ moduleOperation?: unknown; signIn?: unknown }>(c);
      // In turn, not sharing the first attempt's answer as a capture does: each caller's own
      // password decides its own refusal, and the turn behind a success finds it activated.
      return c.json(await inTurn(deps.node, operationId, () => activate(deps, operationId, body)));
    }),
  );
}

// The old box saves one chart and answers.
const CHART_POST_LIMIT_MS = 30_000;

// The route answers `{ accepted }` or one short error.
const MAX_CHART_ANSWER_BYTES = 64 * 1024;

export interface ChartPostDeps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  log: Logger;
  limitMs?: number;
}

export interface ChartPost {
  /** Resolves when the post has ended, however it ended; it never rejects. */
  settled: Promise<void>;
  /** Ends a post under way, and resolves as `settled` does. */
  stop(): Promise<void>;
}

async function sendChartToSource(deps: ChartPostDeps, stopping: AbortSignal): Promise<void> {
  const { mode } = await readNodeMode(deps.node, deps.nodeId);
  if (mode === "mirror") return;
  const operation = await readOpenHandoverOperation(deps.node, deps.nodeId);
  if (operation?.role !== "destination" || !ALREADY_ACTIVATED.has(operation.state)) return;
  const { operationId, sourceNodeId } = operation;
  const chart = await readNodeMembership(deps.db);
  const source = chart?.body.nodes.find((n) => n.nodeId === sourceNodeId);
  if (source === undefined) return;
  const link = await readMirrorLink(deps.node, deps.nodeId);
  const base = usableBase(source.contactUrl);
  if (link === null || link.originNodeId !== sourceNodeId || base === undefined) {
    deps.log("warn", "handover-activation.chart_no_address", { operationId, sourceNodeId });
    return;
  }
  const answer = await boxExchange(
    new URL(`${base}/api/node/membership`),
    {
      method: "POST",
      trust: { ca: link.boxCaPem, rejectUnauthorized: true },
      signal: AbortSignal.any([stopping, AbortSignal.timeout(deps.limitMs ?? CHART_POST_LIMIT_MS)]),
      body: JSON.stringify({ document: chart }),
    },
    MAX_CHART_ANSWER_BYTES,
  );
  if (answer.status === 200 && (JSON.parse(answer.text) as { accepted?: unknown }).accepted) {
    deps.log("info", "handover-activation.chart_posted", { operationId, sourceNodeId });
    return;
  }
  // The route gives the same answer to a chart it refused and to one it already holds, which is what
  // every start after the first finds.
  deps.log("warn", "handover-activation.chart_not_accepted", {
    operationId,
    sourceNodeId,
    status: answer.status,
  });
}

/**
 * Hands the old box this box's chart, as a till would (`POST /api/node/membership`): one attempt per
 * start, on a box that is not a mirror and holds an open destination operation at `activated` or
 * later. Nothing waits for it, and a failure is only logged, so an old box that is switched off or
 * stalled costs this start nothing.
 *
 * Run with two boxes only (`handover-chart-post.test.ts`, `boot.handover-destination.test.ts`). With
 * a healthy third box in the chart, this box's start waits before it gets here: the chart it minted
 * carries only its own endorsement and `peerKeyOf` does not read `nodes`, so that box's answer is
 * `not_verified` (`boot-peer-check.ts:395`).
 */
export function postChartToSource(deps: ChartPostDeps): ChartPost {
  const stopping = new AbortController();
  const settled = sendChartToSource(deps, stopping.signal).catch((error: unknown) => {
    if (stopping.signal.aborted) return;
    deps.log("warn", "handover-activation.chart_post_failed", { error: String(error) });
  });
  return {
    settled,
    stop: () => {
      stopping.abort();
      return settled;
    },
  };
}
