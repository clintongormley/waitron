import { canonicalize, signBytes, verifyBytes } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { putOwnBytes } from "./conditional.js";
import { isKeySegment, parseGenerationName, venuePrefix } from "./names.js";
import type { ObjectStore } from "./object-store.js";

export interface StreamPointer {
  venueId: string;
  term: number;
  nodeId: string;
  generation: string;
  writtenAt: string;
}

export interface SignedPointer {
  body: StreamPointer;
  signature: string;
}

/** Inside the signed bytes, so a signature over a pointer is never a signature over anything else. */
const PURPOSE = "waitron.stream.pointer.v1";
const BODY_KEYS = 5;

export function pointerKey(venueId: string): string {
  return `${venuePrefix(venueId)}current.json`;
}

/** The exact string a pointer's signature covers. */
export function pointerMessage(body: StreamPointer): string {
  return canonicalize({ purpose: PURPOSE, pointer: body as unknown as CanonicalValue });
}

function invalid(reason: string): AppError {
  return new AppError("backup.stream_pointer_invalid", { reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bodyProblem(body: unknown): string | null {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== BODY_KEYS ||
    typeof body.venueId !== "string" ||
    typeof body.term !== "number" ||
    typeof body.nodeId !== "string" ||
    typeof body.generation !== "string" ||
    typeof body.writtenAt !== "string"
  ) {
    return "shape";
  }
  if (!isKeySegment(body.venueId)) return "venue_id";
  if (!Number.isSafeInteger(body.term) || body.term < 0) return "term";
  const generation = parseGenerationName(body.generation);
  if (generation === null || generation.term !== body.term || generation.nodeId !== body.nodeId)
    return "generation";
  const written = new Date(body.writtenAt);
  if (Number.isNaN(written.getTime()) || written.toISOString() !== body.writtenAt)
    return "written_at";
  return null;
}

function pointerProblem(value: unknown): string | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.signature !== "string")
    return "shape";
  return bodyProblem(value.body);
}

export function signPointer(body: StreamPointer, privateKeyPkcs8: string): SignedPointer {
  const problem = bodyProblem(body);
  if (problem !== null) throw invalid(problem);
  return { body, signature: signBytes(pointerMessage(body), privateKeyPkcs8) };
}

/**
 * True only for a well-formed pointer signed by `publicKeySpki`. A restore checks against the key the
 * recovery kit carries, never one read from the bucket (spec §5.1 step 2).
 */
export function verifyPointer(pointer: SignedPointer, publicKeySpki: string): boolean {
  return (
    pointerProblem(pointer) === null &&
    verifyBytes(pointerMessage(pointer.body), pointer.signature, publicKeySpki)
  );
}

function encode(pointer: SignedPointer): Uint8Array {
  return new TextEncoder().encode(canonicalize(pointer as unknown as CanonicalValue));
}

/**
 * The live pointer and its version tag, shape-checked but NOT signature-checked — the writer needs the
 * version tag whoever signed it, and a restore must call `verifyPointer` with the kit's key.
 */
export async function readPointer(
  store: ObjectStore,
  venueId: string,
): Promise<{ pointer: SignedPointer; etag: string } | null> {
  const stored = await store.get(pointerKey(venueId));
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.body));
  } catch {
    throw invalid("not_json");
  }
  const problem = pointerProblem(parsed);
  if (problem !== null) throw invalid(problem);
  const pointer = parsed as SignedPointer;
  if (pointer.body.venueId !== venueId) throw invalid("other_venue");
  return { pointer, etag: stored.etag };
}

/**
 * The exact bytes of every pointer a process has sent, so a refusal caused by one of them landing
 * after a later read is told from another box's write. Byte-exact, not "this node id and term": a
 * rebuild reuses the dead box's node id and can sign the same term (spec §4.4). Never pruned: a
 * supervisor adds one entry per generation it opens.
 */
export class SentPointers {
  readonly #sent = new Set<string>();

  add(pointer: SignedPointer): void {
    this.#sent.add(Buffer.from(encode(pointer)).toString("base64"));
  }

  includes(bytes: Uint8Array): boolean {
    return this.#sent.has(Buffer.from(bytes).toString("base64"));
  }
}

/**
 * Replace `current.json` only if it is still the version this box read (`previousEtag`), or create it
 * only if there is none (`null`). A refusal is another box writing this venue, and is thrown
 * (`backup.stream_precondition_failed`) — unless the pointer now holds exactly these bytes, which is
 * this box's own write answered twice.
 */
export async function writePointer(
  store: ObjectStore,
  venueId: string,
  pointer: SignedPointer,
  previousEtag: string | null,
): Promise<void> {
  const problem = pointerProblem(pointer);
  if (problem !== null) throw invalid(problem);
  if (pointer.body.venueId !== venueId) throw invalid("other_venue");
  await putOwnBytes(
    store,
    pointerKey(venueId),
    encode(pointer),
    previousEtag === null ? { ifNoneMatch: "*" } : { ifMatch: previousEtag },
  );
}
