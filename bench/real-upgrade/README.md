# Historical upgrade checks

You need to keep records written by an older release exact when a new release starts.
This directory holds the qualification index for that check. It starts empty: no
historical capture, issued full invoice or successful upgrade is qualified here.

The [implementation plan](../../docs/superpowers/plans/2026-10-22-a799-real-upgrade-testing.md)
splits the work into seven pull requests. The owner authorised their build on
23 October 2026. Cuts 1–3 validate metadata, select required inputs, compare frozen facts and
admit downloaded archives through injected transport and placement adapters.
Runtime, capture, A760 reset, migration, upload, provider and trusted CI activation
still need their separately recorded authority and qualifying inputs.

## Select the required starting points

Use `parseIndex(value)` and `selectCells(index, candidate)` from
`scripts/a799/`. Each required starting point expands into a VeriFactu fixture and
one optional-module-off fixture. `disabled-retained` keeps a disabled module's
rows. `never-enabled` records that retained-data coverage is still missing; a later
runner must report that gap.

For sources R1 through R4 and candidate R5, selection requires R1 and R4. It
counts equal endpoints once. Within each kind it selects the highest qualified
capture version, retaining the originals in the index. Disabled-retained coverage
takes precedence over never-enabled coverage, even if the latter has a higher
version. Equal versions within one kind are ambiguous and are refused.

An owner retirement naming R2 as R1's replacement, effective at R5, changes R5's
selection to R2 and R4. `oldestSource` stays the original earliest retained source;
retirement records derive the effective oldest. Ordinals must begin at 1 with no
gaps, which detects removal of the oldest or an intermediate source. Before using
an updated index, the future trusted caller must call
`validateIndexUpdate(previousCommittedIndex, nextIndex)`. That check preserves each
original descriptor and owner retirement exactly, including the latest source,
whose deletion a single index cannot detect. No persistent updater is wired yet.

`candidate.orderedSourceShas` supplies the candidate's actual ancestor chain from
the baseline through the candidate itself. Later sources stay in the index but do
not participate in this candidate's selection. A retirement whose effective commit
is absent from the candidate's ancestors does not apply, including on a branch
that has not incorporated that commit. The selector checks unique membership and
retained source order; it performs no Git access. The future trusted caller must
verify actual Git ancestry and validate the index transition before candidate
access. Tags, names and capture timestamps do not establish ancestry.

Run the executable examples and refusal cases:

```sh
pnpm exec vitest run scripts/a799/selection.test.mjs
```

You can also observe the initial index's refusal from the repository root:

```sh
node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
import { parseIndex } from "./scripts/a799/contracts.mjs";
import { selectCells } from "./scripts/a799/selection.mjs";
const index = parseIndex(JSON.parse(readFileSync("bench/real-upgrade/index.json", "utf8")));
const sourceSha = "1".repeat(40);
try {
  selectCells(index, {
    image: {
      sourceSha, manifestDigest: "1".repeat(64), platformDigest: "2".repeat(64),
      platform: "linux/arm64", buildIdentity: "example", nodeVersion: "26.7.0",
      sqliteVersion: "3.53.1", entry: ["node", "/app/node-entry.js"],
    },
    epochId: "example", orderedSourceShas: [sourceSha],
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
JS
```

It exits 1 with `history.unqualified: no qualified post-reset history`. The example
metadata is invented; it identifies no available image. A selected cell is a
request for later qualification, never evidence of a passing upgrade or an
accessible asset. Fetch and archive admission come in cut 3; there is no CLI or
container runner in this cut.

## Distinguish pending migrations from a restart

`classifyWork(sourceImage, candidateImage, oldJournals, packagedSets, enabledSets,
epoch)` validates a reviewed SQL inventory against captured journal rows. Pass the
validated epoch explicitly: the five inputs in the original plan cannot establish
which baseline hashes a captured journal must contain. The epoch binds this
metadata check to set-qualified baseline hashes: each entry names its `set`,
`table` and `hash`. The receipt is required reviewed metadata, not authenticated by
this function. Neither the receipt's authenticity nor a database's actual bytes
is verified here.

Every old hash and stored migration timestamp must remain an exact prefix of its
set's packaged SQL. Disabled sets retain their old rows and apply nothing. An
absent, disabled set stays absent. Previously present enabled sets contribute
pending SQL after the old prefix.
First-time module enablement is refused with `history.module_state`, because
initialising a new module cannot replace upgrading captured history. An identical
image with pending SQL is refused. A later image without
pending SQL returns `restart-only`, which cannot satisfy the required real upgrade.
`expectedAfter` preserves old IDs; pending rows use `id: null` as an explicit
unknown engine-assigned ID, which later execution must observe and validate.

The contracts accept parsed objects and reject unknown keys, versions, duplicate
fixture IDs, duplicate inventory paths, invalid hashes and nonpositive resource
limits. Cut 3’s fetch boundary rejects duplicate JSON keys before they become an object.
The metadata parsers themselves do not read JSON bytes or archives.
Use the comparison interfaces below for facts and coverage. Cut 3 supplies the raw JSON-byte and archive boundary described below.

## Compare original records before making another sale

Cut 2 adds pure comparison functions. You supply independently frozen expected
facts and a later extraction; the functions neither open a database nor update
expectations. The tests use invented records, including a 350-thousandth quantity,
770-cent cheese line and 1,353-cent invoice. They establish comparator behaviour,
not a qualifying historical capture or upgrade.

Run the accepting examples and deliberate differences:

```sh
pnpm exec vitest run scripts/a799/compare.test.mjs scripts/a799/schema.test.mjs
```

`parseFacts(value)` and `validateCoverage(facts)` live in `scripts/a799/facts.mjs`.
The parser checks the complete version-1 object shape, typed values and unique
row, journal, schema, file and relationship identities. Coverage is a separate
check: it requires nonempty referenced sales, fiscal, people, menu and event sets,
plus an issued F1 whose number and original recipient name/address match its
recorded row. Fiscal coverage must refer to a table declared fiscal. These are
declarations, not proof that the old product actually wrote those records. The
later reviewed historical reader must establish extraction completeness and the
meaning of each scenario reference.

`encodeTyped(storageType, rawBytes)` preserves SQLite's storage classes. Pass an
integer as an exact decimal string within the signed 64-bit range, text/BLOB as
`Uint8Array`, REAL as eight big-endian IEEE-754 bytes, and null as `null`. Text and
BLOB become canonical base64; REAL keeps its hexadecimal bits, including negative
zero. Non-finite REAL values and ambiguous integer spellings are refused. No
money, quantity, decimal-text or timestamp conversion happens in the comparator.

The facts object has these required fields:

- `version: 1`, `fixtureId`, `rows: {table, key: Typed[], fields}[]` and `schema`.
  Field values use the typed representation above. Keys preserve their original
  types and values; object property order does not change their identity.
- `journals`, using cut 1's per-set captured journal contract, and
  `files: {path, sha256, bytes, mode}[]`. Paths are relative, without aliases.
- `relationships: {id, fromTable, fromKey, fromColumns, toTable, toKey,
toColumns}[]`. A nullable relationship uses `toKey: null`. Tuple column order
  remains significant. Both missing and unexpected identities are compared.
- `coverage`, with reference arrays named `sales`, `fiscal`, `people`, `menus`,
  `events` and `issuedF1`. An F1 reference additionally names `typeField`,
  `numberField`, `nameField`, `addressField` and their original typed `number`,
  `name` and `address`. `optional: {module, state, tables}` distinguishes
  `disabled-retained` from `never-enabled`; the latter supplies no retained-data
  coverage. A retained table must be declared disabled and have recorded rows.
- `identity`, with typed `node`, `keyHash`, `sif`, `installation`, `series`,
  `nextNumber`, `fiscalHead` and `workforceHead`. Use a fingerprint for a key,
  never its private bytes.
- `operationalRules: {table, key, field, before, after, cause,
approvalReceipt}[]`, identifying each permitted read/session effect exactly.
  The original field must match `before`. Fiscal and disabled tables, and every
  row named by issued-F1 coverage, cannot use these rules; neighbouring fields
  remain exact. Rule descriptors keep their original table names across a row
  rename, and both reports repeat those original descriptors unchanged.
- `newSale`, with independently specified typed `quantity`, `unitPrice`,
  `total`, `tender` and `change`. Comparing this declaration performs no sale.

`compareFacts(expected, actual, mappings = [], context?)` validates expected
coverage and returns `{ok, diffs, comparedByKind}`. Every difference names its
subject, original key, field, expected/actual values and cause. Row order is
irrelevant; column order, journal row order and relationship tuple order remain
significant. Coverage arrays remain exact declarations. Counts describe the
comparison work, never replace a field assertion.

## Keep protection definitions exact

`parseSchema` and `compareSchema` are exported from `scripts/a799/schema.mjs`.
Every object carries `kind`, `name`, `table`, `module`, `protection` and `rawSql`.
Protection is `ordinary`, `fiscal`, `disabled` or separately accounted `engine`.
Each kind additionally requires:

- A table: `columns: {name, type, notNull, defaultSql, primaryKey}[]`,
  `keys: {name, kind, columns}[]`, `checks: string[]` and
  `foreignKeys: {columns, target, targetColumns, onUpdate, onDelete, match,
deferred}[]`. Key kind is `primary` or `unique`; `primaryKey` is the column's
  nonnegative ordinal, and a missing default is `null`.
- An index: `unique`, `expressions: string[]` and `predicate: string|null`.
- A trigger: `target` and full `body`; a view: full `body`.

SQL comparisons tokenize ASCII spacing outside quotes while keeping quoted content,
comments, numbers and operator boundaries exact. Raw SQL stays in each input;
SQL differences report token arrays. This is a lexical comparison, not a SQL
validity check or proof that structured declarations describe the raw SQL. Later
stopped inspection must supply both from the actual schema.

## Review each intentional difference

Nonempty mappings require an explicit fourth argument to both comparison
functions. `validateMappings(mappings, context)` is exported from
`scripts/a799/compare.mjs`. The context is
`{sourceEpoch, sourceSha, candidateSha, migrations: {hash, module}[],
disabledModules: string[]}`. It names the reviewed applicable migration/module
pairs; the pure validator cannot authenticate a receipt or inspect packaged SQL.

Each mapping requires `id`, `sourceEpoch`, `sourceSha`, `candidateSha`,
`migrationHash`, `module`, `object: {subject, key}`, `field`, `before`, `after`,
`exactTransform`, `reason` and `approvalReceipt`. It must match the context exactly.
Only these transformations are supported:

- `add-null-field`: subject `rows`, key is an existing ordinary table, field is
  absent on every old row, `before: null`, `after: {kind: "null"}`.
- `rename-object`: subject `rows`, field `table`, with the old/new table names as
  `before`/`after`. Original row keys and values stay exact. Relationship endpoints
  and scenario references follow the rename. Existing tables and repeated rename
  destinations are refused.
- `replace-exact`: subject `schema`, key `kind:name`, field `object`, with complete
  old and new schema objects as `before`/`after`. The original definition must
  match exactly. A table rename or added column also needs its independent schema
  mapping; a row mapping does not generate expected SQL.

Mapped triggers and indexes require their target table definitions in both schema
inventories, and each target must be ordinary regardless of the object's own
label. Mappings cannot transform fiscal or disabled tables, apply numeric/time tolerance,
exclude wildcard sets or excuse an absent target. Descriptor IDs and targets must
be unique. Supporting modules keep schema parsing, mapping admission and keyed
comparison shared between the two public comparison functions. Future execution
still needs independently reviewed read specifications, actual images and sealed
facts, containment, issued-F1 history and the remaining four cuts.

## Admit sealed archives before candidate access

Run the stream, transport and handoff controls:

```sh
pnpm exec vitest run scripts/a799/archive.test.mjs scripts/a799/fetch.test.mjs
```

Cut 3 uses invented in-memory archives and HTTP/placement adapters. It has not
fetched a private release, placed files through a real filesystem adapter or run
an image. Cut 4 must implement and qualify actual filesystem placement, source
`lstat` inventory, link rejection and consistent whole-state capture. Cut 7 must
qualify the trusted GitHub job and credential-free transfer. The qualification
index remains empty; no candidate runner is wired.

`validateInventory(inventory, limits)` checks every external descriptor before
I/O. `validateEntry(entry, inventory, limits)` checks a decoded header against it.
`admitArchive(stream, inventory, limits, io)` consumes gzip containing
`a799-state-v1\n`, followed by each four-byte unsigned big-endian header length,
strict UTF-8 JSON header and exact file bytes. Header keys are exactly `path`,
`kind`, `mode`, `bytes` and `sha256`. Entries follow inventory order. The header
cap is six times that descriptor's compact JSON byte length; longer whitespace or
escape spellings are refused. Complete inventory and decompressed EOF are required.
Compressed and decompressed bytes, entry count and file bytes have explicit caps.

This admission boundary deliberately accepts only file mode `0600` and directory
mode `0700`. All files are treated as private, including evidence. Qualification
must supply captured modes that meet this restriction; the reader never changes
original permissions to make them qualify. Paths reject absolute/drive/backslash,
dot/empty and control-character aliases, trailing dots/spaces and collisions after
NFC normalization and upper/lower case folding. Unpaired surrogates and Unicode
control/format characters are refused. Every parent directory appears first.

`io` supplies `root`, `ownerId`, `signal`, positive `cleanupMs`, optional
`sourceIdentities: {dev, ino}[]`, and these asynchronous operations:
`inspectEntry(path)`, `createDirectory(entry)`, `openExclusiveNoFollow(entry)`,
`writeChunk(handle, bytes)`, `finishVerifiedFile(handle, entry)` and
`removeOwnedPartial()`. The root inspection uses path `""`. Inspections return
`{kind, mode, dev, ino, nlink, ownerId}`; the opened handle carries its matching
`identity`. The parser checks these reports before and after writing and refuses
changed/shared inodes or multiply linked files. The future real adapter must use
exclusive no-follow opens, coordinate path replacement, derive those reports from
actual handles and entries, and remove only its owned partials. On cancellation, the parser first waits within
the cleanup reserve for pending I/O to settle; an unresolved operation reports
`archive.cleanup` without racing partial removal. The actual adapter must honour
the signal and fence later writes before disposal can finish. Injected reports
are not filesystem evidence. The returned handle contains only root, owner ID,
cloned inventory and compressed archive hash.

`createGitHubTransport({request, credential, metadataBytes, maxRedirects})` uses
an injected HTTP request adapter returning `{status, headers, body}`. Headers may
be a native `Headers` object or a plain object; a successful body is an async
iterable of bytes. A null body is permitted for redirects/refusals. It requests only Waitron's pinned release ID,
resolves its tag (including up to eight annotated tags) to the frozen source SHA,
and checks the asset ID/name/size belongs to that release before requesting it.
Asset redirects are manual and accept only HTTPS on
`release-assets.githubusercontent.com` or `objects.githubusercontent.com`, with
no user information, nondefault port or fragment. Redirected requests carry no
authorization header. Discarded redirect/refusal bodies are cancelled. Connection failures during
metadata or asset streaming report `fetch.transient`; HTTP 401/403/404 retain
their distinct refusal codes. `close()` clears its credential and aborts request signals.
The future real adapter must honour manual redirects and those signals. Existing
private access and live GitHub responses remain unqualified.

`fetchInputs(cells, deps)` requires exact cells selected from `deps.indexBytes`
and `deps.candidate`, the committed raw `indexSha256`, a 40-character
`trustedRevision`, `deadlines: {totalMs, cleanupMs}`, a finite nonnegative
`retrySchedule`, optional parent `signal`, `transport`, `scratch` and
`credentialScope`. It rejects index bytes over 1 MiB, malformed/duplicate-key
JSON, wrong epochs/cells and missing `facts.json` in an evidence inventory before
retrieval. It checks exact compressed size and committed hash during streaming.
Only `fetch.transient` retrieval errors retry, each in a fresh owned root.
A failed input triggers disposal of all retained assets; unresolved cleanup
reports `fetch.cleanup`.

`scratch({cellId, kind, signal})` returns `{io, dispose}`. It must honour
cancellation and settle within the cleanup reserve. A late allocation is collected
and disposal is attempted within that reserve; an unsettled allocation reports
`fetch.cleanup`, never a successful handoff. The future adapter must keep roots
independent, fence in-flight I/O before disposal finishes and make disposal
idempotent. Disposal calls for one resource share one pending promise. Each
admitted asset gets a distinct root. The caller must retain its scratch-owner
registry keyed by root and owner ID: on a successful handoff it releases those
resources only after the trusted transfer or final consumer finishes. Serialized
`VerifiedInputs` deliberately carries no functions or credentials. No real
transfer/release adapter is installed here.

The outer elapsed-time bound uses the monotonic clock and is `totalMs + cleanupMs`; every cleanup step uses only the
remaining allowance. Unresolved cleanup takes precedence over credential residue,
which takes precedence over cancellation/deadline reporting. A malformed parent
signal is refused inside the closure boundary.

Both transport and credential scope close before successful return. The scope adapter's
`close()` must return `{closed: true, surfaces}` with empty arrays for
`environment`, `checkoutConfig`, `credentialHelpers`, `registryLogins`,
`scratchFiles`, `subprocessArguments`, `history` and `dockerConfig`. Tests refuse
reported residue on every surface and check sentinel credentials stay out of
returned handles and errors. This is an explicit adapter contract; no real host,
runner or Docker credential audit has happened. The later trusted job must
perform that audit. On success, the handoff carries only per-cell state/evidence
handles, trusted revision/index hash and `credentialScopeClosed: true`.
