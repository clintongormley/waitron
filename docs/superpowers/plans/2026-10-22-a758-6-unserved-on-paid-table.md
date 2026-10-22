# A758-6 — Food left on the pass after the table has paid: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** This slice adds a migration (two columns on the append-only `adjustments`
table and a new append-only link table), changes who may give a refund without typing a PIN again
(an approval carried from a cancel to its refund), changes a till route's zone check, and changes a
contract between the server, the till, the adjustments package and the dashboard. Each code task
gets a per-task reviewer; the docs task and the LOOK task do not. The plan is reviewed once, against
the design, by a fresh-context reviewer before any implementer starts. `/finish-branch` runs its
full wave, with the Codex run-it seat as two reviews side by side.

Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls with its task unfinished stops at a passing or cleanly failing point, commits, and hands
over: what is done, what is left, the files, and each check's state.

**No task changes `computeHuella`, the chain, invoice numbering, `registros_facturacion`, the alta
builders, or anything `recordSale` reads. A refund still files nothing** (design D20: until A802
lands nothing is filed and the invoice is unchanged). Nothing found while writing this plan needs a
fiscal change. If an implementer finds that something does, that is a stop and a report.

**Goal.** After a table has paid, every dish not yet served is cancelled with a reason; the money
for the dishes the waiter ticks goes back through a refund screen that opens already filled in; the
cash refund's "I have handed this money back" switch is gone; the Voids and comps report says, for
each cancelled dish, whether its charge was kept, whether preparation had started, and what was
refunded for it; and a device outside a finished table's zone cannot read that table's dishes.

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — §1 (D12–D28),
§3.2, §3.3, §3.6, §3.8 with §3.8.1 and §3.8.2, §3.9, §9 (the bullet "A758's slice for §3.8, after
A773-1 lands" and §9.1's cash-switch list), §10, §11. Pictures 06–09 in
`docs/backlog/mockups/a758-adjustment-reasons/`. Backlog: `docs/backlog.md` "A758" and the first
sub-bullet of "Loose ends left by service Task 5" (the kitchen one, `docs/backlog.md:1942-1948`).

Every `file:line` below was read on 2026-10-22 in this worktree, on `main` `0abad3d7e`, with
`sed -n`/`grep -n`, unless it is marked **(run)**. Each **(run)** names what was run and what it
printed. A773-1 (#1897), A773-2's first slice (#1944, `509e8d42a`), A758-1 to A758-5, A803 slice 5
(#1953) and A757 are all in that history.

---

## Decisions this plan makes that the design does not

The build goes straight on with each default. The owner is away and may override any of them later.

1. **"Table finished" on the pass card is not built.** Design §3.8 item 5 assumes a finished
   table's dishes stay on the pass ("The dishes stay on the pass after that", §3.8 "Today"). That
   stopped being true with A773-2's first slice (#1944, `509e8d42a`, "Keep kitchen work until
   service ends"): the pass reads keep a dish only while its party, or the party it was merged
   into, is open (`liveKitchenDish`, `apps/server/src/working-order.ts:7779-7798`, the open-family
   test at `:7785-7795`). **(run)** `pnpm --filter @waitron/server exec vitest run
   src/pass-lifetime.test.ts -t "removes unserved ready food"` passed (1 test): after `finishTable`
   the ticket row is still there (`pass-lifetime.test.ts:215-217`) but the pass screen, the pass
   monitor and the All stations read are all empty (`:218-219`). Record unpaid departure closes the
   party through the same `closeParty` (`apps/server/src/parties.ts:707-745`), so its food leaves
   too. So no card of a finished party is ever drawn, and a "Table finished" label would have
   nowhere to appear. **Default:** build nothing for the pass; the docs task deletes the backlog
   sub-bullet it answered and adds a dated note to the design. *The other way:* none needed unless
   a later slice brings finished parties' food back onto the pass.
2. **How Finish table's reason starts on "Not served".** A venue may rename or delete that reason,
   and the till receives reasons named in the operator's language only
   (`apps/server/src/adjustments-api.ts:249-269`). **Default:** the till's reasons route marks one
   reason `startsFinishTable: true` — the Void reason whose English name (`names.en`, else `name`)
   is exactly the starter's "Not served" (`packages/adjustments/src/provisioning.ts:54`), the
   literal exported once from the adjustments package. The till passes that reason's id to the
   dialog's existing `defaultReasonId` (`apps/till/src/widgets/finish-table-dialog.ts:80`, `:156-158`),
   which nothing sets today (`git grep -n defaultReasonId -- apps/till/src` lists only the widget).
   No such reason: the drop-down starts on "Choose a reason", as design §10 item 7 allows.
   *The other way:* a stored "starts Finish table" switch on a Void reason, edited on the Voids and
   comps page (a column, a form field, a migration).
3. **How the approval given for "Cancel and refund" reaches the refund** (design §3.8 item 3 leaves
   it to the plan: "never storing the PIN"). **Default:** the till keeps the approver's `{ personId,
   pin }` in memory only — on the in-memory state of the refund screen that this cancel opened,
   never in the saved attempt (`apps/till/src/state/tender-refund.ts:12-16` already leaves
   `override` out) or any storage — and sends it once as the refund's `override`. It is dropped
   when that refund screen (or the list of receipts Finish table opens) closes, on success, on any
   refusal, and on sign-out; a refusal falls back to today's PIN prompt. It is never carried to a
   card keyed on a separate terminal, whose PIN confirms the terminal refund was done
   (`apps/server/src/tender-refund-authorization.ts:132-148`). The server re-checks the PIN as for
   any override. *The other way:* the server treats a linked cancel's recorded approver as the
   refund's approval (a new authorization rule; no PIN held in the till).
4. **The link from a refund to the cancels it pays for** (design §3.6 leaves its shape to the plan).
   **Default:** a new append-only table in the adjustments migration set, `adjustment_refunds`:
   `id`, `adjustment_id` → `adjustments.id`, `tender_refund_id` → `tender_refunds.id`, `amount`
   (money), `created_at`; unique on (`adjustment_id`, `tender_refund_id`). It is written in the same
   transaction that reserves the refund. The refund request gains an optional `cancellationIds`
   (the cancel rows' ids); the server checks each is a `cancel` row with `charge_kept` on the bill
   of the refund's sale, and splits the refund's payment amount (not its tip) across them in the
   order sent, each up to its dish's filed value (A773-1's `cancellationRefundValue`,
   `apps/server/src/cancellation-refund-value.ts:5-45`, scaled to the cancelled quantity) less what
   earlier links to pending or completed refunds already hold. To give the till those ids, the
   cancel answer (`{ revision }`) and the Finish table answer (`{ state: "closed" }`) gain
   `refundLinks: [{ lineId, adjustmentId }]` **only when a dish was handed to a refund**, so every
   existing answer pin without a refund stays as it is. *The other way:* link by line id and let
   the server find the newest unlinked cancel.
5. **The two stored flags are two columns on `adjustments`, not one.** `charge_kept` (not null,
   default false): the cancel took the dish off the pass and the station but left its charge — the
   flag the backlog asks for, because a still-charge cancel of a dish already comped to €0.00 is
   stored exactly like a don't-charge cancel of it (before = after = reduction = €0.00; read at
   `apps/server/src/line-cancel.ts:305`, `:331-333` and `apps/server/src/adjustments-apply.ts:491-497`,
   `:955-956`). `preparation_started` (nullable): true or false for a cancel whose answer is known,
   null otherwise (comps, bill-level rows, and cancel paths that do not know, such as a recalled
   draft's Discard, A909). No new CHECK, so drizzle-kit should write `ALTER TABLE … ADD COLUMN` with
   no table rebuild (Task 1 confirms by reading the generated SQL; a rebuild is a stop).
6. **A paid-bill cancel's row records who gave the PIN for its refund** in `approved_by` (D19:
   "who gave the PIN (if anyone)"). Today it is always null (`line-cancel.ts:336`) even when a
   refund approver's PIN was checked for the handoff (`apps/server/src/line-cancel-api.ts:194-203`).
7. **The report's words for a refund.** A completed linked refund reads "Refunded €5.50"
   («Devuelto 5,50 €», §3.9); a pending one "Refund pending €5.50" («Devolución pendiente 5,50 €»,
   new, our words); a failed one shows nothing. They sit in a new **Refunded** column («Devuelto»)
   of the entries list, not a link: no screen lists refunds (design §3.6, "Where refunds show
   today"), so there is nothing to link to.
8. **A charge-kept cancel no longer adds the dish's value to the person's sales.** The report
   credits every cancel's list value "since a cancelled line has left the bill"
   (`packages/adjustments/src/reports.ts:386-389`, code at `:423`); a charge-kept cancel leaves the
   line on the bill, so its value is counted twice (read: `readCreditedSales`,
   `reports.ts:359-376`, sums every surviving line, and the keep-charge path never deletes or
   shrinks the line, `line-cancel.ts:371-387`). Design §3.8 asks the plan to check this; Task 5's
   first test measures it before the fix.
9. **A finished party's zone is read from its bills.** A closed party holds no table rows
   (`closePartyTables` deletes them, `apps/server/src/parties.ts:751-755`), so `partyZone`
   (`:202-216`) answers null and every `{ partyId }` zone check passes (`zone-access.ts:51-55`).
   **(run)** A throwaway test (kept at `/tmp/a758-6-probe.pB71/zone-probe.test.ts`, outside the
   repository; copied into `apps/server/src` to run and deleted after) on `0abad3d7e`, Node
   v26.11.1, using `provisionAdjustmentVenue`: a paid table bill, the device's profile limited to
   another zone. `GET /api/parties/:id/lines/:lineId/cancellation` answered 403
   `service_zone.not_allowed` while the party was open, and **200 with the dish's cancellation
   facts** once `closePartyTables` ran and the party row was set `closed` (the probe closed it by
   those two writes, not through `finishTable`). **Default:** in `subjectZone`
   (`apps/server/src/zone-access.ts:16-37`), a `{ partyId }` subject whose party has no current
   table takes the recorded zones of every bill of the party (`VENUE_SERVICE.findOrderZones`,
   `orderServiceContexts`, `packages/venue-service/src/operations.ts:1219-1238`); the check refuses
   when any of them is outside the profile's zones. `partyZone` itself is unchanged, because its
   other callers (menus, allergies, table actions) want the table's zone of an open party.
10. **Cancel item… on a paid bill offers a partly served line's unserved quantity** (design §3.8
    item 2). Today the dialog offers nothing on a paid line with anything served
    (`#options`, `apps/till/src/widgets/cancel-item-dialog.ts:176-192`, pinned by "offers no paid cancellation
    for a served dish", `cancel-item-dialog.test.ts:601-608`), though the server accepts the
    unserved quantity (`line-cancel.ts:137-140`, pinned by `line-cancel-api.test.ts:157-189`).
    **Default:** the dialog offers the line's unserved quantity; the Sent panel offers Cancel… on a
    paid bill's unserved slice only, not on its served slice (`#canVoidSent`,
    `apps/till/src/screens/till-table-order-screen.ts:2604-2615`).
11. **The English line sending staff to a till stays A803's.** Design §3.9 writes "Give the money
    back at a till: Refund a payment on the receipt."; A803 slice 5 (#1953, the same day as this
    plan) set "Refund the payment at a till: choose Refund a payment on the receipt."
    (`apps/till/src/i18n/strings.ts:54-55`, pinned by `apps/till/src/i18n/refund-wording.test.ts:7-10`).
    The Spanish already matches the design (`strings.ts:1788`). Default: no change; an owner point.
12. **The refund screen's Reason is stored as text, as today** (D26): the chosen reason's name in
    the operator's language, or, for a reason that asks for a note, the words typed. A saved,
    unanswered attempt reopened later is locked (`tender-refund-dialog.ts:124-126`) and shows its
    stored reason as text, not the drop-down, because stored text need not match any reason now.
13. **"Give back a payment" before the invoice (`bill-refund-dialog.ts`) keeps its typed reason.**
    D15 says every refund dialog that asks a reason uses the drop-down; design §9's bullet for this
    slice names only the refund screen. Default: not here; a new backlog entry.
14. **The cash switch goes with no compatibility code** (pre-live, CLAUDE.md §3). Removing
    `cashConfirmed` changes the fingerprint of every refund request
    (`apps/server/src/tender-refund-reservation.ts:53-61`), so a refund recorded before the upgrade
    whose answer the till never got, sent again with the same submission after it, is refused
    `submission.id_reused` (`:63-69`) — design §3.8.2's named case. A retry by the refund's own id
    checks no fingerprint (`apps/server/src/tender-refund-api.ts:240-294`) and keeps working. A
    request that still carries `cashConfirmed` is not refused: the parser copies only the fields it
    knows (`tender-refund-api.ts:99-116`). Default: accept; said in the PR.
15. **"They'll collect it at the counter" is not offered.** The Finish table dialog draws no such
    button today (`finish-table-dialog.ts:395-424`, Back and the main button only); this slice adds
    a test pinning that, and the A758 backlog entry keeps it as the one thing left.
16. **The filled-in refund.** Its payment amount is the ticked dishes' total for that sale — the
    values A773-1 already computes for the dialog (`refunds[lineId]`, `apps/till/src/till-app.ts:14811-14830`,
    from the filed line value) — and its tip is 0.00. It preselects the payment when exactly one this
    device can refund is available (today's rule, `tender-refund-dialog.ts:148-153`). When the
    chosen payment cannot return it all, the amount is what it can, and the line "€2.00 left to
    refund from another payment" («Quedan 2,00 € por devolver de otro pago») shows under it, then
    the till line of Decision 11 when no other payment of the bill can be refunded on this device.
    Nothing chains a second refund automatically; a second refund from the receipt is not linked.

---

## Where the design drifted (re-read on `0abad3d7e`)

Most of §3.8 was built by A773-1 to design §10. What this slice does is the rest.

| The design says | Today |
|---|---|
| §3.8 "Today": dishes stay on the pass after Finish table; pass screens can mark Done (`pass-board.ts:131`) | Finished parties' food leaves every pass read (Decision 1, **run**); `markPassItems` is gone and `POST /api/device/pass-screen/done` answers 404 (`apps/server/src/pass-board.test.ts:385-408`) |
| §3.8: A773-1's paid-bill choices "Cancel, keep the payment" / "Cancel and refund", no reason (`cancel-item-dialog.ts:150-151`) | Built to design §10: a Refund tick, the reason drop-down, buttons "Cancel" / "Cancel and refund {amount}" and Back (`cancel-item-dialog.ts:176-201`, the tick at `:508-520`, the reason from `:545`, the buttons from `:599`); "still charge" writes a €0.00 `cancel` row with the reason (`line-cancel.ts:243-338`) |
| §3.8 item 1: Finish table asks first | Built: `finishPartyService` (`apps/server/src/finish-party-service.ts:55-195`) cancels every unserved dish of every paid bill and closes in one transaction; the dialog (`finish-table-dialog.ts`) draws the per-dish question, Refund ticks, the reason, "Cancel" / "Cancel and refund {amount}", Back, and the till line. **Not built:** the reason starting on "Not served" (Decision 2) |
| §3.8 item 2: a partly served line offers its unserved quantity | Not built in the till (Decision 10) |
| §3.8 item 3: the refund opens filled in, Reason drop-down, PIN not asked again | Not built: it opens empty, with a typed reason, and asks again (`till-app.ts:7490-7516`, `:12785-12797`, `:15112-15132`; `tender-refund-dialog.ts:301-317`, `:411`) |
| §3.8.2 / D28: refund ticks only for what this device can give back; the till line otherwise | Built (`till-app.ts:7420-7431`, `:9678-9679`, `:14776-14809`; dialog list filtered at `:7651`). **Not built:** "€x left to refund from another payment" (Decision 16) |
| §3.8.2: the cash switch | Still there (Task 4 and Task 8 list every hit, re-found with the design's own command) |
| §3.6: preparation started per cancel; "Void, charged"; "Refunded €x" | Not stored, not shown: `adjustments` has no such column (`packages/adjustments/src/schema/adjustments.ts:40-81`); `preparationStarted` reaches only the kitchen slips (`adjustments-apply.ts:118`, `:890-899`); `entryWords` says "Void" for every cancel (`packages/adjustments/src/dashboard/adjustment-report-screen.ts:117-125`) |
| §3.8 "Who may": a finished party passes every zone | True (Decision 9, **run**) |
| §3.9 "Give the money back at a till…" | A803's newer English (Decision 11) |
| `line-cancel.ts:331-333` (backlog) | Holds |
| §10 item 5: Finish table's PIN prompt over `/api/refund-authorizers` | Built (`till-app.ts:15154-15176`) |

## Global constraints

- **Test first.** Each code task starts with failing tests, run with the command given; the
  expected failure is read before any code is written. Read the `Tests` count of every run; a run
  that prints none proved nothing (CLAUDE.md §4). Use `env -u AI_AGENT -u CLAUDECODE` when a
  passing test's console output matters.
- **The fiscal gates run unedited at the end of every code task:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  (the golden huella and immutability) and
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`.
- **A database test uses `useVenueDb`** (CLAUDE.md §4), as its neighbours do; the adjustment harness
  (`apps/server/src/testing/adjustment-venue.ts`) and `payWorkingOrder`
  (`apps/server/src/testing/whole-payment-fixture.ts`) are the models. A rejected write asserts the
  domain error code, never `toBeInstanceOf(Error)`.
- **A test's check changes only where this design changes what it checks** (owner, 2026-10-05).
  Every such change is listed under "Changed test checks" with its line, old and new value and
  design point; a helper or fixture that gains something is under "Fixtures grown". Any other check
  that turns red is a stop and a report.
- **General code is English only** (CLAUDE.md §3). Spanish lives in `apps/till/src/i18n/strings.ts`
  (`es` block) and `packages/adjustments/src/dashboard/strings.ts`. `packages/adjustments` is
  scanned by the guard; run `pnpm exec vitest run scripts/english-only.test.ts` after Tasks 1, 5
  and 6.
- **Concise product text.** New words are only those in §3.9 and Decision 7.
- **Forms follow `docs/developers/design-system.md` → Forms**: fields from primitives (the reason is
  `wt-combobox`, the note `wt-input`), the required mark, an invalid submission explained beside
  each bad field and once at the bottom (`wt-form-actions`), the main action quiet and disabled
  until every required answer is given. Each changed dialog keeps its `*.unsaved.test.ts` and its
  `*.a11y.test.ts` (both themes).
- **Migrations** (CLAUDE.md §3): generated with `pnpm --filter @waitron/adjustments db:generate`,
  never hand-written or edited; drizzle-kit numbers it. The new table is classified in
  `ADJUSTMENTS_CLASSIFICATION` (`packages/adjustments/src/classification.ts:4-20`) with
  `appendOnly(…, "ledger", …)`, and travels in both the module's migration descriptor and
  `packages/migrations/migrations.manifest.json` (`appendOnlyTables`, `:106-109`). Every foreign key
  is declared in the TypeScript schema. A rebuild of `adjustments` in the generated SQL is a stop.
  `scripts/migration-upgrade.test.ts`'s `CANDIDATES` (`:614-641`) may gain sample values if the
  walk needs them (a nullable column tries `null` first; a defaulted one its default), each listed
  under "Fixtures grown".
- **Who may is a risk trigger.** Every changed check of who may (the zone, the carried approval,
  the link's ownership checks) gets a refusing case and a served case.
- **Browser suites** (`apps/till`, `packages/adjustments/src/dashboard/`) run in real headless
  Chromium. Check `memory_pressure | grep free` first; never beside a whole-workspace coverage run.
- **Coverage 98/98/98/95** holds in every package touched. Local runs are focused; CI runs the
  package suites and coverage.
- **Stop only processes you started**, by recorded id. Every commit `git commit -s`, staging named
  paths, never `git add -A`.

### Guard suites, by kind of change (run in the task that makes the change)

- **Schema or migration:** `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/append-only-migration-sets.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts
  scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts`, then
  `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/migration-upgrade.test.ts` (read its
  printed summary), then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- **A new wire field or till string:** `pnpm exec vitest run scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts scripts/english-only.test.ts scripts/errors-reachable.test.ts`.
- **A guide:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.

## Review focus

The inputs most likely to break what the design promises, each pinned by a test in the task named:

1. **A still-charge cancel of a dish already comped to €0.00** reads "Void, charged", not "Void",
   and adds nothing to the person's sales (Tasks 2 and 5). The control: a don't-charge cancel of
   the same €0.00 dish reads "Void".
2. **A refund linked to two cancels of one sale, for less than both** (the waiter typed a smaller
   amount): the first cancel in the order sent takes up to its value, the second the rest; a third
   link attempt beyond the dishes' value links nothing more (Task 3).
3. **A `cancellationIds` naming another sale's cancel, a comp row, a don't-charge cancel, or an
   unknown id** is refused `management.request_invalid` naming `cancellationIds`, with no refund
   reserved (Task 3).
4. **The carried approval is used once.** A wrong carried PIN falls back to the prompt; a second
   refund from the same screen asks; nothing about the PIN reaches `localStorage` (Task 10).
5. **A finished party read from a device outside its bills' zone** is refused 403; the same read
   from a device in that zone, and from a device with no zone limit, is served (Task 7).
6. **A partly served paid line**: 3 Croquetas, 1 served — Cancel item offers 2, and its refund
   value is two thirds of the filed value (Task 11b).
7. **The filled-in amount includes the dish's share of a comp on the whole bill** (design §3.8 item
   3). Task 10 pins it on a bill with a 10% bill comp; if A773-1's filed value does not include
   that share, that is a stop and a report, not a fix in this slice.

---

## The files

| File | Tasks |
|---|---|
| `packages/adjustments/src/schema/adjustments.ts`, `schema/refund-links.ts` (new), `schema/index.ts`, `classification.ts`, `drizzle/` (generated), `record.ts`, `refund-links.ts` (new), `index.ts`, `provisioning.ts` | 1, 2, 11a |
| `packages/migrations/migrations.manifest.json` | 1 |
| `apps/server/src/line-cancel.ts`, `line-cancel-api.ts`, `finish-party-service.ts`, `till-api.ts` (finish route `:2860-2915`), `adjustments-apply.ts` | 2 |
| `apps/server/src/tender-refund-api.ts`, `tender-refund-types.ts`, `tender-refund-reservation.ts`, `tender-refunds.ts` | 3, 4 |
| `packages/adjustments/src/reports.ts`, `routes.ts` | 5 |
| `packages/adjustments/src/dashboard/adjustment-report-screen.ts`, `dashboard/client.ts`, `dashboard/strings.ts` | 6 |
| `apps/server/src/zone-access.ts` | 7 |
| `apps/till/src/widgets/tender-refund-dialog.ts`, `state/tender-refund.ts`, `api/tender-refund-types.ts`, `i18n/strings.ts` | 8, 9 |
| `apps/till/src/till-app.ts`, `api/client.ts`, `api/line-cancel-types.ts`, `api/finish-table-types.ts` | 10, 11a |
| `apps/server/src/adjustments-api.ts` | 11a |
| `apps/till/src/widgets/cancel-item-dialog.ts`, `screens/till-table-order-screen.ts` | 11b |
| `apps/server/src/guide/en/table-service.md`, `es/table-service.md`, `docs/backlog.md`, `docs/backlog/till.md`, `docs/backlog/kitchen.md`, the design | 12 |

---

## Task 1: the flags and the link table (adjustments package)

**Files:** `packages/adjustments/src/schema/adjustments.ts:40-81`; new
`packages/adjustments/src/schema/refund-links.ts`; `schema/index.ts`; `classification.ts:4-20`;
`packages/migrations/migrations.manifest.json:106-109`; the generated `packages/adjustments/drizzle/`
files; `record.ts:15-79`; new `packages/adjustments/src/refund-links.ts`; `index.ts`.

**Interfaces:**
- Produces: `adjustments.chargeKept` (`flag("charge_kept").notNull().default(false)`) and
  `adjustments.preparationStarted` (`flag("preparation_started")`, nullable), both from
  `packages/db/src/schema/columns.ts`'s vocabulary (CLAUDE.md §3).
- Produces: `adjustmentRefunds` table `adjustment_refunds`: `id` (`id`, primary key, `newId`),
  `adjustmentId` (`id`, not null, foreign key → `adjustments.id`, restrict), `tenderRefundId`
  (`id`, not null, foreign key → `tender_refunds.id`, restrict), `amount` (`money`, not null,
  CHECK `> 0`), `createdAt` (`tsString`, `nowIso`); unique index
  `adjustment_refunds_adjustment_refund_key` on (`adjustment_id`, `tender_refund_id`); index on
  `tender_refund_id`.
- Produces: `NewAdjustment` gains `chargeKept?: boolean` (default false) and
  `preparationStarted?: boolean | null` (default null), written by `recordAdjustment`.
- Produces in `refund-links.ts`: `linkRefundToCancels(tx, { tenderRefundId, links: { adjustmentId:
  string; amount: Decimal }[] }): Promise<void>` (inserts; nothing else), and
  `readCancelsForRefund(tx, adjustmentIds: readonly string[]): Promise<{ id, workingOrderId,
  lineId, quantity, action, chargeKept, linked: Decimal }[]>`, where `linked` sums `amount` over
  links whose refund is `pending` or `completed`. Both exported from the package index.

- [ ] **Failing tests** in `packages/adjustments/src/record.test.ts` and a new
  `packages/adjustments/src/refund-links.test.ts` (database: `useVenueDb` with
  `migrationOptionsFor(manifestSets(), null)`, as `record.test.ts` does):
  (a) "records a charge-kept cancel with whether preparation had started": `recordAdjustment` with
  `chargeKept: true, preparationStarted: false`; the row reads back `chargeKept: true,
  preparationStarted: false`; (b) "defaults the flags for a comp": a `comp` row reads `chargeKept:
  false, preparationStarted: null`; (c) "links a refund to two cancels and reads what each holds":
  two cancel rows, one `tender_refunds` row (pending) — insert it as the existing tender-refund
  tests' fixtures do — `linkRefundToCancels` with €3.00 and €2.50; `readCancelsForRefund` answers
  `linked` 3.00 and 2.50; with the refund set `failed`, both 0.00; (d) "refuses an update and a
  delete of a link" with the domain refusal the append-only triggers raise (as
  `packages/adjustments/src/migrations.test.ts` pins for `adjustments`); (e) "refuses the same
  cancel linked twice to one refund" (the unique index's refusal, asserted by its message).
  Run `pnpm --filter @waitron/adjustments exec vitest run src/record.test.ts src/refund-links.test.ts`.
  Expected: typecheck-level failure on the unknown fields and the missing module.
- [ ] **Schema.** Add the two columns and the table. Classify `adjustment_refunds` with
  `appendOnly("adjustment_refunds", "ledger", "which cancelled dishes a refund paid back, and how
  much of it; nothing may change or remove it")`. Add it to the manifest's `appendOnlyTables` and
  to the module's migration descriptor's append-only set (find it with `git grep -n
  "appendOnlyTables\|appendOnly" packages/adjustments/src/migrations.ts`).
- [ ] **Generate** with `pnpm --filter @waitron/adjustments db:generate`. Read the SQL: expected
  two `ALTER TABLE adjustments ADD COLUMN …` and one `CREATE TABLE adjustment_refunds` with its
  indexes. **A `__new_adjustments` rebuild is a stop** (CLAUDE.md §3: a rebuild deletes cascading
  children and must not also add a column). Check the descriptor's `requires` names the set that
  owns `tender_refunds` if `scripts/module-graph-honesty.test.ts` asks for it.
- [ ] **Write the code** (`record.ts` insert; `refund-links.ts`). Run the two files (read the count).
- [ ] **Guard suites** (schema or migration, above). Read `migration-upgrade.test.ts`'s summary.
  **Measure the upgrade:** also apply the set to a database migrated to `origin/main`'s set with an
  `adjustments` row in it (the walk does this with synthetic rows) and record whether it passed.
  If it did, the PR needs no venue reset; if it did not, record the failure and stop. Typecheck
  `@waitron/adjustments`; the fiscal gates; `scripts/english-only.test.ts`.
- [ ] Commit — "Adjustments record whether a cancel kept its charge and had started, and which
  refund paid for it".

## Task 2: the cancel writes the flags and answers its refund links (server)

**Files:** `apps/server/src/line-cancel.ts` (keep-charge branch `:243-415`, started don't-charge
branch `:190-242`), `apps/server/src/adjustments-apply.ts` (`recordAdjustment` call `:932-962`),
`apps/server/src/line-cancel-api.ts:151-228`, `apps/server/src/finish-party-service.ts:55-195`,
`apps/server/src/till-api.ts` (the finish route, `:2860-2915`); tests in
`apps/server/src/line-cancel.test.ts`, `line-cancel-api.test.ts`, `finish-party-service.test.ts`.

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `cancelItem` answers `{ revision }`, plus `refundLinks: [{ lineId, adjustmentId }]`
  when `ask.refundHandoff === true`; `finishPartyService` answers `{ state: "closed" }`, plus
  `refundLinks` (one per handed-off dish) when any dish has `refundHandoff`. Both answers are the
  stored service-command result, so a replay answers the same ids.

- [ ] **Failing tests:**
  - `line-cancel.test.ts`: (a) "records a still-charge cancel of a started dish as charge kept and
    started": unpaid bill, started dish, `keep_charge` → the `adjustments` row has `chargeKept:
    true, preparationStarted: true`; (b) "records a paid-bill cancel answered No as not started":
    settled bill, fired not started, `keep_charge` with `preparationStarted: false` →
    `preparationStarted: false`, `chargeKept: true`; (c) "records a held dish on a paid bill as not
    started" (stage held, no question) → `false`; (d) "records a don't-charge cancel of a started
    dish as started, charge not kept" (the `applyAdjustment` path) → `chargeKept: false,
    preparationStarted: true`; (e) "a still-charge cancel of a dish comped to €0.00 is charge kept
    and a don't-charge one is not" (Review Focus 1: comp the dish Free first, as
    `adjustments-apply.test.ts` does; both rows have before = after = reduction = 0.00).
  - `line-cancel-api.test.ts`: (f) "answers the cancel's id for a refund handoff and replays it":
    settled bill, `refundHandoff: true` by a manager → `json` `toEqual({ revision: …,
    refundLinks: [{ lineId, adjustmentId: <the new row's id> }] })`; the same request again answers
    the same body; (g) "records the refund approver on a handed-off cancel": staff with a manager's
    `approver` PIN → the row's `approvedBy` is the manager; (h) the control: a paid-bill cancel
    with nothing ticked records `approvedBy: null` and answers `{ revision }` only.
  - `finish-party-service.test.ts`: (i) "answers a link for each handed-off dish and none for the
    others", two dishes, one handed off.
  Run `pnpm --filter @waitron/server exec vitest run src/line-cancel.test.ts src/line-cancel-api.test.ts src/finish-party-service.test.ts`.
  Expected: (a)–(e) fail on `chargeKept`/`preparationStarted` being `false`/`null`; (f), (i) on the
  missing `refundLinks`; (g) on `approvedBy` null; (h) passes.
- [ ] **Code.** Keep-charge branch: `chargeKept: true`, `preparationStarted: started`,
  `approvedBy: ask.refundHandoff === true ? ask.approver?.personId ?? null : null` (the approver
  reaches `cancelItem` already checked, `line-cancel-api.ts:209`); keep the id `recordAdjustment`
  returns (`packages/adjustments/src/record.ts:48`, `:78`; the keep-charge call at `line-cancel.ts:306`
  drops it today, while `adjustments-apply.ts:932` keeps it). The started don't-charge branch passes
  `preparationStarted: true` to `applyAdjustment` (harmless for the kitchen slips: `removeFromLine`
  ORs it with the item's own state, `working-order.ts:2919-2921`), and `applyAdjustment` records
  `preparationStarted: args.preparationStarted ?? null` on a cancel row. `finishPartyService`
  collects each handed-off dish's link from `cancelItem`'s answer.
- [ ] **Run** the three files (counts), then the server suites that pin these answers and rows:
  `pnpm --filter @waitron/server exec vitest run src/till-api.parties.test.ts src/adjustments-apply.test.ts src/adjustments-report.test.ts src/draft-discard.test.ts`.
  An existing `toEqual` over a whole `adjustments` row now meets two more keys: each is a fixture
  change listed under "Changed test checks" with the design point (D19), or a stop if it is not a
  cancel row. Typecheck `@waitron/server`; the fiscal gates.
- [ ] Commit — "A cancel records whether it kept the charge and had started, and answers its refund
  link".

## Task 3: the refund names the cancels it pays for (server)

**Files:** `apps/server/src/tender-refund-api.ts` (`parseRequest` `:99-116`),
`tender-refund-types.ts:5-14`, `tender-refund-reservation.ts` (fingerprint `:53-61`, insert
`:150-173`), `tender-refunds.ts:58-134`; tests in `tender-refund-reservation.test.ts`,
`tender-refund-api.test.ts`, and a new `apps/server/src/tender-refund-links.test.ts`.

**Interfaces:**
- Consumes: Task 1's `readCancelsForRefund`, `linkRefundToCancels`; Task 2's ids.
- Produces: `TenderRefundRequest.cancellationIds?: string[]` (UUIDs, lower-cased, no repeats, at
  most 100). The fingerprint includes `cancellationIds` sorted, **only when present**, so a request
  without them fingerprints as before this task.

- [ ] **Failing tests** in `tender-refund-links.test.ts` (adjustment venue; a settled table bill
  with two dishes cancelled with `refundHandoff`, as Task 2's tests do):
  (a) "links a refund to the cancels it names, split in the order sent" (Review Focus 2): dishes
  worth €7.50 and €5.50, refund €10.00 naming both → links €7.50 and €2.50; (b) "a second refund
  naming the same cancels links only what is left" → €3.00 on the second dish; (c) "a failed
  refund frees what it held": the first refund marked failed, a new one links again; (d) "refuses
  a cancel of another sale, a comp row, a don't-charge cancel, an unknown id and a repeated id"
  (Review Focus 3), each `management.request_invalid` with `field: "cancellationIds"`, and
  `tender_refunds` and `adjustment_refunds` unchanged; (e) "replays a linked refund without linking
  twice": same submission → same refund, link count unchanged; (f) "refuses the same submission
  with other cancels as reused" → `submission.id_reused`; (g) the control: a refund with no
  `cancellationIds` writes no link and its fingerprint equals one computed by today's object
  (assert the stored `fingerprint` equals `fingerprint({ …today's fields… })` from `./parties.js`).
  Run `pnpm --filter @waitron/server exec vitest run src/tender-refund-links.test.ts`. Expected:
  (a)–(f) fail (field ignored, no links); (g) passes.
- [ ] **Code.** Parse and validate the field in `parseRequest`; in the reservation, after the
  existing checks and before the insert's return, read the cancels with `readCancelsForRefund`,
  check each (a `cancel` row, `chargeKept`, its `workingOrderId` the sale's bill), compute each
  cap — the dish's filed value from `cancellationRefundValue(tx, billId, saleId, lineId)`, scaled
  to the cancel's `quantity` over the value's `quantity`, at `MONEY_SCALE` — less `linked`, and
  allocate the payment amount in order; write the links with the new refund's id. A replay returns
  before any of this (`tender-refund-reservation.ts:63-70`).
- [ ] **Run** the new file and `src/tender-refund-reservation.test.ts src/tender-refund-api.test.ts
  src/tender-refunds.test.ts src/tender-refund-authorization.test.ts` (counts). Typecheck; the
  fiscal gates.
- [ ] Commit — "A refund records which cancelled dishes it paid back".

## Task 4: no confirmation switch on a cash refund (server)

**Files:** `apps/server/src/tender-refund-api.ts:102`, `:110`, `:257`; `tender-refund-types.ts:11`;
`tender-refund-reservation.ts:49`, `:59`, `:90-91`; the server tests in "Changed test checks" rows
1–7.

The product hits are `git grep -n "cashConfirmed\|cash_confirm" -- apps/server` on `0abad3d7e`:
`tender-refund-api.ts:102, 110, 257`, `tender-refund-reservation.ts:49, 59, 90, 91`,
`tender-refund-types.ts:11` **(read)**. **(run)** `pnpm --filter @waitron/server exec vitest run
src/tender-refunds.test.ts src/tender-refund-reservation.test.ts -t "confirmation"`: 5 passed
(today's switch cases).

- [ ] **Change the pinned checks first** (rows 1–7), then add to `tender-refunds.test.ts`:
  "returns cash with no confirmation and opens the drawer as before": a cash refund with no
  `cashConfirmed` completes, and its drawer job is queued as the neighbouring drawer case expects;
  and to `tender-refund-api.test.ts`: "ignores a leftover cashConfirmed": a body carrying
  `cashConfirmed: true` reserves exactly as one without it (same stored fingerprint). Run the five
  files of rows 1–7. Expected: the new cases and changed rows fail on the field still required.
- [ ] **Code.** Remove the field from the type, the parser, the retry's rebuilt request and the
  reservation's check and fingerprint. The hand-keyed card's `manualConfirmed` stays everywhere.
- [ ] **Run** the five files; `git grep -n "cashConfirmed" -- apps/server` prints only test lines
  that check it is ignored. Typecheck; the fiscal gates.
- [ ] Commit — "A cash refund needs no confirmation switch".

## Task 5: the report reads the flags and the refunds (adjustments package)

**Files:** `packages/adjustments/src/reports.ts` (`AdjustmentEntry` `:94-118`, `readEntryRows`
`:304-342`, the sales credit `:386-389`, `:419-423`, `listAdjustmentEntries` `:474-525`);
`reports.test.ts`.

**Interfaces:**
- Produces: `AdjustmentEntry` gains `chargeKept: boolean`, `preparationStarted: boolean | null`,
  `refunded: { amount: string; state: "pending" | "completed" }[]` (failed refunds left out,
  Decision 7).

- [ ] **Failing tests** in `reports.test.ts`:
  (a) "credits a still-charged cancel's dish once to the person's sales" (Decision 8): one line
  credited to Ana at €12.00, cancelled with `chargeKept: true` → Ana's sales €12.00 (today
  €24.00 — run it first and write the failure's number in the task's report); the control, a
  don't-charge cancel (line deleted as the product path does), still credits €12.00;
  (b) "lists each cancel's charge, preparation and refunds": three cancel rows and two links, one
  to a completed refund and one to a pending → the entries carry the flags and `refunded`
  `[{ amount: "5.50", state: "completed" }]` and `[{ amount: "2.00", state: "pending" }]`; a link to
  a failed refund gives `[]`.
  Run `pnpm --filter @waitron/adjustments exec vitest run src/reports.test.ts`. Expected: (a) fails
  on the doubled figure; (b) on the missing keys.
- [ ] **Code.** Skip the credit for `chargeKept` rows; read the flags; read links joined to
  `tender_refunds` (core, via `@waitron/db`) for the page's entry ids in one query.
- [ ] **Readers of a €0.00 cancel row** (design §3.8 "The plan checks each of these"). List, with
  the command `git grep -n "from(adjustments)\|adjustments\." -- apps/server/src packages ':!*.test.ts'`,
  every reader of `adjustments` rows, and write in the task's report what each does with a
  charge-kept cancel: today's known ones are `readBillAdjustments` (leaves every cancel out,
  `record.ts:224`), the comp limits' counts by reason (`record.ts`, Void reasons never count
  against a Comp limit), and the report. Any reader that changes a bill amount or a payment from
  such a row is a stop and a report.
- [ ] **Run** `src/reports.test.ts src/routes.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/adjustments-report.test.ts` (counts; their
  whole-entry `toEqual`s meet three more keys — fixture rows in "Changed test checks"). Typecheck;
  `scripts/english-only.test.ts`; the fiscal gates.
- [ ] Commit — "The voids and comps report counts a still-charged dish once and reads its refunds".

## Task 6: the report shows "Void, charged", «En preparación» and "Refunded" (dashboard)

**Files:** `packages/adjustments/src/dashboard/adjustment-report-screen.ts` (`entryWords`
`:117-125`, `#entryColumns` `:685-779`), `dashboard/client.ts` (the entry type), `dashboard/strings.ts`
(`entries.void` `:164` / `:329`); `adjustment-report-screen.test.ts` and `.a11y.test.ts`.

**Words** (§3.9; Decision 7): `adjustment_report.entries.void_charged` "Void, charged" / «Cancelado,
cobrado»; `adjustment_report.entries.preparation` "Preparation started" / «En preparación»;
`adjustment_report.entries.yes` / `.no` "Yes" / "No", «Sí» / «No»; `adjustment_report.entries.refunded`
column "Refunded" / «Devuelto», cell "Refunded {amount}" / «Devuelto {amount}», pending "Refund
pending {amount}" / «Devolución pendiente {amount}».

- [ ] **Failing tests** (free memory checked): (a) "words a charge-kept cancel Void, charged" in
  English and Spanish, and a don't-charge one "Void"; (b) "shows whether preparation had started":
  Yes, No, and "—" for null; (c) "shows what was refunded for a cancel": a completed and a pending
  link in one cell, and nothing for a failed one; (d) the new columns are choosable and shown by
  default, and sort; (e) a11y in both themes with the new cells. Run
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/adjustment-report-screen.test.ts src/dashboard/adjustment-report-screen.a11y.test.ts`.
  Expected: (a)–(d) fail on the missing words and columns.
- [ ] **Code** and strings. Cells use `part=` for any styling (CLAUDE.md §3).
- [ ] **Run** both files and the column pins (row 12 of "Changed test checks"), the string guards,
  typecheck `@waitron/adjustments` and `@waitron/dashboard`.
- [ ] Commit — "The voids and comps report says Void, charged, whether preparation had started, and
  what was refunded".

## Task 7: a finished party is checked against its bills' zones (server)

**Files:** `apps/server/src/zone-access.ts:16-37`; a new
`apps/server/src/zone-access.finished-party.test.ts`.

- [ ] **Failing test** (model: the probe of Decision 9 and `line-cancel-api.test.ts:733-776`):
  (a) "refuses a finished party's cancellation read to a device outside its bill's zone": a paid
  table bill, its party finished with `finishPartyService` (no unserved dishes, so no
  cancellations), the profile limited to another zone → `GET …/cancellation` 403
  `service_zone.not_allowed`; (b) "serves it to a device in that zone" and (c) "to a device with no
  zone limit" → 200; (d) "refuses when any of the party's bills is outside" (two bills, one in each
  of two zones, the profile allowing one); (e) the control: an open party is still judged by its
  table's zone (move the table to another zone after the bill was made, if the fixtures allow it;
  otherwise say so in the task's report). Run
  `pnpm --filter @waitron/server exec vitest run src/zone-access.finished-party.test.ts`.
  Expected: (a) and (d) answer 200 today.
- [ ] **Code.** In `subjectZone`'s party branch: `partyZone(...)`, and when it is null and the party
  has no current table, every bill of the party (`workingOrders.partyId`) through
  `VENUE_SERVICE.findOrderZones`; `assertSubjectZones` checks each. Keep `partyZone` unchanged.
- [ ] **Run** the new file, `src/line-cancel-api.test.ts src/till-api.profile-zones.test.ts
  src/party-allergy-api.test.ts src/watch-zones.test.ts` (counts). A changed refusal code in an
  existing case (a closed party from an out-of-zone device now 403 where it was 409
  `party.not_open`) is a design change (§3.8 "Who may") and goes under "Changed test checks"; any
  other red is a stop. Typecheck; the fiscal gates.
- [ ] Commit — "A finished table's dishes are checked against its bills' zones".

## Task 8: no confirmation switch on a cash refund (till)

**Files:** `apps/till/src/widgets/tender-refund-dialog.ts` (`:34`, `:43`, `:160`, `:197`, `:229`,
`:240`, `:318-334`), `apps/till/src/state/tender-refund.ts:45`, `:60`,
`apps/till/src/api/tender-refund-types.ts:10`, `apps/till/src/i18n/strings.ts:107`, `:1841`; the
till tests in "Changed test checks" rows 8–13.

- [ ] **Change the pinned checks first** (rows 8–13), then add to `tender-refund-dialog.test.ts`
  "draws no switch for a cash payment and submits without one" (the a11y suite's cash state keeps
  passing). Run (free memory checked) `pnpm --filter @waitron/till exec vitest run
  src/widgets/tender-refund-dialog.test.ts src/widgets/tender-refund-dialog.a11y.test.ts
  src/widgets/tender-refund-dialog.unsaved.test.ts src/state/tender-refund.test.ts
  src/api/tender-refund-client.test.ts`. Expected: the new and changed cases fail on the switch.
- [ ] **Code.** Remove the switch, its draft field, its check, its refusal mapping, the request
  field and the `tender_refund.cash_confirm` string in both languages. The hand-keyed switch stays.
  `normalized()` keeps building a fresh object from the fields it knows, so an older saved attempt
  holding `cashConfirmed` loses it on read.
- [ ] **Run** the five files, `src/till-app-adjustments.test.ts -t "refund"` and
  `src/till-app.test.ts -t "A737"` (their helpers change, rows 12–13). `git grep -n
  "cashConfirmed\|cash_confirm" -- apps/till` prints nothing. Typecheck `@waitron/till`; the
  string guards.
- [ ] Commit — "The till's cash refund has no confirmation switch".

## Task 9: the refund screen's Reason is the drop-down, with the dishes under it (till widget)

**Files:** `apps/till/src/widgets/tender-refund-dialog.ts` (the typed field `:301-317`, `:411`;
the draft `:29-45`; `#choice` `:133-141`; first draft `:148-153`); `apps/till/src/i18n/strings.ts`;
`tender-refund-dialog.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`.

**Interfaces:**
- Produces new properties: `reasons: AdjustmentReason[] | null`, `reasonsLoading: boolean`,
  `startReasonId: string` (Decision 16; "" from a receipt), `dishes: string` (the line under the
  reason, e.g. "1 × Flan"; "" from a receipt), `target: string` (the ticked dishes' total; "" from a
  receipt), `refundAtTill: boolean`. The draft gains `reasonId` and `note`; the emitted ask's
  `reason` is the chosen reason's name, or the trimmed note when the reason asks for one
  (Decision 12). Event `tender-refund-reasons` (`bubbles`, `composed`) asks the app to load reasons.
- New strings: `tender_refund.left` "{amount} left to refund from another payment" / «Quedan
  {amount} por devolver de otro pago». Reused: `adjust.reason`, `adjust.reason_required`,
  `adjust.note`, `codeMessage("working_order.reason_required")` as the note's placeholder, as
  `finish-table-dialog.ts:338-371` does; `cancel_item.refund_at_till`.

- [ ] **Failing tests** (`tender-refund-dialog.test.ts`): (a) "offers the Void reasons in a
  drop-down that starts empty from a receipt" — the `wt-combobox` named `reason` lists only reasons
  whose `actions` include `cancel`, value ""; submitting without one marks it and keeps the action
  disabled; (b) "starts on the cancel's reason with the dishes on a line under it"; (c) "asks
  Other's note and sends the typed words as the reason"; (d) "sends a chosen reason's name";
  (e) "fills in the dishes' total, tip 0.00, on the one payment": `target` "5.50", one card payment
  with €62.00 → applied "5.50", tip "0.00"; (f) "fills in what one payment can return and says
  what is left": target €7.50, cash payment with €5.50 remaining → applied "5.50" and the line
  "€2.00 left to refund from another payment", then the till line when `refundAtTill`;
  (g) "shows a saved attempt's reason as its stored text" (Decision 12); (h) a reasons read that
  failed shows Retry, as the finish dialog does. `.unsaved.test.ts`: changing the reason or note
  marks the draft changed. `.a11y.test.ts`: the filled-in state and the "left" line, both themes.
  Run the three files. Expected: every new case fails (no drop-down, no filling).
- [ ] **Code.** Follow `finish-table-dialog.ts:338-393` for the drop-down, the note, the
  no-reasons line and Retry.
- [ ] **Run** the three files (counts); the string guards; typecheck `@waitron/till`.
- [ ] Commit — "The refund screen's reason is the Void reasons drop-down".

## Task 10: the refund opens filled in after a cancel, with its approval (till app)

**Files:** `apps/till/src/till-app.ts` — `#openHistoricalReceipt` (`:7318-7408`), `#openTenderRefund`
(`:7490-7516`), the refund dialog's mount (`:7647-7716`), `#sendItemCancellation`
(`:12750-12811`), `#readFinishDishes` (`:14765-14856`), `#sendFinishTable` (`:14928-15057`),
`#openFinishRefund` (`:15112-15132`), the receipts list (`:15178-15215`);
`apps/till/src/api/tender-refund-types.ts` (`cancellationIds`), `api/line-cancel-types.ts` and
`api/finish-table-types.ts` (`refundLinks`); tests in `apps/till/src/till-app-adjustments.test.ts`
and `apps/till/src/till-app-parties.test.ts`.

**Interfaces:**
- Consumes: Task 2's `refundLinks`; Task 3's `cancellationIds`; Task 9's properties.
- The refund state (`tenderRefunding`) gains, only when opened from a cancel: `startReasonId`,
  `dishes`, `target`, `cancellationIds`, `refundAtTill`, and `carried?: { personId: string; pin:
  string }` (Decision 3).

- [ ] **Failing tests:**
  - `till-app-adjustments.test.ts`, beside the cancel-and-refund case at `:3048-3120`: (a) "opens
    the refund filled in with the dish, its value and the cancel's reason": after `cancelItem`
    answers `refundLinks`, the dialog has `target` the dish's value, `startReasonId` the cancel's
    reason, `dishes` "1 × Flan", and submitting sends `cancellationIds: [<id>]`; (b) "sends the
    cancel's approver once and never stores it": staff cancel with a manager's PIN → the refund
    request carries `override` with that person and PIN; no `localStorage` key or value holds the
    PIN (scan every key); a second refund from the same screen sends none (Review Focus 4);
    (c) "asks again when the carried PIN is refused": `refundTransaction` rejects `pin.invalid` →
    the PIN prompt opens; (d) "never carries a PIN to a card keyed on a separate terminal";
    (e) "drops the carried PIN when the refund closes".
  - `till-app-parties.test.ts`, beside `:10978-11003` and `:11195-11243`: (f) "opens each sale's
    refund filled in with its ticked dishes" — two dishes on one sale ticked, one not → `target` the
    two values' sum, `dishes` "2 × Croquetas, 1 × Flan" (comma-joined in the dialog's order),
    `cancellationIds` both links; (g) on two sales, each receipt's refund gets its own; (h) "fills
    in the dish's share of a comp on the whole bill" (Review Focus 7, against A773-1's value read);
    (i) "offers no counter collection": the dialog has no third button (Decision 15).
  Run (free memory checked) `pnpm --filter @waitron/till exec vitest run src/till-app-adjustments.test.ts src/till-app-parties.test.ts -t "refund"`.
  Expected: (a)–(h) fail on empty props and a missing override; (i) passes.
- [ ] **Code.** Pass the props through `#openHistoricalReceipt`'s cancellation path and
  `#openFinishRefund`; load reasons for the refund dialog with the existing reasons read
  (`/api/adjustment-reasons`), on `tender-refund-reasons` too; send `override` from `carried` on the
  first submit only, then clear it; clear it on close, success, refusal and sign-out.
- [ ] **Run** both files whole (counts), `src/widgets/tender-refund-dialog*.test.ts`, the string
  guards, typecheck `@waitron/till`.
- [ ] Commit — "After a cancel, the refund opens filled in and does not ask for the PIN again".

## Task 11a: Finish table starts on "Not served"

**Files:** `packages/adjustments/src/provisioning.ts:54` (export the name), `packages/adjustments/src/index.ts`,
`apps/server/src/adjustments-api.ts:249-269`, `apps/till/src/api/client.ts:907-920`,
`apps/till/src/till-app.ts:15140-15153`; tests in `apps/server/src/adjustments-api.test.ts` (or
the suite that reads `/api/adjustment-reasons`; find it with `git grep -ln "adjustment-reasons\"" -- apps/server/src/*.test.ts`),
`apps/till/src/till-app-parties.test.ts`.

- [ ] **Failing tests:** server — "marks the Void reason named Not served as Finish table's start"
  (`startsFinishTable: true` on it only; false on a Comp reason named "Not served" if the check
  allows creating one, else on every other reason); "marks none once it is renamed". Till — "starts
  Finish table's reason on Not served", and "starts it empty when no reason is marked".
  Run the server file and `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts -t "Not served"`.
  Expected: missing field; empty start.
- [ ] **Code.** `NOT_SERVED_REASON = "Not served"` beside the starters (used by the starter list
  and the route); the till sets `.defaultReasonId`.
- [ ] **Run** the files (counts); any whole-reason `toEqual` on the reasons route gains the key
  ("Changed test checks"). Typecheck; `scripts/english-only.test.ts`.
- [ ] Commit — "Finish table's reason starts on Not served".

## Task 11b: Cancel item… offers a paid line's unserved quantity

**Files:** `apps/till/src/widgets/cancel-item-dialog.ts` (`#remaining` `:168-175`, `#options`
`:176-192`, `#refundAmount` `:208-223`), `apps/till/src/screens/till-table-order-screen.ts:2604-2615`;
`cancel-item-dialog.test.ts`, `till-table-order-screen*.test.ts` (find the Sent-line action cases
with `git grep -ln "data-sent-line-dialog" -- apps/till/src/screens`).

- [ ] **Failing tests:** dialog — "offers a paid line's unserved quantity": 3, 1 served → the
  stepper's max 2, value 2, Refund tick, and "Cancel and refund" shows two thirds of the filed
  €10.00 (€6.67 for 2 of 3; state the rounding the dialog's `share` uses) (Review Focus 6); the
  changed check row 14. Screen — "offers Cancel… on a paid bill's unserved slice only".
  Run the two files. Expected: no choices; Cancel offered on the served slice.
- [ ] **Code.** On a settled bill, `#remaining` subtracts served as the server does
  (`line-cancel.ts:137-140`); `#options` stops refusing a served component; the refund share
  counts the cancelled quantity as today. `#canVoidSent` refuses a `served` slice of a settled bill.
- [ ] **Run** the files, `cancel-item-dialog.a11y.test.ts`, `.unsaved.test.ts`,
  `cancel-item-preparation.test.ts`, `cancel-item-reasons.test.ts` (counts); typecheck.
- [ ] Commit — "Cancel item… on a paid bill offers what is not yet served".

## Task 12: guides, backlog and the design's dated note

**Files:** `apps/server/src/guide/en/table-service.md`, `es/table-service.md`; `docs/backlog.md`
(A758 `:2225-2268`; Loose ends `:1942-1948`); `docs/backlog/till.md` ("## A758");
`docs/backlog/kitchen.md` (Task 5 loose ends detail); the design (a dated note at its top).

- [ ] **Guides** (English and the Spanish twin, shared `{#id}`s; CLAUDE.md §3): a new section
  "Finish a paid table with food still to come {#finish-paid-table}" — every dish not served is
  cancelled, the Preparation started question, the Refund ticks, the reason starting on Not served,
  "Cancel" / "Cancel and refund", the till line on a device that cannot give money back; a new
  section "Cancel a dish on a paid bill {#cancel-paid-dish}"; and a section "Refund a payment on a
  receipt {#refund-receipt}" — the reason drop-down, Other's note, opened filled in after a cancel,
  "left to refund from another payment", no cash switch. Check the existing refund section
  (`table-service.md:9-23`) against Give back a payment's behaviour and leave it if still true.
  Run the guide suites.
- [ ] **`docs/backlog.md` A758:** after A758-5's sentence, "**A758-6 built the paid-table slice**
  ([plan](superpowers/plans/2026-10-22-a758-6-unserved-on-paid-table.md)): Finish table's reason
  starts on Not served; Cancel item… offers a paid line's unserved quantity; the refund opens filled
  in with the Void reasons drop-down and the dishes, without asking the PIN again; no cash switch;
  the report says Void, charged, whether preparation had started and what was refunded; a finished
  table is checked against its bills' zones." "Left:" becomes only "They'll collect it at the
  counter". Replace the deferred-"Void, charged" sentences (`:2261-2265`) with the built fact. The
  entry stays; never marked done.
- [ ] **Loose ends sub-bullet** (`:1943-1948`): delete it, saying in the commit that A773-2 (#1944)
  removes a finished party's food from the pass and Finish table on a paid table now cancels first;
  A908 keeps Record unpaid departure. Same in `docs/backlog/kitchen.md`'s detail.
- [ ] **New short entries**, each with its pointer: Give back a payment's reason as the drop-down
  (Decision 13); the owner points below, as one "owner looks at A758-6's words and choices" entry
  with the built pictures.
- [ ] **The design:** a dated note under its header: "_2026-10-22, A758-6: §3.8 item 5 (Table
  finished) is not built — since A773-2 (#1944) a finished party's food leaves the pass; see the
  plan's Decision 1._"
- [ ] `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`. Commit —
  "Guides and backlog: A758-6".

## Task 13: LOOK

Tests read text; nobody has seen these screens.

- [ ] Write a throwaway look harness per screen (not staged), as A758-4's Task 6 did: mount
  `till-finish-table-dialog` (picture 06's Table 4: 2 × Croquetas being prepared, 1 × Flan held,
  reason Not served), `till-cancel-item-dialog` on a paid partly served line (picture 07),
  `till-tender-refund-dialog` filled in (picture 08: card €62.00 → 5.50, Not served, "1 × Flan";
  and cash €5.50 with €2.00 left and the till line), and the report's entries list with Void,
  charged, «En preparación» and Refunded. Each in English and Spanish, light and dark, at 1280 and
  390 wide (`page.viewport`, never `commands.setViewportSize`; report `window.innerWidth`).
- [ ] Save the pictures under `docs/backlog/mockups/a758-adjustment-reasons/built/`, named
  `a758-6-<screen>-<lang>-<theme>-<width>.png`; delete the harness; `git status --short` shows only
  the pictures. Compare with pictures 06–08; fix a defect test-first; list a judgement call as an
  owner point. Commit — "Pictures of A758-6 as built".

**PR description** (plain English): first line — the review path, and "No venue reset needed" if
Task 1's measurement passed (else the reset line Task 1 wrote). Then what each screen now does, with
the pictures; the decisions above as owner points; Decision 14's retry case; Task 5's measured
double count; "Changed test checks" and "Fixtures grown"; the fiscal gates' counts and that no
filed record changes.

---

## Changed test checks

Each changes only because the design changes what it checks. Lines are on `0abad3d7e`; an
implementer who finds one moved records the new line.

| # | Task | Where | Old → new | Design |
|---|---|---|---|---|
| 1 | 4 | `apps/server/src/tender-refunds.test.ts:372-378` "does not return cash without confirmation" | refused `cashConfirmed` → "returns cash with no confirmation", completes | D24, §3.8.2 |
| 2 | 4 | `apps/server/src/tender-refund-reservation.test.ts:428-440` (`it.each([false, undefined])`, `field: "cashConfirmed"`) | case deleted; the cash request reserves | D24 |
| 3 | 4 | `tender-refund-reservation.test.ts:273-288` (`:277`, a changed `cashConfirmed` → id reused) | the changed field becomes `reason` | D24 |
| 4 | 4 | `tender-refund-reservation.test.ts:380-405` (`:393`, explicit `null` refused) | the `cashConfirmed` row goes; `manualConfirmed` stays | D24 |
| 5 | 4 | `apps/server/src/tender-refund-api.test.ts:477` (null refused), `:686` (`"true"` refused) | the `cashConfirmed` rows go | D24 |
| 6 | 4 | fixtures sending it: `tender-refund-api.test.ts:49`, `tender-refund-authorization.test.ts:205`, `tender-refund-management.test.ts:167`, `tender-refund-reservation.test.ts:171`, `tender-refunds.test.ts:240` | the field is dropped | D24 |
| 7 | 4 | the retry-by-id case that reads the rebuilt request (`tender-refund-api.ts:257`), if a test pins `cashConfirmed` on it | the key goes | D24 |
| 8 | 8 | `apps/till/src/widgets/tender-refund-dialog.test.ts:72`, `:125`, `:166`, `:189` (emitted asks) | lose `cashConfirmed` | D24 |
| 9 | 8 | `tender-refund-dialog.test.ts:88`, `:91` (switch reset on another payment), `:362` (required mark and description), `:372` (refusal shown on the switch), and the clicks at `:84`, `:116`, `:375` | the cash-switch cases go; the hand-keyed ones stay | D24 |
| 10 | 8 | `apps/till/src/state/tender-refund.test.ts:12` (fixture), `:98`, `:108` (locked on a changed flag → use `reason`), `:126`, `:132` (normalized keys), `:296` (`"true"` refused) | `cashConfirmed` leaves each | D24 |
| 11 | 8 | `apps/till/src/api/tender-refund-client.test.ts:57` | the field is dropped | D24 |
| 12 | 8, 10 | `apps/till/src/till-app-adjustments.test.ts:3073-3081` (`submitRefund` types a reason and flips the switch), `:3403` (event fixture), `:3534-3542` (expected request) | picks a reason from the drop-down; no switch; the request's `reason` is the reason's name and gains `cancellationIds` | D24, D26, §3.6 |
| 13 | 8, 10 | `apps/till/src/till-app.test.ts:23838` (fixture), `:23897` (helper flips the switch, types a reason) | as row 12 | D24, D26 |
| 14 | 11b | `apps/till/src/widgets/cancel-item-dialog.test.ts:601-608` "offers no paid cancellation for a served dish" (3, 1 served → no choices) | "offers the unserved 2 of a partly served paid line"; a wholly served line still offers none | §3.8 item 2 |
| 15 | 9 | `tender-refund-dialog.test.ts` cases that type into `wt-input[name=reason]` (find with `git grep -n 'name="reason"\|"reason"' -- apps/till/src/widgets/tender-refund-dialog*.test.ts`) | choose from the drop-down | D26 |
| 16 | 2, 5, 11a | whole-row or whole-entry `toEqual`s over `adjustments` rows, `AdjustmentEntry` or the till's reason wire, listed by the implementer with file:line as found | gain `chargeKept`, `preparationStarted`, `refunded`, `startsFinishTable` | D19, §3.6, §10 item 7 |
| 17 | 6 | `packages/adjustments/src/dashboard/adjustment-report-screen.test.ts` column pins of the entries list (sort table at `:1295`, any column list), listed with file:line as found | gain the Preparation started and Refunded columns | D19, §3.6 |
| 18 | 7 | an existing case that pins `party.not_open` for a closed party from a device outside its zone, if any | now 403 `service_zone.not_allowed` | §3.8 "Who may" |

**Unchanged, checked:** `apps/server/src/line-cancel-api.test.ts:597` and
`apps/server/src/till-api.parties.test.ts:295` pin answers with no refund handoff, which stay `{
revision }` and `{ state: "closed" }` (Decision 4). `apps/till/src/i18n/refund-wording.test.ts:7-10`
and `finish-table-dialog.test.ts:191` keep A803's English (Decision 11).
`apps/server/src/pass-lifetime.test.ts:206-220` stays (Decision 1). The fiscal gates.

If a suite turns red on a check not in this table, it is a stop and a report, then a new row here.

## Fixtures grown

- `scripts/migration-upgrade.test.ts` `CANDIDATES`: sample values for `adjustment_refunds` columns,
  only if the walk asks (Task 1).
- `apps/server/src/testing/adjustment-venue.ts`: a helper that cancels a paid dish with
  `refundHandoff` and pays the bill, if Tasks 2, 3 and 7 share one (listed with its signature).
- The throwaway look harnesses of Task 13 are not committed.

## Owner points (each with the default this PR builds)

1. **No "Table finished" on the pass** (Decision 1): finished tables' food already leaves the pass.
2. **"Not served" recognised by its English name** (Decision 2); a renamed one stops being the start.
3. **The PIN given for "Cancel and refund" is kept in the till's memory until that refund is sent**,
   once, never for a separately keyed card (Decision 3).
4. **"Refund pending €x"** («Devolución pendiente …») is new, our words (Decision 7).
5. **A still-charged cancelled dish is now counted once in the person's sales** (Decision 8).
6. **A803's English for the till line** stays (Decision 11).
7. **Give back a payment keeps its typed reason** for now (Decision 13).
8. **A refund in flight across the upgrade** sent again with its first submission is refused as
   reused; checking it by its refund id still works (Decision 14).
