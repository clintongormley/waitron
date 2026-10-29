# A1131b/c slice 1: Start again's words without counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch each task as `subagent_type: "implementer"`.

**Goal:** The repair page's Start again confirmation stops showing how many rows the setup database
holds and shows the design's two sentences instead ("Start again deletes what was entered in the
setup that stopped part way. No invoice was sent to AEAT."), with the second sentence only where the
box read the database and found no invoice; the user guide pair loses its "says how many" line.

**Architecture:** A setup-page change only (strings, one render block, their browser tests) plus
the user guide pair. The server's Start again summary, its `held` counts, the confirmation the
page sends back and the confirmation record on disk are **not** changed in this slice (boundary
below). No migration. Nothing in `packages/fiscal-verifactu`, `packages/provisioning` or
`apps/server/src/*.ts`.

**Tech Stack:** Lit (setup app), Vitest 4 browser mode (real headless Chromium through
`@vitest/browser-playwright`, `apps/setup/vitest.config.ts:31-36`), Markdown guides served by the
server.

**Spec:** `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` — §9a for the
words, "Slices" item 1 for the scope. Mock-up: `docs/backlog/mockups/a1131bc-restore/1-start-again.png`
(and `-dark`, `-es`).

**Worktree / branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131bc-1-start-again-words`,
`feat/a1131bc-1-start-again-words`. Keep a ledger at `docs/handoffs/2026-10-29-a1131bc-slice1.md`
(gitignored) and update it after each task.

## Global Constraints

- Exact words, from spec §9a and §9b (§9b's help line is pulled forward because picture 1 shows it;
  see decision D3):
  - `heldLost` EN `Start again deletes what was entered in the setup that stopped part way.`
  - `heldLost` ES `Empezar de nuevo borra lo que se introdujo en la configuración que se detuvo a medias.`
  - `noInvoiceSent` EN `No invoice was sent to AEAT.`
  - `noInvoiceSent` ES `No se envió ninguna factura a la AEAT.`
  - `startAgainHelp` EN `This box will not use this setup's invoice series names again.`
  - `startAgainHelp` ES `Este equipo no volverá a usar los nombres de serie de facturas de esta configuración.`
- Spanish appears only in `apps/setup/src/screens/initial-owner-strings.ts` and
  `apps/server/src/guide/es/` (CLAUDE.md §3, English-only rule).
- Every guide change is made in English and Spanish; section headings and their `{#id}`s are not
  touched.
- No server, provisioning or wire change; no migration; no file in `packages/fiscal-verifactu`.
- TDD: each behaviour test is written first and seen failing. Tests whose **words** change by
  design are listed in "Tests edited by design"; any other test that fails is a STOP — report it,
  do not edit it.
- Commits: `git commit -s`, plain-English messages. Do not push; `/finish-branch` does that.
- Browser runs: check `memory_pressure | grep free` first; run beside another browser run only
  well above 15% free. Prefix every Vitest run with `env -u AI_AGENT -u CLAUDECODE` and read the
  `Tests` count, never the exit status alone.

## Current behaviour (read, not run, unless marked)

- The confirmation's count block is `heldBlock` (`apps/setup/src/setup-app.ts:2636-2641`): the rows
  line (`heldRowsLine`, `:2634-2635`), then `heldNoInvoices`/`heldNoInvoicesOne`, then the old
  `heldLost`. It is drawn only when the database is present and the summary carries `held`
  (`:2715`). Words: `initial-owner-strings.ts:56-61` (EN) and `:148-154` (ES).
- The refusal block `heldRefused` (`setup-app.ts:2642-2657`) is chosen when `held.kept > 0 ||
  held.records > 0` (`:2700-2701`). It draws the same rows line first, then `heldKept…`, then
  `heldInvoice…` with `{accepted}`, then `heldFault`. Its second and third lines lean on the first
  for their subject: "It holds {kept} items…", "{records} of them are invoices…"
  (`initial-owner-strings.ts:61-65`).
- The summary's `held` is built by the server only in the "held" state — database present and
  holding rows, beside a stopped recovery (`assertHeldStartAgainOffered`,
  `apps/server/src/first-setup-resolution.ts:95-109`; summary at `:463-493`). The summary route
  returns the counts even when they would refuse; only the Start again route refuses
  `kept-records` (`:567`).
- The counts travel further than the page: the page sends the summary back as
  `confirmRecoveryDiscard.shown`, the server rebuilds it and compares with `isDeepStrictEqual`
  (`first-setup-resolution.ts:636-653`), the route parser demands exactly the four keys
  (`apps/server/src/setup-first-fiscal-api.ts:129-142`), the confirmation record's reader demands
  them too (`packages/provisioning/src/first-setup-start-again-confirmation.ts:139`, `:195`), and the
  page's session refuses a summary whose counts changed between display and confirmation
  (`apps/setup/src/first-setup-session.ts:107-124`, tested in
  `apps/setup/src/first-setup-retirement.test.ts:249-264`).
- What "the box read the database and found no invoice" is, today:
  - `held` present in the offered branch: `readSetupDatabaseHoldings` read the database and
    `records` (invoice records counted by each module's `startAgainHoldings`,
    `packages/module/src/initial-setup.ts:95-101`) and `kept` are both 0 — the refused branch at
    `setup-app.ts:2700` takes every other `held`.
  - `inspection.emptyDatabase === true`: the inspection opened the database and found every table
    accounted for and empty (`packages/provisioning/src/first-setup-resolution-inspection.ts:85-97`,
    `packages/provisioning/src/first-setup-empty-database.ts:14-106`; `registros_facturacion` is in
    the manifest, `packages/migrations/migrations.manifest.json:85`).
  - Every other database-present confirmation is unreachable today: Start again is enabled for a
    present database only when `inspection.emptyDatabase` or a stopped recovery beside a held
    database (`setup-app.ts:2572-2580`; `ask` exists only with the database missing, `:2535`), and
    the session refuses a held summary without `held` (`first-setup-session.ts:788`).
- The missing-database confirmation shows `missingDatabase` at the top (`setup-app.ts:2745`) and
  the tick `missingConfirm` ("Nothing was filed to AEAT and nothing was sold.", `:2729`); it never
  draws `heldBlock`.
- `startAgainHelp` is drawn in every confirmation (`setup-app.ts:2717`), missing database included.
- User guide count line: EN `apps/server/src/guide/en/backup-recovery.md:33-34` ("If the setup's
  database already holds saved items, it also says how many, and that none is an invoice."), ES
  `apps/server/src/guide/es/backup-recovery.md:35-36` ("…también dice cuántos, y que ninguno es una
  factura."). `rg -n -i "saved item|how many|cuántos"` over `apps/server/src/guide`, `docs/operations`
  and `deploy/README.md` found no other count line about the setup database (run 2026-10-29).
- Guide files are formatted by Prettier: `pnpm exec prettier --file-info
  apps/server/src/guide/en/backup-recovery.md` printed `"ignored": false` (run 2026-10-29).

## Decisions and the boundary with slice 2

- **D1 — the summary keeps all four counts (`rows`, `kept`, `records`, `accepted`) in slice 1.**
  Dropping any of them is a cross-package contract change (server parser, deep-equal check,
  provisioning record reader, page session — all cited above), which is a risk trigger and slice
  2's job, done together with moving the refusal decision to the server. Dropping only `rows` would
  also break the refusal block's sentences, whose subjects come from the rows line. So in slice 1
  the counts still travel and are still stored in the confirmation record; they just stop being
  **shown** in the offered confirmation. "The summary stops carrying counts" from the spec's slice
  list therefore lands in slice 2. The confirmation record on disk is not shown to anyone, so
  keeping counts in it makes no shown sentence false.
- **D2 — the refused block (`heldRefused`) is untouched in slice 1**, rows line included, so
  `heldRows`, `heldRowsOne`, `heldKept`, `heldKeptOne`, `heldInvoices`, `heldInvoiceOne`,
  `heldFault`, `heldChanged` and `startUnavailable*` all stay. Slice 2 replaces them with §9c's
  `keptFault`/`wipeUnavailable` and sends the counts to the log line. Slice 1 deletes only
  `heldNoInvoices` and `heldNoInvoicesOne` and replaces the value of `heldLost`.
- **D3 — `startAgainHelp` takes §9b's help-line words in this slice.** Picture 1 shows them under
  the new sentence; keeping today's "Deletes this attempt. …" would say "deletes" twice in a row.
  The key is kept, so every test that finds the help line by key keeps working.
- **D4 — where the sentences show.** One paragraph `<p data-test="start-again-deletes">` replaces
  `heldBlock` at its position (`setup-app.ts:2715`: after the damaged-record lines, before the
  stopped-recovery block and the help line) in **every** confirmation, missing database included.
  Its text is `heldLost`, followed by a space and `noInvoiceSent` only when
  `!missing && (held !== undefined || this.firstInspection?.emptyDatabase === true)`. Reading of
  §9a's last sentence: with the database missing, the missing-database words and the "Nothing was
  filed…" tick stand **instead of the second sentence**; the first sentence still shows there, so
  the missing confirmation still says Start again deletes something after D3 removes "Deletes this
  attempt" from the help line. (The other reading — no new paragraph at all with the database
  missing — would leave that confirmation saying nothing about deletion; flagged for the plan
  review.)
- **Not in this slice:** the password removal, §9b, §9c, §9d, the `heldChanged` rewording, the
  server and every doc that describes the password (slice 2 lists them).

## Tests edited by design (the PR description must name each)

| File:line (today) | Old expectation | New expectation | Why |
| --- | --- | --- | --- |
| `apps/setup/src/setup-app-resolution.test.ts:120-128` | `startAgainHelp` is "Deletes this attempt. This box will not use its invoice series names again." | the §9b help line; plus the new keys' EN words (`retireConfirmed`, `restarting` assertions kept) | D3 |
| `setup-app-resolution.test.ts:1976-1977` (`heldLines`) and `:1995-1999` | held lines `[heldRows 105, heldNoInvoices, heldLost]` | `start-again-deletes` text is `${heldLost} ${noInvoiceSent}`; the page contains neither `105` nor the `heldRows` sentence | §9a: no counts |
| `setup-app-resolution.test.ts:2004` | order starts at `held-database` | order starts at `start-again-deletes` | element renamed |
| `setup-app-resolution.test.ts:2032-2047` | singular words `[heldRowsOne, heldNoInvoicesOne, heldLost]`; title "says so in the singular" | same two sentences as the 105 case, and no `heldRowsOne` text; title says the words carry no count | §9a |
| `setup-app-resolution.test.ts:2049-2055` | "an empty setup database beside a stopped recovery draws no held lines" (`held-database` absent) | the same case draws `start-again-deletes` with both sentences (inspection `emptyDatabase: true`) | D4 |
| `apps/setup/src/setup-app-held-refusals.test.ts:54-61` (`expectNoHeldConfirmation`) | no `held-database`; none of `heldNoInvoices`, `heldNoInvoicesOne`, old `heldLost` | no `start-again-deletes`; neither `heldLost` nor `noInvoiceSent` text | keys removed/replaced; same intent: a refusal shows no confirmation |
| `apps/setup/src/setup-app-held-database.a11y.test.ts:83` | polls `held-database` | polls `start-again-deletes` | element renamed |
| `apps/setup/src/setup-app-missing-database.test.ts:512-516` | `confirmationLines(app).slice(-3)` = `[seriesPicksDamaged, startAgainHelp, namesFrom]` | `.slice(-4)` = `[seriesPicksDamaged, heldLost, startAgainHelp, namesFrom]` | D4 adds a line before the help |
| `setup-app-missing-database.test.ts:547-552` | `.slice(-4)` = `[recoveryRecordDamaged, seriesPicksDamaged, startAgainHelp, namesFrom]` | `.slice(-5)` with `heldLost` before `startAgainHelp` | D4 |

Behavioural assertions in those tests that are **not** about words stay exactly as they are:
Start again enabled/disabled, element order, the request body (`confirmRecoveryDiscard: { shown:
heldSummary(105) }` — the counts still travel, D1), the restarting status, refusal lines in
`setup-app-held-refusals.test.ts` (they still show counts, D2), and every `requests` check.

## Review Focus

1. **Missing database:** the page must not say "No invoice was sent to AEAT" — the box never read
   a database. Pinned by Task 1's missing-database test.
2. **A held database that would be refused** (kept or invoice rows) must still show the refusal
   with its counts and no `start-again-deletes` paragraph. Pinned by the edited
   `expectNoHeldConfirmation`.
3. **The confirmation still sends the summary with its counts unchanged**, or the server refuses
   with `setup.attempt_conflict`. Pinned by the kept request-body assertion in the 105 test.
4. **Spanish at phone width:** the longer Spanish sentence wraps inside 390 px in both themes.
   Pinned by the held and resolution a11y suites' `scrollWidth` checks and the look check (Task 2).
5. **`heldChanged` still says "Enter the password again to see what it holds now."** After this
   slice the offered confirmation no longer lists what the database holds, only that no invoice was
   sent; the refused one still does. Not changed here (slice 2 rewrites it, §9c); the reviewer
   should judge whether the sentence still reads true and say so in the PR.

---

### Task 1: The confirmation's words, without counts

**Files:**
- Modify: `apps/setup/src/screens/initial-owner-strings.ts` (EN `:42`, `:58-61`; ES `:132-133`, `:150-153`)
- Modify: `apps/setup/src/setup-app.ts:2633-2641` (drop `heldBlock`, keep `heldRowsLine`), `:2715`
- Test: `apps/setup/src/setup-app-resolution.test.ts`, `apps/setup/src/setup-app-missing-database.test.ts`,
  `apps/setup/src/setup-app-held-refusals.test.ts`, `apps/setup/src/setup-app-held-database.a11y.test.ts`

**Interfaces:**
- Produces: string keys `heldLost` (new value), `noInvoiceSent` (new), `startAgainHelp` (new value)
  in both locales; keys `heldNoInvoices`, `heldNoInvoicesOne` removed; `data-test="start-again-deletes"`
  on the new paragraph. Task 2's look flag polls `start-again-deletes`.

- [ ] **Step 1: Write the failing tests**

  In `setup-app-resolution.test.ts`, replace the test at `:120-128` with
  `"Start again's confirmation words are the design's, in English and Spanish"`: assert the six
  literals of Global Constraints against `initialOwnerStrings.{en,es}.{heldLost,noInvoiceSent,startAgainHelp}`,
  `expect(Object.hasOwn(initialOwnerStrings.en, "heldNoInvoices")).toBe(false)` (and `…One`, both
  locales), and keep the existing `retireConfirmed` and `restarting` assertions unchanged.

  Add `it.each(["en-GB", "es-ES"])("with an empty setup database, the confirmation says what Start again deletes and that no invoice was sent, above the help line, in %s")`
  using `mount()` (inspection `no-venue-rows`, `emptyDatabase: true`): after pressing Start again,
  `q(app, "start-again-deletes").textContent!.trim()` is `` `${t.heldLost} ${t.noInvoiceSent}` ``,
  and it precedes the help paragraph (`p.textContent === t.startAgainHelp`), which precedes
  `retire-confirmed`.

  In `setup-app-missing-database.test.ts`, add `it.each(locales)("with the database missing, the confirmation says what Start again deletes but not that no invoice was sent ($locale)")`
  on the plain missing-database confirmation (`missingDatabaseFixture`, `recoverMissing`, then
  Start again, as the file's `damagedConfirmation(browser, namedSummary)` helper does, `:439-444`): the
  paragraph's text is exactly `t.heldLost`; the shadow root's text contains neither
  `t.noInvoiceSent` nor (EN) "No invoice"; `missing-database` still reads `t.missingDatabase`; the
  tick's label is still `t.missingConfirm`.

  Apply every edit in "Tests edited by design" now, with the new expectations.

- [ ] **Step 2: Run them and watch them fail**

  ```
  env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run \
    src/setup-app-resolution.test.ts src/setup-app-missing-database.test.ts \
    src/setup-app-held-refusals.test.ts src/setup-app-held-database.a11y.test.ts
  ```
  Expected: the new and edited cases FAIL (old literal, no `start-again-deletes` element,
  `noInvoiceSent` read as `undefined` — Vitest does not typecheck); every other case passes. Write the failing case names into the ledger.

- [ ] **Step 3: Implement**

  Strings: set `heldLost` and `startAgainHelp` to the new words, add `noInvoiceSent`, delete
  `heldNoInvoices` and `heldNoInvoicesOne`, in both locales; leave every other key alone (D2).

  `setup-app.ts`: delete `heldBlock`; compute
  `const noInvoiceFound = !missing && (held !== undefined || this.firstInspection?.emptyDatabase === true);`
  and, at `:2715`, draw
  `<p data-test="start-again-deletes">${noInvoiceFound ? `${t.heldLost} ${t.noInvoiceSent}` : t.heldLost}</p>`
  unconditionally (the confirmation branch already excludes the refused case). One line of comment
  at `noInvoiceFound` is warranted, because the code cannot show it: a `held` reaching this branch
  has no kept or invoice rows — the refused branch above takes the rest.

- [ ] **Step 4: Run them and watch them pass**

  Same command as Step 2. Expected: every case passes; read the `Tests` count. Then
  `pnpm --filter @waitron/setup typecheck` and `pnpm --filter @waitron/setup lint`, both clean.
  Also run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run
  src/setup-app-resolution.a11y.test.ts src/setup-app-missing-database.a11y.test.ts
  src/first-setup-retirement.test.ts` — unedited, all must pass. Any failure outside "Tests edited
  by design" is a STOP.

- [ ] **Step 5: Commit**

  ```
  git add apps/setup/src/screens/initial-owner-strings.ts apps/setup/src/setup-app.ts \
    apps/setup/src/setup-app-resolution.test.ts apps/setup/src/setup-app-missing-database.test.ts \
    apps/setup/src/setup-app-held-refusals.test.ts apps/setup/src/setup-app-held-database.a11y.test.ts
  git commit -s
  ```
  The message names each test edited by design and why (the table above).

### Task 2: The user guide's count line, the look check, and the guards

**Files:**
- Modify: `apps/server/src/guide/en/backup-recovery.md:33-34`, `apps/server/src/guide/es/backup-recovery.md:35-36`
- Modify: `apps/setup/src/setup-app-held-database.a11y.test.ts` (a look flag beside the a11y check)

**Interfaces:**
- Consumes: `data-test="start-again-deletes"` from Task 1.

- [ ] **Step 1: Guide pair.** EN: replace "it also says how many, and that none is an invoice." with
  "it also says that no invoice was sent to AEAT." ES: replace "también dice cuántos, y que ninguno
  es una factura." with "también dice que no se envió ninguna factura a la AEAT." Change nothing else
  in either file: the password sentences around them are slice 2's. Run
  `pnpm exec prettier --write` on both files. (No failing-test step: no test reads guide prose;
  the guide suites below guard structure and links.)

- [ ] **Step 2: Look flag.** In `setup-app-held-database.a11y.test.ts`, after the existing
  `scrollWidth` check of the `"offered"/"confirmation"` loop, add the same guarded screenshot its
  siblings use (`setup-app-resolution.a11y.test.ts:75-78`):
  `if (import.meta.env.VITE_A1131BC_HELD_LOOK === "1") await page.screenshot({ path: `__screenshots__/a1131bc-held/${locale}-${theme}-${width}-${state}.png` });`

- [ ] **Step 3: Take the shots and LOOK.** Check memory first. Run, one at a time:
  ```
  env -u AI_AGENT -u CLAUDECODE VITE_A1131BC_HELD_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-held-database.a11y.test.ts -t confirmation
  env -u AI_AGENT -u CLAUDECODE VITE_A679_RESOLUTION_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.a11y.test.ts -t confirmation
  env -u AI_AGENT -u CLAUDECODE VITE_A679_MISSING_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-missing-database.a11y.test.ts -t confirmation
  ```
  Find the files (`find apps/setup -path '*__screenshots__*' \( -path '*a1131bc-held*' -o -path '*a679-interruption*' -o -path '*a679-missing*' \) -name '*confirmation*.png' -newer apps/setup/src/setup-app.ts`),
  copy them to `~/waitron-campaign/a1131bc-1-shots/`, and open at least, for each of the three
  states: EN light 390, EN dark 390, ES light 390, ES dark 390 and EN light 1280. What passes: the
  new paragraph sits above the help line, wraps inside the card at 390 px, is legible in dark, shows
  both sentences in the held and empty cases and only the first in the missing case, and no count
  appears anywhere. Compare with `docs/backlog/mockups/a1131bc-restore/1-start-again*.png`. Write
  what was looked at, and what was seen, into the ledger and later the PR description.
  `__screenshots__/` is gitignored (`.gitignore:20`); never commit a shot.

- [ ] **Step 4: Guards.**
  ```
  env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-backup-recovery.test.ts
  env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts
  pnpm format:check
  ```
  (from the worktree root). Expected: all pass, `Tests` counts read; `format:check` prints no
  file. `scripts/claude-md-pointers.test.ts` is not needed: `CLAUDE.md` does not change.

- [ ] **Step 5: Commit**
  ```
  git add apps/server/src/guide/en/backup-recovery.md apps/server/src/guide/es/backup-recovery.md \
    apps/setup/src/setup-app-held-database.a11y.test.ts
  git commit -s
  ```

## After the tasks

Light path (spec: "Light review"; no risk trigger — no server, wire, fiscal or migration change):
no per-task reviewer. Then `/finish-branch` with the worktree path and this plan; its run-it seat
and plan-vs-spec read still run. The PR description carries: the boundary decisions D1-D4, the
"Tests edited by design" table, the look-check list, and Review Focus item 5 as an open point.
Before the PR, update `docs/backlog.md` only if an entry says slice 1 is pending (grep `A1131`).
