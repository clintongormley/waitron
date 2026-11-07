# A1393: till route inventory

Goal: list every till route's device proof and profile action, and close A1393's admission audit.
Ask: `docs/backlog/till.md`, “Bundle A1393” and both linked details. Printer identity is separate.
Authority: Lane F queue, watcher 2026-11-06 about 12:45, assigns A1393 after A1383. The owner
invoked RUNNER.md and authorised finish/land on 2026-11-07. Actual notes are in
`/Users/clintongormley/waitron-campaign-f/{RUNNER.md,queue.md,questions.md}`. Earlier branches
wait for A760's landing freeze; no database table changes or landing are allowed here.

## Work

1. Extend `apps/server/src/till-api.profile-actions.test.ts`, reusing its live `ROUTES` refusal
   cases. Replace its prose action map with data for action cases in other suites (naming the
   case) and actionless routes (giving the reason). Record device proof separately from actions:
   matching request proof, device-cookie authority, session device only, public/bootstrap, or
   undecided. “No action” exceptions do not decide request-device proof. Keep all existing
   behavioral assertions and the independent zone map.
2. Mount real till/device/staff schedule APIs in that suite, including workforce, attendance,
   simulator, development and box-clock routes (backend must offer `confirmClockStop`). Compare
   the set of registered `/api/` method/path keys with the classified set, normalising UUID and
   line-number samples and parameter names. Fail on missing/stale rows; exclude middleware and
   management routes. Start with the failing inventory comparison, then add classifications.
   This guards completeness, not execution of every stated check; existing behavioral suites
   still test enforcement. Prove missing/new-route failures once in an installed disposable clone.
3. Send one watcher question before admission changes, using A941's retained HTTP receipts and
   the current source trace. The list includes receipt-handover, cleared, zone-extension,
   device active-profile/zones/equipment, box-clock, schedule, station-day, locale and simulator
   writes. Do not change their admission policy before the recorded answer. Any approved repair
   gets a reviewed amendment, a failing real-route test, minimal boundary changes and passing
   legitimate callers, including the development header. No global `requireSession` change or
   new action. Until resolved, keep the relevant backlog work open and mark table rows undecided.
4. Run focused inventory/action/zone and affected route suites, scoped types, and one-time
   controls. Update `docs/developers/conventions-ui.md` with the guard's actual limits; the watcher
   maintains the root `CLAUDE.md` pointer. Sign off commits. Once the item's decision and build
   are complete, run finish-branch with one Claude run-it review, normal hook and current-head CI;
   retain the branch under A760's freeze.
