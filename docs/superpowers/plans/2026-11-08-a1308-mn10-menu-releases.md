# A1308 menu and photos, PR mn10: one row says where each menu version stands — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Replace the live-version pointer `menu_publications` and the queue
`menu_scheduled_publications` with one table, `menu_releases`: one row per published or queued
version, in state `queued`, `live`, `superseded` or `cancelled`. Rename `menu_versions.published_at`
and `published_by` to `created_at` and `created_by`. Record a rescheduled edition's old and new time
in `activity_log`. Measure, before relying on it, the photo-in-use triggers, the size of the stored
menu documents, and the sale path's read of live versions.

**Architecture:** `menu_versions` stays the frozen, append-only copy. `menu_releases` is the mutable
fact about each version, separate because the version can never change while this fact changes later
(README R1's lifetime reason). "One live version per menu" becomes a partial unique index; "one queued
edition per instant" stays one. Every read keeps today's shape: the live version is the `live` row,
or the highest-numbered `queued` row due by now; the dashboard's list of scheduled versions keeps its
wire shape (`state: "activated"` for a scheduled version that went live). The two media triggers that
keep a photo while a live or queued version names it read `menu_releases`. The activation duty wakes
on changes to `menu_releases`.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Hono, Vitest, slice 1a's rebuild command and
trigger file.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R1, R2, R6;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.16, §1.17, §1.18, §3
(`menu_edition.rescheduled`; `menu_releases` keeps the publishing record), §5 (the
`menu_publications`, `menu_scheduled_publications`, `menu_version_images`, `menu_versions` rows),
§6, §8 items 2, 3 and 4; [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names
(`packages/menu/src/menu-publication.ts:55` is today's `packages/catalogue/src/menu-publication.ts:55`).
Batch 1 and mn1–mn9 have landed. A missing identifier this plan does not explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6). A sale line points at `menu_versions` (`sale_lines.menu_version_id`,
`packages/db/src/schema/sales.ts:206`), which keeps its rows and protections; nothing about a sale or a
hash changes.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## Words used here

- **Edition:** a version queued to go live at a later time (the dashboard's "scheduled version").
- **Settle:** turn editions whose time has come into the live version, as `settleDue` does today.
- **Immediate publish:** a publish or live patch that goes live at once; its release row's
  `activates_at` equals its version's `created_at`.

## What it builds

1. **`menu_releases`** in core's set, classified `state` (`MENU_STATE`), a change source:
   - `version_id` text primary key; composite key `(version_id, menu_id) → menu_versions(id, menu_id)`;
   - `menu_id` text not null, key to `menus.id`;
   - `state` text not null, CHECK `menu_releases_state_ck` in `queued`, `live`, `superseded`,
     `cancelled` (`enumType`/`enumCheck`);
   - `activates_at` ts not null;
   - `cancelled_at` ts null, `cancelled_by` text null (its key to `persons` is mn11's);
   - CHECK `menu_releases_settled_ck`: `(state = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancelled_by is null)`;
   - `menu_releases_one_live_uq`: unique `(menu_id) where state = 'live'`;
   - `menu_releases_queued_time_uq`: unique `(menu_id, activates_at) where state = 'queued'`.
   `menu_publications` and `menu_scheduled_publications` go
   (`packages/db/src/schema/menu/publication.ts:37-60`, `:83-126`). The old "after queue" CHECK
   (`:120`) has no stored `queued_at` to compare and moves to code, which already refuses a past time
   with `menu_publication.time_past` (`packages/menu/src/menu-schedule.ts:50-51`, `:151-152`;
   tables-menu.md §1.18).
2. **`menu_versions.published_at` → `created_at`, `published_by` → `created_by`**
   (`publication.ts:19-21`). For a queued edition `created_at` is when it was queued, which today is
   also `queued_at` (`menu-schedule.ts:58-67`; and `requeueAfter` copies both from the original,
   `menu-publication.ts:799-806`), so `queued_at` and `queued_by` drop with no loss (tables-menu.md §6).
3. **Reads and writes** (each keeps its signature unless named):
   - `dueEditions` (`menu-publication.ts:55-75`) reads `menu_releases` where `state = 'queued' and activates_at <= at`.
   - `liveVersions` (`:81-131`): the union reads the `live` row (with `since = activates_at`) and the
     highest-numbered due `queued` row, as today; the chooser keeps the higher number.
   - `settleDue` (`:137-189`): for each menu with due editions, if the highest due number is above
     the live number (or there is none), first set the old `live` row to `superseded`, then that edition
     to `live`, then every other due edition of the menu to `superseded`; otherwise set every due
     edition to `superseded`. The order matters: `menu_releases_one_live_uq` refuses two live rows even
     for a moment. Answers the menus it moved, as today.
   - `pointTo` (`:659-669`) becomes `makeLive(tx, menuId, versionId, at)`: supersede the current live
     row, insert `{ versionId, menuId, state: "live", activatesAt: at }`. Used by `publishMenu`
     (`:627-657`) and `patchLiveMenu` (`:702-751`).
   - `requeueAfter` (`:753-810`): cancels the waiting editions (`state = 'cancelled'`, `cancelled_at`,
     `cancelled_by`), then inserts each copy's version (keeping the original's `created_at`/`created_by`)
     and a `queued` release at the original's time.
   - `queueMenuPublication` (`menu-schedule.ts:34-69`): inserts the version and a `queued` release.
   - `latestEdition` (`:71-95`), `cancelMenuPublication` (`:97-122`), `rescheduleMenuPublication`
     (`:128-161`), `overtakenBy` (`menu-publication.ts:580-613`) and `activateDueMenuPublications`
     (`menu-schedule.ts:212-232`) read and write `menu_releases` rows in state `queued`. A release row
     that is not `queued` answers `menu_publication.not_queued` as today, with `state` mapped to the
     wire's vocabulary (item 4).
   - `publishedMenusHolding` (`packages/menu/src/archive.ts:36-81`) reads waiting `queued` releases.
   - `apps/server/src/testing/publish-menu.ts:15-19` (`republishMenus`) reads the `live` rows.
4. **The scheduled-versions list keeps its wire shape** (`MenuEdition`,
   `packages/shared/src/menu-document/menu-document-types.ts:346-354`). `listMenuPublications`
   (`menu-schedule.ts:165-210`) lists release rows whose `activates_at` is after their version's
   `created_at` — exactly the queued editions, since an immediate publish's two times are equal and a
   queued or re-queued edition's are not (D2). It maps `live` and `superseded` to `"activated"`, keeps
   `"queued"` and `"cancelled"`, keeps the read-time `"activated"` for a due queued row, and answers
   `queuedAt` from the version's `created_at`.
5. **The two media parent triggers** `menu_version_images_media_image_fk_parent_delete` and
   `_parent_rename` (in `packages/db/triggers/core.sql`; today `0000_baseline.sql:3779-3814`) keep
   their names and messages and test one `exists` over
   `menu_version_images join menu_releases on menu_releases.version_id = menu_version_images.version_id`
   with `menu_releases.state in ('live','queued')` (tables-menu.md §1.17).
6. **Media's usage list and counts** (`packages/media/src/images.ts:232-260`, `:597-617`; the
   `menu_version` and `scheduled_menu_version` arms of `ImageUsage`, `:95-108`) read a release's
   state: `live` is a `menu_version` use, `queued` a `scheduled_menu_version` use, as the pointer and the
   queued schedule row are today.
7. **The activation duty** wakes on `menu_releases` (`apps/server/src/menu-activation.ts:8`).
8. **`menu_edition.rescheduled` in `activity_log`**: `rescheduleMenuPublication(tx, menuId, versionId, activatesAt, personId, options)`
   records subject `menu_version` (the version id), data `{ from: string; to: string }` (ISO times),
   person the signed-in one; its route passes the session's person.
9. **Lists:** classification (`packages/db/src/classification.ts:317-318`; `packages/menu/src/classification.ts:23-24`),
   exports (`packages/db/src/index.ts:407-408`; `packages/menu/src/index.ts:110-111`), live-query lists
   (`apps/dashboard/src/api/live-queries.ts:15-16`, `:329-333`; `packages/media/src/dashboard/live-queries.ts:8-10`),
   `scripts/live-subscriptions.test.ts`. Configuration export: unchanged (publishing never travelled,
   `packages/menu/src/configuration-transfer.ts:209-228`), so the bundle format stays.

## Measurements (tables-menu.md §8), each an early task with its failing result written now

| # | What | Failing result | Fallback (the watcher confirms before the builder takes it, rules §5.4) |
| --- | --- | --- | --- |
| 8.2 | Delete a photo nothing uses, and try to delete one a live version names, with 3 menus live, 2 editions queued and 15,000 `menu_version_images` rows; `explain query plan` of the triggers' `exists` | the plan shows `SCAN menu_version_images` or `SCAN menu_releases`, or the median delete takes over 10 ms | add index `menu_releases (state, version_id)`; `menu_version_images`' primary key already leads with `version_id` (`publication.ts:72`) |
| 8.3 | `length(document)` of the demo seed's largest published menu (`apps/server/scripts/demo-seed/`, Casa Delgado ES), times 300 versions a year | over about 100 MB a year | none inside this PR: the design would need a compressed `document` or a shared store of unchanged parts; stop and ask |
| 8.4 | `readLiveDocuments` for 3 menus (`menu-publication.ts:250-301`), 3 rounds of 200 samples, on the base and on the branch, same machine | run as 3 rounds of 200 samples each (after 20 untimed), the branch's median exceeds the highest of the base's 3 round medians by more than 10% (slice 0's `bench compare` rule, `--rounds 3`) | add a covering index `menu_releases (menu_id, state)` |

For 8.2 the fallback is likely unneeded: the review's rehearsal on 2026-11-08 (15,000
`menu_version_images` rows, read, not repeated here) saw the lookup use the filename index and then
the release's primary key, about 18 µs. The measurement still runs and decides.

8.2 and 8.4 need no year of trading: they build their own small databases. If slice 0's bench has
landed (`apps/server/scripts/bench/`), also run `bench compare` for `sale.counter` and
`payment.final` before and after, and paste it. The measurement scripts are not committed; their text
and output go in the pull request description, with the machine named (README §5 U11).

## Decisions this plan makes

- **D1. The wire keeps `"activated"`.** The dashboard's list shows Scheduled, Cancelled and Activated
  (`apps/dashboard/src/i18n/strings.ts:3274-3276`); `live` and `superseded` both mean "it went live",
  which is what Activated says. Splitting them on screen is not asked for.
- **D2. "Was scheduled" is read from the two times**, not stored. An immediate publish writes
  `activates_at = created_at` (`publishMenu` and `patchLiveMenu` take both from one `at`); a queued
  edition's time is refused unless it is after `at` (`menu-schedule.ts:50-51`); a re-queued copy keeps
  the original's `created_at` and time. A case pins each of the three. Storing a flag would be a second
  copy of a fact the two times already give (R6).
- **D3. A due edition whose number is lower than the live one becomes `superseded`**, where today it
  becomes `activated` without moving the pointer (`settleDue`'s `liveNumber >= number` skip, `:179`).
  Both read as "activated" on the wire.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Keys from `menu_versions.created_by` and `menu_releases.cancelled_by` to `persons` | mn11 |
| A547's button order and list visibility (`docs/backlog/menu.md`) | its backlog entry; no table change |

## Files

- Schema: `packages/db/src/schema/menu/publication.ts`; `packages/db/triggers/core.sql` (two triggers,
  each edited where it stands: the protection list reports a trigger's position among those on its
  table and event)
- Menu package: `menu-publication.ts`, `menu-schedule.ts`, `archive.ts`, `classification.ts`, `index.ts`
- Media: `packages/media/src/images.ts`, `dashboard/live-queries.ts`
- Server: `apps/server/src/menu-activation.ts`, `menu-api.ts` (reschedule passes the person),
  `testing/publish-menu.ts`
- Dashboard: `apps/dashboard/src/api/live-queries.ts`
- Venue service schema comment: `packages/db/src/schema/venue-service/service.ts:290-291`
- db: `packages/db/src/index.ts`, `classification.ts`, `activity-kinds.ts`
- Regenerated: core's `drizzle/**`, the epoch file
- Guards: `scripts/module-graph-honesty.test.ts:440-447` (its case asserts a "trigger body JOIN on
  menu_publications" edge from core's SQL with `menu_publications` moved to another owner; re-point
  both lines to `menu_releases`, which the rewritten triggers join), `scripts/schema-constraints.test.ts` (foreign keys: remove the two old tables' rows, add
  `menu_releases`' two; unique indexes: remove `menu_scheduled_publications_queued_time_uq`, add the two
  new; CHECKs: remove `menu_scheduled_publications_state_ck`, `_settled_ck`, `_after_queue_ck`, add the
  two new), `scripts/behavioural-triggers.test.ts` (the two triggers' cases re-pointed),
  `scripts/live-subscriptions.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/starting-migrations.test.ts`, `packages/db/src/schema/menu/migrations.test.ts` (pinned CHECK
  texts, `:261`)
- Tests: `packages/menu/src/menu-publication.test.ts`, `menu-publication.live.test.ts`,
  `menu-schedule.test.ts`, `menu-patch.test.ts`, `menu-patch.live.test.ts`, `archive.test.ts`;
  `apps/server/src/menu-activation.test.ts`, `menu-api.menu-schedule.test.ts`,
  `menu-api.menu-patch.test.ts`, `boot.test.ts:2732-2760`; `packages/media/src/images.test.ts`,
  `image-references.test.ts`; the Madrid baseline
- Docs: `docs/developers/products.md` (publishing), and any `docs/developers` line naming the two old
  tables (`git grep -n -e menu_publications -e menu_scheduled_publications -- docs/developers`)

## Size

| | Code | Tests |
| --- | --- | --- |
| Schema, lists | 50 | 60 (CHECK and index cases) |
| `menu-publication.ts` reads and writes | 150 | 80 |
| `menu-schedule.ts`, `archive.ts`, list mapping | 90 | 70 |
| Triggers, media reads | 50 | 50 |
| Activation, reschedule activity | 25 | 40 |
| Madrid transform, docs | 30 | 30 |
| **Counted** | **395** | **330** |

About 735 counted lines; the three measurement scripts are not committed. About 3 hours.

## Finish line

1. The pull request description holds measurements 8.2, 8.3 and 8.4: scripts, outputs, machine, verdicts.
2. `pnpm --filter @waitron/menu exec vitest run src/menu-publication.test.ts src/menu-schedule.test.ts src/menu-patch.test.ts src/archive.test.ts`
   passes, including "never holds two live releases while settling", "lists queued editions and not
   immediate publishes" and "records a rescheduled edition's old and new time".
3. `pnpm --filter @waitron/server exec vitest run src/menu-activation.test.ts src/menu-api.menu-schedule.test.ts`
   passes, including "wakes when a release row changes".
4. `pnpm exec vitest run scripts/behavioural-triggers.test.ts` passes; a photo named by a live or
   queued version still refuses deletion and renaming, and one named only by a superseded or cancelled
   version does not.
5. `git grep -n -E "menuPublications|menu_publications|menuScheduledPublications|menu_scheduled_publications|publishedAt: menuVersions|published_by" -- apps packages scripts`
   prints only the dashboard's string keys `menu_publications.*` (screen words, unchanged) and the
   captured fixtures. The comment at `packages/db/src/schema/venue-service/service.ts:290-291` names
   `menu_publications_version_fk`; it is reworded in this PR to name `menu_releases`' composite key
   (it states a decision another area relies on, so it stays, CLAUDE.md §1) and is listed in Files.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing table menu_publications
missing index menu_publications.primary key(menu_id)
missing table menu_scheduled_publications
missing index menu_scheduled_publications.primary key(version_id)
missing index menu_scheduled_publications_queued_time_uq
extra table menu_releases
extra index menu_releases.primary key(version_id)
extra index menu_releases_one_live_uq
extra index menu_releases_queued_time_uq
missing table menu_versions.columns[published_at]
missing table menu_versions.columns[published_by]
extra table menu_versions.columns[created_at]
extra table menu_versions.columns[created_by]
changed table menu_versions.columnOrder
old: [<… published_at, published_by>]
new: [<… created_at, created_by>]
changed trigger menu_version_images_media_image_fk_parent_delete.body
old: <two exists over menu_publications and menu_scheduled_publications>
new: <one exists over menu_releases, state in ('live','queued')>
changed trigger menu_version_images_media_image_fk_parent_rename.body
old: <the same pair>
new: <the same single exists>
```

In the two `migrated` and two `change-feed` entries, `menu_versions` is append-only (`appendOnly()`,
`packages/db/src/classification.ts`), and its installer-made update/delete refusal triggers name no
column, so they do not change (read, not run: if they list columns, their `.body` lines print and are
expected).

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_menu_publications_delete
missing trigger waitron_change_menu_publications_insert
missing trigger waitron_change_menu_publications_update
missing trigger waitron_change_menu_scheduled_publications_delete
missing trigger waitron_change_menu_scheduled_publications_insert
missing trigger waitron_change_menu_scheduled_publications_update
extra trigger waitron_change_menu_releases_delete
extra trigger waitron_change_menu_releases_insert
extra trigger waitron_change_menu_releases_update
changed trigger waitron_change_menu_versions_update.when
old: <naming published_at, published_by>
new: <naming created_at, created_by>
```

Why, from tables-menu.md §5: "menu_publications: PK on menu_id → `menu_releases_one_live_uq`"; its
version composite key → `menu_releases`' composite key; the queue's primary key, menu key, version key,
state CHECK and queued-time index → `menu_releases`; its settled CHECK "reworded for the four
states"; its after-queue CHECK "moved to code"; `menu_version_images`' parent triggers "rewritten to
read `menu_releases.state in ('live','queued')`". The CHECKs and foreign keys of the old and new tables
are parts of their table objects and print no separate lines. If a measurement's fallback is taken, its
index prints as one more `extra index` line, which the watcher's confirmation adds to the prediction.

## Stop points (beyond rules §5)

1. A measurement gives its failing result (rules §5.4); 8.3's has no in-PR fallback.
2. A behaviour test of publishing, scheduling, patching or activation needs a changed expected value,
   other than a removed `activatedAt` (never read, tables-menu.md §6).
3. A reader outside the files listed depends on `menu_scheduled_publications.activated_at`.

## Needs

- **Outside this area:** slice 2 (`recordActivity`); slice 1a's trigger file. Slice 0's bench is used
  if present, not needed.
- **In this area:** mn3 (names); mn8 (it last changed `core.sql`'s media triggers; take `main`'s
  generated files on rebase and re-run the rebuild, rules §2.4).

## Global Constraints

- Rules §1–§9; core rebuilt; triggers edited only in `packages/db/triggers/core.sql`.
- Each new CHECK and index: refusal case and legitimate-write case (rules §4).
- Queries on one transaction awaited in turn (CLAUDE.md §3).

## Review Focus

1. **The live version a till reads is the same as today** at every instant around a queued edition's
   time, including before `settleDue` runs.
2. **No moment holds two live rows** for one menu (the settle order).
3. **The photo triggers keep a photo exactly while a live or queued version names it.**
4. **The scheduled list shows what it showed**, including immediate publishes left out (D2).

---

### Task 1: Measure 8.3 on the base (no code change)

- [ ] **Step 1:** In a throwaway worktree of the base, seed the demo venue in a scratch folder
  (`wa-wt`'s seed command or `apps/server/scripts/demo-seed`'s entry with `salesDays: 0`), then
  `select menu_id, max(length(document)) from menu_versions group by menu_id`. Multiply the largest by
  300. Paste the query, numbers and verdict. Over about 100 MB: stop point 1.

### Task 2: The table, the version columns, and the writes

- [ ] **Step 1:** Base protection list (rules §3). Write the 8.4 timing script against the base now
  (it needs only `readLiveDocuments`, `publishMenu`, `queueMenuPublication`) and record the base's
  numbers.
- [ ] **Step 2: Failing cases:**
  - `migrations.test.ts` (raw SQL): `"refuses two live releases for one menu"`
    (`menu_releases_one_live_uq`; control: one live in each of two menus, and live plus superseded in
    one); `"refuses two queued editions at one instant"`; `"refuses a cancelled release with no
    cancel time or person"` and `"…a live release with a cancel time"` (`menu_releases_settled_ck`);
    `"refuses an unknown state"`; `"refuses a release for another menu's version"` (composite key).
  - `menu-publication.test.ts` `"never holds two live releases while settling"`: queue two editions,
    move the clock past both, `settleDue`; exactly one `live` row, the higher number; the lower is
    `superseded`; the previous live is `superseded`.
  - `"reads a due edition as live before it is settled"`: the existing case keeps its assertion.
  - `menu-schedule.test.ts` `"lists queued editions and not immediate publishes"`; `"lists a
    re-queued copy"` (after `patchLiveMenu`); `"maps live and superseded to activated"`.
  - The existing publish, queue, cancel, reschedule, patch and overtake cases keep their assertions.
- [ ] **Step 3: Run; see them fail.**
- [ ] **Step 4: Implement** items 1–4 and 9; rebuild core.
- [ ] **Step 5: Run — PASS. Commit.**

### Task 3: The triggers, media, measurement 8.2

- [ ] **Step 1: Failing cases:** `scripts/behavioural-triggers.test.ts`: the two parent-trigger cases
  set up a `live` release and a `queued` release instead of the old tables; add "a photo named only by
  a superseded version can be deleted" and "…only by a cancelled edition can be deleted";
  `packages/media/src/images.test.ts`: the `menu_version` and `scheduled_menu_version` uses keep their
  expected lists.
- [ ] **Step 2:** Implement items 5–6; rebuild core; run — PASS.
- [ ] **Step 3: Measure 8.2** (scratch script, `useVenueDb` with core's migrations): 3 menus, each with
  a live version naming 50 photos, 2 queued editions, and versions enough for 15,000
  `menu_version_images` rows; `explain query plan` the trigger's `exists` with a bound filename; time
  200 deletes of an unused photo (re-inserting it outside the timer) and 200 refused deletes of a used
  one. Judge against the table. **Commit** the code (not the script).

### Task 4: Activation, the rescheduled entry, measurement 8.4

- [ ] **Step 1: Failing cases:** `menu-activation.test.ts` `"wakes when a release row changes"` (a
  queue written through the bus wakes the duty, as today's case does with the old table name);
  `menu-schedule.test.ts` `"records a rescheduled edition's old and new time"` (subject `menu_version`,
  data `{ from, to }`, the given person).
- [ ] **Step 2:** Implement items 7–8; run — PASS.
- [ ] **Step 3: Measure 8.4** on the branch with the Task 2 script; judge against the table.
  **Commit.**

### Task 5: Madrid baseline, guards, docs, finish

- [ ] **Step 1: Madrid baseline:** for each captured `menu_publications` row, a `menu_releases` row
  `{ version_id, menu_id, state: "live", activates_at: <its published_at>, cancelled_at: null, cancelled_by: null }`;
  captured queue rows become `queued`/`superseded`/`cancelled` releases (the capture holds none, its
  manifest says 0, `packages/country-es/test-fixtures/demo/madrid-before-move.manifest.json:153`);
  rename `menu_versions`' two columns. One helper, one test.
- [ ] **Step 2:** Guards (Files), docs.
- [ ] **Step 3:** Finish line; paste the protection-list report, marking each line;
  `/finish-branch`; push once.
