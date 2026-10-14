# W41s-4: when a standby's reserved identity becomes active

**Owner decision, 2026-10-12 19:45:** A is approved: reserve at join, switch on at takeover.
The proposal and source findings below record the decision's basis. Implementation must retain
all standard, full and rectificative purposes. The signed dormant paper-reservation proof and
stored-scope validator are now on this branch; host integration remains open.

Task 4 must replace the standby's local counter allocation as well as setup and recovery.
The existing standby flow prepares its future identity while the primary is still serving.
The approved recovery contract requires the old selling machine to be offline before activation.
Those are different moments, and the current contract does not define a standby-reservation mode.

## The current paths

- `apps/server/src/mirror-bundle.ts:141` calls the module's reservation seat while assembling
  the bundle for a standby. The primary is still operating. The module currently increments
  the local installation counter (`packages/fiscal-verifactu/src/provisioning.ts:98`).
- `apps/server/src/reserved-identity.ts:83` establishes the reserved state during adoption.
  `packages/fiscal-verifactu/src/provisioning.ts:111` writes the reserved SIF and starts its
  empty chain before promotion.
- `apps/server/src/promote.ts:151` promotes that existing identity. It has no module activation
  seat. The manager route checks authentication at `apps/server/src/promote-api.ts:80`, but
  passes only the fencing attestation to promotion at line 100.
- The new envelope's modes are `initial-setup` and `recovery`
  (`packages/fiscal-verifactu/src/allocation-envelope.ts:56`). Recovery requires
  `oldMachineOffline`, event-bound reauthentication and no parallel recovery. Copying a pending
  file or reservation bundle cannot supply independent outside confirmation.

The binding requirement is design §9.3: on a retry, the outside event and local committed result
must identify the same source, node and complete identity set. Design §9.4 also allows a host
path to refuse a missing allocation before it creates a selling identity. Neither section says
when an ordinary standby reservation must become an outside-consumed recovery allocation.

## Proposed choice

**A — reserve first, activate at promotion (recommended).** Set aside a distinct outside
allocation for the named standby when creating its bundle, without claiming that the current
primary is offline. Carry the complete reservation as opaque dormant state during adoption.
Do not create the standby's selling SIF or active invoice series until promotion. At promotion,
require fresh administrator reauthentication, the old-machine-offline and no-parallel-recovery
confirmations, and independently checked current outside evidence. Mark the reservation consumed
for that activation event in the outside register before writing locally, as design §9.2 requires.
Activate SIF, series and the local audit result together with the promotion's database writes.
A failed local attempt leaves the outside allocation consumed; a lost local result requires a
different allocation. An abandoned standby's reserved name is retired rather than reused.

This changes the current timing: an adopted standby holds a reservation but has no active fiscal
identity until its first promotion. The existing mirror-promotion checks for standard and full
series must therefore follow activation rather than run before it. The allocation and activation
have distinct outside records; adoption alone does not grant permission to sell.

**B — require a new outside allocation only at promotion.** Pair and adopt a standby without a
fiscal allocation or active SIF/series. Obtain and consume the complete outside identity set at
promotion after isolation and administrator authentication. This removes the existing pre-reserved
standby identity rather than carrying it forward. Promotion during an outage needs an available
paper reservation or the emergency procedure.

The owner should choose before Task 4 changes these paths. No standby, adoption or promotion code
has changed in this checkpoint, and the incomplete branch is not a candidate for publication.

## Other integration facts

Setup creates its target node ID inside `packages/provisioning/src/venue-apply.ts:248`; allocation
approval needs to bind that ID before activation. Cold archives have creation time and module
versions but no stable source ID (`apps/server/src/backup-manifest.ts:11`); the restore host needs
a separately defined source identifier. Generic seed, restore, reservation and establishment seats
currently carry no independently checked allocation context. The next implementation must extend
those seats with opaque module state and retain the separate host authority checks.

Preserve the existing `full` invoice purpose. `packages/provisioning/src/venue-plan.ts:203` declares
`FF` with purpose `full`, and restore/promotion require a full series. The design's §9.1 example
calls `FF-P000042` standard; it is an example discrepancy, not permission to change that behavior.
