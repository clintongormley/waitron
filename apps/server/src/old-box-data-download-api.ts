import "./errors.js";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { persons, readNodeMembership, recordActivity, withTransaction } from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { readOpenHandoverOperation, readPinnedPrimaryKey } from "@waitron/node-db";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import {
  AppError,
  firstCodeInCauseChain,
  resolveActiveLocale,
  type SupportedLocale,
} from "@waitron/shared";
import {
  boxRefusal,
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
import { readHoldings } from "./old-box-holdings.js";
import { readResetOrderFor, resetRefusal } from "./reset-order.js";
import { returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";
import { workbookDownloadHeaders } from "./xlsx-workbook.js";

export interface OldBoxDataDownloadDeps extends ReturnRecordsDeps {
  venueLocale: SupportedLocale;
  fetch?: typeof fetch;
  post?: typeof postToBox;
  timeoutMs?: number;
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
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PEER_WORD = /^[a-z_.]{1,80}$/;

type Counts = { invoiceRows: number } & Partial<Record<string, number>>;

const refused = (reason: string): never => {
  throw new AppError("handover.old_box_data_refused", {}, { reason });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function countsIn(value: unknown): Counts | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.invoiceRows)) return null;
  const entries = Object.entries(value);
  return entries.every(
    ([key, n]) => COUNT_KEYS.has(key) && Number.isSafeInteger(n) && (n as number) >= 0,
  )
    ? (value as Counts)
    : null;
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
 * workbook its own page offers, and passes it to the browser. Only reads until the download is
 * recorded, and holds no transaction while the old box is asked.
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
    },
    "old_box_data.download_failed",
  );
  const post = deps.post ?? postToBox;

  app.post("/management-api/servers/:nodeId/old-box-data", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, locale } = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "node.manage",
        });
        await requireFreshManagementSignIn(tx, sessionId);
        const [person] = await tx
          .select({ locale: persons.locale })
          .from(persons)
          .where(eq(persons.id, authorizedBy));
        return { personId: authorizedBy, locale: person?.locale ?? null };
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
          language: resolveActiveLocale(locale, deps.venueLocale).startsWith("es-") ? "es" : "en",
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
          `${trimTrailingSlashes(contactUrl)}/api/node/old-box-data`,
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
      if (answer.status !== 200) refused(statusReason(answer.status, answer.text));
      const checked = checkedPeerAnswer(
        answer.text,
        "old-box-data",
        await peerKeyOf(deps, chart),
        targetNodeId,
        nonce,
      );
      if (!checked.ok) return refused(checked.check);
      const { sourceNodeId, madeOn, counts: rawCounts, workbook } = checked.body;
      if (sourceNodeId !== deps.nodeId) refused("binding");
      const counts = countsIn(rawCounts);
      if (typeof madeOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(madeOn) || counts === null)
        refused("answer");
      if (typeof workbook !== "string" || !BASE64.test(workbook)) refused("workbook");
      const bytes = Buffer.from(workbook as string, "base64");

      await withTransaction(deps.db, (tx) =>
        recordActivity(tx, {
          kind: "handover.old_box_data_downloaded",
          subjectId: targetNodeId,
          personId,
          data: counts!,
        }),
      );
      log("info", "old_box_data.downloaded", {
        nodeId: targetNodeId,
        personId,
        bytes: bytes.byteLength,
        requestId: c.get("requestId"),
      });
      return c.body(
        new Uint8Array(bytes),
        200,
        workbookDownloadHeaders(`waitron-old-main-box-${madeOn as string}.xlsx`),
      );
    }),
  );
}
