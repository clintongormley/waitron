import { HANDOVER_DIR } from "@waitron/store";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import {
  withNodeTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import {
  parseBinding,
  sha256Hex,
  signIndicator,
  type FinalStateIndicator,
  type HandoverBinding,
  type SchemaEntry,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { collectHandoverSummaries, modulesWithSets, type WaitronModule } from "@waitron/module";
import {
  appendHandoverEventTx,
  readHandoverOperation,
  readHandoverRestriction,
} from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { errnoOf } from "./errno.js";
import { buildNodeLocalManifest } from "./handover-manifest.js";
import { findHandoverEnvelope, HANDOVER_EVENT } from "./handover-store.js";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

export const CAPTURE_REFUSAL_STATUS = { "handover.not_stepped_down": 409 } as const;

export interface CaptureDeps {
  readonly venue: Database;
  readonly node: NodeDatabase;
  readonly stateDir: string;
  readonly ring: KeyRing;
  readonly nodeId: string;
  /** The enabled modules: their summaries, their versions, and the venue.db sets they migrate. */
  readonly modules: readonly WaitronModule[];
  readonly now?: () => number;
}

type FinalStateEnvelope = SignedHandoverEnvelope<FinalStateIndicator>;

/**
 * `journalSha256`: SHA-256, as lowercase hex, of the UTF-8 bytes of the set's migration hashes
 * (as drizzle stored them in the set's journal table) joined by a single "\n", with no trailing
 * newline, in the order the journal applied them (ascending `created_at`).
 */
export function journalDigest(hashes: readonly string[]): string {
  return sha256Hex(hashes.join("\n"));
}

/** Where a stepped-down box keeps the final copy of venue.db its indicator describes. */
export function finalCopyPath(stateDir: string, operationId: string): string {
  return join(stateDir, HANDOVER_DIR, operationId, "venue.db");
}

const JOURNAL_TABLE = /^__drizzle_migrations_[a-z_]+$/;

/** Each node handle's capture in flight, by operation, so two calls take one copy. */
const inFlight = new WeakMap<NodeDatabase, Map<string, Promise<FinalStateEnvelope>>>();

/**
 * Takes this stepped-down box's final copy of venue.db once and answers the indicator it signed
 * for it. The binding is read from this box's own operation row, never from a request. A later
 * call answers the stored indicator; a call that failed before the event was written leaves only
 * the copy, which the next call takes again.
 */
export async function captureFinalCopy(
  deps: CaptureDeps,
  operationId: string,
): Promise<FinalStateEnvelope> {
  let running = inFlight.get(deps.node);
  if (running === undefined) {
    running = new Map();
    inFlight.set(deps.node, running);
  }
  const first = running.get(operationId);
  if (first !== undefined) return first;
  const capture = captureOnce(deps, operationId);
  running.set(operationId, capture);
  try {
    return await capture;
  } finally {
    running.delete(operationId);
  }
}

async function captureOnce(deps: CaptureDeps, operationId: string): Promise<FinalStateEnvelope> {
  const binding = await steppedDownBinding(deps, operationId);
  const stored = await readFinalState(deps.node, deps.nodeId, operationId);
  if (stored !== null) return stored;
  if (!(await isDirectory(deps.stateDir))) {
    // A fault in Waitron: a running box's state folder holds its own files, and a manifest read
    // from a missing one would say every file is absent.
    throw new Error(`the state folder ${deps.stateDir} does not exist`);
  }
  const path = finalCopyPath(deps.stateDir, operationId);
  await mkdir(dirname(path), { recursive: true });
  // Reached only when the read above found no stored indicator. `archiveTo` writes beside the file
  // before replacing it, so an abandoned copy left here would make it need room for two.
  await rm(path, { force: true });
  // VACUUM INTO: a file a read-only open leaves byte for byte as it was.
  await deps.venue.archiveTo(path);
  const facts = await describeCopy(deps, binding, path);
  const privateKey = await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId);
  const envelope = signIndicator(facts, { nodeId: deps.nodeId, privateKey });
  const text = canonicalize(envelope as unknown as CanonicalValue);
  return withNodeTransaction(deps.node, async (tx) => {
    // Checked again inside the write: another process may have recorded one since the read above.
    const recorded = await readFinalState(tx, deps.nodeId, operationId);
    if (recorded !== null) return recorded;
    await appendHandoverEventTx(tx, {
      nodeId: deps.nodeId,
      operationId,
      kind: HANDOVER_EVENT.finalState,
      detail: {},
      envelope: text,
    });
    return JSON.parse(text) as FinalStateEnvelope;
  });
}

/** The operation's binding, once this box's restriction shows it handed over for it. */
export async function steppedDownBinding(
  deps: CaptureDeps,
  operationId: string,
): Promise<HandoverBinding> {
  const refuse = () => new AppError("handover.not_stepped_down", { operationId });
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  if (
    restriction === null ||
    restriction.kind !== "handed-over" ||
    restriction.operationId !== operationId
  ) {
    throw refuse();
  }
  const operation = await readHandoverOperation(deps.node, deps.nodeId, operationId);
  if (operation === null || operation.role !== "source") throw refuse();
  const binding = parseBinding(operation.binding);
  if (
    binding.operationId !== operationId ||
    binding.sourceNodeId !== deps.nodeId ||
    binding.destinationNodeId !== operation.destinationNodeId ||
    restriction.successorNodeId !== binding.destinationNodeId ||
    restriction.membershipTerm !== binding.membership.term
  ) {
    throw refuse();
  }
  return binding;
}

export async function readFinalState(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
  operationId: string,
): Promise<FinalStateEnvelope | null> {
  const envelope = await findHandoverEnvelope(
    { node, nodeId },
    operationId,
    HANDOVER_EVENT.finalState,
  );
  return envelope === null ? null : (JSON.parse(envelope) as FinalStateEnvelope);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function describeCopy(
  deps: CaptureDeps,
  binding: HandoverBinding,
  path: string,
): Promise<FinalStateIndicator> {
  const { sha256, bytes } = await digestFile(path);
  const copy = await openBackupQuery(path);
  let schema: SchemaEntry[];
  let modulesSummary: Record<string, CanonicalValue>;
  try {
    schema = await venueSchema(deps.modules, copy.query);
    modulesSummary = await collectHandoverSummaries(deps.modules, copy.query);
  } finally {
    await copy.close();
  }
  return {
    binding,
    snapshot: {
      sha256,
      bytes,
      schema,
      modules: deps.modules.map(({ name, version }) => ({ name, version })),
    },
    nodeLocal: await buildNodeLocalManifest(deps.stateDir, deps.ring),
    modulesSummary,
    capturedAtMs: (deps.now ?? Date.now)(),
  };
}

async function digestFile(path: string): Promise<{ sha256: string; bytes: number }> {
  return digestBytes(createReadStream(path));
}

/** `digestFile`, where a file that is not there is an answer: `null`. */
export async function digestFileIfPresent(
  path: string,
): Promise<{ sha256: string; bytes: number } | null> {
  try {
    return await digestFile(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
}

/** The SHA-256, as lowercase hex, and the length of the bytes a stream yields. */
export async function digestBytes(
  stream: AsyncIterable<unknown>,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Only the sets applied to venue.db: node.db's journal is not in the copy. */
async function venueSchema(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<SchemaEntry[]> {
  const schema: SchemaEntry[] = [];
  for (const m of modulesWithSets(modules)) {
    if (m.migrations.database === "node") continue;
    const table = m.migrations.table;
    // A fault in Waitron: a descriptor names its journal table in this shape.
    if (!JOURNAL_TABLE.test(table)) throw new Error(`invalid journal table ${table}`);
    const hashes: string[] = [];
    // SQL cannot bind an identifier; the pattern above confines this one to [a-z_].
    for await (const row of query.rows(`select hash from "${table}" order by created_at`)) {
      hashes.push(String(row.hash));
    }
    schema.push({
      set: m.migrations.name,
      version: hashes.length,
      journalSha256: journalDigest(hashes),
    });
  }
  return schema;
}
