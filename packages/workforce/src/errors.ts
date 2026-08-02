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
     * (identical from the caller's side). Forward-declared for the D2.2 shift-mutation consumers
     * (move/reassign/delete a specific shift), the same way `person.not_found`/`person.pin_invalid`
     * above are declared ahead of the identity sub-project's lookups. `shift.*`, grepped against the
     * whole registry — unused before D2, never `schedule.*` (a shift is the entity, the schedule is
     * the aggregate). */
    "shift.not_found": { tenantId: string; shiftId: string };
    /** No `roster_versions` row for this id under the current tenant — never created, or hidden by
     * RLS. Raised by `publishRoster` (../clocking.ts) when asked to publish a version that does not
     * exist. `roster.*`, grepped against the registry — unused before D2; the guardrail-breach codes
     * the D2.3 engine adds group under the same prefix because they gate the roster publish. */
    "roster.not_found": { tenantId: string; rosterVersionId: string };
    /** `publishRoster` was asked to publish a version whose `status` is no longer `draft` — a second
     * publish of an already-`published` (or `superseded`) roster. A roster is published exactly once;
     * republishing is refused rather than silently re-stamping `published_at`. Distinct from
     * `roster.not_found` (the version does not exist); here it EXISTS but is not in a publishable
     * state. */
    "roster.already_published": { tenantId: string; rosterVersionId: string };
    /** An approval named a correction that is not an approvable PENDING request — its target entry
     * already carries an `approved` correction. Covers both re-approving the same request (the
     * request row stays `requested` forever, since approval is a second append, never a mutation —
     * so a status check on the request cannot catch it) and naming an already-`approved` row. Either
     * would append a duplicate `approved` row and break the request→approve-once invariant. Distinct
     * from `correction.target_not_found`, which is no such correction row at all; here the correction
     * EXISTS but is not approvable. `correction.*`, grepped against the registry — never renamed. */
    "correction.not_pending": { tenantId: string; correctionId: string };
  }
}
