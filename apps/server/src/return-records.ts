import { readPinnedPrimaryKey } from "@waitron/node-db";
import { nodeId as asNodeId } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { realSleep } from "./loop.js";
import { randomUUID } from "node:crypto";
import {
  readDeploymentEnvironment,
  readNodeMembership,
  readTenant,
  type Transaction,
} from "@waitron/db";
import { sha256Hex, verifyEnvelope } from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { postToBox } from "./boot-peer-check.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";

export interface ReturnRecordsDeps extends PeerStatusApiDeps {
  modules: readonly WaitronModule[];
  now?: () => Date;
}
export type ReturnState =
  "waiting" | "sending" | "needs-attention" | "clock" | "clash" | "record-clash" | "confirmed";
export const returnDigest = (value: CanonicalValue) => sha256Hex(canonicalize(value));

export async function returnVenue(deps: Pick<ReturnRecordsDeps, "db">) {
  const tenant = await readTenant(deps.db);
  const environment = await readDeploymentEnvironment(deps.db);
  return tenant === null || environment === null
    ? null
    : { country: tenant.country, taxId: tenant.taxId, environment };
}

export async function runReturnRecordsPass(
  deps: ReturnRecordsDeps & {
    fetch?: typeof fetch;
    stopped(): boolean;
  },
): Promise<ReturnState> {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const target = chart?.body.nodes.find((row) => row.standing === "serving-primary");
  const venue = await returnVenue(deps);
  if (!target || target.nodeId === deps.nodeId || !venue || !target.contactUrl) return "waiting";
  const batches: { module: string; payload: CanonicalValue }[] = [];
  // The restricted box reads without draining change_log or running a venue write turn.
  for (const module of deps.modules) {
    const seat = module.handover?.returnRecords;
    if (seat)
      for (const payload of await seat.read(deps.db, deps.nodeId))
        batches.push({ module: module.name, payload });
  }
  if (batches.length === 0) return "waiting";
  const inventory = returnDigest(batches.map(returnDigest));
  const keyOf = await peerKeyOf(deps, chart);
  for (let index = 0; index < batches.length; index++) {
    if (deps.stopped()) return "waiting";
    const nonce = randomUUID();
    const batch = batches[index]!;
    const body = {
      venue,
      sourceNodeId: deps.nodeId,
      destinationNodeId: target.nodeId,
      inventory,
      count: batches.length,
      index,
      nonce,
      ...batch,
    };
    try {
      const answer = await postToBox(
        { fetch: deps.fetch, timeoutMs: 5_000 },
        target.nodeId,
        `${target.contactUrl.replace(/\/+$/, "")}/api/node/return-records`,
        JSON.stringify(await signAsThisBox(deps, "return-batch", body)),
      );
      if (answer.status !== 200) {
        try {
          const refusal = JSON.parse(answer.text) as { error?: { code?: string } };
          if (refusal.error?.code === "fiscal.return_clock_ahead") return "clock";
          if (refusal.error?.code === "fiscal.return_record_clash") return "record-clash";
        } catch {
          return "needs-attention";
        }
        return "needs-attention";
      }
      const verified = verifyEnvelope<Record<string, unknown>>(
        JSON.parse(answer.text),
        "return-receipt",
        keyOf,
      );
      if (!verified.valid || verified.signerNodeId !== target.nodeId) return "needs-attention";
      const receipt = verified.body;
      if (
        receipt.nonce !== nonce ||
        receipt.index !== index ||
        receipt.inventory !== inventory ||
        receipt.digest !== returnDigest(batch) ||
        receipt.sourceNodeId !== deps.nodeId ||
        receipt.destinationNodeId !== target.nodeId ||
        canonicalize(receipt.venue as CanonicalValue) !== canonicalize(venue) ||
        (receipt.accounted !== true && receipt.accounted !== false)
      )
        return "needs-attention";
      if (receipt.accounted === false) return "clash";
    } catch {
      return "waiting";
    }
  }
  return !deps.stopped() ? "confirmed" : "waiting";
}

export function startReturnRecordsDuty(
  deps: ReturnRecordsDeps & {
    fetch?: typeof fetch;
    log: Logger;
  },
): { state(): ReturnState; stop(): Promise<void> } {
  const stopping = new AbortController();
  let state: ReturnState = "waiting";
  const task = (async () => {
    while (!stopping.signal.aborted) {
      state = "sending";
      try {
        state = await runReturnRecordsPass({ ...deps, stopped: () => stopping.signal.aborted });
      } catch (error) {
        state = "needs-attention";
        deps.log("warn", "return-records.failed", { errorCode: codeOf(error) });
      }
      if (state === "confirmed" || state === "clash" || state === "record-clash") return;
      await realSleep(30_000, stopping.signal);
    }
  })();
  return {
    state: () => state,
    stop: async () => {
      stopping.abort();
      await task;
    },
  };
}

export async function formerMainForReturn(deps: PeerStatusApiDeps, tx: Transaction = deps.db) {
  const chart = await readNodeMembership(tx);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  if (
    !pinned ||
    pinned.primaryNodeId === deps.nodeId ||
    chart?.body.nodes.find((row) => row.standing === "serving-primary")?.nodeId !== deps.nodeId ||
    !chart.body.nodes.some(
      (row) => row.nodeId === pinned.primaryNodeId && row.standing !== "evicted",
    ) ||
    chart.body.revoked?.includes(pinned.primaryNodeId)
  )
    return null;
  return asNodeId(pinned.primaryNodeId);
}
