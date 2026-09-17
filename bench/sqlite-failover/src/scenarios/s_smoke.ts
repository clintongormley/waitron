// Smoke: the things every other scenario stands on — a running object store, a SQLite node, one
// hash-linked ledger row, and a ledger that refuses every way of changing one. It asserts nothing
// about the failover loop; if it fails, no other verdict in the run means anything.
import assert from "node:assert";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import { openNode, recordSale, type NodeDb } from "../model.ts";

export default async function smoke({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const store = await startStore();
  let opened: NodeDb | undefined;
  try {
    const db = openNode("node-a");
    opened = db;
    const first = recordSale(db, 500);
    assert.equal(first.secuencia, 1, "the first record on a fresh chain is secuencia 1");
    assert.match(first.huella, /^[0-9a-f]{64}$/, "the toy huella is a sha256 hex digest");

    const second = recordSale(db, 250);
    assert.equal(second.secuencia, 2, "the chain advances");
    assert.notEqual(second.huella, first.huella, "each record hashes to its own huella");

    // The append-only triggers are a guard nothing else in this rig runs: applyTail re-inserts a
    // RECORDS row with ON CONFLICT DO NOTHING, which fires neither trigger, and its envios write
    // does update a row already there but envios carries no such trigger. Every way SQLite offers
    // of changing a row is checked here, INSERT OR REPLACE included: it deletes the conflicting row
    // internally, and that internal delete reaches the BEFORE DELETE trigger only because openNode
    // turns recursive_triggers on.
    const mutations: [string, string][] = [
      [
        "UPDATE",
        `UPDATE records SET payload = 'tampered' WHERE node_id = 'node-a' AND secuencia = 1`,
      ],
      ["DELETE", `DELETE FROM records WHERE node_id = 'node-a' AND secuencia = 1`],
      [
        "ON CONFLICT DO UPDATE",
        `INSERT INTO records (node_id, secuencia, huella, huella_anterior, payload)
         VALUES ('node-a', 1, 'tampered', NULL, 'tampered')
         ON CONFLICT(node_id, secuencia) DO UPDATE
           SET huella = excluded.huella, payload = excluded.payload`,
      ],
      [
        "INSERT OR REPLACE",
        `INSERT OR REPLACE INTO records (node_id, secuencia, huella, huella_anterior, payload)
         VALUES ('node-a', 1, 'tampered', NULL, 'tampered')`,
      ],
    ];
    for (const [label, sql] of mutations) {
      assert.throws(
        () => db.exec(sql),
        /records is append-only/,
        `${label} on a ledger row must be refused`,
      );
    }
    // A refusal thrown for some other reason would satisfy the assertions above while the row was
    // still rewritten, so the row itself is read back — huella AND payload, the two values every
    // one of those statements tried to overwrite.
    const ledgerRow = db.get<{ huella: string; payload: string }>(
      `SELECT huella, payload FROM records WHERE node_id = 'node-a' AND secuencia = 1`,
    );
    assert.equal(ledgerRow?.huella, first.huella, "the refused row keeps its huella");
    assert.notEqual(ledgerRow?.payload, "tampered", "the refused row keeps its payload");

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
      detail: `chain advanced to ${second.secuencia}, ${mutations.length} mutations refused, store round-trip ok`,
    };
  } finally {
    // The store is stopped FIRST: `close()` throws on an already-closed handle
    // (`ERR_INVALID_STATE`), and a throw ahead of `stop()` would leave the MinIO container running.
    await store.stop();
    opened?.close();
  }
}
