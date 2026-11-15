import { writeNodeMembership } from "@waitron/db";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type MembershipNode,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";

/**
 * A signed membership document at `term`, signed by `signerNodeId` (default "A") with a generated —
 * or caller-supplied — node identity key. `nodes` defaults to a single serving-primary entry for the
 * signer. Pass `keyPair` when the caller also builds a `TrustSet` for the same key. `revoked` is
 * written into the body only when given.
 */
export function signedMembershipDoc(
  term: number,
  opts: {
    signerNodeId?: string;
    keyPair?: NodeKeyPair;
    nodes?: readonly MembershipNode[];
    revoked?: readonly string[];
  } = {},
): SignedMembershipDocument {
  const keyPair = opts.keyPair ?? generateNodeKeyPair();
  const signerNodeId = opts.signerNodeId ?? "A";
  const nodes = opts.nodes ?? [
    { nodeId: signerNodeId, contactUrl: "https://a", standing: "serving-primary" },
  ];
  const body: MembershipDocumentBody =
    opts.revoked === undefined ? { term, nodes } : { term, nodes, revoked: opts.revoked };
  return {
    body,
    signerNodeId,
    signature: signDocumentBody(body, keyPair.privateKey),
    endorsements: [],
  };
}

/** Holds a chart naming `main` the serving primary and `spare` its serving secondary. */
export async function holdChartNamingMainBox(
  db: Parameters<typeof writeNodeMembership>[0],
  main: { nodeId: string; contactUrl: string },
  spare: { nodeId: string; contactUrl: string },
): Promise<void> {
  await writeNodeMembership(
    db,
    signedMembershipDoc(1, {
      signerNodeId: main.nodeId,
      nodes: [
        { ...main, standing: "serving-primary" },
        { ...spare, standing: "serving-secondary" },
      ],
    }),
  );
}
