// S1: two boxes reach the same term while partitioned from each other — the offline double
// promotion (spec §4, S1) — and both try to take the venue. Only the store is in a position to
// refuse one of them, so this scenario measures whether that refusal holds, and what the store looks
// like when it is taken away.
//
// The fence measured here is the RIG's, not the product's; the README section "What S1's fence is,
// and what it is not" states the difference and what follows from it.
//
// Every key this scenario expects is spelled out as a literal rather than built from the functions
// under test. Asking `promotion.ts` where it puts its keys and then checking it put them there would
// hold whatever those functions did, including dropping the venue prefix entirely.
import assert from "node:assert";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import { promote, promoteUnfenced, readCurrent } from "../promotion.ts";

const NODES = ["box-a", "box-b"] as const;
/** Two terms rather than one, so the control's keys cannot be mistaken for the fenced race's. */
const FENCED_TERM = 5;
const UNFENCED_TERM = 6;
/** Topology §2.2 gives each venue one prefix in the store; `v1` is this rig's venue. */
const VENUE = "venues/v1";

export default async function doublePromotion({
  startStore,
}: ScenarioContext): Promise<ScenarioResult> {
  const store = await startStore();
  try {
    assert.strictEqual(await readCurrent(store), null, "a fresh store holds no pointer");

    const raced = await Promise.all(NODES.map((nodeId) => promote(store, FENCED_TERM, nodeId)));
    const winners = NODES.filter((_unused, index) => raced[index] === "won");
    assert.equal(winners.length, 1, "exactly one node wins the term");
    const winner = winners[0];

    // Not merely "some node won": the pointer names the node whose own call returned "won", and
    // names its generation the way topology §2.2 requires. A fence that told box-a it had won while
    // publishing box-b would satisfy a looser assertion.
    assert.deepEqual(
      await readCurrent(store),
      { term: FENCED_TERM, nodeId: winner, gen: `gen-${FENCED_TERM}-${winner}` },
      "current.json names the winner's generation",
    );

    // The loser commits no promotion (spec §4, S1) — and "lost" is only the loser's own word for
    // that. The store is read back instead: every key it holds, then the body of each key the loser
    // could have reached. Keys alone would not do this job twice over — a losing node writing INSIDE
    // the winner's generation adds no new key, and one overwriting the winner's marker changes no
    // key at all.
    const afterFenced = (await store.listKeys("")).sort();
    assert.deepEqual(
      afterFenced,
      [
        `${VENUE}/claims/term-${FENCED_TERM}.json`,
        `${VENUE}/current.json`,
        `${VENUE}/gen-${FENCED_TERM}-${winner}/OWNER`,
      ].sort(),
      "the loser created no key anywhere in the store",
    );
    assert.deepEqual(
      await store.getJson(`${VENUE}/claims/term-${FENCED_TERM}.json`),
      { term: FENCED_TERM, nodeId: winner },
      "the claim still carries the winner's name",
    );
    assert.deepEqual(
      await store.getJson(`${VENUE}/gen-${FENCED_TERM}-${winner}/OWNER`),
      { term: FENCED_TERM, nodeId: winner },
      "the winner's generation still carries the winner's name",
    );

    // CONTROL — the same race with the store's refusal replaced by a plain read-check-write
    // (spec §4, S1). One base is read here and handed to both nodes, which is what "promote from the
    // same base" means and what keeps the control off the order the store serves two reads in.
    const base = await readCurrent(store);
    const control = await Promise.all(
      NODES.map((nodeId) => promoteUnfenced(store, UNFENCED_TERM, nodeId, base)),
    );
    const afterControl = (await store.listKeys("")).sort();
    assert.deepEqual(
      afterControl.filter((key) => !afterFenced.includes(key)),
      NODES.map((nodeId) => `${VENUE}/gen-${UNFENCED_TERM}-${nodeId}/OWNER`).sort(),
      "control reproduces the double-accept: both nodes opened their own generation",
    );
    const controlWinners = control.filter((result) => result === "won").length;
    assert.equal(controlWinners, NODES.length, "control: each node believes it won");

    // The control's own check has to be capable of refusing, or "both nodes passed it" says nothing.
    // A third box holding a base that is already at this term stands down and writes nothing — which
    // is exactly what the two racers would have done had either of them read AFTER the other wrote,
    // and why the base is read once above instead of twice.
    const standDown = await promoteUnfenced(
      store,
      UNFENCED_TERM,
      "box-c",
      await readCurrent(store),
    );
    assert.equal(standDown, "lost", "a node whose base already holds this term stands down");
    assert.deepEqual(
      (await store.listKeys("")).sort(),
      afterControl,
      "the node that stood down wrote nothing",
    );

    return {
      id: "S1",
      title: "double promotion fenced by the store's conditional write",
      verdict: "PASS",
      critical: true,
      detail: `fenced: winners=${winners.length}/${NODES.length} winner=${winner} store-keys=${afterFenced.length}; control: winners=${controlWinners}/${NODES.length} store-keys=${afterControl.length}`,
    };
  } finally {
    await store.stop();
  }
}
