import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { PutObjectCommandOutput } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

const RACERS = 8;

// Keep a store refusal distinct from an inconclusive probe, such as one that never got an answer.
export type IfMatchObservation = "refuses-stale" | "accepts-stale" | "not-established";

export type CasReport = {
  createOnly: boolean;
  // The promotion model uses create-only, so the stale-ETag result is recorded separately.
  ifMatch: IfMatchObservation;
  ifMatchNote: string;
  raceWinners: number;
  racers: number;
  // Count accepted writes because a refused write also resolves.
  unfencedWinners: number;
};

// Match HTTP 412 to distinguish a rejected condition from other SDK failures.
function isPreconditionFailed(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}

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

export async function claimCreateOnly(
  store: Store,
  key: string,
  body: string,
): Promise<"won" | "lost"> {
  const result = await conditionalPut(store, key, body, { IfNoneMatch: "*" });
  return result === "refused" ? "lost" : "won";
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message || error.constructor.name;
}

// Probe ETag support separately so a store that lacks it can still establish create-only support.
async function probeIfMatch(
  store: Store,
): Promise<{ observation: IfMatchObservation; note: string }> {
  const key = "probe/if-match";
  try {
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

// The probe needs unused keys, which each scenario gets from a fresh store.
export async function probeConditionalWrites(store: Store): Promise<CasReport> {
  const first = await claimCreateOnly(store, "probe/create-only", "first");
  const second = await claimCreateOnly(store, "probe/create-only", "second");

  const raced = await Promise.all(
    Array.from({ length: RACERS }, (_unused, index) =>
      claimCreateOnly(store, "probe/race", `racer-${index}`),
    ),
  );
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
