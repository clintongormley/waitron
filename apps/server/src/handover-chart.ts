import type { SignedMembershipDocument } from "@waitron/membership";

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
