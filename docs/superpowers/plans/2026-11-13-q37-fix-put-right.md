# Q37-FIX: put a refused invoice right from the Fiscal filing page — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development`. Dispatch each task as
> `subagent_type: "implementer"`. Every task is test-first: write the named failing check, run it,
> see it fail for the stated reason, then write the smallest code that passes it. Fiscal: one PR,
> the owner lands it.

**Status:** plan for review, 2026-11-13. Written in worktree
`waitron-feat-q37-fix-put-right` (branch `feat/q37-fix-put-right`) on `main` at `71baa3c8d0`. No
product code was written. What was run is marked **(run)**; everything else is **(read)**.

## Read this first: the item is bigger than its text assumes

The item assumes today's corrective-invoice writer issues the right corrective for a simplified
invoice. It issues one form only, and that form is not the one the owner's answer names:

- The writer always files an R5 **by differences** (`TipoRectificativa: "I"`), its amounts being
  whatever lines and total the caller sends (`packages/fiscal-verifactu/src/backend.ts:570-573`,
  whose comment says a replacement, `"S"`, would also need `ImporteRectificacion`).
- The owner's answer to Q37(b), "yes", was to «¿basta una **rectificativa por sustitución** con la
  razón social correcta?» — a *replacement* corrective (`docs/compliance/asesor-questions.md`,
  Q37 (b) and its answer).
- For a refused invoice AEAT holds nothing under the original's number (Q37 "Why it matters";
  A1407 findings §60.8). So the corrective is the only record AEAT will ever hold for that sale.
  What amounts it carries therefore decides what AEAT sees:
  - a **zero difference** (amounts unchanged, only the date or name put right): today's route
    answers `500 server.internal` and writes nothing **(run**: a throwaway copy of
    `record-remedy-corrective-http.test.ts` sending `total: "0.00"` and one zero line; deleted
    afterwards**)**;
  - a **positive copy** of the original's lines and total: today's route writes an R5 for `12.10`
    and answers 200 **(run**, same probe, the control that shows the harness worked**)**. AEAT then
    holds the sale once, but the VAT return counts it twice, because it sums every sale that is not
    voided and not an F3 replacement, correctives included ("corrections netted",
    `packages/reporting/src/vat-return.ts:10-16`, `activeSalesClause` at
    `packages/reporting/src/business-day.ts:217-220`) **(read)**;
  - a **whole credit** (minus the original): today's writer supports it (`wholeInvoice`,
    `packages/core/src/record-correction.ts:66-77`), but AEAT then holds only a negative invoice
    for a real sale, and the sale has to be rung again — two documents, not "one replacement".

So the corrective's content is a decision, not a build detail (question 1 below). **Simplest cut:**
Tasks 1 and 2 below are needed whatever the answer and are about 300 lines of production code
together. Task 3 (what the corrective carries) is written for the recommended answer and adds about
80–100 lines; it runs only once the watcher answers question 1.

## Outcome

When this lands, an administrator — or a manager who signs in as one from the page — can open a case
on **Reporting → Fiscal filing** that AEAT refused for a future issue date on a simplified invoice,
choose **Put this right**, read exactly what Waitron will send, confirm, and Waitron issues the
corrective invoice and closes the case. A case Waitron cannot put right says why: a full invoice
needs a corrective Waitron cannot issue yet (A1407), or no fix is known for that refusal yet.

## Scope and non-scope

In scope: switch on `corrective-invoice` and `record-correction` in `ENABLED_REMEDIES`
(`packages/fiscal-verifactu/src/record-remedy-routes.ts:22`); hold both behind the start-of-day time
check; let the page name a case by its record, as it already does; decide, from what the page
already reads, which fix fits a case; the panel action with a confirmation and in-place
administrator sign-in; the page's "cannot correct" line; the guide's cases section in English and
Spanish; the W41s backlog line, the A1407 entry and the two written claims that remedies are off.

Not in scope: an R4 (full-invoice) corrective or any F1 correction (A1407, parked until A802);
`absent-original-cancellation`, `release-brake` and `release-held-cancellation` stay off (Q35, Q38,
Q40); cases "accepted with errors" (Q37 is about refusals; `record-correction` could serve them,
`record-remedy-http.ts:107-108`, but nothing offers it); a fix for cancellations; the golden huella
and `inmutabilidad` tests are not edited.

## Refusal → fix

The page reads, per case, its cause, AEAT's code then and now, the record kind and the invoice type
(`packages/fiscal-verifactu/src/filing-overview-types.ts:66-95`) **(read)**. Nothing in the code
classifies AEAT codes today: the stored code is compared only against `3000` and against itself
(`record-remedy.ts:160-164`, `record-remedy-corrective.ts:125-128`, `drain.ts:971-973`) **(read)**.
The table below is the smallest mapping the owner's rule supports; a case must also be
`fiscal.registro_rechazado`, its delivery `rechazado`, its code then equal to its code now, and an
`alta` — the conditions both remedies already check.

| Refusal (AEAT code) | Invoice | Fix offered | Why |
| --- | --- | --- | --- |
| Issue date in the future (`1112`, «El campo FechaExpedicionFactura es superior a la fecha actual») | F2 simplified | **Corrective invoice (R5)** | Owner, Q37(a)(2). Today's writer handles F2 only (below). |
| `1112` | F1 full, F3 replacement invoice | None: "needs a full-invoice corrective, which Waitron cannot issue yet" | Both refused before writing (below); R4 is A1407. |
| `1112` | R1–R5 (a refused corrective) | None: "no fix yet" | The writer refuses a non-F2 original (`backend.ts:552-558`). |
| Wrong registered name | — | None: no such case is known to reach the page | AEAT's published error list has no record-level code for the issuer's name (`verifactu` repo, `sources/archive/aeat-error-codes/06519ceb….properties`, searched for «Nombre», «razón», «censo»: only 4124, for a representative, and 1270) **(run)**, and AEAT's test service accepted a record with a wrong name (run 37286371546, Q37). If one appears it falls to "no fix yet" by its code. |
| Format or encoding error in a field not printed on the ticket | any alta | **Correction record** — only for the codes question 2 names; proposed: `1100` («Valor o tipo incorrecto del campo»), correcting the operation description | Owner, Q37(a)(3). See question 2. |
| Anything else, a cancellation, a duplicate (`3000`), a conflict | — | None: "no fix yet" | No rule. |

**F1 and future-date findings.**

- A full invoice is refused twice before any number is spent: core refuses a sale with a customer
  tax number (`requireSupportedCorrection`, `packages/core/src/correction-eligibility.ts:5-8`, called
  at `record-correction.ts:215`), and the writer refuses any original that is not F2
  (`backend.ts:552-558`). Both run **(run)**:
  `pnpm --filter @waitron/core exec vitest run src/record-correction.test.ts -t "full invoice"` →
  `refuses to credit a full invoice before spending a corrective number` passed (`Tests 1 passed`);
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts -t "refuses to correct a non-simplified invoice"`
  → `Tests 1 passed`. So `corrective-invoice` on an F1 refuses (`sale.correction_unsupported`); it
  never issues the wrong type. That also covers an F1 with a wrong name.
- For a future date on an F2, the corrective takes today's date as its own and names the refused
  invoice by its stored number and date (`backend.ts:563-585`); A1407's research says that, filed
  the same day, it resolves the refusal (`docs/compliance/research/2026-11-06-adviser-clock.md`
  §60.8; `docs/backlog.md:1696`). The writer sets no separate operation date (§60.1 asks for the
  original's real one), which is right only when the corrective goes out the same day the sale was
  made; the panel says so (question 3).
- After three refusals in a row with one code the drain holds the rest of the chain, the corrective
  included; its hourly probe releases the chain once a later, correctly dated record is accepted
  (`drain.ts:787-821`) **(read)**. `release-brake` staying off therefore delays a corrective by up to
  an hour; it does not block it.

## Open questions for the watcher

1. **What does the corrective for a future date carry?** Recommended: a positive copy of the
   original's lines and total (an R5 by differences that today's writer already issues), and the VAT
   return leaves out the corrective of a refused original, so the sale is counted once locally while
   AEAT holds it once — the same way the VAT return already leaves out an F3 replacement
   (`notSubstituteClause`, `business-day.ts:217-219`). Alternatives: a replacement R5
   (`TipoRectificativa "S"`, the form Q37(b) names; a writer change, about 150–200 more lines, and
   the same counting question), or a whole credit plus ringing the sale again (no build, but AEAT
   holds a negative invoice). This is a fiscal choice; it may need the owner.
2. **Which AEAT codes mean "a field not printed on the ticket"?** The error list maps codes to
   fields only in words, and no code names the operation description. Without a list, the
   correction record is switched on but never offered. Also: `record-correction` accepts a new
   issuer name (`record-remedy-http.ts:181`, `record-remedy-facts.ts:12`), which is printed and so,
   under Q37(a), a corrective's job. Should the server refuse it now that the remedy is on, as A1481
   refuses amounts (`record-remedy-http.ts:61-96`)? Recommended: yes, in Task 1 (about 5 lines).
3. **Same-day only?** Recommended: offer the corrective for `1112` whatever the day, and say on the
   confirmation that it states today's date.

## Task 1 — server: switch on, gate, name the case by its record, classify

Files: `packages/fiscal-verifactu/src/record-remedy-routes.ts`; `packages/module/src/module.ts`
(`recordGeneration` gains optional `requireClockConfirmed(): void`);
`apps/server/src/module-record-generation.ts` and `apps/server/src/boot.ts` (pass
`startClockHolds`, `boot.ts:2313`, into `moduleRecordGeneration`, `boot.ts:3087`, which throws
`clock.unconfirmed` while it holds); new browser-safe `packages/fiscal-verifactu/src/put-right.ts`
(`putRightFor(case: FilingCaseView)` → `{ kind: "corrective-invoice" | "record-correction" } |
{ kind: "none"; why: "full-invoice" | "not-yet" }`, the table above); and, if question 2 says yes,
`record-remedy-http.ts`.

Why the gate: the start-of-day time check wraps only the shared fiscal seat's four writers
(`apps/server/src/start-clock-gate.ts:8-14`), while `record-correction` appends to the chain
directly (`record-remedy.ts:194`) and `corrective-invoice` builds its own, unwrapped seat
(`record-remedy-corrective-http.ts:99-103`) **(read)**. A1420's R7 relied on production enabling no
remedy, and A1407's entry says an enabled remedy takes the start gate first (`docs/backlog.md:1696`).
Not folded into `requireWritable`: `apps/server/src/return-records-api.ts:51` and
`return-clash-acceptance.ts:296` call that too, and gating returns is not this item.

Why the case is found by its record: the page names a case by its record and no case id leaves the
read model (`filing-overview-types.ts:67`), deliberately, so A1308 fi6 changes no outside contract
(`docs/superpowers/plans/2026-11-09-w41s-9-fiscal-filing-screen.md:70-84`). One case per record is
a unique index (`schema/filing-cases.ts:35`). The route fills in `caseId` from `registroId` when the
body omits it; a body that sends one keeps today's checks, which already refuse a case for another
record (`record-remedy.ts:156`, `record-remedy-corrective.ts:119`).

Failing tests first:

- `record-remedy-routes.test.ts`, new "the default policy is exactly corrective-invoice and
  record-correction": mounted with a generation and no policy argument, each of the other three kinds
  answers `409 fiscal.remedy_disabled`, and each of the two answers `400 fiscal.remedy_request_invalid`
  to an empty body. Fails today: the two answer 409.
- Same file, "refuses clock.unconfirmed before writing": a generation whose `requireClockConfirmed`
  throws → `409 clock.unconfirmed` for both enabled kinds, chain unchanged. Fails today: the route
  never asks.
- `apps/server/src/boot.start-clock-gate.test.ts`, new case beside `:195`: while the start waits,
  `POST /management-api/fiscal-records/remedy` with a complete corrective body → 409
  `clock.unconfirmed`, no record. Fails if boot does not pass the gate in.
- `record-remedy-corrective-http.test.ts` and `record-remedy-http.test.ts`: the same request without
  `caseId` → 200 and the event on that record's case. Fails today: `400 fiscal.remedy_request_invalid`.
- New `put-right.test.ts` (node project): one case per table row, including F1, F3 and R5 with `1112`,
  code then ≠ code now, an `aceptado_con_errores` case, and a cancellation.

Existing assertions that change, measured by switching the default set on and running the suites
**(run)**, `git status` clean afterwards:

- `packages/fiscal-verifactu/src/record-remedy-corrective-http.test.ts:419-432` "keeps the default
  production policy closed…": before, 409 `fiscal.remedy_disabled` and nothing written; measured
  after: `expected 200 to be 409`. Becomes "the default policy admits corrective-invoice", asserting
  200 and one R5.
- `apps/server/src/fiscal-remedy.staff-refund.test.ts:554-578` "keeps every built-in remedy
  disabled…" (production and preproduction): before, every kind 409 `fiscal.remedy_disabled`;
  measured after: both cases fail, `expected { status: 400 … } to match object { status: 409 … }`.
  Becomes: the three disabled kinds still 409; the two enabled kinds reach validation (400) with
  fiscal facts unchanged.
- `packages/fiscal-verifactu/src/record-remedy-routes.test.ts:59-72`: still passes, but for the
  wrong reason — it mounts with no generation (`:31`), so the route's `recordGeneration === undefined`
  refusal (`record-remedy-routes.ts:85-86`) answers instead of the policy. Narrow its `it.each` to
  the three disabled kinds; the new default-policy case above owns the other two.
- No other remedy suite changed: `vitest run --project node src/record-remedy` → `Tests 1 failed |
  505 passed`; `src/routes.test.ts src/correction-history.e2e.test.ts` → `13 passed`;
  `apps/server` `src/return-records.real.test.ts` passed.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy src/put-right.test.ts`;
`cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/boot.start-clock-gate.test.ts src/fiscal-remedy.staff-refund.test.ts src/return-records.real.test.ts`.
Guards: `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` if a code is added
(question 2's refusal); `scripts/dashboard-browser-purity.test.ts` for `put-right.ts`; golden huella
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
`src/inmutabilidad.test.ts`, both unedited.

Docs in this task (a behaviour change retires the receipts about the old one): root `CLAUDE.md:950`
"the record remedies, off in production, are outside it"; `docs/developers/conventions-data.md:4704-4705`
"call the chain directly and are outside the gate; production enables none of them"; the A1407
entry, `docs/backlog.md:1696`, "today the remedies write past it, and production enables none".

Size: about 90 production lines, 200 test lines.

## Task 2 — the panel, the guide and the backlog

Files: `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` (the case dialog,
`:516-536`), `fiscal-filing-client.ts` (a `putRight` POST), `strings.ts` (English `:195` and Spanish
`:462` "cannot correct" lines and the new words), `index.ts` (hand the screen
`ctx.permissionContinuation`, which further screens already receive, `apps/dashboard/src/dashboard-app.ts:1650-1667`),
`apps/server/src/guide/en/fiscal-filing.md` and `es/fiscal-filing.md` (`{#cases}`), `docs/backlog.md`.

How it behaves:

- The dialog shows **Put this right** when `putRightFor` offers a fix, or one sentence saying why
  not (full invoice → A1407's words; otherwise "no fix yet; export the case for your tax adviser").
- Choosing it opens a confirmation that says what will be sent: "Waitron will issue corrective
  invoice R5 for invoice A/123 of 14/11/2026, total 12,10 €, dated today, and send it to AEAT. The
  refused invoice stays as it is." (wording per question 1 and 3), with **Send** and **Stop**.
  The request carries `registroId`, a fresh `actionKey` per dialog opening (kept across a retry so
  a repeat is answered from the saved decision, `record-remedy-corrective.ts:71-94`) and a fixed
  `reason` naming the refusal; no `caseId`.
- Without `fiscal.remedy` (administrators only, `packages/fiscal-verifactu/src/permissions.ts:6`;
  the page needs `report.export`), the action reads **Sign in as an administrator to put this right**
  and calls `permissionContinuation.signIn({ permission: "fiscal.remedy", signal })`
  (`packages/dashboard-kit/src/contract.ts:13-20`), as the certificate card does
  (`certificate-card.ts:156,172`). Never "ask your administrator" (`docs/developers/conventions-ui.md:8-20`).
- A recent sign-in: the route asks for one (`record-remedy-routes.ts:87`,
  `management_session.proof_required`); the dashboard's shared gate already prompts in place and
  resends the same body (`apps/dashboard/src/api/fresh-sign-in.ts:48-68`, wrapping the request at
  `apps/dashboard/src/main.ts:93`). The panel adds nothing for it; a test proves the resend.
- A refusal is shown under the actions in the dialog, explained, with the action still available
  (`conventions-ui.md` Forms; refusals never disable it). On success the dialog closes and the page
  reads again; a failed read after a successful send is a load failure, not a failed send.
- The "cannot correct these records yet" line becomes "Waitron can put right a simplified invoice
  AEAT refused for a future date. Open a case to see whether it can put that one right."
- If question 2 yields codes, the correction record adds one field (the operation description) in
  the same dialog: draft scope from `draftScopeFor`, a `*.unsaved.test.ts`, the Forms contract. That
  adds about 70 production lines.

Failing tests first (`fiscal-filing-screen.test.ts`, browser project): a `1112` F2 case shows the
action, the confirmation names number, date and total, **Send** posts `kind: "corrective-invoice"`
with that `registroId` and no `caseId` (fails if the action is deleted: no button); an F1 `1112`
case shows the A1407 sentence and no button; without `fiscal.remedy` the action calls
`signIn` with `fiscal.remedy`; a `proof_required` answer followed by a confirmed sign-in resends
the identical body once; a refusal is shown and the action stays enabled; **Stop** sends nothing.
`fiscal-filing-screen.a11y.test.ts`: the dialog's action, confirmation and refusal states in both
themes. Update the existing `data-test="no-correction"` assertion to the new words.

Guide: the `{#cases}` section in both languages gains three sentences — which cases can be put
right, that it needs an administrator, and that a full invoice cannot be put right yet. Written from
the code, per `conventions-ui.md` "A help bubble orients" and "A guide says what to do".

Backlog: the W41s entry (`docs/backlog.md:289-299` on this base; the item's `296-303`) drops Q37
from "pending Q35/Q37/Q38/Q40" and its "`ENABLED_REMEDIES` is empty" clause (`:296`); the same in
`docs/backlog/fiscal.md:427`. A1089 (`docs/backlog.md:210`) also says "`ENABLED_REMEDIES` is
empty" and that the page "decides nothing": narrow it to what is still missing. A1407 keeps its F1
half.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts`
(check `memory_pressure` first); `cd apps/server && pnpm exec vitest run src/guide-content.test.ts`;
root `pnpm exec vitest run scripts/guide-links.test.ts scripts/native-form-fields.test.ts scripts/page-title-styles.test.ts`.

Overlap: open PR #3077 (`feat/w41s-9-missing-history`) changes `fiscal-filing-screen.ts`,
`strings.ts`, `filing-overview-types.ts`, both guide pages and `docs/backlog.md` (`gh pr view 3077`)
**(run)**. This task does not depend on it; whichever lands second rebases.

Size: about 210 production lines (screen 120, client 15, strings 60, wiring 15), 350 test lines,
about 20 lines of guide prose.

## Task 3 — what the corrective carries (after question 1)

For the recommended answer: the route accepts `correction: "copy-of-original"` for a `1112` F2 case
and builds the request server-side — this node's live `rectificative` series, the original sale's
lines and total — so the browser sends no amounts; and the VAT return leaves out a corrective
whose original was refused and is resolved by it. Failing tests first: the built R5's
`importeTotal`/`cuotaTotal` equal the original's and its `FacturasRectificadas` names it; a
`computeVatReturn` case with a refused original and its corrective counts the sale once (fails
today: twice). Run `pnpm --filter @waitron/reporting exec vitest run src/vat-return.test.ts` and
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy-corrective`.
Size: about 90 production lines, 150 test lines. A replacement (`"S"`) instead would be a writer
change and needs its own plan.

## Total size

About 300 production lines and 550 test lines for Tasks 1–2; about 390 / 700 with Task 3; about 460
/ 800 with the correction-record field.
