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

// The marker lets the control detect a generation even after a later promotion overwrites the
// pointer.
function generationMarkerKey(term: number, nodeId: string): string {
  return `${VENUE_PREFIX}${generationName(term, nodeId)}/OWNER`;
}

// Publish the generation before the pointer so a reader never follows it to a missing generation.
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

// Both control racers may read the same base before either writes, which exposes the gap in the
// read-check-write sequence.
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

// Match absence by error name because a 404 can refer to something other than a missing pointer.
export async function readCurrent(store: Store): Promise<CurrentPointer | null> {
  try {
    return (await store.getJson(CURRENT_KEY)) as CurrentPointer;
  } catch (error) {
    if ((error as { name?: string })?.name === "NoSuchKey") return null;
    throw error;
  }
}
