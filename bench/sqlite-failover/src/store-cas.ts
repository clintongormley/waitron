import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { PutObjectCommandOutput } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

const RACERS = 8;

export type IfMatchObservation = "refuses-stale" | "accepts-stale" | "not-established";

export type CasReport = {
  createOnly: boolean;
  ifMatch: IfMatchObservation;
  ifMatchNote: string;
  raceWinners: number;
  racers: number;
  /**
   * The control: how many of the same race were ACCEPTED with no condition attached. A 412 is not a
   * win — `conditionalPut` resolves rather than rejects on one, so settling is not enough to count.
   */
  unfencedWinners: number;
};

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

/**
 * Sealed off from the rest of the probe on purpose. Whatever a store does with an `If-Match` it does
 * not implement — ignore it, refuse every one, or answer with an error — the seal keeps it out of
 * the create-only measurement, which is the critical one and the only one this rig's fence needs.
 */
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
