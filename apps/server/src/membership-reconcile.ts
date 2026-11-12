import type { AcceptResult, SignedMembershipDocument } from "@waitron/membership";
import { isFenced } from "./membership-fence.js";
import { boxExchange } from "./mirror-bundle-fetch.js";
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
 * A returned box asks the box its mirror link names for the current signed chart. Only a chart that verifies, is
 * strictly newer, and fences this node reports `{ superseded: true }`. A fenced boot is a state, not a
 * crash: it logs and returns rather than throwing.
 */
export async function reconcileMembershipOnBoot(
  deps: ReconcileMembershipDeps,
): Promise<{ superseded: boolean }> {
  // Unreachable → proceed (Ruling C7).
  const peer = await deps.fetchPeerMembership(deps.peerUrl);
  if (peer === null) return { superseded: false };

  const result = await deps.acceptDocument(peer, deps.held?.body.term ?? null);
  if (!result.accepted) {
    // `signer_removed` has a cost: a standby `judgeRemoval` (`membership-removal.ts`) misjudged as
    // never-joined and an operator later promoted signs charts this node refuses, so this node keeps
    // selling beside it. No adopt can finish today (`finish-adoption.ts`), so no such standby exists
    // yet. Logged so the refusal is visible; no alert is raised.
    if (result.reason === "invalid") {
      deps.log("warn", "node.membership_refused_on_boot", { failure: result.failure });
    }
    return { superseded: false };
  }

  // A newer chart that leaves this node serving is held, and this node keeps selling.
  if (!isFenced(peer, deps.nodeId)) return { superseded: false };

  deps.log("warn", "node.membership_superseded_on_boot", {});
  return { superseded: true };
}

/**
 * Answers `null` for a transport error, a refused certificate, no answer within `timeoutMs`, a
 * non-2xx response, an unparseable body or a peer holding no chart, so "unreachable → proceed"
 * holds. An https peer is asked only under `authority`, this box's venue authority. The returned
 * document is UNVERIFIED; `acceptDocument` is the fence.
 */
export async function fetchPeerMembershipDocument(
  url: string,
  { authority, timeoutMs }: { authority?: string; timeoutMs: number },
): Promise<SignedMembershipDocument | null> {
  const target = new URL(url);
  if (target.protocol === "https:" && authority === undefined) return null;
  let res: { status: number; text: string };
  try {
    res = await boxExchange(target, {
      method: "GET",
      trust: { ca: authority, rejectUnauthorized: true },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (res.status < 200 || res.status > 299) return null;
  let body: { document?: SignedMembershipDocument | null } | null;
  try {
    body = JSON.parse(res.text) as { document?: SignedMembershipDocument | null } | null;
  } catch {
    return null;
  }
  return body?.document ?? null;
}
