# A fiscal chain that AEAT disagrees with (W41s) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** proposed with the spec; nothing is built until the owner approves both. The owner's
decisions D1–D9 (spec §11) are written in as the owner decided them on 2026-10-03; a probe or an
asesor answer that goes against one brings it back to the owner before the task that depends on it.

**Goal:** Waitron never ends up with a filing chain that has stopped, and when AEAT holds something
other than what we hold, Waitron starts a new chain by itself, keeps every sale going, keeps filing
everything it owes, and tells the manager in plain words what happened and what needs their tax
adviser.

**Architecture:** Task 0 settles five facts at AEAT first. Then the two fixes that stop chains
breaking for reasons of our own (strict order, Task 1) and make collisions visible (fingerprint on
every duplicate, Task 2). Then the minting and stamping fixes that stop new installations colliding
(Tasks 3–4). Then the enabler for a live new chain (the series read per sale, Task 5), the two
filing-rule changes (a refusal stops nothing, Task 6; a divergence starts a new chain, Task 7), holding
a divergent invoice's cancel back (Task 8), and the dashboard with the manual start (Task 9). Tasks
10–11 add the start-up check against AEAT on every box and the clock warning; Task 12 is the
compliance-notes pointers. Tasks 13–15 catch an older copy from the bucket (P5), fence an old box
from the bucket (P6, design first) and use the selling devices as witnesses (P8); Task 16 looks at
AEAT's month daily for reuse of our series (P9).

**Order and dependencies:** 0 → 1 → 2 → (3, 4 in either order) → 5 (after A238 lands) → 6 (needs 0,
1) → 7 (needs 0, 1, 2, 3, 5, and 6 unless the owner declines D2) → 8, 9, 10 (each needs 7) → 11, 12
any time; 13, 15 and 16 after 7; 14 after its design is approved.

**Tech stack:** TypeScript 7, drizzle-orm 0.45 + `node:sqlite`, Hono, Lit 3, Vitest 4 (real headless
Chromium for the front ends), `@waitron/verifactu` 0.2.1 and its fake AEAT.

**Spec:** `docs/superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md` — read it in full
first. Section numbers (§N), cause numbers (C1–C13), preventions (P1–P9) and decisions (D1–D9) are
the spec's.

## Global constraints

- **One pull request per task.** Every task leaves `main` green and working on its own.
- **The fiscal core stays untouched**: `computeHuella`, the chain link, invoice-number allocation,
  the alta builders and `registros_facturacion`. The golden huella block in
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` pass **unedited**
  in every task; run both in every fiscal task:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`.
- **Tasks 1, 2, 3, 6, 7, 9 and 10 change what is filed, the order it is filed in, or the invoice
  numbers.** Each runs the FULL review path (two Codex run-it seats + convention) and ends
  `needs-owner-review`: the owner lands it.
- **Step 0 of every task** re-maps the files it touches on the `main` it starts from; a line number
  here that moved is followed, a fact that no longer holds is recorded in the PR.
- **TDD.** Each case is written first and seen failing for the reason stated; each new guard is
  proven by deletion (remove the check, see the case fail, restore). State the experiment, not the
  conclusion (CLAUDE.md §1).
- **An existing assertion that pins behaviour the approved spec changes** (today's halt after a
  refusal or a divergence; an installation number of 1 or 2; a restored series named
  `<base>-<installation>`) is changed only in the task that changes the behaviour, and listed in that PR by file and
  case. Any other assertion change is a stop.
- **Error and alert codes:** every new code is registered in its package's `errors.ts`, imported by
  every file that throws it, has English and Spanish wording where a screen or alert shows it, and is
  run past `scripts/alert-codes.test.ts` and `scripts/errors-reachable.test.ts`. Retired codes move
  out of every copy in the tree in the same change.
- **Migrations:** let `drizzle-kit generate` number them; a new table is classified, or declared
  `appendOnly()`; changing the `envios_estado_ck` CHECK is a table rebuild on this engine (read
  CLAUDE.md §3 on rebuilds first and list the foreign keys pointing at `envios`). Run
  `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts` and `scripts/migration-upgrade.test.ts`. No data-migration
  code (pre-production); a dev venue holding a state a migration removes needs `wa-wt reset`, said in
  the PR.
- **Coverage** 98/98/98/95 in every touched package, never by an exclude or ignore comment.
- **Comments** only for an invariant or a non-obvious why.

## Task 0 — Five probes at AEAT's pre-production service (spec §13)

Repository: `waitron-io/verifactu` (the library), its `live-aeat.yml` workflow and
`scripts/live-aeat.mjs`. No Waitron code changes.

- [ ] Add a probe step that sends (a) a well-formed new-invoice record whose link names an invoice key
  AEAT does not hold, with a random 64-hex fingerprint, and (b) a control linked to the record just
  accepted. Before running, write down what each answer means: if AEAT checks links, (a) gets a
  refusal or an accepted-with-errors code that (b) does not; if not, both are `Correcto`.
- [ ] Add a probe step that resends an invoice key AEAT already holds with a different amount. Record
  the code and whether the reply carries anything beyond the stored copy's state.
- [ ] Run the workflow; read the log (`gh run view <id> --log`), not a summary.
- [ ] Add a probe step for spec §13's third question: a first record under an installation number
  that has already filed (control: expect 2007), and a first record under a NEW installation number
  with the SAME `IdSistemaInformatico`. Run 36350894099 changed both at once.
- [ ] Add probe steps for spec §13's fourth and fifth questions: an `R5` naming an invoice AEAT
  refused, beside a control `R5` naming an accepted one; and one record with the business name AEAT's
  register holds for the tax id beside one with a different name. Write down beforehand what each
  answer means (spec §13).
- [ ] Add the run ids and the answers to the spec as a dated pointer under §13. If (a) is refused or
  flagged, D2 and D5 (Tasks 6 and 7) are re-decided with the owner before either starts. If the new
  installation with the same software code gets 2007, Task 7 (its 2007 rule above all) is re-cut with
  the owner before it starts.

Review: light (library repo, test-only workflow change).

## Task 1 — Settle each chain strictly in order (P1, C1, C11)

Files: `packages/fiscal-verifactu/src/drain.ts` (`claimBatch` ~363-370, `backoffBatch` ~473-487,
`awaitReadableAnswer` ~644-672, the next-due bookkeeping `bumpNextDue`),
`packages/fiscal-verifactu/src/schema/envios.ts` (add `retenido` to the estado CHECK — a table
rebuild), `acks.ts` (`ackStateOf` ~30-43: give `retenido` an acknowledgement state so the
unsent-count projection, `applyAck` ~158-171, sees it), `packages/fiscal/src/backend.ts` (`AckState`
~136), `packages/fiscal-verifactu/src/schema/acks.ts` (~30, its CHECK), `drain.test.ts`.

- [ ] **Failing case 1** (`drain.test.ts`): record sale A/1; run two passes whose client throws
  `ETIMEDOUT`; void A/1; restore the client; run the pass at `nextDueAt`. Assert the anulación is
  never in a batch before A/1's alta is accepted; after the following passes both are `aceptado`, no
  incident. Today it prints `[["alta"],["alta"],["anulacion"]]` and refuses the anulación 3002
  (spec §4 C1).
- [ ] **Failing case 2**: as case 1 but the fake AEAT stores the batch before the client throws (a
  lost reply). Assert no `fiscal.duplicado_anulado` and both records `aceptado`.
- [ ] **Failing case 3** (C11): one pass where the fake AEAT stores `[alta, anulación]` of one sale
  and the reply is lost, then a resend. Assert both end `aceptado`, no incident. With this task's
  rule the two can never share a batch; the case records today's failure (`detenido`,
  `fiscal.duplicado_anulado`) as its red.
- [ ] **Failing case 4** (spec P1's planted key, first half): plant at the fake AEAT a different record
  under A/1's key; record A/1 and void it; run ONE pass. Assert the two were not in one batch. (The
  full protection needs Task 2: before it, the sale's resend is accepted on AEAT's `Correcta` and the
  cancellation then goes; Task 2 carries the drain-to-the-end version.)
- [ ] **Failing case 5**: after a two-pass outage, a sale made during it is not claimed while the
  earlier sale waits.
- [ ] **Failing case 6**: one unreadable line (`awaitReadableAnswer`) holds the rest of its chain; a
  different chain in the same batch is not held.
- [ ] **Failing case 7**: a credit note (`recordCorrection`) of A/1 is not claimed until A/1's alta is
  `aceptado`.
- [ ] **Failing case 8**: a cancellation whose sale is on another `sif_id` (build it with
  `registerSif`; after a restore `recordVoid` uses the current installation, `backend.ts:335`) and
  unsettled is not claimed.
- [ ] **Failing case 8b**: such a cross-chain cancellation whose sale is `rechazado` or `detenido`
  becomes `retenido`, is never sent, and does not hold the records after it on its own chain. (Today's
  halt sees only the claimed row's own chain, `drain.ts:439-445`, so without `retenido` it would wait
  for ever and, under strict order, hold its whole chain.)
- [ ] **Failing case 9**: after a successful send while a backed-off row waits, the pass reports that
  row's due time as `nextDueAt` (today `null`).
- [ ] Implement: `claimBatch` skips any row whose chain has an earlier unsettled row (`pendiente`, due
  or not, or `enviando`), and any cancellation, credit note or substitution whose named invoice's
  record is not yet `aceptado`/`aceptado_con_errores`; `backoffBatch` and `awaitReadableAnswer` back
  off from each chain's first unsettled row; the next-due time covers every waiting row; a record
  naming an invoice whose record is `rechazado` or `detenido` becomes `retenido`.
- [ ] Deletion proofs: removing the chain-order clause turns cases 1, 2, 5 red; removing the
  named-invoice clause turns 3, 4, 7, 8, 8b red.
- [ ] Gates: the drain suites, `drain.containment.test.ts`, golden huella, `inmutabilidad`.

Review: FULL (fiscal, concurrency). Ends `needs-owner-review`.

## Task 2 — Compare fingerprints on every duplicate answer (P2, C2a)

Files: `drain.ts` (`resolveLines` ~519-539, `applyOutcome` ~584-605, `routeB` ~763-778,
`handleDuplicate` ~803-836), `drain.test.ts`, the lookup client in `@waitron/verifactu` if a
month-and-installation query with paging is not already exposed (check first; a library change is
its own release, as A230a was).

- [ ] **Failing case**: plant at the fake AEAT a different record under A/1's key, stored `Correcta`;
  file our A/1. Assert our row is NOT `aceptado` and the incident is `fiscal.huella_divergente`
  (Task 7 replaces the outcome; this task uses today's halt). Today it is `aceptado` with no incident
  (spec §4 C2a, [ran]).
- [ ] Same for `AceptadaConErrores`.
- [ ] **Failing case**: an `Anulada` answer to our sale whose stored fingerprint equals OUR
  anulación's settles the sale as accepted; one whose stored fingerprint is not ours is a divergence.
- [ ] **Failing case** (spec P1's planted key, in full): plant a different record under A/1's key;
  record A/1 and void it; drain until nothing is left to send. Assert AEAT still holds the planted
  alta (not `Anulado`), A/1 is stopped with `fiscal.huella_divergente`, and the anulación is
  `retenido`. Today AEAT ends holding our anulación over the planted record.
- [ ] **Failing case**: a duplicate whose month-and-installation lookup returns no record for our key
  is a divergence (AEAT holds the key under another installation), not a retry.
- [ ] **Failing case**: a lookup that returns our key's record with no stored fingerprint backs the
  line off; it is never a divergence.
- [ ] **Failing case**: a batch of many duplicate lines in one month makes one lookup (paged), not one
  per line — count the fake's calls.
- [ ] `drain.test.ts:711` ("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to aceptado")
  passes unedited: our own resend's lookup matches.
- [ ] Deletion proof: restoring the accept-without-lookup path turns the first cases red.
- [ ] Gates as Task 1.

Review: FULL. Ends `needs-owner-review`.

## Task 3 — One minting function for every new chain (P3, C3, C5, C6; D9)

Files: `packages/fiscal-verifactu/src/restore.ts` (`installationFloor`, `raiseInstallationFloor`,
`restoreFiscal`), `registro-sif.ts` (`mintNumeroInstalacion`, `registerSif`), `reserved-series.ts`,
the fiscal seed `packages/fiscal-verifactu/src/provisioning.ts` (~86), `apps/server/scripts/register-till.ts`,
and the setup wizard's series pre-fill (`apps/setup/src/screens/venue-screen.ts` ~256-257) so it
shows the code the customer will see.

- [ ] **Failing case** (a new `new-chain.test.ts`): two venues provisioned for one tax id at different
  instants get different installation numbers, and the second is refused the first's prefix because
  AEAT (the fake) holds `FS/1`; the refusal suggests `FS-2`. Today both get installation 1 and `FS`
  (spec C3). The setup wizard words the refusal (restore instead, or take the suggested prefix);
  open it and look.
- [ ] **Failing case**: a new series (restore or new chain) takes the next free increment of its
  prefix, skipping a code this database holds (retired included), one a device reports, and one
  AEAT holds `<code>/1` for in any month from October 2024 (D9, owner 2026-10-03).
- [ ] **Failing case**: with AEAT unreachable the code is chosen on the database and the devices; once
  AEAT answers and holds that code, another new chain starts under the loop guard.
- [ ] **Failing case**: re-registering an older copy of a database never re-mints an installation
  number a newer copy used (spec C5's experiment as a test: two databases from one `vacuum into`).
- [ ] **Failing case**: a restore whose clock is behind a previous restore's still mints a fresh
  number — the floor is `max(clock, newest FechaHoraHusoGenRegistro, newest registro_sif.registrado_en)
  + 1`.
- [ ] Implement one exported function (name it for what it does, e.g. `startNewChain(tx, node, now)`)
  that floors, mints, registers, resets the head and returns the next free series codes; provisioning,
  `register-till` and `restoreFiscal` call it. `reserved-series.ts` drops the installation-number
  suffix for the increment; its suffix-stripping keeps reading the old `-<installation>` form.
- [ ] List every existing test that pins installation number 1 or 2, or a restored series named
  `<base>-<installation>`, as behaviour D9 changes (grep `numero_instalacion`, `numeroInstalacion`, `"FS/`, `"A/` across the
  suites first).
- [ ] Deletion proofs for the floor's three terms.
- [ ] Gates: `restore*.test.ts`, `registro-sif.test.ts`, `reserved-series.test.ts`,
  `apps/server/src/restore-fiscal-e2e.test.ts`, provisioning's suite, the setup wizard's suite (open
  the venue screen and look), golden huella, `inmutabilidad`.

Review: FULL (fiscal identity; the series code is filed and hashed). Ends `needs-owner-review`.

## Task 4 — An unstamped database with non-production records does not start as production (P4, C7)

Files: `apps/server/src/deployment-guard.ts`, `deployment-guard.test.ts`, its call in `boot.ts`
(~748-755), the recovery page's code table (CLAUDE.md §3, the unauthenticated recovery page). The
`waitron-provision venue` command already stamps (`packages/provisioning/src/cli.ts:315`);
`dev-setup` stays unstamped by design.

- [ ] **Failing case**: boot with `WAITRON_ENV=production` refuses an unstamped database holding any
  record whose `entorno` is not `production`, with a new code (name it beside its sibling
  `deployment.environment_mismatch`, `deployment-guard.ts:20`) that the recovery page gives a fixed
  title and action. The guard runs before `applyMigrations` (`deployment-guard.ts:10`), so a
  database whose `registros_facturacion` is missing or older counts as holding no such record; add
  a case for each.
- [ ] The existing case "passes an unstamped database, which every existing deployment is" keeps
  passing unedited for a database holding no such record.
- [ ] Deletion proof.

Review: FULL (boot). Lands autonomously.

## Task 5 — The series is read per sale; `WAITRON_TILL_SERIES_ID` goes (D3, spec §7.2)

Starts after A238 (till is a device) lands: it rewrites `apps/server/src/till-config.ts` too.

Files: `apps/server/src/till-config.ts` (~93), every reader and copy found by
`grep -rn 'seriesId\|SERIES_ID' apps packages deploy --exclude-dir=node_modules` — at least
`till-sale.ts`, `bill-payments.ts`, `working-order.ts`, `till-config.ts`'s required-key list,
`trading-config.ts`, `adopt.ts`, `promote.ts` and `boot.ts` (`persistTradingEnv`), the mirror bundle
and `mirror-bundle-fetch.ts`, the sealed state, `apps/server/src/restore.ts` (`rewriteTradingEnv`),
`apps/server/scripts/dev-setup.ts`, `apps/server/scripts/cloud-integration-fixture.ts`,
`.env.example`, `apps/till/README.md` — and `packages/db/src/reserved-identity.ts`
(`readStandardSeriesIdTx`).

- [ ] **Failing case** (`apps/server`): after the node's standard series is retired and a new one
  opened in one transaction (the `runRestoreHooks` sequence), the next till sale succeeds on the new
  series. Today it is refused `sale.series_retired` (spec §7.2, [ran]).
- [ ] Implement: each sale path reads `readStandardSeriesIdTx(tx, nodeId)` inside its own
  transaction; the variable and every copy of it go; `rewriteTradingEnv` stops writing it.
- [ ] A guard that no file under `apps/` or `deploy/` names `WAITRON_TILL_SERIES_ID` (extend an
  existing env guard such as `scripts/deploy-image-env.test.ts` rather than adding a file).
- [ ] Gates: the server's sale, bill-payment and working-order suites; `restore*.test.ts`;
  `boot.test.ts`; the mirror and adoption suites.

Review: FULL (cross-package contract). Lands autonomously.

## Task 6 — A refusal no longer stops the chain (D2, spec §6, §7.5)

Needs Task 0's first probe answered "AEAT accepts a record linked to one it refused" and Task 1.

Files: `drain.ts` (`haltSuccessors` ~718-731, `haltOpenChainClaims` ~433-466 including its query at
~441-445, the `rechazado` branch ~606-627, `claimBatch`), `packages/fiscal-verifactu/src/schema/envios.ts`
`submission-alerts.ts`, `apps/dashboard/src/i18n/alert-messages.ts`,
`drain.test.ts`, `submission-alerts.test.ts`.

- [ ] **Failing case**: a record refused with a non-3000 code stays `rechazado`; the next record on its
  chain is submitted and accepted. Today it is `detenido` (`drain.test.ts:553`'s shape).
- [ ] **Failing case**: a record made after the refusal is submitted (today halted at claim,
  `drain.test.ts:614`) — this needs `haltOpenChainClaims`' query narrowed to `detenido` only, not
  just the `haltSuccessors` call removed.
- [ ] **Failing case** (owner, 2026-10-03, D4): a credit note naming the refused invoice is now sent
  rather than `retenido`, and a cancellation naming it is sent, refused 3002 and stays `rechazado`;
  the records after each file. Task 1's held rule narrows to `divergente` here (spec §6).
- [ ] The tests pinning today's halt after a refusal (`:553`, `:614`, and any other found) are listed
  in the PR as behaviour D2 changes.
- [ ] `fiscal.registro_rechazado`'s wording (spec §8) names the invoice and says later records still
  go.
- [ ] Gates: drain suites, golden huella, `inmutabilidad`, the migration guards, `scripts/alert-codes.test.ts`.

Review: FULL. Ends `needs-owner-review`.

## Task 7 — A divergence starts a new chain (D1, D5, spec §6, §7.1, §7.3, §7.6 cause wording, §7.7)

Needs Tasks 0, 1, 2, 3, 5 and 6.

Files: `drain.ts`, `acks.ts` (`ackStateOf`: map `divergente`; the `detenido` case ~38-39),
`packages/fiscal/src/backend.ts` (`AckState`), `packages/fiscal-verifactu/src/schema/acks.ts` (its
CHECK), `packages/fiscal-verifactu/src/schema/envios.ts` (add `divergente`; remove `detenido` unless
the owner declined D2), a new `chain_restarts` table in the fiscal-verifactu migration
set declared `appendOnly()`, `classification.ts`, `errors.ts` (`fiscal.chain_restarted`,
`fiscal.chain_restart_limit`; retire `fiscal.huella_divergente` and `fiscal.duplicado_anulado` as
incidents, their cause moving to a param), `submission-alerts.ts`, `apps/dashboard/src/i18n/alert-messages.ts`,
`drain.test.ts`, a new `chain-restart.test.ts`.

- [ ] **Failing case** (the spec's live experiment as a test): sell A/1, A/2; plant a different record
  under A/1's key; drain. Assert: A/1 `divergente` and AEAT's receipt code saved; then a new
  `registro_sif` with an installation number at or above the floor; the node's old series retired and
  new `<prefix>-<n>` ones open (P3); a `chain_restarts` row naming A/1's key, both installation
  numbers, the cause and AEAT's stored fingerprint; one `fiscal.chain_restarted` incident; A/2 filed
  (accepted). The next sale is `<prefix>-<n>/1` with `PrimerRegistro = S` and is accepted.
- [ ] **Failing case**: the new-chain step throwing (stub the series insert to throw
  `series.code_collision`) leaves the saved reply and A/1's `divergente` committed, raises an alert,
  and the next pass starts the chain.
- [ ] **Failing case**: a 2007 on our chain's first record leaves that record `aceptado_con_errores`,
  starts a new chain with the shared-installation cause, and lists nothing for the adviser.
- [ ] **Failing case**: a divergence on a RETIRED installation (an old-chain record filed after the
  switch) is marked `divergente` and starts nothing.
- [ ] **Failing case**: a sale whose transaction is queued behind the new-chain transaction succeeds on
  the new series.
- [ ] **Failing case (loop guard)**: a divergence on the current installation within 24 hours of the
  last automatic start marks its record `divergente`, starts no chain, raises
  `fiscal.chain_restart_limit` once; a new divergence 24 hours and one second after does start one;
  the suppressed one never starts a chain by itself, even after the 24 hours.
- [ ] **Failing case**: a cancellation or credit note naming a `divergente` invoice, recorded before
  the divergence was found, becomes `retenido` and is never sent.
- [ ] **Failing case**: a cancellation of an old-chain invoice made after the switch is recorded on the
  new chain and waits until the old alta is accepted, then files.
- [ ] Remove `haltSuccessors`, `haltOpenChainClaims`, the `detenido` value, its `halted` ack state
  and `fiscal.submission_stopped` (nothing writes `detenido` after Tasks 6–7, spec §6). If the owner
  declined D2, a refusal still halts: keep all four, and give `fiscal.submission_stopped` the link to
  Fiscal filing instead. Tests pinning a divergence halt are listed in the PR as behaviour D1 changes.
- [ ] Deletion proofs: dropping the new-chain call leaves the next sale on the old series (case 1
  red); dropping the loop guard starts a second chain inside 24 hours; dropping the current-installation
  test starts a chain for a retired one.
- [ ] Gates: every fiscal-verifactu suite, golden huella, `inmutabilidad`, the migration guards, the
  alert and error guards, `apps/server`'s restore and boot suites.

Review: FULL. Ends `needs-owner-review`.

## Task 8 — A cancel of a divergent invoice goes through, and its record is held (D4, spec §7.4)

Needs Task 7.

Files: the void, credit-note and substitution paths (find each caller of the backend's void,
`recordCorrection` and `recordSubstitution` writers in `apps/server/src`; today `cancel-credit.ts`),
`drain.ts`.

- [ ] **Failing case**: cancelling an issued order whose invoice's record is `divergente` cancels the
  order and settles the bill as usual; the credit note is appended; at the next pass it becomes
  `retenido`, is never in a batch, and the records after it on its chain file.
- [ ] **Failing case**: the same for each other path that names an invoice, as it exists when this
  task starts.
- [ ] Deletion proof: removing the `divergente` clause from Task 1's held rule sends the credit note.

Review: FULL (fiscal-adjacent). Lands autonomously: it holds records back and sends nothing new.

## Task 9 — Fiscal filing in the dashboard, and the manual start (spec §7.7, §8, D6)

Needs Task 7.

Where it goes is decided (owner, 2026-10-03, D6): a screen of its own, *Fiscal filing* (*Envío
fiscal*), in the dashboard's Reporting group straight after the VAT return
(`apps/dashboard/src/dashboard-app.ts`, `NAV_GROUPS`), under the VAT return's permission,
`report.export`. No new permission.

- [ ] A read-only management route (permission `report.export`) for the current chain (installation
  number, series, last accepted record, how many records wait to be sent), `chain_restarts` newest
  first, and the Needs your adviser list (`divergente`, `rechazado` and `retenido` records: invoice
  number, date, amount, AEAT's stored fingerprint and state where known; a held record shown beside
  the invoice it names). Route cases for each, including a refusal without `report.export`.
- [ ] The manual start: a route that starts a new chain through the same function as Task 7, allowed
  to an administrator only after re-authentication as `node.promote` does (password, and the
  authenticator code where enrolled; `apps/server/src/promote-api.ts`), refused while the loop guard
  has not fired. Cases: refused for a manager; refused without re-authentication; allowed and audited
  in `chain_restarts` with the cause "started by hand".
- [ ] Screen cases in real Chromium; axe; both themes; phone width; the `fiscal.chain_restart_limit`
  alert row offers the manual start; the other fiscal alerts link to the section.
- [ ] `scripts/live-subscriptions.test.ts` if the section subscribes to changes.

Review: FULL (auth, permissions). Ends `needs-owner-review`: the manual start starts a chain.

## Task 10 — Every box checks AEAT on its first pass (spec §7.6, D7)

Needs Task 7.

Files: `drain.ts` or a new first-pass step beside `resetBeforeFirstDrain`
(`apps/server/src/restart-reset.ts`), the lookup client.

- [ ] **Failing case**: a database copy behind AEAT (AEAT holds the next number this node would issue
  in a live series) starts a new chain, cause "database behind AEAT", before the drain's first claim.
- [ ] **Failing case**: the copy is behind across a month boundary (its newest record in March, AEAT's
  next number issued in April); the check asks for every month from March to the current one and
  finds it.
- [ ] **Failing case**: a copy level with AEAT starts nothing; a failed lookup starts nothing and
  retries next pass.
- [ ] **Failing case**: a box WITH a bucket runs the same check (D7).
- [ ] **Failing case**: a sale made on the old series before the check succeeded, whose number AEAT
  holds under another issue date, is listed for the adviser once the check finds the box behind.
- [ ] **Failing case**: an unreachable AEAT at start starts no chain.
- [ ] Deletion proof.

Review: FULL. Ends `needs-owner-review` (it can start a chain).

## Task 11 — Warn about the clock and the registered name (P7, C9, D8)

- [ ] **Failing case**: with the box's clock more than one minute (D8) away from AEAT's response
  timestamps, an alert is raised and the till shows a banner; **the sale goes through**. An
  unreachable AEAT raises nothing and blocks nothing.
- [ ] **Failing case**: the readiness test reports a legal-name or tax-id mismatch from AEAT's answer
  as its own outcome.
- [ ] **Failing case**: a refused readiness test carries AEAT's code and message to the setup wizard's
  fiscal test screen (`apps/setup/src/screens/fiscal-test-screen.ts`), which shows them, in plain words
  where the code is known (owner, 2026-10-03). Opened and looked at in both themes and at phone width.
- [ ] Every new code worded in English and Spanish; the banner opened and looked at.

Review: FULL (fiscal-adjacent). Lands autonomously: nothing filed changes and no sale is refused.

## Task 12 — Compliance notes (docs only, spec §14)

- [ ] Add dated pointers to `docs/compliance/verifactu-findings.md` §1 for the Orden art. 3 point and
  the 2007 point (cite run 36350894099), and note the FAQ pages' new date. Docs flow: branch,
  `commit -s`, fast-forward `main`, push.

## Task 13 — The bucket knows how far each node's chain got (P5, D7)

Needs Task 7.

Files: `packages/stream/src` (a signed chain-position record beside `pointer.ts`, its key and
reader), the supervisor or the pass loop that rewrites it while the bucket is reachable, boot's
check before trading.

- [ ] **Failing case**: a database behind the bucket's chain-position record for its own node starts a
  new chain before its first sale, cause "this database is behind the bucket", and raises the alert.
- [ ] **Failing case**: an older copy at the same term does not take over the pointer.
- [ ] **Failing case**: a record that fails its signature check is ignored and alerted, never obeyed.
- [ ] Deletion proof for each.

Review: FULL (concurrency, fiscal). Ends `needs-owner-review`: it can start a chain.

## Task 14 — A newer pointer in the bucket fences the box (P6, D7)

Step 0, before any code: a short design for the owner on whose signature fences a box. Today only a
restore checks a pointer's signature (`apps/server/src/restore-stream.ts`, against the recovery kit's
key); find which key a restored box signs new pointers with, and whether the old box can verify it.
Also the recovery page's wording and the way out (retire or rejoin, which exist). Stop for approval.

- [ ] **Failing case**: a box whose bucket pointer names a higher term, signed by a trusted key, boots
  fenced: no sales, no filing, the recovery page with an alert.
- [ ] **Failing case**: the same met by the running stream restarts the box fenced
  (`shouldFenceRestart`, `apps/server/src/membership-fence.ts`).
- [ ] **Failing case**: a higher-term pointer that fails the signature check fences nothing and raises
  an alert.
- [ ] Deletion proof for each.

Review: FULL (auth, concurrency). Ends `needs-owner-review`: it stops a box selling.

## Task 15 — The selling devices remember the highest number they have seen (P8, D7)

Needs Task 7.

Files: `apps/till/src` (the remembered numbers in `localStorage`, per series code, read and written
inside `try`), the till's connection to the box, the server's check before the next sale.

- [ ] **Failing case**: a box whose live series counter is behind a device's remembered number for
  that series code starts a new chain before its next sale, cause "this database is behind a
  device".
- [ ] **Failing case**: a device with nothing remembered, unreadable storage, or a number for a series
  the box no longer has live, changes nothing and refuses nothing.
- [ ] **Failing case**: with no internet at all, the check still runs.
- [ ] Deletion proof; the till opened and looked at.

Review: FULL (fiscal). Ends `needs-owner-review`: it can start a chain.

## Task 16 — A daily look at AEAT's month for our series (P9, D9)

Needs Task 7.

Files: `packages/fiscal-verifactu/src/reconcile.ts` (`reconcile()`, today without a production
caller), its export, the pass loop's daily slot, the lookup client (paged).

- [ ] **Failing case**: a record in one of the box's live series that another installation filed this
  month (planted in the fake AEAT, on a date the box did not use) is listed for the adviser and
  starts a new chain, cause "another system is using this series".
- [ ] **Failing case**: the box's own records raise nothing; a failed read starts nothing and retries
  the next day; it runs at most once a day.
- [ ] Deletion proof.

Review: FULL (fiscal). Ends `needs-owner-review`: it can start a chain.

## Asesor questions

The asesor questions (spec §10; `docs/compliance/asesor-questions.md` Q33–Q40) carry Waitron's defaults. Tasks 6–8 build to those defaults; an answer that
differs re-cuts the affected task before it lands.
