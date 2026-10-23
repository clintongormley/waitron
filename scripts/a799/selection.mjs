import { isDeepStrictEqual } from "node:util";
import {
  fail,
  parseCandidate,
  parseEpoch,
  parseImage,
  parseIndex,
  parseWorkInputs,
} from "./contracts.mjs";

function sameImage(a, b) {
  return (
    a.manifestDigest === b.manifestDigest &&
    a.platformDigest === b.platformDigest &&
    a.platform === b.platform &&
    a.buildIdentity === b.buildIdentity &&
    a.nodeVersion === b.nodeVersion &&
    a.sqliteVersion === b.sqliteVersion &&
    JSON.stringify(a.entry) === JSON.stringify(b.entry)
  );
}

/** @returns {import('./contracts.mjs').Cell[]} */
export function selectCells(rawIndex, rawCandidate) {
  const index = parseIndex(rawIndex);
  const candidate = parseCandidate(rawCandidate);
  if (index.epoch === null) fail("history.unqualified", "no qualified post-reset history");
  if (index.epoch.id !== candidate.epochId) fail("history.epoch", "candidate");
  const order = candidate.orderedSourceShas;
  const position = (sha) => order.indexOf(sha);
  if (
    new Set(order).size !== order.length ||
    order.at(-1) !== candidate.image.sourceSha ||
    position(index.epoch.baselineSourceSha) !== 0
  )
    fail("history.ancestry", "candidate order");

  const sources = new Map();
  const ordinals = new Map();
  for (const fixture of index.fixtures) {
    if (fixture.epochId !== index.epoch.id) fail("history.epoch", fixture.id);
    const sha = fixture.image.sourceSha;
    if (fixture.image.platform !== candidate.image.platform) fail("history.platform", fixture.id);
    const group = sources.get(sha) ?? [];
    if (group.length) {
      if (!sameImage(group[0].image, fixture.image)) fail("history.source", sha);
      if (group[0].retainedOrdinal !== fixture.retainedOrdinal) fail("history.ordinal", sha);
    }
    if (ordinals.has(fixture.retainedOrdinal) && ordinals.get(fixture.retainedOrdinal) !== sha)
      fail("history.ordinal", sha);
    ordinals.set(fixture.retainedOrdinal, sha);
    group.push(fixture);
    sources.set(sha, group);
  }
  const retained = [...sources.keys()].sort(
    (a, b) => sources.get(a)[0].retainedOrdinal - sources.get(b)[0].retainedOrdinal,
  );
  let lastOrdinal = 0;
  let lastPosition = -1;
  for (const sha of retained) {
    const group = sources.get(sha);
    if (group[0].retainedOrdinal !== lastOrdinal + 1)
      fail("history.ancestry", "retained ordinal order");
    lastOrdinal = group[0].retainedOrdinal;
    if (position(sha) >= 0) {
      if (position(sha) <= lastPosition) fail("history.ancestry", "retained source order");
      lastPosition = position(sha);
    }
    const latest = (kind) => {
      const captures = group.filter((f) => f.moduleVariant === kind);
      if (new Set(captures.map((f) => f.version)).size !== captures.length)
        fail("history.variant", sha);
      return captures.reduce((a, b) => (a === null || a.version < b.version ? b : a), null);
    };
    const required = latest("required-verifactu");
    const retainedData = latest("disabled-retained");
    const neverEnabled = latest("never-enabled");
    if (required === null || (retainedData === null && neverEnabled === null))
      fail("history.variant", sha);
    sources.set(sha, [required, retainedData ?? neverEnabled]);
  }
  if (!sources.has(index.oldestSource)) fail("history.source", "oldest");
  if (index.oldestSource !== retained[0])
    fail("history.retirement", "oldest pointer changed without retained retirement history");
  let oldest = index.oldestSource;
  const retirements = index.retirements
    .filter((r) => {
      if (!sources.has(r.retired) || !sources.has(r.replacement))
        fail("history.source", "retirement");
      return position(r.effectiveCandidateSha) >= 0;
    })
    .sort((a, b) => position(a.effectiveCandidateSha) - position(b.effectiveCandidateSha));
  for (const retirement of retirements) {
    if (
      retirement.retired !== oldest ||
      position(oldest) < 0 ||
      position(retirement.replacement) <= position(oldest) ||
      position(retirement.replacement) >= position(retirement.effectiveCandidateSha)
    )
      fail("history.retirement", retirement.retired);
    oldest = retirement.replacement;
  }
  const previous = retained
    .filter((sha) => position(sha) >= 0 && position(sha) < position(candidate.image.sourceSha))
    .at(-1);
  if (
    previous === undefined ||
    position(oldest) < 0 ||
    position(oldest) >= position(candidate.image.sourceSha)
  )
    fail("history.source", "no earlier source");
  return [...new Set([oldest, previous])].flatMap((sha) =>
    sources.get(sha).map((fixture) => ({
      id: `${candidate.image.sourceSha}:${fixture.id}:${fixture.version}`,
      sourceSha: sha,
      candidate,
      fixture,
    })),
  );
}

/** Classifies reviewed packaged SQL; it does not execute or verify a migration. */
export function classifyWork(
  rawSource,
  rawCandidate,
  oldJournals,
  packagedSets,
  enabledSets,
  rawEpoch,
) {
  if (rawEpoch === undefined) fail("history.unqualified", "epoch receipt required");
  const epoch = parseEpoch(rawEpoch);
  const source = parseImage(rawSource);
  const candidate = parseImage(rawCandidate);
  const inputs = parseWorkInputs(oldJournals, packagedSets, enabledSets);
  if (source.platform !== candidate.platform) fail("history.platform", "migration inputs");
  const equal = sameImage(source, candidate);
  if ((source.sourceSha === candidate.sourceSha) !== equal)
    fail("history.image", "source identity");
  const journals = new Map(inputs.oldJournals.map((j) => [j.set, j]));
  for (const baseline of epoch.baselineMigrationHashes) {
    const captured = journals.get(baseline.set);
    if (
      captured === undefined ||
      captured.table !== baseline.table ||
      !captured.rows.some((row) => row.hash === baseline.hash)
    )
      fail("history.epoch", "missing captured baseline migration in its set and table");
  }
  const packages = new Map(inputs.packagedSets.map((p) => [p.set, p]));
  for (const old of inputs.oldJournals) {
    if (!packages.has(old.set)) fail("history.journal", `removed set ${old.set}`);
  }
  for (const set of inputs.enabledSets) {
    if (!packages.has(set)) fail("history.journal", `missing enabled set ${set}`);
  }
  const pending = [];
  const expectedAfter = [];
  for (const packaged of inputs.packagedSets) {
    if (packaged.enabled !== inputs.enabledSets.includes(packaged.set))
      fail("history.journal", `enabled ${packaged.set}`);
    const old = journals.get(packaged.set);
    if (packaged.enabled && !old) fail("history.module_state", `newly enabled set ${packaged.set}`);
    if (old && old.table !== packaged.table) fail("history.journal", `table ${packaged.set}`);
    let watermark = 0n;
    for (const migration of packaged.sql) {
      if (BigInt(migration.when) <= watermark) fail("history.journal", `watermark ${packaged.set}`);
      watermark = BigInt(migration.when);
    }
    const rows = old?.rows ?? [];
    for (const [i, row] of rows.entries()) {
      const sql = packaged.sql[i];
      if (sql === undefined || sql.hash !== row.hash || String(sql.when) !== row.createdAt.decimal)
        fail("history.journal", `prefix ${packaged.set}:${i}`);
    }
    const expectedRows = [...rows];
    if (packaged.enabled) {
      for (const migration of packaged.sql.slice(rows.length)) {
        pending.push({ set: packaged.set, table: packaged.table, ...migration });
        expectedRows.push({
          id: null,
          hash: migration.hash,
          createdAt: { kind: "integer", decimal: String(migration.when) },
        });
      }
    }
    if (old || packaged.enabled)
      expectedAfter.push({ set: packaged.set, table: packaged.table, rows: expectedRows });
  }
  if (equal && pending.length) fail("history.image", "same image has pending SQL");
  return { pending, expectedAfter, kind: pending.length ? "pending-upgrade" : "restart-only" };
}

/** Check updates against the previously committed trusted index before using the new one. */
export function validateIndexUpdate(rawPrevious, rawNext) {
  const previous = parseIndex(rawPrevious);
  const next = parseIndex(rawNext);
  if (
    previous.epoch !== null &&
    (!isDeepStrictEqual(previous.epoch, next.epoch) || previous.oldestSource !== next.oldestSource)
  )
    fail("history.retained", "qualified epoch or oldest pointer changed");
  const fixtures = new Map(next.fixtures.map((fixture) => [fixture.id, fixture]));
  for (const fixture of previous.fixtures) {
    if (!isDeepStrictEqual(fixture, fixtures.get(fixture.id)))
      fail("history.retained", `original fixture ${fixture.id}`);
  }
  for (const retirement of previous.retirements) {
    if (!next.retirements.some((entry) => isDeepStrictEqual(entry, retirement)))
      fail("history.retained", "owner retirement removed or changed");
  }
  return next;
}
