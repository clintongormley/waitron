# A980. Menu publications and bookings in staff downloads

Staff can find the menu editions they published or scheduled, the editions with a cancellation
recorded under their name, and the bookings they created in their existing data ZIP. An
administrator can download the same files for that person. The watcher assigned
A980-DOWNLOAD-MENU-BOOKINGS to Lane F on 22 November 2026 at 09:02 under the
[A980 design, row s12](../specs/2026-10-22-a980-data-protection-design.md) and its
[remaining actions](../../backlog/data-protection.md). Codex wrote this plan.

## Build

- Follow adjustments. Add `MENU_PERSONAL_DATA` and `BOOKINGS_PERSONAL_DATA` in each package's
  `src/personal-data.ts`, export them from each `src/index.ts` and register the parts in
  `packages/composition/src/modules.ts`. Read through `prepare` in the existing first transaction
  and build with `jsonFile` after it closes. Each part returns no file when the person has no
  matching entries. Bookings contributes only when enabled through the existing module list.
- `menu-publications.json` has `entries` of `menuId`, `edition` (version number), `action`
  (`created` or `cancelled`) and `at` (UTC ISO time). Select the versions and releases with either
  `menu_versions.created_by` or `menu_releases.cancelled_by` matching the subject. Emit only the
  matching actions. Use `created_at` and `cancelled_at` respectively. Sort by time, menu, edition
  and action. A person who did both sees both entries. Editing a live menu can cancel and requeue
  editions under new numbers while preserving their original author and creation time. Report
  those recorded edition rows under their respective actors. Omit the document, hash, intended
  activation time, current state and staff identifiers.
- `bookings-created.json` has `entries` of `bookingId` and `at` (`created_at`), ordered by time and
  id. Read by `bookings.created_by`, including bookings whose status changed. Leave out guest
  contact details, notes, table, booking time, status and staff identifiers. Changes to a booking
  after creation and changes to a publication's planned time stay outside this slice.
- Add English and Spanish descriptions in `apps/server/src/i18n/personal-data-readme.ts` and
  `apps/server/src/guide/{en,es}/{staff,data-protection}.md`. Explain that a live edit can produce
  a cancellation and a replacement edition in the records. Trim the matching backlog work while
  keeping the other actor entries. Use the existing tables, permissions, routes and ZIP format.

## Test first and verify

- Add `src/personal-data.test.ts` to each module and observe missing files on the first run.
  With real venue databases, assert the exact menu entries for a publisher, a colleague who
  cancelled the publisher's edition, a person who did both and someone who did neither. Include
  a live edit with a queued edition and prove who gets the cancellation and each recorded
  creation. Assert exact booking entries for two distinct creators, including a booking later
  cancelled, with different contact details and notes. Check an empty export for a third person.
- Add `src/personal-data.coverage.test.ts` to each module, using the adjustments inventory to
  check every actor column in its schema and every included or omitted field of its export source
  tables. Run the core inventory unchanged. Update the exact seat list in `composition.test.ts`
  and check that a disabled Bookings module contributes no seat. In the existing
  `boot.personal-data-export.test.ts`, assert both files in the staff ZIP, the same files in the
  administrator's copy, and neither file in the uninvolved colleague's ZIP. Test both languages
  in `personal-data-readme.test.ts`. Seed bookings migrations in any existing fixture that mounts
  Bookings and lacks its table. Run focused module, composition, export and guide checks.
- Measure both parts and the first read turn with and without them on a seeded year of venue
  history. Bring a median first turn over 250 ms back to the watcher before opening the PR, as
  described in the [data protection backlog](../../backlog/data-protection.md).

Expect about 115 production lines, 310–400 test lines and 75 lines of plan and guide changes.
