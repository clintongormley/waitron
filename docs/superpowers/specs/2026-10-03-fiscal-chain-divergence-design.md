# A fiscal chain that AEAT disagrees with — design (W41s)

Status: **proposed, awaiting the owner's approval.** Nothing here is built. Research done
2026-10-03 against `main` at `ea57412dc` (W21, #1130, included). Plan:
`docs/superpowers/plans/2026-10-03-fiscal-chain-divergence.md`. Backlog: W41s.

## 1. The problem

Waitron files one record with AEAT (the Spanish tax agency) for every invoice, cancellation and
correction. Each record carries the fingerprint of the record before it, so a filing node's records
form a **chain**. If AEAT comes to hold something under one of our invoice numbers that is not what
our database holds, or AEAT refuses one of our records, `packages/fiscal-verifactu/src/drain.ts`
stops filing that chain: the record goes to `rechazado` (rejected) or `detenido` (stopped), every
later record on the chain is stopped with it, and **nothing ever moves a record out of either
state** (a grep for both values over `apps` and `packages` finds writers only in `drain.ts`). Sales
carry on — the till never waits on AEAT — but from then on AEAT receives nothing from that node,
and the dashboard says only "Contact support" (`apps/dashboard/src/i18n/alert-messages.ts:100-119`).

AEAT's own rules say a Veri\*Factu system may not leave a record unsent: «no pueden quedar RF
generados sin remitir a la AEAT» (no generated record may be left unsent; developer FAQ v1.3 §5,
p. 12). So a stopped chain is not a safe resting state; it is a breach that grows with every sale.

This design answers the owner's four questions (2026-10-03): how it can happen, how to prevent it,
how to recover, and how to put things right with AEAT.

## 2. Owner decisions already made (2026-10-03, not reopened here)

1. **Sales are never locked waiting on AEAT** (CLAUDE.md §5, "Nothing external may block a sale").
2. **If a divergence is found despite prevention, Waitron starts a NEW chain** — a fresh
   installation number, the node's invoice series retired, disjoint new ones — the machinery the
   cold restore and the bucket rebuild already use (#248), rather than stopping sales.

## 3. Words used here

- **Record** (`registro de facturación`): one entry filed with AEAT. A **new-invoice record**
  (`alta`), a **cancellation record** (`anulación`), or a **correction record**
  (`alta de subsanación`, which replaces the data AEAT holds for one invoice).
- **Fingerprint** (`huella`): a SHA-256 hash of a record's key fields, including the previous
  record's fingerprint. That inclusion is what makes the records a **chain**.
- **Invoicing system** (`SIF`, sistema informático de facturación): AEAT's name for one installation
  of billing software, identified by our tax id, the software code and an **installation number**
  (`NumeroInstalacion`). One SIF has one chain (Orden HAC/1177/2024 art. 7.c). In Waitron one row of
  `registro_sif` is one SIF; records carry its id as `sif_id`.
- **Invoice key**: what AEAT treats as one invoice — tax id + series-and-number + **issue date**
  (service description v1.0.3 §3, p. 10).
- **Duplicate answer** (error 3000): AEAT already holds a record under that invoice key. The reply
  states what AEAT's stored copy is (`Correcta`, `AceptadaConErrores`, `Anulada`) or leaves it out,
  and never includes the stored copy's fingerprint.
- **Lookup** (`consulta`): asking AEAT what it holds for a month, optionally one invoice or one
  installation. It returns each stored record's fingerprint and its link to the previous one.
- **Submission states** (`envios.estado`): `pendiente` (waiting), `enviando` (being sent),
  `aceptado`, `aceptado_con_errores` (accepted with a warning), `rechazado`, `detenido`.
- **Divergence**: AEAT holds, under one of our invoice keys, a record whose fingerprint is not ours.
- **Fake AEAT**: `createFakeAeat` from `@waitron/verifactu` 0.2.1, our library's model of AEAT. It
  keys invoices like AEAT and never checks chain links.

How each claim below was established is marked: **[ran]** — a research seat ran a throwaway test on
2026-10-03 against the fake AEAT and the real filing code, and the printed outcome is quoted;
**[read]** — found by reading code or documents only; **[measured at AEAT]** — a live answer from
AEAT's pre-production service, read from the `waitron-io/verifactu` library's GitHub Actions logs.
Every [ran] result depends on the fake AEAT behaving like the real one, which §13 proposes to probe.

## 4. How it can go wrong — ranked

Likelihood × harm, highest first. Each row's detail follows.

| #   | Cause                                                                                  | Likelihood                     | Harm                                                                 | Today                                       |
| --- | -------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| C1  | Records filed out of chain order after a failed send (our bug)                         | **High**                       | Filing stops for good                                                | Possible — [ran]                            |
| C2  | An older copy of the database starts as the same node                                  | Low today, rising              | **Silent**: AEAT holds a different invoice under a number we call accepted | Possible — [ran]                            |
| C2a | A duplicate answer `Correcta` is taken as ours without comparing fingerprints          | (amplifier)                    | Hides C2, C3, C5, C6                                                 | Possible — [ran]                            |
| C3  | A replacement box set up as a NEW venue under the same tax id                          | Medium                         | Installation number and invoice numbers reused                       | Possible — [ran]                            |
| C4  | A box cloned, or a disk image booted, while the original runs                          | Low                            | As C2, continuing                                                    | Possible — [read], same mechanism as C2     |
| C5  | `register-till` re-registering an older copy                                           | Low                            | Installation number and invoice numbers reused                       | Possible — [ran]                            |
| C6  | A restore on a clock behind an earlier restore's clock                                 | Low                            | Installation number and series codes reused                          | Possible — [read]; the code says so itself  |
| C7  | An unstamped pre-production database started as production                            | Low                            | A hole in the production series, unannounced                        | Possible — [ran]                            |
| C8  | The old box comes back after a restore or bucket rebuild                               | Low–medium                     | Two boxes selling and filing; split books; no number reuse           | Partly guarded — [read]                     |
| C9  | AEAT refuses a record for a reason about us (census name, clock a day ahead)           | Low–medium                     | Filing stops for good                                                | Possible — [read]                           |
| C10 | The bucket stream's lag, then a rebuild                                                | Low–medium                     | Records AEAT holds that we lost, or invoices AEAT never gets         | Accepted risk; rebuild re-mints — tested    |
| C11 | A crash between AEAT's reply and our save; the restart reset; timeouts                 | Medium                         | None alone (identical content resent); harmful with C1               | Tested                                      |
| C12 | "Accepted with warnings"; AEAT accepting then losing a record                          | Low / very low                 | None / unnoticed                                                     | [read]                                      |
| C13 | A standby promoted while the old primary lives                                         | Not reachable today            | As C4                                                                | [read]                                      |

### C1. Records filed out of chain order after a failed send — HIGH × filing stops

A failed send backs off **each record by itself**: `backoffBatch` (`drain.ts:473-487`) pushes each
row's next attempt out by `backoffMs(intentos)`, which doubles each time. A record added later is due
at once. `claimBatch` (`drain.ts:363-370`) takes every due waiting row in chain order but never asks
whether an EARLIER row of the same chain is still waiting and not yet due; `haltOpenChainClaims`
(`drain.ts:433-466`) looks only for `rechazado` or `detenido` predecessors. So after two failed
passes, newer records go out ahead of older ones. `awaitReadableAnswer` (`drain.ts:644-672`) does the
same to one unreadable line. This dates from #15 (`c57242ebd`, 2026-07-22) and has no backlog entry.

**[ran]** Record a sale; two drain passes whose AEAT client throws `ETIMEDOUT`; void the sale;
reconnect; run the pass the drain asked for. The safe outcome would have sent both records in chain
order with no incident. It printed:

- When AEAT never got the sale: the cancellation alone was sent and refused with 3002 (record does
  not exist); the sale went `detenido`; incident `fiscal.registro_rechazado`.
- When AEAT got the sale but our reply was lost: the cancellation alone was sent and accepted; the
  sale's resend came back `Anulada`; the sale went `detenido`; incident `fiscal.duplicado_anulado`.

Either way the chain stops for good. It needs only an outage spanning two passes (about two minutes)
and a void during it, which the "sales continue offline" rule makes routine. Orden art. 16.4 also
asks for records to be sent «respetando el orden temporal de generación» (keeping the order they
were generated in).

### C2. An older copy of the database starts as the same node — LOW (rising) × SILENT

Anything that puts back an older `venue.db` without `waitron-restore`: a reverted VM or filesystem
snapshot, a disk or SD-card image, a hand-copied file, a disk losing its last writes, or the planned
automatic-upgrade rollback (`docs/backlog.md`, the entry that requires "nothing fiscal before the
check passes"). Nothing detects it **[read]**: the invoice counter is a plain increment
(`packages/db/src/allocate-number.ts:30-45`); the bucket supervisor refuses only a pointer at a
higher term (`packages/stream/src/supervisor.ts:435-437`), so an older copy at the same term takes
the pointer, and the newer generation holding the filed records is pruned a week later
(`PRUNE_WINDOW_MS`); and the period audit `reconcile()` (`packages/fiscal-verifactu/src/reconcile.ts`)
is not exported and has no production caller.

**C2a, the amplifier.** A duplicate answer whose stored copy is `Correcta` or `AceptadaConErrores` is
read as an accept (`resolveEstadoEfectivo` in `@waitron/verifactu`'s `parse-suministro.js`), and
`applyOutcome` marks our row accepted with **no fingerprint comparison** (`drain.ts:584-589`, stated
at `drain.ts:292-300`). The lookup ("Route B") runs only when AEAT leaves the state out, or for a
cancellation. `drain.test.ts:711` ("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to
aceptado") pins this for a resend of our own record; nothing covers a different record under the
same key.

**[ran]** File sale S0; copy the database (`vacuum into`); on the live database file X (14.41); on the
copy, as the same node, record and file Y (19.41). The safe outcome would have been Y `detenido` with
`fiscal.huella_divergente`. It printed: same day, our Y marked `aceptado` with no incident while AEAT
holds X under `A/2`; Y issued the next day, AEAT holds **two** `A/2` invoices (different issue dates,
so different invoice keys) and a forked chain.

### C3. A replacement box set up as a new venue under the same tax id — MEDIUM × HIGH

A fresh database has no installation counter, so `mintNumeroInstalacion`
(`packages/fiscal-verifactu/src/registro-sif.ts:59-84`) returns **1**; the fiscal seed applies no
clock floor; the setup wizard pre-fills series `FS`/`FR` (`apps/setup/src/screens/venue-screen.ts:256-257`).
**[ran]** Two fresh databases, one tax id, sales on 1 and 9 March, one fake AEAT: both used
installation 1 and `A/1`, `A/2`; AEAT holds four invoices; the only signal was warning 2007 on the
second box's first record. 2007 is AEAT's «No debe informarse como primer registro…» — a first-record
claim under an installation that already filed — and it is real: **[measured at AEAT]** a second
first-record claim under one installation number got `AceptadoConErrores`/2007, while one under a new
installation number got `Correcto` (runs 36346478997 and 36896640752).

### C4. A cloned box beside the original — LOW × HIGH

C2 with both copies live. `venue.lock` holds within one filesystem only. **[read]**

### C5. Re-registering an older copy — LOW × HIGH

`registerSif` (`registro-sif.ts:179-229`, reached through `apps/server/scripts/register-till.ts`)
mints from the database's own counter with no clock floor and keeps the series and their counters.
**[ran]** Both the live database and an older copy re-registered: both minted installation 2, and the
copy's `A/2` was marked accepted while AEAT holds the live box's `A/2`.

### C6. A restore on a clock behind an earlier restore — LOW × HIGH

`installationFloor` is wall-clock seconds since 2020 (`packages/fiscal-verifactu/src/restore.ts:18-20`);
its own comment says a restore on a clock behind a prior restore can compute the same floor. The
"reuse experiment" test (`restore.test.ts:116`) passes because its clock is ahead. **[read]**

### C7. An unstamped pre-production database started as production — LOW × MEDIUM–HIGH

Boot refuses a database stamped for another environment (`apps/server/src/deployment-guard.ts:14-24`;
`deployment-guard.test.ts`, four cases, run green), but an **unstamped** one passes, and only
`apps/server/src/provision.ts` and `adopt.ts` stamp — the `waitron-provision venue` path and
`dev-setup` do not. **[ran]** Three sales filed as pre-production, then one as production: production
AEAT holds `A/4` chained to `A/3`, which it never received; `A/1`–`A/3` are a hole in the production
series; no incident. (With pre-production records still waiting, the environment guard leaves them
`pendiente` and blocks the chain instead, `drain.ts:383-401`.)

### C8. The old box comes back after a restore or bucket rebuild — LOW–MEDIUM × MEDIUM

What is safe: every production restore path re-mints the installation number and opens disjoint
series (`apps/server/src/restore.ts` `runRestoreHooks` → `restoreFiscal`), guarded by
`restore-fiscal-e2e.test.ts` ("re-registers the SIF, retires and replaces the series…"). So the two
boxes never share a number. What is not **[read]**: the old box keeps the same AEAT certificate and its
old installation number; a higher-term bucket pointer stops only its **streaming**
(`supervisor.ts:435-437`), not its selling or filing; the only guard is the restore-time "old box wrote
in the last ten minutes" check (`restore-stream.ts:130-148`), which `--confirm-old-box-gone` skips and
an offline box passes. Result: two boxes filing valid records under two installation numbers, and
split books.

### C9. AEAT refuses a record for a reason about us — LOW–MEDIUM × filing stops

A census-name mismatch, or a clock a day ahead (a future issue date). The library's `validate` cannot
catch what only AEAT knows. The record goes `rechazado` and `haltSuccessors` (`drain.ts:718-731`)
stops the rest of the chain. **[read]**

### C10–C13

- **C10**, the bucket lag: a rebuild re-mints, so nothing collides; the lost tail is the owner's
  accepted cold-recovery loss. `backup.stream_behind` warns at fifteen minutes.
- **C11**: a crash leaves a row `enviando`; `resetInFlightClaims` and the five-minute stale recovery
  requeue it; the identical resend gets a `Correcta` duplicate and is accepted (`drain.test.ts:711`).
  Harmless alone; C1's second variant is exactly this plus a void.
- **C12**: accepted-with-warnings is an accept; AEAT losing an accepted record would go unnoticed
  because `reconcile()` is unwired.
- **C13**: promotion cannot finish today (`apps/server/src/finish-adoption.ts`), so no standby files.
  When it can, C4 and C8 apply to the demoted primary.

## 5. Prevent

Each fix names the test that holds it; each guard is proven by deletion when built.

- **P1 — Settle each chain strictly in order (C1, C11).** `claimBatch` does not claim a row while an
  earlier row of the same `sif_id` is unsettled (`pendiente` not yet due, or `enviando`); a failed
  send backs off the chain from its first unsettled row, not row by row; `awaitReadableAnswer` holds
  the rest of its chain the same way. A cancellation or correction that names another invoice also
  waits until that invoice's own record is settled, even on another chain. Tests: both C1 variants
  ("a cancellation added while its sale is backed off is not sent before the sale"); "after a
  two-pass outage, a sale made during it files after the earlier sale"; "a cancellation on the new
  chain waits for its sale on the old one".
- **P2 — Compare fingerprints on every duplicate answer (C2a).** Every 3000, `Correcta` and
  `AceptadaConErrores` included, takes the lookup and compares AEAT's stored fingerprint with ours;
  a match is an accept, a mismatch is a divergence (§6). One lookup per duplicate; duplicates are
  rare. Test: "a 3000 whose stored copy is Correcta but carries another fingerprint is a divergence".
  `drain.test.ts:711` keeps passing: our own resend matches.
- **P3 — One minting function for every new chain (C3, C5, C6).** Provisioning, `register-till` and
  restore all mint through one function that floors the installation counter at
  `max(clock, newest record's generation time, newest registro_sif.registrado_en) + 1` and always
  opens series codes carrying the installation suffix, so two installations ever made for one tax id
  share neither. Tests: "two venues provisioned for one tax id get different installation numbers and
  disjoint series codes"; "re-registering never re-mints a number a newer copy used"; "a restore on a
  clock behind the previous restore still mints a fresh number".
- **P4 — Stamp every database; an unstamped one holding non-production records does not start as
  production (C7).** `venue-apply` and `dev-setup` stamp at creation. A production start of an
  unstamped database holding any non-production record refuses, with a code the recovery page words.
  Test: "boot refuses an unstamped database holding pre-production records when
  `WAITRON_ENV=production`".
- **P5 — An older copy is caught before its first sale (C2, C4).** The signed bucket pointer carries
  the node's chain height (`secuencia`) and invoice counters; boot, before trading, compares them with
  the local database; a database behind the bucket for its own node starts a new chain (§7) before
  its first sale and raises an alert; the supervisor never moves the pointer away from a generation
  ahead of it. A box with no bucket gets the first-pass check of §7.6 instead. Tests: "a database
  behind the bucket's pointer for its own node starts a new chain before its first sale"; "an older
  copy at the same term does not take over the pointer".
- **P6 — A higher-term pointer fences the box, not just its stream (C8).** A box that meets a
  pointer at a higher term stops selling and filing and shows the recovery page with an alert. An old
  box that never comes online stays unfenced; that cannot be closed locally. Test: "a box whose bucket
  pointer names a higher term boots fenced: no sales, no filing".
- **P7 — Check what only AEAT knows before the first sale (C9).** The pre-production readiness test
  already files a record; it also checks the tax id and legal name against AEAT's census answer, and
  the server refuses to issue records while its clock is more than the tolerance away from an outside
  time source. Test: "a clock a day ahead refuses a sale with a code the till words".

P1 and P2 are the urgent ones: P1 is the only high-likelihood cause, and without P2 every collision in
C2–C6 is silent. P5 and P6 depend on the topology work (slice 3) and may land later.

## 6. Detect: three kinds of stop

Today a stop is classified only by which branch of `drain.ts` fired. After this design:

| Kind                  | Signal                                                                                                                       | What happens                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Divergence**        | A duplicate answer whose lookup shows another fingerprint (P2; today's Route B mismatch); an `alta` whose stored copy is `Anulada` (today's Route A); warning 2007 on our chain's first record (another system already filed under our installation number) | The record becomes `divergente` (new state); a new chain starts automatically (§7)               |
| **Ordinary refusal**  | `Incorrecto` with any code but 3000 — bad data on one record, or a cause about us (C9)                                       | The record stays `rechazado`; the chain carries on (§7.5); an alert names the record and AEAT's reason |
| **Our ordering bug**  | A cancellation refused 3002 because its sale had not been sent                                                               | Removed by P1                                                                                    |

`divergente` is a terminal state for that one record. It never halts other records. With D2 below,
a refusal halts nothing either, so **nothing writes `detenido` any more**: the state,
`haltSuccessors`, `haltOpenChainClaims` and the `fiscal.submission_stopped` alert retire, and
`fiscal.submission_delayed` (records waiting over 4 h or 24 h, `submission-alerts.ts:24-40`) reports
anything held, P1's waits included. If the owner declines D2, a refusal still halts its chain as
today and `fiscal.submission_stopped` stays, gaining a link to Fiscal filing (§8).

## 7. Recover: the new chain

### 7.1 Automatic, in the same transaction as the divergence — recommended

The new chain exists for its new series. Whatever produced the collision — an older copy, a clone, a
second venue under our tax id — allocates the same numbers we do; staying on our series keeps
colliding with it, and a new series disjoint from every earlier one cannot.

**Recommendation: automatic.** A manual step means the node files nothing to AEAT until a manager
acts, which is the breach §1 describes, and it asks a manager to make a fiscal decision they cannot
judge. Automatic also keeps the owner's rule: no sale ever waits.

When the drain's save transaction records a divergence, the **same transaction**:

1. marks the record `divergente`;
2. starts the new chain exactly as `runRestoreHooks` does — `restoreFiscal` (floored new installation
   number through P3's function, `registerSif`, chain head reset), `retireNodeSeriesTx`,
   `insertNodeSeriesTx` — so the next sale is `A-<installation>/1` with `PrimerRegistro = S`;
3. writes an audit row in a new `chain_restarts` table (when, the old and new installation numbers,
   the record and invoice key that diverged, AEAT's stored fingerprint, the cause);
4. raises the `fiscal.chain_restarted` incident (§8).

A research seat ran step 2 and the sales around it on a live database handle inside one write
transaction, and it committed: the new chain's first record was accepted and the old records stayed
untouched **[ran]**. A sale in flight serialises behind the transaction on the write queue.

### 7.2 The series is read per sale, so nothing restarts

Today the server holds the standard series id in memory (`config.till.seriesId`, from
`WAITRON_TILL_SERIES_ID`, `apps/server/src/till-config.ts:93`), used by every sale path
(`till-sale.ts`, `bill-payments.ts`, `working-order.ts`). **[ran]** After a live new chain, a sale on
that id was refused `sale.series_retired`, which no screen words. So this design reads the node's one
live standard series inside each sale's transaction (`readStandardSeriesIdTx`), and
`WAITRON_TILL_SERIES_ID` goes, with the mirror bundle and sealed state copies that carry it. No
restart, no window in which sales are refused. (The alternative — rewrite `trading.env` and restart,
as mirror promotion does — interrupts service and has two crash windows that each block sales.)

### 7.3 The old chain's records

Nothing halts the old chain's other records (§6), so they keep filing exactly as they would have:

- **Records AEAT never received are still filed, unchanged.** Each keeps its old installation number,
  old link and old fingerprint, oldest first, with the `Incidencia` flag in the message header
  (Orden art. 16.4; RRSIF art. 8.2.a forbids changing a record). AEAT keys by invoice, and by its
  documents does not compare a record's link with what it holds (§9.5), so these are accepted.
  Asesor question Q2 confirms.
- **Records AEAT already holds** (today a same-batch successor AEAT accepted is still halted
  locally, `drain.test.ts:893-897` **[ran]**; under this design it is simply settled) come back as
  duplicates when resent; P2's lookup matches the fingerprint and marks them accepted.
- **The divergent record itself** stays `divergente`. The customer holds an invoice AEAT cannot take
  under that key. It goes on the **Needs your adviser** list (§8) with the remedy §9 describes; Waitron
  files nothing for it until the owner decides (asesor Q3, Q4).

### 7.4 Voids and corrections after the switch

A cancellation or correction of an old-chain invoice is recorded on the **new** chain (it uses the
current SIF, `backend.ts:331-357`), which AEAT allows: «tanto un RF de alta de subsanación como un RF
de anulación se podrían generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió
la factura original» (developer FAQ v1.3 §17, p. 37). P1's cross-chain rule makes it wait until the
old invoice's own record is settled. **[ran]** Without that wait, the fake AEAT refused such a
cancellation 3002 and the new chain stopped again.

Voiding or correcting the **divergent** invoice itself is refused at the till with a new code
(`fiscal.invoice_needs_adviser`). AEAT keys a cancellation by invoice key, so one sent for that key
would cancel the record AEAT holds — the other copy's invoice, not ours — and a correction record
would overwrite it (§9.3).

### 7.5 An ordinary refusal no longer stops the chain

AEAT expects a chain to carry on past a refused record: «El registro original no se puede modificar,
por lo que permanecerá inalterado. […] el encadenamiento debe ser con el registro de facturación
inmediatamente anterior» (service description v1.0.3 §9.1.3, p. 60), and a refused record is
corrected later by a new record flagged `Subsanacion = S`, `RechazoPrevio = X` (developer FAQ v1.3
§17, pp. 36-37) — **[measured at AEAT]** such a correction of a refused record came back `Correcto`
(run 36350894099). So `haltSuccessors` no longer runs on a refusal: later records file, the refused
one stays `rechazado`, and the alert names it with AEAT's reason. Building the correction record is a
new record builder — fiscal core — and is **out of this design**: it is a follow-up the owner gates on
asesor Q5. A new chain does not help here: a refusal caused by our configuration would recur on it.

### 7.6 A box with no bucket

P5 needs the bucket. Without one, the first filing pass after a start looks up, for each live series,
whether AEAT already holds the next number this node would issue (a lookup by month and installation
number). If it does, the node is behind AEAT: it starts a new chain before its first sale is filed.
Sales made in the meantime are recorded and file on whichever chain they were made on; the check
runs before the drain's first claim, not before the till opens.

### 7.7 The loop guard

Two automatic new chains within 24 hours means something is wrong with this node, not with AEAT. The
second divergence still marks its record `divergente`, but no third chain starts automatically: the
current chain carries on filing, each further collision is marked `divergente` and listed, sales
continue, and the `fiscal.chain_restart_limit` alert asks for support. An administrator can then start one by hand: the same action behind a button
in the alert, with the `node.promote` precedent's re-authentication (password and TOTP,
`apps/server/src/promote-api.ts`).

## 8. What the dashboard says

The Alerts screen is the only surface today (`apps/dashboard/src/screens/alerts-screen.ts`); there is
no fiscal screen, and `fiscal.submission_stopped` has no action and can never clear. This design:

- adds a **Fiscal filing** section to an existing dashboard screen, or a new one if none fits
  (decided in the plan), listing the current chain (installation number, series, last record
  accepted), any `chain_restarts`, and the **Needs your adviser** list of `divergente` records with
  the invoice number, date, amount and what AEAT holds instead;
- replaces each "Contact support" with what happened and what Waitron did. Proposed wording (the
  plan's screen task refines it; `scripts/alert-codes.test.ts` holds both languages):

| Code                          | English                                                                                                                                                                                                         | Spanish                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal.chain_restarted`      | The tax agency (AEAT) holds a different record for invoice {invoice}. To keep filing, Waitron started a new invoice series, {series}, at {time}. Sales were not interrupted. Invoice {invoice} needs your tax adviser: see Fiscal filing. | La AEAT tiene un registro distinto para la factura {invoice}. Para seguir enviando, Waitron ha abierto una nueva serie de facturas, {series}, a las {time}. Las ventas no se han interrumpido. La factura {invoice} requiere a tu asesor fiscal: consulta Envío fiscal. |
| `fiscal.registro_rechazado`   | The tax agency (AEAT) refused the record for invoice {invoice}: {mensaje} (code {codigo}). Later records are still being sent. This invoice needs correcting: see Fiscal filing.                                | La AEAT ha rechazado el registro de la factura {invoice}: {mensaje} (código {codigo}). Los registros posteriores se siguen enviando. Esta factura debe corregirse: consulta Envío fiscal.                                          |
| `fiscal.chain_restart_limit`  | Waitron has started two new invoice series in a day because the tax agency (AEAT) holds records it did not expect. It has stopped doing so automatically. Sales continue. Contact support.                      | Waitron ha abierto dos series de facturas nuevas en un día porque la AEAT tiene registros que no esperaba. Ha dejado de hacerlo automáticamente. Las ventas continúan. Contacta con soporte.                                         |

`fiscal.huella_divergente` and `fiscal.duplicado_anulado` retire as incidents: `fiscal.chain_restarted`
is the one a manager sees, carrying the cause (a different fingerprint, an annulled copy, or 2007) in
its params. Before a venue is live a code may be renamed or deleted freely (CLAUDE.md §3); every copy
moves in the same change.

## 9. Putting things right with AEAT

Every quotation was copied from text a research seat extracted from the raw download (`curl`, then
`pdftotext`); the provenance is in §15. Spanish first, then plain English.

### 9.1 Records customers hold that AEAT never accepted must still reach AEAT

> «Y en el caso de SIF VERI\*FACTU, esto se amplía a los RF remitidos, o sea, no pueden quedar RF
> generados sin remitir a la AEAT.» — developer FAQ v1.3 §5, p. 12

In Veri\*Factu mode no generated record may be left unsent.

> «En caso de que alguna incidencia técnica impida la remisión voluntaria en las condiciones
> indicadas se deberá proceder a la remisión de los registros de facturación en cuanto sea posible,
> respetando el orden temporal de generación de los registros de facturación.» — Orden HAC/1177/2024
> art. 16.4, p. 13

After an incident, send as soon as possible, oldest first.

> «Cualquier necesidad de corrección o anulación de los datos registrados deberá ser realizada
> mediante al menos un registro de facturación adicional posterior, de forma que se conserven
> inalterables los datos originalmente registrados.» — Real Decreto 1007/2023 art. 8.2.a), p. 14

Records are never edited; any change is a later record. Hence §7.3: the old chain's unsent records
go out byte for byte.

### 9.2 A refused record is corrected by a new record, from either system

> «Si el RF generado de la "factura errónea" fuera rechazado por la AEAT […], habría que corregir la
> factura original y generar un RF de alta de subsanación, sin registro previo en la AEAT (ya que el
> RF "original" fue rechazado y no existe en la AEAT). Por lo tanto, este RF de alta de subsanación
> deberá llevar una codificación especial en ciertos campos ('Subsanacion' = "S" y
> 'RechazoPrevio'="X")» — developer FAQ v1.3 §17, pp. 36-37

A refused record is fixed with a correction record flagged `S`/`X`.

> «X — Independientemente de si ha habido o no algún rechazo previo por la AEAT, el registro de
> facturación no existe en la AEAT (registro existente en ese sistema informático o en algún sistema
> informático del obligado tributario y que no se remitió a la AEAT […])» — Orden annex, list L17,
> p. 31

`X` means "AEAT does not hold this invoice", and expressly covers a record in another of the
taxpayer's systems.

> «Solo podrá llevarse a cabo una subsanación cuando no se trate de una causa que exija la emisión de
> una factura rectificativa» — validation document v1.2.2 §4.3.1, p. 22

Only where the error does not need a corrective invoice.

### 9.3 A record AEAT holds that is not ours: three tools, none made for this

- **Correction record**: on the wire it replaces AEAT's copy outright — «El registro remitido
  sustituye completamente al registro de facturación con los nuevos datos recibidos» (validation
  document annex, OK (4), p. 27) — but in law only for fields the customer does not see: «campos
  "internos", como ciertas codificaciones tributarias […] Estos casos deberían ser MUY POCO
  FRECUENTES» (developer FAQ v1.3 §17, p. 34).
- **Cancellation record**: only for an invoice that should never have existed — «todas las facturas
  emitidas, en la medida en que respondan a operaciones realmente efectuadas (como es el caso
  habitual) no pueden anularse» (developer FAQ v1.3 §17, p. 35) — though an invoice never handed to
  the customer leans towards cancellable (same, p. 37).
- **Corrective invoice** (`factura rectificativa`): required «en los casos en que la factura original
  no cumpla alguno de los requisitos que se establecen en los artículos 6 ó 7» (Real Decreto
  1619/2012 art. 15.1, p. 19), and art. 6.1.a requires that «La numeración de las facturas dentro de
  cada serie será correlativa». A number two real invoices share arguably fails that.

No source covers two real invoices sharing one number. Waitron's proposed handling, per case, for
the asesor to confirm:

| What AEAT holds under our key                                              | Proposed handling                                                                                                             | Asesor |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| The same sale as ours, differing only in link, timestamps or installation   | Leave it; record locally that AEAT's copy stands for that key                                                                 | Q6     |
| A sale that never happened (an old copy's phantom)                          | Cancellation record from the new chain, only if no customer received that ticket                                              | Q7     |
| A real invoice from the other copy, while we gave a customer ours           | Our refused record stays unchanged; a corrective invoice by substitution in the new chain's corrective series refers to it      | Q3, Q4 |

### 9.4 A new chain: what AEAT describes

> «no puede repetirse nunca: por ejemplo, incluso si se formatea el ordenador donde estaba instalado
> un SIF y se reinstala el mismo software de nuevo en ese mismo ordenador, el nuevo SIF así
> constituido debe llevar otro nº de instalación diferente al anterior» — developer FAQ v1.3 §4, p. 10

A reinstall is a new SIF with a new installation number — and so, by Orden art. 7.b/7.c, a new chain
starting with `PrimerRegistro = S`. That is the only "new chain" case AEAT describes. There is no
closing record (the record design has three record types — new invoice, cancellation, event — and
none ends a chain), and no notice to AEAT; the one duty is to justify an incident if asked: «Las
incidencias en la remisión voluntaria […] deberán ser debidamente justificadas por el remitente si
así se lo requiere la Agencia Estatal de Administración Tributaria» (Orden art. 16.4, p. 13). Hence
the `chain_restarts` audit row. In Veri\*Factu mode the event log and the chain-damage checks do not
apply: «en tanto actúen como «VERI\*FACTU», no les serán de aplicación los artículos 6.b), 6.c),
6.d), 6.e), 6.f), 7.f), 7.h), 7.i), 7.j), 8 y 9 de esta orden» (Orden art. 3, p. 5).

### 9.5 What AEAT checks on receipt

> «Cuando en una remisión de un sistema «VERI\*FACTU» la huella informada no coincida con el cálculo
> realizado por la AEAT, el registro de facturación se marcará como "Aceptado con errores".» — hash
> specification v0.1.2 §7, p. 13

AEAT recomputes each record's fingerprint from that record's own fields, including the previous
fingerprint the record states. No rule in the validation document and no code in AEAT's error list
compares a record's link with the record AEAT actually holds; the chaining checks are format only
(validation document §3.1.3 item 18, p. 15). **This is a documentary negative, unmeasured** — §13
proposes the probe. And: «La respuesta afirmativa […] no implica que los registros de facturación
remitidos sean completamente válidos, ni impide posteriores validaciones» (Orden art. 16.3) — AEAT
can walk a chain later.

### 9.6 The lookup can compare chains invoice by invoice

The lookup takes a mandatory year and month, and optionally an invoice number, customer, date or
range, and an installation (service description v1.0.3 §6.4, p. 30; `ConsultaLR.xsd`). For each
invoice it returns the stored record's fingerprint, its link with the previous fingerprint, its
generation time and its state (`RespuestaConsultaLR.xsd`). It returns one current record per invoice
and nothing for a refused attempt — **[measured at AEAT]** `SinDatos` for a refused record (run
36350894099). So it can find where our chain and AEAT's last agree (§7.6), but cannot rebuild a
history.

## 10. Questions only the asesor can answer

For the owner to send. Each has the default Waitron takes until answered.

1. **Q1 — Starting a new chain after a divergence.** Is abandoning a chain lawful with no closing
   record and no notice to AEAT, given that only a reinstall is described? _Default: yes, under a
   never-used installation number; keep the old chain, AEAT's replies and an incident record to
   justify it on request (Orden 16.4)._
2. **Q2 — The old chain's unsent records.** May they be sent after the new chain starts, unchanged
   (old installation number, old links), with `Incidencia`? _Default: yes, oldest first, never
   regenerated._
3. **Q3 — A number collision on the same date.** AEAT holds the other copy's real invoice under the
   same number and date as a real invoice we gave a customer; ours is refused 3000. What must we issue?
   _Default: a corrective invoice by substitution in the new chain's corrective series, referring to
   ours; our refused record unchanged; the number never reused._
4. **Q4 — The same number on a different date.** AEAT accepts both, holding two invoices with one
   number. Must we correct anything? _Default: as Q3; and Waitron refuses number reuse within a series
   whatever the date, because AEAT will not._
5. **Q5 — A record refused for a non-content reason.** May the current chain file a correction record
   (`Subsanacion = S`, `RechazoPrevio = X`) for it? _Default: yes, correcting record data only, never
   amounts._
6. **Q6 — AEAT holds our sale from an old copy, differing only in chain fields.** Leave it, or
   overwrite it with a correction record? _Default: leave it._
7. **Q7 — AEAT holds a sale that never happened.** Is a cancellation from the new chain right, and
   does a printed ticket change that? _Default: cancel only where no customer received the ticket;
   otherwise ask._
8. **Q8 — After restoring an older backup.** Would continuing the old chain from the last record AEAT
   holds be preferable to a new installation? _Default: keep the owner's new-chain rule._
9. **Q9 — Late filing.** Does sending the old chain's tail after the new chain starts count as the
   prohibited deliberate batch upload? _Default: no — Orden 16.4 covers sending after an incident._

## 11. Decisions for the owner

Each has the recommended default this design is written to.

1. **D1 — Automatic or manual new chain.** Recommended: automatic, in the divergence's own
   transaction (§7.1), with the loop guard (§7.7).
2. **D2 — An ordinary refusal no longer stops the chain** (§7.5). Recommended: yes. This changes what
   is filed after a refusal: later records go to AEAT instead of waiting forever.
3. **D3 — The series is read per sale and `WAITRON_TILL_SERIES_ID` goes** (§7.2). Recommended: yes,
   rather than a restart.
4. **D4 — Voiding or correcting a divergent invoice is refused at the till** (§7.4). Recommended: yes,
   until the asesor answers Q3/Q4.
5. **D5 — The old chain's records keep filing, unchanged, after the switch** (§7.3). Recommended:
   yes, pending asesor Q2.
6. **D6 — Where the Fiscal filing section lives** (§8). Recommended: decided in the plan's screen task,
   shown to the owner before it lands.
7. **D7 — P5 and P6 wait for the topology work.** Recommended: yes; P1–P4 and P7 do not wait.

## 12. What this does not change

`computeHuella`, the chain link, invoice-number allocation, the alta builders (`recordSale`,
`recordCorrection`, `recordSubstitution`) and `registros_facturacion` are untouched: a new chain
writes `registro_sif`, `contadores_instalacion`, `cadenas` and `invoice_series`, never a record, and
the first new record goes through the unchanged builder with `PrimerRegistro = S`.
`restore.test.ts:206` already proves a chain started after a restore verifies. The golden huella block
in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` pass unedited;
a research seat ran both green beside the live new-chain experiment **[ran]**. The correction record of
§7.5 is a new builder and is NOT in this design.

## 13. Probes to run on AEAT's pre-production service first

The design rests on two things measured only against the fake AEAT. Both are cheap to settle with
the `waitron-io/verifactu` library's live workflow (`live-aeat.yml`), and the plan runs them before
the recovery tasks:

1. **Does AEAT check a record's link against what it holds?** Send a well-formed new-invoice record
   whose link names an invoice key AEAT does not hold, with a random fingerprint, beside a control
   linked correctly. If AEAT checks, the first gets a refusal or an accepted-with-errors code the
   control does not; if not, both come back `Correcto`. §7.3 assumes the second.
2. **What does AEAT answer for a duplicate with different content?** Send an invoice key AEAT holds,
   with another amount. Expected, by the annex: 3000 with the stored copy's state. P2 assumes the reply
   does not reveal the stored fingerprint, so it always looks up.

## 14. Corrections the research found in the compliance notes

For `docs/compliance/verifactu-findings.md`, each as a dated pointer (historical docs are not
rewritten):

- §1 "Required runtime check" calls the Orden art. 7.i check a legal duty; Orden art. 3 switches it
  off in Veri\*Factu mode. Doing it stays harmless and useful.
- §1 calls warning 2007 a sign of accidental re-provisioning; measured, a re-provisioned node with a
  new installation number gets no warning. 2007 means a **reused** installation number — two copies of
  one node.
- AEAT's online FAQ pages are now dated 21 July 2026; the notes cite 5 December 2025.

## 15. Provenance

All retrieved 2026-10-03 by a research seat with `curl` and extracted with `pdftotext -layout`
(the validation annex's tables also rendered and read visually); checksums are SHA-256, first 16 hex
digits.

| Document                                                                 | Version / date             | URL                                                                                                                                                | Cited at                            |
| ------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| AEAT, *Aclaraciones a dudas de los desarrolladores*                      | v1.3, 2025-12-04; `73906dc8afbbb9da`, identical to `docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf` | https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf | §4 p. 10; §5 p. 12; §17 pp. 34-37   |
| AEAT, *Validaciones y errores Veri\*Factu*                               | v1.2.2, 2026-04-08; `426eb926fc098a36` | https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf | §3.1.3 p. 15; §4.3.1 pp. 21-22; annex p. 27 |
| AEAT, error list `errores.properties`                                    | undated; `06519ceb23422bd6` | https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties                                    | codes 2007, 3000-3003               |
| AEAT, *Descripción del servicio web*                                     | v1.0.3, 2025-07-28; `b3570f6a308ce98a` | https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf | §3 p. 10; §6.4 p. 30; §9.1.3 p. 60  |
| AEAT, *Especificaciones técnicas … huella o hash*                        | v0.1.2, 2024-08-27; `f4334c254bb875b4` | https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf | §7 p. 13                            |
| AEAT schemas `ConsultaLR.xsd`, `RespuestaConsultaLR.xsd`                  | v1.0                        | https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/                                                      | §9.6                                |
| Orden HAC/1177/2024 (BOE-A-2024-22138), consolidated                      | `a0090109d56c29c1`          | https://www.boe.es/buscar/pdf/2024/BOE-A-2024-22138-consolidado.pdf                                                                                 | art. 3 p. 5; art. 7; art. 16 p. 13; annex L17 p. 31 |
| Real Decreto 1007/2023 (BOE-A-2023-24840), consolidated                   | last modified 2025-12-03; `34418589f3c5684c` | https://www.boe.es/buscar/pdf/2023/BOE-A-2023-24840-consolidado.pdf                                                         | art. 8.2.a p. 14                    |
| Real Decreto 1619/2012 (BOE-A-2012-14696), consolidated                   | last modified 2026-03-31; `a1c2a0fdc4e936a3` | https://www.boe.es/buscar/pdf/2012/BOE-A-2012-14696-consolidado.pdf                                                         | art. 6.1.a p. 13; art. 15.1 p. 19   |
| Live pre-production runs, `waitron-io/verifactu` workflow `live-aeat.yml` | runs 36340902489, 36346478997, 36350894099 (2026-09-27), 36896640752 (2026-10-01) | https://github.com/waitron-io/verifactu/actions/runs/<id> | §4 C3; §7.5; §9.6. 36350894099 read through the library's `COMPLIANCE-AUDIT.md` "E35" only; the others from `gh run view --log` |
