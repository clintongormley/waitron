import { randomUUID } from "node:crypto";
import { hasCode, isAppError } from "@waitron/shared";
import { isPreconditionFailure, putOwnBytes } from "./conditional.js";
import type { ListedObject, ObjectStore, StoredObject } from "./object-store.js";

/** Where the check writes its one object, under the owner's configured prefix. */
export const PROBE_PREFIX = "waitron-probe/";

export type ProbeFailure =
  | "access_denied"
  | "conditional_write_unsupported"
  | "write_failed"
  | "read_mismatch"
  | "list_failed"
  | "create_only_ignored"
  | "fresh_version_refused"
  | "if_match_ignored"
  | "delete_failed";

export type ProbeResult = { ok: true } | { ok: false; reason: ProbeFailure; detail: string };

/**
 * The settings screen's Test: write, read, list and delete one object, and prove both conditional
 * writes the stream depends on — "only if absent" refused for an object that exists, and "only if
 * unchanged" refused for a stale version. Spec §4.3 names the write, read, delete and both refusals;
 * the listing step is the plan's addition (Task 5), and it matters beyond itself: without
 * the list permission, S3 answers a read of a missing key with 403 rather than 404 (the client's own
 * GetObject documentation), so the pointer's "nothing written yet" would read as a failure.
 *
 * A refusal counts only if the object still holds what it held before: a store that applies a write
 * and then answers it as refused has not honoured the condition.
 *
 * A bucket that gives no answer at all (the store's `backup.stream_request_failed` with no status)
 * is not a refusal, so it is THROWN rather than reported: callers tell "unreachable" from "refused".
 */
export async function probeBucket(
  store: ObjectStore,
  nonce: string = randomUUID(),
): Promise<ProbeResult> {
  const key = `${PROBE_PREFIX}${nonce}.json`;
  const bytes = (step: string) => new TextEncoder().encode(JSON.stringify({ probe: nonce, step }));
  const first = bytes("create");
  let written = false;
  try {
    let version: string;
    try {
      version = (await putOwnBytes(store, key, first, { ifNoneMatch: "*" })).etag;
      written = true;
    } catch (error) {
      return failed(error, "write");
    }

    let read: StoredObject | null;
    try {
      read = await store.get(key);
    } catch (error) {
      return failed(error, "read");
    }
    if (read === null) return refuse("read_mismatch", "the object just written was not found");
    if (Buffer.compare(read.body, first) !== 0) {
      return refuse("read_mismatch", "the object read back differs from what was written");
    }

    let listed: ListedObject[];
    try {
      listed = await store.list(PROBE_PREFIX);
    } catch (error) {
      return failed(error, "list");
    }
    if (!listed.some((object) => object.key === key)) {
      return refuse("list_failed", "the listing does not show the object just written");
    }

    const again = await attempt(() => store.put(key, bytes("create-again"), { ifNoneMatch: "*" }));
    if (again === "accepted") {
      return refuse(
        "create_only_ignored",
        "a write only-if-absent replaced an object that existed",
      );
    }
    if (again !== "refused") return failed(again.error, "write");
    const createOnlyChanged = await changedSince(store, key, first, "create_only_ignored");
    if (createOnlyChanged) return createOnlyChanged;

    const replacement = bytes("replace");
    const fresh = await attempt(() => putOwnBytes(store, key, replacement, { ifMatch: version }));
    if (fresh === "refused") {
      return refuse(
        "fresh_version_refused",
        "a write only-if-unchanged was refused although nothing had changed",
      );
    }
    if (fresh !== "accepted") return failed(fresh.error, "write");

    const stale = await attempt(() => store.put(key, bytes("stale"), { ifMatch: version }));
    if (stale === "accepted") {
      return refuse(
        "if_match_ignored",
        "a write only-if-unchanged replaced an object that had changed",
      );
    }
    if (stale !== "refused") return failed(stale.error, "write");
    const ifMatchChanged = await changedSince(store, key, replacement, "if_match_ignored");
    if (ifMatchChanged) return ifMatchChanged;

    let after: StoredObject | null;
    try {
      await store.delete(key);
      after = await store.get(key);
    } catch (error) {
      return failed(error, "delete");
    }
    if (after !== null)
      return refuse("delete_failed", "the object was still there after it was deleted");
    written = false;
    return { ok: true };
  } finally {
    if (written) {
      try {
        await store.delete(key);
      } catch {
        // The probe's answer stands over a failed clean-up.
      }
    }
  }
}

function refuse(reason: ProbeFailure, detail: string): ProbeResult {
  return { ok: false, reason, detail };
}

async function changedSince(
  store: ObjectStore,
  key: string,
  before: Uint8Array,
  ignored: ProbeFailure,
): Promise<ProbeResult | undefined> {
  let current: StoredObject | null;
  try {
    current = await store.get(key);
  } catch (error) {
    return failed(error, "read");
  }
  if (current === null || Buffer.compare(current.body, before) !== 0) {
    return refuse(ignored, "a write answered as refused changed the object anyway");
  }
  return undefined;
}

async function attempt(
  write: () => Promise<unknown>,
): Promise<"accepted" | "refused" | { error: unknown }> {
  try {
    await write();
    return "accepted";
  } catch (error) {
    return isPreconditionFailure(error) ? "refused" : { error };
  }
}

type Step = "write" | "read" | "list" | "delete";

const STEP_FAILURE: Record<Step, ProbeFailure> = {
  write: "write_failed",
  read: "read_mismatch",
  list: "list_failed",
  delete: "delete_failed",
};

function failed(error: unknown, step: Step): ProbeResult {
  const otherwise = STEP_FAILURE[step];
  if (isAppError(error) && hasCode(error, "backup.stream_request_failed")) {
    const { status, name } = error.params;
    if (status === null) throw error;
    const detail = `${name} (${status})`;
    // A 403 on the listing is the missing list permission; it is reported as the listing's failure.
    if (status === 403 && step !== "list") return refuse("access_denied", detail);
    // Every write the check makes carries a condition, so a 501 on a write is reported as conditional
    // writes unsupported — as is a 501 about some other part of the write.
    if (status === 501 && step === "write") return refuse("conditional_write_unsupported", detail);
    return refuse(otherwise, detail);
  }
  return refuse(otherwise, error instanceof Error ? error.message : String(error));
}
