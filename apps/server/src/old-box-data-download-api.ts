import "./errors.js";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  readNodeMembership,
  recordActivity,
  withNodeTransaction,
  withTransaction,
} from "@waitron/db";
import { isSha256Hex, sha256Hex } from "@waitron/handover";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { readOpenHandoverOperation, readPinnedPrimaryKey } from "@waitron/node-db";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { AppError, firstCodeInCauseChain, type SupportedLocale } from "@waitron/shared";
import {
  boxRefusal,
  isRecord,
  isSilenceAfterConnecting,
  postToBox,
  readVenueAuthority,
} from "./boot-peer-check.js";
import { emergencyCopyFrom } from "./handover-intervals.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { checkedPeerAnswer } from "./main-box-answer.js";
import { MEMBERSHIP_API_STATUS } from "./membership-removal-api.js";
import { AnswerTooLarge } from "./mirror-bundle-fetch.js";
import { oneBuildAtATime, type BuildTurn } from "./old-box-data-turn.js";
import { readHoldings } from "./old-box-holdings.js";
import { toLanguage } from "./personal-data-export-api.js";
import { readResetOrderFor, resetRefusal } from "./reset-order.js";
import { returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import { resolveSessionLocale } from "./session-locale.js";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";
import { workbookDownloadHeaders } from "./xlsx-workbook.js";

export interface OldBoxDataDownloadDeps extends ReturnRecordsDeps {
  venueLocale: SupportedLocale;
  fetch?: typeof fetch;
  post?: typeof postToBox;
  timeoutMs?: number;
  /** One old box asked at a time, since each answer of up to 64 MiB is held in memory. */
  turn?: BuildTurn;
}

const ASK_FOR_MS = 120_000;
const MAX_ANSWER_BYTES = 64 * 1024 * 1024;
const PASSED_THROUGH = new Set(["membership.not_primary", "handover.operation_in_progress"]);
const COUNT_KEYS = new Set([
  "invoiceRows",
  "orderRows",
  "paymentRows",
  "hoursRows",
  "activityRows",
]);
// No repeated group: V8 runs out of stack matching one on a few-MiB string.
const BASE64_CHARACTERS = /^[A-Za-z0-9+/]*={0,2}$/;
const PEER_WORD = /^[a-z_.]{1,80}$/;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

type Counts = { invoiceRows: number } & Partial<Record<string, number>>;

const refused = (reason: string): never => {
  throw new AppError("handover.old_box_data_refused", {}, { reason });
};

function countsIn(value: unknown): Counts | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.invoiceRows)) return null;
  const entries = Object.entries(value);
  return entries.every(
    ([key, n]) => COUNT_KEYS.has(key) && Number.isSafeInteger(n) && (n as number) >= 0,
  )
    ? (value as Counts)
    : null;
}

function isOldBoxBusy(status: number, text: string): boolean {
  const refusal = status === 409 ? boxRefusal(text) : null;
  return (
    refusal?.code === "handover.old_box_data_query_refused" &&
    isRecord(refusal.params) &&
    refusal.params.reason === "busy"
  );
}

/** Why a non-200 answer refused, from the old box's own code and reason when it sent readable ones. */
function statusReason(status: number, text: string): string {
  const refusal = boxRefusal(text);
  const code = refusal !== null && PEER_WORD.test(refusal.code) ? `:${refusal.code}` : "";
  const reason =
    code !== "" && isRecord(refusal!.params) && typeof refusal!.params.reason === "string"
      ? refusal!.params.reason
      : "";
  return `status_${status}${code}${PEER_WORD.test(reason) ? `:${reason}` : ""}`;
}

/**
 * `POST /management-api/servers/:nodeId/old-box-data`: asks the replaced old main box for the
 * workbook its own page offers, and passes it to the browser. Holds no transaction while the old box
 * is asked.
 */
export function mountOldBoxDataDownloadApi(
  app: Hono,
  deps: OldBoxDataDownloadDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      ...MEMBERSHIP_API_STATUS,
      "handover.old_box_data_unavailable": 409,
      "handover.old_box_data_wipe_ordered": 409,
      "handover.old_box_unreachable": 409,
      "handover.old_box_data_refused": 409,
      "handover.old_box_data_too_large": 409,
      "handover.old_box_data_busy": 409,
    },
    "handover.old_box_data_download_failed",
  );
  const post = deps.post ?? postToBox;
  const turn = deps.turn ?? oneBuildAtATime();

  app.post("/management-api/servers/:nodeId/old-box-data", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, locale } = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "node.manage",
        });
        await requireFreshManagementSignIn(tx, sessionId);
        return {
          personId: authorizedBy,
          locale: await resolveSessionLocale(
            tx,
            sessionId,
            c.req.header("Accept-Language"),
            deps.venueLocale,
          ),
        };
      });
      const targetNodeId = c.req.param("nodeId");

      const chart = await readNodeMembership(deps.db);
      const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
      const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
      const refusal = resetRefusal(
        chart,
        deps.nodeId,
        targetNodeId,
        open,
        pinned?.primaryNodeId ?? null,
      );
      if (refusal !== null) {
        if (PASSED_THROUGH.has(refusal.code)) throw refusal;
        throw new AppError("handover.old_box_data_unavailable", {}, { reason: refusal.code });
      }
      if ((await readResetOrderFor(deps.node, deps.nodeId, targetNodeId)) !== null)
        throw new AppError("handover.old_box_data_wipe_ordered", {});
      const contactUrl = chart!.body.nodes.find((n) => n.nodeId === targetNodeId)?.contactUrl;
      if (!contactUrl)
        throw new AppError("handover.old_box_unreachable", {}, { reason: "address" });

      const release = turn.take();
      if (release === null) throw new AppError("handover.old_box_data_busy", {});
      try {
        return await askAndAnswer(contactUrl);
      } finally {
        release();
      }

      async function askAndAnswer(address: string) {
        const holdings = await readHoldings(deps.db, deps.modules);
        const copy = await emergencyCopyFrom(deps.db, targetNodeId);
        const venue = await returnVenue(deps);
        const nonce = randomUUID();
        const signed = JSON.stringify(
          await signAsThisBox(deps, "old-box-data-query", {
            venue,
            sourceNodeId: deps.nodeId,
            destinationNodeId: targetNodeId,
            nonce,
            sentAtMs: (deps.now?.() ?? new Date()).getTime(),
            language: toLanguage(locale),
            holdings,
            ...(copy === null ? {} : { lastChangeAtMs: copy.lastChangeAtMs }),
          }),
        );
        const authority =
          deps.stateDir === undefined ? undefined : await readVenueAuthority(deps.stateDir);
        let answer: Awaited<ReturnType<typeof postToBox>>;
        try {
          answer = await post(
            {
              fetch: deps.fetch,
              authorityOf: () => authority,
              lookup: deps.lookup,
              timeoutMs: deps.timeoutMs ?? ASK_FOR_MS,
            },
            targetNodeId,
            `${trimTrailingSlashes(address)}/api/node/old-box-data`,
            signed,
            { maxBytes: MAX_ANSWER_BYTES },
          );
        } catch (error) {
          if (error instanceof AnswerTooLarge)
            throw new AppError("handover.old_box_data_too_large", {});
          if (isSilenceAfterConnecting(error)) refused("silent");
          throw new AppError(
            "handover.old_box_unreachable",
            {},
            {
              reason:
                firstCodeInCauseChain(error, (code) => /^[A-Z][A-Z0-9_]*$/.test(code)) ??
                (error instanceof Error ? error.constructor.name : typeof error),
            },
          );
        }
        if (isOldBoxBusy(answer.status, answer.text))
          throw new AppError("handover.old_box_data_busy", {});
        if (answer.status !== 200) refused(statusReason(answer.status, answer.text));
        let whole: unknown;
        try {
          whole = JSON.parse(answer.text);
        } catch {
          refused("answer");
        }
        if (!isRecord(whole)) return refused("answer");
        const checked = checkedPeerAnswer(
          JSON.stringify(whole.envelope ?? null),
          "old-box-data",
          await peerKeyOf(deps, chart),
          targetNodeId,
          nonce,
        );
        if (!checked.ok) return refused(checked.check);
        const { sourceNodeId, madeOn, counts: rawCounts, sha256 } = checked.body;
        if (sourceNodeId !== deps.nodeId) refused("binding");
        const counts = countsIn(rawCounts);
        if (
          typeof madeOn !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(madeOn) ||
          counts === null ||
          !isSha256Hex(sha256)
        )
          refused("answer");
        const { workbook } = whole;
        if (
          typeof workbook !== "string" ||
          workbook.length % 4 !== 0 ||
          !BASE64_CHARACTERS.test(workbook)
        )
          refused("workbook");
        const bytes = Buffer.from(workbook as string, "base64");
        // An .xlsx is a zip; this also refuses an empty file.
        if (
          sha256Hex(bytes) !== sha256 ||
          !bytes.subarray(0, ZIP_SIGNATURE.byteLength).equals(ZIP_SIGNATURE)
        )
          refused("workbook");

        // Under node.db's lock, which `orderReset` takes to record an order.
        const recorded = await withNodeTransaction(deps.node, async (nodeTx) => {
          if (c.req.raw.signal.aborted) return false;
          if ((await readResetOrderFor(nodeTx, deps.nodeId, targetNodeId)) !== null)
            throw new AppError("handover.old_box_data_wipe_ordered", {});
          await withTransaction(deps.db, (tx) =>
            recordActivity(tx, {
              kind: "handover.old_box_data_downloaded",
              subjectId: targetNodeId,
              personId,
              data: counts!,
            }),
          );
          return true;
        });
        if (!recorded) return new Response(null, { status: 499 });
        log("info", "handover.old_box_data_downloaded", {
          nodeId: targetNodeId,
          personId,
          bytes: bytes.byteLength,
          requestId: c.get("requestId"),
        });
        return c.body(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          200,
          workbookDownloadHeaders(`waitron-old-main-box-${madeOn as string}.xlsx`),
        );
      }
    }),
  );
}
