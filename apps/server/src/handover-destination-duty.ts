import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import type { CanonicalValue, RoutableServer } from "@waitron/membership";
import {
  readMirrorLink,
  readNodeMode,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import type { ErrorCode } from "@waitron/shared";
import { askPeerStatus, isOperationStatus } from "./boot-peer-check.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandover, waitHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { boxDownload, boxExchange } from "./mirror-bundle-fetch.js";
import type { PeerQueryPurpose, PeerStatusBody } from "./peer-status-api.js";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

const TICK_MS = 5000;

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

export function receivedCopyPath(stateDir: string, operationId: string): string {
  return join(stateDir, "handover", operationId, "received.db");
}

export interface DestinationDutyDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  stateDir: string;
  log: Logger;
  tickMs?: number;
  /** How long a download may go without a byte before it is given up on. */
  silenceLimitMs?: number;
  /** Told of each file fetched whole, once per file. */
  compare?: (operation: HandoverOperation, indicator: unknown, copyPath: string) => Promise<void>;
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

function refusalReason(text: string): ErrorCode {
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string" && REFUSALS_WAITED_ON.has(code)) return code as ErrorCode;
  } catch {
    // Not a box's refusal, so it falls through to the same answer as any other.
  }
  return "handover.source_unreachable";
}

/**
 * The spare's one duty for a handover it was offered: it reads the old box's signed status, closes
 * when that box reports the operation abandoned, and otherwise fetches the indicator and the final
 * copy, one attempt at a time, until it holds them. Started only on a mirror: anywhere else `undefined`.
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
  let woken = false;
  let rouse: () => void = () => {};
  let held: string | undefined;

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

  async function waitOn(
    operation: HandoverOperation,
    reason: ErrorCode,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (operation.waitingReason === reason) return;
    deps.log("info", "handover-destination.waiting", {
      operationId: operation.operationId,
      reason,
      ...detail,
    });
    await waitHandover(deps, operation.operationId, reason);
  }

  async function close(operation: HandoverOperation): Promise<void> {
    const folder = dirname(receivedCopyPath(deps.stateDir, operation.operationId));
    // Before the record, so a crash between the two repeats both. A failure must not keep the
    // operation open: an open operation holds up every promotion of this box.
    await rm(folder, { recursive: true, force: true }).catch((error: unknown) => {
      deps.log("error", "handover-destination.remove_failed", {
        operationId: operation.operationId,
        error: String(error),
      });
    });
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
    const discard = async () => {
      await rm(path, { force: true });
      await rm(`${path}.partial`, { force: true });
    };
    let indicator: unknown;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await discard();
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
    held = operationId;
    if (operation.waitingReason !== null) await waitHandover(deps, operationId, null);
    await deps.compare?.(operation, indicator, path);
  }

  /** Whether this operation still has work a later tick must do. */
  async function workOn(operation: HandoverOperation): Promise<boolean> {
    const link = await readMirrorLink(deps.node, deps.nodeId);
    const chart = await readNodeMembership(deps.db);
    const source = chart?.body.nodes.find((n) => n.nodeId === operation.sourceNodeId);
    const base = usableBase(source?.contactUrl);
    if (link === null || source === undefined || base === undefined) {
      await waitOn(operation, "handover.source_unreachable");
      return true;
    }
    let silentBecause: string | undefined;
    const status = await askPeerStatus({
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
      authorityOf: () => link.boxCaPem,
      query: { operationId: operation.operationId, purpose: "status" },
      onSilent: (_nodeId, reason) => {
        silentBecause = reason;
      },
    })({ nodeId: source.nodeId, url: base, standing: source.standing } as RoutableServer);

    const reported = status?.requestedOperation;
    const described = reported !== undefined && describesOperation(reported, operation);
    if (described && reported.state === "abandoned") {
      await close(operation);
      return false;
    }
    if (held === operation.operationId) return true;
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
    await fetchCopy(operation, base, link.boxCaPem);
    return true;
  }

  async function pass(): Promise<boolean> {
    const { mode } = await readNodeMode(deps.node, deps.nodeId);
    if (mode !== "mirror") {
      await noteOperationOffMirror(deps);
      return false;
    }
    const operation = await readOpenHandoverOperation(deps.node, deps.nodeId);
    if (
      operation?.role !== "destination" ||
      operation.scenario !== "controlled" ||
      operation.state !== "prepared"
    ) {
      return false;
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
        deps.log("error", "handover-destination.pass_failed", { error: String(error) });
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
