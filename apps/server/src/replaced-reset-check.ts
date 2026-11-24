import { readNodeMembership } from "@waitron/db";
import {
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type CanonicalValue,
} from "@waitron/membership";
import { readHandoverRestriction } from "@waitron/node-db";
import { checkedPeerAnswer, mainBoxToAsk } from "./main-box-answer.js";
import { peerKeyOf } from "./handover-signing.js";
import type { HeardCopy } from "./old-box-holdings.js";
import { usableCopyTime } from "./old-box-data-since.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { readReturnInventory, returnConfirmed, type ReturnRecordsDeps } from "./return-records.js";

export type ReplacedResetCheck =
  | {
      outcome: "ordered";
      targetNodeId: string;
      orderId: string;
      acceptLoss: boolean;
      setAside: boolean;
      lacking: Record<string, CanonicalValue[]>;
      holdings?: Record<string, CanonicalValue>;
      copy?: HeardCopy;
    }
  | {
      outcome: "no-order";
      lacking: Record<string, CanonicalValue[]>;
      /** The main box's own summary; absent when it sent none or sent something else. */
      holdings?: Record<string, CanonicalValue>;
      /** The copy's latest sale or order time; absent when the main box sent none or something else. */
      copy?: HeardCopy;
    }
  /** The main box answered `handover.reset_query_refused`. */
  | { outcome: "refused"; reason: unknown }
  /** A verified order this box may not act on while its own return is unconfirmed. */
  | {
      outcome: "failed";
      check: "unconfirmed";
      holdings?: Record<string, CanonicalValue>;
      copy?: HeardCopy;
    }
  | {
      outcome: "failed";
      check:
        | "restriction"
        | "standing"
        | "target"
        | "answer"
        | "signature"
        | "signer"
        | "nonce"
        | "source";
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** On the replaced box, before anything is saved: may it reset as the main box's answer orders? */
export async function replacedResetCheck(
  deps: Pick<ReturnRecordsDeps, "db" | "node" | "ring" | "nodeId" | "modules">,
  sent: { targetNodeId: string; nonce: string; answer: { status: number; text: string } },
): Promise<ReplacedResetCheck> {
  const failed = (
    check: Exclude<Extract<ReplacedResetCheck, { outcome: "failed" }>["check"], "unconfirmed">,
  ) => ({ outcome: "failed", check }) as const;
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  if (restriction === null) return failed("restriction");
  const { target } = mainBoxToAsk(deps.nodeId, chart, restriction);
  if (!target || !chart || target.nodeId !== sent.targetNodeId) return failed("target");
  // A chart naming this box main sends it to the box its restriction names (`mainBoxToAsk`).
  if (
    !isFencedStanding(standingOf(chart, deps.nodeId)) &&
    servingPrimaryNodeId(chart) !== deps.nodeId
  )
    return failed("standing");

  const { status, text } = sent.answer;
  if (status !== 200) {
    let refusal: unknown;
    try {
      refusal = JSON.parse(text);
    } catch {
      return failed("answer");
    }
    const error = isRecord(refusal) && isRecord(refusal.error) ? refusal.error : null;
    if (status === 409 && error?.code === "handover.reset_query_refused")
      return { outcome: "refused", reason: isRecord(error.params) ? error.params.reason : null };
    return failed("answer");
  }
  const checked = checkedPeerAnswer(
    text,
    "reset-order",
    await peerKeyOf(deps, chart),
    target.nodeId,
    sent.nonce,
  );
  if (!checked.ok) return failed(checked.check);
  const { sourceNodeId, order, lacking, holdings, lastChangeAtMs } = checked.body;
  if (sourceNodeId !== deps.nodeId) return failed("source");
  if (
    !isRecord(lacking) ||
    !Object.values(lacking).every(Array.isArray) ||
    (order !== null &&
      !(
        isRecord(order) &&
        typeof order.orderId === "string" &&
        typeof order.acceptLoss === "boolean"
      ))
  )
    return failed("answer");
  const lackingChains = lacking as Record<string, CanonicalValue[]>;
  const heard = {
    ...(isRecord(holdings) ? { holdings: holdings as Record<string, CanonicalValue> } : {}),
    ...(lastChangeAtMs === null || usableCopyTime(lastChangeAtMs)
      ? { copy: { lastChangeAtMs } }
      : {}),
  };
  if (order === null) return { outcome: "no-order", lacking: lackingChains, ...heard };

  const acceptLoss = order.acceptLoss as boolean;
  if (!acceptLoss) {
    const { inventory } = await readReturnInventory(deps);
    if (!(await returnConfirmed(deps, restriction.operationId, inventory)))
      return { outcome: "failed", check: "unconfirmed", ...heard };
  }
  return {
    outcome: "ordered",
    targetNodeId: target.nodeId,
    orderId: order.orderId as string,
    acceptLoss,
    setAside: acceptLoss || Object.values(lackingChains).some((chains) => chains.length > 0),
    lacking: lackingChains,
    ...heard,
  };
}
