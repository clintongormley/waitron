import assert from "node:assert";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import { promote, promoteUnfenced, readCurrent } from "../promotion.ts";

const NODES = ["box-a", "box-b"] as const;
/** Two terms rather than one, so the control's keys cannot be mistaken for the fenced race's. */
const FENCED_TERM = 5;
const UNFENCED_TERM = 6;
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

    assert.deepEqual(
      await readCurrent(store),
      { term: FENCED_TERM, nodeId: winner, gen: `gen-${FENCED_TERM}-${winner}` },
      "current.json names the winner's generation",
    );

    // Read the store to catch any write by the loser even if its call correctly returned `lost`.
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

    // A later caller must be refused by the control's own check, or the shared-base race would
    // prove nothing.
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
