# A796 — Paying at the table from a handheld: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2, 2026-10-19**, after the fresh plan review
(`~/waitron-campaign-b/a796b-review/plan-review-1.md`): Part 1 is rewritten so the lock cannot lift
while the first send may have charged (per-bill sends, a balance read that settles a send, Check
again naming the current reader); the first revision's Task 9 is split into Tasks 10 and 11.

**Revision 3, 2026-10-19**, after the narrow re-review (`plan-review-2.md`): a send is judged attempt
by attempt, so any network-failed attempt marks it uncertain; a balance read without the payment
lifts the lock but keeps the submission id (default 7 holds); Task 4 asks before a typed card too;
revision 2's Tasks 2, 13 and 20 are each split in two (now 2–3, 14–15 and 22–23). Tasks are renumbered (27 now).

**Revision 4, 2026-10-19**, after a narrow check (round 3): the automatic Check again is sent at most
once per found payment; the `failed` state's callers include a manager's attestation; the known
limit names a retake on another reader; and Task 3 is split into 3a (the lock) and 3b (a balance
read that settles a send).

**No migration.** Nothing in this plan adds or changes a table, a column, an index or a trigger.
The server data changes are provisioning's seed (Task 5) and new rows in an existing table,
`device_profile_card_readers` (Task 6). Checked: the design says so (§5, "No migration, and nothing
new stored on the phone"), and no task below touches a `schema/` or `drizzle/` file. If an
implementer finds they need one, that is a STOP: report it, because it changes how the campaign may
schedule this item.

**Review path: FULL** (payments, a till route's request body, the device profile's actions, a
cross-package write, concurrency; two Codex reviews at `/finish-branch`). **One branch, one pull
request**: branch `feat/a796-handheld-payments`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a796-handheld-payments`, from `main` at
`942a0ed64`. The design suggests a pull request per slice; nothing here is live yet, so the parts
land together, in order, each commit leaving the branch green. Implementers are dispatched as
`subagent_type: "implementer"` (the owner's rule allows no exception); Tasks 1 to 3b carry the
hardest reasoning in the plan, so their briefs include this plan's Part 1 in full and their
per-task reviewers run at high effort. Keep the ledger
`docs/handoffs/2026-10-19-a796-handheld-payments.md` current after every task.

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
replaces the ticket view on a handheld once a simplified-invoice bill is paid. The row reads and
writes the phone's existing equipment choices (`GET`/`PUT /api/device/equipment`) through
`till-app`'s existing one-at-a-time equipment queue; no payment route changes shape, and every
handheld card request names its reader. The server changes are the Móvil seed and new readers
joining the reader lists of profiles that take reader payments. Counter tills keep today's dialog
except for Part 1, which fixes every device.

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
- **A send**: one bill payment request (`POST /api/working-orders/:id/payments`) under one
  submission id, with `resendUnanswered`'s automatic retries (`apps/till/src/state/draft-sync.ts:119-132`).
- **Uncertain send**: a send that may have been recorded on the server although the phone has no
  result for it (Task 1 defines exactly when).
- **A pick**: a change of the phone's card reader or receipt printer sent as
  `PUT /api/device/equipment` (`EquipmentChange`, `apps/till/src/api/client.ts:1592-1604`).
- **Handheld**: `till-app`'s `handheldMode` (`apps/till/src/till-app.ts:1968`, set at `:3040-3041`
  from `kindOfFormFactor(identity.formFactor) === "handheld"`, `apps/till/src/layout.ts:24-37`).

## Global constraints

Every task's requirements include these.

- **Every commit `git commit -s`.** Never `--no-verify`. Stage explicit paths only.
- **Fiscal golden tests pass unedited**: `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`. Tasks 5 and 6 (the only server tasks) run
  both: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **A test that must be EDITED to pass is a STOP** — report, do not edit — with two exceptions:
  1. a test this plan lists under its task's **"Tests the spec changes"**, edited only as described
     there, each edit named in the commit message and later in the PR description;
  2. adding what a stub or fixture lacks (a new property a mock must answer, a fixture profile, a
     helper moved verbatim out of a test file into `apps/till/test/`), with no assertion changed,
     named in the commit message and the PR.
- **No new server error codes are expected.** If a task needs one, it is registered in the
  throwing package's `errors.ts` and gets English and Spanish wording in `apps/till/src/i18n/codes.ts`
  (and `apps/dashboard/src/i18n/codes.ts` if the dashboard can show it), with a case in
  `apps/till/src/i18n/codes.test.ts`; say so in the PR.
- **The drawer.** Nothing here queues a `drawer` job or adds a route that can. Móvil does not get
  `open-cash-drawer` (default 15); a cash payment on Móvil opens no drawer (Task 5 pins it, with a
  control). A card on a connected reader never opens the drawer (unchanged;
  `apps/server/src/bill-payments-api.test.ts:4987`).
- **Nothing external blocks a sale.** No task adds a call to AEAT, a provider or the internet on the
  payment path; a printer that has gone never holds up a payment (default 19).
- **Automatic reads stay passive.** The till's auto-logout counts only `pointerdown` and `keydown`
  (`#onInteraction`, `till-app.ts:1703`, listeners at `:1751-1752`). The 5-second re-read (Task 21)
  and the re-read when the sheet opens (Task 11) never call `#onInteraction`.
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
- **Browser test traps** (CLAUDE.md §4): a pick from a `wt-combobox` and a press in the takeover
  question use `userEvent.click`, not `element.click()` (testing-guide.md, "A scripted click runs
  microtasks only after the whole dispatch"); a test of what happens on a dialog's close waits for
  its `wt-close` ("A browser test waits for a dialog's close event, not a timer"); a test that a
  screen went back spies on `history.pushState`/`replaceState` ("A browser test sees a push through
  pushState, not history.length"); fake timers are restored after each case.
- **Product text** is quoted from the pictures where they draw it, and is given in full, English
  and Spanish, in each task. `apps/till/src/i18n/strings.ts` holds `en` (`:4`) and
  `es: Record<StringKey, string>` (`:1588`); the type checker enforces both.
- **Guides**: no user guide covers a till screen today (`apps/server/src/guide/{en,es}` hold only
  `content-and-images.md`, `modifiers.md`, `products.md`), so no guide is updated. Task 27 records
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

## Decisions to name in the PR description

Choices this plan makes where the design is silent or where a reviewer could reasonably expect
otherwise. Each is restated in its task.

1. Part 1's lock rules (Task 1): a send still out counts as unanswered (default 7: "no new payment
   of any way or method"); any network-failed attempt makes a send uncertain; a balance read
   without the payment lifts the lock but keeps the submission id, so the id is still dropped only
   when an answer comes, as default 7 says; and the residual window it leaves (Task 1, "Known
   limit").
2. Slices 3–6 apply on a handheld only; counter tills keep today's dialog (Part 1 applies
   everywhere).
3. A practice venue (the simulator) keeps its fixed demo reader in the row (Task 10).
4. Only a newly created reader — from the add route or a first adoption — joins profile lists; a
   re-adopted disabled reader changes no list (Task 6).
5. The takeover question is asked inside the row, not in a second dialog (Task 8).
6. The slip-only pick-up wording shows in the toast as well as the sheet (Task 17).
7. Task 4 asks before a second card of either kind, as the design says, and never before cash:
   the design is silent on cash.
8. `reader.not_held`'s general message in `apps/till/src/i18n/codes.ts:697-700` ("Elige un lector en
   Equipo") stays for counter tills; the handheld sheet shows its own wording under the reader field,
   which is what design §4 asks of the form (Task 26).
9. The paid screen replaces the ticket view only for a simplified invoice; a full invoice keeps
   today's ticket view with its delivery and handover steps (Tasks 22–23).

## Review focus

Five ways a waiter could be hurt that the design implies but its slices do not name a test for.
Each has a test in the task that owns the code.

1. **The phone lost its reader while the sheet sat on the confirmation step** (another phone
   scanned it). Cobrar is refused `reader.not_held`, nothing is charged, the refusal shows under the
   reader field in the sheet's own words, and the row opens with the reader empty. → Task 26.
2. **The 5-second re-read outlives its sheet**, or two reads overlap: after the sheet closes, after
   logout, or once the pending card settles, no further `GET …/payments` is sent, and an older answer
   never replaces a newer one. → Task 21.
3. **The automatic pick fires twice** (the 15-second poll or a tap lands while it is out), taking a
   reader twice or after the waiter picked another. It is sent at most once per sheet opening, and
   never once the phone has a reader. → Task 24.
4. **A long reader or printer name on a 390-pixel phone** pushes QR, NFC or Cambiar off the row.
   The summary wraps and the buttons stay inside the row. → Task 8 (a width assertion, plus LOOK).
5. **An equipment change still being sent when Cobrar is pressed** — a pick, a tap or a scan —
   charges a reader the server has not given the phone. Continuar and a card's Cobrar are disabled
   while any equipment change is out. → Task 12.

---

## Part 1 — the resend fix, on every device (design slice 1, default 7)

Fixes the backlog entry "The next identical bill payment can be answered with an unanswered one".
Five tasks: the rules as pure functions (Task 1), the dialog's lock view (Task 2), the till wired
to both (Task 3a), a balance read that settles a send (Task 3b), and the question before a second
card (Task 4).

### Task 1: the rules for a bill's unanswered payment

**Goal:** a pure model, kept per bill, of the payment sends this phone has out or in doubt, and of
what ends the doubt. No UI.

**Risk triggers:** payments; concurrency. **Per-task review: yes** (high-effort reviewer).

**Files:** Modify `apps/till/src/state/bill-payment.ts` (`submissionFor` `:143-150`,
`FRESH_ID_AFTER` `:156-161`, `unansweredAfter` `:173-177`, which stays for refunds) and
`apps/till/src/state/draft-sync.ts` (`resendUnanswered` `:119-132`). Test
`apps/till/src/state/bill-payment.test.ts`, `apps/till/src/state/draft-sync.test.ts`.

**What the code shows, and why the rules are what they are** (each read on `942a0ed64`):

- A reader card's route resolves the reader **before** the submission id is looked up: the route
  calls `resolveCardCollector` (`apps/server/src/bill-payments-api.ts:245`), which calls
  `resolvePayReader` (`apps/server/src/till-api.ts:325-361`) and so `assertReaderStartable`
  (`packages/payments/src/store.ts:129-141`), raising `reader.not_held` or
  `reader.payment_in_progress`; only then does `beginBillPayment` call `findSubmission`
  (`apps/server/src/bill-payments.ts:1050`). So a reader refusal of a resend says nothing about an
  earlier send, and neither does any other refusal raised before that look-up (the session, zone,
  action and reader checks on the route, and `assertStillSignedIn`, `bill-payments.ts:1044`).
- `resendUnanswered` sends again after a network failure, up to twice, and throws only the **last**
  attempt's error (`draft-sync.ts:119-132`). So an attempt that reached the server and recorded a
  pending card can be followed by a retry refused before the look-up — for instance
  `reader.not_held` after the phone picked up another reader during the pause — and the send's
  final error hides the first attempt. A send is therefore judged attempt by attempt.
- A provider call that throws anything outside `REFUSED_START` leaves the pending row in place and
  the error goes back to the phone (`bill-payments.ts:1368-1374`). The client turns a body with no
  code into `code: "server.internal"` with the HTTP status (`apps/till/src/api/client.ts:4468-4478`).
  So a code-less error, or any status of 500 or more, may follow a recorded payment.
  (`reader.provider_disconnected` is answered 409, `apps/server/src/till-api.ts:515`, before
  anything is recorded, `:356`.)
- The server's replay match ignores the reader and the guests: `BillPaymentRequest` has no
  `readerId` (`bill-payments.ts:128-141`; the route parses it separately,
  `bill-payments-api.ts:172-176`), and `retryShapeOf` spreads only the parsed request with `guests`
  removed (`bill-payments.ts:977-990`). So a resend may name a different reader and still be
  answered with the first payment. A replay of a payment whose bill is settled carries the bill's
  invoice (`resultOf`, `bill-payments.ts:959-970`).
- A bill's balance lists its payments with their submission ids (`BillPaymentView.submissionId`,
  `apps/till/src/api/client.ts:1006-1008`), any state (`:1019`), read in its own transaction
  (`getBillBalance`, `bill-payments.ts:1412-1417`).
- Today one slot holds the phone's unanswered send for every bill (`#unansweredPayment`,
  `till-app.ts:2640`), overwritten by the latest send (`:12130`): a result on Mesa 9 clears Mesa 4's.

**Interfaces:**

```ts
// draft-sync.ts: resendUnanswered gains an optional fourth parameter, called after each attempt
// that failed with a network failure, before the pause or the rethrow.
export async function resendUnanswered<T>(
  send: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, live: () => boolean,
  onUnanswered?: () => void,
): Promise<T>;

// bill-payment.ts
export interface PendingSend {
  billId: string;
  submission: Submission;
  turn: number;          // the send that last wrote this entry
  dialogId: number;      // the dialog that sent it (`BillPaying.id`, till-app.ts:819-831)
  inFlight: boolean;
  uncertain: boolean;
  endedTick: number;     // the tick its last send ended at; 0 while in flight
  refusal: { code: string } | null; // the last coded refusal of this entry's sends, if any
}
export type PendingPayments = ReadonlyMap<string, PendingSend>;

export function isUncertainFailure(error: unknown): boolean;
export function sendStarted(
  pending: PendingPayments, billId: string, submission: Submission, turn: number, dialogId: number,
): PendingPayments;
export function sendUnanswered(pending: PendingPayments, billId: string, turn: number): PendingPayments;
export function sendEnded(
  pending: PendingPayments, billId: string, turn: number, tick: number, error?: unknown,
): PendingPayments;
export function settledByBalance(
  pending: PendingPayments, balance: BillBalance, readStartedTick: number,
): {
  pending: PendingPayments;
  found: { payment: BillPaymentView; entry: PendingSend } | null; // the entry it removed
  freed: PendingSend | null;
};
export function lockFor(pending: PendingPayments, billId: string, dialogId: number): PendingSend | null;
export function holdsReload(pending: PendingPayments): boolean;
```

The rules, which the tests pin one by one:

1. `isUncertainFailure(error)`: true for a network failure (`isNetworkFailure`), a status of 500 or
   more, or a missing code or `code === "server.internal"`.
2. `sendStarted` writes the bill's entry `{ inFlight: true, endedTick: 0 }`. When it replaces an
   entry with the **same** submission id (a Check again) it keeps `uncertain` and `refusal`; with a
   different id it starts `uncertain: false, refusal: null`.
3. `sendUnanswered` — called through `onUnanswered` after **any** attempt of the send that failed
   with a network failure — sets `uncertain: true` at once, while the send is still in flight (only
   if the entry's `turn` equals `turn`).
4. `sendEnded` changes nothing unless the entry's `turn` equals `turn` (a late answer to an older
   send of that bill is ignored; this is the property today's
   `till-app-bill-payments.test.ts:2072` and `:2111` protect, moved here). Otherwise, with
   `endedTick: tick`, `inFlight: false`:
   - no error (a result): the entry is removed;
   - `isUncertainFailure(error)`: `uncertain: true`, and `refusal: { code }` when the error has a
     code other than `server.internal`;
   - any other refusal while `uncertain` (set by rule 3 or an earlier send): stays `uncertain` —
     **reader refusals and the `FRESH_ID_AFTER` codes included** — and records `refusal: { code }`;
   - any other refusal while not `uncertain`: a `FRESH_ID_AFTER` code removes the entry (today's
     rule); any other keeps it with `uncertain: false` and `refusal` recorded.
5. `settledByBalance` acts only on the entry for `balance.workingOrderId`, only when it is not in
   flight and `readStartedTick > entry.endedTick` (a read sent before the send ended proves
   nothing). If a payment in `balance.payments` has the entry's submission id, the entry is removed
   and returned with that payment as `found` (whatever its state), so the caller still has the
   submission. If none has it and the entry is `uncertain`,
   the entry **stays, with `uncertain: false`**, and is also returned as `freed`: the lock lifts but
   the submission id is kept, so an identical retake reuses it, and the id is still dropped only
   when an answer comes — which keeps default 7 ("the kept id is dropped only when an answer
   comes"). A certain entry with no payment is left as it is.
6. `lockFor(pending, billId, dialogId)`: the bill's entry when it is `uncertain` — in flight or
   not, so a Check again in flight, or a first send whose attempt has already failed and is being
   retried, shows the lock with its button busy — or when it is in flight and was sent by another
   dialog than `dialogId` (a dialog reopened after a logout closed the one that sent it). A first
   send still in flight with no failed attempt shows today's busy confirmation in its own dialog.
7. `holdsReload`: some entry is in flight or uncertain. A certain kept entry lives for the page's
   life and does not hold a reload.
8. `submissionFor` is called with the bill's own entry's submission (`pending.get(billId)?.submission ?? null`).

**Known limit, to state in the PR.** "Not in the balance" means "not committed when the read ran".
Every `withTransaction` — the balance read included — queues on one write lock
(`packages/db/src/tenancy.ts:30-44`), and the payment route's earlier steps (the reader resolution,
`till-api.ts:329`) are separate queue entries from the transaction that records the payment
(`bill-payments.ts:1331-1351`), so a read can run after the server has the request and before its
first write commits. The server gives no other signal: the balance shows committed rows only, and a
card's pending row commits before the provider is called. Without a kept id, the harm would be cash
recorded twice, or a card charged twice if both sends reach a reader, within what the bill still
owes. With the kept id (rule 5), an **identical** retake is matched to the first payment. The id
is reused only when the whole confirmation matches (`submissionFor`, `bill-payment.ts:143-150`, keys
on the bill and the confirmation), and a reader card's entry carries its `readerId` (`:88-90`), so a
**different** retake — another amount, another way, **or another reader** — gets a fresh id. After a
cleared `reader.not_held` entry on a handheld every retake is on another reader, so it is always
fresh there. That residual is what the plan leaves open.

- [ ] **Step 1: Write the failing `draft-sync` case** in `draft-sync.test.ts`:
  `onUnanswered` is called once per network-failed attempt (twice when the first two attempts fail
  and the third answers), and never for a coded refusal.
- [ ] **Step 2: Write the failing cases** in `bill-payment.test.ts`, describe
  `"a bill's payment that got no answer"`, one `it` per rule above, named after it. Among them:
  `sendEnded` after `new TypeError("Failed to fetch")` gives `uncertain: true`; after a code-less
  `{ code: "server.internal", status: 502 }` gives `uncertain: true` with no `refusal`; after the
  real `{ code: "reader.provider_disconnected", status: 409 }` on a first send keeps the entry
  certain; after `{ code: "bill.nothing_outstanding", status: 409 }` on a certain send keeps it
  certain; the review's series — `sendUnanswered` then `sendEnded` with
  `{ code: "reader.not_held", status: 409 }`, and with `{ code: "device.profile_changed", status: 409 }`
  — leaves the entry uncertain; `it.each(["reader.not_held", "reader.payment_in_progress", "device.profile_changed", "submission.id_reused", "session.required"])`
  on an uncertain entry keeps it uncertain; the same `FRESH_ID_AFTER` codes on a certain send remove
  it; a result on Mesa 9 leaves Mesa 4's uncertain entry; an older turn's answer changes nothing;
  `sendStarted` with a new submission id resets `uncertain` and `refusal`, with the same id keeps
  them; `settledByBalance` with the id present (each of the four states) removes it and returns it,
  with the payment, as `found`, with the id absent turns an uncertain entry certain, keeps it, and returns it as
  `freed`, leaves a certain one, and with `readStartedTick <= endedTick` or `inFlight` does nothing;
  `lockFor` returns an uncertain entry for any dialog, in flight or not, a certain in-flight entry
  for another dialog only, and null for another bill; `holdsReload` is false for a certain kept entry.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/state/bill-payment.test.ts src/state/draft-sync.test.ts -t "got no answer|onUnanswered"` —
  FAIL (`sendStarted` not exported; `onUnanswered` never called).
- [ ] **Step 4: Implement** the functions with immutable `Map` copies, and `onUnanswered` in
  `resendUnanswered`.
- [ ] **Step 5: Run** the whole `src/state/bill-payment.test.ts` and `src/state/draft-sync.test.ts`
  — PASS (the existing describes, including "the submission id of a confirmation" `:121`, are
  untouched).
- [ ] **Step 6: Typecheck, format, commit** — `"Bill payments: per-bill rules for a payment that got no answer (A796 default 7)"`.

### Task 2: the dialog's lock view

**Goal:** the dialog can show the lock of picture 7, right — "Sin conexión con el servidor", the
reworded explanation and **Comprobar de nuevo** — and nothing else, while a property says so. No
till wiring yet.

**Risk triggers:** payments (what the waiter can press). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (a lock view; `#guestsShown`
`:1429-1435`), `apps/till/src/i18n/strings.ts`. Test `apps/till/src/widgets/bill-pay-dialog.test.ts`,
`apps/till/src/widgets/bill-pay-dialog.a11y.test.ts`.

**Interfaces:**
- `@property({ attribute: false }) unanswered: { applied: string; method: "cash" | "card"; guests: boolean; waiting: boolean; readerRefused: boolean; noReader: boolean } | null = null`.
- While not null the dialog shows only the lock view:
  - a tone box `data-pay-unanswered` with `t("bill_pay.unanswered_title")`;
  - the `wt-form-actions` message `t("bill_pay.unconfirmed")`, with these lines under it:
    `t("bill_pay.recheck_choose_reader")` when `readerRefused` or `noReader`;
    `t("bill_pay.read_failed")` when the dialog's `refusal` is `{ code: "unread" }` (the failed
    balance read, `till-app.ts:12072-12074`);
  - the receipt guests field when `guests` (picture 7 has none; it is kept because the server's
    replay ignores guests, so the count can still change);
  - one primary `[data-pay-recheck]`, disabled while `waiting`, `noReader` or `busy`, loading while
    `busy`; no Atrás; the dialog stays closable. Pressing it emits `bill-pay-recheck` with
    `ReceiptGuestsDetail` (`{ guests }` when the field shows, else `{}`).

**Strings** (`bill_pay.unconfirmed` keeps its key and is reworded):
- `bill_pay.unanswered_title`: en "No connection to the server" / es "Sin conexión con el servidor"
- `bill_pay.unconfirmed`: en "The server did not answer, so this payment may or may not have been
  taken. Press Check again: it asks about this same payment, and it will not be recorded twice." /
  es "El servidor no ha respondido, así que este pago puede haberse cobrado o no. Pulsa Comprobar de
  nuevo: se pregunta por este mismo pago y no se registrará dos veces." (picture 7, right)
- `bill_pay.recheck`: en "Check again" / es "Comprobar de nuevo"
- `bill_pay.recheck_choose_reader`: en "That card reader cannot check it. Choose a reader, then check again." /
  es "Ese lector no puede comprobarlo. Elige un lector y vuelve a comprobar."

- [ ] **Step 1: Failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: a payment that got no answer"`: with `unanswered` set the dialog shows the
  title, the message, one `[data-pay-recheck]`, no `[data-pay-back]`, no `[data-pay-continue]`;
  `readerRefused` and `noReader` each add the reader line, and `noReader` disables the button; an
  `unread` refusal adds `bill_pay.read_failed`; `guests` shows the guests field and the recheck event
  carries its value; `waiting` disables the button; pressing it emits `bill-pay-recheck`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "got no answer"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the dialog's test, unsaved and a11y files — PASS. Add
  the lock view to the a11y two-theme describe.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payment dialog: the lock view for a payment that got no answer (A796 default 7)"`.

### Task 3a: lock a bill to "Comprobar de nuevo"

**Goal:** the till keeps Task 1's model per bill and drives Task 2's lock view. Comprobar de nuevo
resends the same submission naming the reader this phone would charge **now**. Closing, reopening
and logging out keep the lock. In this task the lock lifts only when a send is answered; Task 3b
adds the balance read that also settles it.

**Risk triggers:** payments; concurrency. **Per-task review: yes** (high-effort reviewer).

**Files:**
- Modify: `apps/till/src/till-app.ts` — `#unansweredPayment` and `#paymentSends` (`:2640-2643`)
  become `#pendingPayments: PendingPayments` and a `#payTicks` counter; `#busyForReload`
  (`:1412-1425`); `#resend` (`:1473-1479`); `#onBillPayConfirm` (`:12107-12150`);
  `#onBillPayRefused` (`:12204-12235`); `#renderBillPaying` (`:8324-8351`); a new
  `#onBillPayRecheck`.
- Test: `apps/till/src/till-app-bill-payments.test.ts`.

**Interfaces:**
- `#resend` passes `onUnanswered` through to `resendUnanswered`; `#onBillPayConfirm` and
  `#onBillPayRecheck` give it `() => (this.#pendingPayments = sendUnanswered(this.#pendingPayments, billId, turn))`.
- `#onBillPayConfirm`: `sendStarted(...)` before sending, `sendEnded(..., ++this.#payTicks, error?)`
  after (replacing `settle`/`unansweredAfter` at `:12129-12131`).
- `#onBillPayRecheck()`: resends the bill's entry's `submission.request` with `guests` from the
  event when given, and — for `entry: "reader"` — `readerId` set to the reader this phone would
  charge now: the kept id on a practice venue (`cardProvider === "simulator"`); otherwise the id of
  the reader this device holds and can charge (`payReaderOf(this.deviceEquipment)`,
  `till-app.ts:403-407`). With none: on a counter till the request carries no `readerId`, so the
  server charges the device's chosen or default reader as a counter's card does today
  (`resolvePayReader`, `till-api.ts:330-334`); on a handheld that fallback would charge a reader the
  waiter did not choose (default 16), so the lock's `noReader` is set and Check again stays
  disabled. Same `#holdingReload` → `#withReaderPayment` → `#resend` path, `sendStarted`,
  `sendUnanswered` and `sendEnded`.
- `#onBillPayRefused`: on a refusal that answers a Check again, the dialog never shows that
  refusal's own message; the lock view shows instead, with `readerRefused` for `reader.not_held`,
  `reader.payment_in_progress` and `reader.not_found`. It still re-reads the balance (`:12233`).
- `.unanswered` for the open dialog comes from `lockFor(this.#pendingPayments, open.billId, open.id)`.
- `#busyForReload` uses `holdsReload(this.#pendingPayments)` in place of `#unansweredPayment !== null`.

- [ ] **Step 1: Write the failing till cases** in `till-app-bill-payments.test.ts`, a new describe
  `"till-app: a bill payment that got no answer"`, each with the balance read failing while the
  phone is "offline" (`getBillBalance` rejecting `new TypeError("Failed to fetch")` after the
  dialog's first read), so they keep passing once Task 3b settles sends by a read:
  - `it("after an unanswered contribution, the next guest's identical contribution cannot reuse it: only the same payment can be checked again")`
    (the backlog's case): contribute 40 cash, 50 tendered, confirm; close and reopen; the dialog
    shows `[data-pay-unanswered]`, no `[data-pay-continue]`, no `[data-pay-confirm]`; answer the next
    call with `takenOf(...)`, press `[data-pay-recheck]`; its `submissionId` equals the first; then a
    new identical contribution's `submissionId` differs.
  - `it("an unanswered payment on one bill stays locked after another bill's payment is answered")`.
  - `it("a card whose first attempt got no answer and whose retry was refused for the reader stays locked")`
    (review 2's C1): `takeBillPayment` rejects `new TypeError("Failed to fetch")` then
    `{ code: "reader.not_held", status: 409 }`; the lock shows, and `codeMessage("reader.not_held")`
    is nowhere in the dialog.
  - `it("a Check again of a card names the reader this device holds now, and a reader refusal keeps the lock")`:
    a reader card on r1 gets no answer; the held equipment now resolves r2; Check again sends
    `readerId: "r2"` and the first `submissionId`; answered `{ code: "reader.not_held", status: 409 }`,
    the lock stays with `t("bill_pay.recheck_choose_reader")`.
  - `it("on a handheld with no reader it can charge, Check again is held and asks for a reader")`.
  - `it("a server error with no code leaves the bill locked")`: `{ code: "server.internal", status: 502 }`.
  - `it("a reopened dialog waits on a payment still out from a dialog a logout closed")`: lock shown,
    `[data-pay-recheck]` disabled until that send ends.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-bill-payments.test.ts -t "got no answer"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-bill-payments.test.ts src/state/bill-payment.test.ts src/state/draft-sync.test.ts src/widgets/bill-pay-dialog.test.ts src/widgets/bill-pay-dialog.unsaved.test.ts`
  — PASS except the tests below, which the spec changes. Any other red test is a STOP.

**Tests the spec changes.** Two reasons cover them all: (A) default 7 replaces "take it again" with
"Comprobar de nuevo" and forbids a new payment on a bill while one is unanswered; (B) from Task 3b a
balance read after a send settles it, so a case that wants the lock must have its balance read
fail, as it would with no connection (a fixture change, made here so the cases hold through 3b, and
named in the commit).
- `till-app-bill-payments.test.ts:1150` "offers to take a payment that never got an answer again,
  under the same submission id" — (B) `getBillBalance` rejects after the first read; (A) press
  `[data-pay-recheck]` in place of `[data-pay-confirm]`. Its assertions stay.
- `:2072` "keeps the next operator's payment that got no answer when an earlier operator's payment
  is answered late" and `:2111` "resends the next operator's unanswered payment under its own id when
  an earlier operator's payment is refused while it is out" — (A) both start a second payment on a
  bill while the first is still out, which default 7 forbids. The property they protected — a late
  answer never overwrites a newer send — moves to Task 1's "an older turn's answer changes nothing"
  case; say so in the commit. Each is replaced by a case of the new rule with the same setup: the
  next operator's dialog opens on the lock with `[data-pay-recheck]` disabled; for `:2072` the
  earlier send's late result frees the bill and the form shows; for `:2111` the earlier send ends
  with no answer (`new TypeError("Failed to fetch")`, the balance read failing),
  `[data-pay-recheck]` becomes enabled, and it sends the **earlier** submission id.
- `:2153` "sends the next operator's same payment under the id of one that got no answer after its
  operator logged out" — (B) the reopened dialog's balance read fails; (A) the next operator opens the
  dialog on the lock and presses `[data-pay-recheck]` in place of `payTheRest(el)`. The assertion
  `expect(next).toBe(earlier)` stays.
- `:2374` "sends a payment that got no answer again under the same submission id after the guests
  count changed, carrying the new count" — (B) as above; (A) the stepper is the lock view's guests
  field and the press after changing it is `[data-pay-recheck]`. Its assertions stay; if any later
  step cannot pass unchanged, STOP and report.
- `:3139` "sends a card that got no answer under the same submission id after the reader is refused"
  — (B) as above; (A) after the fixture's `reader.provider_disconnected` (503) answer the lock stays
  (a 5xx is uncertain, rule 1; `expect(inDialog(el, "[data-pay-confirm]")).toBeNull()` still holds),
  and the `[data-pay-continue]`, `[data-pay-confirm]` presses become one `[data-pay-recheck]`. The
  final assertions (taken text, one submission id) stay.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payments: lock a bill to Check again while its payment is in doubt (A796 default 7)"`.

### Task 3b: a balance read settles an unanswered payment

**Goal:** every balance read sent after a send ended settles it (Task 1, rule 5): a payment the
read finds shows its state; a payment the read does not find lifts the lock and keeps the id; and a
late result from a closed dialog refreshes the dialog now open on that bill.

**Risk triggers:** payments; concurrency. **Per-task review: yes** (high-effort reviewer).

**Files:** Modify `apps/till/src/till-app.ts` (`#rereadBillPaying` `:12064-12078`, `#onBillPaid`
`:12159-12195`), `apps/till/src/i18n/strings.ts`. Test `apps/till/src/till-app-bill-payments.test.ts`.

**Interfaces:**
- `#rereadBillPaying`: records `const tick = ++this.#payTicks` before the read and, on an answer,
  applies `settledByBalance(this.#pendingPayments, balance, tick)`. Its `found` carries the removed
  entry (`{ payment, entry }`, Task 1), which is where the automatic Check again below takes its
  submission from.
  - `found`, `received`, and `balance.status === "settled"`: a Check again of that payment replays
    it with the bill's invoice (`resultOf`, `bill-payments.ts:959-970`) and `#onBillPaid` shows the
    ticket and its original print; so the till sends that Check again itself, at once, with
    `found.entry.submission` (same id; the server writes nothing new), naming the reader as
    `#onBillPayRecheck` does. It is sent **at most once per found payment** (the till remembers the
    payment ids it has sent one for), and its refusal never triggers another: `#onBillPayRefused`
    re-reads after every refusal (`:12233`), and a refusal raised before the look-up, such as
    `reader.not_found` from `resolvePayReader` (`till-api.ts:335-343`), would otherwise find the bill
    settled again and send again. On a refusal it falls back to the next line.
  - `found`, `received`, bill not settled → `taken: { change }`; `pending` →
    `taken: { change: null, pending: applied }`; `declined` → `refusal: { code: "declined" }`;
    `failed` → `refusal: { code: "payment_failed" }`, back on the confirmation, not shown as a
    decline. `failed` is the only state `failBillPayment` writes (`bill-payments.ts:1280`). Its
    callers write it where the server knows no money moved — a start refusal (`:1369-1372`), a
    provider answer that charged nothing, a decline included (`:1291-1295`, `:1394-1400`), the loop
    finding no provider row or a failed one (`bill-payments-loop.ts:100-124`), a manager's
    resolution the provider confirms (`payments-api.ts:1181-1187`) — or where a manager recorded
    that nothing was charged: the PIN-confirmed attestation (`payments-api.ts:1196-1222`), refused
    only while the provider row is still attempting or shows a charge (`:1207-1218`), so otherwise
    it rests on the manager's word. `bill_pay.payment_failed`'s wording therefore says what the
    record says, not that the till has seen that no money moved.
  - `freed` → the lock lifts, `asked`/`preview` stay so the waiter can retake it, and an identical
    retake reuses the kept id (Task 1, rule 5). Its message: `freed.refusal`'s when there is one,
    except `reader.not_held` (whose general wording claims no card was charged, which the read does
    not show), which shows `bill_pay.reader_gone_retake`; with no refusal, `bill_pay.not_recorded`.
    There is no Check again button once the lock lifts, so neither message tells the waiter to check
    again.
- `#onBillPaid` for a dialog that is no longer open (`#billPayingNow` null, `:12161-12162`): when
  another dialog is open on the same bill, re-read the balance into it, so a lock lifted by that
  late result does not leave an old balance on screen.

**Strings:**
- `bill_pay.not_recorded`: en "This payment is not on the bill. You can take it again." /
  es "Este cobro no está en la cuenta. Puedes volver a cobrarlo."
- `bill_pay.payment_failed`: en "This payment is recorded as not taken. You can take it again." /
  es "Este cobro consta como no cobrado. Puedes volver a cobrarlo."
- `bill_pay.reader_gone_retake`: en "This device no longer had that card reader. Choose a reader and take the payment again." /
  es "Este dispositivo ya no tenía ese lector. Elige un lector y vuelve a cobrar."

- [ ] **Step 1: Write the failing till cases** in the describe `"till-app: a bill payment that got no answer"`:
  - `it("a balance read that shows the unanswered payment frees the bill and shows its state")`:
    the read answers with the sent `submissionId` in state `pending`; the lock goes and the
    card-pending line shows; the same with state `failed` shows `bill_pay.payment_failed`.
  - `it("a balance read that shows the unanswered payment settled the bill sends Check again itself and shows the ticket")`:
    the read shows it `received` and the bill `settled`; exactly one more `takeBillPayment` with the
    same id, answered with an invoice; the ticket view shows.
  - `it("an automatic Check again that is refused is not sent again")`: as above, but the automatic
    send is refused `{ code: "reader.not_found", status: 404 }` and every later read still shows the
    bill settled; exactly one extra `takeBillPayment` is sent, and the taken line shows.
  - `it("a balance read without the unanswered payment lifts the lock and keeps its id for an identical retake")`:
    the lock goes, `t("bill_pay.not_recorded")` shows, and the next confirm sends the **same**
    `submissionId`; a cleared entry whose recorded refusal was `reader.not_held` shows
    `t("bill_pay.reader_gone_retake")`.
  - The sibling of `:2153`: the reopened dialog's read succeeds without the id; the form shows and an
    identical payment keeps the id.
  - `it("a late result from a dialog a logout closed re-reads the balance into the dialog now open on that bill")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-bill-payments.test.ts -t "balance read|automatic Check again|late result"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** Task 3a's Step 4 files — PASS, the cases Task 3a
  edited included.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payments: a balance read settles a payment that got no answer (A796 default 7)"`.

### Task 4: ask before a second card when a card is already in progress

**Goal:** if the phone has no entry for the bill (the browser was killed and the id lost), the
reopened dialog shows the pending card "En curso" with its amount reserved (today's payments list
and balance already do, `bill-pay-dialog.ts:864-938`), and before **any card** payment — on a reader
or typed on another machine, as design §4 and default 7 say "another card" — on a bill whose balance
holds a pending card it asks "Hay un pago con tarjeta en curso en esta cuenta. ¿Cobrar otro?". Cash
is not asked: the design is silent on it (decision 7). Every device.

**Risk triggers:** payments. **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts`, `apps/till/src/i18n/strings.ts`.
Test `apps/till/src/widgets/bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`.

**Interfaces:** consumes `BillBalance.payments[].state === "pending"` with `.method === "card"`
(`apps/till/src/api/client.ts:1006-1019`). The question is an inline confirmation inside the form:
while it shows, Continuar and Enter submission are suspended (conventions-ui.md, "An inline
confirmation embedded IN a form suspends that form's Save").

**Strings:**
- `bill_pay.card_in_progress_ask`: en "A card payment is in progress on this bill. Take another?" /
  es "Hay un pago con tarjeta en curso en esta cuenta. ¿Cobrar otro?"
- `bill_pay.card_in_progress_take`: en "Take another" / es "Cobrar otro"

- [ ] **Step 1: Failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: a card already in progress"`: with a balance holding one pending card and
  `unanswered` null, choosing card and pressing Continuar emits no `bill-pay-preview` and shows
  `[data-pay-card-ask]` — on a reader and typed (`cardReader: "none"`) alike;
  `[data-pay-card-ask-take]` emits `bill-pay-preview` once; `[data-pay-card-ask-back]` hides it and
  emits nothing; cash emits at once; with no pending card, a card emits at once.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "already in progress"` — FAIL.
- [ ] **Step 3: Implement** `@state() private askingSecondCard = false` and the inline question in
  `#form()` above `wt-form-actions`, entered from `#continue()` (`:800`).
- [ ] **Step 4: Run** the dialog's test, unsaved and a11y files — PASS. Add the question to the a11y
  two-theme describe.
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payments: ask before a second card while one is in progress (A796 default 7)"`.

---

## Part 2 — the handheld profile and new readers (design slice 2, defaults 15 and 16)

### Task 5: Móvil takes reader cards, cash and prints receipts; never the drawer

**Goal:** the seeded handheld profile's actions become, in this order:
`["take-orders", "take-cash", "integrated-card-payment", "hand-keyed-card-payment", "print-receipt", "prepare-orders", "hand-over-orders", "clock-in"]`
(picture 10, right). No `open-cash-drawer`. No default reader: `device_profile_card_readers` is
written outside tests only by `packages/payments/src/device-readers.ts`'s `setProfileReaderList`
(called from `apps/server/src/payments-api.ts:920`) and deleted from by
`apps/server/src/card-reader-delete.ts:278`; no seed writes it, and this task keeps it so.

**Risk triggers:** auth and permissions (profile actions); the drawer rule. **Per-task review: yes.**

**Files:**
- Modify: `packages/layouts/src/device-profile.ts:110-116`
- Test: `packages/layouts/src/device-profile.test.ts:230-236`,
  `packages/provisioning/src/venue-plan.test.ts:111-121`,
  `packages/provisioning/src/venue-apply.test.ts:402-411`,
  `apps/server/scripts/dev-setup.test.ts:322-331`
- Test (new cases): `apps/server/src/bill-payments-api.test.ts`

**Tests the spec changes** (default 15 changes the seed): the four pinned lists above take the new
list; nothing else in them changes.

- [ ] **Step 1: Write the failing drawer case and its control** in `bill-payments-api.test.ts`,
  modelled on `:766` ("opens no drawer for cash taken on a handheld whose profile does not allow the
  drawer"). The fixture (`:263-310`) gains two profiles (a fixture addition): one with
  `DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]`, one with that list plus `"open-cash-drawer"`, and
  a device on each; the fixture already sets every device's `cash_drawer_printer_id` to a printer
  with a drawer (`:329-332`). Cases:
  `it("a cash bill payment from a device on the seeded handheld profile opens no drawer")` — 200,
  and no `drawerOpens` row for the payment (read as `:786-788` reads it), and `drawerJobCount()` (`:3623`)
  unchanged; and the control
  `it("the same cash payment opens the drawer once the profile also allows it")` — one
  `drawerOpens` row and one more drawer job. Before the seed change the first fails on the cash
  refusal (the seed has no `take-cash`); say in the commit which code it printed. The control shows
  the first can fail for the drawer reason.
- [ ] **Step 2: Update the four pinned lists** (the listed spec change) and run them — they fail
  against today's seed.
- [ ] **Step 3: Change `DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]`.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run src/venue-plan.test.ts src/venue-apply.test.ts`,
  `pnpm --filter @waitron/server exec vitest run scripts/dev-setup.test.ts src/bill-payments-api.test.ts -t "seeded handheld|also allows it"` — PASS.
- [ ] **Step 5: Run the whole server, layouts and provisioning suites** (a seed change breaks
  sibling fixtures that build devices from the seed; about twenty server test files name
  `"phone-portrait"`): `pnpm --filter @waitron/server test:coverage`, then the same for
  `@waitron/layouts` and `@waitron/provisioning`. Any red test outside the four listed is a STOP.
  Then the fiscal golden tests (Global constraints).
- [ ] **Step 6: Typecheck, format, commit** — `"Móvil takes reader cards and cash and prints receipts; never the drawer (A796 default 15)"`.

### Task 6: a new card reader joins every profile that takes reader payments

**Goal:** when a manager adds a card reader, or adopts one that did not exist before, it is appended
to the reader list of every live device profile that has `integrated-card-payment`, never as that
profile's default (default 16). Re-adopting a disabled reader (the adopt route reuses its id,
`payments-api.test.ts:1313`) changes no list: a manager may have taken it off on purpose
(decision 4). The practice venue's demo reader, written at boot (`apps/server/src/boot.ts:380-414`),
joins nothing.

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
  the insert, and only when the insert created the row.

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

### Task 7: what the row shows, worked out from the equipment read

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
  | { kind: "ready"; id: string; name: string; provider: string; fromDefault: boolean }
  | { kind: "switched_off"; id: string; name: string }   // chosen or resolved, not available (also unpaired)
  | { kind: "none" };
export type PayPrinter =
  | { kind: "ready"; id: string; name: string; fromDefault: boolean }
  | { kind: "switched_off"; id: string; name: string }   // the printer the role points at, switched off: prints nothing (§2.4)
  | { kind: "unset" }                                     // receipt choices exist, none resolves
  | { kind: "none_listed" };                              // no receipt choices here and no chosen or default printer: "sin ticket"
export function payReaderOf(equipment: DeviceEquipment | null): PayReader;
export function payPrinterOf(equipment: DeviceEquipment | null): PayPrinter;
export function rowStartsOpen(reader: PayReader, printer: PayPrinter): boolean; // reader not ready, or printer switched_off or unset
export function readerChoices(equipment: DeviceEquipment | null): EquipmentItem[];  // card_terminal choices; busy ones stay, marked
export function printerChoices(equipment: DeviceEquipment | null): EquipmentItem[]; // receipt choices
```

- A reader is `ready` only when it is available **and** its provider maps to a till provider, as
  today's `payReaderOf` requires (`till-app.ts:403-407`, `tillProviderForReader`); otherwise `none`.
- `fromDefault` is `role.selection === "default"`.
- `switched_off` for the printer covers the chosen printer and the profile's default alike: it is
  whichever printer the receipt role points at, when that printer is switched off. Step 1 pins what
  the server read holds in both cases.
- A portable default printer this phone does not hold resolves to nothing
  (`packages/layouts/src/device-equipment.ts:274-276`), so it reads `unset` or `none_listed` by the
  receipt choices.
- The name clashes with `till-app.ts`'s private `payReaderOf`; rename the private one
  `activeReaderOf` in this task (Task 3a's `#onBillPayRecheck` uses it).

- [ ] **Step 1: Pin the server's read for a switched-off printer and reader.** Find the
  `apps/server/src/device-equipment.test.ts` cases that read a device whose chosen receipt printer,
  whose profile-default receipt printer, and whose chosen reader (switched off, and unpaired) are
  unavailable, and note what `selection`, `chosenId`, `resolved` and `chosen.available` hold. Where
  no case pins one, add it (for example
  `it("reads a chosen printer that was switched off as the chosen, unavailable printer")`),
  asserting the values the read returns today, with no server code change. The till fixtures in
  Step 2 copy those values exactly; cite the cases in the commit.
- [ ] **Step 2: Write failing cases** in `pay-equipment.test.ts`, one per state: reader ready by
  choice, ready by default, a reader whose provider the till does not map (`none`), switched off,
  unpaired, none; printer ready, ready by default, chosen switched off, default switched off, unset,
  none_listed, a portable default not held; `rowStartsOpen` for each; `readerChoices` keeps a busy
  reader with `busy: true`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/state/pay-equipment.test.ts` — FAIL.
- [ ] **Step 4: Implement**, rename, and move `fill`/`optionLabel` to `equipment-labels.ts`.
- [ ] **Step 5: Run** Step 3's command and
  `pnpm --filter @waitron/till exec vitest run src/widgets/equipment-dialog.test.ts src/widgets/equipment-dialog.nfc.test.ts src/till-app-bill-payments.test.ts`
  — PASS (the move and rename change nothing they see).
- [ ] **Step 6: Typecheck, format, commit** — `"Till: the reader and printer a payment would use, from the equipment read (A796)"`.

### Task 8: the folded reader-and-printer row

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
  (a practice venue's demo reader: shown, not choosable; Task 10).
- Events: `pay-equipment-toggle` `{ open: boolean }`; `pay-equipment-pick`
  `{ role: "card_terminal" | "receipt"; id: string; takeOver: boolean }`; `pay-equipment-qr` `{}`;
  `pay-equipment-nfc` `{}`.
- Behaviour:
  - `equipment === null` (not read yet): the summary reads `pay_equipment.reading` and the drop-downs
    are not drawn.
  - Closed summary from Task 7: reader name bold, then "ticket en {printer}" — with
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
    `takeOver: true` (decision 5). Any other pick emits `takeOver: false` at once.
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
- `pay_equipment.reading`: en "Reading…" / es "Leyendo…"
- `pay_equipment.reader_placeholder`: en "Choose the reader in your hand" / es "Elige el lector que tienes en la mano"
- `pay_equipment.printer_placeholder`: en "Choose a printer" / es "Elige una impresora"
- `pay_equipment.saving`: en "Saving…" / es "Guardando…"
- `pay_equipment.take_back`: en "Close" / es "Cerrar"

- [ ] **Step 1: Write failing cases** in `pay-equipment.test.ts` (describe
  `"till-pay-equipment"`), with picks and the takeover question pressed through `userEvent.click`:
  the closed summary for each Task 7 state and for `equipment === null` (Spanish and English, using
  `setLocale`); Cambiar emits `pay-equipment-toggle {open: true}`; opened, the reader combobox is
  required only with `cardRequired`; a busy reader's option is disabled; picking a free reader emits
  `{role: "card_terminal", id, takeOver: false}`; picking a held one shows the question and emits
  only on Quitárselo, with `takeOver: true`; "Cerrar" in the question emits nothing; a printer pick
  emits `role: "receipt"`; QR and NFC show only with `canScan` / `askNfc` and emit their events;
  `saving` shows `pay_equipment.saving` under that field; `fieldErrors.card_terminal` shows under the
  reader field; `disabled` disables Cambiar, QR, NFC and both comboboxes; and (Review focus 4) at
  `page.viewport(390, 900)` with a 40-character reader name and a 40-character printer name, the
  right edges of Cambiar, QR and NFC are within the row's box.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/pay-equipment.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Then `pay-equipment.a11y.test.ts`: axe in both themes for closed,
  opened, the takeover question, saving and an error; plus the LOOK case (Global constraints) for
  closed and opened, Spanish, at 390 and 1280. Run it and LOOK at the PNGs.
- [ ] **Step 5: Root guards**: `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/screenshot-paths.test.ts`.
- [ ] **Step 6: Typecheck, format, commit** — `"Till: the folded reader and printer row (A796)"`.

### Task 9: the handheld's ways and methods

**Goal:** with `handheld` set, the dialog offers the ways **Toda la cuenta**, Pagar artículos,
Aportar una cantidad, Dividir a partes iguales (Toda la cuenta first and chosen by default, and
disabled until a balance has been read), and the methods **Tarjeta** (only where the profile has
`integrated-card-payment`), **Efectivo** (only where it takes cash) and **Otro datáfono** (only
where it has `hand-keyed-card-payment`) — the typed card chosen on purpose, never a silent fallback
(defaults 2 and 3). Its title is "Cobrar · {table}". Counter tills (`handheld` false) are unchanged.

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
  `card` always sends `{ entry: "reader", ... }` (its reader is Task 10's). The draft records the
  new method value so the unsaved-changes comparison sees a change of method.
- Default method on a handheld: Tarjeta if offered, else Efectivo, else Otro datáfono. With none
  offered, the method fieldset shows `bill_pay.no_method` and Continuar stays disabled.

**Strings:**
- `bill_pay.way_whole`: en "Whole bill" / es "Toda la cuenta"
- `bill_pay.method_other_terminal`: en "Other card machine" / es "Otro datáfono"
- `bill_pay.title_table`: en "Pay · {table}" / es "Cobrar · {table}"
- `bill_pay.no_method`: en "This device's profile takes no payments." / es "El perfil de este dispositivo no cobra."

- [ ] **Step 1: Failing cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: on a handheld"`: four ways in picture 2's order, "whole" checked and
  disabled while `balance` is null; whole with card emits `bill-pay-preview` whose choice is
  `{kind: "contribution", amount: <outstanding>}`; methods shown per the three flags (all eight
  combinations by `it.each`, the empty one showing `bill_pay.no_method`); Otro datáfono shows the
  operation-number field and sends `entry: "manual"`; with `handheld` false the dialog still shows
  today's three ways and two methods (cite the existing case that pins it).
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts -t "on a handheld"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the dialog's test, unsaved and a11y files — PASS. Add "on a handheld, the
  form" to the a11y two-theme describe and a LOOK case at 390 (Spanish).
- [ ] **Step 5: Typecheck, format, commit** — `"Bill payment dialog: Whole bill and Other card machine on a handheld (A796 defaults 2, 3)"`.

### Task 10: the row in the sheet; the charge names its reader

**Goal:** on a handheld the dialog holds `till-pay-equipment` under the methods (picture 2), the
charge button reads "Cobrar 20,80 € en Lector 2", and the request carries that reader's id
(default 16). While Tarjeta is the method and the reader is not `ready` — including before the first
equipment read has answered — or while any equipment change is out, Continuar and Cobrar are
disabled; cash and Otro datáfono never need a reader. The row opens by itself when `rowStartsOpen`,
and starts closed again each time the dialog opens.

**Risk triggers:** payments (the reader charged). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/bill-pay-dialog.ts` (`#readerEntry` `:731-737`,
`#readerFields` `:1274`, `#confirmStep` `:1460-1536`, the confirm event `:1419-1424`),
`apps/till/src/till-app.ts` (`#onBillPayConfirm` `:12107-12150`), `apps/till/src/i18n/strings.ts`.
Test `bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`, `till-app-bill-payments.test.ts`.

**Interfaces:**
- New dialog properties, passed straight to the row: `equipment: DeviceEquipment | null`,
  `equipmentSaving`, `equipmentErrors`, `readerReason`, `canScan`, `askNfc`; plus
  `equipmentBusy: boolean` (any equipment change out, Task 12) and
  `fixedReader: { id: string; name: string } | null`.
- The dialog re-emits nothing: the row's events bubble and are composed. It owns the row's `open`
  state: true on each opening when `rowStartsOpen`, else false; toggled by `pay-equipment-toggle`.
- **How the reader reaches the request.** `asked` lives in `till-app` (`#onBillPayPreview`) and the
  confirm event carries only the guests today. On a handheld the dialog's `bill-pay-confirm` detail
  becomes `ReceiptGuestsDetail & { readerId?: string }`, `readerId` being the row's `ready` reader at
  the moment Cobrar is pressed (a tap that changed it meanwhile is charged, picture 12 middle); in
  `#onBillPayConfirm`, when `asked.card?.entry === "reader"` and `detail.readerId` is set, the
  confirmation's card entry takes that `readerId`. The button's label reads the same `equipment`, so
  label and request agree.
- **A practice venue.** On the simulator only (`this.cardProvider === "simulator"` in `till-app`,
  not `#paysFromBoot()`, which is also true before a real phone's first equipment read,
  `till-app.ts:7952-7954`) the row shows the boot's demo reader fixed (`fixedReader`, no reader
  drop-down) and the request names its id, which the server accepts only on the simulator
  (`resolveCardCollector`, `apps/server/src/till-api.ts:370-384`). The design does not cover the
  simulator; this keeps the demo usable (decision 3). On the simulator the fixed reader counts as
  `ready` whether or not the equipment has been read, because it is not an equipment choice; the
  "wait for the first equipment read" hold above applies to a real reader only.
- **The lock view on a handheld** (Task 2) gains the row, under the explanation, when the kept send
  is a reader card and `noReader` or `readerRefused` is set: its line says "Choose a reader", and
  this is where the waiter does. Check again then names the reader picked (Task 3a's rule).

**Strings:**
- `bill_pay.take_on_reader`: en "Take {amount} on {reader}" / es "Cobrar {amount} en {reader}"

- [ ] **Step 1: Failing dialog cases** in `bill-pay-dialog.test.ts`, describe
  `"till-bill-pay-dialog: the reader and printer on a handheld"`: the closed row names Lector 2 and
  Barra (picture 2); Cobrar reads "Cobrar 20,80 € en Lector 2"; the confirm event carries
  `readerId: "r2"`; changing `equipment` to Lector 3 while on the confirmation changes the button and
  the next confirm carries `"r3"`; with reader `none` and Tarjeta the row is open and Continuar is
  disabled, and with Efectivo it is enabled; with `equipment` null and Tarjeta, Continuar is disabled;
  with `equipmentBusy`, Continuar and Cobrar are disabled; the row is closed again after the dialog
  closes and reopens with a ready reader; with `fixedReader` and `equipment` null, Continuar is
  enabled and the confirm carries its id, and no reader combobox shows; the lock view with a reader
  card and `noReader` shows the row, and once `equipment` resolves a reader Check again is enabled;
  with `handheld` false nothing of this shows.
- [ ] **Step 2: Failing app case** in `till-app-bill-payments.test.ts`: a confirm event carrying
  `readerId` makes `takeBillPayment` send that id.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.test.ts src/till-app-bill-payments.test.ts -t "reader and printer on a handheld|carrying readerId"` — FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the dialog's three files and `till-app-bill-payments.test.ts` — PASS. Add the
  confirmation step with the row to the a11y two-theme describe; LOOK at 390 and 1280, Spanish, form
  and confirmation.
- [ ] **Step 6: Typecheck, format, commit** — `"Bill payment dialog: the folded reader and printer row; Cobrar names its reader (A796)"`.

### Task 11: open the sheet from a handheld's bill

**Goal:** on a handheld, a bill that owes and is **open** shows one primary "Cobrar" button in place
of `till-tender-pay`, the "pay the rest" button and the three part-payment buttons, in both branches
of `#paySection` (`till-table-order-screen.ts:3461-3500`): the partly-paid amount lines and
`#billChoices` (full invoice, receipt language, `:3506`) stay. It opens the dialog in handheld mode on
"Toda la cuenta" (picture 2), and opening it reads the equipment again (§4, "proposed, whenever the
sheet opens"). A **presented** bill keeps today's `till-tender-pay` until Task 15. Picks are Task 12's.

**Risk triggers:** payments (the whole bill on a handheld now goes through the bill payment path,
default 2). **Per-task review: yes.**

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`#paySection` `:3461-3500`;
  `handheld` property `:1236`)
- Modify: `apps/till/src/till-app.ts` (`#renderBillPaying` `:8324-8351`, `#openBillPaying`
  `:12028-12055`)
- Create: `apps/till/src/till-app-handheld-pay.test.ts`; `apps/till/test/bill-pay-app.ts` (helpers
  the new file shares with `till-app-bill-payments.test.ts`, moved verbatim — a listed fixture move)
- Test: `apps/till/src/screens/till-table-order-screen.bill-payments.test.ts`,
  `apps/till/src/till-app-bill-payments.test.ts`

**Interfaces:**
- Table screen: on `handheld` with an open bill that owes, `[data-pay-sheet]` dispatches `bill-pay`
  with `{ way: "whole", lines: <PayLine[] as #payPart builds them> }` (`BillPayDetail`, `:383`).
- `till-app` passes `.handheld=${this.handheldMode}`, `.tableName`, `.takesManualCard` (the
  `hand-keyed-card-payment` action), `.equipment=${this.deviceEquipment}`, `.canScan=${canScan()}`
  (exported from `equipment-dialog.ts:64-66` in this task) and `.fixedReader` (Task 10).
- `#openBillPaying` on a handheld also calls `#readEquipment()` (`:7916`), not awaited by the
  dialog's opening.

**Tests the spec changes** (defaults 2 and 3 replace the handheld's whole-bill tender and the
silent typed card):
- `till-app-bill-payments.test.ts:3225` "offers no reader to a handheld whose profile lacks
  integrated card payment: its card is keyed on a separate terminal" — two edits: its profile's
  capabilities `["print-receipt"]` gain `"hand-keyed-card-payment"`, because a typed card is now an
  explicit method offered only to a profile that may take one (default 3; the server already
  requires that action, `bill-payments-api.ts:233`); and the press becomes
  `input[name="method"][value="manual"]`. Its assertions (`input[name="reader"]` absent,
  `externalRef` shown, `entry: "manual"`) stay.
- Any table-screen test that mounts with `handheld` and reaches `till-tender-pay` for an open bill:
  list it in the handover before editing; if more than two, STOP.

- [ ] **Step 1: Failing cases** in `till-app-handheld-pay.test.ts`, describe
  `"till-app: paying a table from a handheld"` (mount as `:3225` does, `formFactor: "phone-portrait"`,
  capabilities with `integrated-card-payment`, `take-cash`, `hand-keyed-card-payment`, and
  `getDeviceEquipment` answering Lector 2 and Barra): pressing `[data-pay-sheet]` opens the dialog
  with `handheld` set, "whole" checked and the row naming Lector 2; opening it sent one more
  `getDeviceEquipment`; a whole-bill card payment sends `takeBillPayment` with
  `entry: "reader", readerId: "r2"`; a partly-paid bill shows its amount lines, `#billChoices` and
  `[data-pay-sheet]`; a presented bill still shows `till-tender-pay`.
- [ ] **Step 2: Failing screen case** in `till-table-order-screen.bill-payments.test.ts`: with
  `handheld` and an open bill, one `[data-pay-sheet]`, no `till-tender-pay`, no
  `[data-open-bill-pay]`, no `[data-pay-rest]`; without `handheld`, today's controls.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts src/screens/till-table-order-screen.bill-payments.test.ts` — FAIL.
- [ ] **Step 4: Implement**; move the shared helpers into `apps/till/test/bill-pay-app.ts`.
- [ ] **Step 5: Run** Step 3's files, `src/till-app-bill-payments.test.ts` and
  `src/screens/till-table-order-screen.test.ts` — PASS apart from the listed change.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld: Cobrar opens the pay sheet on the whole bill (A796 default 2)"`.

### Task 12: picks from the row, and charging waits for every equipment change

**Goal:** a pick from a drop-down goes through `till-app`'s existing equipment queue as a list pick;
while it is out the sheet shows it as saving. Continuar and a card's Cobrar are held while **any**
equipment change is out — a pick from the sheet or from Equipment, an NFC tap or a QR scan — because
each goes through `#onEquipmentChange` (`till-app.ts:8157-8167`, `#pickUpNfc` → `:2590-2612`) and
counts in `#equipmentWaiting` (`:2613`) (Review focus 5).

**Risk triggers:** payments; concurrency (an equipment change in flight against a charge).
**Per-task review: yes.**

**Files:** Modify `apps/till/src/till-app.ts` (`#onEquipmentChange` `:8157-8167`,
`#switchEquipment` `:8171-8257`, `#renderBillPaying`). Test `till-app-handheld-pay.test.ts`.

**Interfaces:**
- `#equipmentWaiting` (`:2613`) is a plain field, so a change to it does not redraw. It changes in
  three places: up in `#onEquipmentChange` (`:8162`), down in `#switchEquipment`'s early return for
  a tap whose session has ended (`:8180`) and down in its `finally` (`:8253`); it is read at `:2268`
  and `:7937`. Make it one reactive field instead of copying it: `@state() private equipmentWaiting = 0`,
  replacing every use, and pass `.equipmentBusy=${this.equipmentWaiting > 0}`.
- The same `equipmentBusy` also holds Check again in the lock view when the kept send is a reader
  card (Task 2's `waiting`), as Cobrar is held.
- `payEquipmentSaving: { role; id } | null` — the sheet's own latest pick, for the field's "saving"
  hint only (set before queueing, cleared when that pick ends). The hold is the count, not this.
- `@pay-equipment-pick` → `#onEquipmentChange(new CustomEvent("equipment-change", { detail: { role, selection: { id }, via: "list", takeOver } }))`.

- [ ] **Step 1: Failing cases** (describe `"a pick from the sheet"`, picks through `userEvent.click`):
  a reader pick sends `PUT /api/device/equipment` with
  `{ role: "card_terminal", selection: { id }, via: "list", takeOver: false }`; while it is
  unanswered `[data-pay-continue]` is disabled and the field shows `pay_equipment.saving`; once
  answered the row shows the new reader and Continuar is enabled; two picks out at once, the first
  answered: still held until the second answers; an NFC tap still out (the `FakeNdefReader` from
  `apps/till/test/equipment-nfc.ts`) holds Continuar too; a tap queued, then a logout and a sign-in
  again (the early-return path) leaves Continuar enabled; a reader card's Check again is held while
  a pick is out.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts -t "pick from the sheet"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the file, `src/till-app.nfc.test.ts` and
  `src/widgets/equipment-dialog.test.ts` — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: picks save through Equipment, and charging waits for every equipment change (A796)"`.

### Task 13: a pick refused, or with no answer

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

### Task 14: the presented-bill sheet element

**Goal:** default 1, picture 11. A new element, `till-presented-pay-dialog`, draws a presented
bill's sheet: "Cuenta presentada" and its amount, the line "Esta cuenta ya está presentada: se cobra
entera, en un solo pago.", the methods as in Task 9, the same row, the receipt guests field where
today's tender asks for it, and the charge "Cobrar 62,40 € en Lector 2". It only shows and asks; no
till wiring yet.

**Risk triggers:** payments (what the sheet asks to charge). **Per-task review: yes.**

**Files:** Create `apps/till/src/widgets/presented-pay-dialog.ts`, `presented-pay-dialog.test.ts`,
`presented-pay-dialog.a11y.test.ts`. Modify `apps/till/src/i18n/strings.ts`.

**Interfaces:**
- `@customElement("till-presented-pay-dialog")`; properties `open`, `amount: string`, `tableName`,
  `takesCash`, `takesManualCard`, `cardOffered`, `asksGuests`, `receiptGuests`, the equipment
  properties of Task 10 (`equipmentBusy` included); `busy`; `refusal: { code: string; field?: string } | null`.
  Event `presented-pay`
  `{ method: "card"; readerId: string; guests?: number | null } | { method: "cash"; tendered: string; guests?: number | null } | { method: "manual"; externalRef?: string; guests?: number | null }`,
  plus the row's events, and `presented-pay-close` `{}`. It reuses `till-pay-equipment` and
  `pay-equipment.ts`, and the same Continuar/Cobrar holds as Task 10.

**Strings:**
- `presented_pay.balance`: en "Bill presented" / es "Cuenta presentada"
- `presented_pay.whole_only`: en "This bill has already been presented: it is paid whole, in one payment." /
  es "Esta cuenta ya está presentada: se cobra entera, en un solo pago."

- [ ] **Step 1: Failing cases** in `presented-pay-dialog.test.ts`: no ways offered; the amount and
  the line; Cobrar names the reader and emits `{ method: "card", readerId }`; cash needs the
  tendered field; Otro datáfono emits `manual`; no reader + Tarjeta disables Cobrar; `equipmentBusy`
  disables Cobrar for a card; the guests field shows with `asksGuests` and its value travels in the
  event; a `refusal` shows in `wt-form-actions`, or under the field it names.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/presented-pay-dialog.test.ts` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** it and the a11y file (two themes); LOOK at 390 and
  1280 — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Till: the presented-bill pay sheet (A796 default 1)"`.

### Task 15: pay a presented bill from the handheld

**Goal:** on a handheld, a presented bill's pay section shows the same Cobrar button, which opens
Task 14's sheet. A reader card goes to `POST /api/pay` with
`{ id: <working order id>, lines: [], readerId, guests? }` (a placed order ignores `lines`,
`apps/server/src/till-sale.ts:1136`; the body takes `guests`, `IntegratedPayRequest`,
`till-sale.ts:543-573`); cash and Otro datáfono go to `collectOrder`, as `#onPayTab` does today
(`till-app.ts:11871-11934`). No route changes; when the invoice is issued does not change (design
default 1).

**Risk triggers:** payments; fiscal invariants (the invoice path — unchanged, but a wrong route here
would issue or settle it differently). **Per-task review: yes.**

**Files:** Modify `apps/till/src/screens/till-table-order-screen.ts`, `apps/till/src/till-app.ts`.
Test `till-app-handheld-pay.test.ts`, `till-table-order-screen.bill-payments.test.ts`.

**Interfaces:**
- Table screen: on `handheld` with a `placed` bill, `[data-pay-sheet]` dispatches `pay-presented`
  `{ workingOrderId }`.
- `till-app`: `#onPayPresented` opens it (passing `asksGuests = bill.invoiceType !== "F1"` and
  `receiptGuests = defaultReceiptGuests(this.orderParty)`, as the screen does for its tender,
  `till-table-order-screen.ts:3471-3478`), and reads the equipment again as Task 11 does.
  `#onPresentedPay` sends, keeping what `#onPayTab` does around the send: `submitting`,
  `#flushPartyKitchenNote()` first (`:5627`), the visit, session and active-tab checks, and its
  error mapping for cash and manual (`paidMeanwhile` → `bill.pay_with_bill_payments` and a re-read;
  `isPermanentSaleRefusal` → `sale.refused`; `isNetworkFailure` → `sale.unconfirmed`;
  `isTakePaymentRefusal`; `isPaymentInFlight`; `settleRefusalOf`), shown as the sheet's `refusal`. A
  card goes through `#withReaderPayment(true, () => this.api.pay({...}))` and maps the outcome as
  `#collectCard` does (`:5174` onward: captured → done; declined, timeout, network → today's tender
  wording); a `reader.not_held` refusal is Task 26's. A success shows the ticket as today
  (`#showTicket`) until Task 23.

- [ ] **Step 1: Failing app cases** in `till-app-handheld-pay.test.ts`, describe
  `"a presented bill on a handheld"`: `[data-pay-sheet]` opens `till-presented-pay-dialog`; card →
  one `api.pay` call with `lines: []`, the reader id and the guests, no `takeBillPayment`; cash →
  `collectOrder` with the tender and guests; the party's kitchen note is flushed before either; a
  declined card keeps the sheet open with today's decline wording; a cash send refused as paid
  meanwhile shows `bill.pay_with_bill_payments` and re-reads the bills; a success shows the ticket.
- [ ] **Step 2: Failing screen case**: with `handheld` and a placed bill, `[data-pay-sheet]` and no
  `till-tender-pay`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts src/screens/till-table-order-screen.bill-payments.test.ts -t "presented"` — FAIL.
- [ ] **Step 4: Implement.** **Step 5: Run** both files and `src/till-app-bill-payments.test.ts` —
  PASS. Task 11's case "a presented bill still shows `till-tender-pay`" is this task's spec change:
  it now expects `[data-pay-sheet]`.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld: a presented bill is paid whole from the pay sheet (A796 default 1)"`.

---

## Part 4 — stickers in the sheet (design slice 4, defaults 20 and 21)

### Task 16: 📷 QR in the sheet, reading either kind of sticker

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
  `<till-equipment-scanner kind="any">` and a Volver button (`pay_equipment.scan_back`); on
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

### Task 17: a tap's notice shows inside the sheet

**Goal:** while a pay sheet is open, the notice of a tap or a scan — "Has recogido {item}", its
refusal, `equipment.no_printer_role`, a foreign sticker — shows as one line inside the sheet above
the row (picture 12, middle), because today's toast sits beneath an open dialog (design §2.1). A
printer sticker that set only the payment-slip printer says "Has recogido {item} solo para
justificantes de pago." — in the toast as well as the sheet, since it is the same event (decision 6).

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
  `mountEquipmentApp` (`apps/till/test/equipment-app.ts`) and the bill payment helpers
  (`apps/till/test/bill-pay-app.ts`):
  `it("a tap with the pay sheet open changes its row, its drop-downs and its charge button, and leaves the listener running")`
  — after the tap, `[data-pay-notice]` reads "Has recogido {item}", the row and (opened) the reader
  combobox name the new reader, `[data-nfc-notice]` is not open, the `FakeNdefReader`'s scan
  `signal` is not aborted and a second tap sends a second PUT;
  `it("a tap on the confirmation step makes Cobrar send the tapped reader")`;
  a printer tap whose answer resolves it only for `payment_slip` shows the slip-only line, in the
  sheet and, with no sheet open, in the toast.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app.nfc.test.ts -t "pay sheet|confirmation step|payment slips"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the whole `till-app.nfc.test.ts`,
  `till-app.nfc.a11y.test.ts` and `till-app-handheld-pay.test.ts` — PASS. If an existing toast case
  pins "Has recogido" for a slip-only printer, STOP and report. LOOK at the notice line at 390 in
  both themes.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: a sticker's notice shows inside the sheet (A796 default 20)"`.

### Task 18: ask for NFC from the row

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
  "prompt". It calls `scan()` **before its first `await`**, so the call stays inside the click's
  user gesture (design §10: Chrome ties the first scan to "a user gesture such as a touch gesture or
  mouse click"), and starts it as the lifetime's scan (the same `#listen` and abort controller
  `start()` would use), so the permission's later `change` to "granted" finds it already scanning
  and starts no second `scan()`. A `NotAllowedError` reports `onPermission("denied")`.
- `till-app` keeps `nfcPermission: PermissionState | null` and passes `.askNfc=${this.nfcPermission === "prompt"}`;
  `@pay-equipment-nfc` → `this.#equipmentNfc.requestScan()`.

- [ ] **Step 1: Failing case** in `till-app.nfc.test.ts`, modelled on "granting NFC in the dialog
  ends with one live reader and one selection per tap" (`:279`):
  `it("the pay sheet's NFC button ends with one live reader and one selection per tap")` —
  `installNfc("prompt")`; open the sheet; `[data-pay-nfc]` shows; press it; assert `scan()` was
  called synchronously within the press (the `FakeNdefReader` records a signal before the press
  handler's first await returns); flip the permission to granted and dispatch `change`; exactly one
  `FakeNdefReader` instance has a live signal, one tap sends one PUT, and `[data-pay-nfc]` is gone.
  Also: with no `NDEFReader` the button never shows; with "denied" it never shows.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the whole
  `till-app.nfc.test.ts` and its a11y sibling — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: ask for NFC from the row (A796 default 21)"`.

---

## Part 5 — waiting, uncertain, the next guest, the paid screen (design slice 5)

### Task 19: the card at the table

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
  button reads "Reintentar en Lector 3" and its confirm carries `readerId: "r3"`.
- [ ] **Step 2: Failing NFC case** in `till-app.nfc.test.ts`:
  `it("a tap while a card is at the reader is picked up, and the waiting view keeps naming the reader the payment was sent to")`.
- [ ] **Step 3: Run** both — FAIL. **Step 4: Implement.** **Step 5: Run** the dialog's three files
  and the NFC file — PASS; LOOK at the waiting and declined views at 390, both themes.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld pay sheet: the card at the table, and a retry on the reader in hand (A796)"`.

### Task 20: Cobrar al siguiente

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

### Task 21: an uncertain card refreshes itself

**Goal:** default 8, picture 7 left. While the handheld sheet shows **its own** pending card
payment (the one this sheet sent, or the one Task 3b's balance read found for its send), it says "Aún
no sabemos si se ha cobrado" with "El lector no ha contestado. No cobres a este cliente de otra forma
todavía: 20,80 € quedan reservados en la cuenta y esta pantalla se actualiza sola.", keeps today's
last sentence about a manager, and re-reads the bill every 5 seconds until that payment is no longer
pending. Then it shows the settled state. Another phone's pending card on the same bill shows only
as today's reserved amount and payments row.

**Risk triggers:** payments; concurrency (a timer beside answers). **Per-task review: yes.**

**Files:** Modify `apps/till/src/till-app.ts` (beside `#rereadBillPaying` `:12064-12078`),
`apps/till/src/widgets/bill-pay-dialog.ts` (`#takenText`), `apps/till/src/i18n/strings.ts`. Test
`till-app-handheld-pay.test.ts`, `bill-pay-dialog.test.ts`.

**Interfaces:** `const PENDING_REREAD_MS = 5_000` in `till-app.ts`. One timer at a time, keyed by the
open sheet's `BillPaying.id` and the pending payment's id; started when that payment is pending and
stopped when it is not, when the sheet closes, on logout (`#endOperatorSession`, `:11808`) and on
disconnect. Today `#rereadBillPaying` applies whichever answer arrives last; the timer's reads do
not:
- a tick is skipped while the previous tick's read is still out;
- each read carries a sequence number, and an answer older than the newest one applied is dropped;
- a failed tick keeps what the sheet shows, sets no refusal (today a failed read sets
  `refusal: { code: "unread" }`, `:12072-12074`; that stays for the other callers) and tries again
  at the next tick;
- no `#onInteraction` call (Global constraints). Handheld only; counters keep today's text.

**Strings:**
- `bill_pay.uncertain_title`: en "We don't know yet whether it was charged" / es "Aún no sabemos si se ha cobrado"
- `bill_pay.uncertain`: en "The reader has not answered. Do not take this guest's money another way yet: {amount} stays held on the bill and this screen updates itself." /
  es "El lector no ha contestado. No cobres a este cliente de otra forma todavía: {amount} quedan reservados en la cuenta y esta pantalla se actualiza sola."
- `bill_pay.card_pending_manager`: en "If it does not finish, a manager can clear it on the dashboard's Card payments screen." /
  es "Si no termina, un responsable puede anularlo en la pantalla Pagos con tarjeta del panel de gestión."

- [ ] **Step 1: Failing cases** (fake `setInterval`/`setTimeout` only, as `till-app-bill-payments.test.ts:2153`'s
  case fakes timers; real timers restored after each): a pending answer shows the warning; after 5 s
  one `getBillBalance` call, after 10 s two; a read that is still out at the next tick causes no
  second read; an older read answering after a newer one changes nothing; a failed tick shows no
  `bill_pay.read_failed` and the next tick reads again; when a read shows the payment received the
  warning goes and no further read is sent in the next 15 s; (Review focus 2) closing the sheet
  (await its `wt-close`), logging out, or the payment settling each stop the reads; another phone's
  pending card on the bill shows no warning and starts no timer.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the files — PASS; LOOK.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: an uncertain card re-reads itself every 5 seconds (A796 default 8)"`.

### Task 22: the paid screen element

**Goal:** defaults 11 and 12, picture 8 right. A new element, `till-paid-view`, draws "✓ Mesa 4
pagada", "62,40 € en 3 pagos · factura simplificada emitida", the payments with their states, the
ticket line, the print actions, a primary **Cerrar mesa** and "Volver a la mesa". It only shows and
asks; Task 23 wires it.

**Risk triggers:** none in the element (display and events). **Per-task review: no.**

**Files:** Create `apps/till/src/screens/till-paid-view.ts`, `till-paid-view.test.ts`,
`till-paid-view.a11y.test.ts`. Modify `apps/till/src/i18n/strings.ts`.

**Interfaces:**
- `@customElement("till-paid-view")`; properties `tableName`, `total: string`,
  `payments: BillPaymentView[]`, `receipt: OriginalReceiptPrint | null` (null while reading),
  `receiptReadFailed`, `originalAvailable`, `canPrint` (the `print-receipt` action), `busy`.
- Events: `finish-table` `{}` (the name the table screen sends, handled by `#onFinishTable`),
  `back-to-table` `{}`, `print-receipt` `{}`, `retry-receipt` `{}`, `reprint` `{}` — the names
  `till-ticket-view` sends, so `till-app`'s existing handlers take them (`till-app.ts:13139-13152`).
- The ticket line names no printer (the status route returns none; design default 12): `queued`,
  `printing`, `done` → "Ticket enviado"; `failed` → "No se ha podido imprimir", with Retry where
  `canRetry`; `not_queued` → "No se ha impreso ticket" and the reprint hint; `receiptReadFailed` →
  today's `invoice.print_status_failed`. The original-print action shows with `originalAvailable`;
  Reimprimir (a copy) shows otherwise, only with `canPrint`.

**Strings:**
- `paid.title`: en "{table} paid" / es "{table} pagada"
- `paid.summary`: en "{amount} in {n} payments · simplified invoice issued" / es "{amount} en {n} pagos · factura simplificada emitida"
- `paid.ticket_sent`: en "Ticket sent" / es "Ticket enviado"
- `paid.ticket_failed`: en "Could not print" / es "No se ha podido imprimir"
- `paid.ticket_not_printed`: en "No ticket printed" / es "No se ha impreso ticket"
- `paid.ticket_reprint_hint`: en "A device whose profile may print tickets can reprint it." / es "Un dispositivo cuyo perfil puede imprimir tickets puede reimprimirlo."
- `paid.simplified`: en "Simplified invoice" / es "Factura simplificada"
- `paid.back`: en "Back to the table" / es "Volver a la mesa"
- Reuse `table.finish` ("Cerrar mesa"), `action.reprint` ("Reimprimir"), `bill_pay.payment`, and
  the original-print label the ticket view uses (`invoice.print_original` / `action.print_receipt`).

- [ ] **Step 1: Failing cases** in `till-paid-view.test.ts`: each receipt status gives its line;
  retry shows only with `canRetry`; the original-print action shows with `originalAvailable`,
  Reimprimir otherwise and only with `canPrint`; three payments list with their states; buttons emit
  their events.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/screens/till-paid-view.test.ts` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** it and the a11y file (two themes); LOOK at 390 and
  1280 — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Till: the paid screen (A796 defaults 11, 12)"`.

### Task 23: show the paid screen on a handheld

**Goal:** on a handheld, the payment that settles a bill whose invoice is **simplified** (bill path
or presented path) shows `till-paid-view` instead of the ticket view. Paying never frees the table
by itself; Cerrar mesa does. A **full** invoice keeps today's ticket view, whose original-print,
handover and delivery steps are tied to it (`#refreshReceiptPrint`, `till-app.ts:7447-7461`;
decision 9).

The paid screen is drawn from the state `#showTicket` already sets (`:12469-12487`:
`ticketWorkingOrderId`, `originalReceiptAvailable`, `originalReceiptPrint`,
`originalReceiptReadFailed`, `originalReceiptBusy`), so today's actions keep working:
- **The original receipt where receipts print on request.** `originalReceiptAvailable` is true when
  the invoice was issued now and `receiptPrintMode !== "auto"` (`:12483`); the paid screen then
  offers today's "print the original" action (`print-receipt` → `#onPrintReceipt()`, `:7627`,
  `api.printReceipt`, `POST /api/sales/:id/receipt`).
- **The ticket line** reads `GET /api/sales/:id/receipt` (`api.getReceiptPrintStatus`) for a
  simplified invoice too: today `#refreshReceiptPrint` reads it only for a full invoice (`:7449`), so
  it widens to read it while the paid screen shows. Retry (`retry-receipt` →
  `#onPrintReceipt(true)`) today returns early unless the invoice is full (`:7633-7639`), so it
  widens the same way; the server's retry route takes either type
  (`apps/server/src/till-api.ts:2245-2267`).
- **Reimprimir** queues a copy (`reprint` → `#onReprint()`, `till-app.ts:13140`; the server's
  `enqueueReceiptCopy`, `apps/server/src/transaction-receipt-api.ts:69`).

**Risk triggers:** auth and permissions (Cerrar mesa needs `take-orders`, printing needs
`print-receipt` — both existing routes). **Per-task review: yes.**

**Files:** Modify `apps/till/src/till-app.ts` (`#onBillPaid` `:12173-12176`, `#onPresentedPay`,
`#showTicket` `:12469-12487`, `#refreshReceiptPrint` `:7447`, `#onPrintReceipt` `:7627-7660`, the
drill rendering, `#onFinishTable` `:11176`). Test `till-app-handheld-pay.test.ts`.

**Interfaces:** on a handheld with a simplified invoice, `#showTicket` pushes `{ kind: "paid" }` in
place of `{ kind: "ticket" }`; everything else it sets is unchanged. `back-to-table` pops that
drill.

- [ ] **Step 1: Failing app cases**: the third share's answer with a simplified invoice shows
  `till-paid-view`, not `till-ticket-view`, with three payments; one `getReceiptPrintStatus` call;
  with `receiptPrintMode` "on_request" the original-print action calls `printReceipt` once; a failed
  print's retry calls `retryReceipt`; Cerrar mesa calls `finishTable` once; Volver a la mesa returns
  to the order (spy on `history.pushState`/`replaceState`, not `history.length`); the presented path
  (Task 15) shows it too; a full invoice on a handheld still shows `till-ticket-view`; on a counter
  till the ticket view still shows (cite the existing case).
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts -t "paid screen"` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** `till-app-handheld-pay.test.ts`,
  `till-app-bill-payments.test.ts` and the ticket view's tests (`src/screens/till-ticket-view*.test.ts`)
  — PASS.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld: the paid screen replaces the ticket view for a simplified invoice (A796 defaults 11, 12)"`.

---

## Part 6 — first use, and a reader or printer that has gone (design slice 6, defaults 18 and 19)

### Task 24: the first payment on a phone with no reader

**Goal:** default 18, picture 4. A phone with no reader it can charge opens the row with the reader
empty (already so from Tasks 7 and 10; the placeholder is Task 8's). New: when the phone has had no
reader this page session, the equipment read offers exactly one reader for the card-reader role,
and that reader has no `heldBy` and is not `busy`, the sheet picks it up as it opens — the same
request as a list pick (`via: "list"`, `takeOver: false`) — and the row stays closed naming it. A
refused or unanswered automatic pick leaves the left-hand form with Task 13's message.

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
- The automatic pick is sent once the sheet's opening re-read (Task 11) answers, at most once per
  opening, and not while any equipment change is out (`equipmentWaiting > 0`, Task 12).

- [ ] **Step 1: Failing unit cases** for `autoPickReader`: one free reader and no history → its id;
  `hadReader` → null; two readers → null; one held elsewhere or busy → null; the phone already has
  a ready reader → null.
- [ ] **Step 2: Failing app cases**: a fresh page with one free reader sends one list pick as the
  sheet opens and the row is closed naming it; (Review focus 3) closing and reopening the sheet,
  the 15-second poll answering meanwhile, or a tap arriving first, each lead to no second automatic
  pick; a phone that held Lector 2 earlier in the page and lost it gets no automatic pick; a refused
  automatic pick leaves the reader empty with the refusal under it.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** both files — PASS.
- [ ] **Step 6: Typecheck, format, commit** — `"Handheld pay sheet: a phone's first payment picks the one free reader (A796 default 18)"`.

### Task 25: a reader that has gone

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

### Task 26: a reader refused at Cobrar, and a printer that has gone

**Goal:** default 19 and §4. (a) On a handheld, a **first** send of a card refused `reader.not_held`
(the phone lost the reader before it learned) — on the bill path or the presented path — shows,
under the reader field, "Este teléfono ya no tiene ese lector de tarjetas. Elige el lector que
tienes en la mano. No se ha cobrado ninguna tarjeta.", re-reads the equipment, and the row opens with
the reader empty (Review focus 1). The claim "nothing was charged" holds there because the server
refuses before recording (Task 1's reading); a refusal that answers a Check again never shows it
(Task 3a). `reader.not_held`'s general message stays for counter tills (decision 8). (b) The printer
states of picture 5: a switched-off printer (chosen or default) opens the row with the printer field
empty and "Barra está desactivada: si no eliges otra, no se imprimirá el ticket", Continuar enabled;
receipt printers listed but none resolving opens it with "Sin impresora de tickets: si no eliges
una, no se imprimirá el ticket"; a printer the server forgot (deleted, off the list, marked
portable) falls back to the profile's default, row closed, "(predeterminada)" — already Task 8's
summary; no receipt printer here reads "sin ticket", row closed. The paid screen then says "No se ha
impreso ticket" from the `not_queued` status (Task 23).

**Risk triggers:** payments (refusal handling on the charge). **Per-task review: yes.**

**Files:** Modify `apps/till/src/widgets/pay-equipment.ts`, `apps/till/src/widgets/bill-pay-dialog.ts`
and `presented-pay-dialog.ts` (refusal → field), `apps/till/src/till-app.ts` (`#onBillPayRefused`
`:12204-12235`, `#onPresentedPay`), `apps/till/src/i18n/strings.ts`. Test `pay-equipment.test.ts`,
`bill-pay-dialog.test.ts`, `till-app-handheld-pay.test.ts`.

**Strings:**
- `bill_pay.reader_not_held`: en "This phone no longer has that card reader. Choose the reader in your hand. No card was charged." /
  es "Este teléfono ya no tiene ese lector de tarjetas. Elige el lector que tienes en la mano. No se ha cobrado ninguna tarjeta."
- `pay_equipment.printer_switched_off`: en "{item} is switched off: unless you choose another, no ticket will print" /
  es "{item} está desactivada: si no eliges otra, no se imprimirá el ticket"
- `pay_equipment.printer_none`: en "No ticket printer: unless you choose one, no ticket will print" /
  es "Sin impresora de tickets: si no eliges una, no se imprimirá el ticket"

- [ ] **Step 1: Failing cases**: (Review focus 1) on the confirmation step `takeBillPayment` rejects
  `{ code: "reader.not_held", status: 409 }` on a first send → the reader field shows
  `bill_pay.reader_not_held`, one more `getDeviceEquipment` is sent, the row is open with the reader
  empty, and that request was the only one; (review 2's C1) when a first attempt failed with a
  network failure and its automatic retry was refused `reader.not_held`, the not-charged wording
  shows nowhere and the lock shows instead; the same on the presented path through `api.pay`; each
  printer state's row and warning, with Continuar enabled and the payment sent.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the files — PASS; LOOK at
  picture 5's middle and right states at 390, both themes.
- [ ] **Step 5: Typecheck, format, commit** — `"Handheld pay sheet: a lost reader at Cobrar, and a printer that has gone (A796 default 19)"`.

---

## Part 7 — documentation and the backlog

### Task 27: docs and backlog

**Risk triggers:** none. **Per-task review: no.** Docs-only commit on this branch.

**Files:** `docs/backlog.md`, `docs/backlog/payments.md`, `docs/developers/conventions-ui.md`,
`docs/superpowers/specs/2026-10-19-a796-handheld-payments-design.md` (status line only).

- [ ] **Step 1: `docs/backlog.md`.** Delete the entry "The next identical bill payment can be
  answered with an unanswered one" (fixed by Tasks 1–3b). Rewrite "Slice 2 — the handheld NFC/QR link
  … (A796)" to what is left, each as its own short entry in _Payments and card readers_:
  restoring `stripe_on_device` (Tap-to-Pay), waiting for the native-app decision (N1/N2);
  "Name the printer on the paid screen's ticket line" (default 12: the route would have to return
  the print job's printer, `readOriginalReceiptPrints`, `apps/server/src/receipt-print.ts:437-453`);
  "Check paying at the table on the OnePlus 13 at the box's address" (a reader card, a QR scan and
  an NFC tap from the sheet, the NFC button's permission ask; browser tests use fakes); "A user
  guide for the till's payment sheet" (no till guide exists yet); "A different retake — another
  amount, way or reader — after a payment the phone read as not on the bill" (Task 1's known limit,
  in one line). Add any point a task's
  handover left open. Keep the W102 loose ends as they are.
- [ ] **Step 2: `docs/backlog/payments.md`** "Slice 2" section: a dated line (the landing date)
  saying the handheld payment flow landed as A796, pointing at the PR.
- [ ] **Step 3: `docs/developers/conventions-ui.md` → "What an open till keeps current"**: add one
  paragraph — the handheld pay sheet re-reads the equipment when it opens and the bill every 5
  seconds while it shows its own pending card (`PENDING_REREAD_MS`), neither counts as activity for
  the auto-logout, and both are pinned by `apps/till/src/till-app-handheld-pay.test.ts` (name the
  describes). State only what the tests ran.
- [ ] **Step 4: The design's status line**: "Built: <PR>, <date>." under its Status.
- [ ] **Step 5: Format check** with `pnpm exec prettier --file-info <file>` for each (`docs/` is
  ignored whole; `--check` cannot tell), then commit —
  `"A796 docs: backlog entries left open by the handheld payment build"`.

---

## Execution notes

- Order: Parts 1 → 7, tasks in order. Tasks 2 and 3a depend on Task 1, Task 3a on Task 2, Task 3b
  on Task 3a, and Task 4 on Task 2's dialog; Tasks 5 and 6 stand alone; Tasks 7–26 depend on their predecessors'
  interfaces.
- After Task 26, run `/finish-branch` with this plan named; the full review wave runs (risk
  triggers: payments, auth and permissions, a cross-package write, concurrency), with the two Codex
  reviews. The PR description lists every test edited under a task's "Tests the spec changes",
  every fixture move or addition, and "Decisions to name in the PR description".
- No `/land-branch` without the owner.
