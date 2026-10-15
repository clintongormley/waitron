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
- **2026-10-15 at 05:10, option A approved:** for a NEW guided kit, print one writable paper
  original of the current master register and keep it with its named custodian. Record consumption
  on that original; label every other copy as a snapshot. Existing-custodian import still uses
  that custodian's current master. This settles the register format, not private-key retention.
- **2026-10-15 at about 05:50, option B approved:** for a NEW guided kit, keep BOTH a
  passphrase-protected signing-key file on the custodian's separate computer and a recoverable
  secret paper copy. Explicitly save and successfully reopen the file before proceeding. Keep
  both outside the box and venue backups; keep the secret paper separately from the public paper
  master. Check the restoration path and say plainly that whoever holds the paper can sign.
  This settles retention, not the full design or permission to build.

**2026-10-15 decision update:** per the owner's handoff, W41s6 has landed in PR #1717; A680 has
not landed. A680 owns kit-free Demo/Preparation and the separate readiness work described below.
Build A679 after both land, before W41s7, subject to remaining retention choices and full-design
approval. These are design requirements, not claims of implemented behavior. All first-publication
reproduction and source-read receipts below remain historical evidence from 2026-10-14; this update
does not rerun or replace them.

**2026-10-15 at 05:35 dependency update:** A680 also landed in
[PR #1718](https://github.com/clintongormley/waitron/pull/1718), commit
`3248759ca1aff4561c8a0bc3c353d696df7e2ff3`. Both landing dependencies are satisfied.
Private-key retention and full-design/build approval remain open; the readiness allocation gap
below still belongs to A679. This update records the landing, not a new wizard qualification.

**2026-10-15 current handoff:** the 05:50 answer above supersedes the earlier open-retention
notes. W41s6 #1717 and A680 #1718 have landed; W41sC3 also landed in
[PR #1725](https://github.com/clintongormley/waitron/pull/1725). C3's adapter landing does not
build wizard fetching. Keep the public-import route for existing custodians, including Cloud
subscribers, until wizard fetching is separately designed. There is no C3 landing wait in this
handoff and no new Cloud scope. The custody details below remain proposals for whole-design/build
approval; the historical source reads and reproduction below have not been rerun.

**2026-10-15 pointer (A680):** A680 gives Demo and Preparation a throwaway allocation with no
kit. It does not build the throwaway allocation for Live's separate preproduction readiness test
described below: the setup route's fiscal test accepts only a production Live request, which
never asks for one. That allocation is not built yet; see the A679 entry in `docs/backlog.md`.

## Evidence and source reads

Historical first-publication record, 2026-10-14. The dated landing updates above supersede its
dependency status; the reproduction and source reads below are preserved as recorded.

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
4. **Approved register and retention choices:** print one writable public paper original and keep
   it with the named custodian. Record consumption on that original; label every other copy as a
   snapshot. Include scope, generation/block IDs and the full public-key fingerprint. Reserve exact serials in the
   master before printing a block. Keep BOTH a passphrase-protected file and secret recovery paper
   for the same signing key on the outside custody path. **Proposed completion checks:** use the
   offline tool below, explicitly save and reopen the file, then restore from the actual printed
   paper in a separate tool session. Compare the complete fingerprint and sign/verify a harmless
   local challenge before proceeding. Keep secret paper separately from the public master and
   treat it as signing authority. These checks recover a key, never the current consumption register.
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

The approved B decision adds explicit secret-paper export to the encrypted-file output. It is an
exception to the earlier download-only boundary, never permission to send a secret to the box.
Under the proposed acceptance requirements below, private keys, passphrases and recovered material
stay in the separate offline tool's memory, apart from the explicit encrypted file and secret
paper outputs. No uploads, analytics, network calls, browser storage, request/error logs or venue
backups may carry them. Use cryptographic randomness and no remote assets. No box endpoint generates
a real custody key.
Bound public imports and reject secret-bearing files without echoing contents; audit references stay public.
A680's disposable preproduction key is the separate approved exception, never real Live custody.

## Custody and restoration acceptance requirements (PROPOSED, 2026-10-15)

These details complete the proposal for the owner's whole-design approval. They are not previously
approved facts or claims of tested encryption, printing or recovery behavior.

- **Offline tool:** download a self-contained tool before handling secrets, then use it offline on
  the custodian's separate computer. It must need no external resources, remote fonts or scripts,
  analytics or network service. Secret handling must make no network requests and use no browser
  persistence, automatic downloads, logs or crash reports containing secret material.
- **Encrypted file:** choose and confirm a passphrase, explicitly save the protected key file,
  then select that saved file and reopen it with the passphrase. Do not count a download click
  or the original in-memory key as success. Derive its public key and compare the full fingerprint
  with this kit before allowing the kit to proceed. The custodian keeps the file and access to its
  passphrase outside the box and venue backups, separately from the public master.
- **Secret paper:** explicitly print a versioned recovery document carrying the SAME private
  signing key, its algorithm/encoding identifiers, complete public fingerprint and custody scope.
  Use labelled, ordered transcription groups with completeness and corruption checks; support
  restoration from the printed text without depending on a QR reader or a network service.
  Label every page as secret, with the format version and page count. Do not put private-key
  examples in these drawings or the public master. This proposal treats the paper itself as
  sufficient to recover the key, without the encrypted file or its passphrase. Warn in EN/ES:
  “Whoever holds this paper can sign.” / “Quien tenga este papel puede firmar.”
- **Check the actual print:** start a separate offline tool session with no generated key or saved
  file loaded. Transcribe the ACTUAL printed representation, not a preview or cached export.
  Check its version, completeness, corruption checks and key structure, then derive the public key
  and compare its complete fingerprint with the public master. Require an exact match before
  signing anything. Sign and verify a fresh harmless local challenge with that restored key and
  expected public key; it must have no allocation, consumption or activation effect. Proceed only
  after the saved-file reopen and printed-paper restoration checks both succeed.
- **Refusals:** malformed, incomplete, unsupported-version or corrupt paper, a wrong key or a
  fingerprint mismatch must refuse before signing even the local challenge. Wrong-passphrase or
  unreadable files must fail the file check. Explain the refusal without echoing secret input;
  neither refusal may fall back to the original key, mint a replacement or mark a check complete.
- **Secret boundary:** file and paper recovery run only in the separate offline tool. Neither
  source nor recovered secrets may enter the box, venue backups, browser storage, logs or network.
  Only the explicit encrypted file and secret print are permitted secret outputs. Use a local
  printer outside the box; instructions must cover print queues, failed pages and disposal of
  spoiled secret prints. Do not promise that the tool erases printer or operating-system copies.
  Keep the protected file and secret paper apart from the public original; store the paper where
  access is limited to signing custody. Public receipts and snapshots contain no secret material.
- **Restoring custody:** the named custodian continues using the SAME single current paper master
  after recovering a key. Recovering the key grants neither current-consumption knowledge nor
  permission to create a second writable master. Consult the original before every assignment;
  neither a fingerprint match, signature, old backup nor snapshot establishes currency.
  The new-kit original-print action must not become a way to reprint a second writable master;
  later public copies are labelled snapshots.
- **Changing custodian:** explicitly hand over the same current master, its consumption/attempt
  records and the protected file, passphrase access and secret paper. Record the named successor
  and handover on that master; stop assignments during handover. The successor checks the file
  and actual paper as above and confirms current consumption before resuming. Account explicitly
  for retained secret copies with the outgoing custodian; do not imply their access disappears.
  There must be no invisible second writable master and no automatic key rotation.
- **Loss or uncertainty:** losing the current master or all usable signing copies stops new
  signing and assignments until explicit incident resolution outside the box. Uncertain master
  currency or disputed custody also stops new assignments. Preserve known consumption and attempt
  evidence; do not guess free names, roll back a register, automatically create a fresh master or
  claim guaranteed recovery. This proposal adds no legal policy or automatic rotation policy.

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

## Whole-design approval and driver handoff

**Next owner question:** “Do you approve the complete A679 Live setup design, including these
proposed custody, restoration and handover checks, and authorise its build?” The 05:50 retention
answer is not that approval. BOTH routes, local-network ownership, one paper-original current
master and file PLUS secret-paper retention are settled; do not ask those questions again.
Public blocks and uploaded snapshots confer no current authority. C3 landed in #1725; use public
import for subscribers until wizard fetching is separately designed, without expanding this scope.

The four [static EN/ES drawings](../../backlog/mockups/a679-first-fiscal-setup/) keep 1280/390 widths
and show the Live/Production outside-kit checkpoint. BOTH routes, the paper-original master and
file PLUS secret-paper retention are approved; restoration checks and layouts remain proposed.
Keep the shared form contract, semantic names, EN/ES inline and bottom errors,
quiet unavailable actions, draft protection and 44px targets. No top error summary.
The driver owns documentation validation, XML/render/visual checks and later joint A679/A680
wizard/restart/concurrency/refusal validation in both themes, signed commits and publishing.
Check all four drawings for EN/ES text fit at their 1280/390 widths. Later product acceptance must
exercise actual printed recovery, wrong paper, wrong passphrases, secret boundaries, custody
handover and loss/uncertainty stops; this documentation revision runs none of those checks.
No implementation plan is written now; full-design/build approval remains outstanding.
