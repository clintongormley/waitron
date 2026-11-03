import { randomBytes } from "node:crypto";
import {
  HANDOVER_STATES,
  initialState,
  nextState,
  verifyEnvelope,
  type HandoverRole,
  type HandoverScenario,
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
import { boxExchange } from "./mirror-bundle-fetch.js";
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
  /** Handed every asked peer's answer, in the held chart's order, before the result is decided. */
  onAnswers?: (answers: readonly PeerAnswer[]) => void;
}

export type Answer = "F" | "N" | "=" | "S";

export interface PeerAnswer {
  nodeId: string;
  answer: Answer;
  counted: boolean;
  /** An F read from the peer's operation naming this box as its source, not from a chart. */
  byOperation: boolean;
  /** For an S only: why the answer counts as silent. */
  why?: SilentWhy;
}

export type SilentWhy =
  | "no_address"
  | "own_address"
  | "timed_out"
  | "no_answer"
  | "unreadable_part"
  | "no_chart"
  | "untrusted_chart";

const ROUTABLE: readonly NodeStanding[] = ["serving-primary", "serving-secondary", "sell-only"];

const DEFAULT_TIMEOUT_MS = 5000;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timed_out"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
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

  const why = new Map<number, SilentWhy>();
  const statuses = await Promise.all(
    peers.map(async ({ server }, index) => {
      const unasked: SilentWhy | null =
        server.url === ""
          ? "no_address"
          : originOf(server.url) === ownOrigin
            ? "own_address"
            : null;
      const status =
        unasked ??
        (await withTimeout(
          deps.ask(server).catch(() => null),
          timeoutMs,
        ));
      if (status === null) why.set(index, "no_answer");
      else if (typeof status === "string") why.set(index, status);
      return typeof status === "string" ? null : status;
    }),
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

  const answers: PeerAnswer[] = statuses.map((status, index) => {
    const { server, counted } = peers[index]!;
    const of = (answer: Answer, byOperation = false): PeerAnswer => ({
      nodeId: server.nodeId,
      answer,
      counted,
      byOperation,
    });
    const silent = (reason: SilentWhy): PeerAnswer => ({ ...of("S"), why: reason });
    if (status === null) return silent(why.get(index)!);
    // Read from the signed status itself, whatever its chart: stopping is the safe side.
    if (operationFences(status.openOperation, nodeId)) return of("F", true);
    const verdict = verdicts.get(index);
    if (verdict?.accepted === true && isFencedStanding(standingOf(verdict.document, nodeId)))
      return of("F");
    // A part this box cannot read may report a takeover, so it cannot clear a wait. Nor can no
    // chart, or one this box cannot trust: neither vouches that no handover happened.
    if (!partsReadable(status)) return silent("unreadable_part");
    if (verdict === undefined) return silent("no_chart");
    if (verdict.accepted) return of("N");
    return verdict.reason === "invalid" ? silent("untrusted_chart") : of("=");
  });
  deps.onAnswers?.(answers);

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

/** Why an ask has no answer to judge; logged by node id, never with the answer's contents. */
export type SilentReason =
  "unreachable" | "refused" | "not_json" | "not_verified" | "wrong_signer" | "wrong_nonce";

export interface AskPeerStatusDeps {
  /** Signs a query envelope with this box's node key (`signAsThisBox(deps, "query", body)`). */
  sign: (body: PeerQueryBody & CanonicalValue) => Promise<SignedHandoverEnvelope<unknown>>;
  /** The key this box stores for a node or its held chart vouches for (`peerKeyOf`). */
  publicKeyOf: (nodeId: string) => string | undefined;
  /** The authority certificate this box holds for a peer; pinned when there is one. */
  authorityOf?: (nodeId: string) => string | undefined;
  /** Replaces the box transport. */
  fetch?: typeof fetch;
  onSilent?: (nodeId: string, reason: SilentReason) => void;
  nonce?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

// A status holds at most one chart and two operations; anything far larger is not one.
const MAX_STATUS_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a box in `role` can ever hold `state` in this scenario (`nextState`'s steps). */
function stateFits(role: HandoverRole, scenario: HandoverScenario, state: HandoverState): boolean {
  if (initialState(role, scenario) === state) return true;
  return HANDOVER_STATES.some((from) => {
    try {
      nextState(role, scenario, from, state);
      return true;
    } catch {
      return false;
    }
  });
}

function isOperationStatus(value: unknown): value is PeerOperationStatus | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    typeof value.operationId === "string" &&
    (value.role === "source" || value.role === "destination") &&
    (value.scenario === "controlled" || value.scenario === "emergency") &&
    (HANDOVER_STATES as readonly unknown[]).includes(value.state) &&
    stateFits(value.role, value.scenario, value.state as HandoverState) &&
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
  const nonceOf = deps.nonce ?? (() => randomBytes(16).toString("hex"));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const post = async (peer: RoutableServer, url: string, body: string) => {
    const signal = AbortSignal.timeout(timeoutMs);
    if (deps.fetch !== undefined) {
      const res = await deps.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
      });
      return { status: res.status, text: await res.text() };
    }
    const ca = deps.authorityOf?.(peer.nodeId);
    return boxExchange(
      new URL(url),
      {
        method: "POST",
        // Unchecked without a pinned authority: the answer counts only once its signed envelope
        // verifies and echoes this query's nonce, and the query carries no credential.
        trust: ca === undefined ? { rejectUnauthorized: false } : { ca, rejectUnauthorized: true },
        signal,
        body,
      },
      MAX_STATUS_BYTES,
    );
  };
  return async (peer) => {
    const silent = (reason: SilentReason) => {
      deps.onSilent?.(peer.nodeId, reason);
      return null;
    };
    const nonce = nonceOf();
    let answer: { status: number; text: string };
    try {
      const query = await deps.sign({ nonce, atMs: now() });
      answer = await post(
        peer,
        `${peer.url.replace(/\/+$/, "")}/api/node/peer-status`,
        JSON.stringify(query),
      );
    } catch {
      return silent("unreachable");
    }
    if (answer.status < 200 || answer.status > 299) return silent("refused");
    let raw: unknown;
    try {
      raw = JSON.parse(answer.text);
    } catch {
      return silent("not_json");
    }
    const verdict = verifyEnvelope<unknown>(raw, "status", deps.publicKeyOf);
    if (!verdict.valid) return silent("not_verified");
    if (verdict.signerNodeId !== peer.nodeId) return silent("wrong_signer");
    // Passed on whole: `checkPeersAtStart` judges each part, so an unreadable one cannot hide
    // what a readable one says.
    if (!isRecord(verdict.body) || verdict.body.nonce !== nonce) return silent("wrong_nonce");
    return verdict.body as unknown as PeerStatusBody;
  };
}
