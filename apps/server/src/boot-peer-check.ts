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
  canonicalize,
  isFencedStanding,
  isMembershipDocument,
  servingPrimaryNodeId,
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
   * Verifies the chart against `held`, the chart held before the check, and persists it when it
   * also verifies against, and is newer than, the chart held at that moment. The verdict never depends on whether it was saved,
   * and `not_newer` is only ever a chart that verified (`persistingAccept` builds the real one).
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

export function originOf(url: string): string {
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

  // `sell-only` enters a chart only through a promotion (packages/membership/src/standings.ts:15),
  // and every promotion first requires the old box to be neutralised (promote.ts assertFenced).
  const ownPromotion =
    held !== null && held.signerNodeId === nodeId && standingOf(held, nodeId) === "serving-primary";
  const peers: { server: RoutableServer; counted: boolean }[] = [];
  for (const n of held?.body.nodes ?? []) {
    if (n.nodeId === nodeId) continue;
    const standing = standingOf(held!, n.nodeId);
    if (standing === undefined || !ROUTABLE.includes(standing)) continue;
    const server: RoutableServer = { nodeId: n.nodeId, url: n.contactUrl, standing };
    const demoted = ownPromotion && standing === "sell-only";
    if (demoted || deps.activatedFrom.has(n.nodeId)) peers.push({ server, counted: false });
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

  const fences = (chart: SignedMembershipDocument) => isFencedStanding(standingOf(chart, nodeId));
  // Newest first, and at one term a chart fencing this box first, so the chart saved is the newest
  // and, of two charts at that term, the one that stops this box.
  const verdicts = new Map<number, AcceptResult>();
  const charted = statuses
    .map((status, index) => ({ chart: status?.heldMembership ?? null, index }))
    .filter((c): c is { chart: SignedMembershipDocument; index: number } =>
      isMembershipDocument(c.chart),
    )
    .sort(
      (a, b) =>
        b.chart.body.term - a.chart.body.term || Number(fences(b.chart)) - Number(fences(a.chart)),
    );
  for (const { chart, index } of charted) verdicts.set(index, await deps.accept(chart));
  const heldTerm = held?.body.term ?? 0;
  let newest = heldTerm;
  for (const v of verdicts.values())
    if (v.accepted) newest = Math.max(newest, v.document.body.term);
  // A chart older than the newest verified one is overtaken by it, so it cannot stop this box. At
  // the held term, a verified chart with another body was minted for that term apart from the held
  // one; it is never saved, so it stops this box only when it names another box as serving primary.
  const decides = (verdict: AcceptResult, chart: SignedMembershipDocument) => {
    if (chart.body.term !== newest) return false;
    if (verdict.accepted) return true;
    const primary = servingPrimaryNodeId(chart);
    return (
      verdict.reason === "not_newer" &&
      primary !== undefined &&
      primary !== nodeId &&
      canonicalize(chart.body as unknown as CanonicalValue) !==
        canonicalize(held!.body as unknown as CanonicalValue)
    );
  };

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
    const chart = status.heldMembership!;
    if (verdict !== undefined && decides(verdict, chart) && fences(chart)) return of("F");
    // A part this box cannot read may report a takeover, so it cannot clear a wait. Nor can no
    // chart, or one this box cannot trust: neither vouches that no handover happened.
    if (!partsReadable(status)) return silent("unreadable_part");
    if (verdict === undefined) return silent("no_chart");
    if (verdict.accepted) return of(chart.body.term === newest ? "N" : "=");
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
 * the check (a retirement chart is signed by the node it evicts), then hand an accepted chart to
 * `persist`, which judges it again against what is held at that moment before it saves it.
 */
export function persistingAccept(deps: {
  held: SignedMembershipDocument | null;
  trustSet: TrustSet;
  persist: (doc: SignedMembershipDocument) => Promise<unknown>;
}): (doc: SignedMembershipDocument) => Promise<AcceptResult> {
  return async (doc) => {
    const verdict = acceptMembershipDocument(
      doc,
      deps.held?.body.term ?? null,
      deps.trustSet,
      deps.held,
    );
    if (verdict.accepted) await deps.persist(doc);
    return verdict;
  };
}

/** Why an ask has no answer to judge; logged by node id, never with the answer's contents. */
export type SilentReason =
  "unreachable" | "refused" | "not_json" | "not_verified" | "wrong_signer" | "wrong_nonce";

export interface AskPeerStatusDeps {
  /** Signs a query envelope with this box's node key (`signAsThisBox(deps, "query", body)`). */
  sign: (body: PeerQueryBody & CanonicalValue) => Promise<SignedHandoverEnvelope<unknown>>;
  /**
   * A key this box stores for that node or the held chart vouches for, from a node the held chart
   * neither evicts nor clears (`peerKeyOf`).
   */
  publicKeyOf: (nodeId: string) => string | undefined;
  /** The authority certificate this box holds for a peer; pinned when there is one. */
  authorityOf?: (nodeId: string) => string | undefined;
  /** Replaces the box transport. */
  fetch?: typeof fetch;
  onSilent?: (nodeId: string, reason: SilentReason) => void;
  nonce?: () => string;
  now?: () => number;
  timeoutMs?: number;
  /** The operation to read: its state comes back as `requestedOperation`. */
  query?: { operationId: string; purpose: "status" };
}

// A status holds at most one chart and two operations; anything far larger is not one.
const MAX_STATUS_BYTES = 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function isOperationStatus(value: unknown): value is PeerOperationStatus | null {
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

/** The code and params of a refusal another box answered, or `null` when `text` is not one. */
export function boxRefusal(text: string): { code: string; params: unknown } | null {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return null;
  }
  const error = isRecord(answer) ? answer.error : undefined;
  if (!isRecord(error) || typeof error.code !== "string") return null;
  return { code: error.code, params: error.params };
}

/** One signed exchange with another box, stopped at `timeoutMs`; a failure is thrown. */
export async function postToBox(
  deps: Pick<AskPeerStatusDeps, "fetch" | "authorityOf"> & { timeoutMs: number },
  nodeId: string,
  url: string,
  body: string,
): Promise<{ status: number; text: string }> {
  const signal = AbortSignal.timeout(deps.timeoutMs);
  if (deps.fetch !== undefined) {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
    });
    return { status: res.status, text: await res.text() };
  }
  const ca = deps.authorityOf?.(nodeId);
  return boxExchange(
    new URL(url),
    {
      method: "POST",
      // Unchecked without a pinned authority: only an answer whose signed envelope verifies can be
      // taken as a yes.
      trust: ca === undefined ? { rejectUnauthorized: false } : { ca, rejectUnauthorized: true },
      signal,
      body,
    },
    MAX_STATUS_BYTES,
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
  return async (peer) => {
    const silent = (reason: SilentReason) => {
      deps.onSilent?.(peer.nodeId, reason);
      return null;
    };
    const nonce = nonceOf();
    let answer: { status: number; text: string };
    try {
      const query = await deps.sign({ nonce, atMs: now(), ...deps.query });
      answer = await postToBox(
        { ...deps, timeoutMs },
        peer.nodeId,
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
