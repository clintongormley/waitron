// A bare side-effect import: it makes TypeScript augment "@waitron/shared" rather than declare a
// fresh ambient module.
import "@waitron/shared";

/**
 * This package's codes in the shared error registry. Clock-in/out failures are `attendance.*`
 * because packages/fiscal owns `clock.*` for the trusted clock.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No `employments` row for this person, so there is no overtime baseline. */
    "employment.not_found": { personId: string };
    /** A clock-in while clocked in, or a break-start while already on break. */
    "attendance.already_open": { personId: string };
    /** A clock-out or break with no open shift, or a break-end with no open break. */
    "attendance.no_open_entry": { personId: string };
    /** `appendToChain` (../chain.ts) exhausted `MAX_APPEND_ATTEMPTS`, each attempt refused by
     * `time_entries_chain_position_uq`. With one write transaction at a time on the venue file,
     * whether anything still reaches this is not established. */
    "attendance.append_contention": {
      nodeId: string;
      locationId: string;
      attempts: number;
    };
    /** A correction or an approval named an entry that does not exist. */
    "correction.target_not_found": { entryId: string };
    /** The approver's `persons.role` is not supervisor, manager or admin. */
    "correction.not_permitted": { personId: string };
    "shift.not_found": { shiftId: string };
    "roster.not_found": { rosterVersionId: string };
    /** The version is no longer a `draft`: a roster is published exactly once. */
    "roster.already_published": { rosterVersionId: string };
    /** Another version is already `published` for the same (location, exact period) — the
     * `roster_versions_published_period_uq` refusal, translated. */
    "roster.period_already_published": { rosterVersionId: string };
    /** A draft already exists for this (location, week); the unique index covers only published rows. */
    "roster.draft_exists": { locationId: string };
    /** A shift write named a roster version that is no longer a `draft`. */
    "roster.not_draft": { rosterVersionId: string };
    /** The shift starts at or after its end. `reason` names which invariant failed; on add there is
     * no shift id yet. */
    "shift.invalid": { reason: string };
    /** The target entry already carries an `approved` correction. A request row stays `requested`
     * after approval (approval is a second append), so its own status cannot show this. */
    "correction.not_pending": { correctionId: string };
    "absence.not_found": { absenceId: string };
    /** The range overlaps another absence for the same person, inclusive on both ends. */
    "absence.overlaps": { personId: string };
    /** The absence ends before it starts. Shaped like `shift.invalid`: on create there is no id yet. */
    "absence.invalid": { reason: string };
    "swap.not_found": { swapId: string };
    /** The requester does not own `from_shift`, the return `to_shift` is not `to_person`'s, or the
     * acceptor is not `to_person`. */
    "swap.not_permitted": { personId: string };
    /** Only a `requested` swap may be accepted. */
    "swap.not_acceptable": { swapId: string };
    /** Only an `accepted` swap may be approved or rejected. */
    "swap.not_decidable": { swapId: string };
  }
}
