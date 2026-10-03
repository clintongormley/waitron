# A fiscal chain that AEAT disagrees with — design (W41s)

Status: **proposed, awaiting the owner's approval.** Nothing here is built. Research done
2026-10-03 against `main` at `ea57412dc` (W21, #1130, included). Plan:
`docs/superpowers/plans/2026-10-03-fiscal-chain-divergence.md`. Backlog: W41s.

## 1. The problem

Waitron files one record with AEAT (the Spanish tax agency) for every invoice, cancellation and
credit note. Each record carries the fingerprint of the record before it, so a filing node's records
form a **chain**. If AEAT comes to hold something under one of our invoice numbers that is not what
our database holds, or AEAT refuses one of our records, `packages/fiscal-verifactu/src/drain.ts`
stops filing that chain: the record goes to `rechazado` (refused) or `detenido` (stopped), every
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

- **Record** (`registro de facturación`): one entry filed with AEAT — a **new-invoice record**
  (`alta`) or a **cancellation record** (`anulación`, "this invoice should never have existed").
- **Credit note** (`factura rectificativa`): a NEW invoice with its own number, in its own series,
  that amends an earlier one and names it. Waitron's `recordCorrection` builds one (an R5,
  `packages/fiscal-verifactu/src/backend.ts:373-468`); it is filed as a new-invoice record and
  replaces nothing at AEAT. A **substitution** (`recordSubstitution`, F3) is likewise a new invoice
  naming the ones it replaces.
- **Correction record** (`alta de subsanación`): a record that REPLACES the data AEAT holds for one
  invoice, allowed only for errors the invoicing regulation does not cover. **Waitron builds none
  today.**
- **Fingerprint** (`huella`): a SHA-256 hash of a record's key fields, including the previous
  record's fingerprint. That inclusion is what makes the records a **chain**.
- **Invoicing system** (`SIF`): AEAT's name for one installation of billing software, identified by
  our tax id, the software code and an **installation number** (`NumeroInstalacion`). One SIF has one
  chain (Orden HAC/1177/2024 art. 7.c). In Waitron one row of `registro_sif` is one SIF; records
  carry its id as `sif_id`. A node's **current** installation is its one live `registro_sif` row;
  earlier ones are **retired**.
- **Invoice key**: what AEAT treats as one invoice — tax id + series-and-number + **issue date**
  (service description v1.0.3 §3, p. 10).
- **Duplicate answer** (error 3000): AEAT already holds a record under that invoice key. The reply
  states AEAT's stored copy's state (`Correcta`, `AceptadaConErrores`, `Anulada`) or leaves it out,
  and never includes the stored copy's fingerprint.
- **Lookup** (`consulta`): asking AEAT what it holds for one year and month, optionally narrowed to
  an invoice, a date or an installation. It returns each stored record's fingerprint (an optional
  field in the reply schema) and its link to the previous one.
- **Route A / Route B**: today's two handlings of a duplicate answer in `drain.ts`. Route A trusts
  the state the answer gives; Route B looks the record up and compares fingerprints, and runs today
  only when the answer leaves the state out, or for a cancellation.
- **Submission states** (`envios.estado`): `pendiente` (waiting), `enviando` (being sent),
  `aceptado`, `aceptado_con_errores` (accepted with a warning), `rechazado` (refused), `detenido`
  (stopped). This design adds two (§6): `divergente` and `retenido`.
- **Divergence**: AEAT holds, under one of our invoice keys, a record whose fingerprint is not ours.
- **The bucket** is the owner's cloud storage, to which a box streams its database (Litestream). The
  **pointer** is a small signed file in the bucket naming which copy of the database is current; its
  **term** is a counter a restore raises; a **generation** is one continuous stream of one copy. A
  box is **fenced** when it is stopped from selling and filing. The **topology work** is the
  planned replication-and-failover slice (slice 3).
- **Fake AEAT**: `createFakeAeat` from `@waitron/verifactu` 0.2.1, our library's model of AEAT. It
  keys invoices like AEAT and never checks chain links.

How each claim below was established is marked: **[ran]** — a research or review seat ran a
throwaway test on 2026-10-03 against the fake AEAT and the real filing code, and the printed outcome
is quoted; **[read]** — found by reading code or documents only; **[measured at AEAT]** — a live
answer from AEAT's pre-production (test) service, read from the `waitron-io/verifactu` library's
GitHub Actions logs. Every [ran] result depends on the fake AEAT behaving like the real one, which
§13 proposes to probe.

## 4. How it can go wrong — ranked

Likelihood × harm, highest first. Each row's detail follows.

| #   | Cause                                                                                  | Likelihood          | Harm                                                                       | Today                                      |
| --- | -------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| C1  | Records filed out of chain order after a failed send (our bug)                         | **High**            | Filing stops for good                                                      | Possible — [ran], twice                    |
| C2  | An older copy of the database starts as the same node                                  | Low today, rising   | **Silent**: AEAT holds a different invoice under a number we call accepted | Possible — [ran]                           |
| C2a | A duplicate answer `Correcta` is taken as ours without comparing fingerprints          | (amplifier)         | Hides C2, C3, C5, C6                                                       | Possible — [ran], twice                    |
| C3  | A replacement box set up as a NEW venue under the same tax id                          | Medium              | Installation number and invoice numbers reused                             | Possible — [ran]                           |
| C4  | A box cloned, or a disk image booted, while the original runs                          | Low                 | As C2, continuing                                                          | Possible — [read], same mechanism as C2    |
| C5  | `register-till` re-registering an older copy                                           | Low                 | Installation number and invoice numbers reused                             | Possible — [ran]                           |
| C6  | A restore on a clock behind an earlier restore's clock                                 | Low                 | Installation number and series codes reused                                | Possible — [read]; the code says so itself |
| C7  | An unstamped pre-production database started as production                            | Low                 | A hole in the production series, unannounced                               | Possible — [ran]                           |
| C8  | The old box comes back after a restore or bucket rebuild                               | Low–medium          | Two boxes selling and filing; split books; no number reuse                 | Partly guarded — [read]                    |
| C9  | AEAT refuses a record for a reason about us (registered name, clock a day ahead)       | Low–medium          | Filing stops for good                                                      | Possible — [read]                          |
| C10 | The bucket stream's lag, then a rebuild                                                | Low–medium          | Records AEAT holds that we lost, or invoices AEAT never gets               | Accepted risk; rebuild re-mints — tested   |
| C11 | A lost reply or a crash; the restart reset; timeouts                                   | Medium              | None for a lone record; a sale and its own cancellation in one batch stop the chain | [ran]                             |
| C12 | "Accepted with warnings"; AEAT accepting then losing a record                          | Low / very low      | None / unnoticed                                                           | [read]                                     |
| C13 | A standby promoted while the old primary lives                                         | Not reachable today | As C4                                                                      | [read]                                     |

### C1. Records filed out of chain order after a failed send — HIGH × filing stops

A failed send backs off **each record by itself**: `backoffBatch` (`drain.ts:473-487`) pushes each
row's next attempt out by `backoffMs(intentos)`, which doubles each time. A record added later is due
at once. `claimBatch` (`drain.ts:363-370`) takes every due waiting row in chain order but never asks
whether an EARLIER row of the same chain is still waiting and not yet due; `haltOpenChainClaims`
(`drain.ts:433-466`) looks only for `rechazado` or `detenido` predecessors. So after two failed
passes, newer records go out ahead of older ones. `awaitReadableAnswer` (`drain.ts:644-672`) does the
same to one unreadable line. This dates from #15 (`c57242ebd`, 2026-07-22) and had no backlog entry.

**[ran]** Record a sale; two drain passes whose AEAT client throws `ETIMEDOUT`; void the sale;
reconnect; run the pass the drain asked for. The safe outcome would have sent the sale first, alone
or ahead of the cancellation, with no incident. It printed `SENT BATCHES [["alta"],["alta"],["anulacion"]]`:

- When AEAT never got the sale: the cancellation was refused with 3002 (record does not exist); a
  later pass stopped the sale (`detenido`); incident `fiscal.registro_rechazado`.
- When AEAT got the sale but our reply was lost: the cancellation was accepted; the sale's resend
  came back `Anulada`; the sale went `detenido`; incident `fiscal.duplicado_anulado`.

Either way the chain stops for good. It needs only an outage spanning two passes (about two minutes)
and a void during it, which the "sales continue offline" rule makes routine. Orden art. 16.4 asks
for records to be sent «respetando el orden temporal de generación» (keeping the order they were
generated in). A review seat also found the drain returns no next-due time after a successful send
while a backed-off row waits, so the host sleeps to its longest interval **[ran]**.

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
at `drain.ts:292-300`). `drain.test.ts:711` ("TEETH: a 3000 whose RegistroDuplicado is Correcta
resolves to aceptado") pins this for a resend of our own record; nothing covers a different record
under the same key.

**[ran]** File sale S0; copy the database (`vacuum into`); on the live database file X (14.41); on the
copy, as the same node, record and file Y (19.41). The safe outcome would have been Y stopped with
`fiscal.huella_divergente`. It printed: same day, our Y marked `aceptado` with no incident while AEAT
holds X under `A/2`; Y issued the next day, AEAT holds **two** `A/2` invoices (different issue dates,
so different invoice keys) and a forked chain. A review seat repeated the same-day case with a
planted record: `recordsAccepted: 1`, `incidentsRaised: 0`, our row `aceptado`, AEAT still holding
the planted one **[ran]**.

### C3. A replacement box set up as a new venue under the same tax id — MEDIUM × HIGH

A fresh database has no installation counter, so `mintNumeroInstalacion`
(`packages/fiscal-verifactu/src/registro-sif.ts:59-84`) returns **1**; the fiscal seed
(`packages/fiscal-verifactu/src/provisioning.ts`) applies no clock floor; the setup wizard pre-fills
series `FS`/`FR` (`apps/setup/src/screens/venue-screen.ts:256-257`). **[ran]** Two fresh databases,
one tax id, sales on 1 and 9 March, one fake AEAT: both used installation 1 and `A/1`, `A/2`; AEAT
holds four invoices; the only signal was warning 2007 on the second box's first record. 2007 is
AEAT's «No debe informarse como primer registro, existen facturas emitidas con el obligado emisión y
el sistema informático actual» — a first-record claim under an installation that has already filed.
**[measured at AEAT]** In run 36350894099 a second first-record claim under one installation number
got `AceptadoConErrores`/2007, and first records under a new installation number got `Correcto` —
but each of those also used a new software code (`IdSistemaInformatico` `F2`, `F3`, against the
repeated pair's `F1`), so the run does not show what a new installation number alone does. A new
chain in this design keeps the software code; §13's third probe settles it.

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
`deployment-guard.test.ts`, four cases, run green), and the setup route, adoption and the
`waitron-provision venue` command all stamp (`packages/provisioning/src/cli.ts:315`, pinned by
`cli.stamp.test.ts`). Two kinds pass unstamped: a database made by `dev-setup`, which deliberately
never stamps (its header comment, `apps/server/scripts/dev-setup.ts`), and any database made before
stamping existed. **[ran]** Three sales filed as pre-production, then one as production: production
AEAT holds `A/4` chained to `A/3`, which it never received; `A/1`–`A/3` are a hole in the production
series; no incident. (With pre-production records still waiting, the environment guard leaves them
`pendiente` and blocks the chain instead, `drain.ts:383-401`.)

### C8. The old box comes back after a restore or bucket rebuild — LOW–MEDIUM × MEDIUM

What is safe: every production restore path re-mints the installation number and opens disjoint
series (`apps/server/src/restore.ts` `runRestoreHooks` → `restoreFiscal`), guarded by
`restore-fiscal-e2e.test.ts` ("re-registers the SIF, retires and replaces the series…"). So the two
boxes never share a number. What is not **[read]**: the old box keeps the same AEAT certificate and its
old installation number; a higher-term pointer stops only its **streaming**
(`supervisor.ts:435-437`), not its selling or filing; the only guard is the restore-time "old box wrote
in the last ten minutes" check (`restore-stream.ts:130-148`), which `--confirm-old-box-gone` skips and
an offline box passes. Result: two boxes filing valid records under two installation numbers, and
split books.

### C9. AEAT refuses a record for a reason about us — LOW–MEDIUM × filing stops

A legal name that does not match what AEAT has registered for the tax id, or a clock a day ahead (a
future issue date). The library's `validate` cannot catch what only AEAT knows. The record goes
`rechazado` and `haltSuccessors` (`drain.ts:718-731`) stops the rest of the chain. **[read]**

### C10–C13

- **C10**, the bucket lag: a rebuild re-mints, so nothing collides; the lost tail is the owner's
  accepted cold-recovery loss. `backup.stream_behind` warns at fifteen minutes.
- **C11**: a crash leaves a row `enviando`; `resetInFlightClaims` and the five-minute stale recovery
  requeue it; an identical resend of a lone record gets a `Correcta` duplicate and is accepted
  (`drain.test.ts:711`). **But** a batch holding a sale and its own cancellation, in the right order,
  whose reply is lost: **[ran]** it printed `SENT [["alta","anulacion"],["alta","anulacion"]]`, both
  rows `detenido`, incident `fiscal.duplicado_anulado` — the resent sale meets AEAT's `Anulada` copy,
  which is our own cancellation. P1 and P2 (§5) remove it.
- **C12**: accepted-with-warnings is an accept; AEAT losing an accepted record would go unnoticed
  because `reconcile()` is unwired.
- **C13**: promotion cannot finish today (`apps/server/src/finish-adoption.ts`), so no standby files.
  When it can, C4 and C8 apply to the demoted primary.

## 5. Prevent

Each fix names the test that holds it; each guard is proven by deletion when built.

- **P1 — Settle each chain strictly in order, and send a record that names another invoice only once
  that invoice is at AEAT (C1, C11).**
  - `claimBatch` does not claim a row while an earlier row of the same `sif_id` is unsettled
    (`pendiente`, due or not, or `enviando`); a failed send backs off the chain from its first
    unsettled row, not row by row; `awaitReadableAnswer` holds the rest of its chain the same way;
    and the drain reports the earliest next-due time whenever a row waits.
  - A cancellation, credit note or substitution is claimed only once the record of each invoice it
    names is `aceptado` or `aceptado_con_errores` — so never in the same batch as it, and across
    chains too. If a named invoice's record is `divergente`, the referring record becomes
    `retenido` (§6) instead of being sent. One naming a `rechazado` invoice is sent once D2 is built
    (§6); until then it is `retenido` too. A cancellation names only the invoice key
    (`IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`, `FechaExpedicionFacturaAnulada` in
    `SuministroInformacion.xsd`), not the fingerprint of the record it cancels, so one sent for a key
    AEAT holds under someone else's record would cancel THAT record; the fake AEAT did exactly that —
    **[ran]** with another record planted under our sale's key, our sale and its void in one pass left
    AEAT holding `"anulacion","Anulado"` over the other copy's invoice, both our rows `aceptado`, no
    incident.
  - Settled means `aceptado`, `aceptado_con_errores`, `rechazado`, `divergente`, `retenido` (and
    `detenido` while it exists).
  - Tests: both C1 variants; C11's lost reply; the planted-key cancellation above; "a sale made
    during a two-pass outage files after the earlier sale"; "a cancellation on the new chain waits for
    its sale on the old one".
- **P2 — Compare fingerprints on every duplicate answer (C2a, C11).** Every 3000, `Correcta` and
  `AceptadaConErrores` included, is checked against AEAT's stored fingerprint. An `Anulada` answer to
  a sale is compared with OUR cancellation of that invoice, if we have one: a match means AEAT holds
  our sale and our cancellation, and the sale is settled. A lookup that returns our key's record without a
  stored fingerprint (the field is optional in `RespuestaConsultaLR.xsd`) means "look again next
  pass", never "divergence"; a lookup that returns no record under our installation for a key AEAT
  has just reported as a duplicate means AEAT holds that key under another installation, which is a
  divergence (as `routeB` already treats it, `drain.ts:776-777`). Duplicates come in bulk after a lost reply on a full batch (up to a thousand lines),
  so the drain makes one lookup per month and installation, read page by page, not one per line.
  Tests: "a 3000 whose stored copy is Correcta but carries another fingerprint is a divergence";
  "an Anulada answer whose stored fingerprint is our own cancellation's settles the sale".
  `drain.test.ts:711` keeps passing: our own resend matches.
- **P3 — One minting function for every new chain (C3, C5, C6).** Provisioning, `register-till` and
  restore all mint through one function that floors the installation counter at
  `max(clock, newest record's generation time, newest registro_sif.registrado_en) + 1` and always
  opens series codes carrying the installation suffix, so two installations ever made for one tax id
  share neither. **This changes the invoice numbers customers see from the first sale** — `FS/1`
  becomes, for example, `FS-213192000/1` — decision D9. Tests: "two venues provisioned for one tax id
  get different installation numbers and disjoint series codes"; "re-registering never re-mints a
  number a newer copy used"; "a restore on a clock behind the previous restore still mints a fresh
  number".
- **P4 — An unstamped database holding non-production records does not start as production (C7).**
  A production start of an unstamped database holding any record whose environment is not production
  refuses, with a code the recovery page words. `dev-setup` stays unstamped by design; the refusal
  covers it and any database older than stamping. Test: "boot refuses an unstamped database holding
  pre-production records when `WAITRON_ENV=production`".
- **P5 — An older copy is caught before its first sale (C2, C4).** The bucket holds a small signed
  record of the node's chain position (`secuencia`) and invoice counters, rewritten whenever the
  bucket is reachable. It cannot ride in the pointer as first proposed: the pointer is written only
  when a stream generation starts (`packages/stream/src/supervisor.ts`, the claim after
  `readPointer`), not as sales are filed. Boot, before trading, compares it with the local database;
  a database behind the bucket for its own node starts a new chain (§7) before its first sale and
  raises an alert; the supervisor never moves the pointer away from a generation ahead of it. Every
  box also runs the start-up check of §7.6, bucket or not. Tests: "a database
  behind the bucket's pointer for its own node starts a new chain before its first sale"; "an older
  copy at the same term does not take over the pointer".
- **P6 — A higher-term pointer fences the box, not just its stream (C8).** A box that meets a
  pointer at a higher term stops selling and filing and shows the recovery page with an alert. The
  fenced posture exists already: a box the membership document fences gives up the primary role (so
  its drain stops), refuses writes and tells tills it accepts no sales (`apps/server/src/boot.ts`,
  `isFenced`); only the trigger from the bucket is new — read the pointer before trading, and restart
  fenced when the running stream meets a newer one (`shouldFenceRestart`,
  `apps/server/src/membership-fence.ts`, has no caller yet). **It starts with a short design for the
  owner** on whose signature fences a box: today only a restore checks a pointer's signature
  (`apps/server/src/restore-stream.ts`, against the recovery kit's key), and a fence obeyed on an
  unchecked pointer would let anyone able to write to the bucket stop the venue's sales. An old box
  that never comes online stays unfenced; that cannot be closed locally. Test: "a box whose bucket
  pointer names a higher term boots fenced: no sales, no filing".
- **P8 — Every selling device is a witness the box cannot roll back (C2, C4; owner, 2026-10-03,
  D7).** A disk snapshot or copy rolls back everything on the box, not the devices. Each device keeps
  in `localStorage` (which survives a restart; `sessionStorage` does not) the highest invoice number
  it has seen per series code, read and written inside `try`, as the till already does for its other
  remembered values. When it connects, it reports them; a box whose counter for a live series of
  that code is lower is behind, and starts a new chain (§7, cause "this database is behind a device")
  before its next sale. A missing or unreadable value is no evidence and refuses nothing; a value
  for a series the box no longer has live (after a legitimate restore) is ignored. It works with no
  internet, which the start-up check of §7.6 cannot. Tests: "a box whose counter is behind a device's
  remembered number starts a new chain before its next sale"; "a device with nothing remembered, or a
  retired series, changes nothing".
- **P7 — Warn about what only AEAT knows, before the first sale (C9).** The pre-production readiness
  test already files a record; it also reports a legal-name or tax-id mismatch from AEAT's answer as
  its own outcome. A box clock more than the tolerance away from AEAT's response timestamps raises an
  alert and a till banner — **it does not refuse the sale** (decision D8): the trusted clock's warning
  is deliberately "constructed, never thrown" so it cannot break the sale path
  (`packages/fiscal/src/clock.ts:31-32`), an unreachable time source must never block a sale
  (CLAUDE.md §5), and in Veri\*Factu mode Orden art. 3 switches off the art. 7.f clock duty. Tests:
  "a clock a day ahead raises the alert and the sale goes through"; "the readiness test reports a
  name mismatch".
  - **The setup wizard's fiscal test shows AEAT's reason when it is refused** (owner, 2026-10-03).
    Today its screen (`apps/setup/src/screens/fiscal-test-screen.ts`) receives only accepted,
    rejected or uncertain, and a refusal reads "Correct the certificate or restaurant details". It
    shows AEAT's code and message, in plain words where the code is known (a name that does not
    match the tax id first). Test: "a refused fiscal test shows AEAT's code and message".
  - **A change to what AEAT checks is tested before it is saved** (owner, 2026-10-03, with D2). The
    readiness test (`apps/server/src/fiscal-readiness-runner.ts`) files one sale with AEAT's
    pre-production service from its own throwaway database beside the venue's, never the venue
    database. Setup already refuses to provision without an accepted test (`assertFiscalReady`,
    `apps/server/src/setup-api.ts`), and its fingerprint covers the tax id, the business name, the
    fiscal territory and the certificate. Today only setup sets those; a search found no later route
    that changes them. Any screen or command that later changes one runs the same test and saves only
    on an accepted answer. Whether the test catches a business name AEAT's register does not hold
    depends on the pre-production service checking names, which §13's fifth probe settles.

P1 and P2 are the urgent ones: P1 is the only high-likelihood cause, and without P2 every collision in
C2–C6 is silent. Nothing here waits for the topology work (D7, owner 2026-10-03). **A new chain is
never started merely because AEAT cannot be reached:** a box often starts before the internet does
after a power cut, so it would mint chains routinely, which is the «utilización dinámica del SIF» the
FAQ warns against (asesor Q33). Evidence starts one — P5, P8 or the check of §7.6.

## 6. Detect: what each answer means

Today a stop is classified only by which branch of `drain.ts` fired. After this design:

| Kind                    | Signal                                                                                                                                                                      | What happens                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Divergence**          | A duplicate answer whose stored fingerprint is not ours (P2; today's Route B mismatch); an `Anulada` answer to a sale whose stored fingerprint is not our own cancellation's | The record becomes `divergente`; on the CURRENT installation, a new chain starts (§7)                             |
| **Shared installation** | Warning 2007 on our chain's first record: another system has already filed under our installation number                                                                   | The record is `aceptado_con_errores` (AEAT holds ours); a new chain starts (§7); nothing goes on the adviser list |
| **Ordinary refusal**    | `Incorrecto` with any code but 3000 — bad data on one record, or a cause about us (C9)                                                                                      | The record stays `rechazado`; the chain carries on (§7.5); an alert names the record and AEAT's reason            |
| **Held**                | A cancellation, credit note or substitution naming an invoice whose record is `divergente`                                                                                  | The record becomes `retenido`, is never sent, and goes on the adviser list                                        |
| **Our ordering bug**    | A cancellation refused 3002 because its sale had not been sent; a resent sale meeting our own cancellation                                                                  | Removed by P1 and P2                                                                                              |

**The same sale recorded twice is not a divergence that starts a chain** (owner, 2026-10-03, with
D1). When AEAT's stored record under our key has our issue date, total and tax total (all returned by
the lookup, `RespuestaConsultaLR.xsd`), it is our own sale recorded a second time — for example a
till's retry reaching a rolled-back copy. The record is marked `divergente` with that cause, listed
for the adviser until asesor Q38 is answered, and is not counted by §7.1's step that starts a chain.

**A record naming a refused invoice is sent, not held** (owner, 2026-10-03, with D4). A credit note
is AEAT's own remedy for a refused invoice (developer FAQ v1.3 §17, case 2.a) and cannot reach
another invoice, since AEAT holds nothing under that key; whether AEAT accepts one is §13's fourth
probe. A cancellation of a refused invoice is refused in turn (3002) and stays `rechazado`, so
nothing generated is left unsent (asesor Q40 c). This needs D2: until a refusal stops holding its
chain, such a record is `retenido` instead.

`divergente` and `retenido` are terminal for their one record and never hold others. With D2 below, a
refusal holds nothing either, so **nothing writes `detenido` any more**: the state, `haltSuccessors`,
`haltOpenChainClaims` (which today stops a claimed row whenever its chain holds any `rechazado` or
`detenido` row, `drain.ts:441-445`) and the `fiscal.submission_stopped` alert retire, and
`fiscal.submission_delayed` (records waiting over 4 h or 24 h, `submission-alerts.ts:24-40`) reports
anything waiting, P1's waits included. If the owner declines D2, a refusal still halts its chain as
today and `fiscal.submission_stopped` stays, gaining a link to Fiscal filing (§8).

A divergence on a **retired** installation — an older copy's tail filing after the switch, or sales
made before §7.6's start-up check — is marked `divergente` and listed, and starts nothing.

## 7. Recover: the new chain

### 7.1 Automatic, straight after the divergence is saved — recommended

The new chain exists for its new series. Whatever produced the collision — an older copy, a clone, a
second venue under our tax id — allocates the same numbers we do; staying on our series keeps
colliding with it, and a new series disjoint from every earlier one cannot.

**Recommendation: automatic.** A manual step means the node keeps colliding until a manager acts,
and asks a manager to make a fiscal decision they cannot judge. Automatic also keeps the owner's
rule: no sale ever waits.

The drain saves AEAT's reply first, in its own transaction as today — so AEAT's receipt codes, which
AEAT never sends again, are kept whatever happens next — marking the record `divergente`. Then, in a
**separate** transaction, it:

1. starts the new chain exactly as `runRestoreHooks` does — through P3's minting function
   (`registerSif`, chain head reset), `retireNodeSeriesTx`, `insertNodeSeriesTx` — so the next sale
   is `<series>-<installation>/1` with `PrimerRegistro = S`;
2. writes an audit row in a new `chain_restarts` table (when, the old and new installation numbers,
   the cause, the record and invoice key that diverged, and AEAT's stored fingerprint when there is
   one);
3. raises the `fiscal.chain_restarted` incident (§8).

The step is idempotent: every pass first asks whether the current installation has a `divergente`
record (or an unanswered 2007) newer than its last chain start that the loop guard (§7.7) did not
suppress, and starts the chain if so. A suppressed divergence never starts a chain by itself, even
after the 24 hours pass; only the manual start acts on it. A failure
(for example `series.code_collision` or `series.code_too_long`, both thrown by the series helpers)
is logged and alerted and retried next pass; it never rolls back the saved reply.

A research seat ran step 1 and the sales around it on a live database handle inside one write
transaction, and it committed: the new chain's first record was accepted and the old records stayed
untouched **[ran]**. A sale in flight serialises behind the transaction on the write queue.

### 7.2 The series is read per sale, so nothing restarts

Today the server holds the standard series id in memory (`config.till.seriesId`, from
`WAITRON_TILL_SERIES_ID`, `apps/server/src/till-config.ts:93`), used by the sale paths (`till-sale.ts`,
`bill-payments.ts`, `working-order.ts`), required by `till-config.ts`'s key list, and written or
copied by `trading-config.ts`, `adopt.ts`, `promote.ts` and `boot.ts` (which write it into
`trading.env`), `restore.ts`'s `rewriteTradingEnv`, the mirror bundle and `mirror-bundle-fetch.ts`,
the sealed state, `apps/server/scripts/dev-setup.ts`, `apps/server/scripts/cloud-integration-fixture.ts`,
`.env.example` and `apps/till/README.md`. **[ran]** After a live new
chain, a sale on that id was refused `sale.series_retired`, which no screen words. So this design
reads the node's one live standard series inside each sale's transaction (`readStandardSeriesIdTx`;
credit notes already read theirs that way, `cancel-credit.ts:51`), and `WAITRON_TILL_SERIES_ID`
goes with every copy. No restart, no window in which sales are refused. (The alternative — rewrite
`trading.env` and restart, as mirror promotion does — interrupts service and has two crash windows
that each block sales.)

### 7.3 The old chain's records

Nothing holds the old chain's other records (§6), so they keep filing exactly as they would have:

- **Records AEAT never received are still filed, unchanged.** Each keeps its old installation number,
  old link and old fingerprint, oldest first, with the `Incidencia` flag in the message header
  (Orden art. 16.4; Real Decreto 1007/2023 art. 8.2.a forbids changing a record). AEAT keys by
  invoice, and by its documents appears not to compare a record's link with what it holds (§9.5,
  unmeasured — §13's first probe), so these would be accepted. Asesor question Q34.
- **Records AEAT already holds** come back as duplicates when resent; P2's lookup matches the
  fingerprint and marks them accepted. (Today a same-batch successor AEAT accepted is still halted
  locally, `drain.test.ts:893-897` **[ran]**.)
- **The divergent record itself** stays `divergente`. The customer holds an invoice AEAT cannot take
  under that key. It goes on the **Needs your adviser** list (§8) with the remedy §9.3 describes;
  Waitron files nothing more for it until the owner decides (asesor Q35, Q36).

### 7.4 Cancellations and credit notes after the switch

A cancellation or credit note of an old-chain invoice is recorded on the **new** chain (it uses the
current SIF, `backend.ts:331-357`). For a cancellation AEAT allows that, hedged: «en principio, tanto
un RF de alta de subsanación como un RF de anulación se podrían generar y conservar o remitir a la
AEAT desde un SIF distinto al que expidió la factura original» (in principle, a correction record or
a cancellation record could be made, kept or sent from a system other than the one that issued the
invoice; developer FAQ v1.3 §17, p. 37). P1 makes it wait until the old invoice's own record is
accepted. **[ran]** Without that wait, the fake AEAT refused such a cancellation 3002 and the new
chain stopped again.

For a **divergent** invoice the till still lets staff void, credit or substitute it (owner,
2026-10-03, D4): the order is cancelled and the bill settled as for any other invoice, and the
record is made as usual. It is never sent: AEAT keys every one of them by that invoice's key, which
names the other copy's record there, so a cancellation would cancel the other copy's invoice and a
credit note or substitution would amend it. The drain makes it `retenido` (P1), and the adviser list
shows it beside the invoice it names. Records made before the divergence was found are treated the
same way. The remedy the adviser chooses (§9.3; asesor Q35, Q40) is a later, separate path. Today
the only till action that makes such a record is the cancel of an issued order
(`apps/server/src/cancel-credit.ts`).

### 7.5 An ordinary refusal no longer stops the chain

AEAT's service description says, for a refused new-invoice record, «El registro original no se puede
modificar, por lo que permanecerá inalterado» (the original record cannot be changed and stays as it
is; v1.0.3 §9.1.3, p. 60) and that the correction's link «debe ser con el registro de facturación
inmediatamente anterior (sea de alta o de anulación), por orden cronológico de generación» (must be to
the record generated immediately before it; same, p. 61) — that is, the chain carries on past a
refused record. How the refused invoice is put right depends on the error:

- an error the invoicing regulation covers needs a **credit note**, and the refused record is left
  alone (developer FAQ v1.3 §17, p. 36, «Sobre el caso 2.a)»);
- any other error is fixed by a **correction record** flagged `Subsanacion = S`,
  `RechazoPrevio = X` (same, pp. 36-37, «Sobre el caso 2.b)») — **[measured at AEAT]** such a
  correction of a refused record, linked to the last record AEAT had accepted, came back `Correcto`
  (run 36350894099).

So `haltSuccessors` no longer runs on a refusal: later records file, the refused one stays
`rechazado`, and the alert names it with AEAT's reason. Whether a later record linked to the refused
one is accepted is §13's first probe, so this change waits for it. Building the correction record is
a new record builder — fiscal core — and is **out of this design**, a follow-up the owner gates on
asesor Q37. A new chain does not help a refusal: one caused by our configuration would recur on it.

### 7.6 The start-up check against AEAT

Every box runs it, with a bucket or without (D7). The first filing pass after a start looks up, for each live series,
whether AEAT already holds the next number this node would issue — asking for every month from the
month of the node's newest record to the current month, narrowed to the node's installation. If it
does, the node is behind AEAT: it starts a new chain (cause "this database is behind AEAT") before its
first claim. Sales made before that pass are on the old chain; if they collide they are marked
`divergente` on a retired installation and listed (§6). A failed lookup starts nothing and is retried
next pass. When the check finds the node behind, it also looks up each number the node issued on the
old series since it started, and lists any AEAT holds under another issue date (asesor Q36): AEAT
accepted those, so nothing else would show them.

### 7.7 The loop guard, and the manual start

At most one automatic new chain in any 24 hours. A divergence on the current installation within 24
hours of the last automatic start still marks its record `divergente`, but starts no chain: the
chain carries on filing, each further collision is marked and listed, sales continue, and the
`fiscal.chain_restart_limit` alert asks for support. An administrator can then start one by hand
from that alert, re-authenticating as the `node.promote` action does (password, and the
authenticator code where enrolled; `apps/server/src/promote-api.ts`).

## 8. What the dashboard says

The Alerts screen is the only surface today (`apps/dashboard/src/screens/alerts-screen.ts`); there is
no fiscal screen, and `fiscal.submission_stopped` has no action and can never clear. This design:

- adds a **Fiscal filing** screen (*Envío fiscal*) in the dashboard's Reporting group, straight after
  the VAT return, shown to whoever holds `report.export` as the VAT return is (D6). It lists the
  current chain (installation number, series, last record accepted, how many records wait to be
  sent), the `chain_restarts`, and the **Needs your adviser** list: each `divergente`, `rechazado` and
  `retenido` record with its invoice number, date, amount, and what AEAT holds instead where known;
- rewords `fiscal.registro_rechazado`, retires `fiscal.huella_divergente` and
  `fiscal.duplicado_anulado`, and adds two; the other fiscal alerts that end "Contact support"
  (the environment, flagged-record and reconcile ones) are unchanged. Proposed wording (the plan's
  screen task refines it; `scripts/alert-codes.test.ts` holds both languages):

| Code and cause                                  | English                                                                                                                                                                                                                                             | Spanish                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal.chain_restarted`, a different record    | The tax agency (AEAT) holds a different record for invoice {invoice}. To keep filing, Waitron started a new invoice series, {series}, at {time}. Sales were not interrupted. Your tax adviser needs to review invoice {invoice}: see Fiscal filing. | La AEAT tiene un registro distinto para la factura {invoice}. Para seguir enviando los registros a la AEAT, Waitron ha abierto una nueva serie de facturas, {series}, a las {time}. Las ventas no se han interrumpido. Tu asesor fiscal debe revisar la factura {invoice}: consulta Envío fiscal. |
| `fiscal.chain_restarted`, a shared installation | The tax agency (AEAT) reports that another system has filed invoices under this box's installation number. To keep the two apart, Waitron started a new invoice series, {series}, at {time}. Sales were not interrupted.                           | La AEAT indica que otro sistema ha enviado facturas con el número de instalación de este equipo. Para separarlos, Waitron ha abierto una nueva serie de facturas, {series}, a las {time}. Las ventas no se han interrumpido.                                                                    |
| `fiscal.chain_restarted`, database behind AEAT  | This box's database is older than what the tax agency (AEAT) already holds. To avoid reusing invoice numbers, Waitron started a new invoice series, {series}, at {time}. Sales were not interrupted.                                               | La base de datos de este equipo es más antigua que lo que ya tiene la AEAT. Para no repetir números de factura, Waitron ha abierto una nueva serie de facturas, {series}, a las {time}. Las ventas no se han interrumpido.                                                                     |
| `fiscal.chain_restarted`, database behind the bucket or a device (P5, P8) | This box's database is older than its own backup or than invoices a till has already shown. To avoid reusing invoice numbers, Waitron started a new invoice series, {series}, at {time}. Sales were not interrupted. | La base de datos de este equipo es más antigua que su propia copia de seguridad o que facturas que ya ha mostrado un TPV. Para no repetir números de factura, Waitron ha abierto una nueva serie de facturas, {series}, a las {time}. Las ventas no se han interrumpido. |
| `fiscal.registro_rechazado`                     | The tax agency (AEAT) refused the record for invoice {invoice}: {mensaje} (code {codigo}). Later records are still being sent. This invoice needs correcting: see Fiscal filing.                                                                    | La AEAT ha rechazado el registro de la factura {invoice}: {mensaje} (código {codigo}). Los registros posteriores se siguen enviando. Esta factura debe corregirse: consulta Envío fiscal.                                                                                                      |
| `fiscal.chain_restart_limit`                    | The tax agency (AEAT) again holds records Waitron did not expect, less than a day after Waitron started a new invoice series. Waitron has not started another. Sales continue. Contact support.                                                   | La AEAT vuelve a tener registros que Waitron no esperaba, menos de un día después de abrir una nueva serie de facturas. Waitron no ha abierto otra. Las ventas continúan. Contacta con soporte.                                                                                                |

`fiscal.huella_divergente` and `fiscal.duplicado_anulado` retire as incidents: `fiscal.chain_restarted`
is the one a manager sees, carrying its cause in its params. Before a venue is live a code may be
renamed or deleted freely (CLAUDE.md §3); every copy moves in the same change.

## 9. Putting things right with AEAT

Every quotation was copied from text a research seat extracted from the raw download (`curl`, then
`pdftotext`) and re-checked by a review seat; the provenance is in §15. Spanish first, then plain
English.

### 9.1 Records customers hold that AEAT never accepted must still reach AEAT

> «Y en el caso de SIF VERI\*FACTU, esto se amplía a los RF remitidos, o sea, no pueden quedar RF
> generados sin remitir a la AEAT.» — developer FAQ v1.3 §5, p. 12

In Veri\*Factu mode no generated record may be left unsent.

> «En caso de que alguna incidencia técnica impida la remisión voluntaria en las condiciones
> indicadas se deberá proceder a la remisión de los registros de facturación en cuanto sea posible,
> respetando el orden temporal de generación de los registros de facturación.» — Orden HAC/1177/2024
> art. 16.4, p. 13

After an incident, send as soon as possible, oldest first. The same article also asks for the
`Incidencia` flag, a retry at least every hour, and a visible count of unsent records.

> «Cualquier necesidad de corrección o anulación de los datos registrados deberá ser realizada
> mediante al menos un registro de facturación adicional posterior, de forma que se conserven
> inalterables los datos originalmente registrados.» — Real Decreto 1007/2023 art. 8.2.a), p. 14

Records are never edited; any change is a later record. Hence §7.3: the old chain's unsent records
go out byte for byte.

### 9.2 A refused record: put right by a later record

> «Si el RF generado de la "factura errónea" fuera rechazado por la AEAT […], habría que corregir la
> factura original y generar un RF de alta de subsanación, sin registro previo en la AEAT (ya que el
> RF "original" fue rechazado y no existe en la AEAT). Por lo tanto, este RF de alta de subsanación
> deberá llevar una codificación especial en ciertos campos ('Subsanacion' = "S" y
> 'RechazoPrevio'="X")» — developer FAQ v1.3 §17, pp. 36-37, under «Sobre el caso 2.b)»

For an error the invoicing regulation does not cover, a refused record is fixed with a correction
record flagged `S`/`X`. For an error it does cover (case 2.a, p. 36), the fix is a credit note.

> «X — Independientemente de si ha habido o no algún rechazo previo por la AEAT, el registro de
> facturación no existe en la AEAT (registro existente en ese sistema informático o en algún sistema
> informático del obligado tributario y que no se remitió a la AEAT […])» — Orden annex, list L17,
> p. 31

`X` means "AEAT does not hold this invoice", and expressly covers a record in another of the
taxpayer's systems.

### 9.3 A record AEAT holds that is not ours: three tools, none made for this

- **Correction record**: on the wire it replaces AEAT's copy outright — «El registro remitido
  sustituye completamente al registro de facturación con los nuevos datos recibidos» (validation
  document v1.2.2 annex, OK (4), p. 27) — but AEAT's FAQ limits it to fields the customer does not
  see: «campos "internos", como ciertas codificaciones tributarias […] Estos casos deberían ser MUY
  POCO FRECUENTES» (developer FAQ v1.3 §17, p. 34).
- **Cancellation record**: «Con carácter general, todas las facturas emitidas, en la medida en que
  respondan a operaciones realmente efectuadas (como es el caso habitual) no pueden anularse» (as a
  rule, invoices for sales that really happened cannot be cancelled; developer FAQ v1.3 §17, p. 35) —
  though an invoice never handed to the customer leans towards cancellable (same, p. 37).
- **Credit note**: required «en los casos en que la factura original no cumpla alguno de los
  requisitos que se establecen en los artículos 6 ó 7» (Real Decreto 1619/2012 art. 15.1, p. 19);
  art. 6.1.a, and art. 7.1.a for simplified invoices, require that numbering within a series be
  correlative. A number two real invoices share arguably fails that.

No source covers two real invoices sharing one number. Waitron's proposed handling, per case, for
the asesor to confirm:

| What AEAT holds under our key                                             | Proposed handling                                                                                                                              | Asesor |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The same sale as ours, differing only in link, timestamps or installation | Leave it; record locally that AEAT's copy stands for that key                                                                                  | Q38    |
| A sale that never happened (an old copy's phantom)                        | Cancellation record from the new chain, confirmed by a person, only if no customer received that ticket                                        | Q39    |
| A real invoice from the other copy, while we gave a customer ours         | Our refused record stays unchanged; nothing more is filed until the asesor answers (a credit note naming ours would reach the other invoice)    | Q35, Q36 |

### 9.4 A new chain: what AEAT describes

> «no puede repetirse nunca: por ejemplo, incluso si se formatea el ordenador donde estaba instalado
> un SIF y se reinstala el mismo software de nuevo en ese mismo ordenador, el nuevo SIF así
> constituido debe llevar otro nº de instalación diferente al anterior» — developer FAQ v1.3 §4, p. 10

A reinstall is a new SIF with a new installation number — and so, by Orden art. 7.b/7.c, a new chain
starting with `PrimerRegistro = S`. That is the only "new chain" case AEAT describes. There is no
closing record (the record design has three record types — new invoice, cancellation, event — and
none ends a chain), and no notice to AEAT. Of the duties after an incident (§9.1), the one that bears
on starting a new chain is to justify it if asked: «Las incidencias en la remisión voluntaria […]
deberán ser debidamente justificadas por el remitente si así se lo requiere la Agencia Estatal de
Administración Tributaria» (Orden art. 16.4, p. 13). Hence the `chain_restarts` audit row. In
Veri\*Factu mode the event log and the chain-damage checks do not apply: «en tanto actúen como
«VERI\*FACTU», no les serán de aplicación los artículos 6.b), 6.c), 6.d), 6.e), 6.f), 7.f), 7.h),
7.i), 7.j), 8 y 9 de esta orden» (Orden art. 3, p. 5).

### 9.5 What AEAT checks on receipt

> «Cuando en una remisión de un sistema «VERI\*FACTU» la huella informada no coincida con el cálculo
> realizado por la AEAT, el registro de facturación se marcará como "Aceptado con errores".» — hash
> specification v0.1.2 §7, p. 13

AEAT recomputes each record's fingerprint from that record's own fields, including the previous
fingerprint the record states. The validation document states format rules for the link (§3.1.3
item 18, p. 15); AEAT's error list has link codes (1174, 1175, 1180, 1269) whose wording does not say
whether they check format or content; and 2007 shows AEAT does compare at least the first-record
claim with what it holds. So whether AEAT compares a record's link with the record it actually holds
is **open** — §13's first probe settles it. And: «La respuesta afirmativa […] no implica que los
registros de facturación remitidos sean completamente válidos, ni impide posteriores validaciones»
(Orden art. 16.3, p. 13) — AEAT can walk a chain later.

### 9.6 The lookup can compare chains invoice by invoice

The lookup takes a mandatory year and month, and optionally an invoice number, customer, date or
range, and an installation (service description v1.0.3 §6.4, p. 30; `ConsultaLR.xsd`). For each
invoice it returns the stored record's fingerprint, its link with the previous fingerprint, its
generation time and its state — `Correcto`, `AceptadoConErrores` or `Anulado`
(`RespuestaConsultaLR.xsd`). It returns one current record per invoice and nothing for a refused
attempt — **[measured at AEAT]** `SinDatos` for a refused record (run 36350894099). So it can find
where our chain and AEAT's last agree (§7.6), but cannot rebuild a history.

## 10. Questions only the asesor can answer

Moved on 2026-10-03 to `docs/compliance/asesor-questions.md`, section *Recovering from conflicts*,
as Q33 to Q40, each with its background, a Spanish version to hand over and the default Waitron takes
until answered. What changed in the move:

| Was | Now | Change |
| --- | --- | --- |
| Q1  | Q33 | Asks only whether switching installation number automatically is acceptable; the owner answered that AEAT is not notified |
| Q2  | Q34 | Unchanged in substance |
| Q3  | Q35 | The default credit note naming our invoice is withdrawn: AEAT would apply it to the other copy's invoice under that key. The default is now to file nothing more |
| Q4  | Q36 | Unchanged in substance |
| Q5  | Q37 | Asks which expected refusals are FAQ case 2.a (credit note) and which 2.b (correction record); FAQ §17 already allows the correction record |
| Q6  | Q38 | Adds whether a refused duplicate of a sale AEAT holds counts as unsent |
| Q7  | Q39 | A cancellation is only ever a step a person confirms: Waitron cannot tell a phantom from a real sale it lost |
| Q8  | —   | Dropped: a restore is the reinstall FAQ §4 describes, and continuing from AEAT's last record would reissue numbers printed but never sent |
| Q9  | —   | Dropped: sending late after an incident is settled in `docs/compliance/verifactu-findings.md` §2 |
| Q10 | Q40 | Adds a void of a refused invoice, which the default now sends rather than holds |

## 11. Decisions for the owner

Each has the recommended default this design is written to.

1. **D1 — Automatic or manual new chain. DECIDED (owner, 2026-10-03): automatic,** straight after
   the divergence is saved (§7.1), with the loop guard and a manual start for administrators (§7.7).
   A duplicate that is the same sale recorded twice starts no chain (§6).
2. **D2 — An ordinary refusal no longer stops the chain** (§7.5). **DECIDED (owner, 2026-10-03):
   yes, once §13's first probe shows AEAT accepts a record linked to a refused one;** if it does
   not, D2 comes back to the owner. This changes what is filed after a
   refusal: later records go to AEAT instead of waiting forever.
3. **D3 — The series is read per sale and `WAITRON_TILL_SERIES_ID` goes** (§7.2). **DECIDED
   (owner, 2026-10-03): yes,** rather than a restart.
4. **D4 — Voids, credit notes and substitutions of a divergent invoice.** **DECIDED (owner,
   2026-10-03): the till lets staff make them as usual, and the record is held, never sent** (§7.4),
   until the asesor answers Q35 and Q40. The spec's first choice, refusing them at the till, was
   dropped: it left the order open as owed and pushed staff to work outside the system. A record
   naming a refused invoice is sent (§6).
5. **D5 — The old chain's records keep filing, unchanged, after the switch** (§7.3). **DECIDED
   (owner, 2026-10-03): yes,** subject to asesor Q34 and §13's first probe; either answering against
   it brings D5 back to the owner.
6. **D6 — Where the Fiscal filing section lives** (§8). **DECIDED (owner, 2026-10-03): its own screen
   in the Reporting group, straight after the VAT return, under `report.export`.** It is still shown
   to the owner before it lands. Previously recommended: decided in the plan's screen
   task, shown to the owner before it lands.
7. **D7 — What waits for the topology work.** **DECIDED (owner, 2026-10-03): nothing.** P5 joins the
   plan, carried by a signed bucket record of its own; P6 joins it with a short design first, on whose
   signature fences a box; the start-up check of §7.6 runs on every box and lists numbers reused on
   another date; P8 (devices as witnesses) is added; and no chain is started merely because AEAT
   cannot be reached. Previously recommended: P5 and P6 wait.
8. **D8 — A clock out of tolerance warns, and never refuses a sale** (P7). Recommended: yes.
9. **D9 — Every series code carries its installation number from the first sale** (P3), so receipts
   read like `FS-213192000/1` instead of `FS/1`. Recommended: yes — it is what stops two
   installations for one tax id ever sharing an invoice number.

## 12. What this does not change

`computeHuella`, the chain link, invoice-number allocation, the alta builders (`recordSale`,
`recordCorrection`, `recordSubstitution`) and `registros_facturacion` are untouched: a new chain
writes `registro_sif`, `contadores_instalacion`, `cadenas`, `invoice_series` and the new
`chain_restarts`, never a record, and the first new record goes through the unchanged builder with
`PrimerRegistro = S`. `restore.test.ts:206` already proves a chain started after a restore verifies.
The golden huella block in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
`inmutabilidad.test.ts` pass unedited; research and review seats ran both green (20 of 20) beside the
experiments **[ran]**. The correction record of §7.5 is a new builder and is NOT in this design.

## 13. Probes to run on AEAT's pre-production service first

The design rests on five things not yet measured at AEAT. All are cheap to settle with
the `waitron-io/verifactu` library's live workflow (`live-aeat.yml`), and the plan runs them before
the tasks that depend on them (D2, D5, the recovery):

1. **Does AEAT check a record's link against what it holds?** Send a well-formed new-invoice record
   whose link names an invoice key AEAT does not hold, with a random fingerprint, beside a control
   linked correctly. If AEAT checks, the first gets a refusal or an accepted-with-errors code the
   control does not; if not, both come back `Correcto`. §7.3 and §7.5 assume the second.
2. **What does AEAT answer for a duplicate with different content?** Send an invoice key AEAT holds,
   with another amount. Expected, by the validation annex: 3000 with the stored copy's state. P2
   assumes the reply does not reveal the stored fingerprint, so it always looks up.
3. **Does a new installation number alone make a new chain for AEAT?** Send a first record under an
   installation number that has already filed (the control: expect 2007), and one under a new
   installation number with the SAME software code. If the second also gets 2007, AEAT identifies a
   system by its software code, a new chain in this design would meet 2007 on its first record, and
   §6's shared-installation rule would misfire — Task 7 is then re-cut with the owner. Run
   36350894099 changed both at once (§4 C3).
4. **Does AEAT accept a credit note naming an invoice it refused?** (added 2026-10-03, asesor Q37.)
   Send a record AEAT refuses, then an `R5` naming that invoice's key, beside a control `R5` naming
   an invoice AEAT accepted. If AEAT requires the named invoice to exist, the first is refused and
   the control is not; if not, both come back `Correcto`.
5. **Does the pre-production service refuse a business name its register does not hold for the tax
   id?** (added 2026-10-03, P7.) Send one record with the registered name and one with a different
   name for the same tax id. If it checks, the second is refused or flagged and the first is not; if
   both come back `Correcto`, the readiness test cannot catch a wrong name and P7 needs another way.

## 14. Corrections the research found in the compliance notes

For `docs/compliance/verifactu-findings.md`, each as a dated pointer (historical docs are not
rewritten):

- §1 "Required runtime check" calls the Orden art. 7.i check a legal duty; Orden art. 3 switches it
  off in Veri\*Factu mode. Doing it stays harmless and useful.
- §1 calls warning 2007 a sign of accidental re-provisioning. Measured, a first-record claim under
  an installation that already filed gets 2007, and first records under a new installation number
  and a new software code get none (run 36350894099); whether a new installation number alone
  avoids it is §13's third probe. So 2007 points at a **reused** installation — two copies of one
  node, or a second venue under the same tax id.
- AEAT's online FAQ pages are now dated 21 July 2026; the notes cite 5 December 2025.

## 15. Provenance

All retrieved 2026-10-03 by a research seat with `curl` and extracted with `pdftotext -layout`
(the validation annex's tables also rendered and read visually); checksums are SHA-256, first 16 hex
digits. A review seat re-checked every quotation against the extracted text.

| Document                                                                             | Version / date                                                                                                       | URL                                                                                                                                         | Cited at                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AEAT, *Aclaraciones a dudas de los desarrolladores*                                  | v1.3, 2025-12-04; `73906dc8afbbb9da`, identical to `docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf` | https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf                        | §4 p. 10; §5 p. 12; §17 pp. 34-37                                                                                                                              |
| AEAT, *Validaciones y errores Veri\*Factu*                                           | v1.2.2, 2026-04-08; `426eb926fc098a36`                                                                               | https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf                  | §3.1.3 p. 15; annex p. 27                                                                                                                                      |
| AEAT, error list `errores.properties`                                                | undated; `06519ceb23422bd6`                                                                                          | https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties                           | codes 1174-1269, 2007, 3000-3003                                                                                                                               |
| AEAT, *Descripción del servicio web*                                                 | v1.0.3, 2025-07-28; `b3570f6a308ce98a`                                                                               | https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf                 | §3 p. 10; §6.4 p. 30; §9.1.3 pp. 60-61                                                                                                                         |
| AEAT, *Especificaciones técnicas … huella o hash*                                    | v0.1.2, 2024-08-27; `f4334c254bb875b4`                                                                               | https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf | §7 p. 13                                                                                                                                                       |
| AEAT schemas `ConsultaLR.xsd`, `RespuestaConsultaLR.xsd`, `SuministroInformacion.xsd` | v1.0                                                                                                                 | https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/                                             | §3; §5 P1, P2; §9.6                                                                                                                                                  |
| Orden HAC/1177/2024 (BOE-A-2024-22138), consolidated                                 | `a0090109d56c29c1`                                                                                                   | https://www.boe.es/buscar/pdf/2024/BOE-A-2024-22138-consolidado.pdf                                                                         | art. 3 p. 5; art. 7; art. 16 p. 13; annex L17 p. 31                                                                                                            |
| Real Decreto 1007/2023 (BOE-A-2023-24840), consolidated                              | last modified 2025-12-03; `34418589f3c5684c`                                                                         | https://www.boe.es/buscar/pdf/2023/BOE-A-2023-24840-consolidado.pdf                                                                         | art. 8.2.a p. 14                                                                                                                                               |
| Real Decreto 1619/2012 (BOE-A-2012-14696), consolidated                              | last modified 2026-03-31; `a1c2a0fdc4e936a3`                                                                         | https://www.boe.es/buscar/pdf/2012/BOE-A-2012-14696-consolidado.pdf                                                                         | art. 6.1.a p. 13; art. 7.1.a p. 15; art. 15.1 p. 19                                                                                                            |
| Live pre-production run 36350894099, `waitron-io/verifactu` workflow `live-aeat.yml` | 2026-09-27                                                                                                           | https://github.com/waitron-io/verifactu/actions/runs/36350894099                                                                            | §4 C3 (2007 on a repeated first record; `Correcto` under a new installation number and software code); §7.5 (`S`/`X` correction `Correcto`); §9.6 (`SinDatos`); §14. Read with `gh run view --log` |
