# A980 — service actions in a staff data download

## What a staff member gets

The existing personal-data ZIP includes `service-actions.json` when the person has recorded service actions and `department-transfers.json` when they resolved a transfer. The same files reach an administrator downloading that person's copy through the existing permission and fresh sign-in checks. The [A980 design, row s12](../specs/2026-10-22-a980-data-protection-design.md) and [remaining actions](../../backlog/data-protection.md) are the basis for the watcher's Lane H queue assignment of 2026-11-22 09:02.

## Build

- Add `serviceActionsPersonalData(db: Database): PersonalDataPart[]` in `apps/server/src/personal-data-service-actions.ts` and register it in `personal-data-export-api.ts`. Follow `actionsPersonalData` for deferred, read-only build turns after the first authorization. Read the matching rows one source at a time and order by stored time and row key for repeatable results.
- `service-actions.json` groups seven sources. Order events show kind, time, recorded party/group/draft/line/order references and every matching `yourPart` role (`actor`, `from`, `to`), once per event. Group and party entries show their references and only the moments attributable to the subject (submitted/fired, opened/closed/allergy answered). Dish moves show the line, source and destination station references and move time. Amendments show order reference, kind and event time. Cancellations show line reference and cancellation time. Late confirmations show line and order references and the stored send time if available. Those rows have no separate confirmation timestamp. Omit the file when all seven sources are empty.
- Add `VENUE_SERVICE_PERSONAL_DATA` in `packages/venue-service/src/personal-data.ts`, export it from that package's `index.ts` and register it in `packages/composition/src/modules.ts`. Use the existing module part contract to read transfers where `resolvedBy` matches, then render order and department references, status and resolution time. An empty result adds no file. A transfer initiated by the subject appears only if they also resolved it, such as a withdrawal.
- Project explicit fields throughout. Leave out other people's identifiers, order-event detail, party names and allergy answers, notes and free-text reasons. Keep the existing money and adjustments files, route permissions and snapshot recheck. Add no columns, tables, indexes or new download routes.
- Move the twelve named core actor columns from `NOT_YET` to `READ` in `apps/server/src/personal-data-actions.coverage.test.ts` and trim their entries in `docs/backlog/data-protection.md`. Keep other work, including transfer sender attribution, in the backlog. Describe both files in English and Spanish in `apps/server/src/i18n/personal-data-readme.ts` and the download section of `guide/{en,es}/staff.md`.

## Test first and verify

- In `apps/server/src/personal-data-service-actions.test.ts`, use the real venue database to seed all seven sources. Assert the exact rows and per-person roles for two people, including a hand-off with different actors, actions where one person fills multiple roles, and group/party actions split between people. Use distinct private data in fixtures so exact output checks catch leaks. Assert that an uninvolved person gets no file.
- In `packages/venue-service/src/personal-data.test.ts`, assert that a transfer resolved by the subject appears and a pending transfer, one resolved by someone else and one only sent by the subject do not. Include a withdrawal in which the sender is the resolver. Assert no file for a subject without resolutions.
- In `apps/server/src/personal-data-export-api.own.test.ts`, prove that both contributions are included via the real ZIP path and described in its README. Re-run the existing staff route and bilingual README checks for permission and wording. Use the part tests for row filtering.
- Observe the new assertions fail before implementing each part, then run the changed suites and core actor guard, guide/link checks, the queue's unchanged menu Review Focus checks and fiscal tests, and scoped typechecks. The normal push hook and current-head CI supply the remaining checks.

**Expected size** 220–310 production lines, 380–540 test lines, plus short plan and backlog edits.
