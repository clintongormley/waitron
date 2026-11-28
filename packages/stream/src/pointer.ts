import { canonicalize, signBytes, verifyBytes } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { putOwnBytes } from "./conditional.js";
import { isKeySegment, parseGenerationName } from "./names.js";
import type { ObjectStore, StoreCall } from "./object-store.js";

export interface BucketPointerRecovery {
  signerPublicKey: string;
  keyNumber: number;
  masterKeyId: string;
}

export interface StreamPointer {
  streamId: string;
  term: number;
  nodeId: string;
  generation: string;
  writtenAt: string;
  recovery?: BucketPointerRecovery;
}

export interface SignedPointer {
  body: StreamPointer;
  signature: string;
}

/** Inside the signed bytes, so a signature over a pointer is never a signature over anything else. */
const PURPOSE = "waitron.stream.pointer.v1";
const BODY_KEYS = 5;

export function pointerKey(): string {
  return "current.json";
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
    Object.keys(body).length !== BODY_KEYS + (Object.hasOwn(body, "recovery") ? 1 : 0) ||
    typeof body.streamId !== "string" ||
    typeof body.term !== "number" ||
    typeof body.nodeId !== "string" ||
    typeof body.generation !== "string" ||
    typeof body.writtenAt !== "string"
  ) {
    return "shape";
  }
  if (
    Object.hasOwn(body, "recovery") &&
    (!isRecord(body.recovery) ||
      Object.keys(body.recovery).length !== 3 ||
      typeof body.recovery.signerPublicKey !== "string" ||
      body.recovery.signerPublicKey.length === 0 ||
      typeof body.recovery.keyNumber !== "number" ||
      !Number.isInteger(body.recovery.keyNumber) ||
      body.recovery.keyNumber < 1 ||
      body.recovery.keyNumber > 0xffffffff ||
      typeof body.recovery.masterKeyId !== "string" ||
      !/^[a-f0-9]{16}$/.test(body.recovery.masterKeyId))
  ) {
    return "recovery";
  }
  if (!isKeySegment(body.streamId)) return "venue_id";
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

/** Readers with an established signer pass that key regardless of what the pointer carries. */
export function verifyPointer(pointer: SignedPointer, publicKeySpki: string): boolean {
  return (
    pointerProblem(pointer) === null &&
    verifyBytes(pointerMessage(pointer.body), pointer.signature, publicKeySpki)
  );
}

function encode(pointer: SignedPointer): Uint8Array {
  return new TextEncoder().encode(canonicalize(pointer as unknown as CanonicalValue));
}

/** The writer needs the version tag whoever signed the pointer. Readers check the signature separately. */
export async function readPointer(
  store: ObjectStore,
  streamId: string | undefined,
  call?: StoreCall & { requireRecovery?: boolean },
): Promise<{ pointer: SignedPointer; etag: string } | null> {
  const stored = await store.get(pointerKey(), call);
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
  if (streamId !== undefined && pointer.body.streamId !== streamId) throw invalid("other_venue");
  if (call?.requireRecovery && pointer.body.recovery === undefined) throw invalid("recovery");
  return { pointer, etag: stored.etag };
}

export const SENT_POINTERS_KEPT = 16;

/** Recognise recorded pointer bytes rather than trusting a node id alone. */
export class SentPointers {
  /** In the order first added, oldest first. */
  readonly #sent = new Set<string>();

  constructor(readonly persist?: (entries: string[]) => Promise<void>) {}

  snapshot(): string[] {
    return [...this.#sent];
  }

  load(value: unknown, nodeId: string): void {
    if (!Array.isArray(value)) throw invalid("sent_history");
    const entries: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") throw invalid("sent_history");
      const bytes = Buffer.from(entry, "base64");
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw invalid("sent_history");
      }
      if (pointerProblem(parsed) !== null) throw invalid("sent_history");
      if ((parsed as SignedPointer).body.nodeId === nodeId) entries.push(entry);
    }
    for (const entry of entries.slice(-SENT_POINTERS_KEPT)) this.#sent.add(entry);
  }

  add(pointer: SignedPointer): void {
    this.#sent.add(Buffer.from(encode(pointer)).toString("base64"));
    if (this.#sent.size > SENT_POINTERS_KEPT) {
      this.#sent.delete(this.#sent.values().next().value!);
    }
  }

  includes(bytes: Uint8Array): boolean {
    return this.#sent.has(Buffer.from(bytes).toString("base64"));
  }
}

/**
 * Replace `current.json` only if it is still the version this box read (`previousEtag`), or create it
 * only if there is none (`null`). A refusal is thrown (`backup.stream_precondition_failed`) unless
 * the pointer now holds exactly these bytes, which is this write answered twice, or bytes `sent`
 * holds, whose version tag is answered to retry against.
 */
export async function writePointer(
  store: ObjectStore,
  streamId: string,
  pointer: SignedPointer,
  previousEtag: string | null,
  sent?: SentPointers,
  call?: StoreCall,
): Promise<string | undefined> {
  const problem = pointerProblem(pointer);
  if (problem !== null) throw invalid(problem);
  if (pointer.body.streamId !== streamId) throw invalid("other_venue");
  const stored = await putOwnBytes(
    store,
    pointerKey(),
    encode(pointer),
    previousEtag === null ? { ifNoneMatch: "*" } : { ifMatch: previousEtag },
    sent && ((bytes) => sent.includes(bytes)),
    call,
  );
  return stored.landed ? undefined : stored.etag;
}
