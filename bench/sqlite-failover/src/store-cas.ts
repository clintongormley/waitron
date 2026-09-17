/**
 * The store's conditional write: the only fence standing between two boxes that both believe they
 * are the venue's primary. A promotion claims a key that must not already exist, so what matters is
 * whether the store REFUSES the second writer rather than silently overwriting the first.
 *
 * Every fact here is a fact about MinIO on the tag `store.ts` pins, established by running this
 * probe — not about S3 in general. The results note (plan Task 10) carries the standing obligation
 * to re-run it against whichever store Waitron Cloud actually picks.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

/** Enough concurrency that a store serialising claims one-by-one would still have to pick a winner. */
const RACERS = 8;

export type CasReport = {
  /** A second create-only PUT of an existing key was refused. */
  createOnly: boolean;
  /** A PUT carrying a stale ETag was refused while the fresh one was accepted. */
  ifMatch: boolean;
  /** How many of `racers` concurrent create-only claims on one fresh key succeeded. */
  raceWinners: number;
  racers: number;
  /** The control: how many of the same race succeeded with no condition attached. */
  unfencedWinners: number;
};

/**
 * MinIO answers a failed pre-condition with HTTP 412 and `PreconditionFailed`, observed on the
 * pinned image for BOTH refusals this module makes:
 * `{"name":"PreconditionFailed","Code":"PreconditionFailed","status":412,
 *   "message":"At least one of the pre-conditions you specified did not hold"}`.
 * The status is what is matched: the name is the SDK's rendering of the error code, and a store
 * that answered 412 under another name would still be fencing correctly.
 */
function isPreconditionFailed(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}

/**
 * Claim `key` by creating it, or lose. Only a pre-condition refusal counts as losing — any other
 * failure is rethrown, so a store that is unreachable or misconfigured can never be mistaken for a
 * store that fenced a racer.
 */
export async function claimCreateOnly(
  store: Store,
  key: string,
  body: string,
): Promise<"won" | "lost"> {
  try {
    await store.client.send(
      new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: body, IfNoneMatch: "*" }),
    );
    return "won";
  } catch (error) {
    if (isPreconditionFailed(error)) return "lost";
    throw error;
  }
}

async function put(store: Store, key: string, body: string, condition?: { IfMatch: string }) {
  return store.client.send(
    new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: body, ...condition }),
  );
}

async function refusedStaleEtag(store: Store, key: string): Promise<boolean> {
  try {
    await put(store, key, "stale-etag", { IfMatch: '"not-the-etag"' });
    return false;
  } catch (error) {
    if (isPreconditionFailed(error)) return true;
    throw error;
  }
}

/**
 * Runs each probe against its own fresh key, so no probe can be handed a state an earlier one left.
 */
export async function probeConditionalWrites(store: Store): Promise<CasReport> {
  const first = await claimCreateOnly(store, "probe/create-only", "first");
  const second = await claimCreateOnly(store, "probe/create-only", "second");

  // The ETag comes back on the PUT itself; it matched the subsequent HEAD on the pinned image, so
  // no extra round trip is made for it.
  const created = await put(store, "probe/if-match", "one");
  const etag = created.ETag;
  let ifMatch = false;
  if (etag) {
    await put(store, "probe/if-match", "two", { IfMatch: etag });
    ifMatch = await refusedStaleEtag(store, "probe/if-match");
  }

  const raced = await Promise.all(
    Array.from({ length: RACERS }, (_unused, i) =>
      claimCreateOnly(store, "probe/race", `racer-${i}`),
    ),
  );
  // Settled, not `Promise.all`: a count derived from the results is a measurement, where
  // `RACERS` returned from a call that would have thrown on any failure is true by construction.
  const unfenced = await Promise.allSettled(
    Array.from({ length: RACERS }, (_unused, i) => put(store, "probe/race-unfenced", `racer-${i}`)),
  );

  return {
    createOnly: first === "won" && second === "lost",
    ifMatch,
    raceWinners: raced.filter((r) => r === "won").length,
    racers: RACERS,
    unfencedWinners: unfenced.filter((r) => r.status === "fulfilled").length,
  };
}
