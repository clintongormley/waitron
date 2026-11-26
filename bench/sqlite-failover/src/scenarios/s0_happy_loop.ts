// Drive the failover loop with real Litestream and the model ledger. The no-ship control must fail
// the happy loop's own comparison. The lag arm measures repeat submissions when the last filing
// state never streamed.
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

const VENUE = "venues/v1";

const BOX_A = "box-a";
const CLOUD = "cloud-1";

const SALES_BEFORE_SYNC = 4;
const TAIL_SALES = 2;

// The arms share a store and use separate terms to keep their generations and claims apart.
type Part = {
  boxTerm: number;
  cloudTerm: number;
  ship: boolean;
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

type LoopProbe = {
  part: Part;
  cloud: NodeDb;
  boxARows: RecordRow[];
  cloudOwn: { secuencia: number; huella: string };
  submissions: string[];
  boxADrain: string[];
  cloudFirstDrain: string[];
  cloudSecondDrain: string[];
  cloudPendingBeforeFirstDrain: string[];
  current: CurrentPointer | null;
};

export default async function happyLoop({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  if (!litestream) {
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
    const happy = await runLoop(store, litestream.bin, HAPPY, (probe) => assertHappyLoop(probe));

    // The same comparison used by the happy loop must reject the no-ship control.
    const control = await runLoop(store, litestream.bin, CONTROL, (probe) =>
      assertShipIsWhatCarriesTheTail(probe),
    );

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
    // Close both handles before deleting their directory. The outer scenario owns the shared
    // store.
    try {
      boxA?.close();
      cloud?.close();
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

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
  // Require a repeat before comparing the identities, since equality on an empty set would pass.
  return {
    refiled,
    shape: refiled.length > 0 ? "verbatim-same-identity" : "no-repeat-to-compare",
    cloudFirstDrain: probe.cloudFirstDrain,
  };
}

// Compare against the writer's rows so a restore of the right size with the wrong contents fails.
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

// Use the hash returned at write time as an independent answer for the cloud's record.
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

// Read the writer from the sale UUID so a misplaced row cannot supply its own expected owner.
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

function assertCloudDrainFilesWhatItHeld(probe: LoopProbe): void {
  assert.deepStrictEqual(
    [...probe.cloudFirstDrain].sort(),
    [...probe.cloudPendingBeforeFirstDrain].sort(),
    "the cloud's drain files exactly the records it was holding pending",
  );
}

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

function identities(nodeId: string, first: number, last: number): string[] {
  const out: string[] = [];
  for (let secuencia = first; secuencia <= last; secuencia += 1) out.push(`${nodeId}:${secuencia}`);
  return out;
}

function pendingIdentities(db: NodeDb): string[] {
  return db
    .all<{ node_id: string; secuencia: number }>(
      `SELECT node_id, secuencia FROM envios WHERE estado = 'pendiente' ORDER BY node_id, secuencia`,
    )
    .map((row) => `${String(row.node_id)}:${Number(row.secuencia)}`);
}
