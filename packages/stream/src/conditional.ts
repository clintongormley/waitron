import { isAppError } from "@waitron/shared";
import type { ObjectStore, PutCondition } from "./object-store.js";

export function isPreconditionFailure(error: unknown): boolean {
  return isAppError(error) && error.code === "backup.stream_precondition_failed";
}

/**
 * A conditional put that also succeeds when its 412 is this caller's own write answered twice: the S3
 * client resends after a server error by default, so an attempt that landed and lost its answer is
 * followed by a resend the store refuses. Every caller's bytes are ones only it can produce — a
 * pointer signed with the writer's own key, or a random nonce — so equal bytes mean the refusal was of
 * our own write. Answers the version tag of what is stored. With `sentEarlier`, a refusal while the
 * key holds bytes it accepts answers that version too, with `landed: false`, from the same read.
 */
export async function putOwnBytes(
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
  condition: PutCondition,
  sentEarlier?: (stored: Uint8Array) => boolean,
): Promise<{ etag: string; landed: boolean }> {
  try {
    return { etag: (await store.put(key, bytes, condition)).etag, landed: true };
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const current = await store.get(key);
    if (current === null) throw error;
    if (Buffer.compare(current.body, bytes) === 0) return { etag: current.etag, landed: true };
    if (sentEarlier?.(current.body) === true) return { etag: current.etag, landed: false };
    throw error;
  }
}
