// S2: a tail ship that is retried after somebody has already submitted those records must not cause
// a second submission to the Spanish tax agency (spec §4, S2). It is the crux fiscal-safety
// scenario because of what the model's drain does: `drainPass` claims across every chain with no
// node filter (`src/model.ts`, and its doc comment cites the real drain's shape it borrows), so a
// shipped record can be submitted by the RECEIVER before the ship is confirmed.
//
// "Terminal-state-wins" is a rule with TWO sides, and a scenario covering one of them would be
// green whichever way the other went. Both are here, each with its own control:
//
//   Part A — a record the RECEIVER has already submitted must not be regressed to `pendiente` by a
//     re-shipped older copy, or the receiver files it twice itself.
//   Part B — a record the SENDER has already submitted must be adopted as submitted by a receiver
//     still holding it `pendiente`, or the receiver files a record its owner has already filed.
//   Part C — a refused chain blocks the rest of its own chain for the rest of that pass, and the
//     next pass drains it whole.
//   Part D — the same retry recomputed against a REFRESHED view of the receiver, which is the shape
//     that files a record twice.
//   Part E — spec §4's third assertion: a ship for a chain that is sitting in the drain's blocked
//     set, issued from inside a later `submit` callback in the same pass; and what a tail taken
//     while the SENDER's own drain holds a row `enviando` leaves on the receiver.
//
// The verdict is a measurement, not a decision taken here: it is PASS when no part filed any record
// twice and FAIL when one did. Today it is FAIL, for two separate reasons — see the README section
// "What S2 measures, and what it does not" for what that means and what is open. Parts A, B, C and
// the FIRST HALF of Part E still assert, so a failure in one of those is a thrown assertion and the
// runner reports it as a broken harness rather than a result; Part D and Part E's second half
// measure without asserting, and feed the verdict instead.
//
// Everything here is the rig's MODEL of the submission state machine (`src/model.ts`) — no result
// here is a statement about `packages/fiscal-verifactu`.
//
// Unlike every sibling scenario this one takes no `ScenarioContext`: the hand-over it models happens
// between in-memory SQLite databases, so it starts no MinIO container and opens no object store.
import assert from "node:assert";
import type { ScenarioResult } from "../scenarios.ts";
import {
  applyTail,
  applyTailInsertOnly,
  applyTailRegressing,
  diffTail,
  drainPass,
  openNode,
  recordSale,
  summarise,
} from "../model.ts";
import type { ApplyResult, EnvioRow, NodeDb, TailBatch } from "../model.ts";

/**
 * What the stub standing in for the tax agency was handed, across the WHOLE scenario.
 *
 * One ledger, not one per node: there is one tax agency, so a record filed by the node that owns it
 * and filed again by the node it was shipped to has been filed twice, whichever database each
 * filing came out of. Per-node ledgers cannot see that at all — which is the failure Part B is
 * about.
 *
 * `refused` is kept apart from `filed` because a submission the stub threw on is a refusal, not a
 * filing: submitting that record again afterwards is a retry, not a second filing.
 */
type SubmitLedger = { filed: string[]; refused: string[] };

function newLedger(): SubmitLedger {
  return { filed: [], refused: [] };
}

function submissionKey(nodeId: string, secuencia: number): string {
  return `${nodeId}:${secuencia}`;
}

/**
 * The stub NEVER throws on a repeat, even though a repeat is the whole thing this scenario looks
 * for. `drainPass` catches a throwing `submit`, returns the row to `pendiente` and blocks that
 * chain for the rest of the pass (`src/model.ts:581-587`), so an assertion thrown in here is
 * swallowed rather than reported as itself. What it CAUSES — the row released and the chain blocked
 * — is visible to the assertions outside the callback, which is how the review seat's throwing stub
 * still made S2 fail. The repeat is read off `filed` afterwards instead.
 *
 * It also ACCEPTS the repeat, which the real endpoint does not: AEAT answers error 3000 on a record
 * it already holds, and `resolveEstadoEfectivo` (`packages/verifactu/src/xml/parse-suministro.ts`)
 * reads that as filed. So a repeat this stub records is a second SUBMISSION, not a second FILING:
 * against a real AEAT a same-identity repeat is refused. A stub that instead REFUSED a repeat would
 * measure nothing HERE: idempotent by construction, its double COUNTER can only ever read zero. The
 * asserting parts would still see the change — run by the review seat, not argued. See README →
 * "What the FAIL means against the real system".
 *
 * `refuseOnce` is the one deliberate throw, used by Part C to put a chain in the drain's blocked
 * set; it fires at most once so the retried submission can succeed.
 */
function makeSubmit(
  ledger: SubmitLedger,
  refuseOnce?: string,
): (nodeId: string, secuencia: number) => void {
  return (nodeId, secuencia) => {
    const key = submissionKey(nodeId, secuencia);
    if (refuseOnce === key && !ledger.refused.includes(key)) {
      ledger.refused.push(key);
      throw new Error(`stub refuses ${key} once`);
    }
    ledger.filed.push(key);
  };
}

/** Every key filed more than once — a second filing of one record. */
function doubleFilings(ledger: SubmitLedger): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const key of ledger.filed) {
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return [...twice].sort();
}

/**
 * Every filing for one chain, sorted, with REPEATS KEPT. Keeping them is the point: a list of
 * distinct keys is unchanged by the very defect this scenario exists to catch — a receiver filing a
 * record its owner had already filed leaves the same five or four keys behind, one of them twice.
 *
 * The colon is part of the prefix it matches on, so a chain named `n-1` never collects `n-10`'s.
 */
function filingsFor(ledger: SubmitLedger, nodeId: string): string[] {
  return ledger.filed.filter((key) => key.startsWith(`${nodeId}:`)).sort();
}

/**
 * One chain's submission rows as read back out of the receiver's own database, `estado` and `acked`
 * together in one string per row so a single `deepEqual` covers the row set, its order, and both
 * columns.
 *
 * Reading these back is not the same check as counting filings, and WHEN it is read decides whether
 * it measures anything: a row that was regressed and then filed again ends up `enviado` too, so a
 * read taken after the next drain pass looks the same either way. The two reads that carry Part A's
 * and Part B's rule are taken between the retried ship and the drain pass that follows it, which is
 * the one moment the two answers differ.
 */
function envioStates(db: NodeDb, nodeId: string): string[] {
  const rows = db.handle
    .prepare(
      `SELECT node_id, secuencia, estado, acked FROM envios WHERE node_id = ? ORDER BY secuencia`,
    )
    .all(nodeId) as unknown as EnvioRow[];
  return rows.map(
    (row) => `${Number(row.secuencia)} ${String(row.estado)} acked=${Number(row.acked)}`,
  );
}

/** The first `count` records of a tail, with their submission rows — a partial ship. */
function firstRows(tail: TailBatch, count: number): TailBatch {
  return { ...tail, records: tail.records.slice(0, count), envios: tail.envios.slice(0, count) };
}

function secuencias(tail: TailBatch): number[] {
  return tail.records.map((row) => Number(row.secuencia));
}

type ApplyTail = typeof applyTail;

export default async function noDoubleSubmit(): Promise<ScenarioResult> {
  const opened: NodeDb[] = [];
  const open = (nodeId: string): NodeDb => {
    const db = openNode(nodeId);
    opened.push(db);
    return db;
  };

  try {
    const ledger = newLedger();
    const submit = makeSubmit(ledger);

    // ---- Part A: the receiver submitted first, then the ship was retried ----------------------
    const box = open("box-a");
    const cloud = open("cloud-1");
    for (let cents = 0; cents < 5; cents += 1) recordSale(box, 100 + cents);
    const tailA = diffTail(box, summarise(cloud));
    assert.deepEqual(secuencias(tailA), [1, 2, 3, 4, 5], "the sender's whole chain is the tail");

    applyTail(cloud, "box-a", firstRows(tailA, 3));
    drainPass(cloud, submit);
    assert.deepEqual(
      filingsFor(ledger, "box-a"),
      ["box-a:1", "box-a:2", "box-a:3"],
      "the receiver files the three records it was shipped",
    );

    // The retry ships the whole tail, the first three rows included, each carrying the `pendiente`
    // it had when the tail was taken — the sender never learned the receiver had submitted them.
    applyTail(cloud, "box-a", tailA);
    // Read back BEFORE the next drain pass: this is the only moment at which a regressed row and a
    // kept one look different. Afterwards both read `enviado`.
    assert.deepEqual(
      envioStates(cloud, "box-a"),
      [
        "1 enviado acked=1",
        "2 enviado acked=1",
        "3 enviado acked=1",
        "4 pendiente acked=0",
        "5 pendiente acked=0",
      ],
      "the retried ship left the three submitted rows terminal and added the two new ones",
    );

    drainPass(cloud, submit);
    assert.deepEqual(
      filingsFor(ledger, "box-a"),
      ["box-a:1", "box-a:2", "box-a:3", "box-a:4", "box-a:5"],
      "Part A: each of the five records is filed exactly once",
    );

    // ---- Part B: the SENDER submitted its own rows before the ship was retried -----------------
    // Node ids that cannot be confused with Part A's, so a row leaking between the parts cannot be
    // read as a Part B result. Here the sender is the cloud and the receiver the box: which way the
    // rows travel is not what the rule is about.
    const sender = open("cloud-2");
    const receiver = open("box-b");
    for (let cents = 0; cents < 4; cents += 1) recordSale(sender, 200 + cents);

    // Taken BEFORE the sender's own drain, so the partial ship carries `pendiente` rows: a
    // `diffTail` taken after the drain would carry `enviado` rows instead, and the receiver has to
    // be left holding unsubmitted copies for this part to measure anything.
    const heldBeforeShipB = summarise(receiver);
    const staleTailB = diffTail(sender, heldBeforeShipB);
    applyTail(receiver, "cloud-2", firstRows(staleTailB, 2));
    assert.deepEqual(
      envioStates(receiver, "cloud-2"),
      ["1 pendiente acked=0", "2 pendiente acked=0"],
      "the receiver holds the first two rows unsubmitted",
    );

    drainPass(sender, submit);
    assert.deepEqual(
      filingsFor(ledger, "cloud-2"),
      ["cloud-2:1", "cloud-2:2", "cloud-2:3", "cloud-2:4"],
      "the owner files its own four records",
    );

    // The ship is RETRIED, so it is recomputed against the same stale view of the receiver the
    // sender had before — its confirmation never came back. The rows now carry the terminal state
    // the sender's drain gave them.
    const retriedTailB = diffTail(sender, heldBeforeShipB);
    assert.deepEqual(secuencias(retriedTailB), [1, 2, 3, 4], "the retry re-ships the whole range");
    assert.deepEqual(
      retriedTailB.envios.map((row) => `${Number(row.secuencia)} ${String(row.estado)}`),
      ["1 enviado", "2 enviado", "3 enviado", "4 enviado"],
      "every re-shipped row carries the submission the owner already made",
    );
    applyTail(receiver, "cloud-2", retriedTailB);
    // Again read back before the receiver's drain runs: a receiver that dropped the shipped state
    // still reads `pendiente` here, and would read `enviado` after its own drain had filed it.
    assert.deepEqual(
      envioStates(receiver, "cloud-2"),
      ["1 enviado acked=1", "2 enviado acked=1", "3 enviado acked=1", "4 enviado acked=1"],
      "the receiver adopts the owner's submissions, including for rows it already held",
    );

    drainPass(receiver, submit);
    // The same four filings as before this pass, and no fifth: the receiver's drain filed nothing,
    // because every row it holds already carries the owner's submission.
    assert.deepEqual(
      filingsFor(ledger, "cloud-2"),
      ["cloud-2:1", "cloud-2:2", "cloud-2:3", "cloud-2:4"],
      "Part B: the owner's four filings are still all there are",
    );

    // ---- Part C: a refused chain, and the ship that lands while it is blocked ------------------
    const senderC = open("cloud-3");
    const receiverC = open("box-c");
    for (let cents = 0; cents < 4; cents += 1) recordSale(senderC, 300 + cents);
    const heldBeforeShipC = summarise(receiverC);
    const staleTailC = diffTail(senderC, heldBeforeShipC);
    applyTail(receiverC, "cloud-3", firstRows(staleTailC, 2));

    // One refusal on the chain's first row. What it demonstrates is the blocked set: the chain's
    // SECOND row was due and `pendiente` and was never handed to the stub at all.
    drainPass(receiverC, makeSubmit(ledger, "cloud-3:1"));
    assert.deepEqual(ledger.refused, ["cloud-3:1"], "the stub refused exactly one submission");
    assert.deepEqual(
      filingsFor(ledger, "cloud-3"),
      [],
      "the refused chain filed nothing that pass",
    );
    assert.deepEqual(
      envioStates(receiverC, "cloud-3"),
      ["1 pendiente acked=0", "2 pendiente acked=0"],
      "the refused row is back to pendiente and the row behind it was skipped, not claimed",
    );

    // The rest of the tail lands on a chain the last pass blocked, and the retry re-ships the two
    // rows already there as well.
    applyTail(receiverC, "cloud-3", staleTailC);
    drainPass(receiverC, submit);
    assert.deepEqual(
      filingsFor(ledger, "cloud-3"),
      ["cloud-3:1", "cloud-3:2", "cloud-3:3", "cloud-3:4"],
      "the next pass files the whole chain, the refused row included",
    );
    assert.deepEqual(
      envioStates(receiverC, "cloud-3"),
      ["1 enviado acked=1", "2 enviado acked=1", "3 enviado acked=1", "4 enviado acked=1"],
      "nothing is left pending on the chain that was blocked",
    );
    // Two whole-ledger checks, closing the gap the per-chain lists above leave: they can only see
    // the three chains they name, so a filing made for any OTHER chain is invisible to them.
    assert.deepEqual(
      doubleFilings(ledger),
      [],
      "no record was filed twice anywhere in Parts A, B and C",
    );
    assert.equal(ledger.filed.length, 13, "13 filings: 5 in Part A, 4 in Part B, 4 in Part C");

    // ---- Part D: the same retry, recomputed against a REFRESHED view of the receiver -----------
    //
    // Part A's and Part B's retries both re-ship the rows the receiver already holds, because the
    // sender is working from the view of the receiver it had BEFORE the first ship — its
    // confirmation never came back, so it has learned nothing about the receiver since. What makes
    // them safe is that neither carries a state that has gone stale: Part A replays the frozen
    // `tailA` and its sender filed nothing in between, so `terminal-state-wins` protects the rows
    // the RECEIVER filed; Part B's retry is recomputed against the sender, so it carries the rows
    // the SENDER filed as `enviado` and the receiver adopts them. A frozen batch in Part B's
    // position would carry neither protection — nothing terminal for the receiver to adopt, and
    // nothing already filed on the receiver to protect — and the receiver would file a record its
    // owner already had.
    //
    // A sender that instead ASKS the receiver what it holds and ships the difference is in a
    // different position. `diffTail` (`src/model.ts`) selects records by a high-water mark over the
    // receiver's `records` — everything at or below the receiver's highest contiguous `secuencia`
    // is treated as delivered and is not shipped again. A row the receiver already holds is
    // therefore not in the tail at all, and the ship carries NO submission state for it, however
    // far that state has moved on the sender in the meantime. The receiver's drain claims across
    // every chain with no node filter, so it then files that record itself — a second filing of a
    // record its owner has already filed.
    //
    // This part runs that sequence and MEASURES it. It asserts its preconditions and nothing about
    // the outcome, because the outcome is the result: the scenario's verdict is read off the double
    // filings below, so a ship protocol that later carries submission state for held rows turns
    // THIS part's double off without anybody editing the scenario — measured, by forcing
    // `diffTail`'s high-water mark to 0, which makes every ship carry the whole chain. S2 as a whole
    // stays FAIL under that mutation, because Part E's second half files a record twice for a
    // different reason. Whether to change the protocol, and how, is the owner's decision and is not
    // proposed here.
    const ledgerD = newLedger();
    const submitD = makeSubmit(ledgerD);
    const senderD = open("refreshed-sender");
    const receiverD = open("refreshed-receiver");
    for (let cents = 0; cents < 2; cents += 1) recordSale(senderD, 400 + cents);

    // First ship: record 1 only, while it is still `pendiente` on the sender.
    applyTail(receiverD, "refreshed-sender", firstRows(diffTail(senderD, summarise(receiverD)), 1));
    assert.deepEqual(
      envioStates(receiverD, "refreshed-sender"),
      ["1 pendiente acked=0"],
      "Part D precondition: the receiver holds record 1, unsubmitted",
    );

    // The owner's own drain files both of its records. Nothing tells the receiver.
    drainPass(senderD, submitD);
    assert.deepEqual(
      filingsFor(ledgerD, "refreshed-sender"),
      ["refreshed-sender:1", "refreshed-sender:2"],
      "Part D precondition: the owner files both of its own records",
    );

    // The second ship is RECOMPUTED, not retried: the sender asks the receiver what it holds now.
    const freshTailD = diffTail(senderD, summarise(receiverD));
    const freshShippedD = secuencias(freshTailD);
    applyTail(receiverD, "refreshed-sender", freshTailD);
    const statesAfterFreshShipD = envioStates(receiverD, "refreshed-sender");
    drainPass(receiverD, submitD);
    const doubledD = doubleFilings(ledgerD);

    // ---- Part E: a ship that lands mid-pass ----------------------------------------------------
    //
    // Spec §4's S2 asks for a third thing: "the ship for a chain runs with that chain paused in the
    // drain's blocked set". It is reachable. `drainPass`'s blocked set lives for the whole loop, and
    // `submit` is called from inside that loop, so a ship issued from inside a `submit` callback
    // runs with whatever chains are blocked at that instant still blocked. The set is simply not
    // reachable from OUTSIDE `drainPass`, which is why the callback is the only seat to observe it
    // from.
    //
    // Shipping from inside the callback is also the ONLY way this synchronous model can express "a
    // ship lands mid-pass" at all — there are no processes here and nothing runs concurrently. So
    // what both halves below measure is this model's ORDERING, and neither is a claim about how the
    // real system's drain and its ship interleave.
    const ledgerE = newLedger();
    const senderE1 = open("cloud-e1");
    const senderE2 = open("cloud-e2");
    const receiverE = open("box-e");
    for (let cents = 0; cents < 3; cents += 1) recordSale(senderE1, 500 + cents);
    for (let cents = 0; cents < 2; cents += 1) recordSale(senderE2, 600 + cents);

    // The receiver starts with two of chain one's three rows, and all of chain two's. `due` is read
    // once at the top of a pass, so chain one's third row is shipped in mid-pass below and is not a
    // candidate in that pass whatever the blocked set does — the blocked set is what keeps chain
    // one's SECOND row, which is due and `pendiente`, from being claimed.
    const tailE1 = diffTail(senderE1, summarise(receiverE));
    applyTail(receiverE, "cloud-e1", firstRows(tailE1, 2));
    applyTail(receiverE, "cloud-e2", diffTail(senderE2, summarise(receiverE)));

    const submitE = makeSubmit(ledgerE, "cloud-e1:1");
    let midPassApply: ApplyResult | undefined;
    drainPass(receiverE, (nodeId, secuencia) => {
      submitE(nodeId, secuencia);
      // Chain one is in the blocked set by now: its first row was refused before this callback ran.
      if (nodeId === "cloud-e2" && secuencia === 1) {
        midPassApply = applyTail(receiverE, "cloud-e1", tailE1);
      }
    });
    assert.ok(
      midPassApply,
      "Part E: the ship for the blocked chain ran from inside a submit callback",
    );
    // Two rows the receiver did not already hold: chain one's third record and its submission row.
    // Its sale and that sale's line are not among them — `firstRows` slices `records` and `envios`
    // only, so the first ship already carried all three sales and all three lines. What makes the
    // count 2 rather than 4 is that the two `envios` rows re-shipped unaltered are not counted,
    // which is the whole of what `applied` claims to mean (`src/model.ts`, `applyShippedTail`).
    assert.equal(
      midPassApply.applied,
      2,
      "Part E: the mid-pass ship counts only the two rows it actually changed",
    );
    assert.deepEqual(
      ledgerE.refused,
      ["cloud-e1:1"],
      "Part E: the stub refused exactly one submission",
    );
    assert.deepEqual(
      filingsFor(ledgerE, "cloud-e1"),
      [],
      "Part E: the blocked chain files nothing for the rest of the pass its refusal blocked",
    );
    assert.deepEqual(
      filingsFor(ledgerE, "cloud-e2"),
      ["cloud-e2:1", "cloud-e2:2"],
      "Part E: blocking one chain does not stop another draining in the same pass",
    );
    assert.deepEqual(
      envioStates(receiverE, "cloud-e1"),
      ["1 pendiente acked=0", "2 pendiente acked=0", "3 pendiente acked=0"],
      "Part E: the blocked chain is left whole and pending, the row the mid-pass ship added included",
    );

    drainPass(receiverE, makeSubmit(ledgerE));
    assert.deepEqual(
      filingsFor(ledgerE, "cloud-e1"),
      ["cloud-e1:1", "cloud-e1:2", "cloud-e1:3"],
      "Part E: the next pass files the blocked chain whole, the row that arrived mid-pass included",
    );
    assert.deepEqual(
      doubleFilings(ledgerE),
      [],
      "Part E: nothing in the blocked-chain sequence is filed twice",
    );

    // Part E, second half: the tail is taken while the SENDER's own drain has a row `enviando`.
    // `applyShippedTail` writes the shipped `estado` verbatim, so the receiver adopts `enviando` —
    // and a drain claims only `pendiente` rows, so no DRAIN on the receiver touches that row again.
    // That is the whole of what is measured: a later ship carrying the row as `enviado, acked=1`
    // would satisfy the terminal-state-wins guard and clear it, and no part of S2 sends one, so
    // whether the row survives in practice is not measured here. Measured, not asserted: nothing
    // here says a stuck row is the right answer.
    const ledgerF = newLedger();
    const submitF = makeSubmit(ledgerF);
    const senderF = open("cloud-f");
    const receiverF = open("box-f");
    for (let cents = 0; cents < 2; cents += 1) recordSale(senderF, 700 + cents);

    let midDrainTailStates: string[] = [];
    drainPass(senderF, (nodeId, secuencia) => {
      submitF(nodeId, secuencia);
      if (secuencia === 1) {
        const midDrainTail = diffTail(senderF, summarise(receiverF));
        midDrainTailStates = midDrainTail.envios.map(
          (row) => `${Number(row.secuencia)} ${String(row.estado)}`,
        );
        applyTail(receiverF, "cloud-f", midDrainTail);
      }
    });
    assert.ok(
      midDrainTailStates.length > 0,
      "Part E: the ship ran from inside the sender's own drain pass",
    );
    const receiverFAfterShip = envioStates(receiverF, "cloud-f");
    drainPass(receiverF, submitF);
    const receiverFAfterDrain = envioStates(receiverF, "cloud-f");
    const stuckF = receiverFAfterDrain.filter((row) => row.includes("enviando"));
    const doubledF = doubleFilings(ledgerF);

    // ---- Control for Part A: the guard removed, so a terminal row is regressed ----------------
    // Each control runs the same sequence over its own nodes and its own ledger — a control is
    // meant to file twice, and mixing that into the ledger above would destroy the assertion that
    // matters. The two controls differ from the real path in the `envios` rule and nothing else.
    const regressed = runPartASequence(open, applyTailRegressing, "regressing");
    assert.deepEqual(
      regressed.statesAfterRetry,
      [
        "1 pendiente acked=0",
        "2 pendiente acked=0",
        "3 pendiente acked=0",
        "4 pendiente acked=0",
        "5 pendiente acked=0",
      ],
      "control: without the guard the three submitted rows are regressed to pendiente",
    );
    assert.deepEqual(
      regressed.doubled,
      ["regressing-sender:1", "regressing-sender:2", "regressing-sender:3"],
      "control: exactly the three regressed rows are filed a second time",
    );

    // ---- Control for Part B: the shipped state dropped, so the receiver files the owner's rows --
    const dropped = runPartBSequence(open, applyTailInsertOnly, "insert-only");
    assert.deepEqual(
      dropped.statesAfterRetry,
      ["1 pendiente acked=0", "2 pendiente acked=0", "3 enviado acked=1", "4 enviado acked=1"],
      "control: the shipped submission is dropped for the two rows the receiver already held",
    );
    assert.deepEqual(
      dropped.doubled,
      ["insert-only-sender:1", "insert-only-sender:2"],
      "control: exactly those two rows are filed a second time, by a node that does not own them",
    );

    // Every filing this scenario measured, gathered in one place, and the verdict is read off it:
    // FAIL when any of them names a record filed twice. Parts A, B and C assert their own ledger is
    // clean and would have thrown already; what this adds is D and E, which MEASURE rather than
    // assert. A measured part must not be able to record a second filing underneath a PASS — with
    // the verdict read off Part D alone, forcing D's ship to carry the whole chain printed PASS on
    // a line that still said `cloud-f:2` had been filed twice.
    const measuredDoubles = [
      ...doubleFilings(ledger),
      ...doubledD,
      ...doubleFilings(ledgerE),
      ...doubledF,
    ];
    return {
      id: "S2",
      title: "no second tax-agency filing on a re-sent or recomputed tail ship",
      verdict: measuredDoubles.length === 0 ? "PASS" : "FAIL",
      critical: true,
      detail:
        `RETRIED-IN-FULL ship safe: filed=${ledger.filed.length} double=${doubleFilings(ledger).length} ` +
        `(A receiver files 5 once; B receiver files none of the owner's 4; ` +
        `C blocked chain drains 4 next pass after 1 refusal). ` +
        `D REFRESHED-SUMMARY ship files twice: ${doubledD.length ? doubledD.join(",") : "none"} ` +
        `(fresh tail carried records [${freshShippedD.join(",")}]; receiver left ` +
        `${statesAfterFreshShipD.join(", ")}). ` +
        `E ship issued mid-pass for a blocked chain: that chain files nothing more that pass, ` +
        `next pass files ${filingsFor(ledgerE, "cloud-e1").length} once, double=${doubleFilings(ledgerE).length}. ` +
        `E tail taken mid-drain carried [${midDrainTailStates.join(", ")}]: receiver left ` +
        `${receiverFAfterShip.join(", ")}, and its own drain claims no enviando row, so ` +
        `${stuckF.length ? stuckF.join(", ") : "nothing"} is stuck against that drain and ` +
        `${doubledF.length ? doubledF.join(",") : "nothing"} is filed twice. ` +
        `Controls double-file: regressing=${regressed.doubled.length} ` +
        `insert-only=${dropped.doubled.length}`,
    };
  } finally {
    for (const db of opened) db.close();
  }
}

type ControlOutcome = { statesAfterRetry: string[]; doubled: string[] };

/**
 * Part A's sequence again — the receiver submits, then the whole tail is re-shipped — under a
 * supplied apply. `slug` only names the control's nodes, so its rows can never be read as the real
 * run's.
 */
function runPartASequence(
  open: (nodeId: string) => NodeDb,
  apply: ApplyTail,
  slug: string,
): ControlOutcome {
  const ledger = newLedger();
  const submit = makeSubmit(ledger);
  const senderId = `${slug}-sender`;
  const sender = open(senderId);
  const receiver = open(`${slug}-receiver`);
  for (let cents = 0; cents < 5; cents += 1) recordSale(sender, 100 + cents);

  const tail = diffTail(sender, summarise(receiver));
  apply(receiver, senderId, firstRows(tail, 3));
  drainPass(receiver, submit);
  apply(receiver, senderId, tail);
  const statesAfterRetry = envioStates(receiver, senderId);
  drainPass(receiver, submit);
  return { statesAfterRetry, doubled: doubleFilings(ledger) };
}

/**
 * Part B's sequence again — the owner submits its own rows between a partial ship and its retry —
 * under a supplied apply.
 */
function runPartBSequence(
  open: (nodeId: string) => NodeDb,
  apply: ApplyTail,
  slug: string,
): ControlOutcome {
  const ledger = newLedger();
  const submit = makeSubmit(ledger);
  const senderId = `${slug}-sender`;
  const sender = open(senderId);
  const receiver = open(`${slug}-receiver`);
  for (let cents = 0; cents < 4; cents += 1) recordSale(sender, 200 + cents);

  const heldBeforeShip = summarise(receiver);
  apply(receiver, senderId, firstRows(diffTail(sender, heldBeforeShip), 2));
  drainPass(sender, submit);
  apply(receiver, senderId, diffTail(sender, heldBeforeShip));
  const statesAfterRetry = envioStates(receiver, senderId);
  drainPass(receiver, submit);
  return { statesAfterRetry, doubled: doubleFilings(ledger) };
}
