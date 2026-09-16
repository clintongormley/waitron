// Smoke: the three things every other scenario stands on — a running object store, a SQLite node,
// and one hash-linked ledger row. It asserts nothing about the failover loop; if it fails, no other
// verdict in the run means anything.
import assert from "node:assert";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import { openNode, recordSale } from "../model.ts";

export default async function smoke({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const store = await startStore();
  try {
    const db = openNode("node-a");
    const first = recordSale(db, 500);
    assert.equal(first.secuencia, 1, "the first record on a fresh chain is secuencia 1");
    assert.match(first.huella, /^[0-9a-f]{64}$/, "the toy huella is a sha256 hex digest");

    const second = recordSale(db, 250);
    assert.equal(second.secuencia, 2, "the chain advances");
    assert.notEqual(second.huella, first.huella, "each record hashes to its own huella");

    await store.putJson("smoke.json", { hello: "store" });
    assert.deepEqual(
      await store.getJson("smoke.json"),
      { hello: "store" },
      "the store round-trips a JSON object",
    );

    return {
      id: "smoke",
      title: "harness up: store + sqlite + model",
      verdict: "PASS",
      critical: false,
      detail: `chain advanced to ${second.secuencia}, store round-trip ok`,
    };
  } finally {
    await store.stop();
  }
}
