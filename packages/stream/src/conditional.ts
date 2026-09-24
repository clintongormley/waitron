import { isAppError } from "@waitron/shared";
import type { ObjectStore } from "./object-store.js";

export function isPreconditionFailure(error: unknown): boolean {
  return isAppError(error) && error.code === "backup.stream_precondition_failed";
}

/**
 * Whether `key` now holds exactly `bytes`. A conditional write refused with 412 can be this caller's
 * own write answered twice: the S3 client resends after a server error by default, so an attempt that
 * landed and lost its answer is followed by a resend the store refuses. Every conditional write in
 * this package carries bytes only its writer can produce — a pointer signed with the writer's own key,
 * or a marker with a random nonce — so equal bytes mean the refusal was of our own write.
 */
export async function holdsExactly(
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const current = await store.get(key);
  return current !== null && Buffer.compare(Buffer.from(current.body), Buffer.from(bytes)) === 0;
}
