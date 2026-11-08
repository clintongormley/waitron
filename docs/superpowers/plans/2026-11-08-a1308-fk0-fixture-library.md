# A1308 fk0 — the floor and kitchen fixture-rewrite library, and `seedZone`, with no schema change: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Goal:** land, ahead of any table change in this area, the shared library that rewrites a test's
insert into a folded side table as an update of the parent row; fk1's fixture script built on it
(tested here, run in fk1); and a `seedZone` test helper, with every plain zone insert in the tests
moved onto it now, while it still does exactly what the insert did.

**Architecture:** no table, column or migration changes, so no venue is reset. The library splices
TypeScript source by syntax-tree positions and never reprints it (the method of
`scripts/a1301-seed-codemod.mjs`). `seedZone` writes exactly one `floor_zones` row today; fk1 changes
its body so it also gives the zone a department, which is why the call sites move first, in a pull
request a reviewer can check is behaviour-neutral.

**Tech stack:** Node ESM scripts using the `typescript` compiler API (already a root dev
dependency, `package.json:41`), Vitest.

**Spec:** [the slice rules](2026-11-08-a1308-slice-rules.md) §1 (rename scripts committed,
idempotent, re-run by the reviewer); [fk1](2026-11-08-a1308-fk1-zone-service-rules.md), which this
serves. Coordinator decision of 2026-11-08: split fk1 into this pull request and the fold.

**First line of the pull request:** none needed (no starting migration changes; rules §2).

**Who lands:** the lane (rules §6).

## What it builds

- `scripts/a1308/lib/fold-inserts.mjs` and its test: `foldInserts`, `runFoldCli`, and one raw-SQL
  rule (below), reused by fk1–fk8.
- `scripts/a1308/fk0-seed-zone.mjs` and its test: moves plain `insert(floorZones)` calls in tests onto
  `seedZone`. **Run in this pull request.**
- `scripts/a1308/fk1-zone-fixtures.mjs` and its test: fk1's two folds. **Committed and tested here,
  run in fk1** (its output belongs with fk1's schema change; the reviewer of fk1 re-runs it on fk1's
  base).
- `seedZone` in `packages/db/src/testing/seed.ts`.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Any schema change; giving `seedZone` a department | fk1 |
| Each later plan's own script configuration | fk2–fk8 |

## Files

- Create: `scripts/a1308/lib/fold-inserts.mjs`, `scripts/a1308/lib/fold-inserts.test.mjs`,
  `scripts/a1308/fk0-seed-zone.mjs`, `scripts/a1308/fk0-seed-zone.test.mjs`,
  `scripts/a1308/fk1-zone-fixtures.mjs`, `scripts/a1308/fk1-zone-fixtures.test.mjs`.
- Modify: `packages/db/src/testing/seed.ts` (add `seedZone`), `packages/db/src/testing/seed.test.ts`
  (or the file that tests `seed.ts` at the base: `git ls-files packages/db/src/testing | grep seed`).
- Modify (script output, uncounted): the test files holding a plain `insert(floorZones)`; hand edits
  to the sites the script reports.

## Size

| Part | Counted lines |
| --- | --- |
| `lib/fold-inserts.mjs` (Drizzle rule, raw-SQL rule, imports, command line) | 190 |
| Its tests | 110 |
| `fk0-seed-zone.mjs` and test | 90 |
| `fk1-zone-fixtures.mjs` (configuration) and test | 60 |
| `seedZone` and its test | 45 |
| Hand edits at the sites `fk0-seed-zone.mjs` reports | 60 |
| **Total** | **≈ 555** |

Uncounted: the script's output (100 files hold a Drizzle zone insert at `a086eedfb7`, `git grep -l
"insert(floorZones)" -- apps packages scripts`; 104 counting raw SQL; the script rewrites the plain
ones in test files and helpers).

## Finish line

```bash
pnpm exec vitest run scripts/a1308
pnpm --filter @waitron/db exec vitest run src/testing
node scripts/a1308/fk0-seed-zone.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts' 'packages/*/test/*.ts') && git diff --exit-code
```

And, because the rewrite touches tests in most packages, the packages whose files changed run in CI
as usual; locally, run the suites of the five packages with the most rewritten files (`git diff
--stat main -- '*.test.ts' | sort -k3 -n -r | head`), each printing a `Tests` count (CLAUDE.md §4).

## Expected protection-list difference

`EQUAL`: no schema change. Run `protection-list list` on the base and the branch and `compare`; any
line is a stop (rules §5.2).

## Stop points (beyond rules §5)

1. A rewritten test fails: `seedZone` is meant to write exactly what the insert did. Fix `seedZone`
   or report the site; never change the test's assertion.
2. The raw-SQL rule cannot be made safe for the forms the tests use (`git grep -n -E "insert into
   (zone_service_policies|zone_sale_policies)" -- '*.test.ts'`): leave those sites to fk1's hand
   edits and say how many.

## Needs

- Nothing in this area; it can start as soon as the lane is free. It does not need 1a (no
  migration), and it needs none of batch 1 except that the files it rewrites exist.

## Global constraints

- Scripts change only `*.test.ts` files and test helpers (`src/testing/`, `test/`), never product
  code, and never a file under `packages/db/src/schema/` (its schema tests insert bare rows on
  purpose).
- Running a script on its own output changes nothing (rules §1).

## Review Focus

1. **A schema test's deliberate bare insert** (fk1's "refuses a zone with no department") is never
   rewritten: the path rule and the marker comment. Test: `fk0-seed-zone.test.mjs` skip cases.
2. **A caller that reads more than `id` from the insert's `.returning(…)`** is reported, not
   rewritten (`seedZone` answers only the id). Test: the report case.
3. **A zone inserted inside a loop or helper with computed values** is reported. Test: the spread
   and computed-key cases.
4. **The raw-SQL rule meets a statement it cannot parse** (nested parentheses, a column list that
   does not match the values): it reports, never guesses. Test: the raw-SQL report cases.
5. **Imports:** `seedZone` is imported from `@waitron/db/testing/seed.js` in `apps/` and other
   packages, and relatively inside `packages/db`. Test: one case each.

---

## Task 1: The library

**Interfaces (produced):**
- `foldInserts(source: string, path: string, rules: readonly FoldRule[]): { text: string; reports:
  string[] }`.
- `runFoldCli(rules: readonly FoldRule[], extra?: (source: string, path: string) => { text: string;
  reports: string[] }): Promise<void>` — the `[--write] <file…>` command line; without `--write` it
  writes nothing and prints what would change; it always prints `path:line: reason` for each report.
- `FoldRule = { child: string; parent: string; key: string; parentKey?: string; fields:
  Readonly<Record<string, string | null>>; constants?: Readonly<Record<string, string>>; raw?: {
  childTable: string; parentTable: string; key: string; parentKey?: string; columns:
  Readonly<Record<string, string | null>>; constants?: Readonly<Record<string, string>> } }`.
  `child`/`parent` are Drizzle identifiers (`"zoneSalePolicies"`, `"floorZones"`); `key` the child
  field holding the parent's id; `parentKey` the parent field it names (default `"id"`); `fields`
  maps each other child field to its parent field (`null` drops it); `constants` adds fixed fields
  (field name → source text) to every rewritten `set`; `raw` is the same mapping for SQL text.
- Exported splice helpers for scripts with their own rules: `parse(source, path)`,
  `replaceNode(text, node, replacement)`, `addNamedImport(text, moduleName, name)`,
  `removeUnusedImport(text, name)`.

The Drizzle rule: `X.insert(child).values({ key: K, …fields })` becomes `X.update(parent).set({
…mapped, …constants }).where(eq(parent.parentKey, K))`; a trailing `.onConflictDoUpdate(…)` or
`.onConflictDoNothing(…)` is dropped; a statement with nothing left to set is deleted. Reported, not
rewritten: an array of values, a spread, a computed key, a `.returning(…)` on the insert.

The raw-SQL rule, inside a `sql` tagged template only: `insert into <childTable> (c1, …, cn) values
(v1, …, vn)`, where the column list and the values split into the same number of items at
top-level commas, becomes `update <parentTable> set p1 = v1, … where <parentKey> = <value of key>`.
Anything else naming `childTable` is reported.

- [ ] **Step 1: Write the failing tests** (`lib/fold-inserts.test.mjs`) on source strings: a
  one-field fold's exact output; a dropped field; a constant added; a statement with nothing left is
  deleted; a conflict clause dropped; array, spread, computed key and `.returning(…)` each reported;
  imports added and the unused child import removed; the raw rule's exact output; a raw statement
  with a nested `(` in a value reported; **folding the output again changes nothing**.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1308/lib`; expect fail. **Step 3: Implement.**
  **Step 4: Run**; expect pass. **Commit.**

## Task 2: `seedZone`, and moving plain zone inserts onto it

**Interfaces (produced):** `seedZone(db: Database | Transaction, input: { id?: string; name:
string; displayOrder?: number; active?: boolean }): Promise<{ id: string }>` — inserts one
`floor_zones` row with those values and the defaults the table gives the rest, and answers its id.
(fk1 widens the input with `departmentId?` and `isCounterDefault?` and the answer with
`departmentId`.)

`fk0-seed-zone.mjs`'s one rule: `const [z] = await X.insert(floorZones).values({ … }).returning({ id:
floorZones.id })`, the same with `.returning()` when every later use of `z` reads only `z.id`, or
`await X.insert(floorZones).values({ … })` with no `returning`, becomes `const z = await seedZone(X, {
… })` (or `await seedZone(X, { … })`). Skipped silently: files under `packages/db/src/schema/`, and
any statement on the line after a `// a1308-keep: bare zone insert` comment. Reported: a
`returning` whose result is read for anything but `id`, an array, a spread, a computed key, keys
other than `id`, `name`, `displayOrder`, `active`, `locationId` (slice 5 removes the last; drop it if
present), and raw SQL `insert into floor_zones`.

- [ ] **Step 1: Write the failing tests.** `seed.test.ts`: `seedZone writes one zone row and nothing
  else` (count `floor_zones` 1, and the counts of `departments`, `zone_service_policies`,
  `zone_sale_policies` unchanged). `fk0-seed-zone.test.mjs`: each rewritten form's exact output; the
  `packages/db/src/schema/` path skipped; the marker skipped; each report case; idempotence.
- [ ] **Step 2: Run**; expect fail. **Step 3: Implement.** **Step 4: Run**; expect pass.
- [ ] **Step 5:** Run the script with `--write` over the finish line's file list, `pnpm exec prettier
  --write` the changed files, hand-edit each report only where the rewrite is safe by reading, else
  leave the insert as it is (it is fk1's to fix). List hand edits in the pull request (rules §1).
- [ ] **Step 6: Run** the suites named in the finish line. **Commit** script + output; hand edits.

## Task 3: fk1's script, committed and tested

`scripts/a1308/fk1-zone-fixtures.mjs` calls `runFoldCli` with:
- `{ child: "zoneServicePolicies", parent: "floorZones", key: "zoneId", fields: { departmentId:
  "departmentId", isCounterDefault: "isCounterDefault", locationId: null }, raw: { childTable:
  "zone_service_policies", parentTable: "floor_zones", key: "zone_id", columns: { department_id:
  "department_id", is_counter_default: "is_counter_default", location_id: null } } }`;
- `{ child: "zoneSalePolicies", parent: "floorZones", key: "zoneId", fields: { orderStart:
  "orderStart", paidWhen: "paidWhen", collectionNumber: "collectionNumber", receiptPrintMode:
  "receiptPrintMode" }, raw: { childTable: "zone_sale_policies", parentTable: "floor_zones", key:
  "zone_id", columns: { order_start: "order_start", paid_when: "paid_when", collection_number:
  "collection_number", receipt_print_mode: "receipt_print_mode" } } }`.

- [ ] **Step 1: Write the test** on source strings only (the schema these rewrites target does not
  exist until fk1): each rule's Drizzle and raw output; `values({ zoneId: Z })` alone on the sale
  rule is deleted; idempotence.
- [ ] **Step 2: Run, see it fail; implement; run, see it pass.** Do **not** run it over the tree.
  **Commit.**

## Task 4: Protection list, finish

- [ ] `protection-list list` on base and branch; `compare` prints `EQUAL`. Finish line;
  `/finish-branch`.
