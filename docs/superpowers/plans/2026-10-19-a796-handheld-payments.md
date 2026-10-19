# A796 — Paying at the table from a handheld: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**No migration.** Nothing in this plan adds or changes a table, a column, an index or a trigger.
The one server data change is provisioning's seed (Task 3) and new rows in an existing table,
`device_profile_card_readers`, written by an existing kind of request (Task 4). Checked: the design
says so (§5, "No migration, and nothing new stored on the phone"), and no task below touches a
`schema/` or `drizzle/` file. If an implementer finds they need one, that is a STOP: report it,
because it changes how the campaign may schedule this item.

**Review path: FULL** (payments, a till route's request body, the device profile's actions, a
cross-package write; two Codex reviews at `/finish-branch`). **One branch, one pull request**:
branch `feat/a796-handheld-payments`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a796-handheld-payments`, from `main` at
`942a0ed64`. The design suggests a pull request per slice; nothing here is live yet, so the parts
land together, in order, each commit leaving the branch green. Implementers are dispatched as
`subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-10-19-a796-handheld-payments.md`
current after every task.

**Goal:** a waiter settles a table's bill from the phone: the payment sheet names the card reader it
will charge and the receipt printer, both already set to what the phone last chose and folded away;
a QR button and the background NFC listener change them from inside the sheet; the reader is asked
for the card; an uncertain card refreshes itself; the table's last payment shows a short paid screen
with Cerrar mesa. Along the way, a live defect is fixed on every device: the next identical bill
payment can no longer be answered with an unanswered one.

**Architecture:** almost all of it is in `apps/till`. The existing bill payment dialog,
`till-bill-pay-dialog`, gains a `handheld` mode (set from `till-app`'s existing `handheldMode`) that
adds the way "Toda la cuenta", the explicit method "Otro datáfono", a new child element
`till-pay-equipment` (the folded reader-and-printer row), the waiting, uncertain and next-guest
states. A new `till-presented-pay-dialog` pays a presented bill whole, and a new `till-paid-view`
replaces the ticket view on a handheld once a bill is paid. The row reads and writes the phone's
existing equipment choices (`GET`/`PUT /api/device/equipment`) through `till-app`'s existing
one-at-a-time equipment queue; no payment route changes shape, and every handheld card request
names its reader. The server changes are the Móvil seed and new readers joining the reader lists of
profiles that take reader payments. Counter tills keep today's dialog except for Part 1, which
fixes every device.

**Tech stack:** TypeScript, Lit, Vitest in real headless Chromium (every `apps/till` test is a
browser test: `apps/till/vitest.config.ts:43-53`), Hono and Drizzle on `node:sqlite` on the server.

**Spec:** `docs/superpowers/specs/2026-10-19-a796-handheld-payments-design.md`, Revision 4 (§3 the
flow, §4 edge cases, §5 data, routes and build slices, §8 defaults, especially 1–3, 7–12, 15, 16 and
18–22). Pictures: `docs/backlog/mockups/a796-handheld-payments/` 2–8, 10–12. Executors read the
design and look at the pictures before starting a task.

---

## Words used in this plan

- **The sheet**: the payment dialog as a handheld shows it (`till-bill-pay-dialog` with
  `handheld` set, or `till-presented-pay-dialog`). It is the shared `wt-dialog`, centred as today
  (design default 14 leaves bottom placement to the plan; `wt-dialog` has no bottom placement, and
  adding one is not needed for this item).
- **The row**: `till-pay-equipment`, the folded "Lector e impresora" line with its two drop-downs.
- **Uncertain send**: a bill payment request this phone sent that got no answer from the server
  (a network failure), so it may or may not have been recorded.
- **A pick**: a change of the phone's card reader or receipt printer sent as
  `PUT /api/device/equipment` (`EquipmentChange`, `apps/till/src/api/client.ts:1592-1604`).
- **Handheld**: `till-app`'s `handheldMode` (`apps/till/src/till-app.ts:1968`, set at `:3040-3041`
  from `kindOfFormFactor(identity.formFactor) === "handheld"`, `apps/till/src/layout.ts:24-37`).

## Global constraints

Every task's requirements include these.

- **Every commit `git commit -s`.** Never `--no-verify`. Stage explicit paths only.
- **Fiscal golden tests pass unedited**: `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`. Tasks 3 and 4 (the only server tasks) run
  both: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **A test that must be EDITED to pass is a STOP** — report, do not edit — with two exceptions:
  1. a test this plan lists under its task's **"Tests the spec changes"**, edited only as described
     there, each edit named in the commit message and later in the PR description;
  2. adding what a stub or fixture lacks (a new property a mock must answer, a helper moved
     verbatim out of a test file into `apps/till/test/`), with no assertion changed, named in the
     commit message and the PR.
- **No new server error codes are expected.** If a task needs one, it is registered in the
  throwing package's `errors.ts` and gets English and Spanish wording in `apps/till/src/i18n/codes.ts`
  (and `apps/dashboard/src/i18n/codes.ts` if the dashboard can show it), with a case in
  `apps/till/src/i18n/codes.test.ts`; say so in the PR.
- **The drawer.** Nothing here queues a `drawer` job or adds a route that can. Móvil does not get
  `open-cash-drawer` (default 15); a cash payment on Móvil opens no drawer (Task 3 pins it). A card
  on a connected reader never opens the drawer (unchanged; `apps/server/src/bill-payments-api.test.ts:4987`).
- **Nothing external blocks a sale.** No task adds a call to AEAT, a provider or the internet on the
  payment path; a printer that has gone never holds up a payment (default 19).
- **Automatic reads stay passive.** The till's auto-logout counts only `pointerdown` and `keydown`
  (`#onInteraction`, `till-app.ts:1703`, listeners at `:1751-1752`). The 5-second re-read (Task 17)
  and the re-read when the sheet opens (Task 9) never call `#onInteraction`.
- **Forms** follow `docs/developers/conventions-ui.md` → "New or changed forms use the shared UI
  contract": a required field is marked; a refusal that names a shown field shows under it; a
  refusal never disables the action by itself; the bottom message sits in `wt-form-actions`. A
  drop-down is a `wt-combobox` (`packages/ui/src/components/wt-combobox.ts`, `search="never"`),
  never a native `<select>` (guard `scripts/native-form-fields.test.ts`). Every input has a semantic
  `name`. A field's hint is its placeholder.
- **Tokens only**: every colour, spacing, radius and font in new styles reads a `--wt-*` token
  (guard `scripts/style-token-names.test.ts`).
- **Events**: app-owned elements may name events plainly; each is dispatched
  `bubbles: true, composed: true` like the dialog's `#emit` (`bill-pay-dialog.ts:796-797`).
- **Product text** is quoted from the pictures where they draw it, and is given in full, English
  and Spanish, in each task. `apps/till/src/i18n/strings.ts` holds `en` (`:4`) and
  `es: Record<StringKey, string>` (`:1588`); the type checker enforces both.
- **Guides**: no user guide covers a till screen today (`apps/server/src/guide/{en,es}` hold only
  `content-and-images.md`, `modifiers.md`, `products.md`), so no guide is updated. Task 22 records
  that in the backlog rather than writing one.
- **Every task ends with**: its focused tests; `pnpm --filter <pkg> typecheck` for every package it
  touched; `pnpm exec prettier --check <changed files>`; reading each run's `Tests` count (a run that
  prints none proves nothing). Before any browser run check `memory_pressure | grep free` and run
  beside another session's browser run only when free memory is well above 15%.
- **Coverage bars 98/98/98/95** hold in every package touched; CI enforces them. A new branch gets a
  test, never an ignore comment.
- **An implementer past about 150 tool calls** with the task unfinished stops at a passing or
  cleanly red point, commits, and returns a handover: done, left, files, each check's state.
- **LOOK steps** (UI tasks): add a case to the element's `*.a11y.test.ts` (or a `look` case beside
  it) that, for each of `light` and `dark` and widths 390 and 1280, calls `page.viewport(width, 900)`,
  asserts `window.innerWidth === width`, and saves
  `page.screenshot({ element, path: \`__screenshots__/look/a796-<name>-<theme>-<width>.png\` })`,
  as `apps/till/src/widgets/menu-browser.a11y.test.ts:200-235` does. Then open the PNGs and LOOK:
  text wraps inside the sheet at 390, buttons stay in view, dark is not light. Read the dialog's
  computed background in each theme and reject the capture if they match
  (`docs/developers/testing-guide.md:1785-1811`). Report the measured widths.

## Review focus

Five ways a waiter could be hurt that the design implies but its slices do not name a test for.
Each has a test in the task that owns the code.

1. **The phone lost its reader while the sheet sat on the confirmation step** (another phone
   scanned it). Cobrar is refused `reader.not_held`, nothing is charged, the refusal shows under the
   reader field in the sheet's own words, and the row opens with the reader empty. → Task 21.
2. **The 5-second re-read outlives its sheet**: after the sheet closes, after logout, or once the
   pending card settles, no further `GET …/payments` is sent. → Task 17.
3. **The automatic pick fires twice** (the 15-second poll or a tap lands while it is out), taking a
   reader twice or after the waiter picked another. It is sent at most once per sheet opening, and
   never once the phone has a reader. → Task 19.
4. **A long reader or printer name on a 390-pixel phone** pushes QR, NFC or Cambiar off the row.
   The summary wraps and the buttons stay inside the row. → Task 6 (a width assertion, plus LOOK).
5. **A pick still being sent when Cobrar is pressed** charges a reader the server has not given the
   phone. Cobrar and Continuar are disabled until the pick is answered. → Task 9.

---

## Part 1 — the resend fix, on every device (design slice 1, default 7)

Fixes the backlog entry "The next identical bill payment can be answered with an unanswered one".

### Task 1: lock the dialog while a bill payment is uncertain

**Goal:** after a bill payment gets no answer, the dialog for that bill offers only "Comprobar de
nuevo", which resends the same request under the same submission id; no new payment of any way or
method can be started on that bill from this phone until an answer comes. Closing, reopening and
logging out keep the lock (the kept submission already survives them).

**Risk triggers:** payments; concurrency (resends and idempotency). **Per-task review: yes.**

**Files:**
- Modify: `apps/till/src/state/bill-payment.ts` (`submissionFor` `:143-150`, `unansweredAfter`
  `:173-177`, `FRESH_ID_AFTER` `:156-161`)
- Modify: `apps/till/src/till-app.ts` (`#unansweredPayment` `:2640`, `#onBillPayConfirm`
  `:12107-12150`, `#onBillPayRefused` `:12204-12235`, `#renderBillPaying` `:8324-8351`)
- Modify: `apps/till/src/widgets/bill-pay-dialog.ts` (a lock view)
- Modify: `apps/till/src/i18n/strings.ts`
- Test: `apps/till/src/state/bill-payment.test.ts`, `apps/till/src/till-app-bill-payments.test.ts`,
  `apps/till/src/widgets/bill-pay-dialog.test.ts`, `apps/till/src/widgets/bill-pay-dialog.a11y.test.ts`

**Decision — what "unanswered" means.** Today `unansweredAfter` keeps the submission after *any*
refusal outside `FRESH_ID_AFTER`, including a first send refused for a typed amount. Locking on that
would trap a waiter behind "Comprobar de nuevo" for a request the server never recorded. So the lock
holds only while the send is **uncertain**: a send of that submission got no answer (a network
failure, `isNetworkFailure`). It stays uncertain through a later refusal the server raises **before**
it looks the submission id up, because such a refusal says nothing about the first send
(`unansweredAfter`'s own comment). It ends on: a result; a `FRESH_ID_AFTER` refusal; or any refusal
raised **after** the look-up (`findSubmission`, `apps/server/src/bill-payments.ts:1049-1056`), which
proves the id was never recorded. The codes raised before the look-up come from the route
`POST /api/working-orders/:id/payments` (`apps/server/src/bill-payments-api.ts:222-256`:
`requireSession`, `gateZones`, `parseRequest`, `assertTakesTender`, `resolveCardCollector`) and from
`beginBillPayment`'s `assertStillSignedIn` (`bill-payments.ts:1044-1050`, raising `session.required`
and `device.unauthorized`, `apps/server/src/till-session.ts:152,157`). The implementer reads those
calls and writes the list into `BEFORE_LOOKUP` with a one-line pointer to these two places; expect
it to include `session.required`, `session.not_open`, `device.unauthorized`,
`authorization.not_permitted`, `device.forbidden_action`, `device.cash_not_allowed`,
`reader.not_found`, `reader.provider_disconnected` and the zone gate's code. A code missing from the
list ends the lock early (the old risk); a code wrongly in it keeps the lock until the next answer —
so when unsure, leave a code out and say so in the handover.

**Interfaces:**
- Produces, in `apps/till/src/state/bill-payment.ts`:
  - `export interface PendingSend { billId: string; submission: Submission; uncertain: boolean }`
  - `export const BEFORE_LOOKUP: ReadonlySet<string>`
  - `export function pendingAfter(sent: PendingSend, error?: unknown): PendingSend | null` — null
    on a result or a `FRESH_ID_AFTER` code; `{...sent, uncertain: true}` on a network failure;
    `sent` unchanged for a `BEFORE_LOOKUP` code; for any other refusal, null when `sent.uncertain`
    (the look-up found nothing) and otherwise `{...sent, uncertain: false}` kept as today's resend
    key. `unansweredAfter` stays for refunds.
  - `export function lockFor(pending: PendingSend | null, billId: string): PendingSend | null` —
    the pending send when it is this bill's and uncertain.
- Produces on `till-bill-pay-dialog`: `@property({ attribute: false }) unanswered: { applied: string; method: "cash" | "card" } | null = null`;
  event `bill-pay-recheck` (detail `{}`). While `unanswered` is not null the dialog shows only the
  lock view, whatever `asked`/`preview` hold.
- `till-app`: `#unansweredPayment` becomes `#pendingPayment: PendingSend | null`; a new
  `#onBillPayRecheck()` resends `#pendingPayment.submission.request` verbatim through the same
  `#holdingReload` → `#withReaderPayment` → `#resend` path as `#onBillPayConfirm`, and settles with
  `pendingAfter`.

**Strings** (`bill_pay.unconfirmed` keeps its key and is reworded):
- `bill_pay.unanswered_title`: en "No connection to the server" / es "Sin conexión con el servidor"
- `bill_pay.unconfirmed`: en "The server did not answer, so this payment may or may not have been
  taken. Press Check again: it asks about this same payment, and it will not be recorded twice." /
  es "El servidor no ha respondido, así que este pago puede haberse cobrado o no. Pulsa Comprobar de
  nuevo: se pregunta por este mismo pago y no se registrará dos veces." (picture 7, right)
- `bill_pay.recheck`: en "Check again" / es "Comprobar de nuevo"

- [ ] **Step 1: Write the failing till case** (the backlog entry's own test), in
  `till-app-bill-payments.test.ts` under "a bill payment's refusals and retries":
  `it("after an unanswered contribution, the next guest's identical contribution cannot reuse it: only the same payment can be checked again")`.
  Mock `takeBillPayment` to reject `new TypeError("Failed to fetch")` for every attempt of the first
  send. Contribute 40 cash, 50 tendered; confirm; poll until the form message is
  `t("bill_pay.unconfirmed")`. Close the dialog (`bill-pay-close`) and reopen it with
  `openDialog(el, "contribution")`. Assert: `inDialog(el, "[data-pay-unanswered]")` is not null;
  `inDialog(el, "[data-pay-continue]")` is null; `inDialog(el, "[data-pay-confirm]")` is null.
  Then answer the next call with `takenOf(...)`, press `[data-pay-recheck]`, and assert the last
  sent `submissionId` equals the first. Then open the dialog again, make the same contribution,
  confirm, and assert this send's `submissionId` differs from the first.
- [ ] **Step 2: Write the failing unit cases** in `bill-payment.test.ts`, new describe
  `"a payment that got no answer"`: `pendingAfter` returns `uncertain: true` after
  `new TypeError("Failed to fetch")`; stays uncertain after `{ code: "session.required", status: 401 }`;
  becomes null after `{ code: "bill.allocation_changed", status: 409 }` while uncertain; becomes
  null after a result (`undefined` error); after `{ code: "bill.nothing_outstanding" }` on a send
  that was never uncertain it is kept with `uncertain: false`; `it.each([...FRESH_ID_AFTER])` gives
  null; `lockFor` returns null for another bill and for `uncertain: false`.
- [ ] **Step 3: Write the failing dialog cases** in `bill-pay-dialog.test.ts`, new describe
  `"till-bill-pay-dialog: a payment that got no answer"`: with `unanswered = { applied: "40.00", method: "cash" }`
  the dialog shows `[data-pay-unanswered]` holding `t("bill_pay.unanswered_title")`, the form
  message `t("bill_pay.unconfirmed")`, one primary `[data-pay-recheck]` reading
  `t("bill_pay.recheck")`, no `[data-pay-back]`, no `[data-pay-continue]`; pressing it emits
  `bill-pay-recheck`; while `busy` it is disabled and loading.
- [ ] **Step 4: Run them; they fail** —
  `pnpm --filter @waitron/till exec vitest run src/state/bill-payment.test.ts src/widgets/bill-pay-dialog.test.ts src/till-app-bill-payments.test.ts -t "no answer|unanswered|identical contribution"`.
  Expected: FAIL (`pendingAfter` not exported; no `[data-pay-unanswered]`).
- [ ] **Step 5: Implement** `PendingSend`, `BEFORE_LOOKUP`, `pendingAfter`, `lockFor`; the dialog's
  lock view (body: the title in a tone box `data-pay-unanswered`; footer: `wt-form-actions` whose
  `error` is `t("bill_pay.unconfirmed")` and whose only button is `[data-pay-recheck]`); in
  `till-app`, `.unanswered=${...}` from `lockFor(this.#pendingPayment, open.billId)` (applied from
  the submission's `request.applied`, method from `request.method`), `@bill-pay-recheck`, and
  `#onBillPayConfirm`'s `settle` writing `pendingAfter`. `submissionFor` keeps its key rule (a
  refused-but-certain send resent identically still reuses its id, which the server never recorded).
- [ ] **Step 6: Run Step 4's command, then the whole bill payment suites**:
  `pnpm --filter @waitron/till exec vitest run src/till-app-bill-payments.test.ts src/state/bill-payment.test.ts src/widgets/bill-pay-dialog.test.ts src/widgets/bill-pay-dialog.unsaved.test.ts src/widgets/bill-pay-dialog.a11y.test.ts`.
  Expected: PASS except the tests listed below, which the spec changes.

**Tests the spec changes** (default 7 replaces "take it again" with "Comprobar de nuevo"):
- `till-app-bill-payments.test.ts:1150` "offers to take a payment that never got an answer again,
  under the same submission id": press `[data-pay-recheck]` instead of `[data-pay-confirm]`. The
  assertions (the form message, one submission id) stay.
- `:2072` "keeps the next operator's payment that got no answer when an earlier operator's payment
  is answered late" and `:2111` "resends the next operator's unanswered payment under its own id…":
  the final press becomes `[data-pay-recheck]`; assertions unchanged.
- `:2153` "sends the next operator's same payment under the id of one that got no answer after its
  operator logged out": the next operator's dialog now opens on the lock, so the second
  `payTheRest(el)` becomes opening the dialog and pressing `[data-pay-recheck]`; the assertion
  `expect(next).toBe(earlier)` stays.
- Any other red test is a STOP.
- [ ] **Step 7: Add the lock view to `bill-pay-dialog.a11y.test.ts`'s two-theme describe**
  (`"a payment that got no answer"`), and run that file.
- [ ] **Step 8: Typecheck, format, commit** — `pnpm --filter @waitron/till typecheck`;
  `git commit -s -m "Bill payments: while a payment got no answer, offer only Check again (A796 default 7)"`.

### Task 2: ask before a second card when a card is already in progress

**Goal:** if the phone lost its kept submission (the browser was killed), the reopened dialog shows
the pending card "En curso" with its amount reserved (today's payments list and balance already do,
`bill-pay-dialog.ts:864-938`), and before a card payment on a bill whose balance holds a pending
card it asks "Hay un pago con tarjeta en curso en esta cuenta. ¿Cobrar otro?". Cash and
another-machine payments are not asked. Every device.

**Risk triggers:** payments. **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts`, `apps/till/src/i18n/strings.ts`.
Test `apps/till/src/widgets/bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`.

**Interfaces:** consumes `BillBalance.payments[].state === "pending"` and `.method === "card"`
(`apps/till/src/api/client.ts:1011-1019`). The question is an inline confirmation inside the form:
while it shows, Continuar and Enter submission are suspended (conventions-ui.md, "An inline
confirmation embedded IN a form suspends that form's Save").

**Strings:**
- `bill_pay.card_in_progress_ask`: en "A card payment is in progress on this bill. Take another?" /
  es "Hay un pago con tarjeta en curso en esta cuenta. ¿Cobrar otro?"
- `bill_pay.card_in_progress_take`: en "Take another" / es "Cobrar otro"

- [ ] **Step 1: Write failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: a card already in progress"`: with a balance holding one pending card
  payment and `unanswered` null, choosing card and pressing Continuar emits no `bill-pay-preview`
  and shows `[data-pay-card-ask]` with the question; pressing `[data-pay-card-ask-take]` emits
  `bill-pay-preview` once; pressing `[data-pay-card-ask-back]` hides the question and emits nothing;
  with cash chosen, Continuar emits at once; with no pending card, card emits at once.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "already in progress"` — FAIL.
- [ ] **Step 3: Implement** a `@state() private askingSecondCard = false` and the inline question in
  `#form()` above `wt-form-actions`, entered from `#continue()` (`:800`).
- [ ] **Step 4: Run** Step 2's command and the dialog's full test, unsaved and a11y files — PASS.
  Add the question to the a11y file's two-theme describe.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payments: ask before a second card while one is in progress (A796 default 7)"`.

---

## Part 2 — the handheld profile and new readers (design slice 2, defaults 15 and 16)

### Task 3: Móvil takes reader cards, cash and prints receipts; never the drawer

**Goal:** the seeded handheld profile's actions become, in this order:
`["take-orders", "take-cash", "integrated-card-payment", "hand-keyed-card-payment", "print-receipt", "prepare-orders", "hand-over-orders", "clock-in"]`
(picture 10, right). No `open-cash-drawer`. No default reader: no seed writes
`device_profile_card_readers` today (checked: only `apps/server/src/payments-api.ts` and
`card-reader-delete.ts` write it outside tests), and this task keeps it so.

**Risk triggers:** auth and permissions (profile actions); the drawer rule. **Per-task review: yes.**

**Files:**
- Modify: `packages/layouts/src/device-profile.ts:110-116`
- Test: `packages/layouts/src/device-profile.test.ts:230-236`,
  `packages/provisioning/src/venue-plan.test.ts:111-121`,
  `packages/provisioning/src/venue-apply.test.ts:402-411`,
  `apps/server/scripts/dev-setup.test.ts:322-331`
- Test (new case): `apps/server/src/bill-payments-api.test.ts`

**Tests the spec changes** (default 15 changes the seed): the four pinned lists above take the new
list, nothing else in them changes.

- [ ] **Step 1: Write the failing drawer case** in `bill-payments-api.test.ts`, beside the card case
  at `:4987`: `it("a cash bill payment from a device on the seeded handheld profile queues no drawer job")`
  — a device whose profile has `DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]` and a receipt
  printer with a drawer takes a cash bill payment; assert the response is 200 and no print job of
  kind `drawer` exists. Before the seed change it fails with the cash refusal
  (`device.cash_not_allowed` or the `take-cash` action refusal); after, it passes on the drawer
  assertion. Say in the commit which refusal it printed first.
- [ ] **Step 2: Update the four pinned lists** (the listed spec change) and run them — they fail
  against today's seed.
- [ ] **Step 3: Change `DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]`.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run src/venue-plan.test.ts src/venue-apply.test.ts`,
  `pnpm --filter @waitron/server exec vitest run scripts/dev-setup.test.ts src/bill-payments-api.test.ts -t "seeded handheld|no drawer"` — PASS.
- [ ] **Step 5: Run the whole server, layouts and provisioning suites** (a seed change breaks
  sibling fixtures that build devices from the seed; about twenty server test files name
  `"phone-portrait"`): `pnpm --filter @waitron/server test:coverage`, then the same for
  `@waitron/layouts` and `@waitron/provisioning`. Any red test outside the four listed is a STOP.
  Then the fiscal golden tests (Global constraints).
- [ ] **Step 6: Typecheck, format, commit** — `"Móvil takes reader cards and cash and prints receipts; never the drawer (A796 default 15)"`.

### Task 4: a new card reader joins every profile that takes reader payments

**Goal:** when a manager adds or adopts a card reader that did not exist before, it is appended to
the reader list of every live device profile that has `integrated-card-payment`, never as that
profile's default (default 16). Re-adopting a disabled reader (the adopt route reuses its id,
`payments-api.test.ts:1313`) changes no list: a manager may have taken it off on purpose. The
practice venue's demo reader, written at boot (`apps/server/src/boot.ts:380-414`), joins nothing.

**Risk triggers:** payments; cross-package contract (`@waitron/payments` written from
`apps/server`, profiles read from `@waitron/layouts`). **Per-task review: yes.**

**Files:**
- Modify: `packages/payments/src/device-readers.ts` (beside `setProfileReaderList`, `:63-86`)
- Modify: `apps/server/src/payments-api.ts` (adopt `:457-505`, add `:719-768`)
- Test: `packages/payments/src/device-readers.test.ts`, `apps/server/src/payments-api.test.ts`

**Interfaces:**
- Produces: `export async function appendReaderToProfiles(tx: Transaction, readerId: string, profileIds: readonly string[]): Promise<void>`
  in `device-readers.ts` — inserts `(profileId, readerId, position = max + 1, isDefault = false)`
  for each profile that does not already list it, and acquires nothing for any device (as
  `setProfileReaderList` → `settleProfileReaderDevices` acquires nothing).
- The route works out the profile ids with `listDeviceProfiles` (`packages/layouts/src/device-profile-store.ts:107`,
  which skips retired profiles) and `profileAllows(profile, "integrated-card-payment")`
  (`packages/layouts/src/device-profile.ts:34-40`, false for `kds`), inside the same transaction as
  the insert.

- [ ] **Step 1: Failing package cases** in `device-readers.test.ts`: appends at the end of an
  existing list, not default; a profile with no list gets position 0; a profile already listing it
  is unchanged; a device on Use default on that profile holds nothing afterwards.
- [ ] **Step 2: Failing route cases** in `payments-api.test.ts` under "reader adoption and local
  management" (`:1297`): adopting a new reader lists it on the till profile and the Móvil profile,
  default unchanged, and not on Cocina; adding one through `POST /management-api/payments/readers`
  does the same; re-adopting a disabled reader's id after a manager took it off a list leaves it off.
- [ ] **Step 3: Run** `pnpm --filter @waitron/payments exec vitest run src/device-readers.test.ts -t append`
  and `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "adopt|joins"` — FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** Step 3's commands, then `pnpm --filter @waitron/payments test:coverage` and
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts src/card-reader-delete.test.ts src/device-equipment.test.ts`
  — PASS. Root guards: `pnpm exec vitest run scripts/module-seams.test.ts scripts/write-path-tables.test.ts scripts/workspace-cycles.test.ts`.
  Then the fiscal golden tests.
- [ ] **Step 6: Typecheck (`@waitron/payments`, `@waitron/server`), format, commit** —
  `"A new card reader joins every profile that takes reader payments, never as default (A796 default 16)"`.

---

## Part 3 — the pay sheet on a handheld (design slice 3)

### Task 5: what the row shows, worked out from the equipment read

**Goal:** pure functions that turn the phone's `DeviceEquipment` into the row's reader and printer
states, so every later task reads one model. Also make Equipment's option labels shareable.

**Risk triggers:** payments (decides which reader the sheet names); cross-package contract (the
shape of `GET /api/device/equipment`). **Per-task review: yes.**

**Files:**
- Create: `apps/till/src/state/pay-equipment.ts`, `apps/till/src/state/pay-equipment.test.ts`
- Create: `apps/till/src/widgets/equipment-labels.ts` (move `fill` and `optionLabel` out of
  `equipment-dialog.ts:53-62`, unchanged; `equipment-dialog.ts` imports them)
- Possibly modify: `apps/server/src/device-equipment.test.ts` (see Step 1)

**Interfaces** (all in `pay-equipment.ts`; `RoleEquipment`, `EquipmentItem`,
`DeviceEquipment` from `apps/till/src/api/client.ts:1555-1586`):

```ts
export type PayReader =
  | { kind: "ready"; id: string; name: string; provider?: string; fromDefault: boolean }
  | { kind: "switched_off"; id: string; name: string }   // chosen or resolved, not available (also unpaired)
  | { kind: "none" };
export type PayPrinter =
  | { kind: "ready"; id: string; name: string; fromDefault: boolean }
  | { kind: "switched_off"; id: string; name: string }   // chosen, switched off: prints nothing (§2.4)
  | { kind: "unset" }                                     // the profile lists receipt printers, none resolves
  | { kind: "none_listed" };                              // the profile lists no receipt printer: "sin ticket"
export function payReaderOf(equipment: DeviceEquipment | null): PayReader;
export function payPrinterOf(equipment: DeviceEquipment | null): PayPrinter;
export function rowStartsOpen(reader: PayReader, printer: PayPrinter): boolean; // reader not ready, or printer switched_off or unset
export function readerChoices(equipment: DeviceEquipment | null): EquipmentItem[];  // card_terminal choices; busy ones stay, marked
export function printerChoices(equipment: DeviceEquipment | null): EquipmentItem[]; // receipt choices
```

`fromDefault` is `role.selection === "default"`. A portable default printer this phone does not
hold resolves to nothing (`packages/layouts/src/device-equipment.ts:274-276`), so it reads `unset`
or `none_listed` by the profile's list. The name clashes with `till-app.ts`'s private
`payReaderOf` (`:403-407`); import this one under its own name or rename the private one
`activeReaderOf` in this task.

- [ ] **Step 1: Pin the server's read for a switched-off chosen printer and reader.** Find the
  `apps/server/src/device-equipment.test.ts` case that reads a device whose chosen receipt printer
  is switched off (and one whose chosen reader is switched off or unpaired) and note what
  `resolved` and `chosen` hold. If no case pins it, add
  `it("reads a chosen printer that was switched off as the chosen, unavailable printer")` and its
  reader twin, asserting the exact `selection`, `chosenId`, `resolved` and `chosen.available`
  values the read returns today (no server code changes). The till fixtures in Step 2 copy those
  values exactly; cite the case in the commit.
- [ ] **Step 2: Write failing cases** in `pay-equipment.test.ts`, one per state: reader ready by
  choice, ready by default (`fromDefault: true`), switched off, unpaired (same as switched off),
  none; printer ready, ready by default, switched off, unset (list but no choice or default),
  none_listed, a portable default not held; `rowStartsOpen` true for each non-ready reader and for
  printer `switched_off`/`unset`, false for `none_listed` with a ready reader; `readerChoices`
  keeps a busy reader with `busy: true`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/state/pay-equipment.test.ts` — FAIL.
- [ ] **Step 4: Implement**, and move `fill`/`optionLabel` to `equipment-labels.ts`.
- [ ] **Step 5: Run** Step 3's command and
  `pnpm --filter @waitron/till exec vitest run src/widgets/equipment-dialog.test.ts src/widgets/equipment-dialog.nfc.test.ts`
  — PASS (the move changes nothing they see).
- [ ] **Step 6: Typecheck, format, commit** — `"Till: the reader and printer a payment would use, from the equipment read (A796)"`.

### Task 6: the folded reader-and-printer row

**Goal:** a new element draws the row of pictures 2, 3, 4 and 5: closed, "Lector e impresora" over
"**Lector 2** · ticket en **Barra**" with 📷 QR and Cambiar (and NFC when asked for); opened, the
heading with QR (and NFC) and two drop-downs. It only shows and asks; it sends nothing itself.

**Risk triggers:** none (display and events). **Per-task review: no** (light path).

**Files:** Create `apps/till/src/widgets/pay-equipment.ts`, `pay-equipment.test.ts`,
`pay-equipment.a11y.test.ts`. Modify `apps/till/src/i18n/strings.ts`.

**Interfaces:**
- `@customElement("till-pay-equipment") class TillPayEquipment`
- Properties: `equipment: DeviceEquipment | null`; `cardRequired: boolean` (Tarjeta is the method);
  `open: boolean` (reflected; the parent owns it); `saving: { role: "card_terminal" | "receipt"; id: string } | null`;
  `fieldErrors: Partial<Record<"card_terminal" | "receipt", string>>`; `readerReason: string | null`;
  `canScan: boolean`; `askNfc: boolean`; `disabled: boolean`; `fixedReader: { id: string; name: string } | null`
  (a practice venue's demo reader: shown, not choosable; Task 8).
- Events: `pay-equipment-toggle` `{ open: boolean }`; `pay-equipment-pick`
  `{ role: "card_terminal" | "receipt"; id: string; takeOver: boolean }`; `pay-equipment-qr` `{}`;
  `pay-equipment-nfc` `{}`.
- Behaviour:
  - Closed summary from Task 5: reader name bold, then "ticket en {printer}" — with
    " (predeterminada)" when `fromDefault`, "sin ticket" for `none_listed`. Reader `none` or
    `switched_off` reads "sin lector".
  - Opened: `wt-combobox name="cardReaderId"` labelled `t("equipment.card_terminal")`, `required`
    while `cardRequired`, `search="never"`, placeholder `pay_equipment.reader_placeholder`, options
    from `readerChoices` labelled with `optionLabel` (`equipment-labels.ts`), a `busy` one
    `disabled` (default 5, new: greyed out, cannot be picked); value empty unless the reader is
    `ready`. `wt-combobox name="receiptPrinterId"` labelled `t("equipment.receipt")`, placeholder
    `pay_equipment.printer_placeholder`, options from `printerChoices`; value empty unless `ready`.
    A `ready` field chosen by default shows `t("equipment.from_default")` ("Predeterminado del
    perfil") under it. No "Usar el predeterminado" and no "Ninguno" option.
  - Picking an item whose `heldBy` is another device shows, inline in the row, today's question —
    `t("equipment.take_title")` and `take_question`/`take_question_person` filled with
    `carriedText` (`apps/till/src/i18n/t.ts:54`) — with `pay_equipment.take_back` ("Cerrar") and
    `t("equipment.take")` ("Quitárselo"); confirming emits `pay-equipment-pick` with
    `takeOver: true`. Any other pick emits `takeOver: false` at once.
  - While `saving` is set, that field shows the saving item and the hint `pay_equipment.saving`.
    A `fieldErrors` entry shows as that field's error.
  - QR shows only when `canScan`; NFC (visible text "NFC", accessible name
    `t("equipment.nfc_allow")`) only when `askNfc`; both in the closed row beside Cambiar and in
    the opened row's heading.
  - `disabled` disables every control (a card at the reader).

**Strings:**
- `pay_equipment.heading`: en "Reader and printer" / es "Lector e impresora"
- `pay_equipment.change`: en "Change" / es "Cambiar"
- `pay_equipment.qr`: en "QR" / es "QR" (accessible name `t("equipment.scan_qr")`)
- `pay_equipment.ticket_at`: en "ticket at {printer}" / es "ticket en {printer}"
- `pay_equipment.ticket_at_default`: en "ticket at {printer} (default)" / es "ticket en {printer} (predeterminada)"
- `pay_equipment.no_ticket`: en "no ticket" / es "sin ticket"
- `pay_equipment.no_reader`: en "no reader" / es "sin lector"
- `pay_equipment.reader_placeholder`: en "Choose the reader in your hand" / es "Elige el lector que tienes en la mano"
- `pay_equipment.printer_placeholder`: en "Choose a printer" / es "Elige una impresora"
- `pay_equipment.saving`: en "Saving…" / es "Guardando…"
- `pay_equipment.take_back`: en "Close" / es "Cerrar"

- [ ] **Step 1: Write failing cases** in `pay-equipment.test.ts` (describe
  `"till-pay-equipment"`): the closed summary for each Task 5 state (Spanish and English, using
  `setLocale`); Cambiar emits `pay-equipment-toggle {open: true}`; opened, the reader combobox is
  required only with `cardRequired`; a busy reader's option is disabled; picking a free reader emits
  `{role: "card_terminal", id, takeOver: false}`; picking a held one shows the question and emits
  only on Quitárselo, with `takeOver: true`; "Cerrar" in the question emits nothing; a printer pick
  emits `role: "receipt"`; QR and NFC buttons show only with `canScan` / `askNfc` and emit their
  events; `saving` shows `pay_equipment.saving` under that field; `fieldErrors.card_terminal` shows
  under the reader field; `disabled` disables Cambiar, QR, NFC and both comboboxes; and (Review
  focus 4) at `page.viewport(390, 900)` with a 40-character reader name and a 40-character printer
  name, the right edges of Cambiar, QR and NFC are within the row's box.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/pay-equipment.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Then `pay-equipment.a11y.test.ts`: axe in both themes for closed,
  opened, the takeover question, saving and an error; plus the LOOK case (Global constraints) for
  closed and opened, Spanish, at 390 and 1280. Run it and LOOK at the PNGs.
- [ ] **Step 5: Root guards**: `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/screenshot-paths.test.ts`.
- [ ] **Step 6: Typecheck, format, commit** — `"Till: the folded reader and printer row (A796)"`.

### Task 7: the handheld's ways and methods

**Goal:** with `handheld` set, the dialog offers the ways **Toda la cuenta**, Pagar artículos,
Aportar una cantidad, Dividir a partes iguales (Toda la cuenta first and chosen by default), and the
methods **Tarjeta** (only where the profile has `integrated-card-payment`), **Efectivo** (only where
it takes cash) and **Otro datáfono** (only where it has `hand-keyed-card-payment`) — the typed card
chosen on purpose, never a silent fallback (defaults 2 and 3). Its title is "Cobrar · {table}".
Counter tills (`handheld` false) are unchanged.

**Risk triggers:** payments (which entry a card is sent with). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (`#form` `:1074`, `#methodFields`
`:1222-1262`, `#choice` `:696`, `#request` `:716-729`, `PaymentDraft` `:116-127`),
`apps/till/src/state/bill-payment.ts` (`PAY_WAYS` `:37-41`), `apps/till/src/i18n/strings.ts`.
Test `bill-pay-dialog.test.ts`, `bill-pay-dialog.unsaved.test.ts`, `bill-pay-dialog.a11y.test.ts`.

**Interfaces:**
- New dialog properties: `handheld = false`; `takesManualCard = false`; `tableName = ""`.
- `export const HANDHELD_PAY_WAYS` in `bill-payment.ts`: `{ way: "whole", label: "bill_pay.way_whole" }`
  then today's three. `PayWay` becomes `PayChoice["kind"] | "whole"`.
- "whole" is a till-side way only: `#choice()` returns
  `{ kind: "contribution", amount: this.balance!.outstanding }`, read when Continuar is pressed —
  the server path "pay the rest" already uses (`till-table-order-screen.ts:3492-3499`). No server
  change.
- The method state becomes `"cash" | "card" | "manual"`; radio values `card`, `cash`, `manual`.
  `manual` sends `{ entry: "manual", externalRef? }` with `pay.method: "card"`; on a handheld,
  `card` always sends `{ entry: "reader", ... }` (its reader is Task 8's). The draft records the
  new method value so the unsaved-changes comparison sees a change of method.
- Default method on a handheld: Tarjeta if offered, else Efectivo, else Otro datáfono.

**Strings:**
- `bill_pay.way_whole`: en "Whole bill" / es "Toda la cuenta"
- `bill_pay.method_other_terminal`: en "Other card machine" / es "Otro datáfono"
- `bill_pay.title_table`: en "Pay · {table}" / es "Cobrar · {table}"

- [ ] **Step 1: Failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: on a handheld"`: four ways in picture 2's order, "whole" checked; whole
  with card emits `bill-pay-preview` whose choice is `{kind: "contribution", amount: <outstanding>}`;
  methods shown per the three flags (all eight combinations by `it.each`); Otro datáfono shows the
  operation-number field and sends `entry: "manual"`; with `handheld` false the dialog still shows
  today's three ways and two methods (an existing case may already pin that — cite it).
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "on a handheld"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the dialog's test, unsaved and a11y files — PASS. Add "on a handheld, the
  form" to the a11y two-theme describe and a LOOK case at 390 (Spanish).
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payment dialog: Whole bill and Other card machine on a handheld (A796 defaults 2, 3)"`.

### Task 8: the row in the sheet; the charge names its reader

**Goal:** on a handheld the dialog holds `till-pay-equipment` under the methods (picture 2), the
charge button reads "Cobrar 20,80 € en Lector 2", and the request carries that reader's id
(default 16). While Tarjeta is the method and the reader is not `ready`, or while a pick is being
sent, Continuar and Cobrar are disabled; cash and Otro datáfono never need a reader. The row opens
by itself when `rowStartsOpen`, and starts closed again each time the dialog opens.

**Risk triggers:** payments (the reader charged). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (`#readerEntry` `:731-737`,
`#readerFields` `:1274`, `#confirmStep` `:1460-1536`), `apps/till/src/i18n/strings.ts`.
Test `bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`.

**Interfaces:**
- New dialog properties, passed straight to the row: `equipment: DeviceEquipment | null`,
  `equipmentSaving`, `equipmentErrors`, `readerReason`, `canScan`, `askNfc`; plus
  `fixedReader: { id: string; name: string } | null` for a practice venue (below).
- The dialog re-emits the row's `pay-equipment-pick`, `pay-equipment-qr` and `pay-equipment-nfc`
  unchanged (they bubble and are composed already; the dialog adds nothing) and owns the row's
  `open` state: true on each opening when `rowStartsOpen`, else false; toggled by
  `pay-equipment-toggle`.
- `#readerEntry()` on a handheld returns `{ entry: "reader", readerId: <the row's ready reader id> }`
  read at the moment Cobrar is pressed (a tap that changed the reader meanwhile is charged, picture
  12 middle). The confirmation's `asked.card` is rebuilt at Cobrar so the request names the reader
  the button names.
- **A practice venue** (`till-app`'s `#paysFromBoot()`, `:7952`, true with the simulator) charges
  only its demo reader (`resolveCardCollector`, `apps/server/src/till-api.ts:370-384`), which is not
  an equipment choice. There the row shows that reader fixed (`fixedReader`, no reader drop-down)
  and the request names its id, as today's simulator branch does. The design does not cover the
  simulator; this keeps the demo usable.

**Strings:**
- `bill_pay.take_on_reader`: en "Take {amount} on {reader}" / es "Cobrar {amount} en {reader}"

- [ ] **Step 1: Failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: the reader and printer on a handheld"`: the closed row names Lector 2
  and Barra (picture 2); Cobrar reads "Cobrar 20,80 € en Lector 2"; the confirm emits a request
  with `card: {entry: "reader", readerId: "r2"}`; changing `equipment` to Lector 3 while on the
  confirmation changes the button and the next request names r3; with reader `none` and Tarjeta,
  the row is open and Continuar is disabled, and with Efectivo it is enabled; with
  `equipmentSaving` set, Continuar and Cobrar are disabled; the row is closed again after the
  dialog closes and reopens with a ready reader; with `fixedReader` the request names its id and
  no reader combobox shows; with `handheld` false nothing of this shows.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "reader and printer on a handheld"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the dialog's three test files — PASS. Add the confirmation step with the
  row to the a11y two-theme describe; LOOK at 390 and 1280, Spanish, form and confirmation.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payment dialog: the folded reader and printer row; Cobrar names its reader (A796)"`.

### Task 9: open the sheet from a handheld's bill, and save picks

**Goal:** on a handheld, an **open** bill's pay section shows one primary "Cobrar" button in place
of `till-tender-pay` and the three part-payment buttons; it opens the dialog in handheld mode on
"Toda la cuenta" (picture 2). A **presented** bill keeps today's `till-tender-pay` until Task 11.
Opening the sheet reads the equipment again (§4, "proposed, whenever the sheet opens"). A pick from
a drop-down goes through `till-app`'s existing equipment queue as a list pick, and while it is out
the sheet shows it as saving and holds Continuar and Cobrar (Review focus 5).

**Risk triggers:** payments; concurrency (a pick in flight against a charge). **Per-task review: yes.**

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`#paySection` around `:3448-3560`;
  `handheld` property `:1236`)
- Modify: `apps/till/src/till-app.ts` (`#renderBillPaying` `:8324-8351`, `#openBillPaying`
  `:12028-12055`, `#onEquipmentChange` `:8157-8167`, `#switchEquipment` `:8171-8257`)
- Create: `apps/till/src/till-app-handheld-pay.test.ts`; `apps/till/test/bill-pay-app.ts` (helpers
  the new file shares with `till-app-bill-payments.test.ts`, moved verbatim — a listed fixture move)
- Test: `apps/till/src/screens/till-table-order-screen.bill-payments.test.ts`

**Interfaces:**
- Table screen: on `handheld` with an open bill that owes, `[data-pay-sheet]` dispatches `bill-pay`
  with `{ way: "whole", lines: <PayLine[] as #payPart builds them> }` (`BillPayDetail`, `:383`).
- `till-app` passes `.handheld=${this.handheldMode}`, `.tableName`, `.takesManualCard` (the
  `hand-keyed-card-payment` action), `.equipment=${this.deviceEquipment}`, `.equipmentSaving`,
  `.equipmentErrors`, `.canScan=${canScan()}` (exported from `equipment-dialog.ts:64-66` in this
  task), and `.fixedReader` (from `activeReaders` when `#paysFromBoot()`).
- New `till-app` state: `payEquipmentSaving: { role; id } | null`, `payEquipmentErrors` (Task 10
  fills it). `@pay-equipment-pick` → `#onEquipmentChange(new CustomEvent("equipment-change", { detail: { role, selection: { id }, via: "list", takeOver } }))`
  with `payEquipmentSaving` set before queueing and cleared in `#switchEquipment`'s `finally`.
- `#openBillPaying` on a handheld calls `#readEquipment()` (`:7916`) without awaiting the dialog's
  opening on it.

**Tests the spec changes** (defaults 2 and 3 replace the handheld's whole-bill tender and the
silent typed card):
- `till-app-bill-payments.test.ts:3225` "offers no reader to a handheld whose profile lacks
  integrated card payment: its card is keyed on a separate terminal": on a handheld the typed card
  is now the explicit `input[name="method"][value="manual"]`; change that one selector. The
  assertions (`input[name="reader"]` absent, `externalRef` shown, `entry: "manual"`) stay.
- Any table-screen test that mounts with `handheld` and reaches `till-tender-pay` for an open bill:
  list it in the handover before editing; if more than two, STOP.

- [ ] **Step 1: Failing cases** in `till-app-handheld-pay.test.ts`, describe
  `"till-app: paying a table from a handheld"` (mount as `:3225` does, `formFactor: "phone-portrait"`,
  capabilities with `integrated-card-payment`, `take-cash`, `hand-keyed-card-payment`, and
  `getDeviceEquipment` answering Lector 2 and Barra): pressing `[data-pay-sheet]` opens the dialog
  with `handheld` set, "whole" checked and the row naming Lector 2; opening it sent one more
  `getDeviceEquipment`; a reader pick sends `PUT /api/device/equipment` with
  `{ role: "card_terminal", selection: { id }, via: "list", takeOver: false }`; while that PUT is
  unanswered `[data-pay-continue]` is disabled, and once answered the row shows the new reader and
  Continuar is enabled; a whole-bill card payment sends `takeBillPayment` with
  `entry: "reader", readerId: "r2"`; a presented bill still shows `till-tender-pay`.
- [ ] **Step 2: Failing screen case** in `till-table-order-screen.bill-payments.test.ts`: with
  `handheld` and an open bill, one `[data-pay-sheet]`, no `till-tender-pay`, no
  `[data-open-bill-pay]`; without `handheld`, today's controls.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts src/screens/till-table-order-screen.bill-payments.test.ts` — FAIL.
- [ ] **Step 4: Implement**; move the shared helpers into `apps/till/test/bill-pay-app.ts`.
- [ ] **Step 5: Run** Step 3's files, `src/till-app-bill-payments.test.ts`,
  `src/till-app.nfc.test.ts` and `src/screens/till-table-order-screen.test.ts` — PASS apart from
  the listed change.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld: Cobrar opens the pay sheet; reader and printer picks save through Equipment (A796)"`.

### Task 10: a pick refused, or with no answer

**Goal:** default 22. A refused pick puts the field back to what the equipment read says and shows
the refusal's message under that field. A pick with no answer re-reads the equipment (as
`#switchEquipment` does for an error with no status, `:8232-8239`), the field shows what the read
says, and "No se ha podido guardar" shows under it. A pick refused or unanswered never disables
Continuar by itself.

**Risk triggers:** concurrency. **Per-task review: yes.**

**Files:** Modify `apps/till/src/till-app.ts` (`#switchEquipment`), `apps/till/src/i18n/strings.ts`.
Test `apps/till/src/till-app-handheld-pay.test.ts`.

**Interfaces:** `payEquipmentErrors: Partial<Record<"card_terminal" | "receipt", string>>` set from
`codeMessage(code)` on a refusal and `t("pay_equipment.not_saved")` on no answer, for the role the
sheet picked; cleared by the next pick of that role and when the sheet closes. The Equipment
dialog's own `equipmentError` handling is unchanged.

**Strings:** `pay_equipment.not_saved`: en "Could not be saved" / es "No se ha podido guardar"

- [ ] **Step 1: Failing cases** (describe `"a pick from the sheet that fails"`): a reader pick
  refused `{ code: "reader.payment_in_progress", status: 409 }` leaves the row on Lector 2 and shows
  `codeMessage("reader.payment_in_progress")` under the reader field, Continuar enabled; a printer
  pick refused `device.binding_invalid` shows it under the printer field; a pick that rejects
  `new TypeError("Failed to fetch")` triggers one `getDeviceEquipment` and the field shows that
  read's reader with `t("pay_equipment.not_saved")` under it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts -t "fails"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the file and `src/widgets/equipment-dialog.test.ts` — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: a refused or unanswered pick shows under its field (A796 default 22)"`.

### Task 11: the presented-bill sheet

**Goal:** default 1, picture 11. On a handheld, a presented bill's pay section shows the same
Cobrar button, which opens `till-presented-pay-dialog`: "Cuenta presentada" and its amount, the line
"Esta cuenta ya está presentada: se cobra entera, en un solo pago.", the methods as in Task 7, the
same row, and the charge "Cobrar 62,40 € en Lector 2". A reader card goes to `POST /api/pay` with
`{ id: <working order id>, lines: [], readerId }` (a placed order ignores `lines`,
`apps/server/src/till-sale.ts:1135-1137`); cash and Otro datáfono go to `collectOrder`, as
`#onPayTab` does today (`till-app.ts:11871-11934`). No route changes.

**Risk triggers:** payments; fiscal invariants (the invoice path — unchanged, but a wrong route here
would issue or settle it differently). **Per-task review: yes.**

**Files:** Create `apps/till/src/widgets/presented-pay-dialog.ts`, `presented-pay-dialog.test.ts`,
`presented-pay-dialog.a11y.test.ts`. Modify `apps/till/src/screens/till-table-order-screen.ts`,
`apps/till/src/till-app.ts`, `apps/till/src/i18n/strings.ts`. Test `till-app-handheld-pay.test.ts`.

**Interfaces:**
- `@customElement("till-presented-pay-dialog")`; properties `open`, `amount: string`, `tableName`,
  `takesCash`, `takesManualCard`, `cardOffered`, and the same equipment properties as Task 8;
  `busy`; `refusal: { code: string } | null`. Event `presented-pay`
  `{ method: "card"; readerId: string } | { method: "cash"; tendered: string } | { method: "manual"; externalRef?: string }`,
  plus the row's events. It reuses `till-pay-equipment` and `pay-equipment.ts`.
- Table screen: on `handheld` with a `placed` bill, `[data-pay-sheet]` dispatches `pay-presented`
  `{ workingOrderId }`.
- `till-app`: `#onPayPresented` opens it; `#onPresentedPay` sends. A card goes through
  `#withReaderPayment(true, () => this.api.pay({...}))` and maps the outcome as `#collectCard`
  does (`:5174` onward: captured → done; declined, timeout, network → the dialog's `refusal` with
  today's tender wording). Cash and manual go through `collectOrder(id, tender)`. A success shows
  the ticket as today (`#showTicket`) until Task 18.

**Strings:**
- `presented_pay.balance`: en "Bill presented" / es "Cuenta presentada"
- `presented_pay.whole_only`: en "This bill has already been presented: it is paid whole, in one payment." /
  es "Esta cuenta ya está presentada: se cobra entera, en un solo pago."

- [ ] **Step 1: Failing element cases** in `presented-pay-dialog.test.ts`: no ways offered; the
  amount and the line; Cobrar names the reader and emits `{ method: "card", readerId }`; cash needs
  the tendered field; Otro datáfono emits `manual`; no reader + Tarjeta disables Cobrar.
- [ ] **Step 2: Failing app cases** in `till-app-handheld-pay.test.ts`, describe
  `"a presented bill on a handheld"`: card → one `api.pay` call with `lines: []` and the reader id,
  no `takeBillPayment`; cash → `collectOrder` with the tender; a declined card keeps the dialog
  open with today's decline wording.
- [ ] **Step 3: Run** both files — FAIL. **Step 4: Implement.** **Step 5: Run** both, the
  a11y file (two themes) and LOOK at 390 — PASS. The Task 9 case "a presented bill still shows
  `till-tender-pay`" is this task's spec change: it now expects `[data-pay-sheet]`.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld: a presented bill is paid whole from the pay sheet (A796 default 1)"`.

---

## Part 4 — stickers in the sheet (design slice 4, defaults 20 and 21)

### Task 12: 📷 QR in the sheet, reading either kind of sticker

**Goal:** the row's QR opens today's camera inside the sheet, in place of the sheet's body, with
"Volver" to go back (picture 12, left). In this use the camera accepts a reader's or a printer's
sticker, and what it reads is sent exactly as an NFC tap is — `PUT /api/device/equipment` with the
sticker's kind and `via: "scan"` — through the same till-app path as `#pickUpNfc`. The camera
closes and the sheet returns where it was.

**Risk triggers:** takeover rules (a scan takes a reader from another phone without asking,
default 5). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/equipment-scanner.ts` (`kind` `:46`, wrong-kind check
`:121-125`, event `:127-133`), `apps/till/src/widgets/bill-pay-dialog.ts`,
`apps/till/src/widgets/presented-pay-dialog.ts`, `apps/till/src/till-app.ts` (`#pickUpNfc`
`:2590-2612`). Test `equipment-scanner.test.ts`, `bill-pay-dialog.test.ts`,
`till-app-handheld-pay.test.ts`.

**Interfaces:**
- Scanner: `kind: EquipmentKind | "any"`; `equipment-scanned` detail becomes
  `{ id: string; kind: EquipmentKind }` (adding `kind`; today's listeners read only `id`).
- Both dialogs: `@state() scanning`; on `pay-equipment-qr` they render
  `<till-equipment-scanner kind="any">` and a `Volver` button (`t("equipment.scan_back")` is
  "Volver a la lista"; use a new `pay_equipment.scan_back` "Volver"/"Back", picture 12); on
  `equipment-scanned` they emit `pay-equipment-sticker` `{ kind, id }` and close the camera.
- `till-app`: `#pickUpNfc(code)` becomes `#pickUpSticker(code: EquipmentCode)`, used by NFC and by
  `@pay-equipment-sticker`; same role check and same request.

**Strings:** `pay_equipment.scan_back`: en "Back" / es "Volver"

- [ ] **Step 1: Failing scanner cases**: with `kind="any"`, a printer label emits
  `{id, kind: "printer"}` and a reader label `{id, kind: "reader"}`; the two wrong-kind cases still
  hold for `printer` and `reader`.
- [ ] **Step 2: Failing dialog case**: QR shows the scanner and hides the form; Volver brings the
  form back as it was (way, amount, method kept); a scanned label emits `pay-equipment-sticker`.
- [ ] **Step 3: Failing app cases** (stub `getUserMedia` as `equipment-scanner.test.ts:55` does):
  a scanned reader sticker sends `{ kind: "reader", selection: { id }, via: "scan" }` and the row
  then names it; a scanned printer sticker sends `kind: "printer"`; a printer sticker refused
  `device.binding_invalid` changes nothing in the row.
- [ ] **Step 4: Run** the three files — FAIL. **Step 5: Implement.** **Step 6: Run** them and
  `src/till-app.nfc.test.ts`, `src/widgets/equipment-dialog.test.ts` — PASS.
- [ ] **Step 7: Typecheck, format, commit** — `"Handheld pay sheet: scan a reader's or printer's QR sticker without opening the row (A796 default 20)"`.

### Task 13: a tap's notice shows inside the sheet

**Goal:** while a pay sheet is open, the notice of a tap or a scan — "Has recogido {item}", its
refusal, `equipment.no_printer_role`, a foreign sticker — shows as one line inside the sheet above
the row (picture 12, middle), because today's toast sits beneath an open dialog (design §2.1). A
printer sticker that set only the payment-slip printer says "Has recogido {item} solo para
justificantes de pago." — everywhere the notice shows, toast included, since it is the same event.

**Risk triggers:** none. **Per-task review: no.**

**Files:** Modify `apps/till/src/till-app.ts` (`nfcNotice` `:2566`, the notice logic `:8200-8216`,
the toast `:13349-13357`), both dialogs, `apps/till/src/i18n/strings.ts`. Test
`apps/till/src/till-app.nfc.test.ts`, `till-app-handheld-pay.test.ts`.

**Interfaces:** both dialogs get `notice: { message: string; tone: "info" | "error" } | null`,
drawn as a `wt-notice` line (`data-pay-notice`); `till-app` passes `nfcNotice` there and keeps
`[data-nfc-notice]` closed while a pay sheet is open.

**Strings:** `equipment.picked_up_slip_only`: en "You picked up {item} for payment slips only." /
es "Has recogido {item} solo para justificantes de pago."

- [ ] **Step 1: Failing cases** in `till-app.nfc.test.ts`, beside "continues listening on the
  schedule screen" (`:744`), in a describe that opens a handheld pay sheet with
  `mountEquipmentApp` (`apps/till/test/equipment-app.ts`) and the bill payment helpers:
  `it("a tap with the pay sheet open changes its row, its drop-downs and its charge button, and leaves the listener running")`
  — after the tap, `[data-pay-notice]` reads "Has recogido {item}", the row and (opened) the
  reader combobox name the new reader, `[data-nfc-notice]` is not open, the
  `FakeNdefReader`'s scan `signal` is not aborted and a second tap sends a second PUT;
  `it("a tap on the confirmation step makes Cobrar send the tapped reader")`;
  a printer tap whose answer resolves it only for `payment_slip` shows the slip-only line.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app.nfc.test.ts -t "pay sheet|confirmation step|payment slips"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the whole `till-app.nfc.test.ts`,
  `till-app.nfc.a11y.test.ts` and `till-app-handheld-pay.test.ts` — PASS. LOOK at the notice line
  at 390 in both themes.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: a sticker's notice shows inside the sheet (A796 default 20)"`.

### Task 14: ask for NFC from the row

**Goal:** default 21. Where the browser has Web NFC and the permission is "prompt", an **NFC**
button sits beside 📷 QR on the folded row and in the opened heading (pictures 4 and 12, right).
Pressing it calls `scan()` from that click, so the browser asks; once granted, the till-wide
listener runs with **one** reader listening, the button goes, and the sheet's line shows
`t("equipment.nfc_hint")`. Not shown without `NDEFReader`, once granted, or once refused.

**Risk triggers:** none (a browser permission). **Per-task review: no.**

**Files:** Modify `apps/till/src/state/equipment-nfc.ts`, `apps/till/src/till-app.ts`
(`#equipmentNfc` `:2567-2582`). Test `apps/till/src/till-app.nfc.test.ts`,
`till-app.nfc.a11y.test.ts`.

**Interfaces:**
- `EquipmentNfc` constructor takes a fourth callback `onPermission: (state: PermissionState | null) => void`
  (null when there is no `NDEFReader`), called from `start()`'s query and every `change`.
- `EquipmentNfc.requestScan(): Promise<void>` — called from a click while the permission is
  "prompt": starts the lifetime's scan directly (the same `#listen` and abort controller `start()`
  would use), so the permission's later `change` to "granted" finds it already scanning and starts
  no second `scan()`. A `NotAllowedError` reports `onPermission("denied")`.
- `till-app` keeps `nfcPermission: PermissionState | null` and passes `.askNfc=${this.nfcPermission === "prompt"}`;
  `@pay-equipment-nfc` → `this.#equipmentNfc.requestScan()`.

- [ ] **Step 1: Failing case** in `till-app.nfc.test.ts`, modelled on "granting NFC in the dialog
  ends with one live reader and one selection per tap" (`:279`):
  `it("the pay sheet's NFC button ends with one live reader and one selection per tap")` —
  `installNfc("prompt")`; open the sheet; `[data-pay-nfc]` shows; press it; flip the permission to
  granted and dispatch `change`; assert exactly one `FakeNdefReader` instance has a live signal, one
  tap sends one PUT, and `[data-pay-nfc]` is gone. Also: with no `NDEFReader` the button never
  shows; with "denied" it never shows.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the whole
  `till-app.nfc.test.ts` and its a11y sibling — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: ask for NFC from the row (A796 default 21)"`.

---

## Part 5 — waiting, uncertain, the next guest, the paid screen (design slice 5)

### Task 15: the card at the table

**Goal:** picture 6. While the card is at the reader, the handheld sheet shows "Acerca o inserta la
tarjeta…", "20,80 € en Lector 2" and "Esperando desde hace 0:12" (counting each second), naming the
reader the payment was **sent to** even if a tap changes the phone's reader meanwhile. A decline
keeps today's words (`bill_pay.card_declined`) and the button reads "Reintentar en {reader}",
naming the phone's reader **now**; pressing it charges that one as a new payment. No Cancel
(default 9).

**Risk triggers:** payments (the retry charges the current reader). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (`:1518-1521`, `#confirmStep`),
`presented-pay-dialog.ts`, `apps/till/src/i18n/strings.ts`. Test `bill-pay-dialog.test.ts`,
`till-app.nfc.test.ts`, the a11y file.

**Interfaces:** the dialog records `#sentReader: { id: string; name: string } | null` when Cobrar
is pressed and the elapsed time from that moment (a `setInterval` of 1 s, cleared when `busy`
ends and on disconnect).

**Strings:**
- `bill_pay.waiting_on`: en "{amount} on {reader}" / es "{amount} en {reader}"
- `bill_pay.waiting_since`: en "Waiting for {time}" / es "Esperando desde hace {time}" (`m:ss`)
- `bill_pay.retry_on_reader`: en "Try again on {reader}" / es "Reintentar en {reader}"

- [ ] **Step 1: Failing dialog cases** (fake timers advanced through `vi.advanceTimersByTimeAsync`,
  restoring real timers after each case): the waiting view's three lines; after 12 s it reads
  "0:12"; changing `equipment` to Lector 3 while busy keeps "en Lector 2"; after a decline the
  button reads "Reintentar en Lector 3" and its request names r3.
- [ ] **Step 2: Failing NFC case** in `till-app.nfc.test.ts`:
  `it("a tap while a card is at the reader is picked up, and the waiting view keeps naming the reader the payment was sent to")`.
- [ ] **Step 3: Run** both — FAIL. **Step 4: Implement.** **Step 5: Run** the dialog's three files
  and the NFC file — PASS; LOOK at the waiting and declined views at 390, both themes.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld pay sheet: the card at the table, and a retry on the reader in hand (A796)"`.

### Task 16: Cobrar al siguiente

**Goal:** default 10, picture 8 left. After a payment that leaves money owing, the handheld sheet
shows "Pago cobrado." with "20,80 € con tarjeta en Lector 2" (for a reader card), the payments
list, and a primary "Cobrar al siguiente (2 de 3)" that keeps the way and, for an equal share,
lowers the people count by one. For other ways it reads "Cobrar al siguiente" and starts the form
again on the same way. The reader and printer stay as they were.

**Risk triggers:** payments (the share count). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (`paymentAccepted` `:637`,
`#startAgain` `:646`, `#takenText` `:841-847`), `apps/till/src/i18n/strings.ts`. Test
`bill-pay-dialog.test.ts`, `till-app-handheld-pay.test.ts`.

**Interfaces:** `paymentAccepted()` on a handheld keeps `chosenWay` and, for `share`, sets
`people` to `String(n - 1)` when `n > 1`; `taken` gains an optional `reader?: string` set by
`till-app` from the request's reader name.

**Strings:**
- `bill_pay.next_share`: en "Take the next ({n} of {m})" / es "Cobrar al siguiente ({n} de {m})"
- `bill_pay.next`: en "Take the next" / es "Cobrar al siguiente"
- `bill_pay.taken_on_reader`: en "{amount} by card on {reader}" / es "{amount} con tarjeta en {reader}"

`{n}` is the guest about to pay (the first of three paid, so 2) and `{m}` the original count.

- [ ] **Step 1: Failing cases**: share of 3 paid → "Cobrar al siguiente (2 de 3)"; pressing it
  previews a share among 2; a contribution → "Cobrar al siguiente" back on Aportar una cantidad
  with the amount empty; the taken line names the reader; on a counter till, today's behaviour.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the dialog files and
  `till-app-handheld-pay.test.ts` — PASS. LOOK at 390.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: take the next guest's share (A796 default 10)"`.

### Task 17: an uncertain card refreshes itself

**Goal:** default 8, picture 7 left. While the handheld sheet shows a pending card payment, it
says "Aún no sabemos si se ha cobrado" with "El lector no ha contestado. No cobres a este cliente de
otra forma todavía: 20,80 € quedan reservados en la cuenta y esta pantalla se actualiza sola.",
keeps today's last sentence about a manager, and re-reads the bill every 5 seconds until no payment
it shows is pending. Then it shows the settled state.

**Risk triggers:** payments; concurrency (a timer beside answers). **Per-task review: yes.**

**Files:** Modify `apps/till/src/till-app.ts` (beside `#rereadBillPaying` `:12064`),
`apps/till/src/widgets/bill-pay-dialog.ts` (`#takenText`), `apps/till/src/i18n/strings.ts`. Test
`till-app-handheld-pay.test.ts`, `bill-pay-dialog.test.ts`.

**Interfaces:** `const PENDING_REREAD_MS = 5_000` in `till-app.ts`; one timer at a time, started
when the open sheet's balance holds a `pending` payment and stopped when none is pending, when the
sheet closes, on logout (`#endOperatorSession`, `:11808`) and on disconnect. Each tick calls
`#rereadBillPaying(open.id, open.billId)` and is ignored if the sheet changed meanwhile. No
`#onInteraction` call (Global constraints). Handheld only; counters keep today's text.

**Strings:**
- `bill_pay.uncertain_title`: en "We don't know yet whether it was charged" / es "Aún no sabemos si se ha cobrado"
- `bill_pay.uncertain`: en "The reader has not answered. Do not take this guest's money another way yet: {amount} stays held on the bill and this screen updates itself." /
  es "El lector no ha contestado. No cobres a este cliente de otra forma todavía: {amount} quedan reservados en la cuenta y esta pantalla se actualiza sola."
- `bill_pay.card_pending_manager`: en "If it does not finish, a manager can clear it on the dashboard's Card payments screen." /
  es "Si no termina, un responsable puede anularlo en la pantalla Pagos con tarjeta del panel de gestión."

- [ ] **Step 1: Failing cases** (fake `setInterval`/`setTimeout` only, as `:2153`'s case fakes
  timers): a pending answer shows the warning; after 5 s one `getBillBalance` call, after 10 s two;
  when a read shows the payment received the warning goes and no further read is sent in the next
  15 s; (Review focus 2) closing the sheet, logging out, or the payment settling each stop the
  reads.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the files — PASS; LOOK.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: an uncertain card re-reads itself every 5 seconds (A796 default 8)"`.

### Task 18: the paid screen, with Cerrar mesa

**Goal:** default 11 and 12, picture 8 right. On a handheld, the payment that settles the bill
(bill path or presented path) shows `till-paid-view` instead of the ticket view: "✓ Mesa 4 pagada",
"62,40 € en 3 pagos · factura simplificada emitida", the payments with their states, the ticket line,
a primary **Cerrar mesa** and "Volver a la mesa". Paying never frees the table by itself.

The ticket line reads `GET /api/sales/:id/receipt` (`api.getReceiptPrintStatus(workingOrderId)`,
`client.ts:2689`; today read only for full invoices, `#refreshReceiptPrint` `:7447`) for every
invoice type, and names no printer: `queued`, `printing`, `done` → "Ticket enviado"; `failed` →
"No se ha podido imprimir" with today's retry where `canRetry`; `not_queued` → "No se ha impreso
ticket" and "Un dispositivo cuyo perfil puede imprimir tickets puede reimprimirlo."; a failed read →
today's `invoice.print_status_failed`. **Reimprimir** shows where the profile has `print-receipt`
and sends today's reprint.

**Risk triggers:** auth and permissions (Cerrar mesa needs `take-orders`, reprint needs
`print-receipt` — both existing routes). **Per-task review: yes.**

**Files:** Create `apps/till/src/screens/till-paid-view.ts`, `till-paid-view.test.ts`,
`till-paid-view.a11y.test.ts`. Modify `apps/till/src/till-app.ts` (`#onBillPaid` `:12173-12176`,
`#onPresentedPay`, `#showTicket` `:12469`, the drill rendering around `:12921`, `#onFinishTable`
`:11176`), `apps/till/src/i18n/strings.ts`. Test `till-app-handheld-pay.test.ts`.

**Interfaces:**
- `@customElement("till-paid-view")`; properties `tableName`, `total: string`,
  `invoiceType: "F1" | "F2"`, `payments: BillPaymentView[]`,
  `receipt: OriginalReceiptPrint | "unread" | null` (null while reading), `canReprint`, `busy`.
  Events: `finish-table` `{}` (the same name the table screen sends, handled by `#onFinishTable`),
  `back-to-table` `{}`, `retry-receipt` `{}`, `reprint-bill` `{ workingOrderId }`.
- `till-app`: a drill kind `{ kind: "paid", billId }` pushed by `#pushDrill` on a handheld in place
  of `{ kind: "ticket" }`; it reads the receipt status once on entry.

**Strings:**
- `paid.title`: en "{table} paid" / es "{table} pagada"
- `paid.summary_simplified`: en "{amount} in {n} payments · simplified invoice issued" / es "{amount} en {n} pagos · factura simplificada emitida"
- `paid.summary_full`: en "{amount} in {n} payments · full invoice issued" / es "{amount} en {n} pagos · factura completa emitida"
- `paid.ticket_sent`: en "Ticket sent" / es "Ticket enviado"
- `paid.ticket_failed`: en "Could not print" / es "No se ha podido imprimir"
- `paid.ticket_not_printed`: en "No ticket printed" / es "No se ha impreso ticket"
- `paid.ticket_reprint_hint`: en "A device whose profile may print tickets can reprint it." / es "Un dispositivo cuyo perfil puede imprimir tickets puede reimprimirlo."
- `paid.simplified`: en "Simplified invoice" / es "Factura simplificada"; `paid.full`: en "Full invoice" / es "Factura completa"
- `paid.back`: en "Back to the table" / es "Volver a la mesa"
- Reuse `table.finish` ("Cerrar mesa"), `action.reprint` ("Reimprimir"), `bill_pay.payment`.

- [ ] **Step 1: Failing element cases**: each receipt status gives its line; retry shows only with
  `canRetry`; Reimprimir only with `canReprint`; buttons emit their events.
- [ ] **Step 2: Failing app cases**: the third share's answer with an invoice shows
  `till-paid-view`, not `till-ticket-view`, with three payments; one `getReceiptPrintStatus` call
  for an F2 invoice; Cerrar mesa calls `finishTable` once; Volver a la mesa returns to the order;
  on a counter till the ticket view still shows (an existing case pins it — cite it).
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** the new files,
  `till-app-handheld-pay.test.ts`, `till-app-bill-payments.test.ts` — PASS; a11y and LOOK at 390
  and 1280, both themes.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld: a short paid screen with Cerrar mesa and the ticket line (A796 defaults 11, 12)"`.

---

## Part 6 — first use, and a reader or printer that has gone (design slice 6, defaults 18 and 19)

### Task 19: the first payment on a phone with no reader

**Goal:** default 18, picture 4. A phone with no reader it can charge opens the row with the reader
empty (already so from Tasks 5 and 8; the placeholder is Task 6's). New: when the phone has had no
reader this page session, the equipment read offers exactly one reader for the card-reader role,
and that reader has no `heldBy` and is not `busy`, the sheet picks it up as it opens — the same
request as a list pick (`via: "list"`, `takeOver: false`) — and the row stays closed naming it. A
refused or unanswered automatic pick leaves the left-hand form with Task 10's message.

**Risk triggers:** payments (the phone takes a reader by itself). **Per-task review: yes.**

**Files:** Modify `apps/till/src/state/pay-equipment.ts`, `apps/till/src/till-app.ts`
(`#holdEquipment` `:7942-7947`, `#openBillPaying`, `#onPayPresented`). Test `pay-equipment.test.ts`,
`till-app-handheld-pay.test.ts`.

**Interfaces:**
- `export function autoPickReader(equipment: DeviceEquipment | null, hadReader: boolean): string | null`
  in `pay-equipment.ts`.
- `till-app`: `#hadReader = false` — set true whenever a held read's `card_terminal` resolves a
  reader, and after any accepted reader pick; never stored, never reset by logout (it describes the
  page, not the person). `#autoPickedFor: number | null` — the sheet opening it was sent for.
- The automatic pick is sent once the sheet's opening re-read (Task 9) answers, at most once per
  opening, and not if a pick or tap is already waiting (`#equipmentWaiting > 0`).

- [ ] **Step 1: Failing unit cases** for `autoPickReader`: one free reader and no history → its id;
  `hadReader` → null; two readers → null; one held elsewhere or busy → null; the phone already has
  a ready reader → null.
- [ ] **Step 2: Failing app cases**: a fresh page with one free reader sends one list pick as the
  sheet opens and the row is closed naming it; (Review focus 3) closing and reopening the sheet,
  the 15-second poll answering meanwhile, or a tap arriving first, each lead to no second automatic
  pick; a phone that held Lector 2 earlier in the page and lost it gets no automatic pick; a
  refused automatic pick leaves the reader empty with the refusal under it.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** both files — PASS.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld pay sheet: a phone's first payment picks the one free reader (A796 default 18)"`.

### Task 20: a reader that has gone

**Goal:** default 19, picture 5 left. When the row opens because the reader is not ready, one line
says why, where the phone knows:
- the phone saw another device take it this page session → today's `equipment.taken_person` /
  `equipment.taken` ("Móvil 2 (Marc) se ha llevado Lector 2"), with "Elige el lector que tienes en
  la mano." under it;
- switched off or unpaired (the server keeps the choice) → today's `equipment.switched_off`
  ("Lector 2 está desactivado");
- deleted or taken off the profile's list during this page session → "Lector 2 ya no está
  disponible";
- after a reload, a reader the server has forgotten → no line (first use).

**Risk triggers:** none beyond display. **Per-task review: no.**

**Files:** Modify `apps/till/src/till-app.ts` (`#holdEquipment`, `takenFrom` `:411-424`),
`apps/till/src/state/pay-equipment.ts`, `apps/till/src/i18n/strings.ts`. Test
`pay-equipment.test.ts`, `till-app-handheld-pay.test.ts`.

**Interfaces:** `export function readerLoss(before: DeviceEquipment | null, after: DeviceEquipment): ReaderLoss | null`
with `ReaderLoss = { kind: "taken"; text: string } | { kind: "gone"; name: string }`; `till-app`
keeps `#readerLoss` from the last read that lost the reader (cleared when the phone has a ready
reader again) and passes the line as `readerReason`. `switched_off` comes from the current read,
not memory.

**Strings:** `pay_equipment.reader_gone`: en "{item} is no longer available" / es "{item} ya no está disponible";
`pay_equipment.choose_in_hand`: en "Choose the reader in your hand." / es "Elige el lector que tienes en la mano."

- [ ] **Step 1: Failing cases**: each line from a pair of reads (taken by Móvil 2 with Marc;
  switched off; unpaired; dropped from the list); after a fresh mount with the reader forgotten, no
  line; picking Lector 2 again from the list after a takeover asks today's question.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; LOOK at picture 5
  left's state at 390.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: say why the reader has gone (A796 default 19)"`.

### Task 21: a reader refused at Cobrar, and a printer that has gone

**Goal:** default 19 and §4. (a) A Cobrar refused `reader.not_held` (the phone lost the reader
before it learned) shows, under the reader field, "Este teléfono ya no tiene ese lector de
tarjetas. Elige el lector que tienes en la mano. No se ha cobrado ninguna tarjeta.", re-reads the
equipment, and the row opens with the reader empty (Review focus 1). `codes.ts`'s general
`reader.not_held` message, which points at Equipment, stays for counter tills. (b) The printer
states of picture 5: a switched-off chosen printer opens the row with the printer field empty and
"Barra está desactivada: si no eliges otra, no se imprimirá el ticket", Continuar enabled; a
profile with receipt printers but no choice and no default opens it with "Sin impresora de
tickets: si no eliges una, no se imprimirá el ticket"; a printer the server forgot (deleted, off
the list, marked portable) falls back to the profile's default, row closed, "(predeterminada)" —
already Task 6's summary; a profile with no receipt printer reads "sin ticket", row closed. The
paid screen then says "No se ha impreso ticket" from the `not_queued` status (Task 18).

**Risk triggers:** payments (refusal handling on the charge). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/pay-equipment.ts`, `apps/till/src/widgets/bill-pay-dialog.ts`
(refusal → field), `apps/till/src/till-app.ts` (`#onBillPayRefused` `:12204-12235`),
`apps/till/src/i18n/strings.ts`. Test `pay-equipment.test.ts`, `bill-pay-dialog.test.ts`,
`till-app-handheld-pay.test.ts`.

**Strings:**
- `bill_pay.reader_not_held`: en "This phone no longer has that card reader. Choose the reader in your hand. No card was charged." /
  es "Este teléfono ya no tiene ese lector de tarjetas. Elige el lector que tienes en la mano. No se ha cobrado ninguna tarjeta."
- `pay_equipment.printer_switched_off`: en "{item} is switched off: unless you choose another, no ticket will print" /
  es "{item} está desactivada: si no eliges otra, no se imprimirá el ticket"
- `pay_equipment.printer_none`: en "No ticket printer: unless you choose one, no ticket will print" /
  es "Sin impresora de tickets: si no eliges una, no se imprimirá el ticket"

- [ ] **Step 1: Failing cases**: (Review focus 1) on the confirmation step `takeBillPayment` rejects
  `{ code: "reader.not_held", status: 409 }` → the reader field shows `bill_pay.reader_not_held`,
  one more `getDeviceEquipment` is sent, the row is open with the reader empty, and the request
  sent was the only one; each printer state's row and warning, with Continuar enabled and the
  payment sent.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the files — PASS; LOOK at
  picture 5's middle and right states at 390, both themes.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: a lost reader at Cobrar, and a printer that has gone (A796 default 19)"`.

---

## Part 7 — documentation and the backlog

### Task 22: docs and backlog

**Risk triggers:** none. **Per-task review: no.** Docs-only commit on this branch.

**Files:** `docs/backlog.md`, `docs/backlog/payments.md`, `docs/developers/conventions-ui.md`,
`docs/superpowers/specs/2026-10-19-a796-handheld-payments-design.md` (status line only).

- [ ] **Step 1: `docs/backlog.md`.** Delete the entry "The next identical bill payment can be
  answered with an unanswered one" (fixed by Task 1). Rewrite "Slice 2 — the handheld NFC/QR link
  … (A796)" to what is left, each as its own short entry in _Payments and card readers_:
  restoring `stripe_on_device` (Tap-to-Pay), waiting for the native-app decision (N1/N2);
  "Name the printer on the paid screen's ticket line" (default 12: the route would have to return
  the print job's printer, `readOriginalReceiptPrints`, `apps/server/src/receipt-print.ts:437-453`);
  "Check paying at the table on the OnePlus 13 at the box's address" (a reader card, a QR scan and
  an NFC tap from the sheet, the NFC button's permission ask; browser tests use fakes); "A user
  guide for the till's payment sheet" (no till guide exists yet). Add any point a task's handover
  left open. Keep the W102 loose ends as they are.
- [ ] **Step 2: `docs/backlog/payments.md`** "Slice 2" section: a dated line (2026-10-xx, the
  landing date) saying the handheld payment flow landed as A796, pointing at the PR.
- [ ] **Step 3: `docs/developers/conventions-ui.md` → "What an open till keeps current"**: add one
  paragraph — the handheld pay sheet re-reads the equipment when it opens and the bill every 5
  seconds while it shows a pending card (`PENDING_REREAD_MS`), neither counts as activity for the
  auto-logout, and both are pinned by `apps/till/src/till-app-handheld-pay.test.ts` (name the
  describes). State only what the tests ran.
- [ ] **Step 4: The design's status line**: "Built: <PR>, <date>." under its Status.
- [ ] **Step 5: Format check** with `pnpm exec prettier --file-info <file>` for each (`docs/` is
  ignored whole; `--check` cannot tell), then commit —
  `"A796 docs: backlog entries left open by the handheld payment build"`.

---

## Execution notes

- Order: Parts 1 → 7, tasks in order. Tasks 1–4 do not depend on each other except Task 2 on
  Task 1's dialog; Tasks 5–21 depend on their predecessors' interfaces.
- After Task 21, run `/finish-branch` with this plan named; the full review wave runs (risk
  triggers: payments, auth and permissions, a cross-package write, concurrency), with the two Codex
  reviews. The PR description lists every test edited under a task's "Tests the spec changes" and
  every fixture move.
- No `/land-branch` without the owner.
