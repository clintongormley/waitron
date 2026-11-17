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
is added by the fresh reading (a `null` browser sample adds none); the 30-second
limit is unchanged. When the preparation was given its own `readClock` (test stand-ins), the fresh
comparison is skipped: that reader replaces the held readings entirely.

- Synchronised time service: Provision passes however long the person took.
- Not synchronised, Provision within 30 seconds of a confirmed device reading: unchanged (the
  device reading is still the newest that admits a name).
- Not synchronised, later than that: still refused, now `second_clock_missing` rather than
  `clock_stale` (the newest reading is the fresh box-only one). See the question below.
- Cost: one time-service read (`timedatectl`, at most 2 s) per Provision; the command line now reads
  twice before activation, which is harmless.

**Tests (red first).**

1. `packages/fiscal-verifactu/src/hour-setup-defaults.test.ts` (fake timers, real hosted
   preparation): (a) time service synchronised: select, advance 31 s, activation `prepare` writes
   the allocation — red today with `clock_stale`; (b) time service unavailable, device reading
   confirmed (`confirmed: true`), 31 s later activation refuses `second_clock_missing` and writes
   nothing — today `clock_stale`, so the reason is the assertion that moves; (c) the same within
   10 s still writes the allocation — guards against handing the fresh comparison's id to
   `clocks.read`, which would hide the confirmed device reading behind the box-only one.
2. `apps/server/src/first-fiscal-setup.e2e.test.ts`: one more row of the existing `it.each`, the
   clock moved 31 s before `/setup-api/provision`; answers 200 and the venue exists. Red today with
   `400 clock_stale` (reproduced by the plan's reader). The file's time-service stand-in always
   answers synchronised, so this covers the synchronised case only.
3. Golden huella and `inmutabilidad` unedited.

**Out of scope, asked separately (WATCHER-NEEDED; superseded by the amendment below).** A box whose time service is not synchronised
cannot get a second clock at Provision without the browser. Since the steps between the series and
Provision always take more than 30 seconds, its first setup through the page always fails, before
and after this change. And any refusal at activation still leaves the page stuck, because the
recovery-pack grant is consumed first — including a synchronised box whose `timedatectl` does not
answer within 2 s (`hour-clock-time-service.ts:4`). Options: (a) at Provision, a reading the person confirmed stays usable while the box's
own clock has not been stepped since (wall time moved with the steady clock, as `clock_corrected`
already checks) and the process is the same, as a restore's start keeps the restore page's choice
(CLAUDE.md §5) — server-only, small; (b) the page offers the time check again on a clock refusal and
keeps the recovery-pack grant for a retry — page and provisioning changes, medium.

## Amendment, 2026-11-17 00:40 — option (a), chosen by the watcher (not the owner) at 00:24

The watcher's answer (lane L questions.md, "WATCHER 2026-11-17 00:24"): take (a) in this pull
request, test-first, and put it in the pull request's first lines for the owner, citing the §5
restore rule, saying the watcher chose it.

**Rule.** At Provision, the time agreed when the name was chosen stays usable while the box's boot
id is unchanged and its clock has not been stepped since — the rule a restore's start already
follows (CLAUDE.md §5: the restore page's choice holds "while the box's boot id is unchanged and its
clock has not been stepped since"). Otherwise the 30-second limit and every refusal stand; choosing
the name is unchanged.

**Mechanism: reuse the restore's.** `hosted-hour-recovery.ts` already carries a selection forward
at a restore's start: `select` records the box's boot id, uptime and wall time on the intent
(`readBoot`, `hour-selection.ts:577`), and `standing(chosenHourBoot(state, binding), 0, 0)` turns it
into a reading of "the box's time as of the selection, carried on its uptime" — refused when the
boot id differs or the wall clock has moved more than 1 second against the uptime (the
`clock_corrected` figure) — which `clocks.compare(key, null, { onBox: true }, carried)` uses in
place of the browser. For setup:
1. Move `standing` out of `hosted-hour-recovery.ts` into a shared function both files use
   (behaviour unchanged; restore tests unedited).
2. `createHostedHourPreparation` passes `readBoot` (same shape as `hosted-hour-recovery.ts:61-66`)
   to the selection, so a setup `select` records the boot; the fresh comparison at Provision passes
   `carried` from `chosenHourBoot(state, binding)` read under the same `withFacts` state.
3. The first-setup host gets the box's boot reader: `createFirstSetupRuntime` gains a `readBoot`
   option handed to `createModuleOperationHost` (which already accepts it), and
   `apps/server/src/module-operation-host.ts` passes `bootReader().readBoot` as
   `recovery-preparation.ts:247` does.

A process restart on the same boot keeps the carried time (the uptime and boot id come from the
box, not the process), exactly as for a restore; a reboot or a clock step refuses. Where the boot id
cannot be read (`id: null`, e.g. a Mac in development) nothing is carried and the 30-second rule
applies.

**Tests (red first).** In `hour-setup-defaults.test.ts` with a stub `readBoot`: time service
unavailable, device time confirmed, 2 minutes later Provision writes the allocation (red today:
`clock_stale`; after the first change: `second_clock_missing`); a clock step of more than 1 second
between the choice and Provision refuses `second_clock_missing`; a different boot id refuses the
same; no boot id carries nothing. One server-level check that the real first-setup host hands the
boot reader on (a select through the setup routes records a boot on the intent). Restore tests
(`hosted-hour-recovery.test.ts`) pass unedited.
