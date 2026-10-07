# Forward-only scheduled menu publication — implementation plan (W99)

> **For agentic workers:** implement each task test-first: write the failing behavioural test, run
> it and watch it fail for the stated reason, then the minimal implementation. Use
> `superpowers:subagent-driven-development`; one implementer per task, in this worktree
> (`/Users/clintongormley/workspace/worktrees/waitron-feat-forward-only-menu-publication`, branch
> `feat/forward-only-menu-publication`), in order. Each task is sized for one implementer well
> under 100 tool calls. An implementer that passes about 150 calls with its task unfinished stops
> at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left,
> the files, and each check's state. A fresh implementer continues from it.
> **Existing assertions:** one existing test changes its setup for a stated reason (Task 4,
> `name-only-upgrade.test.ts`; see "Assertions" at the end); no other existing assertion is
> expected to change. Adding fixture rows, stub methods, list entries for new tables, or a new key to a
> whole-shape pin is allowed and listed there. Any other existing assertion that turns out to need
> changing is a STOP: report it, do not edit it.

> **Rewritten 2026-10-07** against `main` at `ffd468189` (after W98, #1331). Every `file:line`
> below was read at `ffd468189`. The one claim marked **(measured)** was run; everything else was
> read.
>
> **Amended 2026-10-07 after the owner's answer (~10:45):** overtaking is refused, with no
> cancel-or-replace choice; the manager cancels or reschedules the edition in the way through its
> own actions, then tries again. Task 1 had already landed (`c0b3dd8b9`) with the refusal for a
> new queued edition and an immediate publish (`refuseOvertaken`, `overtakenBy`); Tasks 3, 6, 7, 9,
> 10 and 11 were rewritten to match. The spec's §3 and §8 carry a dated note saying so, added in
> the same commit as this amendment.

**Goal:** a manager can queue several fixed future editions of a menu, each activating at a chosen
venue-local time, and the live edition only ever moves to a higher-numbered one. An immediate
publish, a new queued edition or a reschedule that would put editions out of number order is
refused, naming each edition in the way by number and venue-local time and saying what to do:
cancel that edition, or move it (earlier when it must go live first, later when it must go live
after). Nothing is cancelled except through an edition's own Cancel action.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md)
§3, §8 (the publication bullet), §9 ("Publication snapshots", "Time"). Backlog entry
"Department menu timetables and queued publication" (`docs/backlog.md:1023-1033`). The owner's
requirements of 2026-10-07 (~10:00, the overtake scenario end to end; ~10:45, overtaking is
refused, which replaces the ~10:00 note's second point) are quoted under "Owner requirements" and
each has its own tests. The owner's ~10:45 words answer question W99 in
`~/waitron-campaign-b/questions.md:1917-1922` (Decision 1).

**Risk triggers present** (review weight): a migration adding a catalogue table and a media
migration that recreates two triggers whose bodies read it; a cross-package contract (catalogue's
live-version read, used by venue-service's ordering path, and media's `ImageUsage`); a primary-only
background duty in `bootServer`; concurrency (two writers racing on numbering and the live
pointer). Full `/finish-branch` ceremony.

---

## Survey of the current code (what the tasks change)

### 1. Storage

`packages/catalogue/src/schema/publication.ts`:
- `menu_versions` (`:7-31`): `id`, `menu_id`, `number` (`>= 1`, `:29`), `document`, `content_hash`,
  `published_at`, `published_by` (a plain person id with no key, `:16-18`); unique
  `menu_versions_menu_number_uq (menu_id, number)` (`:26`) and `menu_versions_id_menu_key (id,
  menu_id)` (`:28`, the target of the pointer's two-column key).
- `menu_publications` (`:34-53`): one row per menu, `menu_id` PK, `version_id`, `published_at`;
  key `(version_id, menu_id) -> menu_versions(id, menu_id)` (`:47-51`). This is "the live pointer".
- `menu_version_images` (`:56-72`): `(version_id, filename)`, index on `filename` "for media's
  delete and rename triggers" (`:69-70`).
- Classification (`packages/catalogue/src/classification.ts:22-32`): `menu_versions` and
  `menu_version_images` are `appendOnly(…, "state", …)`; `menu_publications` is `classify(…,
  "state", …)`. The append-only pair is also in `packages/migrations/migrations.manifest.json`
  (catalogue set, `appendOnlyTables`). `CATALOGUE_CHANGE_SOURCES` is derived from the
  classification list (`classification.ts:35-37`), so every catalogue table is a live resource
  whose type is its table name.
- Not transferred: none of the three is in `CATALOGUE_CONFIGURATION_TRANSFER`
  (`packages/catalogue/src/configuration-transfer.ts:102-122`); pinned by
  `packages/composition/src/composition.test.ts:107-128` (forbidden names) and
  `apps/server/src/configuration-transfer.test.ts:1332-1333`.
- Order lines keep their version: `working_line_contexts.menu_version_id` has the key
  `working_line_contexts_menu_version_fk -> menu_versions(id)`
  (`packages/venue-service/src/schema/service.ts:306, 340-344`); `sale_lines.menu_version_id` is a
  plain id (`packages/db/src/schema/sales.ts:201`); `order_drafts` holds one too
  (`packages/db/src/schema/order-drafts.ts:71`). Nothing in this plan writes any of them.

### 2. Every consumer of the publication tables and functions

All live reads go through one private function, `liveVersions(tx, menuIds | undefined, mode)`
(`packages/catalogue/src/menu-publication.ts:39-76`): it reads `menu_publications` inner-joined to
`menu_versions`, one statement per batch of ids. Its callers:
- `statusOf` (`:83-93`) → `menuStatus` (`:100-111`): `MenuStatus.publishedAt` is today
  `menu_versions.published_at` of the live version (`:50, :90`).
- `readLiveDocuments` (`:138-184`, a per-handle cache of frozen documents keyed by version id) and
  `assertLiveVersions` (`:191-207`, `menu.version_changed`). Their callers:
  `packages/venue-service/src/operations.ts:371` (readiness) and `:733` (`zoneLiveDocuments`, under
  `listZoneOffers` `:750` and `menuState` `:791`); a new line records `versionOf(offer.menuId)`
  (`:1118`). The till learns of a new live version through `GET /api/menu-state`
  (`apps/server/src/till-api.ts:1346`), polled by `MenuStatePoll`
  (imported at `apps/till/src/till-app.ts:225`, constructed at `:1515`) and compared by `versionsMoved` (`till-app.ts:866`, used at
  `:2741`). **No till code changes in this plan:** a version that becomes live by schedule reaches
  the till exactly as an immediate publish does today.
- `previewMenu` (`:260-410`): its own live version (`:264`) and every live version for shared
  changes (`:269-270`).
- `publishMenu` (`:441-473`): refuses clashes and a stale hash (`:448-451`), returns the live
  version unchanged when the hash matches it (`:452-454`), numbers the new version
  `max(number) + 1` over ALL the menu's versions (`:455-459`), writes the version, its images
  (`:466-467`) and upserts the pointer with one `publishedAt = now()` used for both rows
  (`:460-471`).
- `menusOfVersions` (`:210-222`): the menu of any version id, live or not
  (`apps/server/src/working-order.ts:375`). Unchanged: a queued version is a version of its menu.
- Exports: `packages/catalogue/src/index.ts:94-101`. Other callers of `publishMenu`:
  `apps/server/src/catalogue-api.ts:973-985` (the route), `apps/server/src/testing/publish-menu.ts`,
  `apps/server/scripts/demo-seed/seed.ts:79`.
- Media, the photo guard: the triggers `menu_version_images_media_image_fk_parent_delete` and
  `…_parent_rename` refuse deleting or renaming a photo that a version **in `menu_publications`**
  names (`packages/media/drizzle/0005_photo_name_only.sql:138-161`, recreated there from
  `0003_published_image_references.sql`); `…_insert` (`0005:130-136`) requires the photo to exist
  when a version names it. Media's usage list and counts join `menu_publications` the same way
  (`packages/media/src/images.ts:158-170` in `listImageUsages`, `:557-566` in `countUsages`, whose
  comment `:540-546` requires the two to stay in step); the usage type `menu_version` is documented
  "A menu's LIVE version" (`images.ts:61-62`), duplicated in `packages/media/src/dashboard/client.ts:24`,
  labelled by `image-library.ts:34, 353-354` with `image.published_menu`
  (`packages/media/src/dashboard/strings.ts:42, 91`). `deleteImage` (`images.ts:293-313`) refuses by
  usage before the triggers. Media requires catalogue (`packages/media/src/module.ts:30`), and the
  manifest applies catalogue's set before media's
  (`packages/migrations/migrations.manifest.json`, order `core, catalogue, media, …`).
  **So today a queued version's photos would be unprotected:** deleting one would leave the edition
  naming a missing photo when it activates. Task 4 closes that.
- Media's upgrade test `packages/media/src/schema/name-only-upgrade.test.ts` migrates media to
  `0004` (`BEFORE`, `:33`; staged by `stageMediaBefore`, `:66-80`), snapshots every trigger whose
  text names `media_images` (`:90-93`), then applies the WHOLE media folder (`:155`) and requires
  the eleven triggers back word for word (`:209-212`). Task 4's migration rewrites two of them, so
  this test's setup changes (Task 4, and "Assertions").
- Live subscriptions: the dashboard's `MENU_PUBLICATION_READS` (`apps/dashboard/src/api/live-queries.ts:4-24`)
  feeds `getMenuRead`, `getMenuStatuses`, `getMenuStatus`, `getMenuPreview` (`:187-192`); media's
  `images` query lists `menu_publications` and `menu_version_images`
  (`packages/media/src/dashboard/live-queries.ts:1-11`). Guard: `scripts/live-subscriptions.test.ts`
  (checks names against declared resources only). A committed write reaches open dashboards through
  the in-process change feed (`apps/server/src/boot.ts:1999`, `live-api.ts:12-49`); the catalogue's
  own pin is `packages/catalogue/src/menu-publication.live.test.ts:15-28`.

**Statement-text pins a new live read must keep** (read, all at `ffd468189`):
- `packages/venue-service/src/operations.test.ts:2312`: `menuState` issues exactly 4 statements.
- `operations.test.ts:2384`: in `listVenueReadiness`, exactly ONE statement whose SQL matches
  `/from "menu_publications"/`.
- `apps/server/src/till-api.sell-published.test.ts:416`: the sale path issues no statement matching
  `/select "id", "menu_id" from "menu_versions"/` while every line is live.
- `packages/catalogue/src/menu-publication.test.ts:333-377`: counts statements containing
  `"document"`; the metadata and format reads must not name that column (the format read uses
  `json_extract(…'$.format')`, `menu-publication.ts:53-56`, and does today).
- Batches bind at most `BATCH_SIZE = 1000` values per statement, because the store passes each bound
  value as its own function argument (`packages/catalogue/src/batches.ts:1-3`). A statement that
  names the batch's ids twice (once per half of a union) must take half-size batches.

So the live read stays ONE statement, keeps `from "menu_publications"` in it exactly once, and adds
the due queued rows to that same statement.

### 3. The route and the Menus screen

- `apps/server/src/catalogue-api.ts`: every route runs in `gated` (`:697-708`), one
  `withTransaction` that first calls `authorizeManager` with `CATALOGUE_WRITE_PERMISSION`
  (`person.manage`, `:128`) and hands the person id on. The error-to-status map is `STATUS`
  (`:260-310`; `menu.changed_since_preview` 409 at `:285`, `menu.clashes_unresolved` 409 `:286`).
  `POST /management-api/catalogues/:id/publish` (`:973-985`) reads `{ expectedHash }`.
  `requireVenueCfg` (`:1527-1535`) gives the venue's `TillConfig` (`locationId`); the routes
  already reach venue-service through `VENUE_SERVICE` (imported at `:104`, used at `:1181`), and other server files import
  `@waitron/venue-service` directly (`apps/server/src/kitchen.ts`, `tables.ts`, `watchers.ts`).
- Dashboard: `publishMenu(id, expectedHash)` (`apps/dashboard/src/api/client.ts:2087-2092`); the
  Preview tab is `dashboard-menu-preview` (`apps/dashboard/src/widgets/menu-preview.ts`), which owns
  the Publish button (`#renderPublish` `:917-934`, hidden when the draft equals the live version,
  `:918`) and its warnings dialog (`:997-1025`), and asks the host to publish with the event
  `wt-menu-publish { hash }` (`#publish` `:683-700`). The host is `menus-screen.ts`: `#publish`
  (`:1266-1300`) and `#renderPreview` (`:2259-2276`). Its browser suite pins
  `client.publishMenu.mock.calls` as `[["menu-lunch", LUNCH_HASH]]`
  (`apps/dashboard/src/screens/menus-screen.test.ts:5205`, and `:5269`), lists write methods in
  `WRITES` (`:327-345`) and stubs `publishMenu` at `:549`. **So `publishMenu` keeps exactly its two
  arguments;** this plan adds none. A publish refusal is shown today in the preview's result
  paragraph (`#renderResult` `:726-741`, `role="alert"`), as `menu_preview.failed_kept`/`failed`
  with the refusal's sentence as `{reason}` (`publishFailure`, `menu-preview.ts:132-137`;
  `apps/dashboard/src/i18n/strings.ts:2301-2304`, Spanish `:4701-4704`). The warnings dialog
  (`:996-1025`) closes before the request is sent (`confirmingHash = null` in `#publish`), so no
  dialog is open when a refusal comes back. `codeMessage(code)` (`packages/dashboard-kit/src/codes.ts:23`)
  gives one fixed sentence per code and reads no params.
- Field primitives: `wt-input type="date"` / `type="time"` are already used
  (`packages/venue-service/src/dashboard/prep-stations-screen.ts:1590-1625`,
  `hours-cell-editor.ts:177-190`). Forms contract: `docs/developers/design-system.md:1379` onwards
  (`wt-form-actions`'s `error`, `focusFirstInvalid` from `@waitron/ui`). Draft scope:
  `leaveCoordinatorFor`, as `apps/dashboard/src/widgets/shift-dialog.ts:130-148` uses it, with
  `shift-dialog.unsaved.test.ts` as the model. A widget can own an `api` and a `DashboardQueries`
  (`apps/dashboard/src/api/query-controller.ts:7`; `product-editor.ts` takes `api`). The browser
  context is pinned to UTC (`apps/dashboard/vitest.config.ts:36`).

### 4. Local time, as Hours and W98 already handle it

- `localTimeOccurrences(date, time, timeZone)` (`packages/venue-service/src/hours-occurrences.ts:32-45`,
  browser-safe): every instant at which the venue clock reads `time` on `date` — none for a skipped
  minute, two for a repeated one; `offsetMinutes` (`:9-26`). Hours refuses a special-date endpoint
  at a skipped minute (`skippedEndpoint`, `hours-clock.ts:68-82`) and explains a repeated one
  (`repeatedTimes`, `hours-occurrences.ts:54-67`); prep stations refuse a skipped test time
  (`routing-store.ts:405-414`). `isLocalDate` (`hours-rules.ts:33-38`). Only `venueLocalMoment` is
  exported from the package barrel today (`packages/venue-service/src/index.ts:64`).
- The location's zone: `readLocationClock(tx, locationId)` (`packages/reporting/src/business-day.ts:220-230`);
  `civilDateOf` and `validateTimeZone` from the same package.
- **(measured, 2026-10-07, Node v26.7.0, a hand copy of `hours-occurrences.ts:9-45` with its types
  removed, `/tmp/w99probe/p.mjs`):** in `Europe/Madrid`, 2026-10-25 02:30 occurs at
  `2026-10-25T00:30:00Z` and `2026-10-25T01:30:00Z`; 2027-03-28 02:30 does not occur; 2026-10-08
  08:00 is `2026-10-08T06:00:00Z`; 2026-10-07 16:00 is `2026-10-07T14:00:00Z`. The tests below use
  those dates; a failing case would print one instant (or none) for the autumn date and one for the
  spring date.

### 5. Background duties in `bootServer`

- The trading path creates `liveEvents` (`apps/server/src/boot.ts:1318`), subscribes it to the
  change feed (`:1999-2001`) and then runs one `runLoop` (`:2025-2099`) whose sleep is
  `sleepMsFor(nextDueAt, …)` clamped to `[minTickMs, maxTickMs]` (`apps/server/src/loop.ts:13-22`;
  `DEFAULT_MAX_TICK_MS` one hour, `config.ts:132`). The loop cannot be woken early: nothing outside
  a pass shortens its sleep. Primary-only work reads `holders.singletonRole.current === "primary"`
  per run (`boot.ts:1712, 1858`; a fenced node is demoted on that axis, `:1219-1220`; a mirror is
  always secondary, `:1265`). Every started duty pushes its stop onto `undoOnFailure` at once
  (the demo printer loop at `:1469`, the main loop at `:2096`) and is listed in `stopWork`'s `closeAll` (`:2158-2175`). A log-only duty need not
  be health-tracked (`:374-377`). Timers: `unrefTimer` (`apps/server/src/unref-timer.ts:9-13`).
- Failed-start pattern: `apps/server/src/boot.failed-start.test.ts:354-384` (a step after the
  listener throws; mocked starters are asserted stopped). It mocks `subscribeToChanges` with
  `mockImplementationOnce` (`:364-372, :430-437`), so **a new duty must not call
  `subscribeToChanges` itself** (it would take that one-shot mock); it listens on `liveEvents`
  instead. Real restart pattern: `apps/server/src/boot.test.ts:2767-2805` (seed rows, `startServer`,
  `waitForEvent`, read the rows).

---

## The rule this plan enforces

**Invariant:** among a menu's editions that are not cancelled, activation order equals number
order, and every queued edition's number is greater than the live edition's.

- Numbers come from `max(menu_versions.number) + 1` over every version of the menu, cancelled ones
  included (`publishMenu` already does this, `menu-publication.ts:455-459`), so a cancelled number
  is never reused. `menu_versions_menu_number_uq` and the single write transaction at a time
  (`racePair`'s receipt, `packages/catalogue/test/fixtures.ts:204-217`) keep two writers from taking
  one number.
- **Placing edition E (number n) at instant T** — a new queued edition (n is the next number), an
  immediate publish (n is the next number, T is now), or a reschedule of E — **overtakes** every
  OTHER queued edition Q with `(Q.number < n and Q.activatesAt >= T) or (Q.number > n and
  Q.activatesAt <= T)`. Equal instants count, because the higher number would hide the lower one
  for ever. A new edition overtakes only by the first clause (it has the highest number), so
  queuing it no later than an existing queued edition, or publishing now while any is queued,
  overtakes those. Rescheduling earlier overtakes lower-numbered editions it passes; rescheduling
  later overtakes higher-numbered editions it passes (both would put a newer version live before
  an older one; owner requirement 2).
- If the overtaken set is not empty the request is refused `menu_publication.overtakes_queued`
  `{ menuId, overtaken: [{ versionId, number, activatesAt }] }` (ascending number) and writes
  nothing, settle included. There is no field that turns the refusal into a cancellation (owner,
  2026-10-07 ~10:45). The manager cancels the edition in the way through its own Cancel action, or
  reschedules it, and then repeats the request. Cancel and reschedule stay separate actions on each
  queued edition.
- While the invariant holds, one placement overtakes in one direction only: a lower-numbered Q1 at
  or after T and a higher-numbered Q2 at or before T would put Q2 no later than Q1, which the
  invariant forbids. The dashboard's sentence still groups the editions in the way by direction
  rather than relying on this (Task 9).
- An immediate publish with nothing queued behaves exactly as today. An immediate publish whose
  draft equals the live version stays today's no-op (`:452-454`), whatever is queued: it creates no
  edition, so it overtakes nothing.
- **Due editions:** a queued edition whose `activatesAt <= at` is live for every read at `at`, even
  before anything writes. Every write that touches the queue or the pointer first "settles" the
  menu at its own instant: each due queued row becomes `activated`, and the pointer moves once to the
  highest-numbered due edition — never to a lower number than it already holds.

---

## Schema (Task 1; catalogue, in `packages/catalogue/src/schema/publication.ts`)

`menu_scheduled_publications` — one row per edition created by queuing; an immediately published
version has none.

| Column | Type | Notes |
| --- | --- | --- |
| `version_id` | `id` PK | the queued `menu_versions` row |
| `menu_id` | `id` not null | |
| `activates_at` | `ts` not null | a whole minute; changed only by a reschedule |
| `queued_at` | `ts` not null | |
| `queued_by` | `id` not null | the person id, plain text with no key, as `menu_versions.published_by` (`publication.ts:16-18`) |
| `state` | `enumType(["queued", "activated", "cancelled"])` not null default `"queued"` | the closed-vocabulary pair, as `sections.role` (`packages/catalogue/src/schema/sections.ts:27, 47`; the set declares closed vocabularies, `schema-conformance.test.ts:22`) |
| `activated_at` | `ts` null | when a settle marked it |
| `cancelled_at` | `ts` null | |
| `cancelled_by` | `id` null | plain person id |

Keys and constraints, all declared in TypeScript:
- FK `menu_scheduled_publications_menu_fk (menu_id) -> catalogues(id)`.
- FK `menu_scheduled_publications_version_fk (version_id, menu_id) -> menu_versions(id, menu_id)`
  (target unique `menu_versions_id_menu_key` exists, `publication.ts:28`).
- CHECK `menu_scheduled_publications_state_ck` `enumCheck(t.state)`.
- CHECK `menu_scheduled_publications_settled_ck`:
  `(state = 'queued' and activated_at is null and cancelled_at is null and cancelled_by is null)
  or (state = 'activated' and activated_at is not null and cancelled_at is null and cancelled_by is null)
  or (state = 'cancelled' and cancelled_at is not null and cancelled_by is not null and activated_at is null)`.
- CHECK `menu_scheduled_publications_after_queue_ck` `activates_at > queued_at` (text comparison is
  sound because `ts` writes one spelling, `Date.toISOString()`, `packages/db/src/schema/columns.ts:23-35`).
- Unique partial index `menu_scheduled_publications_queued_time_uq (menu_id, activates_at) where
  state = 'queued'` — the precedent for a partial unique index is
  `packages/venue-service/src/schema/menus.ts:134-139`. It is not an expression index.

Classification: `classify("menu_scheduled_publications", "state", STATE)` in
`CATALOGUE_CLASSIFICATION`. Not `appendOnly()`: its state and time change. `menu_versions` and
`menu_version_images` stay append-only — a queued edition's content and photos are inserted once,
at queue time, and never changed. No foreign key crosses a class (all `state`). Not transferred
(like `menu_versions`). **Get the table right in this one generation:** Task 4's media triggers
read it in their bodies, after which a rebuild of it fails on an upgrade
(`docs/developers/conventions-data.md:990-1000`), and drizzle-kit 0.31.11 cannot add a column and
a CHECK in one rebuild (CLAUDE.md §3).

Generation: `pnpm --filter @waitron/catalogue db:generate` against the current tree (never a
number from this plan). Read the SQL: one `CREATE TABLE`, one `CREATE UNIQUE INDEX … WHERE`, no
`__new_`, no `DROP`.

## Seams and signatures

`packages/catalogue/src/menu-document-types.ts` (browser-safe types, which the dashboard imports
through `client.ts:125-147`):

```ts
export interface OvertakenEdition { versionId: string; number: number; activatesAt: string }
export interface QueuedEdition { versionId: string; number: number; activatesAt: string }
export interface MenuEdition {
  versionId: string;
  number: number;
  /** "activated" also for a queued row whose time has passed but that no settle has marked yet. */
  state: "queued" | "activated" | "cancelled";
  activatesAt: string;
  queuedAt: string;
  cancelledAt: string | null;
  contentHash: string;
}
export interface MenuPublications {
  live: { versionId: string; number: number; since: string } | null;
  /** Every queued edition, soonest first, then the ten most recently numbered settled ones. */
  editions: MenuEdition[];
}
export interface LocalTime { date: string; time: string; offset: string; repeated: boolean }
/** `GET /management-api/catalogues/:id/publications`. */
export interface MenuPublicationsAnswer {
  timeZone: string;
  live: (MenuPublications["live"] & { local: LocalTime }) | null;
  editions: (MenuEdition & { local: LocalTime })[];
}
```

`packages/catalogue/src/menu-publication.ts` (existing file; internal helpers exported for
`menu-schedule.ts` only, not from `index.ts`):

```ts
// liveVersions gains `at: Date = now()`; LiveVersion's `publishedAt` becomes `since`: the pointer
// row's published_at, or a due queued row's activates_at.
export async function settleDue(tx, at: Date, menuIds?: readonly string[]):
  Promise<{ menuId: string; versionId: string; number: number }[]>;
// Landed in Task 1 (c0b3dd8b9). Task 3 removes `except` (see Task 3 for why it cannot change an
// answer); every caller then passes the placed edition's own number.
export async function overtakenBy(tx, menuId: string, number: number, activatesAt: Date):
  Promise<OvertakenEdition[]>;
/** Landed in Task 1: refuses `menu_publication.overtakes_queued` when `overtaken` names any edition. */
export function refuseOvertaken(menuId: string, overtaken: readonly OvertakenEdition[]): void;
export async function nextNumber(tx, menuId: string): Promise<number>;
export async function publishMenu(tx, menuId, expectedHash, personId,
  options: { at?: Date } = {}): Promise<PublishedMenuVersion>;
```

`packages/catalogue/src/menu-schedule.ts` (new; exported from `index.ts`):

```ts
export async function queueMenuPublication(tx, menuId: string, expectedHash: string,
  activatesAt: Date, personId: string, options: { at?: Date } = {}): Promise<QueuedEdition>;
/** No person id: the schedule row has no column for who moved it, and a reschedule cancels nothing. */
export async function rescheduleMenuPublication(tx, menuId: string, versionId: string,
  activatesAt: Date, options: { at?: Date } = {}): Promise<QueuedEdition>;
export async function cancelMenuPublication(tx, menuId: string, versionId: string,
  personId: string, at?: Date): Promise<void>;
export async function listMenuPublications(tx, menuId: string, at?: Date): Promise<MenuPublications>;
/** Settles every menu; `nextDueAt` is the soonest queued activation after `at`. */
export async function activateDueMenuPublications(tx, at?: Date):
  Promise<{ activated: { menuId: string; versionId: string; number: number }[]; nextDueAt: Date | null }>;
```

New error codes, `packages/catalogue/src/errors.ts` (beside `menu.*` at `:69-80`). The family is
named for the new noun, a menu publication, as `menu_item.*` and `menu_section.*` are for theirs
(Decision 14). None is an incident code, so none needs alert wording; each needs English and Spanish
wording in `apps/dashboard/src/i18n/codes.ts` (Task 8) and a `STATUS` entry in `catalogue-api.ts`:

| Code | Params | Status | Raised by |
| --- | --- | --- | --- |
| `menu_publication.overtakes_queued` | `{ menuId, overtaken: OvertakenEdition[] }` | 409 | queue, reschedule, publish: the placement would put editions out of number order; there is no way to override it in the request |
| `menu_publication.not_found` | `{ menuId, versionId }` | 404 | reschedule, cancel: no schedule row for that version of that menu |
| `menu_publication.not_queued` | `{ menuId, versionId, state: "activated" \| "cancelled" }` | 409 | reschedule, cancel of a settled (or due) edition |
| `menu_publication.time_past` | `{ activatesAt }` | 400 | queue, reschedule: not after `at` |
| `menu_publication.unchanged` | `{ menuId, number }` | 409 | queue: identical to the edition it would follow |
| `menu_publication.time_skipped` | `{ date, time }` | 400 | route: the venue clock never shows it |
| `menu_publication.time_repeated` | `{ date, time, occurrences: { at: string; offset: string }[] }` | 400 | route: shown twice, no `occurrence` sent |
| `menu_publication.clock_unreadable` | `{}` | 409 | route: the location's time zone cannot be read |

Reused: `catalogue.not_found`, `menu.clashes_unresolved`, `menu.changed_since_preview`,
`management.request_invalid`, `shared.invalid_id`, `authorization.not_permitted`.

Routes, `apps/server/src/catalogue-api.ts`, each in `gated` (one transaction, `person.manage`):

| Route | Body | Answer |
| --- | --- | --- |
| `POST /management-api/catalogues/:id/publish` (existing) | `{ expectedHash }` (unchanged) | 200 `{ versionId, number }` (unchanged shape); 409 `menu_publication.overtakes_queued` while an edition is queued and the draft differs from the live version |
| `POST /management-api/catalogues/:id/publications` | `{ expectedHash, activatesAt: { date, time, occurrence?: "earlier" \| "later" } }` | 201 `QueuedEdition` |
| `GET /management-api/catalogues/:id/publications` | — | 200 `MenuPublicationsAnswer` |
| `PATCH /management-api/catalogues/:id/publications/:versionId` | `{ activatesAt: {…} }` | 200 `QueuedEdition` |
| `POST /management-api/catalogues/:id/publications/:versionId/cancel` | — | 204 |

`apps/server/src/menu-publication-time.ts` (new; the server half of local time, reusing
venue-service's helpers):

```ts
/** Refuses a malformed body as management.request_invalid { field: "activatesAt" | "activatesAt.date"
 * | "activatesAt.time" | "activatesAt.occurrence" }, an unreadable zone, a skipped and an
 * unchosen repeated time with their codes. `occurrence` is ignored when the time occurs once. */
export function activationInstant(value: unknown, timeZone: string): Date;
export function localTimeOf(instant: Date, timeZone: string): LocalTime;
```

`apps/server/src/menu-activation.ts` (new):

```ts
export function startMenuActivation(deps: {
  db: Database;
  bus: LiveEvents;
  isPrimary: () => boolean;
  now: () => Date;
  log: Logger;
  /** The longest the duty sleeps: config.maxTickMs. */
  maxWaitMs: number;
  timer?: (ms: number, fn: () => void) => Timer; // default unrefTimer
}): { stop: () => Promise<void> };
```

It runs once at start (restart recovery), then after each run arms ONE timer for
`min(nextDueAt - now, maxWaitMs)` (at least 0). A change whose resources include the type
`menu_scheduled_publications` on `bus` re-runs it (a queue, reschedule or cancel moves the next due
time). The bus delivers a change on the WRITER's call stack, after its commit
(`apps/server/src/live-api.ts:36-49`), so the listener only schedules a run (a flag plus
`queueMicrotask`) and never runs one itself; it ignores the bus's `close` event. The duty's own
activation writes `menu_scheduled_publications`, so a run that activated something wakes the duty
once more; that run finds nothing due, writes nothing, raises no change and arms the timer, so
there is no loop. On a node that is not primary it writes nothing and re-arms at `maxWaitMs`. Runs never
overlap: a wake during a run runs once more after it. A failed run logs `warn`
`menu_publication.activation_failed { errorCode }` and re-arms; each activation logs `info`
`menu_publication.activated { menuId, versionId, number }`; every arm logs `debug`
`menu_publication.activation_armed { sleepMs }`. `stop()` cancels the timer, unsubscribes, awaits
a run in flight and arms nothing more.

---

## Owner requirements (2026-10-07, binding; each has its own named tests)

**(1) The overtake scenario, end to end** (the ~10:00 note's first point, as the watcher restated
it after the ~10:45 answer): v1 live; queue v2 for tomorrow; edit the draft; queue v3 for the day
after; reschedule v3 to this afternoon → **refused**, naming v2 (its number and scheduled time),
and nothing changes; the manager cancels v2 (or moves it earlier); reschedules v3 to this afternoon
→ it succeeds. At 16:00 v3 is live, v2 is cancelled, the DRAFT is exactly as it was before the
reschedule (it is never reset to the live or any queued edition), and the next queued edition is
numbered v4 (v2's number is not reused).

**(2) Overtaking is refused.** The owner, 2026-10-07 ~10:45, verbatim:

> perhaps we just refuse to schedule a newer version before an older version, which leaves the
> user the option of deleting or rescheduling the older version

The supervising watcher's binding note (`queue.md`, 2026-10-07), verbatim:

> scheduling, rescheduling or immediately publishing an edition so that it would go live BEFORE a
> lower-numbered queued edition is REFUSED — no cancel/replace choice inside the dialog, no hidden
> cancellation. The refusal names the edition(s) in the way (number and scheduled time) and says
> what to do: cancel that edition, or reschedule it earlier; it is shown beside the date/time field
> per the form rules (an immediate publish shows it in the dialog's message), EN and ES, with its
> own domain error code (grep siblings for the name). Cancel and reschedule stay separate actions on
> each queued edition. **This REPLACES point (2) of the 10:00 note** ("the same explicit decision …
> not a bare refusal"); point (1)'s scenario still holds, as: bringing v3 ahead of v2 is refused;
> the manager cancels v2 (or moves it earlier), then reschedules v3; then v3 is live at its time, v2
> cancelled, the DRAFT unchanged, the next edition numbered v4. Test both refusals (reschedule and
> immediate publish) at the route and in the browser, and the scenario end to end. Amend the spec's
> §3 "explicitly cancel or replace" sentence with a dated note saying overtaking is refused and the
> manager cancels or reschedules the older edition first.

This plan applies it in both directions of the existing rule (moving a lower-numbered edition to
no earlier than a higher-numbered one would also put the newer version live first), with the
mirrored advice for that direction ("cancel it or move it later"; Decision 1). The code is the one
Task 1 landed, `menu_publication.overtakes_queued`, beside its `menu_publication.*` siblings
(`not_found`, `not_queued`, `time_past`, `unchanged`); the other `menu_*` families name their own
nouns (`menu_item.*`, `menu_period.*`, `menu_section.*`), so the name fits the family.

**Where they are tested:**
- (1) Task 3 case 1 (catalogue; case 1b is the "move v2 earlier" variant), Task 7 case 1 (route,
  real database), Task 11 case 1 (browser, English and Spanish).
- (2) The **reschedule refusal**, both directions: Task 3 case 2 (catalogue), Task 7 case 2
  (route, real database), Task 11 cases 1–2 (browser, English and Spanish, under the time field).
  The **immediate-publish refusal**: Task 1 case 5 (catalogue, landed), Task 3 case 4 (it clears
  once the edition in the way is cancelled), Task 6 case 4 (route, real database), Task 10 cases
  1–2 (browser, English and Spanish, in the preview's publish message). The **new-schedule
  refusal**: Task 1 case 5 (catalogue, landed), Task 7 case 3 (route), Task 9 case 3 (browser,
  English and Spanish).

The fixed timeline every scenario test uses (`Europe/Madrid`; the instants were measured above):
now = 2026-10-07 10:00 local (`08:00Z`); "tomorrow" = 2026-10-08 08:00 (`06:00Z`); "the day after"
= 2026-10-09 08:00 (`06:00Z`); "this afternoon" = 2026-10-07 16:00 (`14:00Z`).

---

## Global constraints

- **One transaction per request**, `gated`'s; queries on it awaited in turn, never `Promise.all`.
  Catalogue functions take the caller's `tx` and open none. A test expecting a refusal from a write
  catches it OUTSIDE the transaction, around the whole `withTransaction` (CLAUDE.md §3), and
  asserts the domain code with `toMatchObject({ code, params })`, never `toBeInstanceOf(Error)`.
- **Writes in this order:** settle, then insert or move the edition. No placement cancels
  anything; only `cancelMenuPublication` does.
- **Never move the live pointer to a lower number.** `settleDue` compares with the pointer's current
  number and leaves it when the candidate is not higher (a planted inconsistent row tests this).
- **The draft is never read for writing by queue, reschedule or cancel:** they write only
  `menu_versions` (queue), `menu_version_images` (queue), `menu_scheduled_publications` and
  `menu_publications`. Each task that adds a write asserts, with a `prepareQuery` spy as
  `menu-publication.test.ts:318-332` does, that every `insert`/`update`/`delete` statement it issues
  names only those tables.
- **"The draft tables"** below means every table the draft's document is built from: the
  dashboard's `MENU_PUBLICATION_READS` (`apps/dashboard/src/api/live-queries.ts:4-24`) less
  `menu_publications` and `menu_versions` — `catalogues`, `categories`, `category_details`,
  `content_languages`, `extra_list_items`, `extra_lists`, `menu_details`,
  `menu_item_variant_overrides`, `menu_items`, `option_labels`, `option_lists`,
  `product_modifiers`, `product_units`, `products`, `section_members`, `sections`, `units`. A
  "draft snapshot" is every row of each, ordered by its primary key.
- **Activation never changes a recorded line or a fiscal record:** it writes only
  `menu_scheduled_publications` and `menu_publications` (asserted by the same spy in Task 2), and a
  sale recorded before it keeps its `sale_lines.menu_version_id` and its line contexts (Task 2).
- **No till change.** Existing order lines keep their version; a new line after an activation is
  priced from the new live version, and a line asserting the old one is refused
  `menu.version_changed`, exactly as after an immediate publish today.
- Error codes: the table above; every file that throws one imports its registry (the typechecker
  refuses an unregistered code: `AppError`'s code is typed by the augmentation). A refused write
  writes nothing — compare the four publication tables before and after.
- Migrations: generated against the current tree, never numbered by this plan; read every
  generated `.sql` before running it; do not edit a shipped migration; no venue reset is needed
  (one new table, two recreated triggers, no rebuild).
- Coverage holds `98/98/98/95` in every package touched; no new `v8 ignore`, no exclude.
- Fixtures: use the existing ones and add only what a case needs. Catalogue tests use
  `menusFixture` (`packages/catalogue/test/menus-fixture.ts:54`): the menu under test is **Lunch**
  (`f.lunch`, "Lunch Menu", `:60`) and draft edits change **Soup**'s price (`f.soup`, €5.00, `:96`)
  through `updateProduct`, in steps €5.50, €6.00, €6.50, €7.00, €7.50 so every edition differs; a
  photo case sets Soup's `image` to `soup-a.jpg` then `soup-b.jpg` (the catalogue suite has no media
  triggers, so any name is accepted). Media tests use their file's own photos `PRESENT` and `ABSENT`
  (`packages/media/src/image-references.test.ts:44-45`) and its published menu. Route tests create
  a menu "Lunch" with a product "Soup" through the routes, as the route harness already does. Browser
  tests use the screen suite's `menu-lunch`, "Lunch Menu" (`apps/dashboard/src/screens/menus-screen.test.ts:136`).
  Venue zone `Europe/Madrid`. Person ids **manager-ana** and **manager-luis** where a test needs two.
- Inspect every changed screen in both themes at 390 px and 1280 px (Tasks 8–11).
- Schema-change guard commands (Tasks 1 and 4), read each run's `Tests` count:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/module-graph-honesty.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`.
- Every task ends with `pnpm format:check` and the touched packages' `typecheck`, then a commit
  with `git commit -s` and a plain-English message.

---

### Task 1: Store fixed queued editions; number, cancel and list them

**Files:** modify `packages/catalogue/src/schema/publication.ts`, `classification.ts`,
`errors.ts`, `menu-document-types.ts`, `menu-publication.ts` (`nextNumber`, `overtakenBy`, the
refusal in `publishMenu`), `index.ts`; create `src/menu-schedule.ts`,
`src/menu-schedule.test.ts`; one generated migration under `packages/catalogue/drizzle/`; growth
edits in `packages/catalogue/src/migrations.test.ts` (`TABLES` `:39-56` and the whole-shape maps of primary keys `:175`, foreign keys `:196`,
checks `:226` and indexes `:278`), `scripts/schema-constraints.test.ts` (rows beside `:152-155`, `:353-354`,
`:523`), `packages/composition/src/composition.test.ts:124-127` (forbidden list gains
`menu_scheduled_publications`), `apps/server/src/configuration-transfer.test.ts:1332` (the loop
gains it). If `scripts/migration-upgrade.test.ts` asks for `CANDIDATES` (`:440`) for the new
CHECKs, add exactly the entries it names, each with a one-line reason.

- [ ] **Failing tests first**, `packages/catalogue/src/menu-schedule.test.ts` (real database,
  `useCatalogueDb()` and `menusFixture` as `menu-publication.test.ts:13-58` do; explicit `at`
  instants, no fake timers). Lunch is published once as version 1 before each case.
  1. **A queued edition is fixed content.** Preview Lunch after raising Soup to €5.50 and setting
     its photo to `soup-a.jpg`; `queueMenuPublication(…, hash, 2026-10-08T06:00Z, "manager-ana", { at:
     2026-10-07T08:00Z })` → `{ number: 2, activatesAt: "2026-10-08T06:00:00.000Z" }`. Then change
     Soup back to €5.00 and its photo to `soup-b.jpg`. The version 2 row's `document`,
     `content_hash` and its `menu_version_images` filenames equal what the preview showed (€5.50,
     `soup-a.jpg`); `published_by` is manager-ana; the schedule row is `queued`, `queued_at` =
     `at`. Missing behaviour prints "queueMenuPublication is not a function", then a document
     carrying €5.00.
  2. **Numbers increase and are never reused.** Queue for the 8th, edit, queue for the 9th → 2,
     3. Cancel 3 (`cancelMenuPublication`) → its row is `cancelled` with `cancelled_by`
     manager-ana; edit and queue for the 10th → 4. Cancel 2 and queue again → 5.
  3. **A queued edition is not live.** After case 1, `menuStatus` still answers version 1 and
     `readLiveDocuments` the version 1 document (Task 2 makes due editions live).
  4. **Refusals, each writing nothing** (compare `menu_versions`, `menu_version_images`,
     `menu_publications`, `menu_scheduled_publications` before and after):
     a stale hash → `menu.changed_since_preview`; clashes → `menu.clashes_unresolved`; an unknown
     menu → `catalogue.not_found`; `activatesAt` equal to `at` and one minute before it →
     `menu_publication.time_past` `{ activatesAt }`; a draft identical to the live version with
     nothing queued → `menu_publication.unchanged` `{ menuId, number: 1 }`; a draft identical to
     queued version 2, queued after it → `unchanged` `{ number: 2 }`; but a draft identical to the
     live version 1 queued after a different version 2 is ACCEPTED as version 3 (going back to
     earlier content needs a new edition, spec §3).
  5. **Overtaking is refused.** With version 2 queued for the 9th:
     queuing for the 8th, and queuing for the 9th at the same minute, each refuse
     `menu_publication.overtakes_queued` `{ menuId, overtaken: [{ versionId: <v2>, number: 2,
     activatesAt: "2026-10-09T06:00:00.000Z" }] }`; queuing for the 10th succeeds.
     `publishMenu` with any edition queued refuses the same code naming every queued edition;
     with the draft equal to the live version it still returns version 1 and writes nothing
     (`menu-publication.test.ts:248` stays green).
  6. **Cancel and list.** `cancelMenuPublication` on an id that is no version, a version of Dinner,
     and the immediately published version 1 → `menu_publication.not_found`; on a cancelled one →
     `menu_publication.not_queued` `{ state: "cancelled" }`. `listMenuPublications` answers
     `live` `{ number: 1, since }` and the queued editions soonest first, then settled ones newest
     number first, at most ten settled (queue and cancel twelve to see the cap).
  7. **The schema refuses what the code never writes** (raw SQL, caught outside the transaction).
     This engine names only some constraints in its refusals (`packages/db/src/constraint-target.ts:95-106`
     records what each class reports, driven in `constraint-target.db.test.ts`), so each is
     identified the way that file says it can be:
     - two queued rows for one menu at one instant → `refusalOn(error, UNIQUE_VIOLATION, { table:
       "menu_scheduled_publications", columns: ["menu_id", "activates_at"] })` (`:148`; a column
       index reports its table and columns, not its name); a second row at that instant in state
       `cancelled` is accepted (the index is partial);
     - a `cancelled` row with no `cancelled_by` → `checkFailed(error,
       "menu_scheduled_publications_settled_ck")` (`:197`); `activates_at` before `queued_at` →
       `checkFailed(…, "menu_scheduled_publications_after_queue_ck")`; a `state` of `"paused"` →
       `checkFailed(…, "menu_scheduled_publications_state_ck")`;
     - a `version_id` of a Dinner version with `menu_id` of Lunch → `isRefusal(error,
       FOREIGN_KEY_VIOLATION)` (errcode 787; the message says only "FOREIGN KEY constraint failed"),
       with the control that the same row naming Lunch's own queued version is accepted, so the
       refusal is the pairing and not a missing row.
  8. **Writes touch only the publication tables:** spy `prepareQuery` around a queue and a cancel;
     every `insert`/`update`/`delete` names only `menu_versions`, `menu_version_images`,
     `menu_scheduled_publications`.
  Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-schedule.test.ts` and see them
  fail (no function, no table).
- [ ] Add the table and its constraints to `schema/publication.ts` as specified above, classify it,
  add the codes, generate (`pnpm --filter @waitron/catalogue db:generate`), read the SQL.
- [ ] Implement `nextNumber` (extracted from `publishMenu:455-459`, which then calls it),
  `overtakenBy` (the rule above, with `except`, which Task 3 removes), the refusal in
  `publishMenu` (only after the "already live" return, so a no-op publish stays a no-op), and
  `queueMenuPublication`, `cancelMenuPublication`, `listMenuPublications` in `menu-schedule.ts`.
  Queue checks, in order: build the document; clashes; hash; `activatesAt > at`; overtaken
  (refused); unchanged (the predecessor is the highest-numbered non-cancelled edition, live or
  queued); then insert the version (`published_at = at`, `published_by =
  personId`), its images exactly as `publishMenu:466-467`, and the schedule row.
- [ ] Run the new file, `src/menu-publication.test.ts src/menu-publication.live.test.ts
  src/migrations.test.ts src/schema/schema-conformance.test.ts` in `@waitron/catalogue`;
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`; the
  schema-change guard commands; `pnpm --filter @waitron/catalogue typecheck`;
  `pnpm format:check`.
- [ ] Commit: "Queue a fixed menu edition for a later time, numbered after every earlier one, and
  cancel it".

### Task 2: A due edition is live at once; settling moves the pointer forwards only

**Files:** `packages/catalogue/src/menu-publication.ts` (`liveVersions`, `statusOf`, `settleDue`,
`publishMenu` settles first), `menu-schedule.ts` (queue, cancel and list settle first;
`activateDueMenuPublications`), `index.ts`; tests in `src/menu-schedule.test.ts`,
`src/menu-publication.live.test.ts` (a second case), and a new `describe` in
`apps/server/src/till-api.sell-published.test.ts`.

- [ ] **Failing tests first** (catalogue, real database):
  1. **The read path at one instant, without a write.** Version 1 live; version 2 queued for
     `2026-10-08T06:00Z`. Faking `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`, restored in
     `afterEach`): at `05:59Z`, `menuStatus`, `readLiveDocuments`, `assertLiveVersions` and
     `previewMenu`'s `live` answer version 1; at `06:00Z` all four answer version 2, while
     `menu_publications` still names version 1 and the schedule row is still `queued`.
     `MenuStatus.publishedAt` at `06:00Z` is `"2026-10-08T06:00:00.000Z"`.
  2. **Several overdue: only the latest, straight away.** Versions 2, 3, 4 queued for the 8th,
     9th, 10th; at the 11th: every read answers version 4 (never 2 or 3), and
     `activateDueMenuPublications(tx, at)` marks all three `activated` (`activated_at` = `at`),
     moves the pointer once, from 1 to 4, with `published_at` = version 4's `activates_at`, and
     answers `activated: [{ menuId: <Lunch>, versionId: <v4>, number: 4 }]` and `nextDueAt:
     null`. A spy shows exactly one `update`/`insert` statement on `menu_publications`.
  3. **In sequence:** with the same three, activating at the 8th, then the 9th, then the 10th moves
     the pointer 1 → 2 → 3 → 4, and `nextDueAt` is the next queued instant each time.
  4. **Never backwards:** plant (raw SQL) a queued schedule row for version 2 after version 3 is
     live; activating marks it `activated` and leaves the pointer on 3.
  5. **Settle before a write:** version 2 due but unmarked; `cancelMenuPublication(v2)` refuses
     `menu_publication.not_queued` `{ state: "activated" }` — and the transaction rolled back, so
     the row is still `queued` (the refusal writes nothing, settle included); `publishMenu` of a
     new draft (nothing else queued) publishes version 3 over a pointer that the same transaction
     first moved to 2; `listMenuPublications` reports the unmarked due row as `activated`.
  6. **Activation writes only the two tables:** the `prepareQuery` spy around
     `activateDueMenuPublications` sees writes to `menu_scheduled_publications` and
     `menu_publications` only.
  7. **Statement shape kept:** `readLiveDocuments` with a due edition still issues one metadata
     statement and, warm, no statement containing `"document"` (`menu-publication.test.ts:333-377`
     stay green); the live read's SQL contains `from "menu_publications"` exactly once.
     **Batches:** `readLiveDocuments` over 1,001 published menus (planted rows) succeeds, and every
     live-read statement binds at most `BATCH_SIZE` values (read `params.length` off the spied
     queries). **Document mode:** with versions 2, 3 and 4 all due, `previewMenu`'s live document is
     version 4's, and the live-read statement returns at most two rows for that menu (the pointer's
     and the highest due one) — counted from the spied statement's result by running the same
     `.toSQL()` text directly.
  8. `menu-publication.live.test.ts`, a second case: activation announces `menu_publications` and
     `menu_scheduled_publications` to `subscribeToChanges` (the file's existing pattern, `:15-28`).
  **Sale path** (`apps/server/src/till-api.sell-published.test.ts`, a new `describe` "a basket that
  spans a scheduled activation", modelled on "a basket that spans a publish" `:328-462`, faking
  `Date` only and stepping it with `vi.setSystemTime`): that file's menu, version 1, serves its
  dish at the fixture's price; raise the price by €0.50 and queue version 2 one minute ahead; hold an order line priced from version 1;
  step past the activation (no duty runs):
  9. a line asserting version 1 → 409 `menu.version_changed` `{ menus: [{ menuId, liveVersionId:
     <v2> }] }` with nothing written; a line with no asserted version is priced at the raised
     price and records version 2 in `working_line_contexts.menu_version_id`; the held line still
     names version 1 at the old price; a sale paid before the step keeps `sale_lines.menu_version_id` = version 1 after
     `activateDueMenuPublications` runs; `/api/menu-state` names version 2.
  Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-schedule.test.ts
  src/menu-publication.live.test.ts` and `pnpm --filter @waitron/server exec vitest run
  src/till-api.sell-published.test.ts`; see the new cases fail (version 1 everywhere).
- [ ] Rewrite `liveVersions` as ONE statement per batch: today's `menu_publications ⋈
  menu_versions` part, `union all` the due part (`menu_scheduled_publications` with `state =
  'queued' and activates_at <= at` ⋈ `menu_versions`), each selecting the same columns plus `since`
  (`menu_publications.published_at`, `menu_scheduled_publications.activates_at`); keep, per menu,
  the row with the highest number. The due part returns only the highest-numbered due row per
  menu, chosen in SQL (a `row_number() over (partition by menu_id order by number desc)` derived
  table filtered to 1, or a `max(number)` subquery — if that subquery is correlated, check whether
  its outer table is the `.from()` base or a join and read `.toSQL()`, CLAUDE.md §3), so document
  mode never fetches the document of a due edition another due edition hides. The statement names
  the batch's ids in both halves, so batch at `BATCH_SIZE / 2` (`batches(menuIds, BATCH_SIZE / 2)`).
  Use drizzle's `unionAll` from `drizzle-orm/sqlite-core` or a raw
  `sql` statement; read the emitted SQL with `.toSQL()` and check with `explain query plan` that
  `menu_versions` is searched by its primary key (no full scan for the every-menu read
  `previewMenu` and `menuStatus` make). `statusOf` reports `since` as `publishedAt`.
- [ ] Implement `settleDue` (mark due queued rows, move the pointer per menu only upward, pointer
  `published_at` = the chosen row's `activates_at`) and `activateDueMenuPublications` (settle all,
  then the soonest queued `activates_at > at`); call `settleDue(tx, at, [menuId])` first in
  `publishMenu`, queue and cancel. `listMenuPublications` does not settle (it serves a GET, which
  writes nothing): it reports a due queued row as `activated` by comparing its time with `at`. Update the doc comments of
  `readLiveDocuments` and `menuStatus` to say "live at this instant" where they say "live" — and
  only that.
- [ ] Run the commands above plus `pnpm --filter @waitron/venue-service exec vitest run
  src/operations.test.ts` (the `:2312` and `:2384` pins) and `pnpm --filter @waitron/catalogue exec
  vitest run src/menu-publication.test.ts`; typechecks; `pnpm format:check`.
- [ ] Commit: "A queued menu edition is live from its time on every read, and settling it only ever
  moves the menu forwards".

### Task 3: Reschedule a queued edition, refused when it would overtake another (catalogue)

**Files:** `packages/catalogue/src/menu-publication.ts` (`overtakenBy` loses `except`; its doc
comment says why), `menu-schedule.ts` (`rescheduleMenuPublication`; queue keeps calling
`refuseOvertaken(menuId, await overtakenBy(…))` as Task 1 left it), `index.ts`; tests in
`src/menu-schedule.test.ts`; `docs/superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md`
already carries the dated note (added with this plan's amendment), so nothing to edit there.

**Why `except` goes.** `overtakenBy` matches only rows whose number is below or above `number`,
and a menu has one version per number (`menu_versions_menu_number_uq`, `publication.ts:26`), so
the edition being moved, passed with its own number, can never match either clause; `except`
cannot change an answer, and no test could fail when it is deleted (the ledger's note that it is
untested at `menu-publication.ts:476` is this). This was read, not run. The implementer confirms
it by deleting `except` and running the file of Task 1 plus this task's cases: all stay green. The
clause that IS untested, "a higher number placed no later" (`:482-485`; the ledger's `:483-486`), is covered by case 2(b)
below; confirm by deleting that clause after the cases pass and watching 2(b) and 2(c) fail with
an empty `overtaken` (no refusal), then restore it.

- [ ] **Failing tests first** (catalogue, real database, explicit `at`; "nothing written" means
  the four publication tables compare equal before and after, as Task 1's `publicationTables()`
  does):
  1. **Owner scenario (1), catalogue level.** v1 live (Soup €5.00); queue v2 for tomorrow (Soup
     €5.50 when queued); change Soup to €6.00; queue v3 for the day after; then change Soup to
     €7.50, so the draft differs from v1, v2 and v3 (without this edit the draft equals v3 and a
     draft reset to v3 would go unseen). Take the draft's preview hash and a draft snapshot.
     `rescheduleMenuPublication(v3, this afternoon)` → `menu_publication.overtakes_queued`
     `{ menuId: <Lunch>, overtaken: [{ versionId: <v2>, number: 2, activatesAt:
     "2026-10-08T06:00:00.000Z" }] }`, nothing written. `cancelMenuPublication(v2, "manager-ana")`;
     then `rescheduleMenuPublication(v3, this afternoon)` → `{ number: 3, activatesAt:
     "2026-10-07T14:00:00.000Z" }`; v2 is `cancelled` with `cancelled_by` manager-ana. The draft's
     preview hash and the draft snapshot are unchanged, and the preview still shows Soup at €7.50.
     At `14:00Z` every read answers v3; activating then and again at tomorrow `06:00Z` leaves v3
     live and v2 `cancelled`. Queue the unchanged €7.50 draft → number 4.
     **1b. The same, moving v2 earlier instead.** Same setup; `rescheduleMenuPublication(v2,
     2026-10-07 15:00 = 13:00Z)` succeeds; `rescheduleMenuPublication(v3, this afternoon)` now
     succeeds; nothing is cancelled. At `13:00Z` every read answers v2, at `14:00Z` v3;
     activating at `14:00Z` marks both `activated` and leaves the pointer on 3. The draft snapshot
     is unchanged. (Kept to catalogue level: its two moves both succeed, a route path case 1 of
     Task 7 already drives, while the order in which the two become live is catalogue logic.)
  2. **The reschedule refusal in both directions, each writing nothing.** v2 queued for tomorrow,
     v3 for the day after:
     (a) a higher number placed earlier: v3 to this afternoon, and v3 to exactly v2's instant
     (`2026-10-08T06:00Z`, equal instants count), each refuse naming v2 as case 1;
     (b) a lower number placed later: v2 to 2026-10-10 08:00, and v2 to exactly v3's instant
     (`2026-10-09T06:00Z`), each refuse naming `[{ versionId: <v3>, number: 3, activatesAt:
     "2026-10-09T06:00:00.000Z" }]`;
     (c) with v4 also queued for 2026-10-10 08:00, v2 to 2026-10-11 08:00 refuses naming v3 and v4
     in ascending number.
  3. **Moves that keep the order succeed:** v3 later (2026-10-10 08:00) and v2 earlier (still
     before v3) each succeed and return the new instant; rescheduling to the edition's own instant
     succeeds and leaves its row as it was.
  4. **An immediate publish refused for a queued edition goes through once it is cancelled:** with
     v2 queued and the draft changed, `publishMenu` refuses naming v2 (as Task 1 case 5);
     `cancelMenuPublication(v2)`; the same `publishMenu` answers `{ number: 3 }` and version 3 is
     live at once.
  5. **Refusals:** reschedule to a past instant → `time_past`; of an unknown id →
     `menu_publication.not_found`; of a version of Dinner → `not_found`; of a cancelled edition →
     `not_queued` `{ state: "cancelled" }`; of a due edition → `not_queued` `{ state: "activated" }`
     (settle first, and the refusal rolls the settle back, as Task 2 case 5).
  6. **Writes touch only the publication tables** (spy, as Task 1 case 8): a reschedule writes only
     `menu_scheduled_publications` (and `menu_publications` if its settle moved the pointer).
  7. **Concurrency** (`racePair`, `packages/catalogue/test/fixtures.ts:221`): two queues of
     different drafts for different times both succeed with numbers 2 and 3 — the first body
     queues the current draft for the 8th; the second body, which `racePair` holds until the first
     has committed, first sets Soup to €6.00 and then queues for the 9th using the hash of that new
     draft (both inside its own transaction). An activation racing an immediate publish while v2
     is due: the publish settles v2 first, so v2 is no longer queued and does not refuse it, and the
     pointer ends on version 3 whichever commits first (run both orders).
  Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-schedule.test.ts` and see the new
  cases fail (no `rescheduleMenuPublication`).
- [ ] Implement `rescheduleMenuPublication`: settle; find the menu's schedule row for the version
  (`not_found`); require `queued` (`not_queued`); `activatesAt > at` (`time_past`); read the
  version's number; `refuseOvertaken(menuId, await overtakenBy(tx, menuId, number, activatesAt))`;
  update `activates_at`. Remove `except` from `overtakenBy` and its doc comment. Do not add a way
  to cancel from inside a placement.
- [ ] Run the catalogue files of Tasks 1–2; typecheck; `pnpm format:check`.
- [ ] Commit: "Move a queued menu edition to another time, refused when it would go live out of
  number order".

### Task 4: A queued edition's photos are held like a live version's

**Files:** a hand-written media migration, created with
`pnpm --filter @waitron/media db:generate:custom --name=queued_edition_image_references` (its date
is after Task 1's catalogue migration, so the upgrade walk and every boot create the table first);
`packages/media/src/images.ts` (`ImageUsage`, `listImageUsages`, `countUsages`, the doc comments at
`:26-38, 61-62, 296-303, 540-546` that say "live"), `packages/media/src/dashboard/client.ts:24`,
`image-library.ts:34, 353-354`, `strings.ts` (English and Spanish), `dashboard/live-queries.ts`;
tests `packages/media/src/image-references.test.ts`, `images.test.ts`,
`dashboard/image-library.test.ts`, `schema/name-only-upgrade.test.ts` (a justified setup change,
see the step and "Assertions"); `docs/developers/conventions-data.md:990-1000` (the media
trigger paragraph); the comment of `scripts/behavioural-triggers.test.ts:100-105`.

- [ ] **Failing tests first.** `image-references.test.ts`, a new `describe` "an image a queued menu
  edition names" (the fixture `publishedOnly` at `:247-268`): "Lunch Menu" live with Toast showing
  `PRESENT`; put `ABSENT` into `media_images` as the case at `:280` does, switch Toast to it, and
  queue the edition. Then:
  1. deleting `ABSENT` is refused `menu_version_images_media_image_fk`, and renaming it is refused
     the same; `PRESENT` is still held by the live version;
  2. after `cancelMenuPublication` both succeed for `ABSENT`;
  3. queued again and activated: `ABSENT` is held (now through the pointer) and `PRESENT`, which
     only the superseded version names, can be deleted;
  4. a due but unmarked edition still holds its photo (its row is still `queued`).
  `name-only-upgrade.test.ts`: see the step below.
  `images.test.ts`: `listImageUsages` for the queued photo lists `{ kind:
  "scheduled_menu_version", id, menuId, menuName: "Lunch Menu", number: 2, activatesAt }` and
  `countUsages` (through `listImages`) counts it — the two stay in step (`images.ts:540-546`);
  `deleteImage` answers `{ deleted: false, uses: [that usage] }`. `image-library.test.ts`: the
  usage reads "Lunch Menu (Scheduled menu)" in English and "Lunch Menu (Carta programada)" in Spanish
  and links to `/manage/menus/menu/<id>`. Run `pnpm --filter @waitron/media exec vitest run
  src/image-references.test.ts src/images.test.ts src/dashboard/image-library.test.ts`; see them
  fail (the delete succeeds; no such usage).
- [ ] The migration: `DROP TRIGGER IF EXISTS` (as `0007_recreate_product_image_triggers.sql:2`
  does) and re-`CREATE TRIGGER`, with the same names and message,
  `menu_version_images_media_image_fk_parent_delete` and `…_parent_rename`. Each body keeps today's
  `exists (… JOIN menu_publications ON …)` clause word for word (`0005:143-147, 156-160`) and adds
  `OR exists (SELECT 1 FROM menu_version_images JOIN menu_scheduled_publications ON
  menu_scheduled_publications.version_id = menu_version_images.version_id WHERE
  menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued')`
  (inside the rename's `new.filename IS NOT old.filename AND (…)`). Keeping the JOIN on
  `menu_publications` keeps the edge `scripts/module-graph-honesty.test.ts:434` pins, and the new
  JOIN gives the edge media → catalogue on the new table, which media's `requires` already covers
  (`module.ts:30`). A one-line header names what the triggers guard, as `0006`'s does.
- [ ] `name-only-upgrade.test.ts`. Its second run applies the whole media folder (`:155`) and then
  requires all eleven triggers word for word (`:209-212`), which this migration's two rewrites
  break. Of the two ways to fix it, take the one that stays at least as strict: **stop that run at
  `0007_recreate_product_image_triggers`** — generalise `stageMediaBefore` (`:66-80`) to cut the
  journal at a given tag and stage a second folder cut at `0007` for `:155`. The existing
  word-for-word assertion is unchanged and still covers all eleven triggers through the upgrade it
  was written for (`0005`'s rebuild, and `0006`–`0007`). The other way, comparing nine word for
  word and only checking that the two rewritten ones contain the queued clause, would weaken two
  exact checks to substring checks, so it is not taken. Then ADD one case: apply the rest of the
  folder to the same database; the nine untouched triggers are still word for word as before, and
  each rewritten one contains both its original `JOIN menu_publications` clause and the
  `JOIN menu_scheduled_publications … state = 'queued'` clause. (The new triggers' behaviour is
  tested in `image-references.test.ts` above.)
- [ ] Add the usage kind (type in both files), its reads (same join, `state = 'queued'`), label
  strings `image.scheduled_menu` ("Scheduled menu" / "Carta programada"), and
  `menu_scheduled_publications` in media's `images` live query.
- [ ] Run the media files above, `pnpm --filter @waitron/media exec vitest run
  src/schema/name-only-upgrade.test.ts`, the schema-change guard commands, media typecheck,
  `pnpm format:check`.
- [ ] Commit the `name-only-upgrade.test.ts` setup change on its own first, its message naming the
  file, `:155` and `:209-212`, and the reason ("Assertions"). Then commit the rest: "Keep a photo
  while a queued menu edition names it, as a live version's photo is
  kept".

### Task 5: The activation duty, primary-only, started by boot

**Files:** create `apps/server/src/menu-activation.ts`, `menu-activation.test.ts`; modify
`apps/server/src/boot.ts` (start after `:2001`, `undoOnFailure` at once, `stopWork` list
`:2161`); tests in `boot.failed-start.test.ts` and `boot.test.ts`.

- [ ] **Failing tests first.** `menu-activation.test.ts` (real database: `useVenueDb` with
  `CORE_MIGRATIONS` and `CATALOGUE_MIGRATIONS`; an injected `timer` that records `ms` and keeps
  `fn`; a fixed `now`; a real `LiveEvents`):
  1. **Restart recovery:** two overdue queued editions and one future one → on start the pointer
     names the later overdue one, both overdue rows are `activated`, and the timer is armed for the
     future one (`ms` = its `activates_at` − now).
  2. **Fires at the due instant:** calling the recorded `fn` with `now` at the future instant
     activates it and arms `maxWaitMs` (nothing left). This case does not connect the change feed
     to the bus, so the duty's own write wakes nothing here; case 8 covers that.
  8. **Its own write wakes it once, and only once:** install the catalogue change feed
     (`installChangeFeed(db, CATALOGUE_CHANGE_SOURCES)`, as `menu-publication.live.test.ts:17` does)
     and connect it to the bus with `subscribeToChanges(changeSubscriber(bus, log))` (the test may
     call it; the duty must not). An activation is followed by exactly one more run, which writes
     nothing (no further change reaches the bus) and leaves the timer armed at `maxWaitMs`; the
     listener did not run that pass on the writer's stack (the writing run had returned before the
     extra run's transaction began). A `close` on the bus starts no run.
  3. **Re-armed by a queue change:** with a timer armed for the 9th, queue an edition for the 8th
     and publish `{ resources: [{ type: "menu_scheduled_publications" }] }` on the bus → the timer
     is re-armed for the 8th (the old one cancelled). A change of another type re-arms nothing.
  4. **Primary only:** `isPrimary` false → an overdue edition stays `queued` (reads still answer
     it), and the timer is armed at `maxWaitMs`; switching `isPrimary` to true, the next `fn`
     activates it.
  5. **A failing run** (a `db` whose transaction throws once) logs `menu_publication.activation_failed`
     with the code and re-arms; the next run activates.
  6. **No overlap:** a wake during a run (hold the first run on a latch) gives exactly one more
     run after it.
  7. **`stop()`** cancels the armed timer, unsubscribes (a later bus change arms nothing), and
     awaits a run in flight.
  `boot.failed-start.test.ts`: mock `./menu-activation.js` as `:41-59` mock the cloud workers; in a
  new case beside `:354` ("in trading mode, when a step after the listener is started throws"),
  assert the duty's `stop` was called once and the folder was given back. A new case under
  "closing a started server" (`:529`): `close()` calls the duty's `stop`.
  `boot.test.ts`, a new case beside `:2767`, on a FRESH venue folder, not the shared one: the
  edition rows it writes are append-only and could never be removed from a database every other
  case boots against. Make the folder with `freshVenue` (`:352`) and give it what a trading boot
  needs, as the shared folder's setup does (the tenant, location and node rows at `:308-325`), or move
  that seeding into a helper both use. Close the seeding handle before `startServer` and remove the
  folder afterwards.
  Seed through the catalogue functions, never raw SQL: create a menu, `publishMenu` it, then
  `queueMenuPublication` twice with past `at` values (`at` 2026-01-01, activations 2026-01-02 and
  2026-01-03, so both are overdue at boot). `startServer` on that folder; wait for the
  `menu_publication.activated` line; the pointer names version 3 and both rows are `activated`.
  Run `pnpm --filter @waitron/server exec vitest run src/menu-activation.test.ts
  src/boot.failed-start.test.ts src/boot.test.ts -t "menu"` and see them fail.
- [ ] Implement `startMenuActivation` as specified under "Seams"; each run is one
  `withTransaction(db, (tx) => activateDueMenuPublications(tx, now()))`. In `boot.ts`, after
  `:2001`: `const menuActivation = startMenuActivation({ db, bus: liveEvents, isPrimary: () =>
  holders.singletonRole.current === "primary", now, log, maxWaitMs: config.maxTickMs });
  undoOnFailure.push(() => menuActivation.stop());` and add `() => menuActivation.stop()` to
  `closeAll` before `() => liveEvents.close()`.
- [ ] Run the three files (the whole of `boot.failed-start.test.ts`), `src/health.test.ts`;
  server typecheck; `pnpm format:check`.
- [ ] Commit: "Activate due menu editions on the primary at their time, and on every start".

### Task 6: Queue, list and cancel through the management routes, in venue time

**Files:** create `apps/server/src/menu-publication-time.ts`, `menu-publication-time.test.ts`,
`apps/server/src/catalogue-api.menu-schedule.test.ts`; modify `apps/server/src/catalogue-api.ts`
(routes and `STATUS`; the publish route's body and handler are unchanged); `packages/venue-service/src/index.ts`
(export `localTimeOccurrences`, `offsetMinutes`, `isLocalDate`); `packages/catalogue/src/errors.ts`
(the three route codes).

- [ ] **Failing tests first.** `menu-publication-time.test.ts` (pure):
  `activationInstant({ date: "2026-10-08", time: "08:00" }, "Europe/Madrid")` →
  `2026-10-08T06:00:00Z`; `2027-03-28 02:30` → `menu_publication.time_skipped` `{ date, time }`;
  `2026-10-25 02:30` → `menu_publication.time_repeated` `{ date, time, occurrences: [{ at:
  "2026-10-25T00:30:00.000Z", offset: "+02:00" }, { at: "2026-10-25T01:30:00.000Z", offset:
  "+01:00" }] }`; with `occurrence: "earlier"` → `00:30Z`, `"later"` → `01:30Z`; `occurrence` on a
  time that occurs once is ignored; `date: "2026-02-30"` → `management.request_invalid` `{ field:
  "activatesAt.date" }`; `time: "24:00"` and `"8:00"` → `field: "activatesAt.time"`;
  `occurrence: "middle"` → `field: "activatesAt.occurrence"`; a non-object → `field:
  "activatesAt"`; zone `"Mars/Olympus"` → `menu_publication.clock_unreadable`.
  `localTimeOf(2026-10-25T00:30Z)` → `{ date: "2026-10-25", time: "02:30", offset: "+02:00",
  repeated: true }`; `localTimeOf(2026-10-08T06:00Z)` → `{ …, time: "08:00", offset: "+02:00",
  repeated: false }`.
  `catalogue-api.menu-schedule.test.ts` (real database, the setup of
  `catalogue-api.test.ts:486-560` — core, catalogue, identity sets; a manager and a staff session;
  a location in `Europe/Madrid`; `venueCfg`; `vi.useFakeTimers({ toFake: ["Date"] })` set to the fixed "now" BEFORE the
  sessions are started, so no session reads as started in the future or idle past its limit when
  the clock is stepped; if a step of a day expires a session, start a fresh one after the step):
  1. `POST …/publications` with `{ expectedHash, activatesAt: { date: "2026-10-08", time: "08:00" } }`
     → 201 `{ versionId, number: 2, activatesAt: "2026-10-08T06:00:00.000Z" }`; `GET
     …/publications` → `timeZone: "Europe/Madrid"`, `live.number` 1, one edition `queued` with
     `local: { date: "2026-10-08", time: "08:00", offset: "+02:00", repeated: false }`.
  2. Autumn 02:30 without `occurrence` → 400 `menu_publication.time_repeated` with both
     occurrences, nothing written; with `"later"` → 201 at `01:30Z`, and `GET` shows that edition
     `local.repeated: true, offset: "+01:00"`. Spring 02:30 → 400 `time_skipped`. 09:59 today → 400
     `time_past`.
  3. `POST …/publications/:versionId/cancel` → 204; again → 409 `not_queued`; a version of another
     menu → 404 `menu_publication.not_found`; a malformed id → 400 `shared.invalid_id`.
  4. **The immediate-publish refusal (owner requirement 2).** With v2 queued and the draft
     changed, `POST …/publish` → 409 `menu_publication.overtakes_queued` `{ menuId, overtaken:
     [{ versionId: <v2>, number: 2, activatesAt: "2026-10-08T06:00:00.000Z" }] }`, and `GET
     …/publications`, `GET …/status` and the four publication tables are unchanged. `POST
     …/publications/<v2>/cancel` → 204; the same `POST …/publish` → 200 `{ versionId, number: 3 }`,
     live at once. With nothing queued, `{ expectedHash }` behaves as today (the existing
     "publishing a menu" cases in `catalogue-api.test.ts:4406` stay green).
  5. A queue whose draft changed since the preview → 409 `menu.changed_since_preview`; a draft
     identical to the live version → 409 `menu_publication.unchanged`.
  6. Each new route with the staff session → 403 `authorization.not_permitted`, nothing written.
  Run `pnpm --filter @waitron/server exec vitest run src/menu-publication-time.test.ts
  src/catalogue-api.menu-schedule.test.ts` and see them fail.
- [ ] Implement the time module on `localTimeOccurrences`, `offsetMinutes`, `isLocalDate`
  (venue-service, now exported) and `validateTimeZone`, `civilDateOf` (`@waitron/reporting`) — no
  second parser. Routes: read the clock with `readLocationClock(tx, requireVenueCfg(deps).locationId)`
  inside `gated`, call the time module, then the catalogue function with the person id. No route
  reads a field that would cancel an edition. Add the eight codes to `STATUS` (the publish route
  needs only `overtakes_queued`'s 409, which the catalogue already throws).
- [ ] Run the two files plus `src/catalogue-api.test.ts -t "publishing a menu"` and
  `pnpm --filter @waitron/venue-service exec vitest run src/hours-clock.test.ts` (it covers
  `localTimeOccurrences`, `hours-clock.test.ts:45`); typechecks; `pnpm format:check`.
- [ ] Commit: "Queue, list and cancel menu editions from the dashboard's routes, entered in the
  venue's local time".

### Task 7: Reschedule through the routes; the owner's scenarios against a real database

**Files:** `apps/server/src/catalogue-api.ts` (the `PATCH` route);
`apps/server/src/catalogue-api.menu-schedule.test.ts`; `docs/developers/product-categories.md:185-191`
(the publish route paragraph, plus the new routes and codes).

- [ ] **Failing tests first** (same file and setup as Task 6):
  1. **Owner scenario (1), through the routes.** Publish v1 (Soup at its menu price €5.00); set
     Soup's menu price to €5.50 through `PATCH …/items/:itemId` and `POST` v2 for 2026-10-08 08:00;
     set €6.00 and `POST` v3 for 2026-10-09 08:00; then set €7.50, so the draft differs from v1, v2
     and v3 (without this edit the draft equals v3, and a draft reset to v3 would go unseen). Read
     the preview hash, `GET …/structure`, and take a draft snapshot straight from the suite's
     database (every draft table, Global constraints). `PATCH …/publications/<v3>` with
     `{ activatesAt: { date: "2026-10-07", time: "16:00" } }` → 409
     `menu_publication.overtakes_queued` `{ menuId, overtaken: [{ versionId: <v2>, number: 2,
     activatesAt: "2026-10-08T06:00:00.000Z" }] }`, and `GET …/publications` unchanged. `POST
     …/publications/<v2>/cancel` → 204. The same `PATCH` again → 200 `{ number: 3, activatesAt:
     "2026-10-07T14:00:00.000Z" }`; `GET …/publications` shows v2 `cancelled` and v3 `queued` at
     `local: { date: "2026-10-07", time: "16:00", … }`. The preview hash, the structure answer and
     the draft snapshot are unchanged, and the preview still prices Soup at €7.50. Step the clock
     to 16:00:30 local: `GET …/status` → version 3 live; step to 2026-10-08 08:00:30 and call
     `activateDueMenuPublications`: version 3 still live, v2 still `cancelled`. `POST` the
     unchanged €7.50 draft → `number: 4`.
  2. **The reschedule refusal in both directions (owner requirement 2).** v2 for 2026-10-08 08:00,
     v3 for 2026-10-09 08:00: (a) `PATCH` v3 to 2026-10-07 16:00 → 409 naming v2; (b) `PATCH` v2 to
     2026-10-10 08:00 → 409 naming `[{ versionId: <v3>, number: 3, activatesAt:
     "2026-10-09T06:00:00.000Z" }]`. After each, `GET …/publications` and the four publication
     tables are unchanged. A request body that also carries `overtaken: "cancel"` gets the same
     409 and changes nothing (the field means nothing to the route).
  3. **The same refusal shape for the three triggers:** the 409 bodies of an overtaking `POST
     …/publications` (a new edition for 2026-10-08 08:00 while v2 is queued for that minute),
     `PATCH …/publications/:id` and `POST …/publish` have the same code and the same
     `params.overtaken` element shape.
  4. `PATCH` refusals: a repeated time without occurrence → 400 `time_repeated`; past → 400; a
     cancelled edition → 409 `not_queued`; unknown → 404; staff → 403.
  5. **Concurrency** (`Promise.all` of two `app.request` calls: two transactions, which the write
     queue runs one after the other). There is one draft, so two different drafts cannot race here;
     that race is Task 3 case 7, at catalogue level with `racePair`. (a) Two `POST …/publications`
     of the same draft for the SAME minute: exactly one 201 (number 2), one 409
     `menu_publication.overtakes_queued` naming number 2 (whichever runs second finds an edition at
     that instant; equal instants overtake, and the overtake check comes before the unchanged
     check), and one schedule row. (Different minutes would make the loser's code depend on which
     ran first: `unchanged` if it was later, `overtakes_queued` if earlier.) (b) A `POST
     …/publications` against a `POST …/publish` of the same draft: exactly one succeeds. Queue
     first: the publish is refused `overtakes_queued` naming the queued edition, which stays
     queued. Publish first: the queue is refused `menu_publication.unchanged` (the draft is now
     the live version) and nothing is queued. Either way every queued edition's number is above
     the live number, and nothing is cancelled.
  Run the file and see the new cases fail (no `PATCH` route).
- [ ] Add the route; update `product-categories.md` (state what the routes do and refuse, that an
  overtaking request is refused and how the manager clears it, and that `publishedAt` in a status
  is when the live version became live).
- [ ] Run the file, `src/catalogue-api.test.ts -t "publishing a menu"`, typecheck,
  `pnpm format:check`.
- [ ] Commit: "Move a queued menu edition through the routes, refused when it would go live out of
  number order".

### Task 8: Menus shows the queue and cancels an edition

**Files:** `apps/dashboard/src/api/client.ts` (`getMenuPublications`,
`scheduleMenuPublication`, `rescheduleMenuPublication`, `cancelMenuPublication`; `publishMenu`
is unchanged),
`api/live-queries.ts` (`menu_scheduled_publications` in `MENU_PUBLICATION_READS`; a
`getMenuPublications` entry over `menu_scheduled_publications`, `menu_publications`,
`menu_versions`, `locations`); create `apps/dashboard/src/widgets/menu-publications.ts`,
`menu-publications.test.ts`, `menu-publications.a11y.test.ts`; modify `widgets/menu-preview.ts`
(a `<slot name="schedule">` after `#renderPublish()`, always rendered), `screens/menus-screen.ts`
(`#renderPreview` puts `<dashboard-menu-publications slot="schedule" .api menuId menuName
.preview>` inside the preview element); `i18n/strings.ts`, `i18n/codes.ts`, `i18n/codes.test.ts`;
stub growth, no assertion changes, in every suite that opens the Preview tab with its own stub
(the new widget reads `getMenuPublications` there): `screens/menus-screen.test.ts` (its stub at
`:530-590` gains `getMenuPublications` answering an empty queue and `vi.fn()` mocks for
`scheduleMenuPublication`, `rescheduleMenuPublication` and `cancelMenuPublication`, and those
three join `WRITES` `:327-345` — `writeCalls` reads `.mock` of every name in `WRITES`, `:595-598`,
so each needs a mock function in the stub; `publishMenu` is already there),
`screens/menus-screen.a11y.test.ts` (its "accessible Preview tab" case, `:368`),
`screens/menus-screen.heading.test.ts` (its stub `:95-101`, used on `PREVIEW_PATH` `:27`) and
`screens/menu-details.unsaved.test.ts` (its stub at `:160-170`). Each gains a
`getMenuPublications` answering an empty queue.

- [ ] **Failing browser tests first** (`menu-publications.test.ts`, a stubbed api as
  `menus-screen.test.ts:530-560` builds one):
  1. The widget reads `getMenuPublications(menuId)` and lists each edition in a `wt-data-table`:
     "Version 2", the venue-local "8 Oct 2026, 08:00" (from `local`), "Scheduled"; a cancelled one
     "Cancelled"; an activated one "Activated". A repeated local time shows its offset
     ("25 Oct 2026, 02:30 (UTC+01:00)"); a single one does not. The same in Spanish ("Versión 2",
     "Programada", "Cancelada", "Activada").
  2. The row menu is the `actions` column, `pinned: "end"`, a `wt-row-actions` with "Cancel this
     version" (and, in Task 11, "Change time") for queued rows only; settled rows have none.
  3. Cancel asks first in a `wt-dialog` ("Cancel version 2, scheduled for 8 Oct 2026, 08:00? Its
     number is not used again."); "Keep it" sends nothing; confirming calls
     `cancelMenuPublication("menu-lunch", <v2>)` once; a refusal (`not_queued`) shows its sentence
     in the dialog's bottom message and keeps the dialog open.
  4. An empty queue shows "No versions are scheduled." A read failure shows an error with Retry.
  5. Live: an invalidation of `menu_scheduled_publications` re-reads the list.
  `codes.test.ts`: a case "has English and Spanish copy for each menu publication code" over the
  eight codes. `menus-screen.test.ts`: one new case — the Preview tab renders the publications
  widget for the open menu with the preview it read.
  `menu-publications.a11y.test.ts`: the empty, loading, failed and listed states and the cancel
  dialog, in both themes. Run `pnpm --filter @waitron/dashboard exec vitest run
  src/widgets/menu-publications.test.ts src/widgets/menu-publications.a11y.test.ts
  src/i18n/codes.test.ts` and see them fail.
- [ ] Implement with shared primitives only (`wt-data-table`, `wt-row-actions`, `wt-dialog`,
  `wt-form-actions`, `wt-button`); cells styled with `part=`; every colour and space a `--wt-*`
  token. The widget owns a `DashboardQueries` for `getMenuPublications`. English and Spanish
  strings for everything shown; wording for all eight codes in `codes.ts`. `codeMessage` reads no
  params, so `overtakes_queued`'s `codes.ts` sentence is the fallback that names no edition
  (English "A version that is already scheduled would go live in the wrong order. Cancel it or
  change its time, then try again."; Spanish "Una versión ya programada se publicaría en el orden
  equivocado. Cancélala o cambia su hora y vuelve a intentarlo."); Tasks 9–11 show the sentence
  that names each edition.
- [ ] Run the files above, `src/screens/menus-screen.test.ts src/screens/menus-screen.a11y.test.ts
  src/screens/menus-screen.heading.test.ts src/screens/menu-details.unsaved.test.ts
  src/widgets/menu-preview.test.ts src/api/live-queries.test.ts`, `pnpm exec vitest run scripts/live-subscriptions.test.ts
  scripts/pinned-actions-column.test.ts scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts`; dashboard typecheck; `pnpm format:check`. Check memory
  headroom before the browser runs (CLAUDE.md §2).
- [ ] Commit: "Show a menu's scheduled versions on its Preview tab, and cancel one after asking".

### Task 9: Schedule a publication at a venue-local date and time; name the editions in the way

**Files:** `apps/dashboard/src/widgets/menu-publications.ts` (the schedule form, and the exported
pure helper `overtakeSentence`), `menu-publications.test.ts`, its a11y file; create
`menu-publications.unsaved.test.ts`; `i18n/strings.ts`.

**The overtake sentence** (used by Tasks 9, 10 and 11). `overtakeSentence(overtaken, placed,
answer)`: `overtaken` is the refusal's `params.overtaken`; `placed` is the number of the edition
being moved, or `null` for a new edition or an immediate publish (which is above every number);
`answer` is a `MenuPublicationsAnswer` read AFTER the refusal (the caller reads
`getMenuPublications(menuId)` once). Each edition in the way is named by its number and its
venue-local time from the matching `answer.editions[].local` (by `versionId`), formatted as the
list formats it (Task 8 case 1: "8 Oct 2026, 08:00", the offset added only for a time that occurs
twice). Editions with a number below `placed` (all of them when `placed` is `null`) must go live
first, so the advice is "cancel it or move it earlier"; editions above it must go live after, so
the advice is "cancel it or move it later". One sentence per non-empty group, the editions joined
with `Intl.ListFormat` in the screen language. It returns `null` when an edition the refusal names
is not in the answer (the queue changed meanwhile) — the caller then shows `codeMessage(code)`, as
it does when the read itself fails. Strings (`menu_publications.*`, beside the widget's own):

| Key | English | Spanish |
| --- | --- | --- |
| `in_the_way_earlier` | Version {number}, scheduled for {time}, must go live first. Cancel it or move it earlier, then try again. | La versión {number}, programada para el {time}, debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo. |
| `in_the_way_earlier_many` | Versions {list} must go live first. Cancel them or move them earlier, then try again. | Las versiones {list} deben publicarse antes. Cancélalas o adelántalas y vuelve a intentarlo. |
| `in_the_way_later` | Version {number}, scheduled for {time}, must go live after this one. Cancel it or move it later, then try again. | La versión {number}, programada para el {time}, debe publicarse después de esta. Cancélala o retrásala y vuelve a intentarlo. |
| `in_the_way_later_many` | Versions {list} must go live after this one. Cancel them or move them later, then try again. | Las versiones {list} deben publicarse después de esta. Cancélalas o retrásalas y vuelve a intentarlo. |

`{list}` items read "2 (8 Oct 2026, 08:00)" / "2 (8 oct 2026, 08:00)", so two read "Versions 2 (8
Oct 2026, 08:00) and 3 (9 Oct 2026, 08:00) must go live first. …".

- [ ] **Failing browser tests first:**
  1. "Schedule a publication…" opens a `wt-dialog` form with a required date `wt-input
     type="date"` named `date` and a required time `wt-input type="time"` named `time`, both
     marked; "Schedule" works until the first submission; empty fields then show their sentences
     beside each field and one bottom sentence ("Correct the highlighted fields to continue."),
     focus goes to the first invalid field, and the action stays disabled until they are filled.
  2. A valid entry calls `scheduleMenuPublication("menu-lunch", { expectedHash: <preview hash>,
     activatesAt: { date, time } })` once; on success the dialog closes and the list re-reads.
  3. **The new-schedule refusal (owner requirement 2), English and Spanish** (restore the language
     after each case, CLAUDE.md §4). With v2 queued for 8 Oct 08:00, scheduling for 2026-10-08
     08:00 is refused `menu_publication.overtakes_queued` naming v2: `getMenuPublications` is read
     once more, the time field shows "Version 2, scheduled for 8 Oct 2026, 08:00, must go live
     first. Cancel it or move it earlier, then try again." (Spanish "La versión 2, programada para
     el 8 oct 2026, 08:00, debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo."),
     the bottom message is "Correct the highlighted fields to continue.", the entered values stay,
     the dialog stays open, and "Schedule" stays enabled (a refusal never disables the action).
     Changing the time removes the field's sentence and the bottom message. With two editions in
     the way the sentence reads the `_many` form; when the re-read fails, or no longer lists a
     named edition, the field shows the `codes.ts` fallback instead. Nothing in the dialog offers
     to cancel anything.
  4. `overtakeSentence` directly (pure): `placed` 3 with v2 in the way → the "earlier" sentence;
     `placed` 2 with v3 in the way → the "later" sentence; a repeated local time carries its offset
     ("25 Oct 2026, 02:30 (UTC+01:00)"); a mix of lower and higher numbers gives both sentences,
     lower first; a named edition missing from the answer → `null`.
  5. `menu_publication.time_skipped` → its sentence under the time field ("The clock skips 02:30 on
     28 Mar 2027. Choose another time."), action enabled; `time_past` → under the time field;
     `menu.changed_since_preview` and `menu_publication.unchanged` → the bottom message only.
  6. `menu_publication.time_repeated` → a required `wt-combobox` named `occurrence` appears under
     the time field, offering "First 02:30 (UTC+02:00)" and "Second 02:30 (UTC+01:00)" from the
     refusal's `occurrences`, with the sentence "02:30 happens twice on 25 Oct 2026, because the
     clocks go back. Choose which." The action is disabled until one is chosen; choosing "Second"
     and submitting sends `occurrence: "later"`; changing the date or time removes the field. In
     Spanish: "Primera 02:30 (UTC+02:00)", "Segunda 02:30 (UTC+01:00)".
  7. The button is absent while the preview has clashes or failed to load, and when the draft's
     hash equals the latest scheduled-or-live edition's `contentHash`.
  `menu-publications.unsaved.test.ts`, modelled on `shift-dialog.unsaved.test.ts`: a typed date
  warns on Escape and on leaving the screen; a submitted value cleared by success does not.
  a11y: the form untouched, with field errors, with the overtake sentence under the time field, and
  with the occurrence choice, both themes.
  Run the three files and see them fail.
- [ ] Implement following the forms contract (`design-system.md:1379` onwards) with a draft scope
  from `leaveCoordinatorFor`. Every refusal is placed by what its code carries. The overtake
  refusal goes under the TIME field: its code is thrown only for the instant the request asked
  for (`menu-schedule.ts`, `menu-publication.ts`, Task 3's reschedule), as `time_past`'s is, and
  this plan places both under the same field.
- [ ] Run the widget's three files and `src/screens/menus-screen.test.ts`; dashboard typecheck;
  `pnpm format:check`.
- [ ] Commit: "Schedule a menu publication for a date and time in the venue's clock, name the
  versions that are in the way, and ask which 02:30 when the clocks go back".

### Task 10: An immediate publish refused for a queued edition names it

**Files:** `apps/dashboard/src/screens/menus-screen.ts` (`#publish` `:1266-1300` builds the
refusal's sentence); test `screens/menus-screen.test.ts`. No new component, no dialog: the refusal
is shown where every publish refusal is shown today, the preview's result paragraph (survey §3).
The owner's watcher note says an immediate publish shows it "in the dialog's message"; no dialog is
open when the answer comes back (the warnings dialog closes as the request is sent, and a draft
with no warnings opens none), so the result paragraph is that message (Decision 1).

- [ ] **Failing browser tests first** (`menus-screen.test.ts`; restore the language after each
  case):
  1. **The immediate-publish refusal (owner requirement 2), English and Spanish.** `publishMenu`
     rejects with `menu_publication.overtakes_queued` naming v2 (8 Oct 2026, 08:00), and the
     stub's `getMenuPublications` lists v2 with that `local`. After pressing Publish, the result
     paragraph reads "Lunch Menu was not published: version 1 is still live. Your changes are
     still saved. Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move
     it earlier, then try again." and in Spanish "No se ha publicado Lunch Menu: la versión 1 sigue
     publicada. Tus cambios siguen guardados. La versión 2, programada para el 8 oct 2026, 08:00,
     debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo."
     `client.publishMenu.mock.calls` is `[["menu-lunch", LUNCH_HASH]]`; the Publish button is still
     offered and enabled; nothing else was written (`writeCalls`).
  2. The same through the warnings confirmation: confirming sends one publish, the dialog closes
     as today, and the refusal shows in the result paragraph as in case 1.
  3. When `getMenuPublications` rejects after the refusal, the result paragraph carries the
     `codes.ts` fallback sentence instead. Publishing with nothing queued still sends exactly two
     arguments (the pins at `:5205, :5269` stay green).
  Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts` and see
  the new cases fail.
- [ ] Implement: in `#publish`'s catch, for `menu_publication.overtakes_queued` read
  `this.api.getMenuPublications(menuId)` once and set the reason to `overtakeSentence(overtaken,
  null, answer) ?? codeMessage(code)`; a failed read gives `codeMessage(code)`. Other refusals
  behave as today, including the path for a refusal that lands after the person left the menu.
- [ ] Run the file, `src/screens/menus-screen.a11y.test.ts`, dashboard typecheck,
  `pnpm format:check`.
- [ ] Commit: "When a publish is refused because a version is already scheduled, say which version
  and what to do".

### Task 11: Change a queued version's time, and the owner's scenarios in the browser

**Files:** `widgets/menu-publications.ts` ("Change time" row action and dialog, the overtake
refusal for a reschedule), tests `menu-publications.test.ts`, `menu-publications.unsaved.test.ts`,
the widget's a11y file; `i18n/strings.ts`; `docs/developers/design-system.md` (a paragraph after
the Menus list one at `:691-700`); `docs/backlog.md` (the entry at `:1023-1033`).

- [ ] **Failing browser tests first.** A stateful stub keeps the editions, answers the overtake
  refusal by the rule (the "rule this plan enforces" above), cancels on `cancelMenuPublication`,
  and has a draft hash the test changes to stand for a draft edit. Each case runs in English and
  in Spanish (restore the language after each).
  1. **Owner scenario (1), browser.** v1 live. Schedule v2 for 2026-10-08 08:00; change the stub's
     draft hash (an edit); schedule v3 for 2026-10-09 08:00; change the draft hash again, so the
     draft differs from v3 (and from v1 and v2). "Change time" on v3 to 2026-10-07 16:00 → the
     time field shows "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or
     move it earlier, then try again." (Spanish as in Task 9 case 3), the bottom message "Correct
     the highlighted fields to continue.", the values kept, "Change time" enabled, the list
     unchanged, and the dialog offers nothing that cancels. Close the dialog. "Cancel this
     version" on v2 and confirm → `cancelMenuPublication("menu-lunch", <v2>)` once; the list shows
     v2 "Cancelled". "Change time" on v3 to 2026-10-07 16:00 again →
     `rescheduleMenuPublication("menu-lunch", <v3>, { activatesAt: { date: "2026-10-07", time:
     "16:00" } })`, the dialog closes, and the list shows v3 "Scheduled" at 7 Oct 2026, 16:00. No
     draft-writing method was called (`writeCalls` names only the two schedules, the two
     reschedules and the cancel), the preview's hash is the one set before the first reschedule,
     and "Schedule a publication…" is still offered (the draft differs from every edition, so Task
     9 case 7 does not hide it); scheduling now answers version 4.
  2. **The reschedule refusal, later direction (owner requirement 2).** v2 for 8 Oct, v3 for 9 Oct.
     "Change time" on v2 to 2026-10-10 08:00 → the time field shows "Version 3, scheduled for 9 Oct
     2026, 08:00, must go live after this one. Cancel it or move it later, then try again." (Spanish
     "La versión 3, programada para el 9 oct 2026, 08:00, debe publicarse después de esta.
     Cancélala o retrásala y vuelve a intentarlo."); the list is unchanged; exactly one reschedule
     request was sent, and no cancel.
  3. The "Change time" form starts at the edition's local date and time, follows the Task 9 rules
     (skipped, repeated, past), and has a draft scope (`menu-publications.unsaved.test.ts` gains its
     case). The row action appears on queued rows only (Task 8 case 2), beside "Cancel this
     version", as two separate actions.
  a11y: the "Change time" form untouched, with the overtake sentence, and with the occurrence
  choice, both themes.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-publications.test.ts
  src/widgets/menu-publications.unsaved.test.ts src/widgets/menu-publications.a11y.test.ts` and see
  the new cases fail.
- [ ] Implement, reusing Task 9's form and `overtakeSentence` (with `placed` = the moved edition's
  number).
- [ ] Visual check: `wa-wt demo <this worktree's name>`, sign in, open a menu's Preview tab, queue
  two editions, then trigger the refusal from a new schedule, from "Change time" in each direction
  and from Publish; look in light and dark at 390 px and 1280 px (the row menu stays on screen at
  390 px; the sentence under the time field wraps without overflow).
- [ ] Docs: the design-system paragraph (where the queue sits, what each state says, and that an
  overtaking request is refused with a sentence naming each version in the way, under the time
  field or in the publish result, never with a choice to cancel); `docs/backlog.md`: the entry says
  W99 is done with this PR, and that the menus list still shows "Unpublished" for a menu whose only
  edition is queued (Decision 11).
- [ ] Run every dashboard file of Tasks 8–11, the root guards of Task 8, dashboard typecheck,
  `pnpm format:check`.
- [ ] Commit: "Move a queued menu version to another time, refused with the versions in the way
  named".
- [ ] During `/finish-branch`: the pre-push hook once; current-head CI for catalogue, media,
  server, dashboard and the root guards; the migration jobs; the duty's failed-start case.

---

## Review focus

1. A draft edit after queuing cannot change the queued edition's content or photos, and a queued
   edition's photo cannot be deleted or renamed until it is cancelled or superseded (Task 1 case 1,
   Task 4).
2. Several overdue editions after a restart expose only the latest, at once, in reads and in the
   single pointer write (Task 2 cases 1–2, Task 5 case 1 and the boot case).
3. No path leaves a lower-numbered queued edition able to activate after a higher one: new queue,
   immediate publish, reschedule earlier, reschedule later, equal instants (Task 1 case 5, Task 3
   cases 1–4, Task 7 cases 1–3).
4. Overtaking is refused the same way for all three triggers, writes nothing (settle included),
   and cancels nothing; no request field, dialog or button turns it into a cancellation; the
   sentence names each edition in the way with its venue-local time and the right advice for its
   direction (Task 2 case 5, Task 3 case 2, Task 6 case 4, Task 7 cases 2–3, Tasks 9–11). The
   overtake sentence is placed under the time field, and a publish's in its result paragraph;
   check that against the forms contract (Task 9's last step gives the reasoning).
5. The draft is never touched by queue, reschedule, cancel or activation (the write spies; Task 3
   case 1 and Task 7 case 1, each with a draft edited after v3 so it differs from every edition,
   and a snapshot of every draft table; Task 11 case 1).
6. Clock-change input cannot silently pick the wrong occurrence (Task 6 time cases, Task 9 case 6).
7. Concurrency: no duplicate number, no backwards pointer (Task 3 case 7, Task 7 case 5).
8. The live read stays one statement with the pinned SQL shapes, and the sale path is unchanged
   except for reading the right version (Task 2 cases 7, 9).
9. The duty is primary-only, stops on a failed start and on close, and cannot take the change
   feed's one-shot test mock (Task 5).

---

## Assertions

**One justified change to an existing test (Task 4).** `packages/media/src/schema/name-only-upgrade.test.ts`
compares the eleven triggers that name `media_images` word for word after applying the WHOLE
media folder (`:155`, asserted at `:209-212`). The spec changes what two of them check (a queued
edition's photos are held, spec §9 "Publication snapshots"), so after Task 4's migration that
comparison fails by design. The assertion at `:209-212` stays as it is; its run is cut at
`0007_recreate_product_image_triggers` instead of the folder's end (a setup change, by
generalising `stageMediaBefore`, `:66-80`), so all eleven keep their word-for-word check across
the upgrade the file exists to test, and a new case covers the folder's end. This is the stricter
of the two options (the other compares only nine word for word). Make it in its own commit whose
message names the file, the lines, and this reason.

No other existing assertion is expected to change. **Growth and fixture edits allowed** (each named in
its task): `packages/catalogue/src/migrations.test.ts` `TABLES` and its key/check maps gain the new
table; `scripts/schema-constraints.test.ts` gains its keys, index and checks;
`packages/composition/src/composition.test.ts:124-127` and
`apps/server/src/configuration-transfer.test.ts:1332` gain the table name in their "never
transferred" lists; `scripts/migration-upgrade.test.ts` `CANDIDATES` only as the walk asks;
`apps/dashboard/src/screens/menus-screen.test.ts` gains a `getMenuPublications` stub, mock
functions for the three new writes and their names in `WRITES`, and
`menus-screen.a11y.test.ts`, `menus-screen.heading.test.ts` and `menu-details.unsaved.test.ts`
each gain a `getMenuPublications` stub (Task 8); the comment (not the list) of `scripts/behavioural-triggers.test.ts:100-105`
and the doc comments in `packages/media/src/images.ts` that say "live" now say "live or queued".

**Checked and expected to survive unchanged:** `operations.test.ts:2312, 2384`;
`till-api.sell-published.test.ts:416`; `menu-publication.test.ts:248, 333-377`;
`menu-publication.live.test.ts:15-28`; `module-graph-honesty.test.ts:434`; the trigger names in
`behavioural-triggers.test.ts:107-118`; `image-references.test.ts:301-323`; every case of
`catalogue-api.test.ts`'s "publishing a menu" (`:4406` onwards); `menus-screen.test.ts:5205,
5269`. An implementer who finds one of these failing STOPS and reports it.

---

## Decisions taken in this plan

1. **Overtaking is refused, with no decision field** (owner, 2026-10-07 ~10:45, answering question
   W99: "perhaps we just refuse to schedule a newer version before an older version, which leaves
   the user the option of deleting or rescheduling the older version"). An immediate publish, a
   new queued edition and a reschedule that would overtake are each refused
   `menu_publication.overtakes_queued` `{ menuId, overtaken: [{ versionId, number, activatesAt }] }`
   and write nothing. The manager clears it through the edition's own Cancel or Change time action
   and tries again. The refusal applies in both directions of Decision 2; the dashboard's sentence
   names each edition in the way by number and venue-local time and advises "cancel it or move it
   earlier" for one that must go live first and "cancel it or move it later" for one that must go
   live after (two directional sentences rather than one that covers both, because the dashboard
   knows the direction from the numbers and the specific advice is the one that works). For a new
   schedule and a reschedule the sentence sits under the time field with the form's generic bottom
   message; for an immediate publish it is the `{reason}` of the preview's existing publish result
   paragraph, because no dialog is open when that answer arrives (Task 10).
2. **Overtaking is defined by number against time, in both directions, and equal instants count.**
   A new edition always takes the next number, so queuing it no later than an existing queued one
   overtakes that one.
3. **A queued edition is a `menu_versions` row written at queue time, plus a row in a new
   `menu_scheduled_publications` table** (`state`, not append-only). `menu_versions` and
   `menu_version_images` stay append-only. A cancelled edition keeps its rows and its number.
4. **`menu_versions.published_at`/`published_by` mean when and by whom the edition was fixed**
   (queue time for a queued one); `MenuStatus.publishedAt` now means when the live edition became
   live (the pointer's `published_at`, or a due edition's `activates_at`). For an immediate publish
   both are the same instant (`menu-publication.ts:460-471`), so today's answers do not change.
   The column keeps its name: renaming it would rebuild an append-only table three keys point at.
5. **A due edition is live for every read at that instant, without a write;** every write to a
   menu's queue or pointer first settles that menu in its own transaction, and a refused request
   rolls that settle back too.
6. **Several due at once:** all are marked `activated` and the pointer moves once to the highest
   number. There is no separate "skipped" state.
7. **Identical content:** queuing a draft identical to the edition it would follow is refused
   `menu_publication.unchanged`; an immediate publish identical to the live version stays today's
   no-op; a reschedule never compares content (an edition can end up after an identical one once
   the edition between is cancelled; nothing visible changes when it activates).
8. **Times:** whole minutes in the location's time zone; a time not after now is refused
   `menu_publication.time_past`; `occurrence` ("earlier" | "later") is ignored when the time
   occurs once; an unreadable zone is refused `menu_publication.clock_unreadable` rather than
   guessed.
9. **The duty has its own timer**, armed at the next due instant and capped at `config.maxTickMs`,
   re-armed by any change to the schedule table seen on `liveEvents`, primary-only per run, and
   log-only (not a health-tracked duty), because the main loop cannot be woken early and would
   otherwise leave dashboards showing a due edition as scheduled for up to an hour.
10. **The queue list** shows every queued edition and the ten most recently numbered settled ones.
11. **The menus list and `MenuStatus` keep their shape;** a menu whose only edition is queued reads
    "Unpublished" until it activates. The queue appears on the menu's Preview tab only.
12. **No "publish this queued edition now" action;** reschedule it to a near time instead.
13. **Media holds a queued edition's photos** like a live version's and lists the use as a new kind
    `scheduled_menu_version`.
14. **New codes are `menu_publication.*`**, named for the new noun beside `menu_item.*` and
    `menu_section.*`, while the existing publish refusals keep their `menu.*` codes.
15. **Every new route uses the existing catalogue gate** (`person.manage`,
    `catalogue-api.ts:128`).
16. **Deactivating a menu leaves its queue alone;** its editions still activate and are served when
    the menu is active again.
17. **Cancelling asks for confirmation** in the dashboard, because the number is never used again.
18. **Times are shown in the venue's zone**, with the offset only for a local time that occurs twice.
19. **The publish answer keeps its shape** `{ versionId, number }`; cancellations are seen through
    the queue read.

## Requirements not fitted

None of the spec's or the owner's requirements is left out. Out of scope by the spec itself: the
public menu surface (§3 "does not by itself commission that whole surface"); the live read this plan
changes is the resolver such a surface would use.
