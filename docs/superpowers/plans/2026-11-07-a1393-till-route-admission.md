# A1393: till route admission

Goal: maintain a table of every staff-facing till route and its device/profile checks, and
qualify the session-only writes identified in the A1393 backlog bundle.

Authority: Lane F queue, watcher 2026-11-06 about 12:45, assigns A1393 after A1383;
RUNNER.md authorises implementation and finishing. The owner invoked this unattended run on
2026-11-07. Campaign notes are outside the repository at
`/Users/clintongormley/waitron-campaign-f/{RUNNER.md,queue.md,questions.md}`.
The ask is `docs/backlog/till.md`, “Bundle A1393” and its two linked details. Printer identity
is expressly separate. A760 forbids table changes and landing during this run.

## Work

1. In `apps/server/src/till-route-admission.test.ts`, mount the real till, device and staff
   schedule APIs, enabling optional workforce, attendance, box-clock and simulator routes.
   Compare their registered method/path pairs (excluding middleware and management routes)
   with one maintained table in `src/testing/till-route-admission.ts`. Each row names its
   authority, profile action(s), or the reason no action applies. The guard must fail for a
   newly registered route without a row and for a stale row. It checks inventory completeness;
   existing behavioral action/zone suites continue checking enforcement. Do not claim the
   inventory comparison proves an action executes. Keep existing behavioral assertions.
2. Audit the real mounted receipt-handover, table-cleared, zone-extension, station-day,
   device active-profile/zones/equipment, box-clock challenge/confirmation and schedule writes.
   Use `useVenueDb`, a real enrolled session and absent, invalid, other-device and matching
   device cookies. Record exact responses; distinguish admission from a successful write.
   Exercise legitimate no-selling-action callers. If deciding admission would change an
   existing permission contract, ask the watcher with those receipts before changing it.
   Any approved fix starts with a failing route test and changes only the affected boundary;
   do not change `requireSession` globally or invent a new profile action.
3. Run focused inventory, profile-action, profile-zone and affected route suites plus scoped
   types. In a disposable installed clone, add an unlisted real route and remove an inventory
   row; both must fail the inventory guard. Run any approved admission omission controls once,
   retaining logs outside the checkout, without permanent self-mutation tests. Update the
   A1393 backlog entries accurately, preserving printer-identity work and unresolved decisions.
4. Sign off commits, run finish-branch with one Claude run-it review, normal push hook and
   current-head CI. Retain the finished branch while A760's freeze holds; land only after
   explicit release under the campaign lock.

Review focus: optional mounts must be present; aliases and multiple actions must stay visible;
reads/previews and device settings must not gain selling permissions; valid callers must still
work; a response from a later lookup is evidence of admission, not successful mutation.
