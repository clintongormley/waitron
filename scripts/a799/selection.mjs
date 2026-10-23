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
    position(candidate.image.sourceSha) < 0 ||
    position(index.epoch.baselineSourceSha) !== 0
  )
    fail("history.ancestry", "candidate order");

  const sources = new Map();
  const ordinals = new Map();
  for (const fixture of index.fixtures) {
    if (fixture.epochId !== index.epoch.id) fail("history.epoch", fixture.id);
    const sha = fixture.image.sourceSha;
    if (position(sha) < 0) fail("history.ancestry", sha);
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
  const retained = [...sources.keys()].sort((a, b) => position(a) - position(b));
  let lastOrdinal = 0;
  for (const sha of retained) {
    const group = sources.get(sha);
    if (group[0].retainedOrdinal <= lastOrdinal) fail("history.ancestry", "retained ordinal order");
    lastOrdinal = group[0].retainedOrdinal;
    const required = group.filter((f) => f.moduleVariant === "required-verifactu");
    const optional = group.filter((f) => f.moduleVariant !== "required-verifactu");
    const latest = (captures) => {
      if (captures.length === 0 || new Set(captures.map((f) => f.version)).size !== captures.length)
        fail("history.variant", sha);
      return captures.reduce((a, b) => (a.version > b.version ? a : b));
    };
    sources.set(sha, [latest(required), latest(optional)]);
  }
  if (!sources.has(index.oldestSource)) fail("history.source", "oldest");
  if (index.oldestSource !== retained[0])
    fail("history.retirement", "oldest pointer changed without retained retirement history");
  let oldest = index.oldestSource;
  const retirements = index.retirements
    .filter((r) => {
      if (!sources.has(r.retired) || !sources.has(r.replacement))
        fail("history.source", "retirement");
      if (position(r.effectiveCandidateSha) < 0)
        fail("history.ancestry", "retirement effective candidate");
      return position(r.effectiveCandidateSha) <= position(candidate.image.sourceSha);
    })
    .sort((a, b) => position(a.effectiveCandidateSha) - position(b.effectiveCandidateSha));
  for (const retirement of retirements) {
    if (
      retirement.retired !== oldest ||
      position(retirement.replacement) <= position(oldest) ||
      position(retirement.replacement) >= position(retirement.effectiveCandidateSha)
    )
      fail("history.retirement", retirement.retired);
    oldest = retirement.replacement;
  }
  const previous = retained
    .filter((sha) => position(sha) < position(candidate.image.sourceSha))
    .at(-1);
  if (previous === undefined || position(oldest) >= position(candidate.image.sourceSha))
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
  const capturedHashes = new Set(inputs.oldJournals.flatMap((j) => j.rows.map((r) => r.hash)));
  for (const baselineHash of epoch.baselineMigrationHashes) {
    if (!capturedHashes.has(baselineHash))
      fail("history.epoch", "missing captured baseline migration");
  }
  const journals = new Map(inputs.oldJournals.map((j) => [j.set, j]));
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
