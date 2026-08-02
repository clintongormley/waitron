# Plan — workforce registro fixes (post-merge follow-up to #47)

A follow-up to the merged workforce PR (#47), fixing two Important findings and some minor
claim-rigor issues surfaced by a retroactive `/finish-branch` review of the merge. #47 shipped the
_registro de jornada_ legal working-time record; these fixes make the legal export correct and close
a tamper-evidence gap while the database is still pre-production (so both are free to change now and
expensive-to-impossible once real chains exist — CLAUDE.md §5).

## Global constraints (bind every task)

- **TDD, strictly.** Failing test first, watch it fail for the right reason, then the minimal
  implementation. Prove every new guard/teeth-test by deletion.
- **English-only guard (CLAUDE.md §3).** `packages/workforce` is a GENERIC package — English only.
  `packages/workforce-es` is EXEMPT — Spanish is expected there. New symbols in `workforce` must be
  English; Spanish belongs only in `workforce-es`.
- **Error codes are never renamed once shipped (CLAUDE.md §3).** Removing a code that is thrown
  NOWHERE and has no consumer is allowed pre-production; renaming a live one is not.
- **The correction fields are legal-record CONTENT, not our metadata.** Unlike `entorno` (fiscal, our
  own — must never be hashed, §5), `correction_reason`/`correction_actor_id`/`captured_by_till_id`
  are attribution the record itself must carry (art. 34.9). Hashing them is required, not forbidden.
- **Verify before claiming.** Run the package suites UNFILTERED before reporting green:
  `pnpm --filter @waitron/workforce test:coverage` and `pnpm --filter @waitron/workforce-es
  test:coverage` (thresholds 98/98/98/95). A name-filtered run skips cross-cutting guard suites
  (CLAUDE.md §4).
- Match sibling style, comment density, and the `huella.ts` precedent the chain mirrors.

## Task A — the registro export must render LOCAL wall-clock, not UTC (Important ①)

**The defect.** `closeShift` (`packages/workforce/src/projection.ts`) sets `WorkSession.startedAt`/
`endedAt` to the raw UTC `event_at`, and `WorkSession` carries no offset, so `exportTimeRecord`
(`packages/workforce-es/src/registro-jornada.ts`) renders `horaInicio`/`horaFin` as UTC instants —
while `fecha` is the LOCAL `workDate`. For any non-UTC venue (every Spanish venue) the legal record
shows a local date beside UTC clock times, and can stamp the start on the previous calendar day
(offset +60, clock-in 00:30 local on 2026-01-06 → `event_at` 2026-01-05T23:30:00Z → renders
`fecha:2026-01-06`, `horaInicio:2026-01-05T23:30:00Z`). Art. 34.9 requires "el horario concreto de
inicio y finalización" — the concrete LOCAL start/end time.

**The fix — local wall-clock with explicit offset.** Render start/end as ISO-8601 with the offset,
e.g. `2026-01-06T00:30:00+01:00`: the part before the offset is the local time a human reads (00:30),
the `+01:00` keeps the instant recoverable and disambiguates the fall-back hour. Computed as
`event_at + event_offset_minutes`. DST needs no handling — the offset is captured PER EVENT, so a
January event carries +60 and a July one +120; local = instant + its own offset, correct in every
season with no timezone lookup.

Requirements:

1. `WorkSession` (projection.ts) must carry the offset for BOTH ends of the shift —
   `startOffsetMinutes` (from `open.start.offsetMinutes`) and `endOffsetMinutes` (from
   `out.offsetMinutes`). They can differ across a DST boundary; carry both, do not assume one offset
   per session. Keep `startedAt`/`endedAt` as the UTC instants (unchanged) — the local rendering is
   derived, not stored on the projection.
2. Export a pure helper from `packages/workforce` (English), e.g.
   `localWallClock(instant: string, offsetMinutes: number): string`, returning the ISO-8601
   local-with-offset string. It must format the offset as `±HH:MM` (e.g. `+01:00`, `-05:00`,
   `+00:00` for UTC) and emit whole seconds (the stored instants are already whole-second, §
   `time_entries_event_at_second_ck`).
3. `exportTimeRecord` (registro-jornada.ts) renders `horaInicio: localWallClock(s.startedAt,
   s.startOffsetMinutes)` and `horaFin: localWallClock(s.endedAt, s.endOffsetMinutes)`.
4. `minutosTrabajados`/`workedMinutes` are UNCHANGED — they come from the UTC instants (true elapsed
   time) and must stay DST-immune. Do not derive worked minutes from the rendered local strings.

Tests (RED first each):

- `localWallClock`: `+01:00` case rendering a same-instant-different-day local time
  (`2026-01-05T23:30:00Z`, +60 → `2026-01-06T00:30:00+01:00`); a `+02:00` (CEST) case; a negative
  offset; `0` → `+00:00`. Assert the exact strings.
- projection: a session with a NON-ZERO offset asserting `startOffsetMinutes`/`endOffsetMinutes` AND
  that `startedAt`/`endedAt` are the UTC instants — the existing tests only assert `workDate` at a
  non-zero offset and use offset 0 everywhere else, so this is the gap that hid the bug (CLAUDE.md §1
  "a measurement where both answers look alike measures nothing").
- registro export: a Spanish venue (offset +60) asserting `horaInicio`/`horaFin` are the LOCAL
  strings and that `fecha` matches the local day the times fall on (the previous-day scenario above).
- A DST-crossing session (in at CEST +120, out at CET +60 on the fall-back night): assert the two
  rendered times carry DIFFERENT offsets and that `workedMinutes` is the true elapsed (UTC) minutes,
  not the wall-clock difference.

## Task B — the tamper chain must hash the correction content it claims to protect (Important ②)

**The defect.** `canonicalString` (`packages/workforce/src/chain-hash.ts`) hashes 10 fields but NOT
`correction_reason` (art. 34.9's attributable/contestable field), NOT `correction_actor_id` (the
accountable actor — currently safe only by luck because `appendCorrection` sets `recordedByPersonId`
= `correctionActorId` and only the former is hashed), and NOT `captured_by_till_id`. The comment at
`clocking.ts:361-363` claims a correction "cannot dodge the tamper-evidence," but a party bypassing
the immutability floor (a superuser past the REVOKE + triggers) could silently rewrite a correction's
REASON or ACTOR and `verifyChain` still returns `ok: true`.

**The fix.** Add `correctionReason`, `correctionActorId`, and `capturedByTillId` to the hashed set.

Requirements:

1. `EntryHashInput` and `VerifiableEntry` (chain-hash.ts) gain `correctionReason: string | null`,
   `correctionActorId: string | null`, `capturedByTillId: string | null`.
2. `canonicalString` commits all three (empty string for null, the existing `?? ""` idiom), grouped
   sensibly — capture attribution near `RecordedByPersonId`, the correction fields together with
   `CorrectsEntryId`/`CorrectionStatus`, `PrevEntryHash` last. Order is free (no stored data), but
   fixed and documented.
3. `chain.ts` `attemptAppend` (line ~162) already INSERTS these columns; add them to the
   `computeEntryHash({...})` call (`entry.capturedByTillId ?? null`, `entry.correctionReason ?? null`,
   `entry.correctionActorId ?? null`).
4. The read-back helpers `readChain` (chain.test.ts:42, chain.concurrency.test.ts:52) must SELECT and
   map the three new columns onto the `VerifiableEntry` — otherwise the recompute diverges. Their
   existing `verifyChain(...) == ok` assertions are the regression signal and must stay green.
5. `content()`/`link()`/`validChain()` helpers in chain-hash.test.ts gain null defaults for the three
   fields.
6. Update the `clocking.ts` `appendCorrection` comment (and the design pointer) so the "cannot dodge
   the tamper-evidence" claim is now TRUE for reason and actor, not overstated.

Tests (RED first each):

- Teeth-tests: extend the `it.each` field-mutation table (chain-hash.test.ts ~line 77) with rows for
  `correctionReason`, `correctionActorId`, `capturedByTillId` — each mutation must change the digest
  (prove the new coverage by the assertion, and by deletion: drop the field from `canonicalString`
  and watch the row go green-when-it-should-fail).
- A verifyChain teeth-test at the chain level: a correction row whose stored `correction_reason`
  (and separately `correction_actor_id`, `captured_by_till_id`) is altered post-hoc → `hash_mismatch`.
- The offset-representation-invariance test (chain-hash.test.ts:87-88) must stay green (EventAtMs is
  unchanged).

## Task C — claim-rigor minors (CLAUDE.md §1/§3)

1. `packages/workforce/src/verify-pin.ts:6-7` — the comment says "the clock-in path (Slice 2) is the
   caller that will verify against it," but the Slice-2 clock-in path shipped in #47 does NOT verify a
   PIN (`ClockEventInput` has no PIN field; no `verifyPin` caller exists outside tests). Correct the
   comment to state plainly that no caller is wired yet — the PIN-login/clock-with-PIN consumer is a
   later slice — rather than attributing it to Slice 2.
2. `packages/workforce/src/errors.ts` — `person.not_found` (line 25) and `person.pin_invalid`
   (line 28) are declared but thrown NOWHERE (grep-confirmed; `employment.not_found` and the
   `attendance.*`/`correction.*` codes ARE thrown). `person.pin_invalid`'s doc even describes a
   throw site ("../verify-pin.ts returned false") that does not exist. Per the repo's "no code before
   its consumer" ethos and §3 (a wrong permanent code is a liability), REMOVE both unused codes; the
   PIN-login path re-adds them beside its throw site when it lands. Confirm nothing references them
   (typecheck + full package suite stay green) and that the errors.reachability suite still passes.
3. `packages/workforce/src/migrations.ts:11` — the comment says workforce is registered "after
   `core`, before `credentials`"; the manifest's adjacent successor is `fiscal`, not `credentials`.
   Correct it to match the manifest.

## Whole-branch review — additional fixes (D, E, and comment fixes)

The pre-PR whole-branch review (two read-only reviewers) surfaced more, and on the owner's
instruction to fix rather than defer, these landed in this PR too:

- **Comment fixes** (claim-rigor, §1/§7): a stale `person.*` reference in `errors.ts`'s
  `correction.target_not_found` doc that Task C's header scrub missed below its hunk; the
  `capturedByTillId` hash justification over-cited art. 34.9 (which names the start/end times, not the
  capturing device) — reworded to "capture provenance, hashed for tamper-evidence" (the hashing is
  unchanged and correct); and a house-style note on `localWallClock` that it deliberately mirrors, but
  does not import, the fiscal `formatDateTime` (cross-domain dependency avoided).

- **Fix D — correction precedence on the hashed `sequence_no`, not the unhashed `ingest_seq`.**
  `applyCorrections` tie-broke "latest approved correction wins" on `ingest_seq`, which is NOT in the
  chain hash — so a party past the immutability floor could swap two corrections' `ingest_seq` and
  flip which corrected time is effective while `verifyChain` still returned `ok`. `sequence_no` IS
  hashed and contiguity-checked, and is the same append order made tamper-evident (so this is not a
  reversal of design §5's "chain by ingest"). Behaviour-preserving in normal operation; proven by a
  disagree-fixture unit test (higher `ingest_seq` paired with lower `sequence_no`) and by mutation.

- **Fix E — per-person serialization for the clockIn/clockOut TOCTOU.** `currentState` was an
  unlocked SELECT before `appendToChain`'s per-location head lock, so two concurrent same-person
  clock-ins could both read "out" and append a double-`in`, which the projection resolves by keeping
  the second — undercounting worked time in a legal record. Fixed with a `SELECT … FOR UPDATE` on the
  `persons` row (a `lockPerson` helper) at the head of all four clock methods, before the state read;
  lock order is persons → `workforce_chains` head, uniform across methods, so no deadlock. Proven by a
  REAL-Postgres concurrency test (PGlite can't show it — single backend), RED-as-bug first (both
  clock-ins committed) and load-bearing by deletion.

**Why these were fixed here, not deferred to D2** (the deferral this section originally proposed): the
review checked `feat/workforce-d2-scheduling` directly — D2 adds new code to `clocking.ts`/
`projection.ts` (roster publish, overtime projection) but does NOT fix either bug and does NOT touch
`applyCorrections` or the clock state machine. So both fixes are self-contained and collide with D2
only as a routine same-file rebase at land time, not a design conflict. Nothing from this review
remains deferred.
