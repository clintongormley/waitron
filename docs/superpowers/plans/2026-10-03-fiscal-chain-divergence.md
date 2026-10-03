# A fiscal chain that AEAT disagrees with (W41s) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** proposed with the spec; nothing is built until the owner approves both. The owner's
decisions D1–D7 (spec §11) are written in as their recommended defaults; a task whose decision the
owner changes is re-cut before it starts.

**Goal:** Waitron never ends up with a filing chain that has stopped, and when AEAT holds something
other than what we hold, Waitron starts a new chain by itself, keeps every sale going, keeps filing
everything it owes, and tells the manager in plain words what happened and what needs their tax
adviser.

**Architecture:** First the two fixes that stop chains breaking for reasons of our own (strict order,
Task 1) and make collisions visible (fingerprint on every duplicate, Task 2). Then the minting and
stamping fixes that stop new installations colliding (Tasks 3–4). Then the enablers for a live new
chain (the series read per sale, Task 5), the two filing-rule changes (a refusal stops nothing,
Task 6; a divergence starts a new chain, Task 7), the till's refusal for a divergent invoice
(Task 8), and the dashboard (Task 9). Task 0 settles two facts at AEAT first; Tasks 10–11 add the
checks that need no bucket and the clock check; Task 12 is the compliance-notes pointers. P5 and P6
(the bucket-pointer checks) wait for the topology work and are listed, not planned, in Task 13.

**Tech stack:** TypeScript 7, drizzle-orm 0.45 + `node:sqlite`, Hono, Lit 3, Vitest 4 (real headless
Chromium for the front ends), `@waitron/verifactu` 0.2.1 and its fake AEAT.

**Spec:** `docs/superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md` — read it in full
first. Section numbers (§N) and cause numbers (C1–C13) are the spec's.

## Global constraints

- **One pull request per task.** Every task leaves `main` green and working on its own.
- **The fiscal core stays untouched**: `computeHuella`, the chain link, invoice-number allocation,
  the alta builders and `registros_facturacion`. The golden huella block in
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` pass **unedited**
  in every task; run both in every fiscal task:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`.
- **Tasks 1, 2, 6 and 7 change what is filed or the order it is filed in.** Each runs the FULL review
  path (two Codex run-it seats + convention) and ends `needs-owner-review`: the owner lands it.
- **Step 0 of every task** re-maps the files it touches on the `main` it starts from; a line number
  here that moved is followed, a fact that no longer holds is recorded in the PR.
- **TDD.** Each case is written first and seen failing for the reason stated; each new guard is
  proven by deletion (remove the check, see the case fail, restore). State the experiment, not the
  conclusion (CLAUDE.md §1).
- **Error and alert codes:** every new code is registered in its package's `errors.ts`, imported by
  every file that throws it, has English and Spanish wording where a screen or alert shows it, and is
  run past `scripts/alert-codes.test.ts` and `scripts/errors-reachable.test.ts`. Retired codes move
  out of every copy in the tree in the same change.
- **Migrations:** let `drizzle-kit generate` number them; a new table is classified, or declared
  `appendOnly()`; run `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts` and `scripts/migration-upgrade.test.ts`. No data-migration
  code (pre-production).
- **Coverage** 98/98/98/95 in every touched package, never by an exclude or ignore comment.
- **Comments** only for an invariant or a non-obvious why.

## Task 0 — Two probes at AEAT's pre-production service (spec §13)

Repository: `waitron-io/verifactu` (the library), its `live-aeat.yml` workflow and
`scripts/live-aeat.mjs`. No Waitron code changes.

- [ ] Add a probe step that sends (a) a well-formed new-invoice record whose link names an invoice key
  AEAT does not hold, with a random 64-hex fingerprint, and (b) a control linked to the record just
  accepted. Before running, write down what each answer means: if AEAT checks links, (a) gets a
  refusal or an accepted-with-errors code that (b) does not; if not, both are `Correcto`.
- [ ] Add a probe step that resends an invoice key AEAT already holds with a different amount. Record
  the code and whether the reply carries anything beyond the stored copy's state.
- [ ] Run the workflow; read the log (`gh run view <id> --log`), not a summary.
- [ ] Add the run ids and the answers to the spec as a dated pointer under §13. If (a) is refused or
  flagged, Task 7's "old records keep filing unchanged" (§7.3) is re-decided with the owner before
  Task 7 starts.

Review: light (library repo, test-only workflow change).

## Task 1 — Settle each chain strictly in order (P1, C1)

Files: `packages/fiscal-verifactu/src/drain.ts` (`claimBatch` ~363-370, `backoffBatch` ~473-487,
`awaitReadableAnswer` ~644-672), `packages/fiscal-verifactu/src/drain.test.ts`.

- [ ] **Failing case 1** (`drain.test.ts`): record sale A/1; run two passes whose client throws
  `ETIMEDOUT`; void A/1; restore the client; run the pass at `nextDueAt`. Assert the batch sent holds
  the alta before the anulación, or the alta alone, and never the anulación alone; after the next
  pass both are `aceptado`, no incident. Today it sends the anulación alone (3002, spec §4 C1).
- [ ] **Failing case 2**: as case 1 but the fake AEAT stores the batch before the client throws (a
  lost reply). Assert no `fiscal.duplicado_anulado` and both records `aceptado`.
- [ ] **Failing case 3**: after a two-pass outage, a sale made during it is not claimed while the
  earlier sale is waiting and not yet due.
- [ ] **Failing case 4**: one unreadable line (`awaitReadableAnswer`) holds the rest of its chain;
  a different chain in the same batch is not held.
- [ ] Implement: `claimBatch` skips any row whose chain has an earlier unsettled row (`pendiente` not
  yet due, or `enviando`), written as one `not exists` against `envios`/`registros_facturacion` on
  `sif_id` and `secuencia`; `backoffBatch` and `awaitReadableAnswer` back off from the first
  unsettled row of each chain. Settled means `aceptado`, `aceptado_con_errores`, `rechazado`,
  `detenido` (and `divergente` once Task 7 adds it).
- [ ] **Cross-chain wait** (case 5): a cancellation whose own invoice's alta is on another `sif_id`
  and unsettled is not claimed. Build the second chain with `registerSif` in the test.
- [ ] Deletion proofs: removing the `not exists` turns cases 1–3 red; removing the cross-chain clause
  turns case 5 red.
- [ ] Gates: the drain suites, `drain.containment.test.ts`, golden huella, `inmutabilidad`.

Review: FULL (fiscal, concurrency). Ends `needs-owner-review`.

## Task 2 — Compare fingerprints on every duplicate answer (P2, C2a)

Files: `drain.ts` (`resolveLines` ~519-539, `applyOutcome` ~584-605, `handleDuplicate` ~803-836),
`drain.test.ts`.

- [ ] **Failing case**: plant at the fake AEAT a different record under A/1's key, stored `Correcta`;
  file our A/1. Assert our row is NOT `aceptado` and the incident is `fiscal.huella_divergente`
  (Task 7 replaces the outcome; this task uses today's halt). Today it is `aceptado` with no incident
  (spec §4 C2, [ran]).
- [ ] Same for `AceptadaConErrores`.
- [ ] Keep `drain.test.ts:711` ("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to
  aceptado") passing unedited: our own resend's lookup matches.
- [ ] Implement: `resolveLines` takes the lookup for every 3000 line; `applyOutcome`'s duplicate-accept
  paths route through the fingerprint comparison. A failed lookup backs the batch off as today (W21).
- [ ] Deletion proof: restoring the accept-without-lookup path turns the new cases red.
- [ ] Gates as Task 1.

Review: FULL. Ends `needs-owner-review`.

## Task 3 — One minting function for every new chain (P3, C3, C5, C6)

Files: `packages/fiscal-verifactu/src/restore.ts` (`installationFloor`, `raiseInstallationFloor`,
`restoreFiscal`), `registro-sif.ts` (`mintNumeroInstalacion`, `registerSif`), `reserved-series.ts`,
the fiscal seed in `packages/provisioning` (find it: `grep -rn registerSif packages apps --include=*.ts`),
`apps/server/scripts/register-till.ts`, and the setup wizard's series pre-fill
(`apps/setup/src/screens/venue-screen.ts` ~256-257) if the suffix changes what it shows.

- [ ] **Failing case** (`restore.test.ts` or a new `new-chain.test.ts`): two venues provisioned for one
  tax id at different instants get different installation numbers and disjoint series codes. Today
  both get installation 1 and `FS` (spec C3).
- [ ] **Failing case**: re-registering an older copy of a database never re-mints an installation
  number a newer copy used (spec C5's experiment as a test: two databases from one `vacuum into`).
- [ ] **Failing case**: a restore whose clock is behind a previous restore's still mints a fresh
  number — the floor is `max(clock, newest FechaHoraHusoGenRegistro, newest registro_sif.registrado_en)
  + 1`.
- [ ] Implement one exported function (name it for what it does, e.g. `startNewChain(tx, node, now)`)
  that floors, mints, registers, resets the head and returns the disjoint series codes; provisioning,
  `register-till` and `restoreFiscal` call it.
- [ ] Deletion proofs for the floor's three terms.
- [ ] Gates: `restore*.test.ts`, `registro-sif.test.ts`, `reserved-series.test.ts`,
  `apps/server/src/restore-fiscal-e2e.test.ts`, provisioning's suite, golden huella, `inmutabilidad`.

Review: FULL (fiscal identity). Lands autonomously if nothing filed changes beyond the identity
numbers; otherwise `needs-owner-review`.

## Task 4 — Stamp every database (P4, C7)

Files: `packages/provisioning/src/venue-apply.ts`, the dev-setup path (`grep -rn dev-setup apps
scripts`), `apps/server/src/deployment-guard.ts`, `deployment-guard.test.ts`, the recovery page's
code table (CLAUDE.md §3, the unauthenticated recovery page).

- [ ] **Failing case**: a database created by `venue-apply` carries the environment stamp. Same for
  dev-setup.
- [ ] **Failing case**: boot with `WAITRON_ENV=production` refuses an unstamped database holding any
  record whose `entorno` is not `production`, with a new code (name it by grepping the
  `provisioning.*` siblings) that the recovery page gives a fixed title and action. The existing case
  "passes an unstamped database, which every existing deployment is" keeps passing for a database
  holding no such record.
- [ ] Deletion proofs.

Review: FULL (provisioning, boot). Lands autonomously.

## Task 5 — The series is read per sale; `WAITRON_TILL_SERIES_ID` goes (D3, spec §7.2)

Starts after A238 (till is a device) lands: it rewrites `apps/server/src/till-config.ts` too.

Files: `apps/server/src/till-config.ts` (~93), every reader of `config.till.seriesId`
(`grep -rn 'seriesId' apps/server/src --include=*.ts`: `till-sale.ts`, `bill-payments.ts`,
`working-order.ts`, `boot.ts` mirror bundle, the sealed state), `apps/server/src/restore.ts`
(`rewriteTradingEnv`), `packages/db/src/reserved-identity.ts` (`readStandardSeriesIdTx`), deploy and
dev env files naming the variable.

- [ ] **Failing case** (`apps/server`): after the node's standard series is retired and a new one
  opened in one transaction (the `runRestoreHooks` sequence), the next till sale succeeds on the new
  series. Today it is refused `sale.series_retired` (spec §7.2, [ran]).
- [ ] Implement: each sale path reads `readStandardSeriesIdTx(tx, nodeId)` inside its own
  transaction; the variable and every copy of it go; `rewriteTradingEnv` stops writing it.
- [ ] A guard that no file under `apps/` or `deploy/` names `WAITRON_TILL_SERIES_ID` (extend an
  existing env guard such as `scripts/deploy-image-env.test.ts` rather than adding a file).
- [ ] Gates: the server's sale, bill-payment and working-order suites; `restore*.test.ts`;
  `boot.test.ts`.

Review: FULL (cross-package contract). Lands autonomously.

## Task 6 — A refusal no longer stops the chain (D2, spec §6, §7.5)

Files: `drain.ts` (`haltSuccessors` ~718-731, `haltOpenChainClaims` ~433-466, the `rechazado` branch
~606-627), `submission-alerts.ts`, `packages/fiscal-verifactu/src/schema/envios.ts` (the estado CHECK),
`apps/dashboard/src/i18n/alert-messages.ts`, `drain.test.ts`, `submission-alerts.test.ts`.

- [ ] **Failing case**: a record refused with a non-3000 code stays `rechazado`; the next record on its
  chain is submitted and accepted. Today it is `detenido` (`drain.test.ts:553`'s shape).
- [ ] **Failing case**: a record made after the refusal is submitted (today halted at claim,
  `drain.test.ts:614`).
- [ ] The tests that pin today's halt (`:553`, `:614`, and any other that asserts `detenido` after a
  refusal) are the behaviour D2 changes: list each in the PR as an assertion the approved spec
  changes. Every other assertion is unchanged.
- [ ] Remove `haltSuccessors`' refusal call; with Task 7 not yet landed, the duplicate branches still
  halt as today.
- [ ] `fiscal.registro_rechazado`'s wording (spec §8) names the invoice and says later records still
  go.
- [ ] Gates: drain suites, golden huella, `inmutabilidad`, `scripts/alert-codes.test.ts`.

Review: FULL. Ends `needs-owner-review`.

## Task 7 — A divergence starts a new chain (D1, D5, spec §6, §7.1, §7.3, §7.7)

Depends on Tasks 1, 2, 3, 5, 6 (and Task 0's answer).

Files: `drain.ts`, `packages/fiscal-verifactu/src/schema/envios.ts` (add `divergente`), a new
`chain_restarts` table in the fiscal-verifactu migration set declared `appendOnly()`, `classification.ts`,
`errors.ts` (`fiscal.chain_restarted`, `fiscal.chain_restart_limit`; retire `fiscal.huella_divergente`
and `fiscal.duplicado_anulado` as incidents, their cause moving to a param), `submission-alerts.ts`,
`apps/dashboard/src/i18n/alert-messages.ts`, `drain.test.ts`, a new `chain-restart.test.ts`.

- [ ] **Failing case** (the spec's live experiment as a test): sell A/1, A/2; plant a different record
  under A/1's key; drain. Assert in ONE transaction's outcome: A/1 `divergente`; a new `registro_sif`
  with an installation number at or above the floor; the node's old series retired and new
  `<base>-<installation>` ones open; a `chain_restarts` row naming A/1's key, both installation
  numbers and AEAT's stored fingerprint; one `fiscal.chain_restarted` incident; A/2 filed (accepted).
  The next sale is `<base>-<installation>/1` with `PrimerRegistro = S` and is accepted.
- [ ] **Failing case**: Route A (an alta AEAT holds `Anulada`) and a 2007 on our chain's first record
  take the same path, with the cause in the incident's params.
- [ ] **Failing case**: a sale whose transaction is queued behind the drain's save transaction
  succeeds on the new series (the write queue serialises; Task 5 reads the series inside it).
- [ ] **Failing case (loop guard)**: a second divergence within 24 hours of the first marks its record
  `divergente`, starts no chain, raises `fiscal.chain_restart_limit` once; a divergence 24 hours and
  one second after does start one.
- [ ] **Failing case**: a cancellation of an old-chain invoice made after the switch is recorded on the
  new chain and waits until the old alta is settled (Task 1's cross-chain rule), then files.
- [ ] Remove `haltSuccessors`, `haltOpenChainClaims`, the `detenido` value and
  `fiscal.submission_stopped` (nothing writes `detenido` after Tasks 6–7, spec §6). If the owner declined D2,
  a refusal still halts: keep all four, and give `fiscal.submission_stopped` the link to Fiscal
  filing instead. Tests pinning a
  divergence halt are behaviour the spec changes; list each in the PR.
- [ ] Deletion proofs: dropping the new-chain call leaves A/1 `divergente` and the next sale on the
  old series (case 1 red); dropping the loop guard starts a third chain.
- [ ] Gates: every fiscal-verifactu suite, golden huella, `inmutabilidad`, the migration guards, the
  alert and error guards, `apps/server`'s restore and boot suites.

Review: FULL. Ends `needs-owner-review`.

## Task 8 — The till refuses to void or correct a divergent invoice (D4, spec §7.4)

Files: the void and correction paths (`apps/server/src/till-sale.ts`, `cancel-credit.ts`; find each
caller of the backend's void and correction writers), `packages/fiscal-verifactu/src/errors.ts`
(`fiscal.invoice_needs_adviser`), the till's error wording.

- [ ] **Failing case**: voiding an invoice whose record is `divergente` is refused
  `fiscal.invoice_needs_adviser`; no record is appended. Same for a correction.
- [ ] The till shows the refusal in English and Spanish; open it and look (CLAUDE.md §4).
- [ ] Deletion proof.

Review: FULL (fiscal-adjacent). Lands autonomously: it refuses an action and files nothing.

## Task 9 — Fiscal filing in the dashboard (spec §8, D6)

Files: decide in step 0 whether an existing screen takes a Fiscal filing section or a new screen is
needed; show the owner the choice in `questions.md` before building. A read-only management route for
the current chain, `chain_restarts` and `divergente` records (permission `fiscal.view`); the alert
wording of spec §8.

- [ ] Route cases: the current chain's installation number, series and last accepted record;
  restarts newest first; the Needs your adviser list with invoice number, date, amount, and AEAT's
  stored fingerprint and state.
- [ ] Screen cases in real Chromium; axe; both themes; phone width; the alert row links to the section.
- [ ] `scripts/live-subscriptions.test.ts` if the section subscribes to changes.

Review: light unless the route reads by id (then FULL). Lands autonomously.

## Task 10 — A box with no bucket checks AEAT on its first pass (spec §7.6)

Files: `drain.ts` or a new first-pass step beside `resetBeforeFirstDrain`
(`apps/server/src/restart-reset.ts`), the lookup client.

- [ ] **Failing case**: a database copy behind AEAT (AEAT holds the next number this node would
  issue in a live series) starts a new chain before the drain's first claim, with
  `fiscal.chain_restarted` naming the cause.
- [ ] **Failing case**: a copy level with AEAT starts nothing; a failed lookup starts nothing and
  retries next pass.
- [ ] Deletion proof.

Review: FULL. Ends `needs-owner-review` (it can start a chain).

## Task 11 — The clock and the census before the first sale (P7, C9)

- [ ] **Failing case**: with the server's clock more than the tolerance ahead of the outside source, a
  sale is refused with a code the till words; within it, the sale goes through. Choose the outside
  source in step 0 (AEAT's response timestamp is one candidate); record the choice in the PR.
- [ ] **Failing case**: the readiness test reports a legal-name or tax-id mismatch from AEAT's answer
  as its own outcome.

Review: FULL (fiscal-adjacent, a sale can be refused — check the owner's rule that nothing EXTERNAL
blocks a sale; a refused sale on a wrong local clock is a local fault, but say so in `questions.md`
before building). Ends `needs-owner-review`.

## Task 12 — Compliance notes (docs only, spec §14)

- [ ] Add dated pointers to `docs/compliance/verifactu-findings.md` §1 for the Orden art. 3 point and
  the 2007 point, and note the FAQ pages' new date. Docs flow: branch, `commit -s`, fast-forward
  `main`, push.

## Task 13 — Listed, not planned: P5 and P6 (D7)

The chain height in the signed bucket pointer, the supervisor refusing an older copy, and a
higher-term pointer fencing the box, wait for the topology work (slice 3). Add a backlog entry
pointing at spec §5 P5/P6 when this plan is approved.

## Asesor questions

Spec §10 lists Q1–Q9 with Waitron's defaults. Tasks 7 and 8 build to those defaults; an answer that
differs re-cuts the affected task before it lands.
