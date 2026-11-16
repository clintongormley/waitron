# One query at a time: proposed documentation correction

Codex narrowed its separate Sol-high draft after Claude's first review recommended dropping the scanner. Watcher clearance is pending; no owner design approval is claimed. Original ask, verbatim from Lane F `queue.md` (snapshot `~/waitron-campaign-f/receipts/one-query-at-a-time-20261116/ask.txt`):

> ### ONE-QUERY-AT-A-TIME. A check that fails when two queries run at once on one transaction — `in-progress` — started 2026-11-16 01:23 — inspecting wrapper and violations; plan review next
> - **Ask:** `docs/backlog.md:2108` ("Nothing stops two queries being started at once on one transaction"; CLAUDE.md §3: "Await queries on one transaction in turn, never `Promise.all`"). Add the cheapest check that fails when a second query starts on a transaction while one is in flight (in the store's transaction wrapper, tests only if a production check costs), then fix the violations it finds. If it finds many, stop at the plan and list them. Plan first; one PR; delete the entry, and name the check in CLAUDE.md's line as its guard.

**Proposed smaller finish line:** developers can distinguish synchronous statements from asynchronous helpers and nested transactions that can interleave. This adds no guard and does not complete the original enforcement ask. The watcher must settle that change of scope before any build/publication.

**Evidence and reuse:** `packages/store/src/node-sqlite-adapter.ts` executes native statements synchronously; `packages/db/src/tenancy.ts` runs the supplied body under `withWriteLock`. A real-adapter Node26.13.0 probe ran raw and builder query pairs through `Promise.all` inside one transaction: peak native statements1; both raw statements finished before the array returned. Receipt: `~/waitron-campaign-f/receipts/one-query-at-a-time-20261116/synchronous-probe.txt`. A native busy flag misses that pattern. The existing adapter comment at162–165 names overlapping asynchronous savepoints; that hazard is not newly reproduced by the statement probe. Inspection confirmed no violation in the candidates read; it was not exhaustive.

**Files and steps, after clearance:**

1. In `docs/developers/conventions-data.md`, “Multi-table writes share ONE transaction”, retain the one-at-a-time rule and synchronous-driver explanation. Replace the obsolete native-in-flight guard proposal with the actual unguarded asynchronous helper/savepoint concern, pointing to the adapter's existing warning. State that no new guard was added; make no new claim about corruption or measured performance.
2. Rewrite only the matching `docs/backlog.md` entry to that remaining enforcement gap, rather than deleting it. Do not create a second item or change anybody else's backlog text. The watcher may instead supply a narrower new guard ask; that requires a revised plan before code.
3. Check every changed sentence against its named source; run `git diff --check` and verify relative links. No runtime change earns no test. After clearance, follow the repository's signed docs-only fast-forward procedure under the short landing lock, then verify its main CI exists.

**Deliberately omitted:** static scanner, runtime checks, query wrapping, timing emulation, production/test edits, savepoint fixes, CLAUDE.md changes and a guard annotation. Its “No guard enforces this convention” stays true. No confirmed code violation is claimed fixed.

**Expected physical size:** production+0/−0; tests/support+0/−0; documentation about+5–10/−5–10, excluding this plan. No schema, dependency, generated file or framework. No PR for a measurement/decision alone, as RUNNER says. The original runtime-enforcement outcome remains unavailable.
