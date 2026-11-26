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

type SubmitLedger = { filed: string[]; refused: string[] };

function newLedger(): SubmitLedger {
  return { filed: [], refused: [] };
}

function submissionKey(nodeId: string, secuencia: number): string {
  return `${nodeId}:${secuencia}`;
}

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

function doubleFilings(ledger: SubmitLedger): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const key of ledger.filed) {
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return [...twice].sort();
}

function filingsFor(ledger: SubmitLedger, nodeId: string): string[] {
  return ledger.filed.filter((key) => key.startsWith(`${nodeId}:`)).sort();
}

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
    assert.deepEqual(
      filingsFor(ledger, "cloud-2"),
      ["cloud-2:1", "cloud-2:2", "cloud-2:3", "cloud-2:4"],
      "Part B: the owner's four filings are still all there are",
    );

    const senderC = open("cloud-3");
    const receiverC = open("box-c");
    for (let cents = 0; cents < 4; cents += 1) recordSale(senderC, 300 + cents);
    const heldBeforeShipC = summarise(receiverC);
    const staleTailC = diffTail(senderC, heldBeforeShipC);
    applyTail(receiverC, "cloud-3", firstRows(staleTailC, 2));

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

    const ledgerD = newLedger();
    const submitD = makeSubmit(ledgerD);
    const senderD = open("refreshed-sender");
    const receiverD = open("refreshed-receiver");
    for (let cents = 0; cents < 2; cents += 1) recordSale(senderD, 400 + cents);

    applyTail(receiverD, "refreshed-sender", firstRows(diffTail(senderD, summarise(receiverD)), 1));
    assert.deepEqual(
      envioStates(receiverD, "refreshed-sender"),
      ["1 pendiente acked=0"],
      "Part D precondition: the receiver holds record 1, unsubmitted",
    );

    drainPass(senderD, submitD);
    assert.deepEqual(
      filingsFor(ledgerD, "refreshed-sender"),
      ["refreshed-sender:1", "refreshed-sender:2"],
      "Part D precondition: the owner files both of its own records",
    );

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

    const returned = runReturnSequence(open, "returned", { fenced: true, build: buildReturnBatch });

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
  filedTwice: string[];
  neverFiled: string[];
  receiverStates: string[];
  returnedFromEnviando: number[];
  sameBytes: boolean;
  replayApplied: number;
  filedAfterReplay: number;
  salesGained: number;
};

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
