import { randomBytes } from "node:crypto";
import {
  HANDOVER_STATES,
  verifyEnvelope,
  type HandoverState,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  acceptMembershipDocument,
  isFencedStanding,
  isMembershipDocument,
  standingOf,
  type AcceptResult,
  type CanonicalValue,
  type NodeStanding,
  type RoutableServer,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import type { PeerOperationStatus, PeerQueryBody, PeerStatusBody } from "./peer-status-api.js";

export type StartCheckResult = "proceed" | "superseded" | "wait";

/**
 * The caller runs this only on a box whose mode is not `mirror`: a mirror files nothing, so it
 * has nothing to wait for.
 */
export interface CheckPeersDeps {
  held: SignedMembershipDocument | null;
  nodeId: string;
  ownOrigin: string;
  /** Whether this box's venue.db holds a `nodes` row with that id: the box finished joining. */
  joined: (nodeId: string) => Promise<boolean>;
  /** The source of every operation this box activated as destination, open or closed. */
  activatedFrom: ReadonlySet<string>;
  /** A verified status, or `null` for any refusal, error or answer that does not verify. */
  ask: (peer: RoutableServer) => Promise<PeerStatusBody | null>;
  /**
   * Verifies the chart and, when it is newer than the one held, PERSISTS it: `accepted: true`
   * means it is now the held chart (`persistingAccept` builds the real one).
   */
  accept: (doc: SignedMembershipDocument) => Promise<AcceptResult>;
  /** An open operation in which this box is the source. */
  openOperation: boolean;
  timeoutMs?: number;
}

type Answer = "F" | "N" | "=" | "S";

const ROUTABLE: readonly NodeStanding[] = ["serving-primary", "serving-secondary", "sell-only"];

const DEFAULT_TIMEOUT_MS = 5000;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/**
 * A destination's open states past the point where its source could still be selling safely:
 * `copy_accepted` or later for a controlled operation, `emergency_declared` or later for an
 * emergency one (`packages/handover/src/states.ts`'s destination steps).
 */
const FENCING_STATES: Readonly<Record<"controlled" | "emergency", readonly HandoverState[]>> = {
  controlled: ["copy_accepted", "filing_assumed", "activated", "return_pending"],
  emergency: ["emergency_declared", "activated", "return_pending"],
};

function operationFences(op: PeerOperationStatus | null, nodeId: string): boolean {
  if (!isOperationStatus(op) || op === null) return false;
  if (op.role !== "destination" || op.sourceNodeId !== nodeId) return false;
  return FENCING_STATES[op.scenario].includes(op.state);
}

/**
 * The decision a returning box makes before it sells or files: ask the boxes its held chart lists,
 * then `proceed`, `superseded` (a newer chart or a peer's operation says another box took over) or
 * `wait` (no box that finished joining answered).
 */
export async function checkPeersAtStart(deps: CheckPeersDeps): Promise<StartCheckResult> {
  const { held, nodeId } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ownOrigin = originOf(deps.ownOrigin);

  const peers: { server: RoutableServer; counted: boolean }[] = [];
  for (const n of held?.body.nodes ?? []) {
    if (n.nodeId === nodeId) continue;
    const standing = standingOf(held!, n.nodeId);
    if (standing === undefined || !ROUTABLE.includes(standing)) continue;
    const server: RoutableServer = { nodeId: n.nodeId, url: n.contactUrl, standing };
    if (deps.activatedFrom.has(n.nodeId)) peers.push({ server, counted: false });
    else if (await deps.joined(n.nodeId)) peers.push({ server, counted: true });
  }

  const statuses = await Promise.all(
    peers.map(({ server }) =>
      server.url === "" || originOf(server.url) === ownOrigin
        ? Promise.resolve(null)
        : withTimeout(deps.ask(server), timeoutMs),
    ),
  );

  // Newest first, so an older chart that is still newer than the held one is judged against the
  // newest already persisted, never in place of it.
  const verdicts = new Map<number, AcceptResult>();
  const charted = statuses
    .map((status, index) => ({ chart: status?.heldMembership ?? null, index }))
    .filter((c): c is { chart: SignedMembershipDocument; index: number } =>
      isMembershipDocument(c.chart),
    )
    .sort((a, b) => b.chart.body.term - a.chart.body.term);
  for (const { chart, index } of charted) verdicts.set(index, await deps.accept(chart));

  const answers: { answer: Answer; counted: boolean }[] = statuses.map((status, index) => {
    const counted = peers[index]!.counted;
    if (status === null) return { answer: "S", counted };
    // Read from the signed status itself, whatever its chart: stopping is the safe side.
    if (operationFences(status.openOperation, nodeId)) return { answer: "F", counted };
    const verdict = verdicts.get(index);
    if (verdict?.accepted === true && isFencedStanding(standingOf(verdict.document, nodeId)))
      return { answer: "F", counted };
    // A part this box cannot read may report a takeover, so it cannot clear a wait. Nor can no
    // chart, or one this box cannot trust: neither vouches that no handover happened.
    if (!partsReadable(status) || verdict === undefined) return { answer: "S", counted };
    if (verdict.accepted) return { answer: "N", counted };
    return { answer: verdict.reason === "invalid" ? "S" : "=", counted };
  });

  if (answers.some((a) => a.answer === "F")) return "superseded";
  if (deps.openOperation) return "wait";
  const counted = answers.filter((a) => a.counted);
  if (counted.length === 0) return "proceed";
  if (counted.some((a) => a.answer === "N" || a.answer === "=")) return "proceed";
  return "wait";
}

/**
 * The real `accept`: verify against the stored trust set, judged against the chart held before
 * the check (a retirement chart is signed by the node it evicts), then `persist` — which saves
 * only a chart strictly newer than the one held at that moment, so a `false` is `not_newer`.
 */
export function persistingAccept(deps: {
  held: SignedMembershipDocument | null;
  trustSet: TrustSet;
  persist: (doc: SignedMembershipDocument) => Promise<boolean>;
}): (doc: SignedMembershipDocument) => Promise<AcceptResult> {
  return async (doc) => {
    const verdict = acceptMembershipDocument(
      doc,
      deps.held?.body.term ?? null,
      deps.trustSet,
      deps.held,
    );
    if (!verdict.accepted) return verdict;
    return (await deps.persist(doc)) ? verdict : { accepted: false, reason: "not_newer" };
  };
}

export interface AskPeerStatusDeps {
  /** Signs a query envelope with this box's node key (`signAsThisBox(deps, "query", body)`). */
  sign: (body: PeerQueryBody & CanonicalValue) => Promise<SignedHandoverEnvelope<unknown>>;
  /** The key this box stores for a node or its held chart vouches for (`peerKeyOf`). */
  publicKeyOf: (nodeId: string) => string | undefined;
  fetch?: typeof fetch;
  nonce?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationStatus(value: unknown): value is PeerOperationStatus | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    typeof value.operationId === "string" &&
    (value.role === "source" || value.role === "destination") &&
    (value.scenario === "controlled" || value.scenario === "emergency") &&
    (HANDOVER_STATES as readonly unknown[]).includes(value.state) &&
    typeof value.sourceNodeId === "string" &&
    typeof value.destinationNodeId === "string"
  );
}

function isRestriction(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    (value.kind === "handed-over" || value.kind === "superseded") &&
    typeof value.successorNodeId === "string" &&
    (value.operationId === null || typeof value.operationId === "string")
  );
}

/** The chart is judged on its own (`isMembershipDocument`); these are the status's other parts. */
function partsReadable(status: PeerStatusBody): boolean {
  return (
    isOperationStatus(status.openOperation) &&
    isOperationStatus(status.requestedOperation) &&
    isRestriction(status.restriction)
  );
}

/**
 * The real `ask`: POST a signed query to the peer's `/api/node/peer-status` and keep the answer
 * only when it is signed as a status by the box asked, under a key this box trusts, and echoes
 * the query's nonce. Every other outcome is `null`.
 */
export function askPeerStatus(
  deps: AskPeerStatusDeps,
): (peer: RoutableServer) => Promise<PeerStatusBody | null> {
  const fetchFn = deps.fetch ?? fetch;
  const nonceOf = deps.nonce ?? (() => randomBytes(16).toString("hex"));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (peer) => {
    const nonce = nonceOf();
    try {
      const query = await deps.sign({ nonce, atMs: now() });
      const res = await fetchFn(`${peer.url.replace(/\/+$/, "")}/api/node/peer-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const verdict = verifyEnvelope<unknown>(await res.json(), "status", deps.publicKeyOf);
      if (!verdict.valid || verdict.signerNodeId !== peer.nodeId) return null;
      // Passed on whole: `checkPeersAtStart` judges each part, so an unreadable one cannot hide
      // what a readable one says.
      return isRecord(verdict.body) && verdict.body.nonce === nonce
        ? (verdict.body as unknown as PeerStatusBody)
        : null;
    } catch {
      return null;
    }
  };
}
