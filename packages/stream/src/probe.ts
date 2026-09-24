import { randomUUID } from "node:crypto";
import { hasCode, isAppError } from "@waitron/shared";
import { isPreconditionFailure } from "./conditional.js";
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
 * The settings screen's Test (spec §4.3): write, read, list and delete one object, and prove both
 * conditional writes the stream depends on — "only if absent" refused for an object that exists, and
 * "only if unchanged" refused for a stale version. The listing step matters beyond itself: without
 * the list permission, S3 answers a read of a missing key with 403 rather than 404 (the client's own
 * GetObject documentation), so the pointer's "nothing written yet" would read as a failure.
 *
 * A bucket that gives no answer at all (the store's `backup.stream_request_failed` with no status)
 * is not a refusal, so it is THROWN rather than reported: callers tell "unreachable" from "refused".
 */
export async function probeBucket(
  store: ObjectStore,
  nonce: string = randomUUID(),
): Promise<ProbeResult> {
  const key = `${PROBE_PREFIX}${nonce}.json`;
  const state = { written: false };
  try {
    return await steps(store, key, nonce, state);
  } finally {
    if (state.written) await store.delete(key).catch(() => undefined);
  }
}

async function steps(
  store: ObjectStore,
  key: string,
  nonce: string,
  state: { written: boolean },
): Promise<ProbeResult> {
  const bytes = (step: string) => new TextEncoder().encode(JSON.stringify({ probe: nonce, step }));
  const first = bytes("create");

  let version: string;
  try {
    version = (await store.put(key, first, { ifNoneMatch: "*" })).etag;
    state.written = true;
  } catch (error) {
    return failed(error, "write");
  }

  let read: StoredObject | null;
  try {
    read = await store.get(key);
  } catch (error) {
    return failed(error, "read");
  }
  if (read === null)
    return { ok: false, reason: "read_mismatch", detail: "the object just written was not found" };
  if (Buffer.compare(Buffer.from(read.body), Buffer.from(first)) !== 0) {
    return {
      ok: false,
      reason: "read_mismatch",
      detail: "the object read back differs from what was written",
    };
  }

  let listed: ListedObject[];
  try {
    listed = await store.list(PROBE_PREFIX);
  } catch (error) {
    return failed(error, "list");
  }
  if (!listed.some((object) => object.key === key)) {
    return {
      ok: false,
      reason: "list_failed",
      detail: "the listing does not show the object just written",
    };
  }

  const again = await attempt(() => store.put(key, bytes("create-again"), { ifNoneMatch: "*" }));
  if (again === "accepted")
    return {
      ok: false,
      reason: "create_only_ignored",
      detail: "a write only-if-absent replaced an object that existed",
    };
  if (again !== "refused") return failed(again.error, "write");

  const fresh = await attempt(() => store.put(key, bytes("replace"), { ifMatch: version }));
  if (fresh === "refused") {
    return {
      ok: false,
      reason: "fresh_version_refused",
      detail: "a write only-if-unchanged was refused although nothing had changed",
    };
  }
  if (fresh !== "accepted") return failed(fresh.error, "write");

  const stale = await attempt(() => store.put(key, bytes("stale"), { ifMatch: version }));
  if (stale === "accepted")
    return {
      ok: false,
      reason: "if_match_ignored",
      detail: "a write only-if-unchanged replaced an object that had changed",
    };
  if (stale !== "refused") return failed(stale.error, "write");

  let after: StoredObject | null;
  try {
    await store.delete(key);
    after = await store.get(key);
  } catch (error) {
    return failed(error, "delete");
  }
  if (after !== null)
    return {
      ok: false,
      reason: "delete_failed",
      detail: "the object was still there after it was deleted",
    };
  state.written = false;
  return { ok: true };
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
    if (status === 403 && step !== "list") return { ok: false, reason: "access_denied", detail };
    // Every write the check makes is conditional, so a write the store does not implement is one.
    if (status === 501 && step === "write") {
      return { ok: false, reason: "conditional_write_unsupported", detail };
    }
    return { ok: false, reason: otherwise, detail };
  }
  return {
    ok: false,
    reason: otherwise,
    detail: error instanceof Error ? error.message : String(error),
  };
}
