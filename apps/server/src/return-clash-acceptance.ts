import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import {
  readNodeMembership,
  recordActivity,
  withNodeTransaction,
  withTransaction,
  type NodeTransaction,
  type Transaction,
} from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { ReturnDiscrepancy } from "@waitron/module";
import {
  appendHandoverEventTx,
  nodeHandoverEvents,
  readPinnedPrimaryKey,
  type HandoverEvent,
} from "@waitron/node-db";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  type Logger,
} from "@waitron/server-kit";
import { AppError, isAppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { returnDigest, returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import "./errors.js";

const RECORD_WARNING =
  "The new main will not submit the old box's conflicting record. Check its filing status and tax-agency receipt; it may already have been submitted. Later records may remain blocked. Later batches have not been downloaded. Resetting the old box deletes those records too, including sale lines and local backups.";

type Deps = ReturnRecordsDeps & { requireWritable(): void };
export function refuseReturn(reason: string): never {
  throw new AppError("handover.return_refused", { reason });
}

export async function checkedReturn(
  deps: ReturnRecordsDeps,
  raw: unknown,
  tx: Transaction = deps.db,
) {
  const chart = await readNodeMembership(tx);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const verified = verifyEnvelope<Record<string, CanonicalValue>>(
    raw,
    "return-batch",
    await peerKeyOf(deps, chart),
  );
  if (!verified.valid) return refuseReturn("signature");
  const body = verified.body;
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  if (
    pinned?.primaryNodeId !== verified.signerNodeId ||
    body.sourceNodeId !== verified.signerNodeId ||
    body.destinationNodeId !== deps.nodeId ||
    chart?.body.nodes.find((row) => row.standing === "serving-primary")?.nodeId !== deps.nodeId ||
    !chart.body.nodes.some(
      (row) => row.nodeId === verified.signerNodeId && row.standing !== "evicted",
    ) ||
    chart.body.revoked?.includes(verified.signerNodeId) ||
    canonicalize(body.venue!) !== canonicalize(await returnVenue(deps))
  )
    return refuseReturn("binding");
  if (
    body.payload === undefined ||
    typeof body.inventory !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.inventory) ||
    typeof body.nonce !== "string" ||
    body.nonce.length > 64 ||
    typeof body.index !== "number" ||
    !Number.isSafeInteger(body.index) ||
    body.index < 0 ||
    typeof body.count !== "number" ||
    !Number.isSafeInteger(body.count) ||
    body.count <= body.index ||
    Buffer.byteLength(JSON.stringify(body.payload)) > 256 * 1024
  )
    return refuseReturn("batch");
  const seat = deps.modules.find((module) => module.name === body.module)?.handover?.returnRecords;
  if (!seat) return refuseReturn("module");
  return { body, seat, chart, source: verified.signerNodeId };
}

function binding(body: Record<string, CanonicalValue>) {
  return {
    venue: body.venue!,
    sourceNodeId: body.sourceNodeId!,
    destinationNodeId: body.destinationNodeId!,
    module: body.module!,
    inventory: body.inventory!,
    index: body.index!,
    count: body.count!,
    batchDigest: returnDigest({ module: body.module!, payload: body.payload! }),
  };
}
function evidenceId(body: Record<string, CanonicalValue>, clash: ReturnDiscrepancy) {
  return returnDigest({ ...binding(body), fingerprint: clash.fingerprint });
}
function batchId(body: Record<string, CanonicalValue>) {
  return returnDigest(binding(body));
}
async function events(deps: ReturnRecordsDeps, kind: string, node = deps.node as NodeTransaction) {
  return node
    .select()
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, deps.nodeId),
        isNull(nodeHandoverEvents.operationId),
        eq(nodeHandoverEvents.kind, kind),
      ),
    );
}

type StoredClash = ReturnDiscrepancy & { clashId: string };
interface EvidenceGroup {
  event: HandoverEvent;
  clashes: StoredClash[];
}
function evidenceGroups(rows: HandoverEvent[]): EvidenceGroup[] {
  const groups = new Map<unknown, { event?: HandoverEvent; clashes: StoredClash[] }>();
  for (const row of rows) {
    const group = groups.get(row.detail.batchId) ?? { clashes: [] };
    if (row.envelope !== null) group.event = row;
    group.clashes.push(...(row.detail.clashes as StoredClash[]));
    groups.set(row.detail.batchId, group);
  }
  return [...groups.values()].map((group) => ({ event: group.event!, clashes: group.clashes }));
}

export async function retainReturnClashes(
  deps: ReturnRecordsDeps,
  node: NodeTransaction,
  raw: unknown,
  body: Record<string, CanonicalValue>,
  clashes: ReturnDiscrepancy[],
) {
  if (!clashes.length) return;
  const group = evidenceGroups(await events(deps, "return-clash-evidence", node)).find(
    (row) => row.event.detail.batchId === batchId(body),
  );
  const fresh = clashes
    .filter((clash) => !group?.clashes.some((held) => held.clashId === evidenceId(body, clash)))
    .map((clash) => {
      const stored = { ...clash, clashId: evidenceId(body, clash) };
      delete stored.readable;
      return stored;
    });
  if (!fresh.length) return;
  await appendHandoverEventTx(node, {
    nodeId: deps.nodeId,
    operationId: null,
    kind: "return-clash-evidence",
    detail: { batchId: batchId(body), ...binding(body), clashes: fresh },
    envelope: group ? null : JSON.stringify(raw),
  });
}

async function readEvidence(deps: ReturnRecordsDeps, group: EvidenceGroup, tx: Transaction) {
  const checked = await checkedReturn(deps, JSON.parse(group.event.envelope!) as unknown, tx);
  if (
    group.event.detail.batchId !== batchId(checked.body) ||
    group.clashes.some((clash) => clash.clashId !== evidenceId(checked.body, clash))
  )
    refuseReturn("evidence");
  const current = (await checked.seat.inspect?.(tx, checked.source, checked.body.payload!)) ?? [];
  return { ...checked, clashes: group.clashes, current };
}

async function decisionBody(deps: ReturnRecordsDeps, event: HandoverEvent) {
  const decision = JSON.parse(event.envelope!) as unknown;
  const verified = verifyEnvelope<Record<string, CanonicalValue>>(
    decision,
    "return-clash-acceptance",
    await peerKeyOf(deps),
  );
  if (
    !verified.valid ||
    verified.signerNodeId !== deps.nodeId ||
    verified.body.destinationNodeId !== deps.nodeId
  )
    return refuseReturn("acceptance signature");
  return { decision, body: verified.body };
}

export async function acceptedReturnFingerprints(
  deps: ReturnRecordsDeps,
  body: Record<string, CanonicalValue>,
  tx: Transaction,
) {
  const group = evidenceGroups(await events(deps, "return-clash-evidence")).find(
    (row) => row.event.detail.batchId === batchId(body),
  );
  if (!group) return [];
  const evidence = await readEvidence(deps, group, tx);
  const accepted: string[] = [];
  for (const event of await events(deps, "return-clash-acceptance")) {
    const decision = await decisionBody(deps, event);
    const clash = evidence.current.find(
      (row) => row.eligible && row.fingerprint === decision.body.fingerprint,
    );
    if (!clash || decision.body.evidenceDigest !== evidenceId(body, clash)) continue;
    if (
      canonicalize(binding(body)) !==
      canonicalize(
        Object.fromEntries(Object.keys(binding(body)).map((key) => [key, decision.body[key]!])),
      )
    )
      continue;
    accepted.push(clash.fingerprint);
  }
  return accepted;
}

export function mountReturnClashAcceptance(app: Hono, deps: Deps, log: Logger) {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "management_session.proof_required": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "handover.return_refused": 409,
      "handover.return_clash_not_found": 404,
      "membership.held_untrusted": 409,
      "node.read_only": 409,
    },
    "return-clash.failed",
  );
  async function authorize(tx: Transaction, token: string) {
    const permissions = new Set(
      deps.modules.flatMap((module) => module.handover?.returnRecords?.acceptPermission ?? []),
    );
    if (!permissions.size) refuseReturn("no acceptance module");
    let personId = "";
    for (const permission of permissions)
      personId = (await authorizeManager(tx, { managementSessionId: token, permission }))
        .authorizedBy;
    return personId;
  }
  app.get("/management-api/return-clashes", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const report = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, token);
        const accepted = new Set<CanonicalValue>();
        for (const decision of await events(deps, "return-clash-acceptance"))
          accepted.add((await decisionBody(deps, decision)).body.evidenceDigest!);
        const clashes = [];
        const batches = [];
        for (const group of evidenceGroups(await events(deps, "return-clash-evidence"))) {
          const event = group.event;
          let evidence;
          try {
            evidence = await readEvidence(deps, group, tx);
          } catch (error) {
            if (isAppError(error) && error.code === "handover.return_refused") {
              log("warn", "return-clash.evidence_unreadable", {
                batchId: String(event.detail.batchId),
                errorCode: error.code,
              });
              continue;
            }
            throw error;
          }
          batches.push({
            batchId: event.detail.batchId,
            ...binding(evidence.body),
            sourceEnvelope: JSON.parse(event.envelope!) as CanonicalValue,
          });
          for (const clash of evidence.clashes) {
            const clashId = evidenceId(evidence.body, clash);
            clashes.push({
              batchId: event.detail.batchId,
              ...binding(evidence.body),
              ...clash,
              ...(clash.kind === "record"
                ? {
                    downloadUrl: `/management-api/return-clashes/${clashId}/download`,
                    next: `Download both versions before accepting. ${RECORD_WARNING}`,
                  }
                : {}),
              eligible: evidence.current.some(
                (row) => row.fingerprint === clash.fingerprint && row.eligible,
              ),
              accepted: accepted.has(clashId),
            });
          }
        }
        return { clashes, batches };
      });
      c.header("Cache-Control", "no-store");
      return c.json(report);
    }),
  );
  app.get("/management-api/return-clashes/:clashId/download", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const clashId = c.req.param("clashId");
      const readable = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, token);
        const group = evidenceGroups(await events(deps, "return-clash-evidence")).find((row) =>
          row.clashes.some((clash) => clash.clashId === clashId),
        );
        if (!group) throw new AppError("handover.return_clash_not_found", { clashId });
        const evidence = await readEvidence(deps, group, tx);
        const current = evidence.current.find((row) => evidenceId(evidence.body, row) === clashId);
        if (!current) refuseReturn("clash changed");
        if (current.readable === undefined)
          throw new AppError("handover.return_clash_not_found", { clashId });
        return current.readable;
      });
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="return-clash-${clashId}.txt"`);
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(readable);
    }),
  );
  app.post("/management-api/return-clashes/:clashId/accept", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const raw = await readJsonBody<unknown>(c);
      let next = "Restart the stopped box; repeat for any later clashing batch.";
      const result = await withNodeTransaction(deps.node, async (node) => {
        const decision = await withTransaction(deps.db, async (tx) => {
          const personId = await authorize(tx, token);
          await requireFreshManagementSignIn(tx, token);
          deps.requireWritable();
          if (
            !raw ||
            typeof raw !== "object" ||
            Array.isArray(raw) ||
            !("actionKey" in raw) ||
            typeof raw.actionKey !== "string" ||
            !raw.actionKey.trim() ||
            raw.actionKey.length > 128 ||
            !("reason" in raw) ||
            typeof raw.reason !== "string" ||
            !raw.reason.trim() ||
            raw.reason.length > 500
          )
            refuseReturn("decision");
          const clashId = c.req.param("clashId");
          const group = evidenceGroups(await events(deps, "return-clash-evidence", node)).find(
            (row) => row.clashes.some((clash) => clash.clashId === clashId),
          );
          if (!group) throw new AppError("handover.return_clash_not_found", { clashId });
          const evidence = await readEvidence(deps, group, tx);
          if (group.clashes.some((clash) => clash.clashId === clashId && clash.kind === "record"))
            next = `Keep the download for manual handling. Restart the stopped box to retry; the return may stay unconfirmed. ${RECORD_WARNING}`;
          for (const event of await events(deps, "return-clash-acceptance", node)) {
            const prior = await decisionBody(deps, event);
            if (prior.body.actionKey === raw.actionKey || prior.body.evidenceDigest === clashId) {
              if (
                prior.body.actionKey !== raw.actionKey ||
                prior.body.evidenceDigest !== clashId ||
                prior.body.reason !== raw.reason ||
                prior.body.personId !== personId
              )
                refuseReturn("decision mismatch");
              return prior.decision;
            }
          }
          const clash = evidence.current.find(
            (row) => row.eligible && evidenceId(evidence.body, row) === clashId,
          );
          if (!clash) refuseReturn("clash changed or ineligible");
          const at = deps.now?.() ?? new Date();
          const signed = await signAsThisBox(deps, "return-clash-acceptance", {
            ...binding(evidence.body),
            evidenceDigest: clashId,
            fingerprint: clash.fingerprint,
            personId,
            acceptedAt: at.toISOString(),
            reason: raw.reason,
            actionKey: raw.actionKey,
          });
          await recordActivity(tx, {
            id: returnDigest({ clashId, personId, actionKey: raw.actionKey }),
            kind: "handover.return_clash_accepted",
            subjectId: deps.nodeId,
            personId,
            data: { clashId, sourceNodeId: evidence.source, module: String(evidence.body.module) },
            at,
          });
          return signed;
        });
        // Venue history commits first; a failed local append leaves the caller able to accept again.
        const held = await events(deps, "return-clash-acceptance", node);
        if (!held.some((row) => row.detail.clashId === c.req.param("clashId")))
          await appendHandoverEventTx(node, {
            nodeId: deps.nodeId,
            operationId: null,
            kind: "return-clash-acceptance",
            detail: { clashId: c.req.param("clashId") },
            envelope: JSON.stringify(decision),
          });
        return decision;
      });
      c.header("Cache-Control", "no-store");
      return c.json({
        decision: result,
        next,
      });
    }),
  );
}
