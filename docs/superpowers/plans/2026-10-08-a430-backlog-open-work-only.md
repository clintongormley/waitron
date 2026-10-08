# A430 — the backlog lists only open work, grouped by area

Status: in progress (lane C, 2026-10-08). Owner request, 2026-10-08 ~17:20, in the watcher session:
"do we really need a list of what has landed in the backlog?" (no), "try to group tasks by area, so
we can see related tasks", and "for big explanations maybe put the details in a different doc that
the backlog points to".

Before: `docs/backlog.md` at ed50b68b6 was 815,553 bytes and 9,449 lines (`wc -lc`).

This is a docs-only change. Every part but the last is a direct push to `main` (CLAUDE.md §6's docs
exemption); the last part changes the root `CLAUDE.md`, which is format-checked, and takes a small
pull request on the light path.

## What the backlog becomes

`docs/backlog.md` keeps its frame — the introduction and companion documents, _How the order is
decided_, _What to work on next_, _Coordination between tracks_, _Standing decisions_, the _What's
built_ table, _The advisor gap_, _Reference_ and _How to keep this file honest_ — and replaces Track
A, Track B, Track C, _Afterwards_ and _Detail_ with one section, **Open work, by area**, holding one
`###` heading per area.

Under an area heading, each open entry is:

```
- **<its title, as it reads today>** — <status, owner and date as it reads today>. <One to three
  lines saying what is open and why, taken from the entry's own sentences.> [Detail](backlog/<area>.md#<anchor>)
```

An entry that is already four lines or shorter stays whole in the backlog and gets no detail link.
A longer one keeps its first sentences in the backlog and moves its WHOLE text, unedited, under a
`##` heading of the same title in `docs/backlog/<area>.md`. Sentences are cut, never reworded: a
shortened sentence is a new claim (CLAUDE.md §1), and the original wording stays in the detail file.

Each area heading keeps the old area numbers it absorbed (for example "formerly A3 and B6"), so a
search for an old pointer such as "A4" still lands on it.

## The areas

Derived from the open entries (the survey of all entries is described under _How the areas were
derived_). Slug, then title, then what belongs there:

| Slug | Area | What belongs there | Open entries in the survey |
| --- | --- | --- | --- |
| `fiscal` | Fiscal records, invoices and the asesor | Veri\*Factu chain and filing, full and simplified invoices, VAT rulings, corrective invoices, fiscal reporting, items waiting on asesor questions | 40 |
| `setup` | The setup wizard, onboarding and the demo venue | the setup app, first run, CA trust, country packs as setup uses them, the demo venue and its seed | 32 |
| `catalogue` | Menus and the catalogue | products, categories, sections, menus, extras and options, variants, price overrides, the image library, content languages, sales classification, publishing | 115 |
| `service-periods` | Service periods, opening hours and departments | hours, public holidays, service periods, departments, menu timetables | 5 |
| `kitchen` | The kitchen and preparation | kitchen screens, the pass, stations, watchers, prep routing, kitchen tickets | 23 |
| `till` | The till, devices and table service | till screens, the handheld, device profiles, joining, ordering, tables and the floor plan, bills and splits, courses, counter orders, adjustments, bookings, cash handling | 80 |
| `printers` | Printers, the print agent and receipts | printer screens, discovery, Bluetooth, the print-agent process, receipt and ticket layout, the cash drawer | 56 |
| `payments` | Payments and card readers | card readers, providers, refunds, paying later | 22 |
| `dashboard` | Users, sign-in and the dashboard shell | identity, roles, permissions, sign-in, account settings, the dashboard's shared screens and `wt-*` parts (forms, tables, the design system, accessibility, live updates), the email inbox | 88 |
| `languages` | Interface languages | translating Waitron's own words (dashboard, till, setup, printouts) and the regional languages | new; from survey rows marked `?` |
| `alerts` | Alerts, logging and diagnostics | incidents, notifications, logs, the bug report | 9 |
| `workforce` | Working time and staff | clocking in and out, the working-time record, rota, shifts, swaps, the labour advisor | 8 |
| `back-office` | Purchasing, recipes, stock and reports | purchasing, suppliers, recipes, stock, reports that are not fiscal | 3 |
| `box` | The box: backups, upgrades and recovery | the USB installer, the box image, backups, upgrades and migrations, the recovery page, provisioning and build, sending email | 83 |
| `replication-cloud` | Replication, failover and the cloud | the on-prem mirror, failover, membership, the bucket stream's design, the cloud connection | 50 |
| `ci` | CI, tests and developer tooling | the CI workflow, test infrastructure, the dev stack, house rules and their guards | 62 |
| `dependencies` | Dependency upgrades | what a dependency bump left open, and receipts about pinned versions | new; split out of `ci` |
| `architecture` | Modules, data and code health | the module framework, data conventions, error codes, configuration export and import, correctness debt, names left behind by a refactor | 38 |
| `legal` | Data protection and legal compliance | RGPD, licence notices, questions for the legal advisor | new; from survey rows marked `?` |
| `later` | Later and parked | ideas with no work queued (the old _Later and parked_ list) | new |

Areas are in that order in the backlog. Each area's detail file is `docs/backlog/<slug>.md`, created
by the first push that needs it.

## What happens to each kind of entry

- **Finished, nothing left open** (LANDED/DONE/BUILT/MERGED, and "Built:" lists): deleted. The git
  log and the pull requests are the record.
- **Finished, with points left open**: each open point becomes its own short open entry in its area,
  titled from the point's own words, with the finished entry's identifier and PR named once
  ("left open by A231d part 1, #1399"). No open point is dropped.
- **Open**: moved under its area, shortened as above.
- **A standing decision or deliberate limit with no work attached**: moved to its area's detail file
  under "Decisions and deliberate limits", unless it is a product-wide rule, which goes to
  _Standing decisions_.
- **A receipt another document relies on** (step 2's list): before its entry is deleted, the
  passage moves to the topic file under `docs/developers/` that cites it (CLAUDE.md §7's split), and
  the pointer is repointed in the same push.
- Identifiers are never renumbered.

## Step 2 — pointers into the backlog

Found before anything moved; the full list is kept with the lane's campaign notes, and every
repository-tree pointer is fixed in the push that moves its target.

- **No link into the backlog carries an `#anchor`** (`grep -rn 'backlog.md#'` over the tree and the
  lane queues found none), so no anchor can break. Every link is a bare `backlog.md`; the place it
  means is named in its text.
- **Headings and items named in prose by the tree** — _Track A_, _Track C_, A1e, A231d, W41s, A2,
  A3, A4, A6, A7, B4, B6, B7, B9, _What to work on next_, _Standing decisions_, _The advisor gap_
  (its Q21 row), _Box image constraints_, _Afterwards_, _Cloud integration and SQLite work_ and
  _Replication, membership & failover — residuals_ (cited by `CLAUDE.md`,
  `docs/developers/conventions-data.md` and `apps/server/src/finish-adoption.ts`). Old area numbers
  stay findable through each area heading's "formerly …" line; a named entry or detail heading that
  is still open keeps its title, in the backlog or its detail file. A pointer in a code comment is
  left as it is (changing code takes the pull request flow); the alias keeps it true. A pointer in
  `docs/developers/` to a heading that moves is repointed in the same push.
- **Receipts other documents rely on**, each moved to the topic file that cites it before its entry
  is deleted: the Litestream checkpoint wait (A130, A133, A135; cited by
  `docs/developers/testing-guide.md` and `bench/sqlite-failover/README.md`); the Dependabot
  overrides (cited by `docs/developers/workflow-guide.md`); the coverage-bar pull request list (cited
  by `docs/developers/ci-and-gates.md`); the A220 and W87 product-editor decisions (cited by
  `docs/developers/design-system.md`); the AEAT QR-specification quote of C115 and C123 (cited by
  `docs/verifactu-findings.md`); and the owner rulings that code comments cite (C113, C114, W111,
  the A231d owner answers, A331 batch 2a, the content-languages-per-region decisions) — those stay
  in the open entry's detail when the entry is open, or move to the cited topic file when it is not.
- **Pointers already broken before this work** (their target was gone from the backlog at
  ed50b68b6) are listed with the campaign notes and reported, not fixed here: fixing them means
  editing code comments or other topic files' claims, which is outside this item.
- **The lane queues and runbooks** are never edited by this work; what they point at is reported to
  the watcher.

## The order of the pushes

Each push takes one old section (or one slice of a long one), deletes its finished entries, moves
its open entries under their area headings and their detail into the area files, and fixes every
pointer into what it moved. Each is rebased on `origin/main` immediately before it is pushed; if a
rebase conflicts on an entry another lane has just changed, their change is kept and this push's
move is re-applied to it.

1. This plan, and the empty **Open work, by area** section with its area headings.
2. Track B, B1 to B8.
3. B9 up to the comment-pruning entry.
4. B9's comment-pruning entry ("Prune the comments, one package per pull request"), whose
   leftovers cover nearly every area — split by area.
5. The rest of B9.
6. Track C.
7. _Afterwards_ and _Cloud connection integration_.
8. _Detail_, and the stray finished entry after _How to keep this file honest_.
9. A1 to W41s (the fiscal group).
10. A2 (the setup wizard heading, which also holds many catalogue and dashboard entries), in two
    halves.
11. A3.
12. A4, in two halves (the service plan's tasks; then the rest).
13. A5 and A6.
14. A7.
15. A8 and A9.
16. A10 and Track A's opening part, in three slices.
17. The frame: the introduction, area names in _What to work on next_ and _Reference_, _How to keep
    this file honest_, and the _What's built_ rows that restate a deleted entry.
18. The rule in `CLAUDE.md` §6 "Docs", and `CLAUDE.md`'s pointer to the replication residuals —
    a small pull request on the light path, with `scripts/claude-md-pointers.test.ts` and the root
    guard suite run on it.

Split a push further whenever it would grow past what can be rebased cleanly; the order is a
default, not a contract.

## Checks for every push

- No link from `docs/backlog.md` into `docs/backlog/*.md`, and none from anywhere in the tree into
  either, points at a heading that does not exist (a local link checker run before each push; its
  output is in the push's commit message as a count).
- Every open entry of the section moved is present in its area, by title (a count before and after,
  in the commit message).
- `docs/` is ignored by prettier as a whole, so `prettier --check` proves nothing there (CLAUDE.md
  §2); the link checker and the counts are the checks.

## Done when

No entry in `docs/backlog.md` is marked landed, done, built or merged (`grep` shows it); every open
entry sits under an area; every link into the backlog or a detail file resolves; CLAUDE.md §6
"Docs" says how the backlog is kept; and the last push's message gives the size before and after.

## How the areas were derived

Four read-only passes classified every entry of `docs/backlog.md` at ed50b68b6, by line range,
into open, finished, finished-with-open-points, a "Built:" list, a decision, or frame, with an area
each. Lines by class (entries counted once): open 3,972; finished with open points 3,256; finished
972; "Built:" lists 78; decisions 228; frame 407. So deleting the finished entries alone frees only
about a ninth of the file (1,050 of 9,449 lines); most of the saving comes from moving long open entries' explanations
into the detail files, and from cutting the finished parts out of entries that also hold open
points. The passes also found that the old area headings do not sort the file by subject — many
catalogue and dashboard entries sit under A2 (the setup wizard), and device, payment and
content-language entries under A3 (printers) — so every push assigns entries one by one, by subject.
Four areas were added to the draft list because recurring subjects fitted none of it: interface
languages, legal compliance, dependency upgrades and _Later and parked_; the demo venue joined
`setup`.
