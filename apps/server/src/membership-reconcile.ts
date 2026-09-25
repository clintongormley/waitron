import type { AcceptResult, SignedMembershipDocument } from "@waitron/membership";
import { isFenced } from "./membership-fence.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * `held` is `null` before this node has ever adopted a chart. `acceptDocument` verifies (signature +
 * trust chain, then strictly newer than `currentTerm`) and, when it accepts, PERSISTS the document — so
 * `{ accepted: true }` means the newer chart is now the held one.
 */
export interface ReconcileMembershipDeps {
  held: SignedMembershipDocument | null;
  nodeId: string;
  peerUrl: string;
  fetchPeerMembership: (url: string) => Promise<SignedMembershipDocument | null>;
  acceptDocument: (
    incoming: SignedMembershipDocument,
    currentTerm: number | null,
  ) => Promise<AcceptResult>;
  log: Logger;
}

/**
 * A returned box asks its cloud peer for the current signed chart. Only a chart that verifies, is
 * strictly newer, and fences this node reports `{ superseded: true }`. A fenced boot is a state, not a
 * crash: it logs and returns rather than throwing.
 */
export async function reconcileMembershipOnBoot(
  deps: ReconcileMembershipDeps,
): Promise<{ superseded: boolean }> {
  // Unreachable → proceed (Ruling C7): a box cannot have been superseded without a reachable cloud AND a
  // human promotion — the MVP's accepted window.
  const peer = await deps.fetchPeerMembership(deps.peerUrl);
  if (peer === null) return { superseded: false };

  const result = await deps.acceptDocument(peer, deps.held?.body.term ?? null);
  if (!result.accepted) return { superseded: false };

  // A newer chart that leaves this node serving is held, and this node keeps selling.
  if (!isFenced(peer, deps.nodeId)) return { superseded: false };

  deps.log("warn", "node.membership_superseded_on_boot", {});
  return { superseded: true };
}

/**
 * Answers `null` for a transport error, a non-2xx response, an unparseable body or a peer holding no
 * chart, so "unreachable → proceed" holds. The returned document is UNVERIFIED; `acceptDocument` is the
 * fence.
 */
export async function fetchPeerMembershipDocument(
  url: string,
  headers: Record<string, string> = {},
): Promise<SignedMembershipDocument | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body: { document?: SignedMembershipDocument | null };
  try {
    body = (await res.json()) as { document?: SignedMembershipDocument | null };
  } catch {
    return null;
  }
  return body.document ?? null;
}
