# A679: first Live fiscal setup

**Proposal for owner review, decision update 2026-10-15. No full-design or build approval.**
You must be able to finish Live fiscal setup without a repository checkout, shell commands or
Cloud subscription. An allocation is a signed assignment of an installation identity and its
invoice series. Your custodian keeps the signing key and current master register outside the box.

## Settled scope and order

The owner's 2026-10-14 Lane E decisions supersede the earlier scope and order:

- **21:50, option A approved:** offer BOTH a guided first outside paper kit and import from an
  existing custodian. Both routes converge on the same public import and authority checks.
- **22:00:** Demo and Preparation need no kit or allocation import. B/A680 owns the automatic,
  clearly marked throwaway preproduction signer in the box, refused in production, with a deletion
  control. A679 must use that work, not implement a second signer. Live always needs real outside custody.
- **22:05:** only Demo is urgent before morning, handled by B/A680. Finish and publish these Live
  design docs now. Un-park and finish W41s6; build A679 after W41s6 lands, before W41s7, on A680.
  This order does not approve the full A679 design or its build. The driver owns queue changes.
- **2026-10-14 at 22:35, option A approved:** keep current local-network ownership for first Live
  setup. Claim the attempt through the existing local wizard, durably bind its owner/event, refuse
  competing tabs/devices for that attempt, and reconfirm before using the number block and before
  activation. No physical-code step; adoption/restore authentication stays outside this change.

**2026-10-15 decision update:** per the owner's handoff, W41s6 has landed in PR #1717; A680 has
not landed. A680 owns kit-free Demo/Preparation and the separate readiness work described below.
Build A679 after both land, before W41s7, subject to remaining retention choices and full-design
approval. These are design requirements, not claims of implemented behavior. All first-publication
reproduction and source-read receipts below remain historical evidence from 2026-10-14; this update
does not rerun or replace them.

**2026-10-15 pointer (A680):** A680 gives Demo and Preparation a throwaway allocation with no
kit. It does not build the throwaway allocation for Live's separate preproduction readiness test
described below: the setup route's fiscal test accepts only a production Live request, which
never asks for one. That allocation is not built yet; see the A679 entry in `docs/backlog.md`.

## Evidence and source reads

The driver reproduced fresh-reset Prepare on main `641665e4c0be3828a61ec98975bdfd461b5a5edb`:
no `initialOperations`, HTTP 400 `sif.allocation_invalid / reauthentication_required`, a
network/certificate failure with Try again, and unprovisioned status. This was development
preproduction, explicitly NOT production. Receipt: Lane E `receipts/a679/reproduction.json`.
This revision reads source only; it runs no wizard, tests or product code and claims no A680 landing.

| Path/function read | What the source shows |
| --- | --- |
| `apps/setup/src/api/client.ts` (`ProvisionBody`), `setup-app.ts` (`assembleBody`) | No declared allocation input; the wizard submits its draft. |
| `apps/server/src/setup-api.ts` (`parseProvisionPayload`, fiscal-test/provision routes) | Parses optional input; fiscal-test requires Live/production; production provision checks readiness first. |
| `apps/server/src/boot.ts` (`runFiscalTest`, `assertFiscalReady`) | Passes request operations to the test runner; checks separately stored readiness evidence before provisioning. |
| `apps/server/src/fiscal-readiness-runner.ts` (`submitFiscalReadiness`, `testVenue`) | Retains `fiscal-readiness-db-<binding>` separately, stamps it preproduction, and records/drains there with supplied operations. |
| `apps/server/src/fiscal-readiness.ts` (`createFiscalReadinessStore`) | Stores accepted evidence bound to venue/certificate/module/build inputs; an applicable Live activation requires matching evidence. |
| `packages/provisioning/src/initial-venue-input.ts`, `venue-apply.ts` (`applyVenue`) | Planned node/admin IDs and module event/source inputs bind initial authority before seeding. |
| `packages/fiscal-verifactu/src/allocated-lifecycle.ts` (`activate`) | Missing operation input refuses with `sif.allocation_invalid / reauthentication_required`. |

These are source-read receipts, separate from the driver's historical browser reproduction.

## Settled W41s constraints

Keep [W41s §3 and §9.1–9.4](2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
and its settled signature, consumption, fingerprint and current-master requirements:

- One named custodian and one writable current master stay outside every venue and venue backup.
  Reserve names across all venues of the taxpayer/software/environment, including series used elsewhere.
- Initial paper names are `S` plus six digits; recovery paper, Cloud and emergency spaces stay disjoint.
  A new box or venue is no evidence that `S000001` is free.
- The separate Ed25519 private key stays off the box and out of venue backups/recovery packs.
  A public key inside an allocation cannot enrol itself. Independently compare its complete
  fingerprint with the current outside master; a valid signature does not establish currency.
- Record the exact assignment and mark it consumed outside before activation. Abandonment or
  failure never frees it. Old printouts, backups and uploaded snapshots cannot replace the master.
- Bind signed consumption, approval and separately collected evidence to the same allocation,
  taxpayer, software, environment, complete series, event, source, target node and operator.
- Before issuing/printing a block, run the real fiscal validator over candidates and boundary invoice
  numbers. Keep the exact purpose set, base/name/counter bounds, finite capacity and duplicate checks.
- Initial setup confirms no former machine for this activation and no parallel setup. That statement
  does not remotely stop another machine. Missing evidence keeps issuance disabled.
- A679 changes no `registerSif`, `restoreFiscal`, alta builders, hashes, numbering, golden huella
  or inmutabilidad assertions. Preserve existing fiscal checks and behavioral assertions.

## Live readiness and production activation

**Intended A679/A680 contract, requiring joint validation:** Live readiness always uses the
retained separate preproduction database. It must obtain A680's throwaway allocation automatically,
without asking you for a real preproduction kit or imported allocation. Its own event, planned
node/admin IDs and module inputs belong to that database. Keep accepted readiness evidence and
its existing bindings. A680's production refusal must judge the actual target database/environment:
a Live wizard's production request cannot authorise a throwaway production activation.

The later Live activation needs a distinct real production signed allocation and outside consumption.
Do not forward that production input into readiness or copy readiness allocation evidence into Live.
For Olivo, the test uses A680's disposable preproduction identity; production separately reserves
`S000001` only if its current master says it is free. No test data, chain, series or counters are
promoted. Readiness acceptance grants no production name. Trace both host paths again when building;
the source reads above do not establish that A680 already fulfils this contract.

## Worked Live journey (details proposed)

You enter **Restaurante Olivo S.L., B12345674**, a new Madrid venue, and administrator Elena.
Elena chooses bases `A` standard, `FF` full and `R` rectificative. The fiscal module supplies
software ID `W1` and validates the complete set. With no prior production assignment in the
current master, the custodian reserves `S000001`: `A-S000001`, `FF-S000001`, `R-S000001`.
A second venue consults the same master and takes the next free entry.

1. Choose Live and finish venue/admin details. Show **Live / Production**. Keep the existing
   certificate, email and readiness steps, with the separate test contract above.
2. Claim first-setup ownership through the existing local wizard, without a physical code. Durably
   bind the owner to a frozen server-owned unpredictable setup event, planned node UUID,
   administrator UUID and module event/source IDs. Refuse competing tabs/devices for this attempt.
   Download a public request bound to those IDs and the taxpayer/environment/complete series.
   Signing and seeding must use those exact IDs; neither may silently replace them. Reconfirm
   ownership before using the number block and again before activation.
3. Ask whether this taxpayer/software/production scope already has a current master. Existing:
   use its custodian and import signed public files. None: name a custodian and guide creation of
   the outside kit. BOTH routes are approved. Never silently start another master or reset names.
4. **Retention proposal:** keep one writable paper original with the named custodian. Use a
   downloaded self-contained browser tool on their separate computer, disconnected while handling
   the key. Save an encrypted key file separately from the printed master and test reopening it
   before releasing the in-memory key. Print/download scope, generation/block IDs and full public-key
   fingerprint; label extra copies as snapshots. Paper versus digital master and secret-paper key
   retention remain OWNER choices. Reserve exact serials in the master before printing a block.
5. Mark the entry consumed in that current master for the frozen event, source, node and Elena's
   planned ID. Record time, exact series and attempt history, then sign allocation/consumption
   receipts. Keep them with the master. Once consumed, the entry stays consumed.
6. At the box, import only public files. Separately compare the complete fingerprint from the
   current master, confirm fresh consultation/consumption for this event and identify its incident
   record. Dedicated host steps bound to the claimed owner collect these claims, not
   `initialOperations`.
7. Review all identities and reconfirm ownership before activation. That confirmation cannot replace
   step 2. Use existing allocation checks and one venue transaction. Retain public trust and the
   local committed result durably before publishing trading mode; accepted readiness is also required.

## Ownership, interruption and secret boundaries

First-publication source read (2026-10-14): Setup routes currently have no login
(`apps/server/src/setup-api.ts`, `mountSetup`); the future administrator's password is no existing
login.

**Approved ownership design, 2026-10-14 at 22:35; recorded here 2026-10-15:** keep current
local-network ownership. A679 must let you claim the attempt through the existing local wizard,
durably bind its owner/event, refuse competing tabs/devices for that attempt, and reconfirm ownership
before the number block is used and before activation. No physical-code step. Do not extend adoption
or restore authentication; coordinate their existing mutual exclusion. Bind planned administrator
credentials without storing plaintext or treating that future administrator as an existing account
with authority. These are requirements for the design, not implemented behavior claims.

One durable owner/event covers preparation, readiness, public import, trust confirmation and activation.
Reject competing tabs/devices and provision/adoption/restore events before outside consumption.
The POST latches in `mountSetup` begin too late for this journey; `createSetupOperationStore`
(`apps/server/src/setup-operation.ts`) deletes `started` state on error. Consumed attempts must retain
bindings/outcomes. A lost response or restart must not mint fresh IDs or another master.

Persist public trust independently of imports; saved `true` is not fresh consultation. After an
interruption, consult the current master again. Replay only when outside bindings and the local
committed result agree. Otherwise leave the entry consumed, record abandonment and claim a different
one if activation is uncertain. Never roll the master back with the box. Changed scope/bases or an
abandoned event require explicit resolution. After consumption, use new evidence and a fresh assignment
unless the committed replay above agrees; never reuse an uncertain assignment.
Report a committed write separately from a failed refresh. Offer no blind restart or activation retry.

Under the proposed encrypted-file retention route, private keys/passphrases stay in the outside
tool's memory and explicit encrypted download only. The private-key retention format remains open.
No uploads, analytics, network calls, browser storage, request/error logs or venue backups carry them.
Use cryptographic randomness and no remote assets. No box endpoint generates a real custody key.
Bound public imports and reject secret-bearing files without echoing contents; audit references stay public.
A680's disposable preproduction key is the separate approved exception, never real Live custody.

## Host persistence, module boundary and schema

Source read: `packages/fiscal-verifactu/src/allocation-configuration.ts` (`FISCAL_OPERATIONS`)
reads three `WAITRON_FISCAL_*` values from `process.env`. `loadBoxEnv` returns a separate merged
object; `runEntry` passes it to `startServer`, and `loadConfig` reads that argument. `writeTradingEnv`
stores trading settings, not custodian settings. The direct `apps/server/src/bin.ts` passes
`process.env`; the provisioning CLI's `WAITRON_INITIAL_VENUE_INPUT` file is no independent trust.
A679 must connect a durable public configuration reader to collection before activation and after
restart. Host code selects paths, not browser input. Missing/changed trust refuses; saved event
confirmation is not perpetual authority. Box files are the writer's proposal, not an approved choice.

Generic host code carries module IDs, opaque inputs (interpreted only by their module) and bindings
through module seats, its extension points. The fiscal module owns `S` names, `W1`, signatures,
series rules and refusals. Use browser-safe module screens; the host imports no fiscal implementation
or hardcoded Veri*Factu vocabulary. Modules with no filing contribution skip allocation.

Source read: `packages/fiscal-verifactu/src/schema/sif.ts` already holds a text identity;
`schema/allocations.ts` holds allocation, approval, bases and committed results with unique keys.
`drizzle/0006_numerous_roughhouse.sql` installs them. W41s §9.4's historical numeric description is
superseded. No second identity conversion or ledger migration is indicated by this read. A new SQL
ownership/trust representation would need a migration; do not edit shipped SQL or add compatibility.

## Remaining decisions and driver handoff

**Next owner question, one at a time:** “Should the current writable master register be PAPER or
DIGITAL? I recommend one current paper original so you can record offline consumption on paper.”
This is a proposal, not approval; digital custody remains an option. W41s already requires one named
custodian and one writable current master outside venue backups. Paper blocks and uploaded snapshots
confer no current authority. After choosing the master format, ask separately about private-key
retention (encrypted key file versus additional secret paper), then name the custodian. None of
those choices is settled here. Ownership is settled and must not be asked again.
Cloud fetching/reconciliation remains W41sC3. Use the paper route for subscribers until then;
that default creates no new owner question.

The four [static EN/ES drawings](../../backlog/mockups/a679-first-fiscal-setup/) keep 1280/390 widths
and show the Live/Production outside-kit checkpoint. BOTH routes are approved; retention details
are proposed. Keep the shared form contract, semantic names, EN/ES inline and bottom errors,
quiet unavailable actions, draft protection and 44px targets. No top error summary.
The driver owns fresh-context builder review, XML/render/visual checks and later joint A679/A680
wizard/restart/concurrency/refusal validation in both themes, signed commits and docs-only locked
landing. No plan is written now; full-design/build approval remains outstanding.
