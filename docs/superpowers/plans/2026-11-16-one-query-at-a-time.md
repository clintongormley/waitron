# One query at a time: proposed documentation correction

Codex narrowed its separate Sol-high draft after Claude's 136-second review recommended dropping the scanner; its sole corrections read took 65 seconds. The watcher cleared the docs-only correction at 01:35 on 16 November in Lane F questions.md. No owner design approval is claimed. Original ask, verbatim from Lane F `queue.md` (snapshot `~/waitron-campaign-f/receipts/one-query-at-a-time-20261116/ask.txt`):

> ### ONE-QUERY-AT-A-TIME. A check that fails when two queries run at once on one transaction — `in-progress` — started 2026-11-16 01:23 — inspecting wrapper and violations; plan review next
> - **Ask:** `docs/backlog.md:2108` ("Nothing stops two queries being started at once on one transaction"; CLAUDE.md §3: "Await queries on one transaction in turn, never `Promise.all`"). Add the cheapest check that fails when a second query starts on a transaction while one is in flight (in the store's transaction wrapper, tests only if a production check costs), then fix the violations it finds. If it finds many, stop at the plan and list them. Plan first; one PR; delete the entry, and name the check in CLAUDE.md's line as its guard.

**Proposed smaller finish line:** developers can distinguish synchronous statements from the adapter's documented warning about overlapping asynchronous nested transactions. This adds no guard and does not complete the original enforcement ask. The watcher cleared this smaller scope for docs-only publication.

**Evidence and reuse:** `packages/store/src/node-sqlite-adapter.ts` executes native statements synchronously; `packages/db/src/tenancy.ts` runs the supplied body under `withWriteLock`. A real-adapter Node 26.13.0 probe ran raw and builder query pairs through `Promise.all` inside one transaction: peak native statements 1; both raw statements finished before the array returned. Receipt: `~/waitron-campaign-f/receipts/one-query-at-a-time-20261116/synchronous-probe.txt`. A native busy flag misses that pattern. The existing adapter comment at 162–165 names overlapping asynchronous savepoints; that hazard is not newly reproduced by the statement probe. Inspection confirmed no violation in the candidates read; it was not exhaustive.

**Files and steps:**

1. In `docs/developers/conventions-data.md`, “Multi-table writes share ONE transaction”, retain the existing section, including its rule, synchronous-driver explanation and no-guard statement. Add one sentence after that statement pointing to the adapter's warning about overlapping asynchronous nested transactions finishing out of order. No new claim about corruption or measured performance. Do not cite the new probe in the product docs.
2. Rewrite only the matching `docs/backlog.md` entry to the remaining asynchronous nested-transaction enforcement gap, rather than deleting it. Do not create a second item or change anybody else's backlog text. The watcher may instead supply a narrower new guard ask; that requires a revised plan before code.
3. Check every changed sentence against its named source; run `git diff --check` and verify relative links. A docs-only change needs no test. After explicit watcher clearance of both scope and landing route, follow the repository's signed docs-only fast-forward procedure under the short landing lock, then verify its main CI exists.

**Deliberately omitted:** static scanner, runtime checks, query wrapping, timing emulation, production/test edits, savepoint fixes, CLAUDE.md changes and a guard annotation. Its “No guard enforces this convention” stays true. No confirmed code violation is claimed fixed.

**Expected physical size:** production+0/−0; tests/support+0/−0; documentation about+5–10/−5–10, excluding this plan. No schema, dependency, generated file or framework. The original runtime-enforcement outcome remains unavailable.
