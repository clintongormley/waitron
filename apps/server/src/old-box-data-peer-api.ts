import "./errors.js";
import type { Hono } from "hono";
import { readNodeMembership } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { readHandoverRestriction } from "@waitron/node-db";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { mainBoxToAsk } from "./main-box-answer.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { sinceRule, usableCopyTime, type SinceRule } from "./old-box-data-since.js";
import { oneBuildAtATime, type BuildTurn } from "./old-box-data-turn.js";
import { makeOldBoxWorkbook } from "./old-box-data-workbook.js";
import type { HeardCopy } from "./old-box-holdings.js";
import { peerBodyLimit } from "./peer-route-limits.js";
import { readPlannedHandover } from "./restricted-page.js";
import { returnVenue, type ReturnRecordsDeps } from "./return-records.js";

export interface OldBoxDataPeerDeps extends ReturnRecordsDeps {
  /** Whether this box has saved a reset the main box ordered. */
  resetOrdered?: () => boolean;
  /** Shared with the page's download, so one workbook is made at a time. */
  turn?: BuildTurn;
  build?: typeof makeOldBoxWorkbook;
}

const FRESH_MS = 5 * 60_000;
const NONCES_KEPT = 1_000;

function refuse(reason: string): never {
  throw new AppError("handover.old_box_data_query_refused", { reason });
}

const isRecord = (value: CanonicalValue | undefined): value is Record<string, CanonicalValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The main box's signed `old-box-data-query`, checked as the main box checks a `reset-query`. */
async function checkedQuery(deps: OldBoxDataPeerDeps, raw: unknown, nowMs: number) {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const verified = verifyEnvelope<CanonicalValue>(
    raw,
    "old-box-data-query",
    await peerKeyOf(deps, chart),
  );
  if (!verified.valid) refuse("signature");
  const { body, signerNodeId: source } = verified;
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  if (source !== mainBoxToAsk(deps.nodeId, chart, restriction).target?.nodeId) refuse("signer");
  if (!isRecord(body)) refuse("request");
  const venue = await returnVenue(deps);
  if (
    body.sourceNodeId !== source ||
    body.destinationNodeId !== deps.nodeId ||
    venue === null ||
    body.venue === undefined ||
    canonicalize(body.venue) !== canonicalize(venue)
  )
    refuse("binding");
  const { nonce, sentAtMs, language, holdings, lastChangeAtMs } = body;
  if (
    typeof nonce !== "string" ||
    nonce.length === 0 ||
    nonce.length > 64 ||
    !Number.isSafeInteger(sentAtMs) ||
    (language !== "en" && language !== "es") ||
    !isRecord(holdings) ||
    (lastChangeAtMs !== undefined && lastChangeAtMs !== null && !usableCopyTime(lastChangeAtMs))
  )
    refuse("request");
  if (Math.abs(nowMs - (sentAtMs as number)) > FRESH_MS) refuse("stale");
  const copy: HeardCopy | null =
    lastChangeAtMs === undefined ? null : { lastChangeAtMs: lastChangeAtMs as number | null };
  return { source, nonce, language: language as "en" | "es", holdings, copy };
}

/**
 * `POST /api/node/old-box-data`: the new main box asks this replaced box for the workbook its own
 * page offers, built from the main box's summary and copy time. Like the page, it only reads.
 */
export function mountOldBoxDataPeerApi(app: Hono, deps: OldBoxDataPeerDeps, log: Logger): void {
  const turn = deps.turn ?? oneBuildAtATime();
  const build = deps.build ?? makeOldBoxWorkbook;
  const seen = new Set<string>();
  const run = createErrorBoundary(
    {
      "handover.old_box_data_query_refused": 409,
      "membership.held_untrusted": 409,
    },
    "old_box_data.peer_failed",
  );
  app.use("/api/node/old-box-data", peerBodyLimit(262144));
  app.post("/api/node/old-box-data", (c) =>
    run(c, log, async () => {
      const arrivedAt = deps.now?.() ?? new Date();
      const raw = await readJsonBody<unknown>(c);
      const query = await checkedQuery(deps, raw, arrivedAt.getTime());
      if (seen.has(query.nonce)) refuse("nonce");
      seen.add(query.nonce);
      if (seen.size > NONCES_KEPT) seen.delete(seen.values().next().value!);
      if (deps.resetOrdered?.() === true) refuse("wiping");
      const release = turn.take();
      if (release === null) refuse("busy");
      try {
        let since: SinceRule | undefined;
        if (!(await readPlannedHandover({ node: deps.node, nodeId: deps.nodeId })))
          since = await sinceRule(deps.db, query.copy);
        const made = await build({
          db: deps.db,
          modules: deps.modules,
          mainHoldings: { holdings: query.holdings, heardAt: arrivedAt },
          madeAt: arrivedAt,
          language: query.language,
          ...(since === undefined ? {} : { since }),
        });
        log("info", "old_box_data.sent", {
          nodeId: query.source,
          bytes: made.bytes.byteLength,
          ...(since === undefined ? {} : { since: since.kind }),
          ...made.counts,
          requestId: c.get("requestId"),
        });
        c.header("Cache-Control", "no-store");
        return c.json(
          await signAsThisBox(deps, "old-box-data", {
            nonce: query.nonce,
            sourceNodeId: query.source,
            madeOn: made.madeOn,
            counts: made.counts,
            workbook: Buffer.from(made.bytes).toString("base64"),
          }),
          200,
        );
      } finally {
        release();
      }
    }),
  );
}
