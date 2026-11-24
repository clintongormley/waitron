# Extract Make now from TillApp

This trial gives developers one place to read how the till keeps **Make now** instructions.
Staff see the same instructions after sending an order, switching screens or reloading the same
device. The list is the only field moving. The host supplies its current device ID and connects
the existing API callback. Further till splits wait for the owner’s decision after the trial.

Move the list, storage, snapshot validation, deduplication and Done handling from
`apps/till/src/till-app.ts` into `apps/till/src/state/make-now-controller.ts`. Follow
`FormFeedback`’s pattern of a class that requests a Lit host update when its state changes.
Keep API registration in its existing place in `willUpdate`, with the optional call and a
stable arrow callback. Give Done an arrow callback for the widget binding. Use a type-only
client import. Keep the existing widget and markup in place.

Keep each reset and restore at its current call site. On boot, clear the old list before assigning
the new ID and restore after holding the identity. Reset clears memory. Done clears memory before
saving. Read the current device ID on each storage access, including while boot has cleared it.
Keep storage access inside the `try` blocks and request an update on each list replacement.

Run `till-app-boot-and-counter.test.ts`, `till-app-table-service.test.ts`, `widgets/make-now.test.ts`
and `widgets/make-now.a11y.test.ts` in Till’s browser project on the base and candidate with every
assertion intact. They cover instruction delivery, deduplication, device switching, restoration,
invalid and blocked storage, Done and presentation. In a disposable checkout, prove the existing
checks catch a missing listener, missing restore, missing Switch device reset, missing Done save,
and a reset that deletes the old device’s saved list. Compare the other boot and reset call sites
directly. Run Till typecheck, the root product file-size guard, the normal push hook and required CI.

At base `72ff8f92f6`, the app has 26,065 lines. Expect about +120/−105 production and +0/−0 tests.
About 25,975 lines would require lowering the 26,250 cap to 26,000 on this base. Lane C’s
`feat/a1515-1-pay-items-till` adds 107 net lines outside the trial’s hunks. The combined estimate
is 26,082. Lane F’s `feat/f-home-tiles` and Lane L’s `feat/give-money-back-server` and
`feat/vat-rates-b` leave the trial hunks alone. Recheck branch diffs and the measured file count
against current main before the PR and landing. Give the watcher the numbers before changing the
landing order or raising a cap. No matching product backlog entry exists at the base, so check
again before landing. Report lines removed from the app, shared inputs, rebase conflicts, review
rounds and elapsed time after the trial.
