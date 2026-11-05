import type { SignedMembershipDocument } from "@waitron/membership";
import { isReadableChart } from "./membership-trust.js";

/**
 * Whether a held chart still has this operation's source as the main box, the one being replaced.
 * Any other chart means the venue has moved on since the operation began, and promoting here would
 * mint a chart over whichever box it names.
 */
export function oldBoxStillMain(
  held: SignedMembershipDocument | null,
  sourceNodeId: string,
): boolean {
  return (
    held?.body.nodes.find((node) => node.nodeId === sourceNodeId)?.standing === "serving-primary"
  );
}

/**
 * Whether a stored document says the venue has moved on from this source, for the step that places
 * the accepted copy. No chart, or one too broken to read, says nothing, so placing goes on: the old
 * box has already given up filing. Placing and the duty's asking for its restart both judge by this,
 * as a difference between them restarts the box for ever or leaves it on its old file for good.
 */
export function movedOnFromSource(document: unknown, sourceNodeId: string): boolean {
  return (
    document !== null &&
    isReadableChart(document) &&
    !oldBoxStillMain(document as SignedMembershipDocument, sourceNodeId)
  );
}
