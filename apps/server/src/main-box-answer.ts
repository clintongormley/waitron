import { verifyEnvelope, type HandoverKind } from "@waitron/handover";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { HandoverRestriction } from "@waitron/node-db";

type ChartNode = SignedMembershipDocument["body"]["nodes"][number];

/** The main box a replaced box returns its records to and asks for its reset order. */
export function mainBoxToAsk(
  nodeId: string,
  chart: SignedMembershipDocument | null,
  restriction: HandoverRestriction | null,
): { target: ChartNode | undefined; fromRestriction: boolean } {
  const servingPrimary = chart?.body.nodes.find((row) => row.standing === "serving-primary");
  // A stepped-down box may hold a chart that still names it main: its restriction names the box
  // the return goes to until a newer chart arrives.
  const fromRestriction = !servingPrimary || servingPrimary.nodeId === nodeId;
  const targetId = fromRestriction ? restriction?.successorNodeId : servingPrimary.nodeId;
  const target = chart?.body.nodes.find((row) => row.nodeId === targetId);
  return {
    target: target && target.nodeId !== nodeId && target.contactUrl ? target : undefined,
    fromRestriction,
  };
}

/** A peer's answer, verified as signed by `signerNodeId` and bound to the `nonce` sent. */
export function checkedPeerAnswer(
  text: string,
  kind: HandoverKind,
  keyOf: (nodeId: string) => string | undefined,
  signerNodeId: string,
  nonce: string,
):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; check: "signature" | "signer" | "nonce" } {
  let verified;
  try {
    verified = verifyEnvelope<Record<string, unknown>>(JSON.parse(text), kind, keyOf);
  } catch {
    return { ok: false, check: "signature" };
  }
  if (!verified.valid) return { ok: false, check: "signature" };
  if (verified.signerNodeId !== signerNodeId) return { ok: false, check: "signer" };
  if (verified.body?.nonce !== nonce) return { ok: false, check: "nonce" };
  return { ok: true, body: verified.body };
}
