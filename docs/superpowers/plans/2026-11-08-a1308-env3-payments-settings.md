# A1308 environment, PR 3 of 8: tips and practice card providers move to the `payments` document — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whether the till offers tips, and whether a Prepare box uses a real card provider's test
account instead of the card simulator, become two switches on the dashboard's Payments screen,
stored in the `payments` settings document. `WAITRON_TILL_TIPS` and `WAITRON_PAYMENT_TEST_PROVIDERS`
stop being read.

**Architecture:** The payments module declares one settings document (slice 1b's
`defineSettingsDocument`; a "settings document" is one JSON row of the shared `settings` table,
read with `readSettings` and saved with `saveSettings`, which refuses a save made from an out-of-date
revision). The three places that decide about tips read the document inside the transaction they
already run. The card simulator, chosen once at start today, is chosen again whenever the
practice switch is saved. A new Settings tab on the Payments screen holds the switches.

**Tech Stack:** TypeScript, drizzle-orm on `node:sqlite`, Hono, Lit, Vitest (Chromium for the
dashboard).

**Spec:** [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1 ("Venue choices
go to the shared `settings` table"), §3 rows `WAITRON_TILL_TIPS` and `WAITRON_PAYMENT_TEST_PROVIDERS`,
§4 "Performance", §5 measure 5; [README](../specs/2026-11-02-rationalisation/README.md) §5 U2, §7;
[slice 1b-i](2026-11-08-a1308-1b-settings-table.md) "Interfaces fixed by this slice" and
[1b-ii](2026-11-08-a1308-1b-ii-adjustments-settings.md) (the transfer path and the shared
`settings.out_of_date` wording); [4b](2026-11-08-a1308-4b-dropped-payment-and-box-features.md)
"What it leaves out" (this plan finishes `TillAppSettings`). Rules:
[the slice rules](2026-11-08-a1308-slice-rules.md). Part overview: [env1](2026-11-08-a1308-env1-tuning-constants.md).

**Needs:** 1b-i and 1b-ii landed (the API, the descriptor seat `WaitronModule.settings`, per-module
live types, the transfer path); 4b landed (`TillAppSettings` is `{ tipsEnabled }`); the payments and
adjustments area slice landed (it owns `packages/payments`' tables and code). Cites were read at
`a086eedfb7`; where 4b or the area slice moved a line, follow it (env1, "Base").

**Preflight note, 2026-11-13 (base `a7bdba21bf`).** The watcher confirmed at 00:53 in Lane H's
questions.md that the payments-area dependency above still applies; do not build this slice yet.
Its simulator-snapshot stop also applies: `mountPaymentsApi` copies `deps.simulator` into the
object passed to `refundProvidersOf` (`apps/server/src/payments-api.ts:1514-1523`), and
`mountTenderRefundApi` copies `deps.cardProvider` (`tender-refund-api.ts:147-157`). Although the
resolver reads that object's property later (`bill-refunds.ts:124-137`), the mount has already
copied the value. This is a source trace, not a runtime proof. Recheck these consumers when the
payments slices land and settle the correction with the watcher before changing their wiring.

**Owner lands:** no. Tips are kept off the invoice (`docs/backlog.md:2598`, the Tips row), so the
switch's source moving changes no sale, invoice number, fiscal record or hashed value; the rule that
clamps a tip to zero when tips are off (`apps/server/src/bill-allocation.ts:112,126`,
`till-sale.ts:1471-1475`) is unchanged. The practice switch is honoured only on a Prepare box, which
is preproduction (`apps/server/src/config.ts:375-378`). Read, not run.

**No venue reset:** no starting migration changes; a document that was never saved reads as its
defaults (1b-i). But a Prepare box whose `deploy/.env` sets `WAITRON_PAYMENT_TEST_PROVIDERS=enabled`
(passed by `deploy/compose.yml:41`) goes back to the card simulator after this lands, silently, until
someone switches practice providers on in Payments → Settings. The pull request's first line says:
"A Prepare box that set `WAITRON_PAYMENT_TEST_PROVIDERS` in `deploy/.env` uses the card simulator
again until practice providers are switched on under Payments → Settings." 

## Global Constraints

- Defaults: `tipsEnabled: false` (today's unset `WAITRON_TILL_TIPS`, `till-config.ts:20-21`),
  `testProviders: false` (today's unset variable, `config.ts:400-402`).
- The practice switch is acted on only when the box's onboarding intent is `prepare`
  (`boot.ts:525-526`'s rule, unchanged); saving `testProviders: true` on any other box is refused.
- Forms follow `docs/developers/design-system.md` → Forms: save stays quiet and disabled until the
  draft changes (`draftScopeFor`, `saveActionState`), one localized bottom message, a refusal explains
  what happened and what each choice does (CLAUDE.md §3).
- A value the till takes from its start read refreshes through `setupRevision` (CLAUDE.md §3): tips
  are part of the till's setup answer (`till-setup.ts:117`), whose revision is a hash of the whole
  answer (`till-setup.ts:142-145`), so reading tips per request is enough.
- English and Spanish strings for every new label and code.

## Review Focus

1. Two managers save the Settings tab at once: the second gets `settings.out_of_date`, keeps their
   draft, and the first one's choice stays (1b-ii's shared wording).
2. A save of the tips switch alone must not turn off a Prepare box's practice providers (the PUT
   replaces both switches with what the screen sent, from the same read).
3. A till already showing a bill when tips are switched on must not accept a tip until its setup
   refreshes; the server clamps by the document it reads at payment time, so a stale till's tip is
   refused or clamped exactly as today when tips are off.
4. Switching practice providers on while a sale is at the card step: the demo reader is deactivated
   in the same way a restart does today (`boot.ts:541-545`), and the next sale routes to the real
   provider.
5. A configuration export from a Prepare venue with practice providers on, imported into a Live
   venue: the switch arrives but is ignored there, because only a Prepare box acts on it.

---

## What it builds

1. `PAYMENTS_SETTINGS` (module `payments`, version 1, transfers `true`) with
   `{ tipsEnabled, testProviders }`. (No `providers` field: Stripe's return addresses stay sealed
   where they are, owner, 2026-11-09, so nothing would fill it; see env4.)
2. Tips read from the document at the three deciding sites and in the till's setup answer.
3. A card-simulator seat: the simulator is chosen at start from the document and again after a save
   that changes `testProviders`.
4. `GET` and `PUT /management-api/payments/settings`.
5. A Settings tab on the Payments screen with the two switches (the second shown on Prepare boxes
   only).
6. `TillAppSettings`, `loadTillAppSettings`, `ServerConfig.tillApp` and
   `ServerConfig.paymentTestProviders` deleted; compose stops passing `WAITRON_PAYMENT_TEST_PROVIDERS`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Stripe's return addresses | stay sealed where they are today (owner, 2026-11-09: "Leave this for when we test Stripe"; env4) |
| The duplicate display language in route deps (`deps.venueLocale` beside `cfg.locale`), which 4b assigned to "when `TillAppSettings` goes" | not here: folding it edits about 137 test files (`git grep -l venueLocale -- 'apps/server/src/*.test.ts'`), past the cap. Open question for the watcher: its own pull request, or the venue-and-box area's next one |
| Recording who changed the switches in `activity_log` | not in A1308 (README §5 U11) |
| Google sign-in moving to `settings.identity` | A646 slices 5 and 8 (`docs/superpowers/plans/2026-11-07-a646-modules-page.md:15,57,75`) |

## Interfaces

```ts
// packages/payments/src/settings.ts (exported from "@waitron/payments")
export interface PaymentsDocument {
  tipsEnabled: boolean;
  testProviders: boolean;
}
/** module "payments", version 1, transfers true. `parse` fills a missing field with its default and
 * answers { ok: false, field } for a field of the wrong type or an unknown top-level key. */
export const PAYMENTS_SETTINGS: SettingsDocument<PaymentsDocument>;
export function readPaymentsSettings(db: Database | Transaction): Promise<SettingsRead<PaymentsDocument>>;

// apps/server/src/card-simulator.ts (new)
export interface CardSimulatorSeat {
  /** The simulator when this box uses it now, else undefined. */
  current(): PaymentProvider | undefined;
  /** Reads `testProviders` and runs `buildCardProvider` again. */
  reapply(): Promise<void>;
}
export function createCardSimulatorSeat(input: {
  db: Database; onboardingIntent: OnboardingIntent | undefined; paymentsEnabled: boolean;
}): Promise<CardSimulatorSeat>; // runs reapply() once before resolving

// HTTP, apps/server/src/payments-api.ts, permission PAYMENTS_MANAGE through `gated` (:350-379)
// GET  /management-api/payments/settings
//   → { tipsEnabled: boolean; testProviders: boolean; testProvidersAvailable: boolean; revision: number }
//     testProvidersAvailable = this box's onboarding intent is "prepare"
// PUT  /management-api/payments/settings  body { tipsEnabled, testProviders, revision }
//   → the GET answer after the save; 409 settings.out_of_date; 409 payments.test_providers_prepare_only
//     when testProviders is true and testProvidersAvailable is false

// apps/server/src/errors.ts
"payments.test_providers_prepare_only": Record<string, never>;
```

`buildCardProvider(db, onboardingIntent, paymentTestProviders, paymentsEnabled)`
(`boot.ts:518-552`) keeps its signature; only its callers change.

## Files

- Create: `packages/payments/src/settings.ts`, `settings.test.ts`; `apps/server/src/card-simulator.ts`,
  `card-simulator.test.ts`; `apps/server/src/payments-api.settings.test.ts`;
  `apps/dashboard/src/screens/payments-settings-panel.ts`, `.test.ts`, `.unsaved.test.ts`,
  `.a11y.test.ts`.
- Modify: `packages/payments/src/index.ts`; `packages/composition/src/modules.ts:258-277` (payments
  descriptor gains `settings: [PAYMENTS_SETTINGS]`); `apps/server/src/config.ts:33-34,91,400-410,539,561`;
  `apps/server/src/till-config.ts` (deleted) and its test (deleted);
  `apps/server/src/trading-context.ts:3,16-17`; `apps/server/src/boot.ts:2084-2090,2258-2263` and the
  five card-provider hand-overs (`:2315`, `:2586`, `:3722`, `:3746`, `:3774`);
  `apps/server/src/bill-payments.ts:983,1125`; `apps/server/src/till-sale.ts:1471-1475` and its
  caller; `apps/server/src/till-setup.ts:90,117`; `apps/server/src/payments-api.ts`;
  `apps/server/src/errors.ts`; `apps/dashboard/src/screens/payments-screen.ts:2589-2659` (third
  tab); `apps/dashboard/src/api/client.ts`; `apps/dashboard/src/api/live-queries.ts`;
  `apps/dashboard/src/i18n/strings.ts`, `codes.ts`; `deploy/compose.yml:39-41`.
- Tests whose set-up changes: the fixtures that spread `tipsEnabled: false` into a trading context
  (`apps/server/src/testing/{adjustment-venue,bill-venue,clock-venue,party-venue,signed-in-till,split-extras-venue,venue-fixtures}.ts`,
  `apps/server/scripts/dev-setup.ts:287`), `testing/bill-venue.ts:275-289` (seeds the document
  instead), and every file `git grep -l -E "WAITRON_TILL_TIPS|WAITRON_PAYMENT_TEST_PROVIDERS|paymentTestProviders|loadTillAppSettings" -- apps packages scripts`
  prints.
- Docs: `apps/server/README.md` (two rows), `apps/till/README.md`, `docs/backlog.md:2598` (the
  Tips row says "off unless switched on under Payments → Settings"), `docs/backlog/payments.md:319`,
  `deploy/README.md` if the grep finds it.

## Size

Counted, hand-written: about 330 lines of code (document 50, seat 35, server reads 30, routes 60,
dashboard panel and tab 130, client and strings 25) and about 420 lines of tests (document 50, seat
50, routes 110, panel, unsaved and a11y 170, re-pointed fixtures 40). Not counted: deleted
`till-config.ts` and its test. About 3 hours.

## Finish line

1. `git grep -n -E "WAITRON_TILL_TIPS|WAITRON_PAYMENT_TEST_PROVIDERS|TillAppSettings|loadTillAppSettings|paymentTestProviders" -- . ':!docs/superpowers'`
   prints nothing.
2. `pnpm --filter @waitron/payments exec vitest run src/settings.test.ts`;
   `pnpm --filter @waitron/server exec vitest run src/card-simulator.test.ts src/payments-api.settings.test.ts src/boot-card-provider.test.ts src/bill-payments.test.ts src/till-sale.test.ts src/till-api.setup-revision.test.ts src/configuration-transfer.test.ts`;
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-settings-panel src/screens/payments-screen.tabs.test.ts`
   each print a `Tests` count with no failure (use the file names the base has where a suite was
   split).
3. `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts scripts/errors-reachable.test.ts scripts/deploy-image-env.test.ts`
   passes.
4. On a dev stack (`wa-wt onboarding <worktree>`, set up as Prepare): the Settings tab shows both
   switches; switch tips on and a till's pay dialog offers a tip after its setup refreshes; switch
   practice providers on and the Demo card reader leaves the readers list. Look at it in both themes
   and at phone width (CLAUDE.md §4). Read, not run, in this plan.

## Expected protection-list difference

EQUAL. A `payments` row in `settings` is data, not schema. Any line is a stop.

## Stop points (beyond rules §5)

1. **Measure 5** (environment.md §5): Task 2 step 5 times taking a card payment before and after. If
   the after median is slower by more than the base's own spread across its 20 runs, that is the failing result; the design's fallback is to hold the document in memory and
   replace it when a save bumps its revision. Ask the watcher before taking it (rules §5.4). The
   slice-0 bench has no card case (its `payment.partial` and `payment.final` cases pay cash), so time
   the card payment without it: run
   `src/bill-payments.test.ts`'s card-payment confirm case 20 times at the base and 20 times on this
   branch on the same machine (`--repeat`-style loop in a throwaway script, not committed), and
   compare medians and spreads the same way; say in the pull request which way it was timed.
2. A consumer of the card simulator copies `deps.cardProvider` into a variable when routes are
   mounted rather than when a request runs (Task 3 step 1 lists them): the getter would not reach it.
   Stop and ask rather than restructuring that consumer.

---

### Task 1: the document

**Files:** `packages/payments/src/settings.ts`, `settings.test.ts`, `index.ts`,
`packages/composition/src/modules.ts`.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Failing cases**, describe `"PAYMENTS_SETTINGS"`, on `useVenueDb`:
  - `"reads the defaults when never saved"`: `readPaymentsSettings(db)` →
    `{ doc: { tipsEnabled: false, testProviders: false }, revision: 0 }`.
  - `"saves and reads back"`: `saveSettings(tx, PAYMENTS_SETTINGS, { doc: { tipsEnabled: true, testProviders: false }, expectedRevision: 0, personId: null })`
    then read → revision 1, `tipsEnabled: true`.
  - `"names the bad field"`: `PAYMENTS_SETTINGS.parse({ tipsEnabled: "yes" })` →
    `{ ok: false, field: "tipsEnabled" }`; `parse({ other: true })` → `field: "other"`.
  - `"fills a missing field"`: `parse({ tipsEnabled: true })` →
    `{ ok: true, doc: { tipsEnabled: true, testProviders: false } }`.
  - `"travels in a configuration export"`: `PAYMENTS_SETTINGS.transfers === true`.
- [ ] **Step 2: Run; they fail. Step 3: Implement**; add `settings: [PAYMENTS_SETTINGS]` to the
  payments descriptor. **Step 4: Run** them and `scripts/live-subscriptions.test.ts`; pass.
- [ ] **Step 5: Commit:** `git commit -s -m "The payments settings document (A1308 env3)"`

### Task 2: tips come from the document

**Files:** `till-config.ts` (delete), `trading-context.ts`, `config.ts`, `boot.ts:2084-2090`,
`bill-payments.ts`, `till-sale.ts`, `till-setup.ts`, the fixtures in **Files**.

- [ ] **Step 1: Re-point the tests first.** `testing/bill-venue.ts:275-289`'s helper that today
  spreads `tipsEnabled` into `cfg` instead saves `PAYMENTS_SETTINGS` with that value (revision 0 → 1)
  before the case runs; its callers' assertions do not change (rules §4). The other fixtures drop the
  `tipsEnabled: false` line. Any test that set `WAITRON_TILL_TIPS: "true"` or `"1"` saves the document
  instead.
- [ ] **Step 2: Run** `src/bill-payments.test.ts src/till-sale.test.ts src/till-api.setup-revision.test.ts`;
  they fail to compile or fail on tips (`cfg.tipsEnabled` still read).
- [ ] **Step 3: Implement.** Delete `till-config.ts` and its test; `TradingContext` no longer
  extends `TillAppSettings`; `ServerConfig.tillApp` goes; `boot.ts:2086`'s spread goes. Each
  deciding site reads `(await readPaymentsSettings(tx)).doc.tipsEnabled` in its own transaction:
  `previewAllocation` at `bill-payments.ts:983`, `confirmAllocation` at `:1125`, and the caller of
  `tipOf` (`till-sale.ts:1471-1475`, which becomes `tipOf(tipsEnabled: boolean, req)`). The till's
  setup read (`till-setup.ts:117`) reads it in the transaction that builds the setup.
- [ ] **Step 4: Run** step 2's files and `src/till-api.setup-revision.test.ts`; pass. Add one case
  to the setup-revision suite: `"moves when tips are switched on"` — the revision before and after
  saving `tipsEnabled: true` differ.
- [ ] **Step 5: Measure 5** (stop point 1): the card payment, timed as stop point 1 says, on the bench box (never the live dev slot),
  base commit and this commit, same machine; paste both medians and spreads into the pull request.
- [ ] **Step 6: Commit:** `git commit -s -m "Tips are read from the payments document (A1308 env3)"`

### Task 3: the card simulator follows the practice switch

**Files:** `card-simulator.ts`, `card-simulator.test.ts`, `boot.ts`, `config.ts`, `compose.yml`,
`boot-card-provider.test.ts` and the files the grep in **Files** lists for the practice name.

- [ ] **Step 1: List the consumers.** `git grep -n "deps\.cardProvider\|deps\.simulator\|\.simulator\b" -- apps/server/src ':!*.test.ts'`;
  confirm each reads the dependency inside a request or a pass, not at mount (stop point 2). At
  `a086eedfb7`: `till-api.ts:412-424,1342,1871,1895`, `till-setup.ts:90`, and the refund and sweep
  helpers handed `simulator` at `boot.ts:2586,3722,3746,3774`.
- [ ] **Step 2: Failing cases** in `card-simulator.test.ts` (on `useVenueDb`):
  - `"a Prepare box uses the simulator until practice providers are switched on"`: seat for
    `prepare` → `current()?.provider === "simulator"`; save `testProviders: true`; `reapply()`;
    `current()` is undefined and the demo reader row is inactive with `disabled_at` set.
  - `"switching back brings the demo reader back under its id"`: then save `false`, `reapply()` →
    simulator again, the same reader row active.
  - `"a Demo box always uses the simulator"`: `demo` with `testProviders: true` saved → simulator.
  - `"a Live box never does"`: `live` → undefined whatever the document says.
  - `"no payments module, no simulator"`: `paymentsEnabled: false` → undefined.
- [ ] **Step 3: Run; they fail. Step 4: Implement** the seat; in `boot.ts` replace `:2258-2263`
  with `const cardSimulator = await createCardSimulatorSeat({ db, onboardingIntent: config.onboardingIntent, paymentsEnabled: … })`
  and give each of the five hand-overs a getter, `get cardProvider() { return cardSimulator.current(); }`
  (or `get simulator()`), so consumers keep their field names and tests need no change. Delete
  `paymentTestProviders` from `config.ts` and the compose line with its comment
  (`deploy/compose.yml:39-41`). `boot-card-provider.test.ts` keeps calling `buildCardProvider`
  directly; its cases are unchanged.
- [ ] **Step 5: Run** step 2's cases, `src/boot-card-provider.test.ts`, the till payment suites the
  grep in **Files** lists and `scripts/deploy-image-env.test.ts`; pass.
- [ ] **Step 6: Commit:** `git commit -s -m "The card simulator follows the practice-provider switch (A1308 env3)"`

### Task 4: the routes

**Files:** `payments-api.ts`, `payments-api.settings.test.ts`, `errors.ts`.

- [ ] **Step 1: Failing cases**, describe `"payments settings routes"`, with the suite's real session
  helper:
  - `"answers the defaults"`: GET → `{ tipsEnabled: false, testProviders: false, testProvidersAvailable: false, revision: 0 }` on a Live box.
  - `"saves tips"`: PUT `{ tipsEnabled: true, testProviders: false, revision: 0 }` → revision 1.
  - `"refuses an out-of-date save"`: two PUTs from revision 0 → the second is 409
    `settings.out_of_date` with `{ module: "payments", revision: 1 }`; the stored doc is the first.
  - `"refuses practice providers off a Prepare box"`: Live box, PUT `testProviders: true` → 409
    `payments.test_providers_prepare_only`; the row is unchanged. Control: a Prepare box saves it and
    `testProvidersAvailable` is `true`.
  - `"reapplies the simulator after the practice switch changes"`: a spy seat's `reapply` is called
    once after a commit that changed `testProviders`, and not after one that changed only tips.
  - `"needs payments.manage"`: a staff session → the suite's existing permission refusal.
- [ ] **Step 2: Run; fail. Step 3: Implement**; the route deps gain `cardSimulator` and
  `onboardingIntent`. Add the error code to `errors.ts` with its `409` status.
- [ ] **Step 4: Run**; pass, with `scripts/errors-reachable.test.ts`. **Step 5: Commit.**

### Task 5: the Settings tab

**Files:** `payments-settings-panel.ts` and its three tests, `payments-screen.ts`, `client.ts`,
`live-queries.ts`, `strings.ts`, `codes.ts`.

- [ ] **Step 1: Failing cases.**
  - `payments-settings-panel.test.ts`: `"shows tips, and practice providers only on a Prepare box"`
    (two `wt-switch` with names `tipsEnabled` and `testProviders`; the second absent when
    `testProvidersAvailable` is false); `"keeps Save quiet until something changes"` (Save disabled,
    then enabled after toggling tips, then disabled after toggling back); `"saves with the revision it
    read"` (the PUT body carries `revision: 3` from the GET); `"keeps the draft on a clash"` (409
    `settings.out_of_date` → the bottom message is the shared wording and the switch keeps the
    person's choice); `"explains the Prepare-only refusal"` (409 `payments.test_providers_prepare_only`
    → the localized message).
  - `payments-settings-panel.unsaved.test.ts`: leaving the tab or the page with a changed switch asks
    through `draftScopeFor`, as the sibling `payment-readers.unsaved.test.ts` does.
  - `.a11y.test.ts`: axe in both themes, with and without the practice switch.
  - `payments-screen.tabs.test.ts`: a third tab `settings` labelled by `payments.settings_heading`.
- [ ] **Step 2: Run; fail. Step 3: Implement.** Strings (EN / ES):
  `payments.settings_heading` "Settings" / "Ajustes"; `payments.tips_label` "Offer tips at the till" /
  "Ofrecer propina en la caja"; `payments.tips_hint` "Staff can add a tip when a guest pays by card." /
  "El personal puede añadir una propina cuando el cliente paga con tarjeta.";
  `payments.test_providers_label` "Use card providers' test accounts" / "Usar las cuentas de prueba de
  los proveedores de tarjetas"; `payments.test_providers_hint` "On this practice server, take card
  payments through your provider's test account instead of the card simulator." / "En este servidor de
  práctica, cobra con la cuenta de prueba de tu proveedor en lugar del simulador de tarjetas.";
  code `payments.test_providers_prepare_only` "Test accounts can only be used on a practice (Prepare)
  server. This server takes real payments, so the setting was not changed." / "Las cuentas de prueba
  solo se pueden usar en un servidor de práctica (Preparar). Este servidor cobra pagos reales, así
  que el ajuste no se ha cambiado." The panel's query depends on `settings.payments` in
  `live-queries.ts`, so a save elsewhere refreshes it.
- [ ] **Step 4: Run** finish line 2's dashboard command; pass. **Step 5:** finish line 4 on a dev
  stack; screenshot both themes and phone width for the pull request (not committed, CLAUDE.md §6).
- [ ] **Step 6: Docs** per **Files**. **Step 7: Protection list**: nothing. **Step 8: Commit**, then
  `/finish-branch`.

## Waitron Cloud

Nothing to change: Cloud's repository sets neither name (grep at `d4451d227`).
