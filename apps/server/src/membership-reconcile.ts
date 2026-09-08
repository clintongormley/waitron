import type { AcceptResult, SignedMembershipDocument } from "@waitron/membership";
import { isFenced } from "./membership-fence.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * Everything the boot-time membership reconciliation needs, all injected so the fence LOGIC is decoupled
 * from the transport and the database (Ruling C7). `held` is this node's currently-held chart (`null`
 * before it has ever adopted one) — its `term` is the accept fence's `currentTerm`. `nodeId` is this
 * node's own id, the one whose standing decides whether the peer's chart fences US. `peerUrl` addresses
 * the cloud peer; `fetchPeerMembership` performs the BEST-EFFORT read (it swallows its own transport
 * faults and returns `null` for unreachable / non-2xx / unparseable — this function never sees a throw
 * from it). `acceptDocument` runs the REAL two-part accept fence (`acceptMembershipDocument`: signature +
 * trust chain, then strictly-newer against `currentTerm`) and, when it accepts, PERSISTS the document —
 * so a `{ accepted: true }` here means the newer chart is now the held one.
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
 * Boot-time returned-box membership reconciliation (Ruling C7 — the replacement for the deleted gossip).
 * A node booting as primary best-effort fetches its cloud peer's current signed chart; a chart that
 * VERIFIES, is strictly NEWER, and FENCES this node is persisted and reported `{ superseded: true }`, so
 * the caller boots read-only and the superseded box cannot sell. Every other outcome — the peer is
 * unreachable, the chart is not strictly newer, it does not verify, or it is newer but leaves this node
 * serving — reports `{ superseded: false }` and boot proceeds as primary.
 *
 * A fenced boot is a STATE, not a crash: this LOGS `node.membership_superseded_on_boot` and returns,
 * never throws — the caller (boot) turns the flag into the same read-only posture a mirror or a
 * membership-rejoin-fenced node already runs (`fencedOrMirror` in boot.ts).
 */
export async function reconcileMembershipOnBoot(
  deps: ReconcileMembershipDeps,
): Promise<{ superseded: boolean }> {
  // Unreachable → proceed (Ruling C7): a box that cannot reach the cloud cannot have been superseded
  // without a reachable cloud AND a human promotion — the MVP's accepted window, closed the moment
  // connectivity returns. `fetchPeerMembership` is best-effort and returns `null` for every failure.
  const peer = await deps.fetchPeerMembership(deps.peerUrl);
  if (peer === null) return { superseded: false };

  // The two-part accept fence over the REAL document: authentic (signature + trust chain) AND strictly
  // newer than the held term. A not-newer or unverifiable chart is refused here — an equal/lower term or
  // a forged/untrusted signature can never send this node read-only.
  const result = await deps.acceptDocument(peer, deps.held?.body.term ?? null);
  if (!result.accepted) return { superseded: false };

  // Accepted (verified + newer, now persisted). Superseded only if the newer chart fences THIS node: a
  // newer chart that leaves this node serving (e.g. it merely admitted another member) is authoritative
  // and worth holding, but this node keeps selling.
  if (!isFenced(peer, deps.nodeId)) return { superseded: false };

  deps.log("warn", "node.membership_superseded_on_boot", {});
  return { superseded: true };
}

/**
 * The BEST-EFFORT HTTP read `reconcileMembershipOnBoot` injects as `fetchPeerMembership` at boot: GET the
 * peer's `GET /management-api/membership` (which answers `{ document }`) and hand back the signed chart,
 * or `null` for EVERY failure — a transport error reaching the peer, a non-2xx response, a body that does
 * not parse, or a peer that holds no chart yet (`document: null`). NEVER throws: Ruling C7's "unreachable
 * → proceed" rests on this swallowing its own faults, so a boot that cannot reach the cloud simply comes
 * up as primary. The returned document is UNVERIFIED — the caller's `acceptDocument` runs the signature +
 * trust-chain fence over it; this is transport, not the fence. `headers` carries the peer credential
 * (the mirror-bundle shape, JSON in `x-waitron-peer-credential`) when the box holds one.
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
