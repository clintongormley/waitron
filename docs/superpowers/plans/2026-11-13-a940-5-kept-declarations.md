# A940 slice 5 — the box keeps every version's declaration it has run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a box that sells first starts a release it has not run before, it stores that
version's declaración responsable in the venue database, and the declaration page every About
screen shows lists the earlier versions this venue has run, each opening its own text.

**Architecture:** a new append-only table in `fiscal-verifactu`'s migration set,
`declaraciones_responsables`, reached from the server through a new optional seat on the fiscal
contribution (`apps/server` may not import `@waitron/fiscal-verifactu`:
`packages/composition/src/modules.ts:133-140`, guard `scripts/module-seams.test.ts`). At start, a
box accepting sales reads the folder it already serves (`readDeclarationFolder`,
`apps/server/src/declaration-pages.ts`) and, when it holds a release, keeps `{version, text}` once.
The server-rendered `/legal/declaration` page, which the dashboard's About dialog, the till's About
sheet and the setup wizard's sheet all frame, gains a list of the earlier versions; each links to a
new plain-text route.

**Tech Stack:** drizzle schema + `migration-baseline rebuild`, Hono, Vitest with `useVenueDb`.

**Spec:** [`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`](../specs/2026-10-21-a940-declaracion-responsable-design.md)
§7.3 (the whole of what slice 5 is), §2 (the venue keeps the declarations of versions it upgraded
away from), §6 (every terminal opens `/legal/declaration`), §10 slice 5 ("FULL (adds a
migration)", "slice 5 needs 3"); the A940 entry in `docs/backlog/fiscal.md`. Plan review:
`~/waitron-campaign/receipts/a940-5-plan-review.md` (fresh-context, 2026-11-13; 1 Critical,
6 Important, 9 Minor, all folded in below).

## What a person can do once it lands

One pull request. A tax inspector or adviser who asks which declaration applies to invoices made
under an earlier version can be shown it: on any terminal, About Waitron shows the running version's
declaration and, beneath it, «Versiones anteriores» with one link per earlier version this venue's
database has run, each opening that version's text exactly as the box served it. The list travels
with the whole venue database: backups, the bucket copy, and a handover (which places the whole
accepted copy, `apps/server/src/handover-place-copy.ts`). Nothing is visible before `v1.0.0`,
because only a release carries a declaration; the first row is written by the first start of
`v1.0.0` that accepts sales, and the list first shows anything after the upgrade to the second
release. A spare box shows no list today: nothing copies the main box's rows to a spare yet
(`apps/server/src/finish-adoption.ts:27-30`).

## Global Constraints

- Every Spanish word stays in `packages/fiscal-verifactu` or a translation file; the page's
  Spanish words go in `apps/server/src/i18n/declaration-page.ts` beside `DECLARATION_LINK_WORDS`
  (CLAUDE.md §3, "General code is English only").
- The declaration is Spanish in every interface language (design §6.6), so the new list's words
  are Spanish only, as `DECLARATION_LINK_WORDS` are.
- Table: `declaraciones_responsables`, append-only, classified in
  `packages/fiscal-verifactu/src/classification.ts` (design §7.3: "a new append-only table owned
  by `fiscal-verifactu`": "version, text, first started at"). Columns declared through
  `packages/db/src/schema/columns.ts` only.
- A schema change rebuilds the set's starting migration:
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu` — never a new
  migration file, never a hand edit. This resets every venue; the PR's first line says so
  (CLAUDE.md §3; `docs/developers/conventions-data.md` "A schema change rebuilds the set's one
  starting migration").
- The new append-only table goes in `packages/migrations/migrations.manifest.json`'s
  `fiscal-verifactu` entry too, **at the same position as in the classification** (the composition
  test pins the manifest's list equal to `appendOnlyTablesIn(FISCAL_CLASSIFICATION)`, in order).
- A failed keep logs and the start carries on; nothing on the sale path waits on it.
- No fiscal core is touched: no record, chain, series or filing changes. The golden huella test and
  `inmutabilidad` must pass UNEDITED (runbook H2; the review ran `inmutabilidad` with the table
  added: it names only `registros_facturacion` and passed).
- Build waits for lane A's parked #2942 to land (runbook H1: no migration-adding item while a
  parked pull request is open), unless the watcher says otherwise.

## Decisions made in this plan (departures from the design's words)

1. **The list is on the server-rendered `/legal/declaration` page, beneath the running version's
   declaration, not in each app's About screen.** Every About screen already frames that page
   (`apps/dashboard/src/widgets/about-dialog.ts:115`, the till's `guide-sheet.ts:107`, the setup
   wizard's `about-sheet.ts:96`), so one change reaches every terminal, `LegalAbout`
   (`packages/shared/src/legal-about.ts`) does not change, and no app changes.
2. **An earlier version opens as its plain text only** (`/legal/declaration/<version>.txt`), no
   HTML page and no PDF, because the design keeps "version, text, first started at" and nothing
   else. The text is the bytes of the `declaration.txt` the box served while running that version.
   It opens inside the About frame; closing the About screen returns to where the person was.
3. **Class `state`, three columns, primary key `version`** — "what means the same on every node"
   (`packages/sync-enrolment/src/classification.ts:1-5`): "this venue has run 1.1.0" is one row per
   venue, not per box. A later box starting the same version (after a handover or a restore) adds
   nothing.
4. **Only a box accepting sales at start writes** (`acceptingSales`, `apps/server/src/boot.ts:2195`:
   singleton primary, neither mirror nor fenced). A box repairing its time zone (`boot.ts:2297`,
   `acceptingSales: false` at `:2313`) and a spare write nothing.
5. **A box whose fiscal module is `fiscal-none` keeps nothing and lists nothing**: the seat is
   optional on `FiscalContribution`, as `installationStartedAt` is. The declaración responsable is
   the Spanish regime's duty.
6. **`first_started_at` is stored, as the design asks, but neither shown nor used for ordering.** It
   is the box clock's reading at a start whose time is not yet confirmed
   (`apps/server/src/start-clock-check.ts:40-45` begins `"waiting"`), and the row can never be
   corrected. The list is ordered by version number, part by part, which is the order releases were
   made in (`pnpm release prepare` refuses a version not greater than the last, design §5.4 step 1),
   and lists only versions lower than the running one (so an install of an older release does not
   show a later one as "earlier").
7. **A box whose running folder is damaged answers its existing 500 page at `/legal/declaration`,
   with no list;** the per-version route does not depend on the running folder and still answers.
   Production refuses an unreleased bundle, so only a damaged image reaches this.

## Review Focus

1. **A box restarted many times on one release** — one row, its `text` and `first_started_at`
   unchanged after the first start. (Task 1's idempotency case; Task 2's second-start case.)
2. **The keep fails** (disk full, a refused insert) — the start continues, logs
   `declaration.keep_failed` with the error code, and the next start tries again. (Task 2.)
3. **A spare (mirror), a fenced box, a setup-mode box, a test build, a damaged folder** — none
   writes a row. (Task 2.)
4. **The new route's input** — `/legal/declaration/1.0.0.txt` answers that version's stored text;
   an unknown version, `../x.txt`, `1.0.txt`, or anything not three runs of digits answers the
   existing «Página no encontrada» 404 page without reading the database;
   `/legal/declaration.txt` (the running version) still answers as before. (Task 3.)
5. **The running version and later ones are not listed as "earlier"**, the list is in version order
   (1.9.0 before 1.10.0), and with no earlier version the page is byte-for-byte what slice 3 serves.
   (Task 3.)

---

### Task 1: the table and the seat

**Files:**
- Create: `packages/fiscal-verifactu/src/schema/declarations.ts`
- Modify: `packages/fiscal-verifactu/src/schema/index.ts` (export it)
- Modify: `packages/fiscal-verifactu/src/classification.ts` (one `appendOnly` line)
- Modify: `packages/migrations/migrations.manifest.json` (the `fiscal-verifactu` entry's
  append-only list, same position as the classification line)
- Regenerate: `packages/fiscal-verifactu/drizzle/` and `scripts/migration-baseline-epoch.json` via
  the rebuild command (the review measured +70/−4 generated lines)
- Create: `packages/fiscal-verifactu/src/declaration/kept.ts`
- Modify: `packages/fiscal/src/contribution.ts` (the seat type), `packages/fiscal/src/index.ts`
  (export it)
- Modify: `packages/fiscal-verifactu/src/slot.ts` (wire the seat)
- Test: `packages/fiscal-verifactu/src/declaration/kept.test.ts`
- **Changed test checks** (each failed in the review's probe until it named the new table; list
  every one in the PR's "Changed test checks" section):
  - `scripts/append-only-triggers.test.ts` `EXPECTED` (`:34`) — a guard under `scripts/`: the
    queue rule counts that as controversial, so ask the watcher in `questions.md` before landing;
  - `packages/fiscal-verifactu/src/schema-ownership.test.ts` `OWNED` (`:10`);
  - `scripts/migration-upgrade.test.ts` `CANDIDATES`: `"declaraciones_responsables.version":
    ["1.0.0", "1.0.1"]` (required; queue rule: sample values are not a guard edit, say so in the
    PR);
  - `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` `ADDED_TABLES` (`:72`);
  - `apps/server/src/backup-verification-target.test.ts` `steadyPin` (`:441`): the stored-schema
    checksum, re-pinned to the value the run prints.

**Interfaces:**
- Produces, in `packages/fiscal/src/contribution.ts`:

```ts
export interface FiscalDeclarationsSeat {
  /** Stores the running release's declaration unless its version is already kept. */
  keep(tx: Transaction, entry: { version: string; text: string; at: Date }): Promise<void>;
  /** Every kept version, lowest version first (numeric per part). */
  versions(tx: Transaction): Promise<string[]>;
  /** The kept text of one version, or null when it was never kept. */
  text(tx: Transaction, version: string): Promise<string | null>;
}
```

  and `readonly declarations?: FiscalDeclarationsSeat;` on `FiscalContribution`.
- Produces, in `packages/fiscal-verifactu/src/declaration/kept.ts`: `keptDeclarations:
  FiscalDeclarationsSeat`, wired as `declarations: keptDeclarations` in `slot.ts`.

- [ ] **Step 1: Write the failing tests** in `kept.test.ts`, on a real database:
  `useVenueDb({ migrations: TEST_MIGRATIONS, setup: seedTenantNodeSif })` as the package's other
  schema-backed suites do (`packages/fiscal-verifactu/test/migrations.ts`); add no helper.
  - `keeps a version's text once` — `keep` 1.0.0 (text "A", at T1), then `keep` 1.0.0 (text "B",
    at T2): `versions` is `["1.0.0"]`, `text("1.0.0")` is `"A"`, and the row's `first_started_at`
    is T1.
  - `lists versions in version order` — keep 1.10.0 at T1, 1.2.0 at T2, 1.9.0 at T0 (times in
    neither order): `versions` is `["1.2.0", "1.9.0", "1.10.0"]`.
  - `answers null for a version never kept` — `text("9.9.9")` is `null`; `versions` on an empty
    table is `[]`.
  - `refuses to change or remove a kept row` — a raw `update` and a raw `delete` on
    `declaraciones_responsables` each throw, and `triggerRaised`
    (`packages/db/src/constraint-target.ts`) matches `"declaraciones_responsables is append-only"`.
  - `refuses a version that is not a release version` — `keep` with `1.0`, `1.0.0-dev`, `1..0`,
    `a.b.c`, `""`, `1.0.0.0`, `.1.0` and `1.0.` each throws, identified by the CHECK's name;
    `1.0.0` and `10.20.30` are kept.
  - `keeps the text's bytes exactly` — a text with a trailing newline, `«»`, `ñ` and a blank line
    reads back identical.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration/kept.test.ts`.
  Expected: fails to import `./kept.js`.

- [ ] **Step 3: Add the schema** `declaracionesResponsables = table("declaraciones_responsables",
  { version: label("version").primaryKey(), text: label("text").notNull(), firstStartedAt:
  ts("first_started_at").notNull() })` with a CHECK named `declaraciones_responsables_version_ck`.
  SQLite here has no `regexp` (the review ran `select ? regexp ?` on `node:sqlite` 3.54.1: "no such
  function: regexp"); this glob form passed the case's whole list in the review's probe:
  `version glob '[0-9]*.[0-9]*.[0-9]*' and version not glob '*[^0-9.]*' and version not glob '*..*'
  and version not glob '.*' and version not glob '*.' and length(version) -
  length(replace(version, '.', '')) = 2`. One comment line on the table: what it holds, that
  `first_started_at` is the box's unconfirmed reading and orders nothing, and "Declared
  `appendOnly()` in `../classification.ts`", as `clock-checks.ts` does. Add
  `appendOnly("declaraciones_responsables", "state", "the declaraciones responsables this venue has
  run; one row per release version, the same on every box")` and the manifest entry at the same
  position.

- [ ] **Step 4: Rebuild the starting migration** —
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`; stage what it
  wrote.

- [ ] **Step 5: Implement `keptDeclarations`** in `kept.ts`: `keep` is an insert with
  `.onConflictDoNothing({ target: declaracionesResponsables.version })` (named target, CLAUDE.md
  §3); `versions` selects every version and sorts in JavaScript by the three numeric parts; `text`
  selects by version. Add the seat type to `contribution.ts`, export it, wire it in `slot.ts`. Make
  the five changed test checks above.

- [ ] **Step 6: Run the tests and every guard the schema change touches; all pass** —
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration/kept.test.ts src/schema-ownership.test.ts`
  (read the count), then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts scripts/append-only-migration-sets.test.ts scripts/column-vocabulary.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/module-graph-honesty.test.ts scripts/english-only.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`,
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/backup-verification src/modules.test.ts`,
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (golden huella and inmutabilidad UNEDITED). Read each `Tests` count.

- [ ] **Step 7: Prove the append-only case by deletion** — the package's test migrations take
  their triggers from the MANIFEST (`TEST_MIGRATIONS` is `migrationOptionsFor(manifestSets(),
  null)`), so remove the manifest entry and rerun the refusal case: it fails (the update succeeds).
  Restore; it passes. The classification line is held to the manifest by `composition.test.ts` and
  by `append-only-triggers.test.ts`. One sentence in the commit message: what was removed, which
  assertion failed, the restored result.

- [ ] **Step 8: Commit** — `git commit -s`, message in plain English: the venue database can keep
  each release's declaration text; the fiscal-verifactu starting migration was rebuilt, so every
  venue resets.

### Task 2: a box that sells keeps its running release's declaration at start

**Files:**
- Create: `apps/server/src/keep-declaration.ts`
- Modify: `apps/server/src/boot.ts` (one call; a `declarationRoot?: string` seam on
  `StartServerSeams`, defaulting to `declarationRoot()`, passed to BOTH the keep and
  `mountDeclarationPages` at `:1399` so one test folder is served and kept)
- Test: `apps/server/src/keep-declaration.test.ts`; one case in `apps/server/src/boot.mirror.test.ts`
  (or `boot.test.ts`'s trading start, whichever already starts both a primary and a mirror)

**Interfaces:**
- Consumes: `FiscalDeclarationsSeat` (Task 1); `readDeclarationFolder(root)` and
  `declarationRoot()` from `apps/server/src/declaration-pages.ts`; `writeDeclarationFolder` from
  `apps/server/src/testing/declaration-folder.ts` for tests.
- Produces:

```ts
export async function keepRunningDeclaration(deps: {
  root: string;
  seat: FiscalDeclarationsSeat | undefined;
  db: Database;
  now: () => Date;
  log: Logger;
}): Promise<void>;
```

  Reads the folder; when it is `kind: "release"`, keeps `{ version, text, at: now() }` in one
  `withTransaction`; when it is `none` or `damaged`, or `seat` is undefined, writes nothing and
  logs nothing. Every thrown error is caught and logged once as `log("warn",
  "declaration.keep_failed", { errorCode: codeOf(error) })`; it never rethrows.

- [ ] **Step 1: Write the failing tests** in `keep-declaration.test.ts`, with a real database
  (`useVenueDb` with the fiscal set) and folders from `writeDeclarationFolder`:
  - `keeps the release the box is running` — release folder 1.0.0 → the seat's `versions` is
    `["1.0.0"]` and its `text("1.0.0")` is the folder's `declaration.txt` bytes.
  - `a second start keeps the first start's text` — run twice, the second time over a folder whose
    text differs: one row, the first text.
  - `keeps nothing from a test build or a damaged folder` — no folder; a folder missing
    `declaration.txt`: `versions` is `[]`, `log` not called.
  - `keeps nothing without the seat` — `seat: undefined`: resolves, `log` not called.
  - `a failed keep does not stop the start` — a seat whose `keep` throws an `AppError` with
    `storage.disk_full`: the call resolves, `log` received `declaration.keep_failed` with that
    code, once.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/server exec vitest run src/keep-declaration.test.ts`. Expected: cannot
  import `./keep-declaration.js`.

- [ ] **Step 3: Implement `keepRunningDeclaration`** as the Interfaces block says.

- [ ] **Step 4: Wire it in `bootServer`.** Immediately after `enabledFiscal` is assigned
  (`boot.ts:2244`) and before the time-zone repair branch (`:2297`), call it once, awaited, guarded
  by `acceptingSales`, with `seat: enabledFiscal.declarations` (or however the enabled contribution
  is reached at that point), `root: seams.declarationRoot ?? declarationRoot()`. Setup mode never
  reaches this point (no venue), and needs nothing: provisioning answers `restarting: true` and
  restarts the process (`apps/server/src/setup-api.ts:992-997`, `requestRestart` at
  `boot.ts:2365`), so the first trading start is a fresh `bootServer` that runs this call.

- [ ] **Step 5: One boot-level case.** In the boot suite that starts a primary and a mirror, with
  `declarationRoot` pointed at a `writeDeclarationFolder` release folder: after the primary's start
  the database holds the version; after a mirror's start over a database with no row, it holds
  nothing. Proven by deletion: drop the `acceptingSales` guard, the mirror case fails; restore.

- [ ] **Step 6: Run** — `pnpm --filter @waitron/server exec vitest run src/keep-declaration.test.ts src/declaration-pages.test.ts src/unreleased-build.e2e.test.ts <the boot suite>`.
  All pass; read the `Tests` counts.

- [ ] **Step 7: Commit** — `git commit -s`.

### Task 3: the declaration page lists earlier versions; each opens its text; guide

**Files:**
- Modify: `apps/server/src/declaration-pages.ts`
- Modify: `apps/server/src/i18n/declaration-page.ts` (Spanish words for the list)
- Modify: `apps/server/src/boot.ts` (pass the reader to `mountDeclarationPages`)
- Modify: `apps/server/src/guide/en/about.md`, `apps/server/src/guide/es/about.md`
- Modify: `docs/backlog/fiscal.md` (A940 entry: slice 5 landed; slice 6 remains)
- Test: `apps/server/src/declaration-pages.test.ts`
- **Changed test check:** `apps/server/src/boot.mirror-surface.test.ts` `OPEN_READS` (`:269`) gains
  `"/legal/declaration/<MADE_UP>": { status: 404 }` — the walk reads `app.routes` and expects 403 for
  any GET not listed; the review's probe failed two of its cases with the new route. It is the same
  kind of public read as its three siblings already in the list; say so in the PR.

**Interfaces:**
- Consumes: `FiscalDeclarationsSeat` (Task 1).
- Produces: `DeclarationPagesDeps` gains

```ts
  /** The venue database's kept declarations; absent where no venue database is open. Asked per
   * request, because `bootServer` mounts the pages before it opens the venue. */
  kept?: () =>
    | { versions(): Promise<string[]>; text(version: string): Promise<string | null> }
    | undefined;
```

  The landing, recovery and waiting listeners pass nothing. `bootServer` passes a getter that
  answers `undefined` until it is assigned at the same point as Task 2's call (after `:2244`,
  before `:2297`), and only when the enabled contribution has a `declarations` seat. Each read is a
  write-lock turn without a drain, `db.withWriteLock(() => seat.versions(db))`, as
  `apps/server/src/backup-deletion-alert.ts:25` reads a fiscal seat, so the page still answers
  while a change waits on a nearly full disk.

- [ ] **Step 1: Write the failing tests** in `declaration-pages.test.ts`, with a
  `writeDeclarationFolder` release folder for 1.2.0 and a fake `kept` (the database half is Task 1's;
  do not test it again here):
  - `lists earlier versions beneath the declaration` — kept `["1.0.0", "1.1.0", "1.2.0",
    "1.3.0"]`, running 1.2.0: after the download links the page contains
    `<h2>Versiones anteriores</h2>` and exactly two links in this order,
    `<a href="/legal/declaration/1.0.0.txt">Waitron 1.0.0</a>` then 1.1.0; neither 1.2.0 nor 1.3.0
    is listed.
  - `shows no list when no earlier version is kept` — `kept` answering `["1.2.0"]`, and `kept`
    absent: each response body equals the body of the render with `kept` absent and no rows (assert
    equality with that render, not a `not.toContain`).
  - `serves an earlier version's kept text` — GET `/legal/declaration/1.0.0.txt`: 200,
    `text/plain; charset=utf-8`, `Content-Disposition: inline;
    filename="waitron-1.0.0-declaration.txt"`, body exactly the kept text; and the same with the
    running folder absent or damaged.
  - `answers not found for a version it has not kept` — `/legal/declaration/9.9.9.txt` (kept answers
    null), `/legal/declaration/1.0.txt`, `/legal/declaration/..%2Fx.txt`, `/legal/declaration/1.0.0`
    and any version with `kept` absent: 404 with `DECLARATION_PAGE_WORDS.es.notFoundTitle` for an
    `es` request; `kept().text` is never called for a value that is not three runs of digits.
  - `still serves the running version's text` — slice 3's existing `/legal/declaration.txt` case,
    unchanged, is the check.
  - `a failed read of the kept list still shows the running declaration` — `kept().versions`
    rejects: the page is 200 with the running declaration and no list, and the log has
    `declaration.kept_read_failed` with the error code, once.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts`.

- [ ] **Step 3: Implement.** In `mountDeclarationPages`: the `/legal/declaration` handler asks
  `deps.kept?.()`, lists every kept version lower than the running one (compare the three numeric
  parts), and appends the heading and list after the download paragraph only when there is at least
  one, escaping every value with `escapeHtml`. Add `app.get("/legal/declaration/:file", …)` before
  `/legal` and `/legal/*` (the review's Hono 4.13.16 probe showed this order routes as the tests
  expect), accepting only `^(\d+\.\d+\.\d+)\.txt$`, otherwise the not-found page. Add
  `earlierTitle: "Versiones anteriores"` to `DECLARATION_LINK_WORDS`. Pass the getter from
  `bootServer`. Add the `OPEN_READS` entry.

- [ ] **Step 4: The guide.** In `apps/server/src/guide/en/about.md`, after the "Descargar PDF"
  paragraph, one sentence: "If they ask about invoices from an earlier version of Waitron, open
  that version under **Versiones anteriores**." The Spanish twin in `es/about.md`. Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and from the root
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.

- [ ] **Step 5: Look at it.** With the dev stack (`wa-wt demo <worktree-name>`) or a scratch server
  start whose `declarationRoot` is a `writeDeclarationFolder` release folder and two kept rows,
  open About Waitron in the dashboard dialog and in the till's More → About sheet, in both themes
  and at phone width, click one earlier version, and close the screen. Screenshots stay in the
  working folder, never committed (CLAUDE.md §6).

- [ ] **Step 6: Backlog.** In `docs/backlog/fiscal.md`'s A940 entry, replace "Slices 5 (…) and 6
  (…) remain" with one sentence saying slice 5 landed (this PR) and what it does, and "Slice 6
  (`@waitron/verifactu`'s own declaration) remains".

- [ ] **Step 7: Run every changed test file and commit** —
  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts src/keep-declaration.test.ts src/guide-content.test.ts src/boot.mirror-surface.test.ts`;
  `git commit -s`.

## After the tasks

`/finish-branch` on the FULL path (a migration and a cross-package seat): two Codex run-it seats
and the conventions seat. The PR's first line: "Rebuilds the fiscal-verifactu starting migration:
every venue resets." List every changed test check (Task 1's five, Task 3's one) under "Changed
test checks", and the `append-only-triggers.test.ts` one as a question to the watcher before
landing.
