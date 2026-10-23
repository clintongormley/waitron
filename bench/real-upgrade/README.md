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
counts equal endpoints once. For a source with revised qualified captures, it selects
the highest version of each required variant and keeps earlier versions in the index.
Equal version numbers for one variant are ambiguous and are refused. An owner retirement naming R2 as R1's replacement,
effective at R5, changes R5's selection to R2 and R4. Every original remains in
the index. `oldestSource` stays the original earliest retained source; retirement
records derive the effective oldest, so changing the pointer cannot erase the
requirement for an owner decision.

`candidate.orderedSourceShas` supplies a pinned ancestry chain, including the
baseline, all indexed sources, retirement effective candidates and the candidate.
It may include later descendants when checking an earlier candidate. The selector
checks membership, uniqueness and retained ordinal order. It performs no Git
access and cannot establish that the supplied chain is true: the future trusted
caller must verify that chain against Git before candidate access. Tags, names and
capture timestamps do not establish ancestry.

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
metadata check to the recorded reset receipt and baseline hashes. It does not
verify the receipt's authenticity or a database's actual bytes.

Every old hash and stored migration timestamp must remain an exact prefix of its
set's packaged SQL. Disabled sets retain their old rows and apply nothing. An
absent, disabled set stays absent. Enabled sets contribute pending SQL after the
old prefix. An identical image with pending SQL is refused. A later image without
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
