# A1308 menu and photos, PR mn11: who published or cancelled a menu version is a checked person — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** `menu_versions.created_by` and `menu_releases.cancelled_by` gain foreign keys to
`persons(id)`, refusing a person's deletion while they are named, so neither can hold an id that names
nobody.

**Architecture:** Two declared keys. Product code already passes the signed-in person (the routes'
`gated(c, sessionId, (tx, personId) => …)`, `apps/server/src/menu-api.ts:1104-1105`, `:1133`, `:1152`,
`:1201`). What changes is the code that invents a person id: the demo seed and about a hundred test
call sites, which now name a person that exists.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §5 U1, U11 ("Person ids");
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.16, §1.18, §7 "People";
[slice rules](2026-11-08-a1308-slice-rules.md) §4 ("A fixture that invents a person id creates the
person first").

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names. Batch 1 and
mn1–mn10 have landed (mn10 created `menu_releases` and renamed `published_by` to `created_by`). A
missing identifier this plan does not explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **Two keys**, `on delete restrict` (README U11: "until a row can be deleted, the key refuses
   deletion"; A980 anonymises a person rather than deleting the row):
   - `menu_versions.created_by → persons(id)`, name `menu_versions_created_by_fk`;
   - `menu_releases.cancelled_by → persons(id)`, name `menu_releases_cancelled_by_fk`.
   No index on either: `menu_versions` holds 100–300 rows a year and `menu_releases` one per version
   (tables-menu.md §1.16, §1.18), and a person's deletion is refused by the key, so the lookup it
   triggers is rare. The comment "No key yet" (`packages/db/src/schema/menu/publication.ts:20`) goes.
2. **The demo seed publishes as a real person.** `apps/server/scripts/demo-seed/seed.ts:102` passes
   `"demo-seed"`; it passes the administrator the demo provisioner created (the value
   `createDemoVenueProvisioner` returns, `apps/server/scripts/demo-seed/testing/provision-venue.ts`;
   if it does not return that person's id, it is added to what it returns).
3. **Tests name real people.** A test-only helper `ensureTestPerson(db, id)` in
   `packages/db/src/testing/seed.ts` inserts a `persons` row with that id (display name `"Test <id>"`,
   active) unless it exists, through the `persons` table definition (`$defaultFn` fills the rest,
   `packages/identity/test/fixtures.ts:30-32` explains why). If a batch 1 slice already added a shared
   helper that does this, use it instead and add nothing.
   - `apps/server/src/testing/publish-menu.ts:12` (`"test-publisher"`) and the menu package's own
     publishing fixtures call it before publishing.
   - Each test file that passes a literal person id to `publishMenu`, `queueMenuPublication`,
     `patchLiveMenu`, `cancelMenuPublication` or `rescheduleMenuPublication` calls it once in its
     set-up for each id it uses (`git grep -n -E "(publishMenu|queueMenuPublication|patchLiveMenu|cancelMenuPublication|rescheduleMenuPublication)\\(" -- '*.test.ts'`
     finds 107 calls in 38 files at `a086eedfb7`, per the review; literal ids seen: `"manager-ana"`,
     `"source-admin"`, `"person-1"`, `ANA`). That grep misses tests that insert `menu_versions` rows
     directly with an invented `publishedBy` (now `createdBy`); `git grep -l "insert(menuVersions)" -- '*.test.ts'`
     lists them, at `a086eedfb7` under today's paths: `packages/catalogue/src/backup-verification.test.ts`,
     `packages/catalogue/src/menu-publication.test.ts`, `packages/media/src/backup-verification.test.ts`,
     `packages/media/src/image-references.test.ts`, `apps/server/src/catalogue-api.test.ts`,
     `apps/server/src/configuration-transfer.test.ts`, `apps/server/src/till-api.sell-published.test.ts`.
     Each calls the helper for the id it inserts. Assertions stay; only set-up changes (rules §4).
4. **The backlog entry "Person-id columns and `order_draft_lines.menu_item_id` have no foreign key"**
   (`docs/backlog/architecture.md:1230-1235`) stays, because other areas' columns remain; this PR
   removes the menu columns' "No key yet" comment, which is what that entry counts.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Person keys in other areas | each area's slice (README U11) |
| The person in `activity_log` entries | slice 2 (its `person_id` already has a key) |

## Files

- Schema: `packages/db/src/schema/menu/publication.ts`
- Test helper: `packages/db/src/testing/seed.ts` (and its test `seed.test.ts`)
- Demo seed: `apps/server/scripts/demo-seed/seed.ts`, `testing/provision-venue.ts`
- Test fixtures: `apps/server/src/testing/publish-menu.ts`, `packages/menu/test/*.ts` as needed
- Tests: the files the grep in item 3 lists (set-up lines only)
- Regenerated: core's `drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys from `:33`: add
  `["menu_versions", ["created_by"], "persons"]`, `["menu_releases", ["cancelled_by"], "persons"]`),
  `scripts/two-file-foreign-keys.test.ts` (runs: both tables and `persons` are in `venue.db`).
  Not changed: `apps/server/src/personal-data-actions.coverage.test.ts` cannot see these columns. It
  leaves out every table of `MODULE_SCHEMAS` (`:168-176`, filtered at `:183-185`), and the menu
  schema is one of them (`catalogueSchema`, `:170`). Whether the personal-data download should carry
  "who published a menu version" stays with the backlog point "The rest of 'who did what' in the
  download" (`docs/backlog/data-protection.md:79`).

## Size

| | Code | Tests |
| --- | --- | --- |
| Keys | 10 | 40 (refusal and legitimate cases) |
| Helper | 15 | 25 |
| Demo seed | 15 | 10 |
| Test set-up lines (about 45 files) | — | about 135 |
| **Counted** | **40** | **210** |

About 250 counted lines. About 1½ hours.

## Finish line

1. `pnpm --filter @waitron/db exec vitest run src/schema/menu/migrations.test.ts src/testing/seed.test.ts`
   passes, including "refuses a version created by nobody" and "refuses deleting a person who published".
2. `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/` passes.
3. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers. In all six:

```text
extra table menu_versions.foreignKeys[created_by->persons(id)]
extra table menu_releases.foreignKeys[cancelled_by->persons(id)]
```

Why: README §5 U11, "every column naming a person gets a key to `persons`"; tables-menu.md §1.16 and
§1.18 name both.

## Stop points (beyond rules §5)

1. A product path (not a test) passes something other than the signed-in person's id.
2. `persons.id` carries a CHECK that refuses the literal test ids; then the helper takes a generated
   id and each test keeps the returned value instead (a larger set-up change; ask first).

## Needs

- **Outside this area:** batch 1 (identity's tables in core since A760).
- **In this area:** mn10.

## Global Constraints

- Rules §1–§9; core rebuilt. A key is proved by a refused write and a legitimate write (rules §4;
  CLAUDE.md §3 "A foreign key … is refused at the first WRITE").

## Review Focus

1. **No test changed an assertion**; only set-up lines.
2. **The demo seed's versions name the administrator**, a person who exists.

---

### Task 1: The keys and the helper

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases** in `migrations.test.ts` (raw SQL): `"refuses a version created by
  nobody"` (insert with `created_by = 'nobody'` → `FOREIGN KEY constraint failed`; control: a seeded
  person's id inserts); `"refuses a release cancelled by nobody"`; `"refuses deleting a person who
  published"` (delete the person → refused; control: a person who published nothing deletes).
  `seed.test.ts`: `"ensureTestPerson inserts once"`.
- [ ] **Step 3–5:** Run (fail); implement items 1 and 3's helper; rebuild core; run (pass). **Commit.**

### Task 2: Every invented id names a person

- [ ] **Step 1:** Run the grep in item 3; for each file add the set-up call; run each package's
  publishing tests (`@waitron/menu`: `menu-publication*.test.ts`, `menu-schedule.test.ts`,
  `menu-patch*.test.ts`; `@waitron/server`: `menu-activation.test.ts`, `menu-api.menu-*.test.ts`,
  `boot.test.ts`, `configuration-transfer.test.ts`, `menu-undo-photo.test.ts`; `@waitron/media`).
- [ ] **Step 2:** Demo seed (item 2). Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/`.
- [ ] **Step 3: Commit.**

### Task 3: Finish

- [ ] Guards (Files); Finish line; paste the protection-list report, marking each line;
  `/finish-branch`; push once.
