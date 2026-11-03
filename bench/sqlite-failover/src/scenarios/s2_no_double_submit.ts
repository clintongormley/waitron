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
//   Part D — CONTROL of the retired design: the same retry recomputed against a REFRESHED view of
//     the receiver, from an unfenced sender, which files a record twice.
//   Part E — spec §4's third assertion: a ship for a chain that is sitting in the drain's blocked
//     set, issued from inside a later `submit` callback in the same pass; and, as a CONTROL of the
//     retired design, what a tail taken while the unfenced SENDER's own drain holds a row
//     `enviando` leaves on the receiver.
//   Part F — A1018's fiscal-only full-state return batch from a FENCED sender (A947 §7.1 as
//     amended): every record of both chains is filed exactly once, and no sale travels.
//   Part G — that batch replayed: built again from the same reported heads it is the same bytes,
//     and applied again it changes nothing and files nothing.
//
// The verdict is PASS when no part outside the controls filed any record twice, Part F left no
// record unfiled and Part G's replay was clean, and FAIL otherwise. The owner reads S2's gate from
// Parts F and G (2026-11-03): Part D and Part E's second half model the unfenced tail ship that
// A1018's fenced return batch retires, so they are controls, expected to file twice. Parts A, B, C
// and the first half of Part E assert, and so does every control, so any of those going wrong is a
// thrown assertion, which the runner reports as a critical FAIL row titled "threw"; Parts F and G
// measure their outcomes and feed the verdict (they assert only preconditions).
//
// Everything here is the rig's MODEL of the submission state machine (`src/model.ts`) — no result
// here is a statement about `packages/fiscal-verifactu`.
//
// Like S5 and RUNNER, this scenario takes no `ScenarioContext`: the hand-over it models happens
// between in-memory SQLite databases, so it starts no MinIO container and opens no object store.
import assert from "node:assert";
import type { ScenarioResult } from "../scenarios.ts";
import {
  applyReturnBatch,
  applyTail,
  applyTailInsertOnly,
  applyTailRegressing,
  buildReturnBatch,
  buildReturnBatchKeepsEnviando,
  buildReturnBatchMissingOnly,
  chainsOf,
  diffTail,
  drainPass,
  fence,
  openNode,
  recordSale,
  summarise,
} from "../model.ts";
import type { ApplyResult, EnvioRow, NodeDb, ReturnBatch, TailBatch } from "../model.ts";

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
 * chain for the rest of the pass (the `catch` in `drainPass`, `src/model.ts`), so an assertion
 * thrown in here is swallowed rather than reported as itself. What it CAUSES — the row released and the chain blocked
 * — is visible to the assertions outside the callback, which is how the review seat's throwing stub
 * still made S2 fail. The repeat is read off `filed` afterwards instead.
 *
 * It also ACCEPTS the repeat, which the real endpoint does not: AEAT answers error 3000 on a record
 * it already holds, and `resolveEstadoEfectivo` (in `@waitron/verifactu`)
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
    // A control of the retired design: the sender is never fenced, which A1018's return batch
    // (Part F) forbids. It asserts that the record is filed twice; if it is not, the row reads
    //   | s2_no_double_submit | threw | FAIL | control: the retired refreshed-summary ship files record 1 twice |
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
    assert.deepEqual(
      doubledD,
      ["refreshed-sender:1"],
      "control: the retired refreshed-summary ship files record 1 twice",
    );

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
    // whether the row survives in practice is not measured here. A control of the retired design:
    // the sender keeps filing while it ships, which A1018's fence forbids. It asserts the second
    // filing and the stuck row; if either differs, the row reads
    //   | s2_no_double_submit | threw | FAIL | control: the retired mid-drain tail ship leaves record 1 stuck enviando and files record 2 twice |
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
    assert.deepEqual(
      [stuckF, doubledF],
      [["1 enviando acked=0"], ["cloud-f:2"]],
      "control: the retired mid-drain tail ship leaves record 1 stuck enviando and files record 2 twice",
    );

    // ---- Part F: A1018's fiscal-only full-state batch from a fenced sender -------------------
    // ---- Part G: that batch replayed, and built again from the same reported heads ----------
    // Both are one sequence, `runReturnSequence` below; G is the end of it. Measured, not asserted,
    // because these two parts are the gate A947 §7.1 names and their result is the finding.
    const returned = runReturnSequence(open, "returned", { fenced: true, build: buildReturnBatch });

    // ---- Controls for Part F: each removes one part of the return batch ----------------------
    // Each control's expected segment of the detail line:
    //
    //   no-fence: filed-twice=no-fence-m1:2,no-fence-m1:4 never-filed=none
    //     m1's own drain, unfenced, files records 2 and 4 after the batch carried them `pendiente`,
    //     and m2 files them too. Not 3: m1 holds it `enviando`, which this model's drain never
    //     claims. Its replay line reads same-bytes=false, because m1's state moved after the cut.
    //   missing-only: filed-twice=missing-only-m1:1 never-filed=none
    //     The batch carries no filing row for record 1, which m2 already held, so m2 never learns
    //     m1 filed it, and files it again.
    //   keeps-enviando: filed-twice=none never-filed=keeps-enviando-m1:3
    //     NOT a second filing: record 3 reaches m2 `enviando`, no drain claims it, and nobody ever
    //     files it. This model's drain has no five-minute recovery (the real drain's
    //     `recoverStaleClaims`; README → "What S2 measures, and what it does not"), so nothing ever
    //     files record 3.
    const noFence = runReturnSequence(open, "no-fence", { fenced: false, build: buildReturnBatch });
    assert.deepEqual(
      [noFence.filedTwice, noFence.neverFiled, noFence.sameBytes],
      [["no-fence-m1:2", "no-fence-m1:4"], [], false],
      "control: without the fence the sender files records 2 and 4 after the cut, and so does m2",
    );
    const missingOnly = runReturnSequence(open, "missing-only", {
      fenced: true,
      build: buildReturnBatchMissingOnly,
    });
    assert.deepEqual(
      [missingOnly.filedTwice, missingOnly.neverFiled],
      [["missing-only-m1:1"], []],
      "control: a batch of missing records only leaves m2 filing the record m1 already filed",
    );
    const keepsEnviando = runReturnSequence(open, "keeps-enviando", {
      fenced: true,
      build: buildReturnBatchKeepsEnviando,
    });
    assert.deepEqual(
      [keepsEnviando.filedTwice, keepsEnviando.neverFiled],
      [[], ["keeps-enviando-m1:3"]],
      "control: a batch carrying enviando verbatim leaves record 3 unfiled",
    );

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

    // The verdict: FAIL when any part outside the controls names a record filed twice or, for Part
    // F, never filed; `replayClean` below adds Part G.
    const measuredFaults = [
      ...doubleFilings(ledger),
      ...doubleFilings(ledgerE),
      ...returned.filedTwice,
      ...returned.neverFiled,
    ];
    const replayClean =
      returned.sameBytes && returned.replayApplied === 0 && returned.filedAfterReplay === 0;
    return {
      id: "S2",
      title: "no second tax-agency filing on a re-sent or recomputed tail ship",
      verdict: measuredFaults.length === 0 && replayClean ? "PASS" : "FAIL",
      critical: true,
      detail:
        `RETRIED-IN-FULL ship safe: filed=${ledger.filed.length} double=${doubleFilings(ledger).length} ` +
        `(A receiver files 5 once; B receiver files none of the owner's 4; ` +
        `C blocked chain drains 4 next pass after 1 refusal). ` +
        `D control (retired design) REFRESHED-SUMMARY ship files twice: ${doubledD.join(",")} ` +
        `(fresh tail carried records [${freshShippedD.join(",")}]; receiver left ` +
        `${statesAfterFreshShipD.join(", ")}). ` +
        `E ship issued mid-pass for a blocked chain: that chain files nothing more that pass, ` +
        `next pass files ${filingsFor(ledgerE, "cloud-e1").length} once, double=${doubleFilings(ledgerE).length}. ` +
        `E control (retired design) tail taken mid-drain carried [${midDrainTailStates.join(", ")}]: ` +
        `receiver left ${receiverFAfterShip.join(", ")}, and its own drain claims no enviando row, ` +
        `so ${stuckF.join(", ")} is stuck against that drain and ${doubledF.join(",")} is filed twice. ` +
        `F RETURN BATCH from a fenced sender: ${describeReturn(returned)} ` +
        `returned-from-enviando=[${returned.returnedFromEnviando.join(",")}] ` +
        `sales-carried=${returned.salesGained}. ` +
        `G REPLAY: same-bytes=${returned.sameBytes} replay-applied=${returned.replayApplied} ` +
        `filed-after-replay=${returned.filedAfterReplay}. ` +
        `F controls: no-fence ${describeReturn(noFence)} same-bytes=${noFence.sameBytes}; ` +
        `missing-only ${describeReturn(missingOnly)}; ` +
        `keeps-enviando ${describeReturn(keepsEnviando)}. ` +
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

type BuildReturn = typeof buildReturnBatch;

type ReturnOutcome = {
  /** Every record of both chains filed more than once. */
  filedTwice: string[];
  /** Every record of both chains never filed at all. */
  neverFiled: string[];
  /** The sender's chain as the receiver holds it before the replay. */
  receiverStates: string[];
  returnedFromEnviando: number[];
  /** Whether the batch built again from the same reported heads is the same bytes. */
  sameBytes: boolean;
  replayApplied: number;
  filedAfterReplay: number;
  /** Sales of the sender's the receiver gained from the batch — none may arrive. */
  salesGained: number;
};

/**
 * A947 §7.1's return, as A1018 amends it: the old box (`m1`) comes back after its replacement
 * (`m2`) took over, and hands back what it holds of its own chain. The four records are chosen so
 * each one needs a different part of the batch to be filed exactly once:
 *
 *   1 — in m2's copy as `pendiente`; m1 filed it after that copy was taken. Only m1's filing row
 *       for it, which is not a missing record, tells m2.
 *   2 — in m2's copy as `pendiente`; m1's one attempt was refused, so nobody has filed it.
 *   3 — not in m2's copy; m1's drain had claimed it (`enviando`) when the power went, before the
 *       request left — so the stub never saw it.
 *   4 — not in m2's copy; never attempted.
 *
 * m2 also sells one record of its own, so its drain pass has a row to call `submit` on while m1's
 * chain is paused, and the batch is applied from inside that call: the apply lands mid-pass.
 *
 * `fenced: false` and the two other builders are the controls. A record whose submit was cut after
 * the request reached AEAT is not modelled: against the real endpoint the receiver's resend is a
 * same-identity repeat AEAT refuses (README → "What the FAIL means against the real system").
 */
function runReturnSequence(
  open: (nodeId: string) => NodeDb,
  slug: string,
  options: { fenced: boolean; build: BuildReturn },
): ReturnOutcome {
  const ledger = newLedger();
  const m1Id = `${slug}-m1`;
  const m2Id = `${slug}-m2`;
  const m1 = open(m1Id);
  const m2 = open(m2Id);

  recordSale(m1, 800);
  recordSale(m1, 801);
  // m2's copy of m1, taken before m1 filed anything. It is a whole-database copy, so it carries
  // m1's sales too; the return batch afterwards must add none.
  applyTail(m2, m1Id, diffTail(m1, summarise(m2)));
  drainPass(m1, makeSubmit(ledger, `${m1Id}:2`));
  recordSale(m1, 802);
  recordSale(m1, 803);
  m1.handle
    .prepare(`UPDATE envios SET estado = 'enviando' WHERE node_id = ? AND secuencia = 3`)
    .run(m1Id);
  assert.deepEqual(
    envioStates(m1, m1Id),
    ["1 enviado acked=1", "2 pendiente acked=0", "3 enviando acked=0", "4 pendiente acked=0"],
    `${slug}: precondition — m1's chain when it comes back`,
  );
  assert.deepEqual(
    envioStates(m2, m1Id),
    ["1 pendiente acked=0", "2 pendiente acked=0"],
    `${slug}: precondition — m2's copy of m1's chain`,
  );
  recordSale(m2, 900);
  const salesBefore = countSales(m2, m1Id);

  if (options.fenced) fence(m1);
  const reportedHeads = summarise(m2).contiguousTo;
  const batch = options.build(m1, reportedHeads);
  const batchBytes = JSON.stringify(batch);

  // m1's own filing duty comes round after the batch is cut. Fenced, it files nothing.
  drainPass(m1, makeSubmit(ledger));

  const paused = new Set(chainsOf(batch));
  let applied: ApplyResult | undefined;
  const submit = makeSubmit(ledger);
  drainPass(
    m2,
    (nodeId, secuencia) => {
      submit(nodeId, secuencia);
      if (!applied) {
        applied = applyReturnBatch(m2, m1Id, batch);
        paused.clear();
      }
    },
    paused,
  );
  assert.ok(applied, `${slug}: the batch was applied from inside m2's drain pass`);
  drainPass(m2, submit);
  const receiverStates = envioStates(m2, m1Id);
  const salesGained = countSales(m2, m1Id) - salesBefore;

  // The replay: m1's duty comes round again, the batch is built again from the same reported
  // heads, and the batch first sent is applied a second time.
  drainPass(m1, makeSubmit(ledger));
  const sameBytes = JSON.stringify(options.build(m1, reportedHeads)) === batchBytes;
  const filedBeforeReplay = ledger.filed.length;
  const replayApplied = applyReturnBatch(m2, m1Id, JSON.parse(batchBytes) as ReturnBatch).applied;
  drainPass(m2, submit);

  const expected = [
    ...[1, 2, 3, 4].map((secuencia) => submissionKey(m1Id, secuencia)),
    submissionKey(m2Id, 1),
  ];
  return {
    filedTwice: doubleFilings(ledger),
    neverFiled: expected.filter((key) => !ledger.filed.includes(key)),
    receiverStates,
    returnedFromEnviando: batch.returnedFromEnviando,
    sameBytes,
    replayApplied,
    filedAfterReplay: ledger.filed.length - filedBeforeReplay,
    salesGained,
  };
}

function countSales(db: NodeDb, nodeId: string): number {
  const row = db.handle
    .prepare(`SELECT count(*) AS n FROM sales WHERE node_id = ?`)
    .get(nodeId) as { n: number };
  return Number(row.n);
}

function describeReturn(outcome: ReturnOutcome): string {
  const list = (keys: string[]): string => (keys.length ? keys.join(",") : "none");
  return (
    `filed-twice=${list(outcome.filedTwice)} never-filed=${list(outcome.neverFiled)} ` +
    `receiver-left=[${outcome.receiverStates.join(", ")}]`
  );
}
