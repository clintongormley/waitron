import { claimCreateOnly } from "./store-cas.ts";
import type { Store } from "./store.ts";

export type CurrentPointer = { term: number; nodeId: string; gen: string };

const VENUE_PREFIX = "venues/v1/";

const CURRENT_KEY = `${VENUE_PREFIX}current.json`;

/** One key per term, so a claim can be created once rather than compared and swapped. */
function claimKey(term: number): string {
  return `${VENUE_PREFIX}claims/term-${term}.json`;
}

function generationName(term: number, nodeId: string): string {
  return `gen-${term}-${nodeId}`;
}

/**
 * An object inside the generation's own path, so a promotion leaves a trace in the store's key space
 * that outlives `current.json` being overwritten by a later term. That trace is what lets S1 count
 * promotions by reading the store rather than by asking the nodes.
 */
function generationMarkerKey(term: number, nodeId: string): string {
  return `${VENUE_PREFIX}${generationName(term, nodeId)}/OWNER`;
}

/**
 * The generation first, then the pointer. In the product `current.json` names the generation a
 * returning node restores from (topology §2.2), so publishing the pointer first would name a path
 * that is not there yet. Nothing in this rig follows the pointer, so that ordering is the product's
 * invariant modelled here, not something S1 measures.
 */
async function activate(store: Store, term: number, nodeId: string): Promise<void> {
  await store.putJson(generationMarkerKey(term, nodeId), { term, nodeId });
  const pointer: CurrentPointer = { term, nodeId, gen: generationName(term, nodeId) };
  await store.putJson(CURRENT_KEY, pointer);
}

export async function promote(store: Store, term: number, nodeId: string): Promise<"won" | "lost"> {
  const claim = await claimCreateOnly(store, claimKey(term), JSON.stringify({ term, nodeId }));
  if (claim === "lost") return "lost";
  await activate(store, term, nodeId);
  return "won";
}

/**
 * The CONTROL: the same promotion with the store's refusal replaced by a plain read-check-write
 * (spec §4, S1). The check is the one anyone would write, and that is the point — two nodes holding
 * the same base both pass it.
 */
export async function promoteUnfenced(
  store: Store,
  term: number,
  nodeId: string,
  base: CurrentPointer | null,
): Promise<"won" | "lost"> {
  if (base !== null && base.term >= term) return "lost";
  await activate(store, term, nodeId);
  return "won";
}

export async function readCurrent(store: Store): Promise<CurrentPointer | null> {
  try {
    return (await store.getJson(CURRENT_KEY)) as CurrentPointer;
  } catch (error) {
    if ((error as { name?: string })?.name === "NoSuchKey") return null;
    throw error;
  }
}
