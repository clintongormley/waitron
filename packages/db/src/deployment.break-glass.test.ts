// The break-glass verifier column on a node's `node_roles` row.
//
// LOSS, from the storage swap: a fourth case proved the spec §9.3 rule that the application may
// read this column but must not write it. That case is deleted rather than kept in a form that
// asserts nothing, and nothing in this package now states the rule.
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { readBreakGlassVerifier, setBreakGlassVerifierTx, stampDeployment } from "./deployment.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("the deployment break-glass verifier", () => {
  // One migrated database, emptied between tests by the helper's default reset — the per-test
  // isolation `target.create()` used to buy with a fresh database each time.
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before anything is written", async () => {
    await stampDeployment(suite.db, "preproduction"); // stamped, but no verifier written
    expect(await readBreakGlassVerifier(suite.db, NODE)).toBeNull();
  });

  it("reads null on a migrated database nothing has stamped", async () => {
    // No stampDeployment here, and this node has no `node_roles` row. This reader takes a plain
    // select rather than the table-presence probe its neighbours use, so the missing row is what
    // answers null; without this case the reader could stop tolerating a missing row and every
    // test would still pass, because every other one stamps first.
    expect(await readBreakGlassVerifier(suite.db, NODE)).toBeNull();
  });

  it("round-trips the break-glass verifier written on a caller transaction", async () => {
    await stampDeployment(suite.db, "preproduction");
    expect(await readBreakGlassVerifier(suite.db, NODE)).toBeNull();
    await withTransaction(suite.db, (tx) => setBreakGlassVerifierTx(tx, NODE, "scrypt$aa$bb"));
    expect(await readBreakGlassVerifier(suite.db, NODE)).toBe("scrypt$aa$bb");
  });
});
