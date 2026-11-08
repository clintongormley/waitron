# A1308 menu and photos, PR mn9: the preselected option as a flag, and the lists' small checks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** The label preselected in an options list becomes `option_labels.is_default` (at most one per
list, held by a partial unique index) instead of an unchecked id on the list; an extras list can no
longer store a maximum of 0; and options lists, their labels and extras lists can no longer store a
blank name — each refused by the database and, on every write path, by a domain error first.

**Architecture:** Schema changes to three small tables. The API and the menu document keep their
`defaultLabelId` field: it is read from the flagged label and written by setting the flag. The
configuration import refuses a bad stored row with `setup.request_invalid` naming its field, before
the database would.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R4, "Additions of 6
November 2026" (rows for `option_lists`, `option_labels`, `extra_lists`);
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.9, §1.10, §1.11, §5
(`option_lists` "gains `option_labels_one_default_uq`"); [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names. Batch 1 and
mn1–mn8 have landed. Backlog entries are named by their text at `a086eedfb7` (mn3 changed
"catalogue" to "menu"; the file is `docs/backlog/menu.md`). A missing identifier this plan does not
explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6). An option label is a kitchen instruction, not a priced thing
(`packages/db/src/schema/menu/options.ts:4-5`).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **`option_labels.is_default`**, flag not null default 0, and `option_labels_one_default_uq`: unique
   on `option_labels(list_id) where is_default = 1`. `option_lists.default_label_id` goes
   (`packages/db/src/schema/menu/options.ts:12-18`).
   - Write: `writeLabels` (`packages/menu/src/options.ts:169-220`) first clears the list's flags
     (`update option_labels set is_default = 0 where list_id = ?`), then writes each label with
     `isDefault: label.id === input.defaultLabelId`. Clearing first matters: updating labels one at a
     time could hold two flagged rows for a moment, which the index refuses although the final state
     is fine (CLAUDE.md §3, "Rewriting rows one at a time … can break a unique index").
     `listValues` (`:153`) stops writing `defaultLabelId`. The label insert's
     `.onConflictDoNothing()` (`options.ts:213-216`), whose empty result is read as "this id is
     another list's label" (`options.invalid { field: "labels.<i>.id" }`, `:217`), names its target:
     `.onConflictDoNothing({ target: optionLabels.id })`. Untargeted, it would also swallow a clash
     on the new `option_labels_one_default_uq` and report it as a bad label id (CLAUDE.md §3, "An
     untargeted `.onConflictDoNothing()` absorbs EVERY unique conflict"); clearing the flags first
     means a clash there is a bug, which must surface as the constraint error, not be relabelled.
   - Read: `listColumns.defaultLabelId` (`options.ts:32`) becomes the id of a left-joined alias of
     `option_labels` on `list_id = option_lists.id and is_default = 1` — a join, not a correlated
     subquery (CLAUDE.md §3, "A `sql` scalar subquery correlated to the OUTER query's table breaks
     silently"). `listOptionLists`, `readOptionListsByIds`, `getOptionList` (`:72-120`) use it.
   - `parseOptionListInput` (`packages/menu/src/option-contract.ts:64-104`) and
     `effectiveDefaultLabelId` (`option-default.ts:3`) are unchanged: the parser still refuses an id
     naming no label of the list.
   - The menu document, the till and `offered-modifiers.ts:293-294` read `defaultLabelId` as today.
   - Configuration export: `option_lists` loses `references: ["default_label_id"]`
     (`packages/menu/src/configuration-transfer.ts:220`); `option_labels` carries `is_default`. That
     was the only `references:` entry in any configuration transfer (`git grep -n "references: \[" -- packages apps`
     at `a086eedfb7` finds it alone among non-test files). The mechanism stays (decision D1). The
     import check refuses two flagged labels in one list with `setup.request_invalid { field: "option_labels.is_default" }`.
2. **No maximum of 0.** `extra_lists_picks_ck` (`packages/db/src/schema/menu/extras.ts:31-34`) becomes
   `min_picks >= 0 and (max_picks is null or (max_picks >= 1 and max_picks >= min_picks))`. The parser
   already refuses 0 (`extras.ts:28-30` comment; `packages/menu/src/extra-contract.ts`). The import
   check refuses a stored 0 with `setup.request_invalid { field: "extra_lists.max_picks" }` (today
   transfer copies stored lists without the request check, `docs/backlog/menu.md`, today
   `catalogue.md:497-502`).
3. **No blank name.** CHECKs `option_lists_name_ck`, `option_labels_name_ck`, `extra_lists_name_ck`:
   `trim(name) <> ''`, the form of `menu_periods_name_ck`. The parsers already refuse a blank staff
   name (`option-contract.ts:26`, `:75`, `:91`; `extra-contract.ts:36`, `:125`); the import check
   refuses `option_lists.name`, `option_labels.name`, `extra_lists.name`. Any other write path that
   inserts these rows outside the parsers (the demo seed `apps/server/scripts/demo-seed/seed-option-lists.ts`,
   `seed-extra-lists.ts`; find with `git grep -n -E "insert\\((optionLists|optionLabels|extraLists)\\)" -- apps packages ':!*.test.ts'`)
   goes through the parser or writes non-blank names; any production path that does not is a stop.
4. **Backlog** (rules §9): from `docs/backlog/architecture.md`'s bundle delete "A product's name can be
   stored blank" (mn6 narrowed it to these three tables) and "Loose ends left by A263 (#1151)"
   (`:1196-1197`); in `docs/backlog/menu.md` (today `catalogue.md:495-512`) delete the first bullet
   ("The database still accepts a maximum of 0") and add one line back to `docs/backlog.md`'s "Menus and
   the catalogue" list pointing at that section for the two bullets that are not A1308's.
5. The bundle format moves on by one.

## Decisions this plan makes

- **D1. The `references` declaration stays; its guard's proof becomes synthetic.** After this PR no
  real transfer table declares `references`, so R5 would retire it if nothing else needed it. dv0
  builds on it: its guard learns to refuse an `_ids` column declared only in `references`
  ([dv0](2026-11-08-a1308-dv0-json-list-references.md), decision 5 and Task 4 step 3), so the mechanism
  is planned work, not dead code (R5: "built and sound stays … unless planned work will change it").
  The guard's proof by deletion (`scripts/id-columns-are-references.test.ts:107-115`, an `it.each`
  over `["option_lists", "option_lists.default_label_id"]`) can no longer use a real table. It becomes
  one case on a synthetic schema, in the style the guard's other synthetic cases and dv0's use: a
  transferred table `zz_owners` with a column `target_ref` holding another row's id and no foreign
  key; declared in `references`, `unrewrittenIdColumns` reports nothing; with the declaration removed,
  it reports `["zz_owners.target_ref"]`. The real-schema case at `:103-105` keeps its assertion
  (`toEqual([])`).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| A884, deleting a list leaves it on published menus until republished | its backlog entry; no table change |
| "Extras list forms" bundle | its bundle |

## Files

- Schema: `packages/db/src/schema/menu/options.ts`, `extras.ts`
- Menu package: `options.ts`, `configuration-transfer.ts`
- Regenerated: core's `drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (unique indexes from `:377`: add
  `option_labels_one_default_uq`; CHECKs from `:527`: add the three name CHECKs; `extra_lists_picks_ck`
  stays listed by name), `packages/db/src/schema/menu/migrations.test.ts` (pinned CHECK text of
  `extra_lists_picks_ck`), `scripts/id-columns-are-references.test.ts` (its proof-by-deletion case at
  `:107-115` names `option_lists.default_label_id`; replaced by a synthetic one, D1)
- Tests: `packages/menu/src/options.test.ts`, `options.concurrency.test.ts`, `option-contract.test.ts`,
  `extras.test.ts`, `extra-contract.test.ts`, `configuration-transfer.test.ts`,
  `offered-modifiers.test.ts`; the Madrid baseline
- Docs: `docs/developers/modifiers.md` where it says the preselected label is an id on the list
  (find with `git grep -n -i -e default_label_id -e defaultLabelId -- docs/developers`); backlog files

## Size

| | Code | Tests |
| --- | --- | --- |
| `is_default`: schema, write, read, import check, targeted conflict | 65 | 130 |
| Guard's synthetic proof | — | 25 |
| Max 0: CHECK, import check | 15 | 40 |
| Blank names: three CHECKs, import checks | 25 | 70 |
| Format, Madrid transform, docs, backlog | 30 | 30 |
| **Counted** | **135** | **295** |

About 430 counted lines. About 2 hours.

## Finish line

1. `pnpm --filter @waitron/db exec vitest run src/schema/menu/migrations.test.ts` passes, including
   "refuses a second preselected label in one list", "refuses an extras maximum of 0" and "refuses a
   blank list or label name".
2. `pnpm --filter @waitron/menu exec vitest run src/options.test.ts src/options.concurrency.test.ts src/configuration-transfer.test.ts`
   passes, including "moves the preselected label within one save" and "refuses an imported maximum of 0".
3. `git grep -n -E "default_label_id|optionLists\\.defaultLabelId" -- apps packages scripts` prints
   only the captured fixtures.
4. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
extra index option_labels_one_default_uq
missing table option_lists.columns[default_label_id]
changed table option_lists.columnOrder
old: [<base order>]
new: [<without default_label_id>]
extra table option_lists.checks[option_lists_name_ck]
extra table option_labels.columns[is_default]
changed table option_labels.columnOrder
old: [<base order>]
new: [<with is_default>]
extra table option_labels.checks[option_labels_name_ck]
changed table extra_lists.checks[extra_lists_picks_ck].expression
old: <min_picks >= 0 and (max_picks is null or max_picks >= min_picks)>
new: <min_picks >= 0 and (max_picks is null or (max_picks >= 1 and max_picks >= min_picks))>
extra table extra_lists.checks[extra_lists_name_ck]
```

In the two `change-feed` entries, also:

```text
changed trigger waitron_change_option_lists_update.when
old: <naming default_label_id>
new: <without it>
changed trigger waitron_change_option_labels_update.when
old: <base comparison>
new: <with is_default>
```

Why: tables-menu.md §5, "option_lists: (none; `default_label_id` unchecked) → gains
`option_labels_one_default_uq`"; README "Additions of 6 November 2026" for the four CHECKs (the
products one landed in mn6). `extra_lists`' columns do not change, so its change-feed trigger does not.

## Stop points (beyond rules §5)

1. A production path inserts or updates one of the three tables without its parser (item 3).
2. A seeded or fixture list has two labels that would both be flagged, or a stored maximum of 0:
   fix a fixture to what a save would write; a seed that writes it is a stop.

## Needs

- **Outside this area:** batch 1.
- **In this area:** mn3 (names). It touches no table mn4–mn8 changed and may be built any time after
  mn3 if the lane wants a small pull request between larger ones.

## Global Constraints

- Rules §1–§9; core rebuilt.
- Each new CHECK and the index: refusal case and legitimate-write case (rules §4).

## Review Focus

1. **Moving the preselected label within one save never trips the index** (clear first).
2. **The parser, not the database, gives the field** for every request; the database is the backstop.
3. **An import with a bad stored row is refused with a field**, never a raw constraint error.

---

### Task 1: The preselected label as a flag

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:**
  - `migrations.test.ts` (raw SQL): `"refuses a second preselected label in one list"`
    (`UNIQUE constraint failed: option_labels.list_id`); controls: one flagged label each in two lists;
    many unflagged labels in one list.
  - `options.test.ts` `"moves the preselected label within one save"`: a list with labels A (default)
    and B; `updateOptionList` with `defaultLabelId: B` succeeds; `getOptionList` answers B; exactly one
    flagged row. `"clears the preselected label"`: `defaultLabelId: null` leaves none flagged.
  - The existing cases that read `defaultLabelId` back keep their expected values; the
    `option-default.ts` cases stay as they are.
  - `options.test.ts` `"still refuses another list's label id"`: an update naming a label id that
    belongs to another list answers `options.invalid { field: "labels.0.id" }`, as today (the
    targeted conflict keeps this refusal).
  - `scripts/id-columns-are-references.test.ts`: replace the `option_lists` proof by deletion with the
    synthetic case D1 describes; run `pnpm exec vitest run scripts/id-columns-are-references.test.ts`
    — PASS (the guard change is listed in the pull request description).
- [ ] **Step 3–5:** Run (fail), implement item 1, rebuild core, run (pass). **Commit.**

### Task 2: The extras maximum and the blank names

- [ ] **Step 1: Failing cases:**
  - `migrations.test.ts`: `"refuses an extras maximum of 0"` (`extra_lists_picks_ck` with `min 0,
    max 0`; controls `max null`, `max 1`, `min 2 max 2`); `"refuses a blank list or label name"` for
    each of the three tables (`''`, `'  '`; control `'Punto'`).
  - `configuration-transfer.test.ts`: `"refuses an imported maximum of 0"`,
    `"refuses an imported blank name"` (each of the three fields), `"refuses two preselected labels
    in one imported list"`.
- [ ] **Step 2–4:** Run (fail), implement items 2–3, rebuild core, run (pass). **Commit.**

### Task 3: Export, Madrid baseline, backlog, finish

- [ ] **Step 1:** Bundle format on by one; refusal row at `apps/server/src/configuration-import.test.ts:204`.
- [ ] **Step 2: Madrid baseline:** for each captured list with a `default_label_id`, set that label's
  `is_default` to 1 and every other label's to 0; drop the column. One helper, one test.
- [ ] **Step 3:** Backlog (item 4), docs.
- [ ] **Step 4:** Finish line; paste the protection-list report, marking each line;
  `/finish-branch`; push once.
