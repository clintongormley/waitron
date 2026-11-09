# A1308 menu and photos, PR mn1: "catalogue" leaves the package and file names — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Move every file whose path says "catalogue" to its final name, and rename the workspace
package `@waitron/catalogue` (folder `packages/catalogue`) to `@waitron/menu` (`packages/menu`),
with one committed script that a reviewer can re-run. No identifier inside a file, no table, no
route and no word a person reads changes here; PR mn3 does those.

**Architecture:** `scripts/a1308/rename-catalogue-paths.mjs` holds one ordered table of moves. It
`git mv`s each tracked file, then rewrites, in every text file in scope, the import specifiers and
the path strings that pointed at the old places. Running it a second time moves nothing and
rewrites nothing. `pnpm install` then regenerates `pnpm-lock.yaml`.

**Tech Stack:** Node 24 ES modules, `node:child_process` (`git`), Vitest (root project), pnpm.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §5 U9 ("Catalogue goes
everywhere"); [tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1 "The rename";
[slice rules](2026-11-08-a1308-slice-rules.md), cited as "rules §n"; [build
order](2026-11-08-a1308-build-order.md), batch 2, menu and photos, lane 2.

**Base:** worktree HEAD `a086eedfb7` (`main` `d908a5b8d4` plus two docs commits). Every cite below is
`file:line` there. Batch 1 (slices 1a, 1b, 2, 3a, 3b, 4a, 4b, 5) lands before this area starts and
moves some lines and deletes some files named here (4a deletes `packages/recipes` and every `@waitron/recipes` line; 4a-ii deletes
`packages/db/src/schema/location-catalogues*.ts`). Find each cite
by the identifier given; a cite whose identifier is gone for a reason this plan does not name is a
stop (rules §5.1).

**Who lands:** the lane (rules §6). Nothing here changes `sales`, invoice numbering, the fiscal
records or identity, AEAT sending, or a hashed value. One file inside a fiscal package changes, by
script only: `packages/fiscal-verifactu/package.json:51` (the dependency's name) and
`packages/fiscal-verifactu/src/write-path.e2e.test.ts:29` (the import), plus a path in a comment at
`packages/fiscal-verifactu/src/chain.ts:87` and another in
`packages/fiscal-verifactu/src/chain.concurrency.test.ts:110`. If the watcher reads rules §6 as covering a fiscal
package's import line, the owner lands it; nothing in the plan changes.

**Pull request's first line:** "Moves files only; no venue is reset." (No starting migration
changes, rules §2.)

## Words used here

- **Path rename:** a file moves; its content changes only where it names another moved file.
- **Scope:** the files the script reads and may rewrite (Task 1 lists them). Historical documents
  (`docs/superpowers/`, `docs/operations/`, `docs/compliance/`, `docs/handoffs/`) are records of
  what was true when written and stay as they are (CLAUDE.md §6, "Historical docs").
- **Words rename:** PR mn3, which changes the identifiers, tables, routes, permission, error codes
  and visible wording. This PR leaves `CatalogueScreen` inside `products-screen.ts` for mn3.

## What it builds

1. `scripts/a1308/rename-catalogue-paths.mjs` and its test `scripts/a1308/rename-catalogue-paths.test.mjs`.
2. The script's output, committed in the same pull request: the moves in the table below, the
   rewritten import specifiers and path strings, and `pnpm-lock.yaml` from `pnpm install`.
3. The two hand edits the script cannot make (Task 3), listed in the pull request description
   (rules §1).

The move table (ordered; the first matching row wins; `*` matches any suffix such as `.test.ts`):

| From | To |
| --- | --- |
| `packages/catalogue/src/catalogue-items*` | `packages/menu/src/product-items*` |
| `packages/catalogue/` (every other tracked file) | `packages/menu/` |
| `apps/dashboard/src/screens/catalogue-screen*` | `apps/dashboard/src/screens/products-screen*` |
| `apps/dashboard/src/widgets/catalogue-browser*` | `apps/dashboard/src/widgets/product-browser*` |
| `apps/dashboard/src/widgets/catalogue-forms*` | `apps/dashboard/src/widgets/product-forms*` |
| `apps/server/src/catalogue-api*` | `apps/server/src/menu-api*` |
| `apps/server/src/catalogue-allergen-workflow*` | `apps/server/src/menu-allergen-workflow*` |
| `apps/server/src/catalogue-manage-permission*` | `apps/server/src/menu-manage-permission*` |
| `apps/server/scripts/demo-seed/seed-catalogue*` | `apps/server/scripts/demo-seed/seed-menus*` |
| `packages/composition/src/catalogue-media-backup-verification*` | `packages/composition/src/menu-media-backup-verification*` |
| `packages/db/src/schema/catalogue/` | `packages/db/src/schema/menu/` |
| `packages/db/src/schema/catalogue.ts`, `catalogue.test.ts` | `packages/db/src/schema/menus.ts`, `menus.test.ts` |
| `scripts/catalogue-engine-neutral.test.ts` | `scripts/menu-engine-neutral.test.ts` |

Why these names: the design names `products-screen.ts`, `product-browser.ts`, `packages/menu` and
`@waitron/menu` (tables-menu.md §1 "The rename"). `catalogue-items.ts` holds the Products screen's
move and delete of selected products and categories (`moveCatalogueItems`, `deleteCatalogueItems`,
`CatalogueSelection`, `packages/catalogue/src/catalogue-items.ts:11`, `:110`, `:136`), so it takes the
screen's word, as the screen file does. The database schema file holds `catalogues`, `categories`
and `products` (`packages/db/src/schema/catalogue.ts:8`, `:19`, `:28`); `menus.ts` beside the folder
`menu/` keeps two distinct names. The subpath export `./schema/catalogue.js`
(`packages/db/package.json:10`) becomes `./schema/menu.js`. The backlog file
`docs/backlog/catalogue.md` does not move here: the links to it are relative (`catalogue.md#…`), which
no form below rewrites, so moving it now would leave about 85 lines of links dead until mn3. mn3 moves
it, in the same pull request whose catch-all rewrites those links.

**Not moved:** `apps/server/src/guide-catalogue.ts` and its test. That file is the list of guide
pages, not the menu (tables-menu.md §1, "Two uses of the word mean something else and stay").

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Every identifier, table, column, route, permission, error code, settings key, string key and visible word that says "catalogue" | mn3 (the words rename) |
| `catalogue_settings` and `unit_seed_states` | mn2 deletes them |
| Moving `apps/server`'s menu files into a package (CI package move) | the CI package move; see "Area files for the package move" below |
| Rewriting historical documents | nobody: they are records (CLAUDE.md §6) |

## Area files for the package move

Agreed 2026-11-08 and not designed yet: `apps/server`'s domain areas move into packages of their
own, each move paired with its A1308 area so code moves once; the build order's "Order of areas" sets the order (owner, 2026-11-09: the proposed order), since A1453's measurement was dropped (`docs/backlog/ci.md`, 8c4166f9ac). This
area's files in `apps/server/src` (paths after this PR; every `*.test.ts` beside each belongs with it):

- `menu-api.ts` and `menu-api.*.test.ts`, `menu-allergen-workflow.test.ts`,
  `menu-manage-permission.test.ts` (today `catalogue-api*`, `catalogue-allergen-workflow.test.ts`,
  `catalogue-manage-permission.test.ts`)
- `units-api.ts`
- `menu-activation.ts`, `menu-publication-time.ts`, `menu-undo-photo.test.ts`,
  `menu-patch-open-lines.test.ts`
- `content-translations-api.ts`, `content-suggestions-api.ts`, `content-suggestion-runner.ts`,
  `cloud-translation.ts`, `cloud-translation.exchange.test.ts`, `translation-cloud-fixture.test.ts`
- `purchasing-api.ts`, `purchasing-api.gate-sweep.test.ts` (supplier invoices are in this appendix)
- test helpers used mostly by this area: `testing/publish-menu.ts`

Boundary files that read menu tables but belong to another area, and so stay out of this list:
`modifier-selection.ts` and `order-state-counts.ts` (orders and sales), `category-sales-page.ts`
(reporting), `guide-catalogue.ts` (guides), `receipt-logo.ts` and `theme-logo.ts` (devices), the demo
seed under `apps/server/scripts/demo-seed/` (not `src`).

**Where the move sits in this area's sequence:** after mn3, before mn4. Then every later menu PR
edits the moved files with final names, and the move itself carries no rename. If the build order puts this
area's move later, it goes after mn13; plans mn4–mn13 cite `apps/server/src` paths, and a file found
under its new package by the same name and identifier is not a stop.

## Files

- Create: `scripts/a1308/rename-catalogue-paths.mjs`, `scripts/a1308/rename-catalogue-paths.test.mjs`
- Moved and rewritten by the script (not counted, rules §1): the 13 rows above, the 191 tracked files under
  `packages/catalogue/` (`git ls-files packages/catalogue | wc -l` at `a086eedfb7`), and the path strings in about 380 files (measured 2026-11-08:
  `git grep -c -I "@waitron/catalogue"` lists 351 files under `apps`, `packages`, `scripts`)
- Regenerated: `pnpm-lock.yaml` (by `pnpm install`)
- Modify by hand (counted): `packages/db/src/english-only.ts:27` and `scripts/english-only.test.ts:104`
  (each names the package folder `"catalogue"` as a bare word, which is not a path the script can
  recognise); any line Task 2's type check or lint shows the script left wrong.
- Docs: `docs/developers/ci-and-gates.md` gains nothing (no new rule); the script rewrites path
  strings in the living docs listed in Task 1's scope.

## Size

| | Lines |
| --- | --- |
| Script (`rename-catalogue-paths.mjs`) | about 250 |
| Script tests | about 250 |
| Hand edits | about 10 |
| **Counted** | **about 510** |

Not counted: the script's output, `pnpm-lock.yaml`. About 2 to 3 hours; one pull request.

## Finish line

From the repository root, after the pull request lands:

1. `node scripts/a1308/rename-catalogue-paths.mjs` prints `moved 0, rewrote 0`, and
   `git status --porcelain` is then empty.
2. `git ls-files apps packages scripts | grep -i catalogue` prints only
   `apps/server/src/guide-catalogue.test.ts` and `apps/server/src/guide-catalogue.ts`.
3. `git grep -n -I -E "@waitron/catalogue|packages/catalogue|schema/catalogue" -- apps packages scripts .github CLAUDE.md README.md docs/developers docs/backlog docs/backlog.md`
   prints nothing.
4. `pnpm install --frozen-lockfile` passes; `pnpm --filter @waitron/menu typecheck` passes.
5. `pnpm exec vitest run scripts/a1308/rename-catalogue-paths.test.mjs scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs scripts/coverage-thresholds.test.ts scripts/english-only.test.ts scripts/dashboard-browser-purity.test.ts scripts/menu-engine-neutral.test.ts scripts/claude-md-pointers.test.ts`
   passes, with a `Tests` count.
6. `pnpm protection-list compare` (rules §3) prints `EQUAL`.
7. On the reviewer's machine: `git worktree add --detach <dir> <base>`; copy
   `scripts/a1308/rename-catalogue-paths.mjs` from the pull request into it; in `<dir>`, run
   `node scripts/a1308/rename-catalogue-paths.mjs && pnpm install`; then
   `git -C <dir> diff --stat <pr-head>` prints only the hand edits listed in the description and the
   script and its test. (Checking the base out over the pull request's tree would not delete the moved
   files, and the script refuses when a move's target exists.) `git worktree remove <dir>` after.
8. `pnpm --filter @waitron/server exec vitest run src/zone-process-matrix.test.ts src/zone-process-matrix.whole-files.test.ts src/zone-process-matrix.named-cases.test.ts`
   passes (the matrix names a moved test file by its bare name, form 4).

## Expected protection-list difference

None: the script moves no schema file content and changes no SQL. `compare` must print `EQUAL` for
all twelve entries. Any line is a stop (rules §5.2).

## Stop points (beyond rules §5)

1. The dry run (Task 2, step 1) proposes moving a file not matched by a row of the move table.
2. After the script, `pnpm --filter @waitron/menu typecheck`, `pnpm --filter @waitron/server typecheck`
   or `pnpm --filter @waitron/dashboard typecheck` fails on an import the script rewrote. Fix the
   script, not the output, and re-run from the base.
3. Batch 1 left a tracked file under `packages/catalogue/` that imports `@waitron/recipes`
   (4a should have removed every one).
4. A branch named in "Work beside A1308" below has landed a new file whose name says "catalogue":
   add its row to the move table (it is a script change, counted), do not move it by hand.

## Needs

- **Outside this area:** batch 1 in full (rules: this area starts after it). In particular 4a, which
  deletes `packages/recipes` and its lines in `scripts/changed-scope.mjs:318` and
  `.github/workflows/ci.yml:3476`.
- **In this area:** nothing; this is the first menu PR.

## Work beside A1308 that this affects

Rules §8: work that changes no table goes ahead in any lane, rebases across A1308 merges, and
re-runs the committed rename script after rebasing. Known in flight on 2026-11-08 and touching
these files: A353 pull requests 2–5 (Undo on the menu Preview,
[plan](2026-11-06-a353-preview-undo.md); no table change, `docs/backlog/catalogue.md:425`); A799's
real-upgrade rig (`scripts/a799/schema.test.mjs` uses `"catalogue"` as a sample module name, which
mn3, not this PR, changes); A1457, the Courses page rework (`docs/backlog.md:480-483`; no table
change, but its "trash can in place of a row menu whose only action is Delete, on every screen"
touches the Products screen). After rebasing, each runs
`node scripts/a1308/rename-catalogue-paths.mjs`, then `pnpm install`.

## Global Constraints

- Rules §1–§9 apply. The script's output is committed in the same pull request; hand edits after the
  script are listed in the description (rules §1).
- Only tracked files move (`git ls-files`); `node_modules` is never touched.
- The script reads every file in scope as UTF-8 text and skips any file whose first 8 000 bytes hold
  a NUL byte (a binary file).
- Never edit `drizzle/*.sql`, `drizzle/meta/*` or the epoch file (rules §2.3); the script excludes them.
- Every commit `git commit -s`; plain English in commit messages and the pull request.

## Review Focus

1. **The script re-run on the base reproduces the pull request.** The reviewer runs Finish line 7.
2. **Import specifiers resolve to the same module as before.** Task 1's "relative import" cases
   pin it; the package type checks prove it.
3. **Nothing outside scope changed:** historical docs, generated migrations, the captured fixtures
   (`packages/country-es/test-fixtures/demo/madrid-before-move.*`,
   `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`), the
   Spanish legal source `packages/country-es/src/data/sources/BOE-A-2015-2294.xml`.
4. **`guide-catalogue.ts` did not move.**

---

### Task 1: The path-rename script, tested on a throwaway tree

**Files:**
- Create: `scripts/a1308/rename-catalogue-paths.mjs`
- Test: `scripts/a1308/rename-catalogue-paths.test.mjs`

**Interfaces** (exported for the test; the file also runs as a command when executed directly):

```js
/** Ordered rows; `from`/`to` are repo-relative; a row ending "/" moves a folder's tracked files. */
export const MOVES; // the table under "What it builds"
/** Repo-relative globs the script may rewrite. */
export const SCOPE; // see below
/** Repo-relative globs never read or rewritten, even inside SCOPE. */
export const NEVER; // see below
/** The new path for `path`, or null when no row matches. */
export function movedPath(path: string): string | null;
/** `text` with every specifier and path string that named a moved file pointing at its new place.
 *  `file` is the file's path AFTER the moves; `before` is its path before them. */
export function rewriteText(text: string, file: string, before: string, moves: Map<string, string>): string;
/** Moves, then rewrites; returns counts. `root` is the repository; `dryRun` writes nothing. */
export function run(options: { root: string; dryRun?: boolean }): { moved: number; rewrote: number; planned: string[] };
```

`SCOPE`: `apps/**`, `packages/**`, `scripts/**`, `.github/**`, `package.json`, `pnpm-workspace.yaml`,
`tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`, `CLAUDE.md`, `README.md`,
`docs/developers/**`, `docs/backlog/**`, `docs/backlog.md`.

`NEVER`: `**/drizzle/**`, `scripts/migration-baseline-epoch.json`, `pnpm-lock.yaml`,
`packages/country-es/test-fixtures/**`, `packages/country-es/src/data/sources/**`,
`apps/server/src/testing/fixtures/**`, `scripts/a1308/**`.

Decisions the implementer cannot make alone:

- **What counts as a path string.** Three forms, each matched only as a whole path segment
  sequence (the character before is not `[A-Za-z0-9_-]`):
  1. A package specifier: `@waitron/catalogue` followed by `"`, `'`, `` ` `` or `/` becomes
     `@waitron/menu`; `@waitron/db/schema/catalogue.js` becomes `@waitron/db/schema/menu.js`.
  2. A repo-relative path: any `from` of a row, found anywhere in a file in scope, becomes its `to`.
     The folder row `packages/catalogue/` also matches `packages/catalogue` with no trailing slash
     when the next character is not `[A-Za-z0-9_-]` (end of line, quote, backtick, space, `)`,
     `.`, `,`): about 10 doc lines and `apps/dashboard/src/api/live-queries.test.ts:414` write it so.
  3. A package-relative path: for a row whose `from` starts with a package folder
     (`apps/<x>/` or `packages/<x>/`) and whose remainder is not empty (for example
     `src/catalogue-api.ts`), the remainder becomes the `to`'s remainder, but only inside files under
     that same package folder. A row whose remainder is empty (the `packages/catalogue/` row itself)
     has no package-relative form: an empty remainder would match everywhere. This is what rewrites
     `apps/server/test-durations.json:268-276` and `packages/db/mutation-costs.json:37-47`.
  4. A bare file name: a moved file's base name (for example `catalogue-allergen-workflow.test.ts`),
     as a whole token, inside files under the same package folder only. This rewrites
     `apps/server/src/testing/zone-process-matrix.ts:57`. Base names of moved files are unique within
     their package (the dry run prints each form-4 hit for the builder to read).
- **Relative import specifiers** (`from "./x.js"`, `import("../x.js")`, `vi.mock("./x.js")`,
  `new URL("./x", import.meta.url)`) in `.ts`, `.mts`, `.js`, `.mjs` files: resolve the specifier
  against the importing file's OLD folder to an old target path (trying the specifier as written,
  then with `.ts` for a `.js` ending, then `/index.ts`); map both the importer and the target
  through `movedPath`; write the new relative specifier from the importer's new folder, keeping the
  original's extension style (`.js`) and a leading `./`. A specifier whose target did not move and
  whose importer did not move is left byte-identical.
- **`packages/db/package.json`'s export:** an explicit rule, applied to that one file: the key
  `"./schema/catalogue.js"` becomes `"./schema/menu.js"`. The key is neither a package specifier nor a
  repo path, so no form above reaches it. Its value `"./src/schema/catalogue/index.ts"` (`:10`) becomes
  `"./src/schema/menu/index.ts"` by form 3. A test pins both.
- **Idempotent:** the second run finds no tracked file at any `from` and nothing to rewrite.
  `run` refuses with an error naming both paths when a `from` and its `to` both exist.
- **Moves use `git mv`**, one call per file, so history follows each file.
- The command prints `moved <n>, rewrote <n>` and, with `--dry-run`, every planned move and every
  file it would rewrite with its count of changed lines.

- [ ] **Step 1: Write the failing tests.** Each case builds a throwaway git repository with
  `mkdtempSync(join(tmpdir(), "wt-a1308-paths-"))`, `git init`, a handful of files and a commit, and
  runs `run({ root })` (the test passes a small `MOVES` override through an options field `moves`,
  so the cases do not depend on the real table). Clear `GIT_DIR` and its family in the child
  environment (CLAUDE.md §4, "A test shelling out to git clears GIT_DIR").
  - `moves a folder's tracked files and leaves untracked ones`: `packages/catalogue/src/a.ts` tracked,
    `packages/catalogue/node_modules/x` untracked → `packages/menu/src/a.ts` exists, the untracked file
    is where it was, `git status --porcelain` shows a rename (`R `).
  - `rewrites a relative import when the importer moves`: `apps/server/src/catalogue-api.ts` imports
    `./logger.js`; after the run `apps/server/src/menu-api.ts` still imports `./logger.js`.
  - `rewrites a relative import when the target moves`: `packages/db/src/schema/index.ts` exports
    `./catalogue/index.js` and `./catalogue.js` → `./menu/index.js` and `./menus.js`.
  - `rewrites when both move`: `packages/db/src/schema/catalogue/menu.ts` imports `../catalogue.js` →
    `packages/db/src/schema/menu/menu.ts` imports `../menus.js`.
  - `rewrites package specifiers and subpaths`: `"@waitron/catalogue"`, `"@waitron/catalogue/src/errors.js"`,
    `"@waitron/db/schema/catalogue.js"` → `@waitron/menu`, `@waitron/menu/src/errors.js`,
    `@waitron/db/schema/menu.js`; `"@waitron/catalogue-x"` (a made-up longer name) is unchanged.
  - `rewrites package-relative paths only inside their package`: `apps/server/test-durations.json`
    with `"src/catalogue-api.test.ts": 1` is rewritten; the same text in `packages/db/x.json` is not.
  - `rewrites a folder name with no trailing slash`: `see packages/catalogue.` and
    `"packages/catalogue"` → `packages/menu`; `packages/catalogue-x` is unchanged.
  - `rewrites the db export key and its value`: a `packages/db/package.json` holding
    `"./schema/catalogue.js": "./src/schema/catalogue/index.ts"` becomes
    `"./schema/menu.js": "./src/schema/menu/index.ts"`; the same key text in another package's
    `package.json` is unchanged.
  - `never matches an empty remainder`: a file under `packages/catalogue/` holding text with no path
    in it is byte-identical apart from its move.
  - `rewrites a moved file's bare name inside its package only`: `apps/server/src/testing/m.ts`
    naming `"catalogue-api.test.ts"` → `"menu-api.test.ts"`; the same text in `packages/db/x.ts` is
    unchanged.
  - `leaves NEVER files alone`: a `drizzle/0000_baseline.sql` and a
    `packages/country-es/test-fixtures/demo/x.json` naming `packages/catalogue/` are byte-identical.
  - `leaves guide-catalogue alone`: `apps/server/src/guide-catalogue.ts` stays, and an import of
    `./guide-catalogue.js` is unchanged.
  - `skips a binary file`: a file holding a NUL byte and the text `packages/catalogue/` is unchanged.
  - `is idempotent`: a second `run` returns `{ moved: 0, rewrote: 0 }` and the tree's
    `git status --porcelain` is unchanged by it.
  - `refuses when a move's target already exists`: both `packages/catalogue/src/a.ts` and
    `packages/menu/src/a.ts` tracked → throws naming both; nothing written.
  - `dry run writes nothing`: `run({ root, dryRun: true })` lists the planned moves; the tree is
    byte-identical.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1308/rename-catalogue-paths.test.mjs` — FAIL,
  the module cannot be found.
- [ ] **Step 3: Implement** to the interfaces and decisions above. Keep it one file; it is in the
  root coverage `include` (`vitest.config.ts:119`, `scripts/**/*.mjs`), so every branch needs a case
  (98/98/98/95, CLAUDE.md §2).
- [ ] **Step 4: Run** the same command — PASS, with a `Tests` count. Then
  `pnpm exec vitest run --coverage --coverage.include='scripts/a1308/**' scripts/a1308/` and read the
  per-file table: `rename-catalogue-paths.mjs` at or above the thresholds.
- [ ] **Step 5: Commit** `git add scripts/a1308/rename-catalogue-paths.mjs scripts/a1308/rename-catalogue-paths.test.mjs && git commit -s -m "Add the script that moves catalogue files to their menu names (A1308 mn1)"`.

### Task 2: Run the script on the tree

**Files:** the script's output; `pnpm-lock.yaml`.

- [ ] **Step 1: Dry run.** `node scripts/a1308/rename-catalogue-paths.mjs --dry-run > <scratch>/plan.txt`.
  Read every planned move: each must match a row of the move table (stop point 1). Count the
  rewritten files; expect about 380.
- [ ] **Step 2: Run it.** `node scripts/a1308/rename-catalogue-paths.mjs`. Then `pnpm install`
  (lockfile importers move from `packages/catalogue` to `packages/menu`).
- [ ] **Step 3: Check it compiles**, one package at a time, reading each exit status (CLAUDE.md §2,
  "Check every command's exit status"):
  `pnpm --filter @waitron/menu typecheck`, `pnpm --filter @waitron/db typecheck`,
  `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/dashboard typecheck`,
  `pnpm --filter @waitron/till typecheck`, `pnpm --filter @waitron/media typecheck`,
  `pnpm --filter @waitron/venue-service typecheck`, `pnpm --filter @waitron/composition typecheck`.
  A failure on an import the script rewrote is stop point 2.
- [ ] **Step 4: Run it again** and see `moved 0, rewrote 0` and an empty `git status --porcelain`
  after committing.
- [ ] **Step 5: Commit** the output alone:
  `git add -A apps packages scripts .github docs/developers docs/backlog docs/backlog.md CLAUDE.md README.md pnpm-lock.yaml && git commit -s -m "Move catalogue files to their menu names, by script (A1308 mn1)"`.
  (Name these paths: never `git add -A` without paths, CLAUDE.md memory "never git add all".)

### Task 3: The hand edits, and the guards

**Files:** `packages/db/src/english-only.ts:27`, `scripts/english-only.test.ts:104`.

- [ ] **Step 1:** In both, the package-folder list names `"catalogue"`; make it `"menu"`. These lists
  name folders under `packages/` that the English-only guard scans; a bare word is not a path the
  script recognises.
- [ ] **Step 2: Run the root guards that read package names and paths:**
  `pnpm exec vitest run scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs scripts/coverage-thresholds.test.ts scripts/english-only.test.ts scripts/dashboard-browser-purity.test.ts scripts/menu-engine-neutral.test.ts scripts/claude-md-pointers.test.ts`.
  `scripts/coverage-thresholds.test.ts` crashes (`ENOENT`, not an assertion) if a package's
  `vitest.config.ts` is missing (`docs/developers/ci-and-gates.md:3695-3715`); that would mean the
  folder move was incomplete.
- [ ] **Step 3: Run the moved package's suites:** `pnpm --filter @waitron/menu test` and
  `cd apps/server && pnpm exec vitest run src/menu-api.test.ts src/menu-manage-permission.test.ts`.
- [ ] **Step 4: Protection list.** Rules §3: `list` on the base and the tip, `compare`; expect `EQUAL`.
- [ ] **Step 5: Commit** `git commit -s -m "Name the menu package in the English-only guard (A1308 mn1)"`.

### Task 4: Finish

- [ ] **Step 1:** Write the pull request description: the first line above; the script's command;
  the hand edits (Task 3, and any Step-3 fix); the dry-run counts; `EQUAL` from the protection list.
- [ ] **Step 2:** `/finish-branch` (rules §9). Push once.
