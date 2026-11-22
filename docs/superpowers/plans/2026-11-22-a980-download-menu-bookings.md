# A980. Menu publications and bookings in staff downloads

Staff can find the menu editions they published or scheduled, the editions with a cancellation
recorded under their name, and the bookings they created in their existing data ZIP. An
administrator can download the same files for that person. The watcher assigned
A980-DOWNLOAD-MENU-BOOKINGS to Lane F on 22 November 2026 at 09:02 under the
[A980 design, row s12](../specs/2026-10-22-a980-data-protection-design.md) and its
[remaining actions](../../backlog/data-protection.md). Codex wrote this plan.

The watcher cleared the plan on 22 November at 10:44 in Lane F’s questions.md, with the changes below.

## Build

- Follow adjustments. Add `MENU_PERSONAL_DATA` and `BOOKINGS_PERSONAL_DATA` in each package's
  `src/personal-data.ts`, export them from each `src/index.ts` and register the parts in
  `packages/composition/src/modules.ts`. Read through `prepare` in the existing first write-lock
  turn and build with `jsonFile` after it ends. Each part adds a file only for a person with
  matching entries. Bookings contributes only when enabled through the existing module list.
- `menu-publications.json` has `entries` of `menuId`, `edition` (version number), `action`
  (`created` or `cancelled`), `menuName` (the current name) and `at` (UTC ISO time). Read versions by `created_by` and releases by
  `cancelled_by` in two queries, joining versions for the cancelled edition number. Use
  `created_at` and `cancelled_at` respectively. Sort by time, menu, edition and action. Use the
  stored menu ID and edition number, and join `menus` for its current name. Omit the document,
  hash, intended activation time, current state and staff identifiers.
- `bookings-created.json` has `entries` of `bookingId` and `at` (`created_at`), ordered by time and
  id. Read by `bookings.created_by`, including bookings whose status changed. Leave out guest
  contact details, notes, table, booking time, status and staff identifiers. Changes to a booking
  after creation and changes to a publication's planned time stay outside this slice.
- Add English and Spanish descriptions in `apps/server/src/i18n/personal-data-readme.ts` and
  `apps/server/src/guide/{en,es}/{staff,data-protection}.md`. Explain that a live edit can record a
  cancellation under the editor and a replacement under a new edition number with the original
  author and time. Trim the matching backlog work and point to the module guards. Use the
  existing tables, permissions, routes and ZIP format.

## Test first and verify

- Add `src/personal-data.test.ts` to each module and observe missing files on the first run.
  With real venue databases, assert the exact menu entries for a publisher, a colleague who
  cancelled the publisher's edition, a person who did both and someone who did neither. Include
  a live edit by B after A queues an edition at T1. Assert A sees both edition numbers at T1,
  and B sees their new live edition and the cancellation of the queued original. Assert exact
  booking entries for two distinct creators, including a booking later
  cancelled, with different contact details and notes. Check an empty export for a third person.
- Add `src/personal-data.coverage.test.ts` to each module, using the adjustments inventory to
  check actor columns across the SQLite tables exported by `@waitron/db/schema/menu.js`
  (including `product_takeaway_vat_rates`) and by `packages/bookings/src/schema/bookings.ts`
  (the Bookings migration schema). Inventory every field of `menu_versions`, `menu_releases`
  and `bookings`. Link both guards from the core inventory header and keep its assertions. Update
  the exact seat list in `composition.test.ts`. In the existing
  `boot.personal-data-export.test.ts`, assert both files in the staff ZIP, the same files in the
  administrator's copy, and neither file in the uninvolved colleague's ZIP. Test both languages
  in `personal-data-readme.test.ts`. Apply `BOOKINGS_MIGRATIONS` in
  `personal-data-time-record.test.ts`, whose route fixture enables Bookings. Run focused module,
  composition, export and guide checks.
- Outside CI, measure each read and the first read turn with and without the parts. Model a busy
  year with 1,600 menu versions and releases (eight menus with four editions per menu per week for
  50 weeks), documents around 128 KiB and 12,000 bookings across six staff. Bring a median first
  turn over 250 ms back to the watcher before the PR. Recommend a separate read turn if the first
  turn is too long, following the [data protection backlog](../../backlog/data-protection.md).

Expect about 115 production lines, 310–400 test lines and 75 lines of plan and guide changes.


Local timing receipt, 22 November. Seven paired downloads of a seeded year with 1,601 menu
versions and releases and 12,000 bookings took a median 25.23 ms in the first write-lock turn
with both parts, versus 0.93 ms without them. The median statement reads were 22.34 ms for
created editions, 0.21 ms for cancellations and 0.88 ms for bookings. The longest first turn
was 25.89 ms. This is a development Mac measurement with the same synthetic data across samples.
