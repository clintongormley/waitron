const sourcePattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const variants = ["required-verifactu", "disabled-retained", "never-enabled"];

export function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function invalid(path) {
  fail("history.invalid", path);
}

function object(value, fields, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path);
  if (Object.keys(value).length !== Object.keys(fields).length) invalid(path);
  for (const [key, parse] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`);
    parse(value[key], `${path}.${key}`);
  }
}

function text(value, path) {
  if (typeof value !== "string" || value.trim() === "") invalid(path);
}
function positive(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) invalid(path);
}
function nonnegative(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(path);
}
function source(value, path) {
  if (typeof value !== "string" || !sourcePattern.test(value)) invalid(path);
}
function hash(value, path) {
  if (typeof value !== "string" || !hashPattern.test(value)) invalid(path);
}
function literal(expected) {
  return (value, path) => {
    if (value !== expected) invalid(path);
  };
}
function array(parse, minimum = 0) {
  return (value, path) => {
    if (!Array.isArray(value) || value.length < minimum) invalid(path);
    for (const entry of value) parse(entry, path);
  };
}
function unique(values, path) {
  if (new Set(values).size !== values.length) invalid(`${path}: duplicate`);
}
const imageFields = {
  sourceSha: source,
  manifestDigest: hash,
  platformDigest: hash,
  platform: text,
  buildIdentity: text,
  nodeVersion: text,
  sqliteVersion: text,
  entry: array(text, 1),
};
function image(value, path) {
  object(value, imageFields, path);
}
function epoch(value, path) {
  object(
    value,
    {
      id: text,
      a760ResetReceipt: text,
      baselineSourceSha: source,
      baselineMigrationHashes: array(
        (entry, p) => object(entry, { set: text, table: text, hash }, p),
        1,
      ),
    },
    path,
  );
  unique(
    value.baselineMigrationHashes.map((entry) =>
      JSON.stringify([entry.set, entry.table, entry.hash]),
    ),
    path,
  );
}
function inventoryEntry(value, path) {
  object(
    value,
    {
      path: text,
      kind: text,
      mode: nonnegative,
      bytes: nonnegative,
      sha256: (v, p) => {
        if (v !== null) hash(v, p);
      },
    },
    path,
  );
  if (!["file", "directory"].includes(value.kind) || value.mode > 511) invalid(path);
  if (value.kind === "file" ? value.sha256 === null : value.sha256 !== null || value.bytes !== 0)
    invalid(path);
  if (
    value.path.startsWith("/") ||
    value.path.includes("\\") ||
    value.path.includes("\0") ||
    value.path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    invalid(path);
}
function asset(value, path) {
  object(
    value,
    {
      releaseId: positive,
      assetId: positive,
      name: text,
      sha256: hash,
      bytes: positive,
      inventory: array(inventoryEntry, 1),
    },
    path,
  );
  unique(
    value.inventory.map((e) => e.path),
    path,
  );
}
function limits(value, path) {
  object(
    value,
    Object.fromEntries(
      [
        "compressedBytes",
        "unpackedBytes",
        "entries",
        "perFileBytes",
        "logBytes",
        "memoryBytes",
        "scratchBytes",
        "processCount",
      ].map((key) => [key, positive]),
    ),
    path,
  );
}
function fixture(value, path) {
  object(
    value,
    {
      id: text,
      version: positive,
      epochId: text,
      image,
      driverSha: source,
      scenarioVersion: text,
      retainedOrdinal: positive,
      moduleVariant: text,
      bundle: asset,
      evidence: asset,
      limits,
      reviewReceipt: text,
      controlReceipt: text,
    },
    path,
  );
  if (!variants.includes(value.moduleVariant)) invalid(path);
}
function retirement(value, path) {
  object(
    value,
    { retired: source, replacement: source, effectiveCandidateSha: source, ownerReceipt: text },
    path,
  );
}

/** @returns {UpgradeIndex} */
export function parseIndex(value) {
  object(
    value,
    {
      version: literal(1),
      epoch: (v, p) => {
        if (v !== null) epoch(v, p);
      },
      fixtures: array(fixture),
      oldestSource: (v, p) => {
        if (v !== null) source(v, p);
      },
      retirements: array(retirement),
    },
    "index",
  );
  unique(
    value.fixtures.map((f) => f.id),
    "fixtures",
  );
  unique(
    value.retirements.map((r) => r.retired),
    "retirements",
  );
  if (value.epoch === null || value.oldestSource === null || value.fixtures.length === 0) {
    if (
      value.epoch !== null ||
      value.oldestSource !== null ||
      value.fixtures.length ||
      value.retirements.length
    )
      invalid("index: partial qualification");
  }
  return globalThis.structuredClone(value);
}

export function parseCandidate(value) {
  object(value, { image, epochId: text, orderedSourceShas: array(source, 1) }, "candidate");
  return globalThis.structuredClone(value);
}

export function parseEpoch(value) {
  epoch(value, "epoch");
  return globalThis.structuredClone(value);
}

export function parseImage(value) {
  image(value, "image");
  return globalThis.structuredClone(value);
}

function integer(value, path) {
  object(value, { kind: literal("integer"), decimal: text }, path);
  if (!/^(0|[1-9][0-9]*)$/.test(value.decimal)) invalid(path);
}
function journal(value, path) {
  object(
    value,
    {
      set: text,
      table: text,
      rows: array((row, p) => {
        object(row, { id: integer, hash, createdAt: integer }, p);
      }),
    },
    path,
  );
  unique(
    value.rows.map((r) => r.hash),
    path,
  );
  unique(
    value.rows.map((r) => r.id.decimal),
    path,
  );
}
function packaged(value, path) {
  object(
    value,
    {
      set: text,
      table: text,
      sql: array((row, p) => {
        object(row, { hash, when: positive, fileSha256: hash }, p);
      }),
      metaSha256: hash,
      enabled: (v, p) => {
        if (typeof v !== "boolean") invalid(p);
      },
    },
    path,
  );
  unique(
    value.sql.map((r) => r.hash),
    path,
  );
}
export function parseWorkInputs(oldJournals, packagedSets, enabledSets) {
  array(journal)(oldJournals, "journals");
  array(packaged)(packagedSets, "packaged");
  array(text)(enabledSets, "enabledSets");
  unique(
    oldJournals.map((j) => j.set),
    "journals",
  );
  unique(
    packagedSets.map((p) => p.set),
    "packaged",
  );
  unique(
    oldJournals.map((j) => j.table),
    "journal tables",
  );
  unique(
    packagedSets.map((p) => p.table),
    "packaged journal tables",
  );
  unique(enabledSets, "enabledSets");
  return globalThis.structuredClone({ oldJournals, packagedSets, enabledSets });
}

/**
 * @typedef {object} Image
 * @property {string} sourceSha
 * @property {string} manifestDigest
 * @property {string} platformDigest
 * @property {string} platform
 * @property {string} buildIdentity
 * @property {string} nodeVersion
 * @property {string} sqliteVersion
 * @property {string[]} entry
 *
 * @typedef {object} Epoch
 * @property {string} id
 * @property {string} a760ResetReceipt
 * @property {string} baselineSourceSha
 * @property {{set:string, table:string, hash:string}[]} baselineMigrationHashes
 *
 * @typedef {object} InventoryEntry
 * @property {string} path
 * @property {"file"|"directory"} kind
 * @property {number} mode
 * @property {number} bytes
 * @property {string|null} sha256
 *
 * @typedef {object} Asset
 * @property {number} releaseId
 * @property {number} assetId
 * @property {string} name
 * @property {string} sha256
 * @property {number} bytes
 * @property {InventoryEntry[]} inventory
 *
 * @typedef {object} Fixture
 * @property {string} id
 * @property {number} version
 * @property {string} epochId
 * @property {Image} image
 * @property {string} driverSha
 * @property {string} scenarioVersion
 * @property {number} retainedOrdinal
 * @property {"required-verifactu"|"disabled-retained"|"never-enabled"} moduleVariant
 * @property {Asset} bundle
 * @property {Asset} evidence
 * @property {Record<string,number>} limits
 * @property {string} reviewReceipt
 * @property {string} controlReceipt
 *
 * @typedef {{retired:string, replacement:string, effectiveCandidateSha:string, ownerReceipt:string}} Retirement
 * @typedef {{version:1, epoch:Epoch|null, fixtures:Fixture[], oldestSource:string|null, retirements:Retirement[]}} UpgradeIndex
 * @typedef {{image:Image, epochId:string, orderedSourceShas:string[]}} Candidate
 * @typedef {{id:string, sourceSha:string, candidate:Candidate, fixture:Fixture}} Cell
 */
