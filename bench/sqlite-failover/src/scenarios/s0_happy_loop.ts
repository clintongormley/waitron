// S0: the whole failover loop, driven end to end with the real litestream binary by ONE-SHOT syncs
// (spec §4, S0) — a box sells, syncs to the store, files its own records, sells two more and dies
// before the next sync; a cloud node restores that generation, takes the venue for a higher term and
// sells for itself; the box comes back, sees the higher term, and ships its tail instead of selling.
//
// Every upload here is `syncOnce`. Nothing in this scenario starts `replicate`, litestream's
// continuous daemon, which is the mode the product would run and which only `s_litestream_roundtrip`
// drives. That is why "the box dies before the next sync" is a scripted step here: under the daemon
// it would be a timing window, and this scenario says nothing about that window.
//
// What it asserts, on Part A:
//   - the receiver ends up holding box-a's records 1..6 with the exact contents box-a wrote them
//     with, compared field by field against box-a's own rows rather than counted;
//   - the cloud's own chain is separate and intact — one record, under its own id, whose huella is
//     the one its write returned;
//   - every `records` row on the receiver is attributed to the node that WROTE it, judged by the
//     payload, which carries the sale's uuid;
//   - every chain on the receiver verifies: secuencias 1..N with no gap, each row's
//     `huella_anterior` the row before it, and each huella the hash of its own payload;
//   - every record is handed to the tax-agency stub EXACTLY ONCE across all three drains of the run;
//   - `current.json` in the store names this part's cloud term and generation, read back from the
//     store.
//
// What it does NOT assert, and is not evidence about:
//   - anything about `packages/fiscal-verifactu`. Every table here is the rig's MODEL (`model.ts`),
//     and the hash is a toy one.
//   - that a record can only be present once. `records` is keyed `(node_id, secuencia)`, so the
//     table cannot hold a row twice whatever the loop does; "exactly once" is a claim about the
//     SUBMIT ledger, and that is where it is measured.
//   - the cloud's own generation. `promote` writes the pointer and a generation marker, and nothing
//     here streams cloud-1's database anywhere — a returning node following that pointer is plan
//     Task 8's.
//   - a fenced box refusing to sell. Box-a reads the higher term and ships; that it COULD not have
//     sold is not modelled, and nothing here stops it.
//
// Part C is a MEASUREMENT and does not decide the verdict; Parts A and B do. Part C leaves out the
// sync that would carry box-a's filing state to the store, so the promoted cloud restores those
// records `pendiente` and files them a second time. That is the same SAME-IDENTITY duplicate S2
// already measures — same node, same secuencia, same huella — which a real AEAT refuses with error
// 3000 and our drain reads as filed, so the model's stub would score it as a double it is not. The
// README sections "What the FAIL means against the real system (owner review, 2026-09-17)" and this
// task's note in the plan carry the owner's reading of what it costs. Part C therefore RECORDS the
// number and the identities, and asserts only what is true of the drain either way.
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LITESTREAM_VERSION,
  resolveLitestream,
  restore,
  syncOnce,
  writeConfig,
} from "../litestream.ts";
import {
  applyTail,
  diffTail,
  drainPass,
  openNode,
  recordSale,
  summarise,
  toyHuella,
} from "../model.ts";
import type { NodeDb, RecordRow } from "../model.ts";
import { promote, readCurrent } from "../promotion.ts";
import type { CurrentPointer } from "../promotion.ts";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import type { Store } from "../store.ts";

/** Topology §2.2 gives each venue one prefix in the store; `v1` is this rig's venue. */
const VENUE = "venues/v1";

const BOX_A = "box-a";
const CLOUD = "cloud-1";

/** Sales box-a makes before it syncs, and the two it makes afterwards — its tail. */
const SALES_BEFORE_SYNC = 4;
const TAIL_SALES = 2;

/**
 * One run of the loop. The three parts share ONE store and are separated by TERM, the way
 * `s1_double_promotion.ts` separates its fenced race from its control: each part's box streams to
 * `gen-<boxTerm>-box-a`, each part's cloud opens `gen-<cloudTerm>-cloud-1`, and each part's
 * promotion claims a key named for its own term, so no two parts share a generation prefix or a
 * claim. The ONE key all three write is `venues/v1/current.json`, which carries no term and which
 * `promote` overwrites every time (`promotion.ts`); each part reads it back only after its own
 * promotion, so a later part's pointer never reaches an earlier one.
 *
 * What that trades away, stated because the alternative was three stores: with a store per part, a
 * part that reached for another part's prefix would find nothing and fail on the restore. Here it
 * would find a real generation. What makes a wrong prefix loud instead is that every part checks
 * what the receiver holds against the rows its OWN box wrote, and `recordSale` puts a fresh uuid in
 * every payload (`model.ts`), so another part's rows cannot satisfy that check. Which assertion does
 * the work differs by part: `assertReceiverHoldsSenderChain` in Part A, the `deepStrictEqual`
 * against `boxARows.slice(0, SALES_BEFORE_SYNC)` in Part B, and `assertEveryRowAttributedToItsWriter`
 * in Part C — NOT its verbatim check, which walks repeats selected by identity and would find none.
 * Run both ways on 2026-09-18 — each part's restore pointed at Part A's prefix in turn — and the
 * messages are in the package README. The named assertion is the one that FIRES FIRST, not the only
 * one that would: with Part C's attribution check deleted and its restore still pointing at Part
 * A's generation, Part C failed instead on "box-a:5 links to the record before it", because the
 * ship then grafts the part's own tail onto another part's chain.
 */
type Part = {
  /** The generation box-a streams to, and the term it holds when it dies. */
  boxTerm: number;
  /** The term the cloud takes, which names its generation and its claim key. */
  cloudTerm: number;
  /** Box-a ships its tail when it returns. False is Part B's control. */
  ship: boolean;
  /** Box-a's filings reach the store before it dies. False is Part C's stream lag. */
  syncAfterDrain: boolean;
};

const HAPPY: Part = { boxTerm: 1, cloudTerm: 2, ship: true, syncAfterDrain: true };
const CONTROL: Part = { boxTerm: 3, cloudTerm: 4, ship: false, syncAfterDrain: true };
const LAG: Part = { boxTerm: 5, cloudTerm: 6, ship: true, syncAfterDrain: false };

/**
 * Spelled out rather than built from `promotion.ts`, for the reason S1 records: asking the code
 * under test where it puts its keys and then checking it put them there holds whatever it did.
 */
function boxPrefix(part: Part): string {
  return `${VENUE}/gen-${part.boxTerm}-${BOX_A}`;
}

function cloudGeneration(part: Part): string {
  return `gen-${part.cloudTerm}-${CLOUD}`;
}

/** Everything the assertions read, captured while both databases and the store are still open. */
type LoopProbe = {
  /** Which part produced this state, so an assertion can spell out that part's own terms. */
  part: Part;
  /** The receiver: the cloud node, opened on the restored generation. */
  cloud: NodeDb;
  /** The six records box-a wrote, read from BOX-A's own database before it died. */
  boxARows: RecordRow[];
  /** What `recordSale` returned for the cloud's own sale — an identity captured at write time. */
  cloudOwn: { secuencia: number; huella: string };
  /** Every `(node, secuencia)` the tax-agency stub was handed, repeats kept, in order. */
  submissions: string[];
  /** The same ledger split by the drain that produced each entry. */
  boxADrain: string[];
  cloudFirstDrain: string[];
  cloudSecondDrain: string[];
  /** What the cloud held `pendiente` in the instant before its first drain. */
  cloudPendingBeforeFirstDrain: string[];
  /** `current.json` as box-a read it back from the store on its return. */
  current: CurrentPointer | null;
};

export default async function happyLoop({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  if (!litestream) {
    // No container is started on this path. `critical: true` does nothing here: the runner prints
    // id, title, verdict and detail, and reads `critical` only when a verdict is FAIL
    // (`src/scenarios.ts`). What keeps this row from reading as a pass is the verdict SKIPPED and
    // the detail below saying the loop is UNPROVEN; the flag is set because plan Task 7 asks for it.
    return {
      id: "S0",
      title: "the happy failover loop, end to end",
      verdict: "SKIPPED",
      critical: true,
      detail: `litestream v${LITESTREAM_VERSION} not found; run \`pnpm --filter @waitron/bench-sqlite-failover setup:litestream\` — S0 is UNPROVEN until then`,
    };
  }

  const store = await startStore();
  try {
    // Part A — the happy loop, and the verdict.
    const happy = await runLoop(store, litestream.bin, HAPPY, (probe) => assertHappyLoop(probe));

    // Part B — the CONTROL. The identical loop with the ship left out must reproduce the opposite
    // result, and Part A's own comparison must be the thing that refuses it. Without this, "the
    // restore plus the ship gave us 1..6" is unfalsifiable: a restore that had somehow carried 5
    // and 6 would look exactly like a ship that worked.
    const control = await runLoop(store, litestream.bin, CONTROL, (probe) =>
      assertShipIsWhatCarriesTheTail(probe),
    );

    // Part C — the stream-lag MEASUREMENT. Not part of the verdict; see the header.
    const lag = await runLoop(store, litestream.bin, LAG, (probe) => measureStreamLag(probe));

    return {
      id: "S0",
      title: "the happy failover loop, end to end",
      verdict: "PASS",
      critical: true,
      detail:
        `version=${litestream.version} happy-box-a-filed=[${happy.boxADrain}] happy-cloud-first-drain=[${happy.cloudFirstDrain}] happy-cloud-second-drain=[${happy.cloudSecondDrain}] happy-submissions=${happy.submissions.length} happy-distinct=${happy.distinct} happy-refiled=${happy.refiled.length} happy-current=${happy.current} ` +
        `control-ship=${CONTROL.ship ? "on" : "off"} control-held=${control.heldBoxA} control-refused="${control.refusal}" ` +
        `lag-sync-after-drain=${LAG.syncAfterDrain ? "on" : "off"} lag-refiled=${lag.refiled.length} lag-refiled-ids=[${lag.refiled}] lag-refiled-shape=${lag.shape} lag-cloud-first-drain=[${lag.cloudFirstDrain}]`,
    };
  } finally {
    await store.stop();
  }
}

/**
 * One turn of the loop, in its own temp directory and under its own terms. The assertions run in
 * `inspect`, before anything is torn down.
 *
 * The sequence:
 *   1. box-a opens `venue.db` and records four sales;
 *   2. a one-shot sync uploads them to `venues/v1/gen-<boxTerm>-box-a`;
 *   3. box-a's own drain files those four, and — under `syncAfterDrain` — a second one-shot sync
 *      carries that state to the store;
 *   4. box-a records two more sales and is KILLED before the next sync, which is modelled by closing
 *      its handle: nothing syncs after this, so the store holds only what steps 2 and 3 put there;
 *   5. the cloud restores box-a's generation into a fresh path, takes `cloudTerm`, sells once for
 *      itself and drains;
 *   6. box-a reopens, reads `current.json`, sees a term above its own — so it ships instead of
 *      selling (under `ship`) — and the cloud drains again.
 *
 * Box-a never drains after it returns, and nothing here forces that: it is the sequence being
 * modelled, and a fenced node that cannot sell is not modelled at all (see the header).
 */
async function runLoop<T>(
  store: Store,
  bin: string,
  part: Part,
  inspect: (probe: LoopProbe) => T,
): Promise<T> {
  let dir: string | undefined;
  let boxA: NodeDb | undefined;
  let cloud: NodeDb | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "waitron-s0-"));
    const dbPath = join(dir, "venue.db");

    const submissions: string[] = [];
    const submit = (nodeId: string, secuencia: number): void => {
      submissions.push(`${nodeId}:${secuencia}`);
    };

    boxA = openNode(BOX_A, dbPath);
    for (let i = 0; i < SALES_BEFORE_SYNC; i += 1) recordSale(boxA, 1000 + i);

    const config = writeConfig({
      dbPath,
      store,
      prefix: boxPrefix(part),
      configPath: join(dir, "box-a.yml"),
    });
    await syncOnce(bin, config);
    // A precondition rather than a result: if the sync uploaded nothing, everything below would be
    // measuring an empty store instead of the loop.
    assert.ok(
      (await store.listKeys(boxPrefix(part))).length > 0,
      `the box's sync uploaded nothing under ${boxPrefix(part)}`,
    );

    const boxADrainFrom = submissions.length;
    drainPass(boxA, submit);
    const boxADrain = submissions.slice(boxADrainFrom);
    assert.deepStrictEqual(
      boxADrain,
      identities(BOX_A, 1, SALES_BEFORE_SYNC),
      "the box files its own first four records before it dies",
    );
    if (part.syncAfterDrain) await syncOnce(bin, config);

    for (let i = 0; i < TAIL_SALES; i += 1) recordSale(boxA, 2000 + i);
    // Read from BOX-A, which is the only place these rows exist as their author wrote them. Every
    // later comparison is against this, never against what the receiver ended up with.
    const boxARows = boxA.all<RecordRow>(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? ORDER BY secuencia`,
      BOX_A,
    );
    assert.equal(
      boxARows.length,
      SALES_BEFORE_SYNC + TAIL_SALES,
      "the box wrote six records before it died",
    );
    // The kill. Nothing syncs after it, and the handle is unusable until box-a returns below.
    boxA.close();
    boxA = undefined;

    const cloudPath = join(dir, "cloud-1.db");
    await restore(bin, config, dbPath, cloudPath);
    cloud = openNode(CLOUD, cloudPath);
    assert.equal(
      await promote(store, part.cloudTerm, CLOUD),
      "won",
      "the cloud takes the venue for the higher term",
    );
    const cloudOwn = recordSale(cloud, 5000);

    const cloudPendingBeforeFirstDrain = pendingIdentities(cloud);
    const cloudFirstFrom = submissions.length;
    drainPass(cloud, submit);
    const cloudFirstDrain = submissions.slice(cloudFirstFrom);

    // The return.
    boxA = openNode(BOX_A, dbPath);
    const current = await readCurrent(store);
    assert.ok(
      current !== null && current.term > part.boxTerm,
      "the returning box reads a term above its own, so it ships rather than selling",
    );
    if (part.ship) {
      const tail = diffTail(boxA, summarise(cloud));
      applyTail(cloud, BOX_A, tail);
    }
    const cloudSecondFrom = submissions.length;
    drainPass(cloud, submit);
    const cloudSecondDrain = submissions.slice(cloudSecondFrom);

    return inspect({
      part,
      cloud,
      boxARows,
      cloudOwn,
      submissions,
      boxADrain,
      cloudFirstDrain,
      cloudSecondDrain,
      cloudPendingBeforeFirstDrain,
      current,
    });
  } finally {
    // This part owns the two handles and the temp directory; the store belongs to the scenario,
    // whose own `finally` stops it. That INVERTS the order the two siblings use — `s_smoke.ts:77-82`
    // and `s_litestream_roundtrip.ts` stop the store first, inside one `finally`, because a throw
    // ahead of `stop()` leaves a MinIO container `pnpm reap` will not touch for two hours — and it
    // reaches the same guarantee by a different route: no close in here can stop the scenario's
    // `finally` running `store.stop()`. The temp directory needs its own `finally` for the same
    // reason, one level down: a close that throws would otherwise skip the removal.
    try {
      boxA?.close();
      cloud?.close();
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Part A. Every assertion the verdict rests on. */
function assertHappyLoop(probe: LoopProbe): {
  boxADrain: string[];
  cloudFirstDrain: string[];
  cloudSecondDrain: string[];
  submissions: string[];
  distinct: number;
  refiled: string[];
  current: string;
} {
  assertChainsVerify(probe.cloud);
  assertReceiverHoldsSenderChain(probe);
  assertOwnChainIntact(probe);
  assertEveryRowAttributedToItsWriter(probe);

  // EXACTLY once, across every drain of the run and both nodes: there is one tax agency, so a
  // record filed by its owner and filed again by the node it was shipped to has been filed twice,
  // whichever database each filing came out of. Compared as a sorted list and not as a count — a
  // ledger holding `box-a:1` twice and `box-a:6` never has the same length as the right one.
  const expected = [...identities(BOX_A, 1, SALES_BEFORE_SYNC + TAIL_SALES), `${CLOUD}:1`].sort();
  assert.deepStrictEqual(
    [...probe.submissions].sort(),
    expected,
    "every record was handed to the tax agency exactly once across the whole run",
  );

  // Part C's control, and the reason that measurement is not "a number the code happens to print":
  // the same code path with one flag different files nothing twice here.
  const refiled = probe.cloudFirstDrain.filter((id) => probe.boxADrain.includes(id));
  assert.deepStrictEqual(
    refiled,
    [],
    "the cloud files none of the records the box had already filed",
  );

  assertCloudDrainFilesWhatItHeld(probe);

  // Read back from the store, not assumed, and spelled out from this part's own constants.
  assert.deepStrictEqual(
    probe.current,
    { term: probe.part.cloudTerm, nodeId: CLOUD, gen: cloudGeneration(probe.part) },
    "current.json names the cloud's term and generation",
  );

  return {
    boxADrain: probe.boxADrain,
    cloudFirstDrain: probe.cloudFirstDrain,
    cloudSecondDrain: probe.cloudSecondDrain,
    submissions: probe.submissions,
    distinct: new Set(probe.submissions).size,
    refiled,
    current: `{term:${probe.current?.term},node:${probe.current?.nodeId},gen:${probe.current?.gen}}`,
  };
}

/**
 * Part B — the control. The same loop with the ship left out, where the cloud must end up holding
 * box-a's 1..4 and NOT its tail, and where Part A's own comparison must be what refuses that state.
 *
 * Driving the same helper is the point: a control asserting "5 and 6 are missing" in its own words
 * would still be green if Part A's comparison had stopped checking anything.
 */
function assertShipIsWhatCarriesTheTail(probe: LoopProbe): {
  heldBoxA: string;
  refusal: string;
} {
  const held = probe.cloud.all<RecordRow>(
    `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
     WHERE node_id = ? ORDER BY secuencia`,
    BOX_A,
  );
  assert.deepStrictEqual(
    held.map((row) => Number(row.secuencia)),
    Array.from({ length: SALES_BEFORE_SYNC }, (_unused, index) => index + 1),
    "without the ship the cloud holds only the records the stream carried",
  );
  // The rows it DOES hold are still the box's own, byte for byte — so what the ship adds is the
  // tail, not the contents of what was already there.
  assert.deepStrictEqual(
    held,
    probe.boxARows.slice(0, SALES_BEFORE_SYNC),
    "the records the stream carried match the box's own rows",
  );

  let refusal: string | null = null;
  try {
    assertReceiverHoldsSenderChain(probe);
  } catch (error) {
    // Only an assertion, and nothing else: a helper that threw a TypeError would otherwise be
    // recorded as Part A's comparison doing its job.
    if (!(error instanceof assert.AssertionError)) throw error;
    refusal = error.message.split("\n")[0] ?? "";
  }
  assert.ok(refusal, "Part A's 1..6 comparison refuses the state the control produces");

  assertChainsVerify(probe.cloud);
  return { heldBoxA: `${BOX_A}:1..${held.length}`, refusal };
}

/**
 * Part C — the stream lag, recorded rather than judged.
 *
 * Box-a files records 1..4 and dies before that `envios` update syncs, so the cloud restores them
 * `pendiente` and its own drain files them a second time. Three things are asserted, all true
 * whichever way the lag falls: the cloud's drain files exactly the rows the cloud itself held
 * `pendiente`; every REPEAT is a verbatim copy of the row box-a filed — same node, same secuencia,
 * same huella, same payload; and every row the cloud holds sits under the node that wrote it.
 *
 * The first two say nothing about a duplicate filed under a DIFFERENT identity, because they select
 * the repeats by identity in the first place. That is why the third is here and why it is the one
 * that carries the sentence: with it, what this part records is the shape a real AEAT refuses
 * (error 3000) rather than a new danger. Measured — an extra row carrying `box-a:1`'s payload
 * inserted as `box-c:1`, with its huella recomputed and a `pendiente` submission, before the cloud's
 * first drain: without the attribution check the whole scenario reported PASS with that row filed;
 * with it, Part C fails on "the cloud filed box-a:1's record as box-c:1" (2026-09-18).
 */
function measureStreamLag(probe: LoopProbe): {
  refiled: string[];
  shape: string;
  cloudFirstDrain: string[];
} {
  assertCloudDrainFilesWhatItHeld(probe);
  assertEveryRowAttributedToItsWriter(probe);

  const refiled = [...probe.cloudFirstDrain, ...probe.cloudSecondDrain].filter((id) =>
    probe.boxADrain.includes(id),
  );
  const byIdentity = new Map(
    probe.boxARows.map((row) => [`${String(row.node_id)}:${Number(row.secuencia)}`, row]),
  );
  for (const id of refiled) {
    const asBoxAWroteIt = byIdentity.get(id);
    assert.ok(asBoxAWroteIt, `the cloud filed ${id}, which the box never wrote`);
    const asTheCloudHoldsIt = probe.cloud.get<RecordRow>(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? AND secuencia = ?`,
      String(asBoxAWroteIt.node_id),
      Number(asBoxAWroteIt.secuencia),
    );
    assert.deepStrictEqual(
      asTheCloudHoldsIt,
      asBoxAWroteIt,
      `the cloud's second filing of ${id} is a verbatim copy of the record its owner filed`,
    );
  }

  assertChainsVerify(probe.cloud);
  // Derived from the loop above rather than written as a literal in the verdict: with no repeat to
  // compare, "verbatim-same-identity" would be a shape asserted of an empty set, and would go on
  // printing on the day the protocol changes and the count reaches zero.
  return {
    refiled,
    shape: refiled.length > 0 ? "verbatim-same-identity" : "no-repeat-to-compare",
    cloudFirstDrain: probe.cloudFirstDrain,
  };
}

/**
 * The receiver holds box-a's whole chain, 1..6, with the contents box-a wrote — compared field by
 * field against box-a's own rows. Never a count: six rows carrying the wrong payloads, or the right
 * payloads under shifted secuencias, satisfy a count (`CLAUDE.md` §4).
 *
 * "Exactly once each" is not what this measures, and cannot be: `records` is keyed
 * `(node_id, secuencia)`, so the table could not hold a row twice however the loop behaved. The
 * exactly-once claim is about the SUBMIT ledger, and lives in `assertHappyLoop`.
 *
 * Part B drives this same function over a receiver that never got the tail, and requires it to
 * throw.
 */
function assertReceiverHoldsSenderChain(probe: LoopProbe): void {
  const held = probe.cloud.all<RecordRow>(
    `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
     WHERE node_id = ? ORDER BY secuencia`,
    BOX_A,
  );
  assert.deepStrictEqual(
    held,
    probe.boxARows,
    "the cloud holds box-a's records 1..6 exactly as box-a wrote them",
  );
}

/**
 * The cloud's own chain is its own: one record, under its own id, at secuencia 1, with no
 * predecessor — and carrying the huella its own write returned.
 *
 * That returned huella is the one independent capture available for this row: unlike box-a's
 * records, the cloud's record exists in exactly one database, so anything read back from the cloud
 * to check the cloud would be circular.
 */
function assertOwnChainIntact(probe: LoopProbe): void {
  const own = probe.cloud.all<RecordRow>(
    `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
     WHERE node_id = ? ORDER BY secuencia`,
    CLOUD,
  );
  assert.equal(own.length, 1, "the cloud holds exactly the one record it wrote for itself");
  assert.equal(Number(own[0]?.secuencia), 1, "the cloud's own chain starts at secuencia 1");
  assert.equal(own[0]?.huella_anterior, null, "the cloud's first record has no predecessor");
  assert.equal(
    own[0]?.huella,
    probe.cloudOwn.huella,
    "the cloud's record carries the huella its own write returned",
  );
  assert.equal(Number(probe.cloudOwn.secuencia), 1, "the cloud's sale was its chain's first");
}

/**
 * Every `records` row on the receiver sits under the node that WROTE it.
 *
 * The payload carries the sale's uuid, so it names its writer independently of the `node_id` column
 * the row is filed under. What this catches that the two chain checks above do not is a row under a
 * THIRD node id: `assertReceiverHoldsSenderChain` reads only box-a's rows and `assertOwnChainIntact`
 * only the cloud's, so a row attributed to a node neither of them names passes both. Part C runs it
 * for a further reason of its own — see `measureStreamLag`.
 */
function assertEveryRowAttributedToItsWriter(probe: LoopProbe): void {
  const writtenBy = new Map<string, string>();
  for (const row of probe.boxARows) {
    writtenBy.set(String(row.payload), `${String(row.node_id)}:${Number(row.secuencia)}`);
  }
  const ownPayload = probe.cloud.get<RecordRow>(
    `SELECT payload FROM records WHERE node_id = ? AND secuencia = ?`,
    CLOUD,
    probe.cloudOwn.secuencia,
  );
  assert.ok(ownPayload, "the cloud holds the record its own write returned");
  writtenBy.set(String(ownPayload.payload), `${CLOUD}:${probe.cloudOwn.secuencia}`);

  const held = probe.cloud.all<RecordRow>(
    `SELECT node_id, secuencia, payload FROM records ORDER BY node_id, secuencia`,
  );
  for (const row of held) {
    const writer = writtenBy.get(String(row.payload));
    const filedAs = `${String(row.node_id)}:${Number(row.secuencia)}`;
    assert.ok(writer, `the cloud holds ${filedAs}, which neither node in this run wrote`);
    assert.equal(writer, filedAs, `the cloud filed ${writer}'s record as ${filedAs}`);
  }
}

/**
 * The cloud's first drain files exactly the rows the cloud itself held `pendiente` in the instant
 * before that drain — a statement about the drain, true whether the stream lag left it holding
 * records its owner had already filed or not. Part A and Part C both run it, which is what makes
 * Part C's recorded number a difference in the loop's state rather than in what was asserted.
 */
function assertCloudDrainFilesWhatItHeld(probe: LoopProbe): void {
  assert.deepStrictEqual(
    [...probe.cloudFirstDrain].sort(),
    [...probe.cloudPendingBeforeFirstDrain].sort(),
    "the cloud's drain files exactly the records it was holding pending",
  );
}

/**
 * Each chain in a database verifies on its own terms: the secuencias run 1..N with no gap,
 * `huella_anterior` is the row before's huella (null at secuencia 1), and the huella is the model
 * hash of that predecessor and this row's payload.
 *
 * `toyHuella` is the rig's hash and not AEAT's (`model.ts`), so what this establishes is that a link
 * is checkable and unbroken, never that the chain would satisfy the tax agency.
 */
function assertChainsVerify(db: NodeDb): void {
  const rows = db.all<RecordRow>(
    `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
     ORDER BY node_id, secuencia`,
  );
  const chains = new Map<string, RecordRow[]>();
  for (const row of rows) {
    const nodeId = String(row.node_id);
    const chain = chains.get(nodeId) ?? [];
    chain.push(row);
    chains.set(nodeId, chain);
  }
  assert.ok(chains.size > 0, "the database holds at least one chain to verify");

  for (const [nodeId, chain] of chains) {
    let previous: string | null = null;
    chain.forEach((row, index) => {
      assert.equal(
        Number(row.secuencia),
        index + 1,
        `${nodeId}'s chain runs 1..N with no gap (at position ${index + 1})`,
      );
      assert.equal(
        row.huella_anterior,
        previous,
        `${nodeId}:${Number(row.secuencia)} links to the record before it`,
      );
      assert.equal(
        row.huella,
        toyHuella(previous, String(row.payload)),
        `${nodeId}:${Number(row.secuencia)}'s huella is the hash of its own payload`,
      );
      previous = String(row.huella);
    });
  }
}

/** `node:first … node:last`, the form the submit ledger records an identity in. */
function identities(nodeId: string, first: number, last: number): string[] {
  const out: string[] = [];
  for (let secuencia = first; secuencia <= last; secuencia += 1) out.push(`${nodeId}:${secuencia}`);
  return out;
}

/** What this node holds `pendiente` right now, as submit-ledger identities. */
function pendingIdentities(db: NodeDb): string[] {
  return db
    .all<{ node_id: string; secuencia: number }>(
      `SELECT node_id, secuencia FROM envios WHERE estado = 'pendiente' ORDER BY node_id, secuencia`,
    )
    .map((row) => `${String(row.node_id)}:${Number(row.secuencia)}`);
}
