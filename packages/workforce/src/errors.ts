// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/credentials/src/errors.ts and packages/fiscal/src/errors.ts use.
import "@waitron/shared";

/**
 * packages/workforce's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`employment.*`), never the package name
 * (see the design note atop packages/shared/src/errors.ts).
 *
 * Namespace choice: `attendance.*`, NOT `clock.*`. `clock.*` is already taken by packages/fiscal for
 * the trusted clock (`clock.degraded`, `clock.jump_detected` — packages/fiscal/src/errors.ts), so
 * clock-in/out failures are `attendance.*` — a fact about a worker's shift state, not about the
 * clock. `employment.*` names failures of its own entity (an employment lookup), following the
 * `<entity>.not_found` shape. Codes are never renamed once shipped, so the prefix was grepped
 * against the whole registry first.
 *
 * Reachability: index.ts side-effect-imports ./errors.js, so this augmentation is reachable from
 * the package's own public barrel. See ./errors.reachability.test.ts.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No `employments` row for this person under the current tenant — the overtime baseline a
     * work-session summary needs (art. 35.5) does not exist. */
    "employment.not_found": { tenantId: string; personId: string };
    /** A clock event tried to OPEN a state that is already open — a clock-in while clocked in, or a
     * break-start while already on break. */
    "attendance.already_open": { tenantId: string; personId: string };
    /** A clock event tried to CLOSE or continue a state that is not open — a clock-out or break with
     * no open shift, or a break-end with no open break. */
    "attendance.no_open_entry": { tenantId: string; personId: string };
    /** A clock event or correction could not be appended to its (tenant, location) tamper-evidence
     * chain: `appendToChain` (../chain.ts) exhausted `MAX_APPEND_ATTEMPTS` savepoint retries, each
     * losing the race to CREATE the chain head (SQLSTATE 23505 on `time_entries_chain_position_uq`)
     * — several tills at one location racing the very first append, the one window the head-row lock
     * cannot cover. `attendance.*`, NOT `chain.*`: `chain.*` is owned by packages/fiscal-verifactu
     * for the fiscal encadenamiento (grepped — never renamed once shipped), and from the caller's
     * side this is a fact about an attendance append that could not complete, not about the fiscal
     * chain. Keyed by `locationId` (the chain key) with the retry count, matching fiscal
     * `chain.append_contention`'s shape. */
    "attendance.append_contention": { tenantId: string; locationId: string; attempts: number };
    /** A correction was requested against, or an approval named, an entry that does not exist under
     * the current tenant — never appended, or hidden by RLS (identical from the caller's side).
     * `correction.*`, not `attendance.*`: this is a fact about the correction workflow (a
     * missing target of a correct/approve), grepped against the registry — `correction.*` was
     * unused. */
    "correction.target_not_found": { tenantId: string; entryId: string };
    /** An approval was attempted by a person whose `persons.role` is not one of
     * supervisor/manager/admin. A correction takes effect only when a supervisor approves it (design
     * §5), so a staff-role approver is refused here rather than silently ignored. */
    "correction.not_permitted": { tenantId: string; personId: string };
    /** No `shifts` row for this id under the current tenant — never created, or hidden by RLS
     * (identical from the caller's side). Declared in D2.1 ahead of a consumer; its first thrower is
     * D2.2's `requestSwap` (../shift-swaps.ts), which rejects a swap naming a `from_shift`/`to_shift`
     * that does not exist under the tenant. `shift.*`, grepped against the whole registry — never
     * `schedule.*` (a shift is the entity, the schedule is the aggregate). */
    "shift.not_found": { tenantId: string; shiftId: string };
    /** No `roster_versions` row for this id under the current tenant — never created, or hidden by
     * RLS. Raised by `publishRoster` (../clocking.ts) when asked to publish a version that does not
     * exist. `roster.*`, grepped against the registry — unused before D2; the prefix groups the three
     * codes `publishRoster` throws (`roster.not_found`, `roster.already_published`,
     * `roster.period_already_published`). The D2.3 guardrail breaches do NOT live here: they are
     * ADVISORY (OWNER DECISION 2026-08-02) — a `RosterBreach` discriminated union that `validateRoster`
     * (../roster-validation.ts) RETURNS and `publishRoster` surfaces without ever blocking the publish,
     * never thrown codes — so no `roster.rest_too_short`-style code exists. */
    "roster.not_found": { tenantId: string; rosterVersionId: string };
    /** `publishRoster` was asked to publish a version whose `status` is no longer `draft` — a second
     * publish of an already-`published` (or `superseded`) roster. A roster is published exactly once;
     * republishing is refused rather than silently re-stamping `published_at`. Distinct from
     * `roster.not_found` (the version does not exist); here it EXISTS but is not in a publishable
     * state. */
    "roster.already_published": { tenantId: string; rosterVersionId: string };
    /** `publishRoster` (../clocking.ts) tried to publish a version but another `published` version
     * already exists for the SAME (location, exact period), so the publish would leave two — rejected
     * by the `roster_versions_published_period_uq` partial unique index (23505), translated here.
     * The supersede path demotes an incumbent published version before promoting the new one, so this
     * is reachable only under CONCURRENCY: a competing publish of a different draft for the same period
     * committed after this transaction took its lock snapshot, so the index — not the lock — is what
     * catches it. Distinct from `roster.already_published`, which is the SAME version being published
     * twice. `roster.*`, grepped against the registry — never renamed once shipped. */
    "roster.period_already_published": { tenantId: string; rosterVersionId: string };
    /** `createRosterVersion` (../clocking.ts) was asked to open a draft for a (tenant, location, week)
     * that already has one. The published-uniqueness index covers only PUBLISHED rows, so drafts need
     * this guard to keep the authoring screen from silently forking two drafts of one week. `roster.*`,
     * grepped against the registry — the prefix already groups publishRoster's codes. */
    "roster.draft_exists": { tenantId: string; locationId: string };
    /** A shift write named a roster version whose `status` is not `draft` (published or superseded) —
     * planning is closed once a version is published, so a shift add/edit/remove against it is refused.
     * Distinct from `roster.not_found` (the version does not exist); here it EXISTS but is not editable.
     * `roster.*`, grepped — groups with publishRoster's codes. */
    "roster.not_draft": { tenantId: string; rosterVersionId: string };
    /** A shift's planned interval is malformed — its start is at or after its end. Refused BEFORE the
     * insert/update so a caller gets a structured 4xx rather than the `shifts_interval_ck` 23514 → 500.
     * `reason` names WHICH invariant failed (no shiftId: on add the row does not exist yet). `shift.*`,
     * grepped — the entity is the shift. */
    "shift.invalid": { tenantId: string; reason: string };
    /** An approval named a correction that is not an approvable PENDING request — its target entry
     * already carries an `approved` correction. Covers both re-approving the same request (the
     * request row stays `requested` forever, since approval is a second append, never a mutation —
     * so a status check on the request cannot catch it) and naming an already-`approved` row. Either
     * would append a duplicate `approved` row and break the request→approve-once invariant. Distinct
     * from `correction.target_not_found`, which is no such correction row at all; here the correction
     * EXISTS but is not approvable. `correction.*`, grepped against the registry — never renamed. */
    "correction.not_pending": { tenantId: string; correctionId: string };
    /** No `absences` row for this id under the current tenant — never created, or hidden by RLS.
     * Raised by `setAbsenceStatus` (../absences.ts) when asked to move a non-existent absence to
     * approved/rejected. `absence.*`, grepped against the whole registry — unused before D2, and the
     * English `absence` term (the Spanish `ausencia` is in SPANISH_WORDS, so the code stays English
     * like the schema, following the domain-concept convention). */
    "absence.not_found": { tenantId: string; absenceId: string };
    /** `createAbsence` (../absences.ts) was asked to create an absence whose date range overlaps an
     * existing absence for the SAME person under this tenant (inclusive on both ends). One person
     * cannot be absent twice over the same day, so the overlapping range is refused before insert.
     * `absence.*`, same reasoning as `absence.not_found`. */
    "absence.overlaps": { tenantId: string; personId: string };
    /** An absence's date range is malformed — its end day is BEFORE its start day
     * (`ends_on < starts_on`). Refused by `createAbsence` (../absences.ts) BEFORE the overlap SELECT
     * and the insert so a caller gets a structured 4xx (400 at the schedule route) rather than the
     * `absences_range_ck` (`ends_on >= starts_on`, schema/absences.ts) 23514 surfacing as an opaque
     * 500; that DB check stays the backstop. The range is INCLUSIVE, so `ends_on == starts_on` (a
     * single-day absence) is VALID and does not trigger this. Param shape MIRRORS `shift.invalid`, the
     * sibling malformed-interval code — `{ reason }`, not the `{ personId }` of `absence.overlaps` /
     * `{ absenceId }` of `absence.not_found`: on create the absence row does not exist yet (no id to
     * name), and `reason` names WHICH interval invariant failed, leaving room for later ones exactly as
     * `shift.invalid` does. `absence.*`, grepped against the registry (`absence.not_found`,
     * `absence.overlaps`) — never renamed once shipped. */
    "absence.invalid": { tenantId: string; reason: string };
    /** No `shift_swaps` row for this id under the current tenant — never created, or hidden by RLS.
     * Raised by `acceptSwap` (../shift-swaps.ts) when asked to accept a swap that does not exist.
     * `swap.*`, grepped against the registry — unused before D2; the entity is the swap (a shift is
     * `shift.*`, a person `person.*`). */
    "swap.not_found": { tenantId: string; swapId: string };
    /** A swap action was attempted by a person not permitted it. Three cases, all in
     * `requestSwap`/`acceptSwap` (../shift-swaps.ts): `requestSwap` refuses a requester offering a
     * `from_shift` that is not THEIRS, and refuses a supplied return `to_shift` that is not owned by
     * the person the swap is offered TO (`to_person`) — you may put up only your own shift as the
     * offer, and only that person's own shift as the return leg; `acceptSwap` refuses anyone but the
     * swap's named `to_person` accepting it. A fact about the swap's permission rule, not a missing
     * entity (that is `swap.not_found`/`shift.not_found`) and not a wrong state (that is
     * `swap.not_acceptable`/`swap.not_decidable`). `swap.*`, grepped — never renamed. */
    "swap.not_permitted": { tenantId: string; personId: string };
    /** `acceptSwap` (../shift-swaps.ts) was asked to accept a swap whose `status` is not `requested` —
     * an already-`accepted` swap, or an `approved`/`rejected` terminal one. Only a `requested` swap may
     * be accepted; accepting again would flip a decided swap back to `accepted`. Distinct from
     * `swap.not_found` (no such swap) and `swap.not_permitted` (the acceptor is not the `to_person`):
     * here the swap EXISTS and the acceptor IS the recipient, but its state forbids the accept —
     * exactly mirroring `swap.not_decidable`'s exists-but-wrong-state shape for the manager's decide.
     * `swap.*`, grepped against the siblings (`swap.not_found`, `swap.not_permitted`,
     * `swap.not_decidable`) — all `swap.not_<x>`, so the shape matches; never renamed once shipped. */
    "swap.not_acceptable": { tenantId: string; swapId: string };
    /** `decideSwap` (../shift-swaps.ts) was asked to approve/reject a swap whose `status` is not
     * `accepted` — a `requested` swap has not been accepted yet, and an `approved`/`rejected` one is
     * terminal. Distinct from `swap.not_found` (no such swap); here it EXISTS but is not in a decidable
     * state, mirroring `roster.already_published` = exists-but-wrong-state (`errors.ts:72`). `swap.*`,
     * grepped against the two siblings (`swap.not_found`, `swap.not_permitted`) — both `swap.not_<x>`,
     * so the shape matches; never renamed once shipped. */
    "swap.not_decidable": { tenantId: string; swapId: string };
  }
}
