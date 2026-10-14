# A679: complete first fiscal setup

**Proposal for owner review, 2026-10-14. No implementation approval or plan.**
You must be able to prepare a new restaurant and finish fiscal setup through the wizard,
without a repository checkout, shell commands or a Cloud subscription.
An allocation is the signed assignment of an installation identity and its invoice series.
A custodian is the named person who keeps the signing key and the current master register.

## Scope and evidence

A679 goes before W41s-6 under the owner's 21:05 directive. W41s-6 is parked at
`beee37c61dca221b20dba5d1c822a1ead6ea3e72`, without a push or PR, and rebases afterwards.
The driver ran the fresh-reset onboarding wizard on main `641665e4c0be3828a61ec98975bdfd461b5a5edb`.
Prepare posted no `initialOperations`, returned HTTP 400 `sif.allocation_invalid / reauthentication_required`,
and showed a network/certificate failure with Try again. Status stayed unprovisioned.
This was development-mode preproduction; no production box was run. Receipt: Lane E `receipts/a679/reproduction.json`.
The A680 plan was read in Lane B's worktree, not on main. Its automatic throwaway custodian
belongs only to development/test. A679 neither duplicates that signer nor changes its scope.

Reading receipts on this tree:

| Path | What the source shows |
| --- | --- |
| `apps/setup/src/api/client.ts:72`, `setup-app.ts:856` | The provision body has no `initialOperations`; the wizard posts its assembled draft. |
| `apps/server/src/setup-api.ts:475`, `:524` | The server parses and forwards that optional input. |
| `packages/provisioning/src/initial-venue-input.ts:37`, `venue-apply.ts:511` | Planned node/admin IDs and module event/source inputs bind setup authority before seeding. |
| `packages/fiscal-verifactu/src/allocated-lifecycle.ts:16` | Missing operation input refuses with `sif.allocation_invalid / reauthentication_required`. |
| `apps/server/src/fiscal-readiness-runner.ts:113` | The readiness test uses a retained, separate preproduction database and the supplied initial operations. |

The table is source evidence; the browser observation is the separate receipt above.
The historical numeric-schema wording in W41s §9.4 is superseded by the schema below.

## Settled W41s requirements

Follow [W41s §3 and §9.1–9.4](2026-10-04-fiscal-prevention-and-offline-recovery-design.md).
Its dated owner decisions and landed validation are constraints; A679 does not reopen recovery policy.

- Keep one named custodian and one writable current master outside every venue and venue backup.
  Reserve names across all venues of the taxpayer/software/environment, including series used elsewhere.
- Initial paper names use `S` plus six digits. Recovery paper, Cloud and emergency spaces remain disjoint.
  Do not infer that `S000001` is free because this box or venue is new.
- Keep the separate Ed25519 private signing key off the box and out of venue backups/recovery packs.
  A public key inside an allocation cannot enrol itself. Compare its fingerprint independently
  with the current outside register. A valid signature does not prove that register is current.
- Record the exact assignment and mark it consumed outside before local activation. An abandoned
  or failed activation never frees it. An old printout, backup or uploaded snapshot is not the master.
- Bind signed consumption, approval and independently collected evidence to the same allocation,
  taxpayer, software, environment, complete series, event, source, target node and operator.
- Validate candidate identities and boundary invoice numbers with the real fiscal validator before
  issuing/printing a block. Keep the exact purpose set, base/name/counter bounds and duplicate checks.
- Initial setup confirms the absence of a former machine for this activation and no parallel setup.
  This is an operational statement, not remote fencing. Keep issuance disabled on missing evidence.
- Preserve existing fiscal assertions, golden huella and immutability tests unmodified. Changes to
  `registerSif`, `restoreFiscal`, alta builders, hashes or numbering need the driver's explicit scope gate.

## Three approaches and recommendation

| Approach | What you do | Tradeoff |
| --- | --- | --- |
| B. Import only | Your separately held custodian supplies signed public allocation/consumption files. You compare the fingerprint and confirm the current master separately. | Smallest signing surface, but leaves an ordinary new owner needing a friendly outside signing tool. Import alone does not meet the goal. |
| C. Guided kit only | On the custodian's own computer, use a downloaded browser tool to retain a key, establish the master, and sign public files for the box. | Accessible first use; must not start a second master when one already exists. |
| A. Both, recommended | Offer guided kit creation when there is no master, and import when you already have a custodian. Both converge on the same checks. | More UI, but serves both first-time and established taxpayers without replacing outside authority. |

**Pending OWNER decision 1:** import, guided kit, or both? Recommend A. For taxpayer B12345674,
you can finish a genuine first installation without a developer; a second venue uses the same master.
The drawings show A's proposed retention checkpoint, not a working product or an approved choice.

## Worked example and guided journey (proposal A)

You enter **Restaurante Olivo S.L., B12345674**, a new Madrid venue, and administrator Elena.
Elena chooses bases `A` standard, `FF` full and `R` rectificative for this example; the fiscal
module supplies software ID `W1` and validates that complete requested set. If the current production master confirms no earlier assignment,
the custodian reserves `S000001`: `A-S000001`, `FF-S000001`, `R-S000001`.
A second venue takes the next free entry in that master, rather than restarting the sequence.

1. Choose Prepare or Live and finish venue/admin details. Show the actual fiscal environment,
   not just the journey label. Freeze a server-owned setup event before any reservation.
2. After the approved ownership confirmation, the server plans unpredictable node UUID, administrator UUID, module event and source IDs.
   Download a public setup request containing these bindings and the frozen taxpayer/series scope.
   The custodian must sign those same IDs; seeding must not mint replacements afterwards.
3. Ask whether a current register already exists for this taxpayer and environment. Existing:
   import its public files. None: name a custodian and use the outside browser tool to add a kit.
   A second register or a new key must never silently reset consumed/reserved names.
   Before printing a block, reserve its exact serials in that master for the named venue and scope.
4. Proposed master: one writable paper original held by the custodian, not a digital registry.
   The tool signs public receipts; reprints/downloads are snapshots. A digital master needs owner approval.
   Run that tool locally on the custodian's separate computer, disconnected while handling the key.
   Download an encrypted signing-key file and retain it separately from the printable master.
   Print/download the register with scope, generation/block IDs and full public-key fingerprint.
   Test reopening the saved key before releasing its in-memory copy. Keep one writable master;
   additional printouts must say they are snapshots. Printing the private key is an OWNER choice.
5. Mark the reserved entry consumed in the current master for the frozen setup event,
   node, source and Elena's planned ID. Record date, exact series and attempt history, then sign.
   Download public allocation and consumption receipts; retain them with the current master.
6. Back at the box, import only those public files. In a separate confirmation step, compare
   the complete fingerprint from the current master, confirm consultation/consumption for this
   event, and identify its incident record. Do not accept these claims inside `initialOperations`.
7. Review the exact identity set and reconfirm the setup owner before activating. Activation
   cannot substitute for the ownership confirmation before releasing the request in step 2. Activate through the existing allocation checks and one venue transaction.
   Retain public trust and the local committed result durably before publishing trading mode.

**Production and preproduction are independent.** A production allocation cannot seed the
readiness test database. For B12345674, preproduction may independently allocate `S000001`
with its own event, node, allocation/block and consumption evidence; it is not a copy of production.
Its invoices and counters never move into the production database. Live needs accepted readiness
evidence and a distinct production allocation; an accepted test does not authorise production names.
The existing test runner needs the preproduction input before the production activation input.
Real Prepare/preproduction custody is still an OWNER choice; A680 settles only development/test.
Recommend the same real custodian route for both environments, clearly labelled on every artifact.

## Ownership, trust and interruption requirements

**Pending OWNER decision 2:** how do you claim this unconfigured box? The routes currently have
no login (`setup-api.ts:58`); supplying a future administrator password is not an existing login.
Choose the current trusted-local-setup model with a bound owner/event, or a physically obtained
one-use setup code and short-lived session. Neither is approved here; code delivery needs a decision.
Do not extend authentication to adoption or restore in A679; coordinate their existing exclusion.
Reconfirm ownership before releasing a request for consumption and again before activation;
bind the planned administrator credentials without storing plaintext or claiming existing account authority.

One durable owner/event must cover preparation, readiness, public import, trust confirmation and
activation. Reject competing tabs/devices and concurrent provision/adoption/restore events before
any outside consumption. The current POST latch (`setup-api.ts:686`) starts too late for a
multi-screen preparation journey. The current store drops `started` state on error
(`setup-operation.ts:198`); consumed attempts must instead keep their bindings and outcome.
Losing a browser response or restarting must not silently create fresh IDs or another master.

Collect trust and current-register statements through dedicated authenticated host steps, not
through the allocation body. Persist public trust/fingerprint independently of imported evidence;
record the exact consultation for this event. Rereading a persisted `true` is not a fresh consultation.
After interruption, consult the current master again. Replay only when outside bindings and the
local committed allocation result agree. Otherwise leave that entry consumed and record abandonment;
claim a different one when prior activation is uncertain. Never roll back the master with the box.
Changing taxpayer/environment/bases or abandoning a prepared event requires explicit resolution;
after consumption it requires new evidence, never reuse of the old assignment.

Private keys/passphrases stay in the outside tool's memory and explicit encrypted download only.
No upload, analytics, network calls, browser storage, request/error logs or venue backup may carry
them. Use local cryptographic randomness; reject secret-bearing imports without echoing contents.
Use a self-contained downloadable tool with no remote assets; no box endpoint generates the key.
The box accepts bounded public files and stores secret-free audit references. Report a write that
committed separately from a failed refresh; do not offer a blind activation retry.

## Persistent host configuration and actual schema

`allocation-configuration.ts:8–10` reads three `WAITRON_FISCAL_*` values from `process.env`.
`node-entry.ts:488` passes merged box settings to `startServer`; `box-env.ts:7–33` returns a
separate object. `config.ts:410` reads that object, while `trading-config.ts:32` writes only
trading identity/settings. `deploy/compose.yml:21–43` supplies no custodian settings.
The direct server entry (`bin.ts:7`) passes `process.env`; the CLI's initial input file
(`packages/provisioning/src/cli.ts:330`) also supplies no independent trust by itself.
Consequently a parser/UI change alone does not connect durable box settings to this collector.
A679 must define and exercise a persisted public configuration reader at preparation and after
restart. Paths must be host-selected, not browser input. Missing/changed trust must refuse,
and saved event confirmation must not become perpetual authority. Do not solve this by retaining a key.

Generic host code must carry module IDs, opaque input and generic bindings through module seats.
Here, opaque means only the module interprets the input; seats are its extension points.
The fiscal module owns `S` names, `W1`, signature formats, series rules and refusal meanings.
Use a browser-safe module contribution for its screens; do not hardcode Veri*Factu vocabulary
or import a fiscal implementation into the host. A no-filing module skips this allocation step.

Actual schema: `schema/sif.ts:22` already stores a text identity; `schema/allocations.ts:20–45`
stores allocation, approval, bases and committed result, with scoped unique keys. Migration
`packages/fiscal-verifactu/drizzle/0006_numerous_roughhouse.sql` installs both. No second identity
conversion or fiscal-ledger migration is indicated by this read. Persistent setup ownership/trust
can use box files (writer's recommendation); a new SQL representation would need a migration.
Decide after owner answers; do not edit shipped SQL or add speculative compatibility/backfills.

## Remaining owner choices and presentation calls

Ask decision 1 first. Then settle real preproduction custody, first-setup ownership/code delivery,
who holds the paper master, and whether an encrypted key file suffices or secret paper is required.
Suggested first question: “For Olivo, B12345674, should first setup import a custodian's signed
files, help you make and retain an outside kit, or offer both? I recommend both.”
Cloud allocation fetching/reconciliation belongs to W41s-C3. Recommend the same paper route for
subscribers until then; ask only if subscriber setup must behave differently before C3 arrives.

Minor writer calls: retain existing venue/certificate/email/readiness steps; put allocation before
final activation; show register retention before public import. Use semantic fields and concise
EN/ES labels, required marks, inline errors plus the bottom form message, quiet unavailable actions,
draft protection and 44px targets from the shared UI contract. No top error summary.
The four [static drawings](../../backlog/mockups/a679-first-fiscal-setup/) show light-theme desktop
and phone proposals with explicit pending confirmations. They make no claim about browser behavior.
Driver validation must cover real wizard/restart/concurrency/refusals and both themes; preserve
the existing fiscal checks and their assertions. No implementation plan precedes the owner answers.
