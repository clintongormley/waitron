/**
 * Promotion: how a box takes the venue for a term, and what stops two boxes taking it at once.
 *
 * A MODEL of the topology design's promotion step
 * (`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md` §5.1), not that step. It
 * keeps the two things S1 measures — a claim the store can refuse, and a generation named
 * `gen-<term>-<node-id>` (§2.2) — and drops everything else a promotion does: no restore, no seat,
 * no fiscal identity, and no node that follows the pointer afterwards.
 *
 * The fence here is ONE KEY PER TERM, claimed create-only, which is the shape plan Task 3 specifies.
 * The product's fence is a different primitive; the README section "What S1's fence is, and what it
 * is not" states the difference, and `store-cas.ts` records what the pinned store does with each.
 */
import { claimCreateOnly } from "./store-cas.ts";
import type { Store } from "./store.ts";

/** What `current.json` holds: which node owns which term, and the generation it opened. */
export type CurrentPointer = { term: number; nodeId: string; gen: string };

/**
 * Topology §2.2: "Each venue owns one prefix in the store, `venues/<venue-id>/`". `v1` is the venue
 * id plan Tasks 6, 7 and 8 write into (`venues/v1/gen-1-box-a`), so the generations this module opens
 * and the ones Litestream will later stream into share one key space rather than two. Plan Task 3
 * spelled these keys at the bucket root; the prefix is the reconciliation, dated in that task.
 */
const VENUE_PREFIX = "venues/v1/";

/** The pointer naming who holds the venue. */
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

/**
 * Take the venue for `term`, fenced by the store. A node that loses the claim writes NOTHING: no
 * generation, no pointer.
 */
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
 *
 * `base` is the CALLER's, deliberately not read here. A version each node read for itself would make
 * the control depend on the order the store serves two reads in: a node whose read landed after the
 * other node's write would see the new term, stand down, and the control would report a fence that
 * is not there. Measured in this worktree on 2026-09-17: with this function given its own
 * `readCurrent` and box-b's delayed by 300ms, `TESTCONTAINERS_RYUK_DISABLED=true node
 * src/scenarios.ts` printed
 * `| s1_double_promotion | threw | FAIL | control reproduces the double-accept: both nodes opened
 * their own generation |` and `CRITICAL failure: s1_double_promotion`. One base handed to both is
 * also what spec §4 S1 asks for — "from the same base `current.json` version handle".
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

/**
 * `current.json`, or `null` when no node has ever promoted.
 *
 * Matched on the error's NAME, where `store-cas.ts` deliberately matches a STATUS: 412 says one
 * thing only, while 404 does not. A missing BUCKET answers 404 too, and a store whose bucket has
 * gone must never read as a store where nobody has promoted. Probed in this worktree on 2026-09-17
 * with a throwaway script over a fresh `startStore()`, sending `GetObject` for an absent key and for
 * a bucket that does not exist: `missing key: name=NoSuchKey status=404`,
 * `missing bucket: name=NoSuchBucket status=404`. The NoSuchKey half is re-run by S1 itself, which
 * asserts a fresh store reads as `null`; the missing-bucket half is not, because `connect()` creates
 * the bucket. Every other failure is rethrown, so a store that is unreachable or refusing us cannot
 * pass for an empty one.
 */
export async function readCurrent(store: Store): Promise<CurrentPointer | null> {
  try {
    // The rig is this key's only writer, so its shape is not re-validated on the way back in.
    return (await store.getJson(CURRENT_KEY)) as CurrentPointer;
  } catch (error) {
    if ((error as { name?: string })?.name === "NoSuchKey") return null;
    throw error;
  }
}
