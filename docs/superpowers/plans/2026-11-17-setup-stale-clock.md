# SETUP-STALE-CLOCK — Provision takes its own fresh time reading (plan, 2026-11-17)

**Outcome.** On a box whose internet time service is synchronised, a person who takes more than
30 seconds between naming the series and pressing Provision (downloading the recovery pack and
typing the administrator password twice always takes longer) gets a working venue, not a refusal
that leaves the page stuck.

**What happens today (traced on main bf3e06495f).**

- The series step compares clocks (`compare-clocks`), and the select keeps that reading
  (`packages/fiscal-verifactu/src/hour-setup-clock.ts`, `compare`).
- Provision runs the module's activation `prepare` (`hour-configuration.ts:64` →
  `hour-preparation.ts` `createHourPreparation.prepare`), which re-reads the clock with no
  comparison id: `clocks.read(contextKey)` takes the newest held reading that is at most 30 seconds
  old (`hour-setup-clock.ts:108`) and otherwise refuses `sif.allocation_invalid` `clock_stale`.
  Nothing takes a reading between the series step and Provision in the browser path.
- The command-line setup does not hit this: `commandBeforeActivation`
  (`initial-hour-setup.ts:152`) compares clocks afresh (box and internet time service, no browser)
  right before activation.
- The refusal is thrown inside `activateFirstSetup` after the recovery-pack grant has been consumed
  (`packages/provisioning/src/first-setup-activation.ts:116-120`), which is why lane B's page could
  not recover: the attempt stays `consumption-intent`, but the grant is gone.
- Lane B's box had its time service synchronised (lane B ledger, "no clock question: time service
  synchronised"), so a fresh box-and-internet reading at Provision would have admitted the name.

**The change (the smaller of the two options the item offers: a fresh reading at Provision).**
In `createHostedHourPreparation` (`hour-preparation.ts`), the returned `prepare` first takes a fresh
comparison exactly as the command line does — `clocks.compare(contextKey, null, { onBox: true })`
under `withFacts`, so box clock plus the host's time service — and only then runs the existing
`prepare`. That `prepare` is unchanged: it still picks the newest reading at most 30 seconds old
that admits a name, then the `selected` checks (`canSelectHour`, the name not already in a history,
the box's time not earlier than the chosen minute). Nothing reuses a stale reading; no device's time
is accepted without the person's confirmation (a `null` browser sample adds none); the 30-second
limit is unchanged.

- Synchronised time service: Provision passes however long the person took.
- Not synchronised, Provision within 30 seconds of a confirmed device reading: unchanged (the
  device reading is still the newest that admits a name).
- Not synchronised, later than that: still refused, now `second_clock_missing` rather than
  `clock_stale` (the newest reading is the fresh box-only one). See the question below.
- Cost: one time-service read (`timedatectl`, at most 2 s) per Provision; the command line now reads
  twice before activation, which is harmless.

**Tests (red first).**

1. `packages/fiscal-verifactu/src/hour-setup-defaults.test.ts` (fake timers, real hosted
   preparation): select with a reading, advance 31 s, activation `prepare` writes the allocation.
   Red today with `clock_stale`. Second case: time service unavailable, device reading confirmed,
   31 s later activation still refuses and writes nothing (control that no stale reading is used).
2. `apps/server/src/first-fiscal-setup.e2e.test.ts`: the real routes, with the clock moved 31 s
   between the recovery-pack confirmation and `/setup-api/provision`; answers 200 and the venue
   exists. Red today with `clock_stale`.
3. Golden huella and `inmutabilidad` unedited.

**Out of scope, asked separately (WATCHER-NEEDED).** A box whose time service is not synchronised
cannot get a second clock at Provision without the browser, so its first setup through the page
still fails whenever the person takes more than 30 seconds, and the stuck page (grant consumed) is
unchanged. Options: (a) at Provision, a reading the person confirmed stays usable while the box's
own clock has not been stepped since (wall time moved with the steady clock, as `clock_corrected`
already checks) and the process is the same, as a restore's start keeps the restore page's choice
(CLAUDE.md §5) — server-only, small; (b) the page offers the time check again on a clock refusal and
keeps the recovery-pack grant for a retry — page and provisioning changes, medium.
