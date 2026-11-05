import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { KeyRing } from "@waitron/credentials";
import {
  readNodeMembership,
  readNodeMembershipRow,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import type { CanonicalValue, RoutableServer } from "@waitron/membership";
import {
  readHandoverEvent,
  readHandoverOperation,
  readMirrorLink,
  readNodeMode,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import type { ErrorCode } from "@waitron/shared";
import { askPeerStatus, isOperationStatus } from "./boot-peer-check.js";
import {
  acceptedCopyPath,
  acceptFinalCopy,
  readStoredAcceptance,
  verifiedRelinquishment,
} from "./handover-acceptance.js";
import type { CompareOptions, CompareOutcome, CopyFileChecks } from "./handover-compare.js";
import type { Statfs } from "./free-bytes.js";
import { movedOnFromSource, oldBoxStillMain } from "./handover-chart.js";
import { COPY_PLACED_EVENT } from "./handover-place-copy.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandover, waitHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { boxDownload, boxExchange } from "./mirror-bundle-fetch.js";
import type { PeerQueryPurpose, PeerStatusBody } from "./peer-status-api.js";
import { isLoopbackHost } from "./primary-url.js";
import { lowestFreeBytes, START_FREE_SPACE_FLOOR } from "./start-space.js";
import "./errors.js";

const TICK_MS = 5000;

// A compare that fails may need a person to fix a setting.
const COMPARE_RETRY_MS = 60_000;

/** The refusals another copy of the same file could cure: every other waits on the same file. */
const REFUSALS_FETCHED_AGAIN: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "handover.copy_mismatch",
  "handover.copy_damaged",
]);

// Room for what else a signed indicator holds beside the old box's retained selections, which come
// from a file limited to 1 MiB (`module-preparation-state.ts`).
const MAX_INDICATOR_BYTES = 4 * 1024 * 1024;

// The first request makes the old box take and digest its whole copy before it answers.
const INDICATOR_LIMIT_MS = 5 * 60_000;

/** What the source's copy routes answer that names a reason to keep waiting. */
const REFUSALS_WAITED_ON: ReadonlySet<string> = new Set<ErrorCode>([
  "handover.not_stepped_down",
  "handover.operation_unknown",
  "handover.peer_unknown",
  "handover.summary_failed",
  "handover.final_copy_changed",
]);

/** What the old box may answer an acceptance with that names a reason to keep waiting. */
const ACCEPTANCE_REFUSALS_WAITED_ON: ReadonlySet<string> = new Set<ErrorCode>([
  "handover.not_stepped_down",
  "handover.operation_unknown",
  "handover.peer_unknown",
  "handover.indicator_mismatch",
]);

// The old box writes one record and answers, so an answer this long in coming is not on its way.
const ACCEPTANCE_LIMIT_MS = 30_000;

// A relinquishment holds a binding and four short values.
const MAX_RELINQUISHMENT_BYTES = 64 * 1024;

export function receivedCopyPath(stateDir: string, operationId: string): string {
  return join(stateDir, "handover", operationId, "received.db");
}

export interface DestinationDutyDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  stateDir: string;
  venueDir: string;
  log: Logger;
  /** The start that follows `filing_assumed` is what places the accepted copy. */
  restart: () => void;
  /** For the check of room to place the copy; a real read unless named. */
  statfs?: Statfs;
  tickMs?: number;
  /** How long a download may go without a byte before it is given up on. */
  silenceLimitMs?: number;
  /**
   * Told of a file fetched whole. A throw or a refusal has it told again of the same file, after
   * `compareRetryMs`, except a refusal in `REFUSALS_FETCHED_AGAIN`. `options.found` belongs to that
   * one file.
   */
  compare?: (
    operation: HandoverOperation,
    indicator: unknown,
    copyPath: string,
    options: CompareOptions,
  ) => Promise<CompareOutcome>;
  compareRetryMs?: number;
  /**
   * Told of a file a compare passed. `acceptFinalCopy` unless named; `null` holds the file and goes
   * no further, for a test of a step before this one.
   */
  accept?: typeof acceptFinalCopy | null;
  acceptanceLimitMs?: number;
  /** A clock that only runs forward, for the limit on comparing again. */
  monotonicNow?: () => number;
  download?: typeof boxDownload;
}

export interface HandoverDestinationDuty {
  /** Looks for work now, rather than waiting for the next tick or for ever. */
  wake(): void;
  stop(): Promise<void>;
}

/** The address to reach `url` at, when a pinned certificate or this machine alone can vouch for it. */
export function usableBase(url: string | undefined): string | undefined {
  if (url === undefined || url === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // `boxDownload` ignores its trust over plain http, so the pin would protect nothing.
  if (parsed.protocol === "https:" || isLoopbackHost(parsed.hostname)) {
    return url.replace(/\/+$/, "");
  }
  return undefined;
}

/** Whether a verified status's `requestedOperation` describes this very operation, seen by its source. */
function describesOperation(
  reported: PeerStatusBody["requestedOperation"],
  operation: HandoverOperation,
): reported is NonNullable<PeerStatusBody["requestedOperation"]> {
  return (
    reported !== null &&
    isOperationStatus(reported) &&
    reported.operationId === operation.operationId &&
    reported.role === "source" &&
    reported.scenario === operation.scenario &&
    reported.sourceNodeId === operation.sourceNodeId &&
    reported.destinationNodeId === operation.destinationNodeId
  );
}

/** A whole file this duty fetched for an operation, and how far comparing it has got. */
interface HeldCopy {
  operationId: string;
  indicator: unknown;
  path: string;
  compared: boolean;
  compareDueAt: number;
  found: CopyFileChecks;
}

async function discardCopy(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(`${path}.partial`, { force: true });
}

function refusalReason(
  text: string,
  waitedOn: ReadonlySet<string> = REFUSALS_WAITED_ON,
): ErrorCode {
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string" && waitedOn.has(code)) return code as ErrorCode;
  } catch {
    // Not a box's refusal, so it falls through to the same answer as any other.
  }
  return "handover.source_unreachable";
}

/**
 * The spare's one duty for a handover it was offered: it reads the old box's signed status, closes
 * when that box reports the operation abandoned, and otherwise fetches the indicator and the final
 * copy, one attempt at a time, until it holds them. Once a copy is accepted it posts the stored
 * acceptance, once the disk has room to place the copy, until the old box's relinquishment passes
 * its checks, and then asks for the restart that places it until that start has run, except while
 * its chart has another main box, when that start would not place. Started only on a mirror:
 * anywhere else `undefined`.
 */
export async function startHandoverDestinationDuty(
  deps: DestinationDutyDeps,
): Promise<HandoverDestinationDuty | undefined> {
  const { mode } = await readNodeMode(deps.node, deps.nodeId);
  if (mode !== "mirror") {
    await noteOperationOffMirror(deps);
    return undefined;
  }
  return runDuty(deps);
}

async function noteOperationOffMirror(deps: DestinationDutyDeps): Promise<void> {
  const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
  if (open?.role === "destination") {
    deps.log("warn", "handover-destination.not_a_mirror", { operationId: open.operationId });
  }
}

function runDuty(deps: DestinationDutyDeps): HandoverDestinationDuty {
  const stopping = new AbortController();
  const { signal } = stopping;
  const tickMs = deps.tickMs ?? TICK_MS;
  const download = deps.download ?? boxDownload;
  const compareRetryMs = deps.compareRetryMs ?? COMPARE_RETRY_MS;
  const accept = deps.accept === undefined ? acceptFinalCopy : deps.accept;
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  let woken = false;
  let rouse: () => void = () => {};
  let held: HeldCopy | undefined;

  const wake = () => {
    woken = true;
    rouse();
  };
  signal.addEventListener("abort", () => rouse());

  /** Until woken, stopped, or after `ms` when it has a number. */
  async function sleep(ms: number | undefined): Promise<void> {
    if (woken || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
      rouse = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** The one operation this duty should be working on now, read fresh, or `null`. */
  async function workToDo(): Promise<HandoverOperation | null> {
    const { mode } = await readNodeMode(deps.node, deps.nodeId);
    if (mode !== "mirror") {
      await noteOperationOffMirror(deps);
      return null;
    }
    const operation = await readOpenHandoverOperation(deps.node, deps.nodeId);
    return operation?.role === "destination" &&
      operation.scenario === "controlled" &&
      (operation.state === "prepared" || operation.state === "copy_accepted")
      ? operation
      : null;
  }

  /** `operation`'s row now, unless a stop or another writer ended this duty's work on it. */
  async function stillWorkingOn(operation: HandoverOperation): Promise<HandoverOperation | null> {
    if (signal.aborted) return null;
    const current = await workToDo();
    return current?.operationId === operation.operationId ? current : null;
  }

  async function waitOn(
    operation: HandoverOperation,
    reason: ErrorCode,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const current = await stillWorkingOn(operation);
    if (current === null || current.waitingReason === reason) return;
    deps.log("info", "handover-destination.waiting", {
      operationId: operation.operationId,
      reason,
      ...detail,
    });
    await waitHandover(deps, operation.operationId, reason);
  }

  /** `operationId` must come from a stored row. A failure is logged and never thrown. */
  async function removeFolder(operationId: string): Promise<void> {
    const folder = dirname(receivedCopyPath(deps.stateDir, operationId));
    await rm(folder, { recursive: true, force: true }).catch((error: unknown) => {
      deps.log("error", "handover-destination.remove_failed", {
        operationId,
        error: String(error),
      });
    });
  }

  /**
   * An operation that closes from `prepared` leaves a whole venue's copy nothing will read again.
   * A source's folder is its own capture (`handover-capture.ts`).
   */
  async function removeClosedFolders(): Promise<void> {
    const names = await readdir(join(deps.stateDir, "handover")).catch(() => []);
    for (const name of names) {
      const row = await readHandoverOperation(deps.node, deps.nodeId, name);
      if (row?.role === "destination" && (row.state === "abandoned" || row.state === "replaced")) {
        await removeFolder(row.operationId);
      }
    }
  }

  async function close(operation: HandoverOperation): Promise<void> {
    // Before the record, so a crash between the two repeats both. A failure must not keep the
    // operation open: an open operation holds up every promotion of this box.
    await removeFolder(operation.operationId);
    await advanceHandover(deps, operation.operationId, "abandoned", {
      reportedBy: operation.sourceNodeId,
    } as CanonicalValue);
    deps.log("info", "handover-destination.abandoned", { operationId: operation.operationId });
  }

  async function signedQuery(
    operationId: string,
    purpose: Exclude<PeerQueryPurpose, "status">,
  ): Promise<string> {
    const body = {
      nonce: randomBytes(16).toString("hex"),
      atMs: Date.now(),
      operationId,
      purpose,
    };
    return JSON.stringify(await signAsThisBox(deps, "query", body));
  }

  async function fetchCopy(operation: HandoverOperation, base: string, ca: string): Promise<void> {
    const { operationId } = operation;
    const path = receivedCopyPath(deps.stateDir, operationId);
    const trust = { ca, rejectUnauthorized: true };
    const routes = `${base}/api/node/handover/${operationId}`;
    const discard = () => discardCopy(path);
    let indicator: unknown;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await discard();
      // Before the record nothing is promised, so this is only what a crash after the move left, and
      // beside it a second whole copy might not fit.
      await rm(acceptedCopyPath(deps.stateDir, operationId), { force: true });
      const answer = await boxExchange(
        new URL(`${routes}/indicator`),
        {
          method: "POST",
          trust,
          signal: AbortSignal.any([signal, AbortSignal.timeout(INDICATOR_LIMIT_MS)]),
          body: await signedQuery(operationId, "indicator"),
        },
        MAX_INDICATOR_BYTES,
      );
      if (answer.status !== 200) return await waitOn(operation, refusalReason(answer.text));
      indicator = JSON.parse(answer.text);
      const copy = await download(
        new URL(`${routes}/final-copy`),
        {
          trust,
          signal,
          body: await signedQuery(operationId, "final-copy"),
          silenceLimitMs: deps.silenceLimitMs,
        },
        path,
      );
      if (copy.status !== 200) return await waitOn(operation, refusalReason(copy.text));
    } catch (error) {
      // A download can throw with the whole file already at its final name.
      await discard();
      if (signal.aborted) return;
      deps.log("warn", "handover-destination.fetch_failed", {
        operationId,
        error: String(error),
      });
      return waitOn(operation, "handover.source_unreachable");
    }
    // The download can outlast the operation, the box's being a mirror, or this duty.
    const current = await stillWorkingOn(operation);
    if (current === null) return discard();
    held = { operationId, indicator, path, compared: false, compareDueAt: 0, found: {} };
    if (current.waitingReason !== null) await waitHandover(deps, operationId, null);
    // Another writer may have closed the operation while the reason was being cleared.
    const cleared = await stillWorkingOn(operation);
    if (cleared === null) return discard();
    await compareHeld(held, cleared);
  }

  async function compareHeld(copy: HeldCopy, operation: HandoverOperation): Promise<void> {
    if (copy.compared || monotonicNow() < copy.compareDueAt) return;
    copy.compareDueAt = monotonicNow() + compareRetryMs;
    const outcome = await deps.compare?.(operation, copy.indicator, copy.path, {
      found: copy.found,
      signal,
    });
    if (outcome !== undefined && !outcome.ok) {
      if (REFUSALS_FETCHED_AGAIN.has(outcome.reason)) {
        held = undefined;
        await discardCopy(copy.path);
      }
      return waitOn(operation, outcome.reason, { detail: outcome.detail });
    }
    const current = await stillWorkingOn(operation);
    if (outcome !== undefined && accept !== null) {
      if (current === null) return;
      await accept(deps, current, copy.indicator, copy.path);
      return;
    }
    copy.compared = true;
    if (current !== null && current.waitingReason !== null) {
      await waitHandover(deps, operation.operationId, null);
    }
  }

  /** Where the old box is and the certificate to trust it by, or `undefined` while it cannot be asked. */
  async function sourceAddress(operation: HandoverOperation) {
    const link = await readMirrorLink(deps.node, deps.nodeId);
    const chart = await readNodeMembership(deps.db);
    const source = chart?.body.nodes.find((n) => n.nodeId === operation.sourceNodeId);
    const base = usableBase(source?.contactUrl);
    return link === null || source === undefined || base === undefined
      ? undefined
      : { source, base, ca: link.boxCaPem };
  }

  async function postAcceptance(operation: HandoverOperation): Promise<void> {
    const { operationId } = operation;
    // Told to give up filing, the old box would stop for good with this box unable to take over.
    const copyBytes = await stat(acceptedCopyPath(deps.stateDir, operationId)).then(
      (found) => found.size,
      () => null,
    );
    if (copyBytes === null) return waitOn(operation, "handover.accepted_copy_missing");
    // Placing keeps the old database and the accepted copy while it writes a third file. A disk that
    // cannot say how much it has free is not taken as having room: this is the step with no way back.
    const neededBytes = copyBytes + START_FREE_SPACE_FLOOR;
    const availableBytes = await lowestFreeBytes([deps.stateDir, deps.venueDir], deps.statfs);
    if (availableBytes === null || availableBytes < neededBytes) {
      return waitOn(operation, "handover.no_room_to_place", { neededBytes, availableBytes });
    }
    const address = await sourceAddress(operation);
    if (address === undefined) {
      return waitOn(operation, "handover.source_unreachable");
    }
    // Before the post, or the old box gives up filing to a box that will not take it.
    if (!oldBoxStillMain(await readNodeMembership(deps.db), operation.sourceNodeId)) {
      return waitOn(operation, "handover.source_no_longer_main");
    }
    const acceptance = await readStoredAcceptance(deps, operationId);
    let answer: { status: number; text: string };
    try {
      answer = await boxExchange(
        new URL(`${address.base}/api/node/handover/${operationId}/acceptance`),
        {
          method: "POST",
          trust: { ca: address.ca, rejectUnauthorized: true },
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(deps.acceptanceLimitMs ?? ACCEPTANCE_LIMIT_MS),
          ]),
          body: acceptance,
        },
        MAX_RELINQUISHMENT_BYTES,
      );
    } catch (error) {
      if (signal.aborted) return;
      deps.log("warn", "handover-destination.post_failed", { operationId, error: String(error) });
      return waitOn(operation, "handover.source_unreachable");
    }
    if (answer.status !== 200) {
      return waitOn(operation, refusalReason(answer.text, ACCEPTANCE_REFUSALS_WAITED_ON));
    }
    const relinquishment = await verifiedRelinquishment(deps, operation, acceptance, answer.text);
    if (relinquishment === null) {
      return waitOn(operation, "handover.relinquishment_invalid");
    }
    if (!oldBoxStillMain(await readNodeMembership(deps.db), operation.sourceNodeId)) {
      return waitOn(operation, "handover.source_no_longer_main");
    }
    await advanceHandover(deps, operationId, "filing_assumed", {}, relinquishment);
    deps.log("info", "handover-destination.filing_assumed", { operationId });
    deps.restart();
  }

  /** Whether this operation still has work a later tick must do. */
  async function workOn(operation: HandoverOperation): Promise<boolean> {
    const address = await sourceAddress(operation);
    if (address === undefined) {
      await waitOn(operation, "handover.source_unreachable");
      return true;
    }
    const { source, base, ca } = address;
    let silentBecause: string | undefined;
    const status = await askPeerStatus({
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
      authorityOf: () => ca,
      query: { operationId: operation.operationId, purpose: "status" },
      onSilent: (_nodeId, reason) => {
        silentBecause = reason;
      },
    })({ nodeId: source.nodeId, url: base, standing: source.standing } as RoutableServer);

    const current = await stillWorkingOn(operation);
    if (current === null) return true;

    const reported = status?.requestedOperation;
    const described = reported !== undefined && describesOperation(reported, operation);
    if (described && reported.state === "abandoned") {
      await close(operation);
      return false;
    }
    if (held?.operationId === operation.operationId) {
      await compareHeld(held, current);
      return true;
    }
    // A refused read goes on to the copy route, whose refusal names its reason, and which opens
    // only for a box restricted as handed over in this operation (`steppedDownBinding`).
    if (status === null && silentBecause !== "refused") {
      await waitOn(operation, "handover.source_unreachable", { silentBecause });
      return true;
    }
    if (status !== null) {
      if (reported === null) {
        await waitOn(operation, "handover.operation_unknown");
        return true;
      }
      if (!described) {
        await waitOn(operation, "handover.source_unreachable");
        return true;
      }
      // Only a box in its restricted start serves the copy, so asking now could only fail.
      if (reported.state === "prepared") {
        await waitOn(operation, "handover.not_stepped_down");
        return true;
      }
    }
    await fetchCopy(operation, base, ca);
    return true;
  }

  /** Whether the old box has given up filing to this box and the start that places the copy has not run. */
  async function placingStartOwed(): Promise<HandoverOperation | null> {
    const { mode } = await readNodeMode(deps.node, deps.nodeId);
    if (mode !== "mirror") return null;
    const operation = await readOpenHandoverOperation(deps.node, deps.nodeId);
    if (
      operation?.role !== "destination" ||
      operation.scenario !== "controlled" ||
      operation.state !== "filing_assumed"
    ) {
      return null;
    }
    const placed = await readHandoverEvent(
      deps.node,
      deps.nodeId,
      operation.operationId,
      COPY_PLACED_EVENT,
    );
    return placed === null ? operation : null;
  }

  /** What the start that places would read here. A chart too broken to read says nothing there. */
  async function placingWouldStop(operation: HandoverOperation): Promise<boolean> {
    try {
      const row = await readNodeMembershipRow(deps.db);
      return movedOnFromSource(row?.document ?? null, operation.sourceNodeId);
    } catch (error) {
      deps.log("warn", "handover-destination.chart_unreadable", {
        operationId: operation.operationId,
        error: String(error),
      });
      return false;
    }
  }

  async function pass(): Promise<boolean> {
    await removeClosedFolders();
    // A start that places records the event before this duty runs, and a start that refuses to place
    // is one this asks for no longer, so this cannot loop; a restart sent before the shutdown handlers
    // are in, on a box where Node is process 1, does nothing.
    const owed = await placingStartOwed();
    if (owed !== null) {
      const { operationId } = owed;
      if (await placingWouldStop(owed)) {
        if (owed.waitingReason !== "handover.source_no_longer_main") {
          deps.log("info", "handover-destination.waiting", {
            operationId,
            reason: "handover.source_no_longer_main",
          });
          await waitHandover(deps, operationId, "handover.source_no_longer_main");
        }
        return true;
      }
      if (owed.waitingReason !== null) await waitHandover(deps, operationId, null);
      deps.log("warn", "handover-destination.restart_asked_again", { operationId });
      deps.restart();
      return true;
    }
    const operation = await workToDo();
    if (operation === null) return false;
    if (operation.state === "copy_accepted") {
      await postAcceptance(operation);
      return true;
    }
    return workOn(operation);
  }

  async function loop(): Promise<void> {
    while (!signal.aborted) {
      woken = false;
      let more = true;
      try {
        more = await pass();
      } catch (error) {
        // A stop ends a comparison under way by rejecting it.
        if (!signal.aborted) {
          deps.log("error", "handover-destination.pass_failed", { error: String(error) });
        }
      }
      await sleep(more ? tickMs : undefined);
    }
  }

  const running = loop();
  return {
    wake,
    stop: () => {
      stopping.abort();
      return running;
    },
  };
}
