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
 * our own write. Answers the version tag of what is stored.
 */
export async function putOwnBytes(
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
  condition: PutCondition,
): Promise<{ etag: string }> {
  try {
    return await store.put(key, bytes, condition);
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const current = await store.get(key);
    if (current === null || Buffer.compare(current.body, bytes) !== 0) throw error;
    return { etag: current.etag };
  }
}
