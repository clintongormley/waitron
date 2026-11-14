# W41s-9: the evidence behind three kinds of tax-filing alert, on Fiscal filing — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development`. Dispatch each task as
> `subagent_type: "implementer"`. Steps use checkbox (`- [ ]`) syntax. Every task is test-first:
> write the named failing check, run it, see it fail for the stated reason, then write the smallest
> code that passes it.

**Status:** reviewed, and cut to the watcher's answer of 2026-11-14 03:20 (lane L questions.md,
"W41s-9 evidence step: both cuts and (a), but no alert keeps 'Contact support'"): no chain-check
section, one merged record lookup, nothing built for wrong-environment refusals, and the three
alerts left without a page reworded so none says "Contact support". Originally Written on `feat/w41s-9-filing-evidence` from `main` at
`51bd22780c`. No product code was written to produce it; what was read and the two probes that were
run are listed at the end.

**Size, stated first.** About **280 lines of production code** after the watcher's cuts, and about
**300 lines of tests**, plus about 40 lines of guide prose and documentation edits. No migration, no
new table, no generated files. Cut on the watcher's word (03:20): the saved predecessor check
(`chain.verification_failed`) gets no section on the page, because it needs a stored record to be
tampered with, which the append-only triggers stop; its alert is reworded instead (Task 2).

## The ask, and who approved it

The owner chose, on 2026-11-10, "Retire, fold into screen (Recommended)", answering "Is one shared
filing screen the right home for the evidence behind tax-filing alerts …?", whose option 1 reads
"fold their evidence into the filing screen, adding the three missing kinds later as a small step".
Record: `~/waitron-campaign-shared/desk/done/20261110-0946-L-a1089.md`, lines 25–27. The three
kinds are integrity warnings, mismatched reply lines and wrong-environment refusals.

## Should this exist?

- **The need.** Four alerts (three after the cut) end in "Contact support" or say nothing about where to look
  (`apps/dashboard/src/i18n/alert-messages.ts`, keys `fiscal.respuesta_descuadrada`,
  `fiscal.record_flagged`, `fiscal.record_totals_disagree`, `chain.verification_failed`). The facts
  behind them sit only in the `incidents` table's `params`, which no screen reads.
- **The simplest thing that meets it.** One more read in the existing Fiscal filing route, one
  more section on the existing page, and three bell links. No new route, no per-alert panel, no
  session fence, no action. Considered and rejected: porting the four retired branches (7,000–9,600
  lines each; the owner retired them); changing only the alert wording (the person still could not
  see which invoice or what AEAT sent back).
- **What stays unavailable.** Any repair or decision. Wrong-environment evidence (see the decision
  below). A fingerprint refusal's evidence beyond what its alert already says (see Limits).

## Decided: nothing for wrong-environment refusals (watcher, 2026-11-14 03:20, option (a))

**By the trace below, both environment refusals are unreachable only while every setup path stamps
the database's environment before its first record (the stamp sites listed below); the start check
does not cover the rest, and this plan builds nothing for them.** Traced, except where a test is
named:

- A record's environment is the process's `config.environment` (`apps/server/src/boot.ts:3199`,
  `recordGeneration.environment`), and the drain compares it with the same value
  (`apps/server/src/boot.ts:4179`, `drain.ts:698-711`).
- A start whose environment differs from the database's stamp is refused before anything runs
  (`apps/server/src/deployment-guard.ts:27-31`, called at `boot.ts:1307`). Every path that creates a
  venue database stamps it before any record exists: first setup
  (`packages/provisioning/src/first-setup-command-deployment.ts:275`), provisioning
  (`apps/server/src/provision.ts:141`), adoption (`apps/server/src/adopt.ts:235`); a restore of a
  backup from the other environment is refused (`apps/server/src/restore-gate.ts:20`).
- The start check over an unstamped database (`apps/server/src/deployment-guard.ts:13-25`) looks
  at the records only on a production box, and refuses only preproduction records or records with
  no environment. A reviewer's throwaway test showed a test box over an unstamped database holding
  production records, or records with no environment, starts normally; production over unstamped
  production records also starts (`apps/server/src/deployment-guard.test.ts:111`).
- `fiscal.environment_unknown` needs a record with no environment. The only writers of
  `registros_facturacion` are `chain.ts:264`, whose `entorno` is typed non-null
  (`chain.ts:71,78`, `registro-row.ts:54`), and the handover return
  (`handover-return.ts:374`), which copies rows another box wrote the same way. Only test fixtures
  write a null.

The watcher chose (a): build no evidence for them, record this trace in the backlog entry (Task 4),
and change only the two alerts' wording so neither says "Contact support" (Task 2). The option not
taken, for the record: one more query, one more list and two bell links, about 50 production lines.

## What the page already shows (no change)

- **`fiscal.huella_divergente`**, the first integrity code the brief names, is already a filing
  case: both the drain (`drain.ts:1899`) and reconciliation (`reconcile-conflicts.ts:12`, via
  `reconcile.ts:191`) open one, the case table shows it with AEAT's line and both fingerprints, and
  its bell link exists (`packages/fiscal-verifactu/src/alerts.ts:20`).
- Filing cases, the identity-conflict box, sending progress, held records and possibly missing
  history (`filing-overview.ts`, `dashboard/fiscal-filing-screen.ts`).

## What each kind really is, and what the box retains

All three are rows in `incidents` (`packages/db/src/schema/incidents.ts`), with `code`, `params`,
`sale_id` and `detected_at`. At most one OPEN row exists per source, device, code and sale
(`incidents_open_dedup`), so a repeat while one is open keeps nothing new. Reading `incidents` from
the fiscal module has a precedent: `packages/fiscal-verifactu/src/clock-stop-incidents.ts:44`.

1. **Mismatched reply lines — `fiscal.respuesta_descuadrada`** (warning). Raised by
   `persistResponse` (`drain.ts:1507-1517`) when AEAT's reply has a different number of lines from
   the records sent. Params (`errors.ts:215`): `registroIds` (the records sent, in order), `csv`
   (the submission's code), `lineasRespuesta` (each line: invoice number and date, operation,
   status, code, AEAT's message). `sale_id` is the first record's sale. **What happens to the
   records:** each unmatched record goes back to waiting with a later retry time
   (`awaitReadableAnswer`, `drain.ts:1666-1673`), except a held chain's hourly probe, which skips
   that update and stays held until its next probe an hour later (`drain.ts:1654-1656`, `1666`;
   interval `drain.ts:74`, `1088`). Each one also raises a "status unknown" alert
   (`fiscal.estado_desconocido`, `drain.ts:1674-1681`; records of one sale share one while it is
   open, `incidents_open_dedup`). A record waits while an earlier record on its chain is still
   waiting for its retry or being sent (`claimBatch`, `drain.ts:658-666`), and when it is claimed
   it is held instead of sent if an earlier record on its chain is held (`haltOpenChainClaims`,
   `drain.ts:788-877`, the check at `848-853`). **Limit:** while the alert is open, a later
   mismatched reply whose first record belongs to the same sale keeps none of its lines
   (`errors.ts:210-213`), so the lines shown are the first kept, not necessarily the latest reply.
2. **Local validation warnings — `fiscal.record_flagged` and `fiscal.record_totals_disagree`**
   (warnings). Raised by `attemptAppend` after the record is written (`chain.ts:283-296`), so the
   record exists and is sent like any other; the drain never reads incidents. Params: `fields` and
   `codes`, paired by position, no values (`errors.ts:135,142`). There is **no record id**, but
   `detected_at` is the record's own generation instant (`chain.ts:318`) and the stored generation
   time is that instant cut to the whole second (probe 1 below). So the record is the one record of
   `sale_id` whose generation time equals `detected_at` cut to the second; when there is not
   exactly one such record, the page names none.
3. **Saved predecessor-check issues — `chain.verification_failed`** (error, a core code). **Cut
   by the watcher: no section, no bell link; Task 2 rewords its alert only.**
   Recorded when an invoice is written and the check of the last two records on the chain
   (`verify.ts:41-106`) finds a problem; the new invoice is still recorded
   (`packages/core/src/record-sale.ts:203`, and the same in `record-correction.ts`,
   `record-void.ts`, `record-substitution.ts`, `fiscal-verifactu/src/record-remedy.ts:177-193`).
   Params (`packages/core/src/errors.ts:146`): `issues[]`, each `issueCode`
   (`predecessor-hash-mismatch`, `predecessor-missing`, `predecessor-link-mismatch`), `recordId`
   (the earlier record checked) and `issueParams` (`expected`, `found` fingerprints, or none). It
   checks two records, never the whole chain.

**Not part of this step — `fiscal.fingerprint_mismatch`.** It refuses an invoice before anything is
written (`chain.ts:209`); its incident carries no params (`errors.ts:127`) and no sale
(`packages/core/src/incidents.ts:38-47`). The page could add nothing its alert does not already
say, and its alert wording is pinned by `apps/dashboard/src/i18n/fingerprint-refusal.test.ts:26-35`,
so it stays as it is.

## Decisions this plan makes (reviewable)

- **Open alerts only.** The section lists alerts of its three codes (`fiscal.respuesta_descuadrada`,
  `fiscal.record_flagged`, `fiscal.record_totals_disagree`) not yet marked handled, newest first,
  like the bell. Once handled, a warning leaves the page; the bell's Handled tab keeps it.
- **Bounded.** The route's existing limit applies (200; none for the export), with a total count, as
  the case table does. `fiscal.record_flagged` can be raised on every sale (a missing IPSI regime
  code is a real local warning, `chain.validation-warnings.test.ts:125`), so the bound is real.
- **No bound values grow with the data.** Every association query repeats the listed selection as
  a `with listed as (… limit …)` clause and reads ids out of `params` with `json_each`; it never
  binds a list of ids (SQLite's bound-value limit; CLAUDE.md §4's `insertInChunks` rule).
- **Fields named, never copied.** Each view is built from named fields; `refExterna` and the
  issuer's tax number from AEAT's lines are dropped, as `filing-overview.ts:33-38` does for cases.
- **Tables named through drizzle objects** (`${incidents}`, `${registrosFacturacion}`,
  `${envios}`) inside `sql`, so A1308's renames follow without editing strings.

## File map

| File | Change |
| --- | --- |
| `packages/fiscal-verifactu/src/filing-warnings.ts` | new: `readFilingWarnings(tx, { limit })` |
| `packages/fiscal-verifactu/src/filing-warnings.test.ts` | new |
| `packages/fiscal-verifactu/src/filing-overview-types.ts` | `FilingWarnings` and its views; `FilingOverviewAnswer` gains `warnings` |
| `packages/fiscal-verifactu/src/filing-overview-routes.ts` | adds `warnings` to the answer |
| `packages/fiscal-verifactu/src/filing-overview-routes.test.ts` | one new case |
| `packages/fiscal-verifactu/src/alerts.ts`, `alerts.test.ts` | three bell links |
| `apps/dashboard/src/i18n/alert-messages.ts` | three alerts point to the page; three more lose "Contact support" |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` | new "Warnings" section |
| `packages/fiscal-verifactu/src/dashboard/strings.ts` | EN and ES strings |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.test.ts`, `.a11y.test.ts` | new cases |
| `packages/fiscal-verifactu/test/fiscal-filing-browser-fixture.ts` | one warning of each kind |
| `apps/server/src/guide/en/fiscal-filing.md`, `es/fiscal-filing.md` | `{#warnings}` section |
| `docs/backlog.md`, `docs/backlog/self-service-refusals.md` | stale entries |

Not touched: `registros_facturacion`, its triggers, the hash and chain code, invoice numbering, the
drain, `filing-overview.ts` and its tests.

## Task 1: the read model

**Files:** `filing-warnings.ts`, `filing-warnings.test.ts`, `filing-overview-types.ts`.

Types (in `filing-overview-types.ts`, type-only, browser-safe):

```ts
export interface WarnedRecordView {
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  tipoRegistro: string;
  /** Its sending state now; null when it has none. */
  estado: string | null;
}
export interface ReplyMismatchView {
  detectedAt: string;
  csv: string | null;
  /** The records sent, in the order sent. */
  sent: WarnedRecordView[];
  /** AEAT's lines, in AEAT's order. */
  lines: {
    numSerieFactura: string;
    fechaExpedicionFactura: string;
    tipoOperacion: string | null;
    estado: string | null;
    codigo: number | null;
    mensaje: string | null;
  }[];
}
export interface RecordWarningView {
  detectedAt: string;
  kind: "totals" | "flagged";
  fields: string[];
  codes: string[];
  /** Null unless exactly one record of the sale was generated at that second. */
  record: WarnedRecordView | null;
}
export interface FilingWarnings {
  replyMismatches: ReplyMismatchView[];
  recordWarnings: RecordWarningView[];
  /** Open alerts of these three codes, listed or not. */
  total: number;
}
```

Queries (one transaction, three queries): the listed open incidents of the three codes
(`acknowledged_at is null`, `order by detected_at desc, id`, `limit`); their count; and ONE record
lookup (the watcher's merge) returning, for each listed incident, its candidate records with the
incident id beside each: for a reply mismatch the records named by `json_each(params,
'$.registroIds')` with `json_each.key` as their order, for a validation warning every record of its
`sale_id` (order null); joined to `registros_facturacion` and left-joined to `envios` for the state.
Matching a warning to its record happens in TypeScript: `Math.floor(detectedAt / 1000) ===
Math.floor(generated / 1000)`, exactly one match or null.

- [ ] **Failing tests first**, in `filing-warnings.test.ts` with `useVenueDb`, each incident made by
  the real path, not inserted by hand:
  - a reply mismatch made by `drain` with a fake client answering two records with one line (copy
    the setup of `drain.cases.test.ts:1447` "reply lines are paired…"): `sent` lists both records
    in order with `estado: "pendiente"`, `lines` holds AEAT's one line, `csv` is the submission's.
  - a flagged record made by `appendToChain` with an IPSI line and no regime code (as
    `chain.validation-warnings.test.ts:125`): `kind: "flagged"`, its `fields`/`codes`, and
    `record` names that invoice.
  - a second record of the same sale generated in the same second: `record` is null for that
    warning (the exactly-one rule).
  - a record of a different sale generated in the same second as the flagged record: `record`
    still names the flagged invoice, never the other sale's record (matching stays within the
    warning's `sale_id`).
  - an open `chain.verification_failed` incident is NOT listed and not counted in `total` (the
    section covers three codes only).
- an alert marked handled (`markIncidentHandled`) is not listed; `total` counts open ones only.
  - `limit: 1` with two open warnings lists the newer and reports `total: 2`.
  - a key-shape case, as `filing-overview.test.ts:370-430` does: every key of every view is named
    in the expected lists (no `refExterna`, no issuer tax number).
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-warnings.test.ts`;
  see each fail because `filing-warnings.ts` does not exist.
- [ ] Write `filing-warnings.ts` and the types. Run the file again until green.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  (must pass unedited) and `pnpm exec vitest run scripts/dashboard-browser-purity.test.ts scripts/module-seams.test.ts scripts/write-path-tables.test.ts`.
- [ ] Commit (`git commit -s`).

## Task 2: the route, the bell links and the alert wording

**Files:** `filing-overview-routes.ts`, `filing-overview-routes.test.ts`, `alerts.ts`,
`alerts.test.ts`, `apps/dashboard/src/i18n/alert-messages.ts`.

- [ ] **Failing tests first:**
  - `filing-overview-routes.test.ts`, new case: a manager's answer carries `warnings` with the
    shape of Task 1 (one seeded flagged record), and `cases=all` reads it with no limit (spy on
    `readFilingWarnings` as the file already spies on `readFilingOverview`).
  - the existing case "refuses a supervisor, who may view reports but not export them"
    (`filing-overview-routes.test.ts:78-85`), which already asserts `readFilingOverview` was not
    called (`:84`), also asserts `readFilingWarnings` was not called.
  - `alerts.test.ts`: **an existing assertion this plan changes.** The whole-shape pin of
  `FISCAL_ALERTS` gains three entries (no entry is removed or altered), each
  `{ prefix, area: "fiscal", permission: "fiscal.view", screen: "fiscal-filing" }` for
  `fiscal.respuesta_descuadrada`, `fiscal.record_flagged` and `fiscal.record_totals_disagree`; its
  title names the three. `chain.verification_failed` gets no claim (cut).
  - Any test pinning the six alerts' wording changes to the new wording below (the watcher's 03:20
    answer changes what they say); list each under "Changed test checks" in the PR.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview-routes.test.ts src/alerts.test.ts`;
  see both fail.
- [ ] Route: inside the existing transaction, after `readFilingOverview`, call
  `readFilingWarnings(tx, { limit })` and add `warnings` to the answer. Add the three claims.
- [ ] Alert wording, EN and ES, replacing "Contact support." or adding the pointer (ES page name
  "Remisión a la AEAT", as slice 1's keys use):
  - `fiscal.respuesta_descuadrada`: keep the sentence, replace "Contact support." with "The records
    sent and AEAT's lines are on Fiscal filing." / "Los registros enviados y las líneas de la AEAT
    están en Remisión a la AEAT."
  - `fiscal.record_flagged`: "An invoice record has something the tax agency (AEAT) accepts, though
    it may point it out. The record went out as usual; the invoice and the fields involved are on
    Fiscal filing." / "Un registro de facturación tiene algo que la AEAT acepta, aunque puede
    señalarlo. El registro se ha enviado como siempre; la factura y los campos afectados están en
    Remisión a la AEAT."
  - `fiscal.record_totals_disagree`: append "The invoice is on Fiscal filing." / "La factura está en
    Remisión a la AEAT."
  - **Reworded only, no page link** (watcher 03:20: what happened, whether sales and filing carry
    on or stop, from the code, and what the person can do themselves; change nothing else):
  - `chain.verification_failed`: "When an invoice was recorded, Waitron's check of the invoice
    record before it found a problem. The invoice was still recorded, and sales and sending to the
    tax agency (AEAT) carry on. Keep the box running and note when this appeared." / "Al registrar
    una factura, la comprobación de Waitron del registro anterior ha encontrado un problema. La
    factura se ha registrado igualmente, y las ventas y los envíos a la AEAT continúan. Mantén el
    equipo encendido y anota cuándo ha aparecido esto." Receipts: the sale is still recorded
    (`packages/core/src/record-sale.ts:203`); the drain never reads incidents (`drain.ts`).
  - `fiscal.environment_mismatch`: "An invoice record was made for the tax agency's
    {recordEnvironment} service, but this box sends to {hostEnvironment}. That record and the later
    ones on its chain are kept on this box and not sent; sales carry on. Keep the box running and
    note when this appeared." / "Un registro de facturación se creó para el servicio de
    {recordEnvironment} de la AEAT, pero este equipo envía a {hostEnvironment}. Ese registro y los
    posteriores de su cadena se guardan en este equipo y no se envían; las ventas continúan. Mantén
    el equipo encendido y anota cuándo ha aparecido esto." Receipts: the record and its chain's later
    ones are skipped (`drain.ts:693-716`, `blockedSifIds`) and the record stays waiting.
  - `fiscal.environment_unknown`: the same shape: "An invoice record does not say which tax agency
    service it was made for. That record and the later ones on its chain are kept on this box and
    not sent; sales carry on. Keep the box running and note when this appeared." / "Un registro de
    facturación no indica para qué servicio de la AEAT se creó. Ese registro y los posteriores de su
    cadena se guardan en este equipo y no se envían; las ventas continúan. Mantén el equipo
    encendido y anota cuándo ha aparecido esto."
  - Implementer: verify each "carry on / not sent" sentence against the cited lines before writing
    it; if the code says otherwise, stop and report rather than change the sentence's meaning.
- [ ] Run the two files again, then `pnpm exec vitest run scripts/alert-codes.test.ts scripts/english-only.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts`
  (they read codes and areas only; they must pass unedited).
- [ ] Commit.

## Task 3: the Warnings section on the screen

**Files:** `fiscal-filing-screen.ts`, `strings.ts`, `fiscal-filing-screen.test.ts`,
`fiscal-filing-screen.a11y.test.ts`, `test/fiscal-filing-browser-fixture.ts`. Read
`docs/developers/design-system.md` and `conventions-ui.md` first.

Layout: a section **Warnings** / **Avisos** (`aria-labelledby`, `data-test="warnings"`) between
**Filing cases** and **Possibly missing history**. When `warnings.total` is 0 it shows one muted
line, "No open warnings." / "No hay avisos abiertos." Otherwise up to two lists, each shown only
when it has a line, built like slice 1's history lists (`historyList`, `field`, `aeatWords`, one
`wt-disclosure` headed "Technical details" per line). When `total` exceeds what is listed, a muted
line says "Showing the newest {shown} of {total}. Export them to see every one."

1. **AEAT answers that did not match what was sent** / **Respuestas de la AEAT que no cuadran con
   lo enviado**. Line: "AEAT answered {sent} records with {lines} lines, so Waitron applied none of
   them." Muted: "Seen {time}". **What happens now:** "Waitron sends each record again later, unless
   an earlier record on its chain is on hold, which puts it on hold too. A record that was already
   on hold stays on hold and is tried again an hour later. The state of each one now is below."
   (receipts: sent again, `drain.ts:1666-1673`; held behind an earlier held record,
   `drain.ts:848-853`; an on-hold record stays on hold, `drain.ts:1666`, retried after
   `BRAKE_PROBE_INTERVAL_MS`, `drain.ts:74`, `1088`). Technical details: the
   submission code (`csv`); "Records sent": each "{number} · {date} · {state now}", state through
   the existing `fiscal_filing.record_state.*` strings; "AEAT's lines": each "{number} · {date} ·
   {operation} {status} {code}" with the message in `aeatWords`; and the note "These are the lines
   AEAT gave the first time while this warning is open; a later answer may differ."
2. **Invoices with a warning from Waitron's own check** / **Facturas con un aviso de la
   comprobación de Waitron**. Line, totals: "The totals of invoice {number} ({date}) do not match its
   tax lines. AEAT accepts it; check that sale's prices." Line, flagged: "Invoice {number} ({date})
   has something AEAT accepts but may point out." With no record identified: "An invoice recorded at
   {time} …" (same two endings). Muted: its state now. Technical details: each field beside its
   code, from the paired `fields`/`codes`.

No buttons, no colour beyond existing tokens, no new primitive.

- [ ] **Failing tests first** in `fiscal-filing-screen.test.ts` (fixture gains one warning of each
  kind; the a11y file's `EMPTY` gains `warnings: { replyMismatches: [], recordWarnings: [],
  total: 0 }`):
  - each list renders its line in English and Spanish, with the invoice number, and its Technical
    details hold the raw values (codes, AEAT's words inside `q[lang=es]`);
  - an unidentified record warning says "An invoice recorded at …";
  - an empty `warnings` shows only "No open warnings." and no list;
  - `total` above the listed count shows the bounded line.
  - a11y: the existing two states plus the details open, both themes, phone width, as the file does.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts src/dashboard/strings.test.ts`;
  see the new cases fail. Check memory headroom first (`memory_pressure | grep free`, well above 15%
  free beside another session): these run real Chromium.
- [ ] Write the section and the strings until green.
- [ ] Guards: `pnpm exec vitest run scripts/english-only.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/native-form-fields.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts`.
- [ ] **Look at it:** screenshots of the fixture page with every list and one Technical details
  open, EN and ES, light and dark, 1280 and 390 wide, saved untracked under `.screenshots/` in the
  worktree, never committed; shown to the owner before landing.
- [ ] Commit.

## Task 4: guide and documentation

**Files:** `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md`,
`docs/backlog.md`, `docs/backlog/self-service-refusals.md`.

- [ ] Guide, EN and ES, a section `## Warnings {#warnings}` / `## Avisos {#warnings}` after
  `{#cases}`: what each of the two lists means in one or two sentences, that nothing on the page
  changes a record, that handled alerts leave the list, and that the export carries every warning.
  Only what changes what staff do (CLAUDE.md §3: no corner cases the code handles). Update the
  intro's "which records need a decision" sentence to mention warnings.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] `docs/backlog.md`, the three A1089 entries ("as one small step"):
  - reply and integrity: the evidence is on Reporting → Fiscal filing (this PR), and the bell's
    alerts open it; what remains is a persistent repair or decision route, which needs its own owner
    decision; the lines shown for a reply are the first kept while the alert is open.
  - integrity: also say that `fiscal.fingerprint_mismatch` adds nothing to the page (no record, no
    params) and keeps its alert, and that `chain.verification_failed` has no section (it needs a
    tampered stored record, which the append-only triggers stop; watcher 2026-11-14 03:20) and its
    alert was reworded without "Contact support".
  - environment: record the trace from this plan's decision section (with its receipts, labelled
    traced, not run, with the four stamp sites `provision.ts:141`, `adopt.ts:235`,
    `first-setup-command-deployment.ts:275`, `restore-gate.ts:20`), that no evidence was added on
    the watcher's (a) of 2026-11-14 03:20, and that both alerts were reworded without "Contact
    support".
- [ ] `docs/backlog/self-service-refusals.md`: under `### fiscal.respuesta_descuadrada`,
  `### fiscal.record_flagged` and `### chain.verification_failed`, a "Reworded 2026-11-14" line as
  slice 1 added for its codes; under `#fiscal-reply` and `#fiscal-integrity`, replace "goes on
  Reporting → Fiscal filing as one small step" with what landed and what remains.
- [ ] Check the guide's word list for this page in `docs/developers/products.md` only if a product
  name appears (none should).
- [ ] Commit, then hand the branch to `/finish-branch`.

## Limits this step leaves (none needs new storage to state)

- A reply's later mismatched lines are not kept while its alert is open (`errors.ts:210-213`).
- A mismatched reply also raises a "status unknown" alert (`fiscal.estado_desconocido`) for each
  record it leaves unanswered (`drain.ts:1674-1681`; records of one sale share one while it is
  open). Those alerts have no link to the page (`alerts.ts` claims no screen for that code) and this
  step adds none.
- A sale's later validation warning is lost while an earlier one of the same code for that sale is
  still open: `raiseWarning` (`chain.ts:306-320`) calls `recordIncident`, whose insert does nothing
  on a conflict (`packages/core/src/incidents.ts:103-116`) with the one-open-row-per-source,
  device, code and sale index (`packages/db/src/schema/incidents.ts:69-76`). A reviewer's throwaway
  test flagged an invoice and then its cancellation in the same sale; only one incident was kept,
  so the page shows the first record's warning only.
- A validation warning keeps field names and codes, never values (`errors.ts:135`).
- A predecessor check's findings are not shown (cut); its alert says what happened and that sales
  and filing carry on.
- A fingerprint refusal keeps only its time and till.
- Anyone with `fiscal.view` but not `report.export` sees these alerts but cannot open the page, as
  for slice 1's links.

## Sizes

| Task | Production lines | Test lines |
| --- | --- | --- |
| 1. Read model | ~110 | ~170 |
| 2. Route, links, wording | ~40 | ~40 |
| 3. Screen and strings | ~130 | ~90 |
| 4. Guide and docs | prose only | 0 |

## What was read and run to write this plan

Read: `filing-overview.ts`, `filing-overview-types.ts`, `filing-overview-routes.ts`,
`filing-states.ts`, `alerts.ts`, `errors.ts:120-300`, `chain.ts:180-320`, `drain.ts:60-100`,
`580-720`, `1360-1740`, `verify.ts`, `record-remedy.ts:165-195`, `reconcile.ts:175-200`,
`reconcile-conflicts.ts`, `dashboard/fiscal-filing-screen.ts`, the core `incidents` schema and
`recordIncident`, `record-sale.ts:190-225`, `deployment-guard.ts`, `deployment.ts`, the boot lines
cited, `alert-messages.ts`, the alert tests, the backlog entries and audits, and the retired
branches' read code (`git show 3b8431caa93e:…/environment-evidence.ts`,
`65774b43170:…/integrity-evidence-association.ts`). Taken from them: an incident's `registroId`
or `sale_id` leads to the record; a validation warning carries no record id. Not taken: their
screens, session fences and admission machinery.

Run:

1. `formatDateTime(new Date('2026-11-14T10:00:00.789Z'), 60)` from `@waitron/verifactu` 0.2.1's
   `dist/format.js` printed `2026-11-14T11:00:00+01:00`, which parses back to
   `2026-11-14T10:00:00.000Z`: a stored generation time is the instant cut to the whole second, so
   an incident's `detected_at` with milliseconds would not match it without the cut.
2. `git diff --stat` of each retired branch against its merge base, to see what each built.
