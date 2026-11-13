# A940 slice 5 — the box keeps every version's declaration it has run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a box that sells first starts a release it has not run before, it stores that
version's declaración responsable in the venue database, and the declaration page every About
screen shows lists the earlier versions this venue has run, each opening its own text.

**Architecture:** a new append-only table in `fiscal-verifactu`'s migration set,
`declaraciones_responsables`, reached from the server through a new optional seat on the fiscal
contribution (`apps/server` may not import `@waitron/fiscal-verifactu`,
`packages/composition/src/modules.ts:121-127`). At start, a box accepting sales reads the folder it
already serves (`readDeclarationFolder`, `apps/server/src/declaration-pages.ts`) and, when it holds
a release, keeps `{version, text}` once. The server-rendered `/legal/declaration` page, which the
dashboard's About dialog, the till's About sheet and the setup wizard's sheet all frame, gains a
list of the earlier versions; each links to a new plain-text route.

**Tech Stack:** drizzle schema + `migration-baseline rebuild`, Hono, Vitest with `useVenueDb`.

**Spec:** [`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`](../specs/2026-10-21-a940-declaracion-responsable-design.md)
§7.3 (the whole of what slice 5 is), §2 (the venue keeps the declarations of versions it upgraded
away from), §6 (every terminal opens `/legal/declaration`), §10 slice 5 ("FULL (adds a
migration)", "slice 5 needs 3"); the A940 entry in `docs/backlog/fiscal.md`.

## What a person can do once it lands

One pull request. A tax inspector or adviser who asks which declarations apply to the invoices of
an earlier version can be shown them: on any terminal, About Waitron shows the running version's
declaration and, beneath it, «Versiones anteriores» with one line per earlier version this venue's
database has run, each opening that version's text exactly as the box served it. The list travels
with the venue database (backups, the bucket copy, a handover). Nothing is visible before
`v1.0.0`, because only a release carries a declaration; the first row is written by the first
production start of `v1.0.0`, and the list first shows anything after the upgrade to the second
release.

## Global Constraints

- Every Spanish word stays in `packages/fiscal-verifactu` or a translation file; the page's
  Spanish words go in `apps/server/src/i18n/declaration-page.ts` beside `DECLARATION_LINK_WORDS`
  (CLAUDE.md §3, "General code is English only").
- The declaration is Spanish in every interface language (design §6.6), so the new list's words
  are Spanish only, as `DECLARATION_LINK_WORDS` are.
- Table: `declaraciones_responsables`, append-only, classified in
  `packages/fiscal-verifactu/src/classification.ts` (design §7.3: "a new append-only table owned
  by `fiscal-verifactu`"). Columns declared through `packages/db/src/schema/columns.ts` only.
- A schema change rebuilds the set's starting migration:
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu` — never a new
  migration file, never a hand edit. This resets every venue; the PR's first line says so
  (CLAUDE.md §3, "Editing a shipped migration file"; conventions-data.md "A schema change rebuilds
  the set's one starting migration").
- The new append-only table goes in `packages/migrations/migrations.manifest.json`'s
  `fiscal-verifactu` entry too (CLAUDE.md §3; guard `scripts/append-only-migration-sets.test.ts`).
- Nothing on the sale path waits on this: a failed keep logs and the start carries on (CLAUDE.md
  §3, housekeeping writes; §5, nothing external blocks a sale — this is local, but it is not a
  reason to stop a start either).
- No fiscal core is touched: no record, chain, series or filing changes. The golden huella test and
  `inmutabilidad` must pass UNEDITED (runbook H2).
- Build waits for lane A's parked #2942 to land (runbook H1: no migration-adding item while a
  parked pull request is open), unless the watcher says otherwise.

## Decisions made in this plan (departures from the design's words)

1. **The list is on the server-rendered `/legal/declaration` page, beneath the running version's
   declaration, not in each app's About screen.** Every About screen already frames that page
   (`apps/dashboard/src/widgets/about-dialog.ts` iframes it; the till's More → About and every ⓘ
   open it in the guide sheet; the setup wizard's sheet frames it), so one change reaches every
   terminal, `LegalAbout` (`packages/shared/src/legal-about.ts`) does not change, and no app
   changes. The design says "The About page lists the earlier versions"; the page each About shows
   does.
2. **An earlier version opens as its plain text only** (`/legal/declaration/<version>.txt`), no
   HTML page and no PDF, because the design keeps "version, text, first started at" and nothing
   else. The text is the bytes of the `declaration.txt` the box served while running that version.
3. **The table carries `node_id`, the box that first started the version** — the `ledger`
   convention ("what happened, keyed by the node that wrote it",
   `packages/sync-enrolment/src/classification.ts:1-5`). The primary key is `version`, so a later
   box starting the same version (a promoted spare, a restored copy) adds nothing.
4. **Only a box accepting sales at start writes** (`acceptingSales` in
   `apps/server/src/boot.ts:2195`: singleton primary, neither mirror nor fenced). A spare's copy of
   the venue database is read-only; it lists what the main box kept. A spare promoted while running
   keeps its version at its next start, not at the promotion (the design's §5.4 upgrades the spare
   in the same visit as the main box, so its version is normally already kept).
5. **A box whose fiscal module is `fiscal-none` keeps nothing and lists nothing**: the seat is
   optional on `FiscalContribution`, as `installationStartedAt` is. The declaración responsable is
   the Spanish regime's duty.
6. **"First started at" is the box clock's reading at that start**, shown as a date. It is not a
   fiscal time and is not checked against the start's clock confirmation; it tells a person when
   the venue began using a version.

## Review Focus

1. **A box restarted many times on one release** — one row, its `first_started_at` and `text`
   unchanged after the first start. (Task 1's idempotency case; Task 2's second-start case.)
2. **The keep fails** (disk full, a locked database, a refused insert) — the start continues,
   logs `declaration.keep_failed` with the error code, and the next start tries again. (Task 2.)
3. **A spare (mirror), a fenced box, a setup-mode box, a test build, a damaged folder** — none
   writes a row. (Task 2.)
4. **The new route's input** — `/legal/declaration/1.0.0.txt` answers that version's stored text;
   an unknown version, `../x.txt`, `1.0.txt`, or a version that is the running one but was never
   kept answers the existing «Página no encontrada» 404 page; `/legal/declaration.txt` (the running
   version) still answers as before. (Task 3.)
5. **The running version is not listed as "earlier"**, and the list is ordered oldest first; with
   no earlier version the page shows no heading at all, so today's page is byte-for-byte what slice
   3 serves. (Task 3.)

---

### Task 1: the table and the seat

**Files:**
- Create: `packages/fiscal-verifactu/src/schema/declarations.ts`
- Modify: `packages/fiscal-verifactu/src/schema/index.ts` (export it)
- Modify: `packages/fiscal-verifactu/src/classification.ts` (one `appendOnly` line)
- Modify: `packages/migrations/migrations.manifest.json` (the `fiscal-verifactu` entry's
  append-only list)
- Regenerate: `packages/fiscal-verifactu/drizzle/` and `scripts/migration-baseline-epoch.json` via
  the rebuild command
- Create: `packages/fiscal-verifactu/src/declaration/kept.ts`
- Modify: `packages/fiscal/src/contribution.ts` (the seat type), `packages/fiscal/src/index.ts`
  (export it)
- Modify: `packages/fiscal-verifactu/src/slot.ts` (wire the seat)
- Test: `packages/fiscal-verifactu/src/declaration/kept.test.ts`
- Possibly: `scripts/migration-upgrade.test.ts` `CANDIDATES` sample values for the new table
  (queue rule: not a guard edit; say so in the PR)

**Interfaces:**
- Produces, in `packages/fiscal/src/contribution.ts`:

```ts
export interface KeptDeclaration {
  readonly version: string;
  readonly firstStartedAt: Date;
}

export interface FiscalDeclarationsSeat {
  /** Stores the running release's declaration unless its version is already kept. */
  keep(
    tx: Transaction,
    entry: { version: string; text: string; nodeId: NodeId; at: Date },
  ): Promise<void>;
  /** Every kept version, oldest `firstStartedAt` first. */
  list(tx: Transaction): Promise<KeptDeclaration[]>;
  /** The kept text of one version, or null when it was never kept. */
  text(tx: Transaction, version: string): Promise<string | null>;
}
```

  and `readonly declarations?: FiscalDeclarationsSeat;` on `FiscalContribution`.
- Produces, in `packages/fiscal-verifactu/src/declaration/kept.ts`: `keptDeclarations:
  FiscalDeclarationsSeat`, wired as `declarations: keptDeclarations` in `slot.ts`.

- [ ] **Step 1: Write the failing tests** in `kept.test.ts`, on a real database
  (`useVenueDb` with the fiscal set migrated, as `packages/fiscal-verifactu/src/clock-checks*.test.ts`
  or another schema-backed suite in the package does — reuse its setup, add no helper):
  - `keeps a version's text once` — `keep` 1.0.0 (text "A", at T1), then `keep` 1.0.0 (text "B",
    at T2): `list` is `[{ version: "1.0.0", firstStartedAt: T1 }]`, `text("1.0.0")` is `"A"`.
  - `lists versions oldest first` — keep 1.1.0 at T2 then 1.0.0 at T1 (insertion order differs from
    time order): `list` returns 1.0.0 then 1.1.0.
  - `answers null for a version never kept` — `text("9.9.9")` is `null`; `list` on an empty table
    is `[]`.
  - `refuses to change or remove a kept row` — a raw `update` and a raw `delete` on
    `declaraciones_responsables` each throw, and `triggerRaised`
    (`packages/db/src/constraint-target.ts`) identifies the append-only trigger (CLAUDE.md §3:
    identify 1811 refusals by their words).
  - `refuses a version that is not a release version` — `keep` with `1.0`, `1.0.0-dev`, `1..0`,
    `a.b.c` and `""` each throws, identified by the CHECK's name; `1.0.0` and `10.20.30` are kept.
  - `keeps the text's bytes exactly` — a text with a trailing newline, `«»`, `ñ` and a blank line
    reads back identical.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration/kept.test.ts`.
  Expected: fails to import `./kept.js`.

- [ ] **Step 3: Add the schema** `declaracionesResponsables = table("declaraciones_responsables",
  { version: label("version").primaryKey(), nodeId: id("node_id").notNull().references(() =>
  nodes.id), text: label("text").notNull(), firstStartedAt: ts("first_started_at").notNull() })`,
  with a CHECK named `declaraciones_responsables_version_ck` that refuses anything but three
  dot-separated runs of digits — a release version is the only thing a box keeps (`releaseFrom`,
  `declaration-pages.ts`). Write the expression against the test below; SQLite has no regex. One-line comment on the table: what it
  holds and "Declared `appendOnly()` in `../classification.ts`", as `clock-checks.ts` does. Add the
  classification line `appendOnly("declaraciones_responsables", "ledger", LEDGER)` and the
  manifest entry.

- [ ] **Step 4: Rebuild the starting migration** —
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`. Stage
  everything it wrote with `git add -A` on those paths.

- [ ] **Step 5: Implement `keptDeclarations`** in `kept.ts`: `keep` is an insert with
  `.onConflictDoNothing({ target: declaracionesResponsables.version })` (named target, CLAUDE.md
  §3); `list` selects `version, first_started_at` ordered by `first_started_at, version`; `text`
  selects by version. Add the seat type to `contribution.ts`, export it, wire it in `slot.ts`.

- [ ] **Step 6: Run the tests and every guard the schema change names; all pass** —
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration/kept.test.ts` (6
  passed), then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts scripts/append-only-migration-sets.test.ts scripts/column-vocabulary.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (golden huella and inmutabilidad UNEDITED), and `pnpm --filter @waitron/fiscal exec vitest run`
  if a test there pins the contribution's key list. Read each `Tests` count.

- [ ] **Step 7: Prove the append-only case by deletion** — remove the `appendOnly` classification
  line, rerun the refusal case: it fails (the update succeeds). Restore; it passes. One sentence in
  the commit message.

- [ ] **Step 8: Commit** — `git commit -s`, message in plain English: the venue database can keep
  each release's declaration text; the fiscal-verifactu starting migration was rebuilt, so every
  venue resets.

### Task 2: a box that sells keeps its running release's declaration at start

**Files:**
- Create: `apps/server/src/keep-declaration.ts`
- Modify: `apps/server/src/boot.ts` (one call after `acceptingSales` is known and before the
  trading listener opens; a `declarationRoot?: string` seam on `StartServerSeams`, defaulting to
  `declarationRoot()`)
- Test: `apps/server/src/keep-declaration.test.ts`; one case in an existing boot suite (below)

**Interfaces:**
- Consumes: `FiscalDeclarationsSeat` (Task 1); `readDeclarationFolder(root)` and
  `declarationRoot()` from `apps/server/src/declaration-pages.ts`.
- Produces:

```ts
export async function keepRunningDeclaration(deps: {
  root: string;
  seat: FiscalDeclarationsSeat | undefined;
  db: Database;
  nodeId: NodeId;
  now: () => Date;
  log: Logger;
}): Promise<void>;
```

  Reads the folder; when it is `kind: "release"`, keeps `{ version, text }` in one
  `withTransaction`; when it is `none`, `damaged`, or `seat` is undefined, writes nothing. Every
  thrown error is caught and logged once as `log("warn", "declaration.keep_failed", { errorCode:
  codeOf(error) })`; it never rethrows. (A damaged folder is already logged by the pages as
  `declaration.folder_damaged`; do not log it twice.)

- [ ] **Step 1: Write the failing tests** in `keep-declaration.test.ts`, with a real database and a
  folder written by the existing slice-3 test fixture that `declaration-pages.test.ts` uses for a
  release folder (reuse it; if it is local to that file, move it to the server's `src/testing/`
  only if both files need it, and say so):
  - `keeps the release the box is running` — folder release 1.0.0 → seat `list` holds 1.0.0 with
    `firstStartedAt` = the injected `now`, `text` = the folder's `declaration.txt` bytes.
  - `a second start keeps the first start's row` — run twice with different `now`: one row, the
    first time.
  - `keeps nothing from a test build or a damaged folder` — no folder; a folder missing
    `declaration.txt`: `list` is `[]`.
  - `keeps nothing without the seat` — `seat: undefined`: no throw, nothing logged.
  - `a failed keep does not stop the start` — a seat whose `keep` throws an `AppError` with
    `storage.disk_full`: the call resolves, `log` received `declaration.keep_failed` with that
    code, once.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/server exec vitest run src/keep-declaration.test.ts`. Expected: cannot
  import `./keep-declaration.js`.

- [ ] **Step 3: Implement `keepRunningDeclaration`** as the Interfaces block says.

- [ ] **Step 4: Wire it in `bootServer`.** Call it once, awaited, only when `acceptingSales` is
  true, with `seat: enabledFiscal.declarations` (or however the enabled contribution is named at
  that point; `enabledFiscal` is assigned at `boot.ts:2244`), `root: seams.declarationRoot ??
  declarationRoot()`, `nodeId: config.node.nodeId`. Not in setup mode (no venue), not on a mirror or
  fenced box. Confirm by reading the setup flow that the first trading start after setup runs
  through this branch (setup writes `trading.env` and the box restarts); say in the commit what you
  found.

- [ ] **Step 5: One boot-level case.** In the existing boot suite that starts a primary and a
  mirror (`apps/server/src/boot.mirror.test.ts`, or `boot.test.ts`'s trading start), with
  `declarationRoot` pointed at a release folder fixture: after the primary's start the seat lists
  the version; after a mirror's start over a database with no row, it lists nothing. Proven by
  deletion: drop the `acceptingSales` condition, the mirror case fails; restore.

- [ ] **Step 6: Run** — `pnpm --filter @waitron/server exec vitest run src/keep-declaration.test.ts
  src/declaration-pages.test.ts <the boot suite>` and `src/unreleased-build.e2e.test.ts`
  (unchanged). All pass; read the `Tests` counts.

- [ ] **Step 7: Commit** — `git commit -s`.

### Task 3: the declaration page lists earlier versions; each opens its text; guide

**Files:**
- Modify: `apps/server/src/declaration-pages.ts`
- Modify: `apps/server/src/i18n/declaration-page.ts` (Spanish words for the list)
- Modify: `apps/server/src/boot.ts` (pass the reader to `mountDeclarationPages`)
- Modify: `apps/server/src/guide/en/about.md`, `apps/server/src/guide/es/about.md`
- Modify: `docs/backlog/fiscal.md` (A940 entry: slice 5 landed; only slice 6 and 1b remain)
- Test: `apps/server/src/declaration-pages.test.ts`

**Interfaces:**
- Consumes: `KeptDeclaration` (Task 1).
- Produces: `DeclarationPagesDeps` gains

```ts
  /** The venue database's kept declarations; absent where no venue database is open. Asked per
   * request, because `bootServer` mounts the pages before it opens the venue. */
  kept?: () =>
    | { list(): Promise<KeptDeclaration[]>; text(version: string): Promise<string | null> }
    | undefined;
```

  The landing, recovery and waiting listeners pass nothing. `bootServer` passes a getter that
  answers `undefined` until the trading branch has a database and an enabled fiscal contribution
  with a `declarations` seat, then closures over `seat.list(db)` / `seat.text(db, v)` read the way
  `apps/server/src/backup-deletion-alert.ts:25` reads a fiscal seat.

- [ ] **Step 1: Write the failing tests** in `declaration-pages.test.ts`, with the release-folder
  fixture for 1.2.0 and a fake `kept` (the reader's database half is Task 1's; test it there, not
  again):
  - `lists earlier versions beneath the declaration` — kept 1.0.0 (2026-12-01T10:00Z) and 1.1.0
    (2027-02-03T10:00Z) and 1.2.0 (the running one): the page contains, after the download links,
    `<h2>Versiones anteriores</h2>` and two links in this order,
    `<a href="/legal/declaration/1.0.0.txt">Waitron 1.0.0</a>` and the 1.1.0 one, each followed by
    ` · en uso desde el 1 de diciembre de 2026` (resp. `3 de febrero de 2027`) — date by
    `Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" })`; 1.2.0 is not
    listed.
  - `shows no list when no earlier version is kept` — `kept` answers only the running version, and
    `kept` absent: the response body equals the body slice 3's existing case expects (assert
    equality with the no-`kept` render, not a `not.toContain`).
  - `serves an earlier version's kept text` — GET `/legal/declaration/1.0.0.txt`: 200,
    `text/plain; charset=utf-8`, `Content-Disposition: inline;
    filename="waitron-1.0.0-declaration.txt"`, body exactly the kept text.
  - `answers not found for a version it has not kept` — `/legal/declaration/9.9.9.txt`,
    `/legal/declaration/1.0.txt`, `/legal/declaration/..%2Fx.txt`, and any version with `kept`
    absent: 404 with `DECLARATION_PAGE_WORDS.es.notFoundTitle` for an `es` request; `kept.text` is
    never called for a value that is not `^\d+\.\d+\.\d+$`.
  - `still serves the running version's text` — `/legal/declaration.txt` answers as slice 3's case
    pins (that existing case, unchanged, is the check).
  - `a failed read of the kept list still shows the running declaration` — `kept().list` rejects:
    the page is 200 with the running declaration and no list, and the log has
    `declaration.kept_read_failed` with the error code.

- [ ] **Step 2: Run them; they fail** —
  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts`.

- [ ] **Step 3: Implement.** In `mountDeclarationPages`: the `/legal/declaration` handler asks
  `deps.kept?.()`, lists every kept version other than the running one, and appends the list after
  the download paragraph only when there is at least one (escape every value with `escapeHtml`). Add
  `app.get("/legal/declaration/:file", …)` before the `/legal/*` catch-all, accepting only
  `^(\d+\.\d+\.\d+)\.txt$`, otherwise the not-found page. Add `earlierTitle: "Versiones
  anteriores"` and `inUseSince: "en uso desde el"` to `DECLARATION_LINK_WORDS`. Pass the getter from
  `bootServer` (`boot.ts:1399`).

- [ ] **Step 4: The guide.** In `about.md` (EN) after the "Descargar PDF" paragraph, one sentence:
  "If they ask about invoices from an earlier version of Waitron, that version's declaration is
  listed under **Versiones anteriores**." Spanish twin in `es/about.md` with the same heading id.
  Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and from the root
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.

- [ ] **Step 5: Look at it.** Start the server from source on a scratch state folder with a
  release folder fixture as `declarationRoot` and two kept rows (or write the rendered page string
  to a file), open `/legal/declaration` with the workspace's Playwright Chromium in both themes and
  at phone width, and open one earlier version's link. Screenshots stay in the working folder,
  never committed (CLAUDE.md §6).

- [ ] **Step 6: Backlog.** In `docs/backlog/fiscal.md`'s A940 entry replace "Slices 5 (…) and 6
  (…) remain" with slice 5 landed (this PR) in one sentence of what it does, and "Slice 6
  (`@waitron/verifactu`'s own declaration) remains".

- [ ] **Step 7: Run every changed test file and commit** —
  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts src/keep-declaration.test.ts src/guide-content.test.ts`;
  `git commit -s`.

## After the tasks

`/finish-branch` on the FULL path (a migration and a cross-package seat): two Codex run-it seats
and the conventions seat. The PR's first line: "Rebuilds the fiscal-verifactu starting migration:
every venue resets." List any `CANDIDATES` addition and any whole-shape pin that gained the
`declarations` key under "Changed test checks".
