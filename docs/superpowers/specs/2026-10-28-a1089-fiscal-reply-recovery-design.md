# A1089: inspect a fiscal reply mismatch before choosing recovery

**PROPOSAL, 2026-10-28. Awaiting owner scope decision. No implementation or plan authority.**
You need to know what reply evidence survived and what the affected records are doing now before
choosing a remedy. Recommend planning evidence-only inspection first; persistent mismatch repair stays OPEN.
The requirement is [the fiscal-reply entry](../../backlog.md) and its
[audit](../../backlog/self-service-refusals.md#fiscal-reply), including inventory `fiscal.respuesta_descuadrada`.
A malformed external reply does not establish a Waitron bug. This proposal makes no external or legal claims.

## What the source and local fixtures establish

Source references below are repository-relative at `f0df802c01d8902424c883a921e901d5072a1924`.

- `packages/fiscal-verifactu/src/drain.ts:1269` (`resolveLines`) applies no line when counts differ.
  With equal counts it checks each position, record reference and exact invoice triple: issuer, number, date.
  A supplied operation must match; an absent operation is allowed (`:1283`, `:1345`). Matching lines can settle
  independently through `persistResponse` (`:1384`), even when other lines remain unknown.
- `drain.ts:1551` (`awaitReadableAnswer`) returns ordinary unmatched rows to pending with backoff and a warning;
  it writes no fiscal acknowledgement there. A probe, a send of an already-held record, stays held.
  `backoffMs` (`:78`) doubles from one minute to a one-hour cap; that calculation is not a guaranteed send time.
- `drain.cases.test.ts:1371` checks a mixed matched/unmatched reply; `:1444` settles the third of three and
  retries the swapped pair. Wrong-count fixtures (`:1480`) assert pending state, retry time, no acknowledgement
  and saved lines; `:1566`, `:1609`, `:1735` and `:1778` distinguish invoice, reference and operation checks.
- `drain.ts:1400` saves ordered affected-record ids, CSV and reply lines on the first record's sale.
  The warning fields are declared in `packages/fiscal-verifactu/src/errors.ts:178`.
  `drain.ts:1624` calls core `recordIncident` (`packages/core/src/incidents.ts:95`); its conflict suppression
  and `packages/db/src/schema/incidents.ts:69` retain only the first open warning for that source/code/sale.
  The repeated-mismatch fixture (`drain.cases.test.ts:1544`) sends a different second reply but retains the first.
  Later mismatch evidence can therefore be absent, including another batch beginning with that sale.
- `packages/core/src/incidents.ts:307` (`markIncidentHandled`) writes acknowledgement fields, freeing that
  incident's deduplication key. It neither repairs the fiscal queue nor settles an invoice record.
- `packages/fiscal-verifactu/src/alerts.ts:10` (`FISCAL_ALERTS`) claims fiscal incidents with `fiscal.view`
  and no target screen. `apps/server/src/alerts.ts:115` and `:189` filter open/handled incidents by permission;
  `apps/server/src/alerts-api.ts:129` separately authorises and acknowledges Mark handled.
- `apps/dashboard/src/widgets/alert-format.ts:38` requires a supplied, permitted screen for navigation.
  `apps/dashboard/src/screens/alerts-screen.ts:180` offers acknowledgement and any supplied target, not this
  inspection. The existing EN/ES support referral (`apps/dashboard/src/i18n/alert-messages.ts:201`) stays OPEN
  until a real recovery action is built; a written proposal does not correct the product journey.
- Normal submission is wired through `apps/server/src/boot.ts:2838`: `resetBeforeFirstDrain` wraps
  `enabledFiscal.drain`; `runLoop` (`:2857`) calls `runFiscalDrain` (`:2867`) through the primary-node pass.
  `apps/server/src/restart-reset.ts:27` resets before draining; `onboarding-policy.ts:32` gates submission;
  `loop.ts:54` schedules further passes. Reading these callers is not end-to-end scheduling qualification.

The parent ran these unchanged commands; their retained logs were read for this proposal:

| Command | Recorded result |
| --- | --- |
| `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.cases.test.ts -t 'reply lines are paired'` | 23 passed, 45 unrelated skipped; `reply-lines.log`. |
| `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts` | 56 passed; `alerts-boundaries.log`. |
| `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` | 20 passed; `protected.log`. |

Logs: `/Users/clintongormley/waitron-campaign-e/receipts/a1089-fiscal-reply-20261028/`.
These are local fixtures, including fake AEAT, not live AEAT, persistent repair or end-to-end UI qualification.

## Proposed inspection: first retained evidence beside fresh observations

From the relevant alert, choose **Inspect reply / Examinar respuesta** to open an incident-bound panel.
Show incident id, detection time and “First retained reply / Primera respuesta conservada”. Show saved
affected-record ids in sent order, sent-record count, retained reply-line count and saved CSV reference, or unavailable.
Show only validated, allowlisted non-secret line facts: position, recognised status/operation, numeric error
code, and reference/invoice-match indicators computed against the associated records. Minimise personal data:
omit raw issuer tax ids, customer/staff details and free-form response messages; do not offer a raw detail dump.

Separately label “Current record state / Estado actual del registro” with observation time. A fresh module
read supplies send state, stored next-attempt time and held reason for each validated incident record.
A next-attempt time means eligibility, not a promise to send then. Missing, malformed or unreadable metadata
is “Unavailable / No disponible”; never infer present state from the detection-time warning.
Do not label the retained reply “latest”, promise complete history or suggest absent historical replies can
reliably be recovered. Records may settle or somebody may handle the incident while this panel remains open.
Show incident handling and queue outcomes as separate observations, not an atomic snapshot or proof of repair.

Offer **Read again / Volver a leer** and **Stop / Cerrar inspección**. Explain beside Stop that it closes
inspection without stopping filing or sales. A failed read offers Read again and Stop without guessing facts.
Keep existing **Mark handled / Marcar como atendida** separate, with “Acknowledging this alert does not settle
filing / Marcar esta alerta como atendida no resuelve el envío fiscal”. Inspection never acknowledges it.

## Proposed module, server and authentication boundary

Add an optional fiscal-owned evidence seat, a read-only callback through the module contract, plus a browser
inspection action and a generic endpoint such as `GET /management-api/alerts/incidents/:id/evidence`.
The server resolves the stored incident and enabled contribution; the fiscal module owns record association,
fiscal reads and interpretation. Core/server code imports no fiscal tables or regime implementation.
Absent/disabled seats answer unavailable; follow `docs/developers/conventions-data.md:173`. These are proposed APIs.

Accept only the incident identifier. Authorise the incident and read with `fiscal.view`, then validate stored
code, source, parameter types/bounds, ordered record ids, first-record sale linkage and each record's venue
association before returning evidence. Saved parameters are input to validation, never authority by themselves.
Unverifiable association refuses that detail; never expand to unrelated records. Accept no caller-supplied
paths, SQL, record lists or raw incident parameters as evidence. Any future repair needs separately designed
mutation authority; `fiscal.view` grants none through this proposal, even though acknowledgement already uses it.

At the action offer local administrator/owner sign-in or step-up, meaning fresh authentication when required,
with an explicit continuation back to this incident and a Stop choice. Reuse existing credential protections;
design and test this continuation rather than assuming it exists. A passkey prompt requires your gesture.
Resolve sessions without touching activity (`packages/identity/src/management-session.ts:87`), check rights
before reading and freshly before release, and deny revoked permission, suspension or expiry during a read.
Clear evidence on expiry/account change and require an explicit fresh read after sign-in; never repaint it
from the previous account's result. Background activity stays passive and cannot keep a session alive.

Bound the complete diagnostic read to five seconds, including waiting for access and final authorisation.
Use a select-only host turn with no session stamp, write transaction or change-log drain; a timeout abandons the
operation and cannot leave a queued continuation to run later. Never invoke fiscal drain or construct a client.
Return allowlisted values only, with `no-store`; keep diagnostics in memory only, without persistent caches,
payload/log dumps, credentials, secrets or unrestricted export. Render untrusted values as text, never HTML.
Each opening/read/account has a generation: close, reopen, newer read, timeout or expiry invalidates older
answers and their busy-state release. Stop remains available while reading; no automatic inspection polling.

## Persistent repair stays OPEN

Inspection offers no retry-now, resubmit, reorder or per-record batch split; no mutation of acknowledgements,
`envios` or fiscal records; no numbering/chain changes, new series, restore/reset, certificate/network changes
or AEAT lookup requests. Existing fiscal retry, probe/hold and scheduler behaviour remains unchanged.
A later remedy needs actual retained evidence, an owner scope decision and fiscal review. It can coordinate
with W41s-8/W41s-9; this read-only planning decision need not wait for them. Missing replies remain unavailable.

## Prospective checks and owner decision

Before a later build is accepted, retain existing fiscal/golden/guard assertions unchanged. Add behavioural
checks whose deletion controls catch wrong-count application versus equal-count mixed matching, and confusing
first evidence with repeated/latest replies or current state. Deny bad association, missing rights and rights
revoked mid-read. Compare all fiscal, incident and session facts before/after inspection, including failure
and timeout; assert zero AEAT, mutation, acknowledgement and drain calls. Reject secrets and HTML injection.
Hold reads across close/reopen, account change and expiry to prove no stale repaint or busy-state release.
Exercise EN/ES, light/dark, 390/1280 widths, keyboard and axe accessibility, plus English/Spanish guide twins
with shared section ids. No mockups or rendered-UI qualification are claimed for this written proposal.

**A, recommended:** authorise a plan for evidence-only inspection first, leaving persistent response repair OPEN.
**B:** design the complete fiscal decision/repair route before any build. This is substantial module/server/UI/auth
integration and fiscal evidence association, so the queue requires your scope decision beyond a wording change.
Either answer authorises planning only; a subsequent build requires your separate approval.
