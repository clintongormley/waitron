# Historical upgrade checks

You need to keep records written by an older release exact when a new release starts.
This directory holds the qualification index for that check. It starts empty: no
historical capture, issued full invoice or successful upgrade is qualified here.

The [implementation plan](../../docs/superpowers/plans/2026-10-22-a799-real-upgrade-testing.md)
splits the work into seven pull requests. The owner authorised their build on
23 October 2026. This first cut validates metadata and selects required inputs.
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
limits. The future raw JSON ingestion boundary must reject duplicate JSON keys
before they become an object. These parsers do not read JSON bytes or archives.
They do not validate facts or coverage: cut 2 owns `parseFacts` together with its
exact typed fields, schema and issued-invoice coverage model. No placeholder facts
parser accepts unvalidated data here.
