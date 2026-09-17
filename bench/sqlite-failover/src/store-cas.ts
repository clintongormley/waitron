/**
 * The store's conditional write: the fence the prototype's promotion step uses to stop two boxes
 * both believing they are the venue's primary. What matters is whether the store REFUSES the second
 * writer rather than silently overwriting the first.
 *
 * Every value the report below carries is a fact about MinIO on the tag `store.ts` pins, established
 * by running the probe; the claims about anything else name their source. Re-running this against
 * whichever store Waitron Cloud eventually picks is an obligation the results note (plan Task 10)
 * will record — that note does not exist yet.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { PutObjectCommandOutput } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

/** N=8, the count plan Task 2 pins. */
const RACERS = 8;

/**
 * What the store did with a compare-and-swap PUT. Three outcomes rather than a boolean because
 * "refused a stale ETag" and "we never got an answer" are different facts, and the results note
 * (plan Task 10) will transcribe this value: a boolean would let a reader take a store that errored
 * for a store that accepts stale ETags.
 */
export type IfMatchObservation = "refuses-stale" | "accepts-stale" | "not-established";

export type CasReport = {
  /** A second create-only PUT of an existing key was refused. */
  createOnly: boolean;
  /**
   * Recorded, not required BY S1: plan Task 3's fence claims a per-term key create-only, so this
   * value gates nothing in the rig. The product's fence is a different shape — a version-conditional
   * write of `current.json` (2026-09-16-sqlite-litestream-topology-design.md §5.1), which is
   * compare-and-swap and so does need this.
   */
  ifMatch: IfMatchObservation;
  /** Why `not-established`: the store's message when it threw, else what the probe saw. Empty otherwise. */
  ifMatchNote: string;
  /** How many of `racers` create-only claims, all issued before any was awaited, succeeded. */
  raceWinners: number;
  racers: number;
  /**
   * The control: how many of the same race were ACCEPTED with no condition attached. A 412 is not a
   * win — `conditionalPut` resolves rather than rejects on one, so settling is not enough to count.
   */
  unfencedWinners: number;
};

/**
 * MinIO answers a failed pre-condition with HTTP 412 and `PreconditionFailed`, observed on the
 * pinned image for both refusals this module makes:
 * `{"name":"PreconditionFailed","Code":"PreconditionFailed","status":412,
 *   "message":"At least one of the pre-conditions you specified did not hold"}`.
 * The status is what is matched: the name is the SDK's rendering of the error code, and a store
 * that answered 412 under another name would still be fencing correctly.
 *
 * A `409 Conflict` is NOT a lost claim — it is a retry. That is the caveat the topology design
 * flags as one the implementation must not get wrong, in the conditional-write provenance block
 * before its `## Provenance` heading: "a concurrent request can return `409 Conflict` rather than
 * `412`, when a delete on that object completes before the conditional write does … The `412` is
 * the loss; the `409` is a retry." So a 409 is rethrown rather than counted as a loss — except
 * inside `probeIfMatch`, which seals every answer it does not recognise into its note. No 409 was
 * seen in the S6 run of 2026-09-17.
 */
function isPreconditionFailed(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}

/**
 * One PUT, conditional or not. `"refused"` means the store answered 412; every other failure is
 * rethrown, so a store that is unreachable or misconfigured can never be mistaken for a store that
 * fenced a writer.
 */
async function conditionalPut(
  store: Store,
  key: string,
  body: string,
  condition: { IfNoneMatch: string } | { IfMatch: string } | Record<string, never>,
): Promise<PutObjectCommandOutput | "refused"> {
  try {
    return await store.client.send(
      new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: body, ...condition }),
    );
  } catch (error) {
    if (isPreconditionFailed(error)) return "refused";
    throw error;
  }
}

/**
 * Claim `key` by creating it, or lose. This is the primitive a promotion claims its term with.
 */
export async function claimCreateOnly(
  store: Store,
  key: string,
  body: string,
): Promise<"won" | "lost"> {
  const result = await conditionalPut(store, key, body, { IfNoneMatch: "*" });
  return result === "refused" ? "lost" : "won";
}

/** An Error with an empty message would otherwise record `not-established` with no reason at all. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message || error.constructor.name;
}

/**
 * Sealed off from the rest of the probe on purpose. Whatever a store does with an `If-Match` it does
 * not implement — ignore it, refuse every one, or answer with an error — the seal keeps it out of
 * the create-only measurement, which is the critical one and the only one this rig's fence needs.
 * The three outcomes below say which was seen. Measured by injecting a 501 on this path: the run
 * still records `create-only=true`, where without the seal it recorded a thrown scenario and no
 * create-only value at all.
 */
async function probeIfMatch(
  store: Store,
): Promise<{ observation: IfMatchObservation; note: string }> {
  const key = "probe/if-match";
  try {
    // The PUT response carries the ETag, so no HEAD is needed for it.
    const created = await conditionalPut(store, key, "one", {});
    if (created === "refused")
      return { observation: "not-established", note: "412 on a plain PUT" };
    if (!created.ETag)
      return { observation: "not-established", note: "no ETag on the PUT response" };

    const fresh = await conditionalPut(store, key, "two", { IfMatch: created.ETag });
    if (fresh === "refused") {
      return { observation: "not-established", note: "the fresh ETag was itself refused" };
    }
    const stale = await conditionalPut(store, key, "three", { IfMatch: '"not-the-etag"' });
    return stale === "refused"
      ? { observation: "refuses-stale", note: "" }
      : { observation: "accepts-stale", note: "" };
  } catch (error) {
    return { observation: "not-established", note: describe(error) };
  }
}

/**
 * One key per probe, and those keys are fresh only because `startStore()` gives each scenario its
 * own container (`store.ts`). Called twice against one store this reports `createOnly: false`, so
 * the scenario supplies a new store.
 *
 * The critical measurements run FIRST: if the store dies, they throw rather than being skipped in
 * favour of the optional one.
 */
export async function probeConditionalWrites(store: Store): Promise<CasReport> {
  const first = await claimCreateOnly(store, "probe/create-only", "first");
  const second = await claimCreateOnly(store, "probe/create-only", "second");

  const raced = await Promise.all(
    Array.from({ length: RACERS }, (_unused, index) =>
      claimCreateOnly(store, "probe/race", `racer-${index}`),
    ),
  );
  // The control is settled rather than `Promise.all`ed: a count derived from the results is a
  // measurement, where `RACERS` returned from a call that would have thrown on any failure is true
  // by construction. It runs after the fenced race rather than alongside it, because a control
  // should differ from its experiment in exactly one thing and racing both bursts together would
  // add the other burst's load as a second difference.
  const unfenced = await Promise.allSettled(
    Array.from({ length: RACERS }, (_unused, index) =>
      conditionalPut(store, "probe/race-unfenced", `racer-${index}`, {}),
    ),
  );

  const ifMatch = await probeIfMatch(store);

  return {
    createOnly: first === "won" && second === "lost",
    ifMatch: ifMatch.observation,
    ifMatchNote: ifMatch.note,
    raceWinners: raced.filter((r) => r === "won").length,
    racers: RACERS,
    unfencedWinners: unfenced.filter((r) => r.status === "fulfilled" && r.value !== "refused")
      .length,
  };
}
