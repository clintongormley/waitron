import { randomUUID } from "node:crypto";
import { canonicalize } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { holdsExactly, isPreconditionFailure } from "./conditional.js";
import { parseGenerationName, venuePrefix } from "./names.js";
import type { ObjectStore } from "./object-store.js";

/** How many deletes a prune keeps in flight at once. */
export const PRUNE_CONCURRENCY = 8;

function parsed(field: string, generation: string): { term: number; nodeId: string } {
  const name = parseGenerationName(generation);
  if (name === null) throw new AppError("backup.stream_name_invalid", { field, value: generation });
  return name;
}

/** The folder Litestream streams a generation into, relative to the configured prefix. */
export function generationPrefix(venueId: string, generation: string): string {
  parsed("generation", generation);
  return `${venuePrefix(venueId)}${generation}/`;
}

export function markerKey(venueId: string, generation: string): string {
  return `${generationPrefix(venueId, generation)}opened.json`;
}

/**
 * Open a generation by creating its marker "only if absent". A folder that already has one is never
 * written into: the claim is refused (`backup.stream_precondition_failed`) and the box must not start
 * Litestream there. The nonce makes this claim's bytes unlike any other box's, so a refusal of our own
 * landed write can be told from a real loss.
 */
export async function claimGeneration(
  store: ObjectStore,
  venueId: string,
  generation: string,
): Promise<void> {
  const { term, nodeId } = parsed("generation", generation);
  const key = markerKey(venueId, generation);
  const bytes = new TextEncoder().encode(
    canonicalize({ generation, venueId, term, nodeId, nonce: randomUUID() }),
  );
  try {
    await store.put(key, bytes, { ifNoneMatch: "*" });
  } catch (error) {
    if (isPreconditionFailure(error) && (await holdsExactly(store, key, bytes))) return;
    throw error;
  }
}

/**
 * Delete every generation of this venue whose newest object is older than `windowMs` before `now`,
 * except `live` — the one the pointer names. Litestream tidies only the generation it writes (spec
 * §4.4). Only folders whose name is a generation name are ever touched; `current.json` and anything
 * else at the venue's root are not. Answers the names deleted, in order.
 */
export async function pruneGenerations(
  store: ObjectStore,
  venueId: string,
  live: string,
  now: Date,
  windowMs: number,
): Promise<string[]> {
  parsed("live", live);
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new AppError("backup.stream_name_invalid", {
      field: "windowMs",
      value: String(windowMs),
    });
  }
  const root = venuePrefix(venueId);
  const newest = new Map<string, number>();
  const keys = new Map<string, string[]>();
  for (const object of await store.list(root)) {
    const rest = object.key.slice(root.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const name = rest.slice(0, slash);
    if (parseGenerationName(name) === null) continue;
    newest.set(
      name,
      Math.max(newest.get(name) ?? Number.NEGATIVE_INFINITY, object.lastModified.getTime()),
    );
    let list = keys.get(name);
    if (list === undefined) keys.set(name, (list = []));
    list.push(object.key);
  }
  const cutoff = now.getTime() - windowMs;
  const doomed = [...newest]
    .filter(([name, time]) => name !== live && time < cutoff)
    .map(([name]) => name)
    .sort();
  for (const name of doomed) {
    // The marker goes last, so a prune interrupted partway leaves a generation that had a marker still
    // claimed.
    const marker = markerKey(venueId, name);
    const all = keys.get(name)!;
    await deleteAll(
      store,
      all.filter((key) => key !== marker),
    );
    if (all.includes(marker)) await store.delete(marker);
  }
  return doomed;
}

/** Stops starting deletes at the first failure, and answers only once those in flight have settled. */
async function deleteAll(store: ObjectStore, keys: string[]): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < keys.length) {
      const key = keys[next]!;
      next += 1;
      try {
        await store.delete(key);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(PRUNE_CONCURRENCY, keys.length) }, worker);
  const outcomes = await Promise.allSettled(workers);
  const refusal = outcomes.find((outcome) => outcome.status === "rejected");
  if (refusal !== undefined) throw refusal.reason;
}
