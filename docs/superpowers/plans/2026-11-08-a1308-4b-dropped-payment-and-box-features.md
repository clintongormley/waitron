# A1308 slice 4b: delete three dropped features — offline card acceptance, the old recovery bundle, the till display-language override

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Remove three things the owner dropped on 2026-11-04 — taking a card while the card network
is down (the `payment_policy` table and everything only it fed), the old recovery bundle with
`WAITRON_RECOVERY_PASSPHRASE`, and the `WAITRON_TILL_LOCALE` override — without changing what a real
box does with money.

**Architecture:** Mostly deletion. One migration set changes (`payments`): its `payment_policy`
table goes and its `payments.state` CHECK loses the three states only the offline path wrote, so the
starting migration is rebuilt with slice 1a's command and every venue is reset. The other two
removals change no table. Where something survives because a later slice owns it (tips), the plan
keeps the smallest piece and says so.

**Tech Stack:** TypeScript, Hono, drizzle-kit 0.31 on `node:sqlite`, Lit (till, dashboard), Vitest 4.

**Spec:** [`docs/superpowers/specs/2026-11-02-rationalisation/README.md`](../specs/2026-11-02-rationalisation/README.md)
(U6 row `payment_policy`; §7 "the old recovery bundle goes"; §10 "The till's default language"),
with [`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md) §2 and "What goes
with `payment_policy`", [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1
"What the display-language deletion reaches" and "What removing the recovery bundle reaches", §5
measure 8, and [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 and row 34.
Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md) — this plan cites
them and does not repeat them.

**Who lands it:** the lane (rules §6 names sales, invoice numbering, the fiscal record, fiscal
identity, AEAT sending and hash inputs; this touches none). Recommendation and its evidence:
"Owner landing" below.

**Review weight:** the FULL ceremony — per-task reviews and the full `/finish-branch` wave. The
branch changes a migration set (a risk trigger in the global review rule), and Task 1 changes what
the `payments` table accepts.

**Pull request first line:** "Every venue is reset: payments; backups and exports from before this
cannot be restored or imported." (rules §2).

## Global Constraints

- Slice rules §1–§9 apply in full. Base: `main` with slice 1a landed (its
  `pnpm --filter @waitron/server migration-baseline rebuild --set <name>` command exists).
- Owner decisions copied from the design: "drop taking cards while the card network is down"
  (2026-11-04); "the old recovery bundle goes with `WAITRON_RECOVERY_PASSPHRASE`: the recovery pack
  replaced it"; "The till's default language: the venue's own language, with no Spanish default in
  general code".
- R5: delete only what is dead, replaced, or dropped. The on-device Stripe adapter
  (`StripeOnDeviceProvider`, Tap to Pay) and the till's `stripe_on_device` provider value stay: the
  owner dropped offline acceptance, not Tap to Pay, and `docs/backlog/payments.md` "Bundle: Tap to
  pay restore" plans its return.
- Never edit `drizzle/*.sql`, `drizzle/meta/*` or `scripts/migration-baseline-epoch.json` by hand.
- Never edit the hash-pinned captures `packages/country-es/test-fixtures/demo/madrid-before-move.*`
  or the historical export `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`;
  they record the past and keep naming `payment_policy`.
- Tests are re-pointed, not rewritten (rules §4). Every assertion this plan changes is listed
  under "Assertions that change, by design" or in its task with the reason; any other changed
  assertion is a stop.
- **Line numbers in this plan are hints from `main` d908a5b8d4.** Every deletion and edit is
  identified by the quoted text, test title or symbol beside the number; where the two disagree,
  the text wins, and if the text is not found that is rules §5.1.

## Review Focus

1. **A real box's card outcome.** No production path may be found that wrote `accepted_offline`,
   `settled` or `declined` payment rows, called `forward()`, or mounted `StripeOnDeviceProvider`.
   Task 1 step 1 re-runs the greps; a hit is a stop, not a fix.
2. **A pay request that still carries `allowOffline`.** **Owner, 2026-11-09:** "let's remove the
   flag" — it is deleted everywhere, with no special handling: the server treats it like any other
   field it does not know. What that is, read on `origin/main` at `5ed6b4dc06`: both pay routes read
   only the fields they name and refuse none they do not. The bill payment parser
   (`parseRequest` and `parseAsk`, `apps/server/src/bill-payments-api.ts:75-100`, `:114-153`)
   refuses only a named field with a bad value, and a reader-only field (`readerOnly`, `:123`,
   `:150-151`) on a payment that is not a reader one; the till's pay route reads the body with
   `readJsonBody` and checks named fields (`apps/server/src/till-api.ts:1875-1900`). So once
   `allowOffline` leaves `readerOnly` and its refusal (`:139-141`) goes, a request that still sends
   it is paid as if the field were absent. No test is kept or added for the old flag: no existing
   case on these routes asserts the general unknown-field behaviour (`git grep -n -i "unknown field"`
   over the bill-payment and till-sale suites finds none), so there is nothing of that kind to keep.
3. **The receipt language.** Removing the override must not move a receipt's language: the
   receipt-language suite keeps every receipt assertion (Task 5).
4. **A Spanish venue in an area with its own language (Barcelona).** The display language stays
   `es-ES`, because `ca-ES` is not a supported display language (`packages/shared/src/locales.ts:7-10`).
   Task 5 pins it.
5. **An old configuration export.** It is refused as outdated, not as a malformed request
   (Task 3's format bump and its refusal row).

---

## What it builds

- **Offline card acceptance is gone.** `payment_policy` (table, schema, reader `getPaymentPolicy`,
  gate `resolveOfflineDecision`, seed helper, configuration transfer, classification row); the
  `accepted_offline`, `settled` and `declined` payment states, which only the offline path wrote
  (`packages/payments/src/store.ts:116, 553, 559`); `forward()` on every payment provider and its
  store helpers (`insertAcceptedOffline`, `listAcceptedOffline`, `claimAcceptedOffline`,
  `settleForwarded`, `declineForwarded`); the `payment.offline_forward_declined` alert code and its
  wording; `allowOffline` on the till, the server's pay routes and `CollectParams`; the till's
  "Accept offline if the network is down" switch and its two strings.
- **The payments module transfers nothing in a configuration export** (`configurationTransfer:
  { kind: "none" }`), and the export format goes up by one so an older export is refused as
  outdated.
- **The old recovery bundle is gone**: `POST /api/box/recovery-bundle`, the `waitron-recovery`
  command and its image copies, `WAITRON_RECOVERY_PASSPHRASE`, and the codes
  `recovery.passphrase_required` and `recovery.passphrase_too_short`. The key-length constant moves
  to `backup-config.ts`; the secret-files type moves to `state-secrets.ts`.
- **`WAITRON_TILL_LOCALE` is gone.** `TradingContext.locale` becomes the venue's display language
  (`readVenueLocale`), so its ten readers follow the venue's geography; `invoiceLocales` and
  `localeOverride` leave the trading context.

## What it leaves out

| Left out | Why | Who takes it |
| --- | --- | --- |
| `tipsEnabled` moving to `settings.payments`; `TillAppSettings` and `loadTillAppSettings` deleted | Deleting the type now would force the tips move now. The type shrinks to `{ tipsEnabled }`, still read from `WAITRON_TILL_TIPS` | Batch 3, environment variables and secrets |
| The duplicate display language in route deps (`deps.venueLocale` beside `cfg.locale`, both `readVenueLocale`'s answer) | Folding them touches every route's deps; nothing disagrees | Batch 3, environment variables, when `TillAppSettings` goes |
| `StripeOnDeviceProvider`, the till's `stripe_on_device` value | Tap to Pay is not dropped (R5) | Backlog "Tap to pay restore" |
| Renaming `ForwardResult` (now returned only by `resolvePending`) | Cosmetic; every provider and many tests name it | Payments and adjustments area slice |
| Renaming `recovery.bundle_invalid` and `unpackBundleToDir` | Both still serve restore (`state-secrets.ts:113, 126`); renaming the code changes restore tests' assertions | Batch 3, the file layout slice (it rewrites `state-secrets.ts`) |
| `WAITRON_ACCOUNT_KEY` | Another environment deletion | Batch 3, environment variables |
| `payments`' other changes (resolutions and holds fold into it, the delete refusal) | Their own slice | Payments and adjustments |

## Traced: what the offline path reached (design said "not traced to their ends")

Read at `main` d908a5b8d4 (this worktree's base) with `git grep`; nothing was run against a box.

| Thing | Production readers and writers | Decision |
| --- | --- | --- |
| `payment_policy` row | Writer: none in product code. Configuration import copies it (`packages/payments/src/configuration-transfer.ts:3`, `packages/provisioning/src/configuration-transfer.ts:546-571`). Readers: `getPaymentPolicy` in `packages/payments-stripe/src/device-provider.ts:67` and `packages/payments/src/testing/fake-provider.ts:404` | Delete |
| `allowOffline` | Till: `apps/till/src/widgets/tender-pay.ts:75, 329, 372, 433, 439, 644-646, 685-690, 1099-1101, 1160-1169`, `apps/till/src/till-app.ts:6883`, `apps/till/src/api/client.ts:1137, 2937, 2956`. Server: `apps/server/src/till-sale.ts:600-602, 1423`; `apps/server/src/bill-payments-api.ts:123, 138-141` (refuses anything but `false`). Package: `packages/payments/src/provider.ts:58-60` | Delete everywhere; the bill-payment refusal goes with it |
| The till's switch | Shown only when `cardProvider === "stripe_on_device"` (`tender-pay.ts:1160`); the server never sends that value: `till-setup.ts:101-103` sends `simulator`, `none` or `tillProviderForReader` (`packages/shared/src/till-card-provider.ts:4-10`: `sumup_cloud`, `stripe_terminal`) | Delete the switch and `card.offline_consent` (`apps/till/src/i18n/strings.ts:836, 2767`); keep the `stripe_on_device` union member |
| `accepted_offline` writes | `insertAcceptedOffline` (`store.ts:112-117`), called by `device-provider.ts:133` and `fake-provider.ts:416`. `StripeOnDeviceProvider` is constructed nowhere outside its package (grep `new StripeOnDeviceProvider`), and its real client's `collectOnDevice` throws (`stripe-device-client.ts:21-22`) | Delete the state |
| `settled`, `declined` payment states | Written only by `advanceAcceptedOffline` (`store.ts:552-572`), reached only through `forward()` | Delete both states |
| `forward()` | Declared `provider.ts:257-260`; implemented in `simulator.ts:177`, `payments-sumup/src/provider.ts:280`, `payments-stripe/src/provider.ts:253` (all answer zeros), `device-provider.ts:150`, `fake-provider.ts:295`. Called by no production code (grep `\.forward\(` outside tests finds only browser `history.forward()`) | Delete from the interface and every implementation |
| Readers of the three states | `apps/server/src/bill-payments-loop.ts:76`, `find-bill-transactions.ts:40`, `till-sale.ts:1431, 1527, 1621, 1792, 1968, 2063, 2109`, `tender-refund-capture.ts:18`, `bill-payments.ts:1417-1420`, `attendance-integrated.ts:140`, `apps/dashboard/src/screens/payments-screen.ts:1491-1499`, `packages/payments/src/handover-summary.ts:5, 37`, `store.ts:342, 378, 760` | Drop the three values from each list |
| `payment.offline_forward_declined` | Raised only in `device-provider.ts:191` and `fake-provider.ts:309`; worded at `apps/dashboard/src/i18n/alert-messages.ts:332-335`; declared `packages/payments/src/errors.ts:38`; used as a sample code in nine test files | Delete; tests re-pointed to `payment.refund_unresolved` |
| `PAYMENTS_CONFIGURATION_TRANSFER` | `packages/composition/src/modules.ts:74, 274` | Delete; payments declares `{ kind: "none" }` |

## Owner landing

Nothing here changes a money outcome on a real box, on this evidence (all `git grep`, read, not
run): no product code writes a `payment_policy` row; the only adapter that reads it,
`StripeOnDeviceProvider`, is mounted by no server path and its real collect throws; nothing in
production calls `forward()`; so no real box can have written an `accepted_offline`, `settled` or
`declined` payment. The narrowed `payments_state_ck` therefore refuses only states no product code
writes. Recommendation: **the lane lands it.** If Task 1 step 1's greps find any production writer
or caller the table above does not list, stop (rules §5.1): the recommendation would change.

## Files

**Delete**

- `packages/payments/src/policy.ts`, `policy.test.ts`, `schema/payment-policy.ts`,
  `offline.wiring.test.ts`, `configuration-transfer.ts`
- `apps/server/src/recovery-bundle.ts`, `recovery-bundle.test.ts`, `recovery-bundle-api.ts`,
  `recovery-bundle-api.test.ts`, `recovery-unpack-command.ts`, `recovery-unpack-command.test.ts`,
  `bin-recovery.ts`

**Create**

- `scripts/a1308/4b-offline-alert-sample.mjs` (the sample-code rename, Task 2)

**Modify — payments (Tasks 1–3)**

- `packages/payments/src/provider.ts`, `schema/payments.ts`, `schema/index.ts`, `store.ts`,
  `index.ts`, `classification.ts`, `errors.ts`, `handover-summary.ts`, `simulator.ts`,
  `testing/fake-provider.ts`, `test/seed.ts`
- `packages/payments-stripe/src/device-provider.ts`, `device-client.ts`, `stripe-device-client.ts`,
  `provider.ts`, `testing/fake-stripe-device.ts`
- `packages/payments-sumup/src/provider.ts`
- `packages/composition/src/modules.ts`
- `packages/provisioning/src/configuration-transfer.ts` (format version, lines 123, 160, 474-476)
- `apps/server/src/bill-payments-loop.ts`, `find-bill-transactions.ts`, `till-sale.ts`,
  `tender-refund-capture.ts`, `bill-payments.ts`, `attendance-integrated.ts`, `bill-payments-api.ts`,
  `README.md` (line 796)
- `apps/dashboard/src/screens/payments-screen.ts`, `apps/dashboard/src/i18n/alert-messages.ts`
- `apps/till/src/widgets/tender-pay.ts`, `apps/till/src/api/client.ts`, `apps/till/src/till-app.ts`,
  `apps/till/src/i18n/strings.ts`
- `scripts/schema-constraints.test.ts` (743-745), `scripts/alert-codes.test.ts` (the
  `"packages/payments-stripe/src/device-provider.ts",` entry of `INCIDENT_CODE_SOURCES`, line 40;
  that file records no incident any more)
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (line 39, `REMOVED_TABLES`)
- Generated by the rebuild: `packages/payments/drizzle/0000_baseline.sql`,
  `packages/payments/drizzle/meta/*`, `scripts/migration-baseline-epoch.json`
- Tests with deletions or re-pointing (each named in its task): `packages/payments/src/`
  `migrations.test.ts`, `monetary-columns.test.ts`, `index.test.ts`, `schema-ownership.test.ts`,
  `backup-verification.test.ts`, `store.test.ts`, `collection-owner.test.ts`, `reconcile.test.ts`,
  `provider.test.ts`, `provider-write-queue.test.ts`, `simulator.test.ts`, `handover-summary.test.ts`,
  `testing/fake-provider.test.ts`; `packages/payments-stripe/src/device-provider.test.ts`,
  `device.wiring.test.ts`, `collection-owner.test.ts`, `provider.test.ts`,
  `testing/fake-stripe-device.test.ts`; `packages/payments-sumup/src/provider.test.ts`;
  `packages/provisioning/src/configuration-transfer.reader-slip-setting.test.ts`;
  `apps/server/src/` `attendance-integrated-payments.test.ts`, `attendance-integrated-discovery.test.ts`,
  `bill-payments.card.test.ts`, `configuration-transfer.test.ts`, `configuration-import.test.ts`,
  `device-delete.db.test.ts`, `placed-order-one-payment.test.ts`, `tender-refund-balance.test.ts`,
  `till-money.write-session.test.ts`, `till-sale-integrated.test.ts`, `till-sale-integrated.db.test.ts`,
  `alerts-api.test.ts`, `alerts.test.ts`; `apps/dashboard/src/` `dashboard-app.a11y.test.ts`,
  `dashboard-app.help.test.ts`, `dashboard-app.test.ts`, `i18n/alerts.test.ts`,
  `screens/alerts-screen.test.ts`, `screens/box-status-screen.test.ts`, `widgets/alerts-bell.test.ts`,
  `screens/payments-screen.bill-recovery.test.ts`; `apps/till/src/` `api/client.test.ts`,
  `till-app.test.ts`, `widgets/tender-pay.test.ts`, `widgets/tender-pay.a11y.test.ts`,
  `widgets/tender-pay.unsaved.test.ts`

**Modify — recovery bundle (Task 4)**

- `apps/server/src/backup-config.ts`, `backup-api.ts`, `backup-recovery-pack-parts.ts`, `boot.ts`
  (380, 3230), `boot.test.ts` (104, 676-683, 3700), `state-secrets.ts`, `restore.ts` (76, 843-846),
  `errors.ts` (1363-1378), `node-entry.ts` (722-725 comment), `first-setup-entry.test.ts` (188, title), `backup-api.route.test.ts` (65, 1209
  comments), `apps/server/package.json` (10, 17), `apps/server/test-durations.json` (882, 883, 907)
- `apps/dashboard/src/screens/backup-screen.ts` (52-53 comment)
- `deploy/Dockerfile` (212, 231), `.github/workflows/image-smoke.yml` (273), `deploy/README.md` (556)

**Modify — display language (Task 5)**

- `apps/server/src/till-config.ts`, `trading-context.ts`, `boot.ts` (2084-2098), `venue-locale.ts`
  (44-63), `config.ts` (91, 561 unchanged in shape), `scripts/dev-setup.ts` (90, 101, 158, 283-289,
  464), `packages/country-packs/src/registry.ts` (178-180 comment)
- Tests: `apps/server/src/` `till-config.test.ts`, `node-config.test.ts`, `venue-locale.test.ts`,
  `boot.node-configuration.test.ts`, `first-fiscal-mode.test.ts`, `receipt-language.test.ts`,
  `kitchen-print.language.test.ts`, `boot.box-emails.test.ts`, `boot.setup-routes.test.ts`,
  `boot.test.ts`, `receipt-guests.routes.test.ts`, `trading-context.test.ts`,
  the nine test-support helpers under `apps/server/src/testing/` that Task 5 step 6 names,
  `apps/server/scripts/dev-setup.test.ts`, and every test file whose `TradingContext` literal
  carries `invoiceLocales` (found by typecheck, Task 5 step 6)
- `apps/till/README.md` (116, 135), `docs/developers/conventions-ui.md` (1862)

**Modify — docs and backlog (Task 6)**

- `docs/backlog/architecture.md` (1279), `docs/backlog/payments.md` (544), `docs/backlog/till.md`
  (71-72, 3930), `docs/backlog/box.md` (192, 265-266), `docs/backlog/setup.md` (814),
  `docs/developers/conventions-data.md` (1038-1040),
  `docs/backlog/english-only-audit.md` (dated note at the top),
  `docs/developers/conventions-data.md` (1821-1824) and `docs/developers/design-system.md` (5840)
  for the format number

## Size

Estimated, from the greps above (not measured on a built branch):

| | Counted (hand-written) | Not counted |
| --- | --- | --- |
| Production code | ~150 | — |
| Tests (new and re-pointed) | ~210 (no `allowOffline` case, owner 2026-11-09) | — |
| Docs and backlog | ~50 | — |
| Pure deletions | — | ~3,000 (bundle files ~930; policy and offline files ~400; offline branches in providers and store ~350; their tests ~1,000; ~120 `invoiceLocales` test lines; till and dashboard ~150) |
| Script output | — | ~38 lines (alert sample code) |
| Generated | — | payments' `0000_baseline.sql`, `meta/*`, the epoch file |
| **Total counted** | **~410** | |

That is under the ~1,000 cap, so the three removals stay one pull request, as the build order
lists them. Time: about 3 hours, most of it deletion and test runs.

## Finish line

Each is a command someone can run on the finished branch:

1. `git grep -n -E "getPaymentPolicy|resolveOfflineDecision|seedPaymentPolicy|PAYMENTS_CONFIGURATION_TRANSFER|allowOffline|offlineAllowed|accepted_offline|AcceptedOffline|settleForwarded|declineForwarded|syncOfflineQueue|offline_forward_declined|offline_consent|offline-consent" -- apps packages scripts`
   prints nothing; `git grep -n payment_policy -- apps packages scripts` prints only the two frozen
   fixtures named in Global Constraints and `seed.madrid-baseline.test.ts:39`.
2. `git grep -n -E "recovery-bundle|RecoveryBundle|bin-recovery|recovery-unpack|RECOVERY_PASSPHRASE|recovery\.passphrase_(required|too_short)|MIN_PASSPHRASE_LENGTH|BundleFiles|encryptBundle|decryptBundle|bundle_downloaded" -- . ':!docs/superpowers'`
   prints nothing.
3. `git grep -n -E "WAITRON_TILL_LOCALE|localeOverride" -- . ':!docs/superpowers'` prints only the
   dated note in `docs/backlog/english-only-audit.md`; `git grep -n -P "\b(cfg|config|tradingContext|context)\.invoiceLocales\b" -- apps`
   prints nothing.
4. `pnpm protection-list compare` prints exactly the lines in "Expected protection-list difference".
5. `pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/dashboard typecheck`
   exit 0.
6. The focused runs in each task print a `Tests` count with no failures, and CI is green on the head.
7. A booted GB venue answers `GET /api/till` with `locale: "en-GB"`, a Madrid and a Barcelona venue
   with `es-ES`, with no locale variable set (Task 5's tests).

## Expected protection-list difference

Two compositions (`fiscal-verifactu`, `fiscal-none`), each `venue` database. `node` entries:
**EQUAL**. The recovery-bundle and display-language removals change no table, so they add nothing.

**Before Task 1, a check (Task 0), expected to be a no-op.** The coordinator confirms slice 1a
regenerates all eight sets, so on the real base this check should find nothing. It stays a check
because at d908a5b8d4 the committed payments starting migration does
not match a fresh `drizzle-kit generate` of its schema: two columns sit elsewhere
(`card_readers.prints_own_slip_automatically`, `payment_refunds.provider_refund_ref`; measured
2026-11-08 by generating into a scratch folder and diffing). If slice 1a regenerated only core's set,
the payments rebuild also moves those columns. Task 0 finds out and, if so, lands the move as its own
commit with its own expected report:

```text
(for each of the 2 compositions × 3 phases, venue)
changed table card_readers.columnOrder        (prints_own_slip_automatically moves before unpaired_at)
changed table payment_refunds.columnOrder     (provider_refund_ref moves before created_at)
(change-feed phase only, also)
changed trigger waitron_change_card_readers_update.when
changed trigger waitron_change_payment_refunds_update.when
```

Reason: rules §2, the one-off column-order change, kept apart so the slice's own report is clean.

**The slice's own difference (Tasks 1–3), against the base or against Task 0's commit:**

For each composition, in phases `sql-only` and `migrated`:

```text
missing table payment_policy
changed table payments.checks[payments_state_ck].expression
old: "payments"."state"in('attempting','captured','voided','refunded','partially_refunded','failed','accepted_offline','settled','declined','initiated')
new: "payments"."state"in('attempting','captured','voided','refunded','partially_refunded','failed','initiated')
```

In phase `change-feed`, the same two plus:

```text
missing trigger waitron_change_payment_policy_delete
missing trigger waitron_change_payment_policy_insert
missing trigger waitron_change_payment_policy_update
```

Reasons: `payment_policy` and its three CHECKs are "dropped with the table" (design `tables-fiscal.md`
§5 row `payment_policy`); its change-feed triggers exist only because it was a change source
(`PAYMENTS_CHANGE_SOURCES` is derived from the classification, `packages/payments/src/classification.ts:35-37`).
The narrowed CHECK is this plan's traced decision: the three removed states were written only by the
dropped offline path (table above), so the change tightens a protection and drops none. The `old:`
and `new:` text is `normaliseSql`'s output, computed on 2026-11-08 by running
`apps/server/scripts/protection-list/sql-tokens.ts` on both expressions. Line order within a block
may differ; the set of lines may not.

## Assertions that change, by design

Rules §4's exception. Each line below may change exactly as written; each changes because the
design removes the behaviour or the code it pinned. Deleted cases are listed in their tasks.

**The alert sample code** (design `tables-fiscal.md`, "What goes with `payment_policy`": the
`payment.offline_forward_declined` alert has no writer once `forward()` goes). Task 2's script swaps
the code to `payment.refund_unresolved`; the eight sentence assertions below then change by hand.
The fixtures keep `params: { amount: "12.50", paymentRef: … }` (the extra `paymentRef` is ignored by
the new wording). New wording, `apps/dashboard/src/i18n/alert-messages.ts:360-362` (`MORE_EN` and
`MORE_ES` at 7-9):

- EN: "A card refund of €12.50 has been waiting for over an hour for the card provider to show what
  happened. Its bill cannot be changed or invoiced until then. Check the refund in the provider's
  own dashboard, and record the outcome it confirms. Later checks do not add to this alert while it
  is open, so there may be more."
- ES: "Una devolución con tarjeta de 12,50\u00a0€ lleva más de una hora esperando a que el proveedor
  de pagos muestre qué pasó. Hasta entonces, su cuenta no se puede modificar ni facturar. Comprueba
  la devolución en el panel del proveedor y registra el resultado que confirme. Mientras esta alerta
  esté abierta, las comprobaciones posteriores no la amplían, así que puede haber más."

| File:line (hint) | Old expected text | New expected text |
| --- | --- | --- |
| `apps/dashboard/src/dashboard-app.test.ts:6517` (`toast(el).message` `toContain`) | "A card payment of €12.50 taken while offline" | "A card refund of €12.50 has been waiting" |
| `dashboard-app.test.ts:6542` (`item().textContent` `toContain`) | same | same as above |
| `dashboard-app.test.ts:6554` (Spanish `toContain`) | "Un pago con tarjeta de 12,50\u00a0€ cobrado sin conexión" | "Una devolución con tarjeta de 12,50\u00a0€ lleva más de una hora" |
| `dashboard-app.test.ts:6563` (`item().textContent` `toContain`) | "A card payment of €12.50 taken while offline" | "A card refund of €12.50 has been waiting" |
| `dashboard-app.test.ts:6592` (`english`, `toBe`, one alert) | the whole old English sentence | the whole EN sentence above, with `pi_1` nowhere in it |
| `dashboard-app.test.ts:6596` (`spanish`, one alert) | the whole old Spanish sentence | the whole ES sentence above |
| `apps/dashboard/src/screens/alerts-screen.test.ts:86` | "A card payment of €12.50 taken while offline" | "A card refund of €12.50 has been waiting" |
| `apps/dashboard/src/widgets/alerts-bell.test.ts:167` | "A card payment of €12.50 taken while offline" | "A card refund of €12.50 has been waiting" |
| `apps/dashboard/src/i18n/alerts.test.ts:7-14` ("registers the dashboard's alert wording on import") | the old code and sentence | `payment.refund_unresolved`, `{ amount: "12.50" }`, the EN sentence above |

If the whole-sentence `toBe` at 6592/6596 is rendered through a toast that shortens text, use what
the screen renders for the new code, and say so in the PR; any difference other than the sentence is
Stop point 6.

**The till's offline switch** (owner decision 2026-11-04, design `tables-fiscal.md` same section):

- `apps/till/src/widgets/tender-pay.unsaved.test.ts`, case "tip and offline consent protect page
  leave but cash Cancel preserves them independently" (275): retitled "the tip protects page leave
  but cash Cancel preserves it"; it keeps `form.cardProvider = "stripe_on_device"` (277; the
  value stays, Global Constraints, and the tip field still renders for it,
  `tender-pay.ts:1104`); the switch lookup and click (281-284) deleted; the `wt-switch` `.checked`
  assertion (291) deleted; the collects assertion (306) becomes `[{ tip: "0.30" }]`. The tip,
  leave and Cancel assertions stay.
- Same file, case "reverted extras are exempt, and page Discard restores extras without charging"
  (360): unchanged. It sets `"stripe_on_device"` (361) but touches only the tip, so it must pass as
  it is; a failure there is a stop.
- `tender-pay.a11y.test.ts:267`: title drops "and offline-consent toggle"; the axe assertion stays.
- `apps/till/src/api/client.test.ts:392`, `till-app.test.ts:11052, 11076, 24232-24270`: `allowOffline`
  leaves the emitted detail and the expected request; titles drop "+allowOffline" / "tip/allowOffline"
  → "tip".

**Bill payments** (same decision): `apps/server/src/bill-payments.card.test.ts`, the refusal of
`allowOffline: true` (270-287) is deleted with the flag (Review Focus 2); no case replaces it.

**The display-language override** (design `environment.md` §1, "What the display-language
deletion reaches"): the cases Task 5 steps 4–5 name.

**The payment states** (this plan's trace): `packages/payments/src/migrations.test.ts`, "accepts
accepted_offline, settled and declined as payment states" becomes "accepts exactly the seven payment
states" (Task 1 step 2); `handover-summary.test.ts`'s `OPEN_STATES` and title; the configuration
transfer test's exported tables become `[]` (Task 1 step 6).

## Stop points (beyond rules §5)

1. Task 1 step 1's greps show a production writer of the three states, a production `forward(`
   call, a production `new StripeOnDeviceProvider`, or a product writer of `payment_policy`.
2. Task 0 finds a payments baseline difference other than the two columns named above.
3. Removing `invoiceLocales` or `localeOverride` from `TradingContext` breaks typecheck in a
   file outside the list in Task 5 step 6 (production: `boot.ts`, `scripts/dev-setup.ts`; test
   support under `apps/server/src/testing/`: the nine helpers named there; and `*.test.ts` files).
   A reviewer's scratch run of the type change gave 115 errors, all in that set.
4. Any receipt, sale or invoice language assertion in `receipt-language.test.ts`,
   `receipt-guests*.test.ts` or `kitchen-print.language.test.ts` needs a new expected value.
5. `seed.madrid-baseline.test.ts` fails for anything other than `payment_policy` leaving.
6. A test substituted to `payment.refund_unresolved` fails on anything other than the code string
   (for example a help link or a screen link that differed between the two codes).
7. `~/workspace/tools/wa-wt` or any file under `deploy/`, `scripts/` or `.github/` turns out to set
   `WAITRON_TILL_LOCALE` or `WAITRON_RECOVERY_PASSPHRASE` (none did on 2026-11-08; Waitron Cloud's
   repository names neither).

---

### Task 0: Base protection list and the payments column-order check

**Files:** none changed unless step 3 says so (then the generated payments files and the epoch file).

- [ ] **Step 1: List the base.** In a throwaway worktree of the base (`git worktree add --detach <dir> <base-sha>`, `pnpm install`), from `apps/server`:
  `pnpm protection-list list --out <empty absolute dir A>`. Keep A outside the repository.
- [ ] **Step 2: Rebuild payments with no schema change** on the branch:
  `pnpm --filter @waitron/server migration-baseline rebuild --set payments`, then
  `git diff --stat packages/payments/drizzle/0000_baseline.sql`.
  Expected either: no change to the SQL (slice 1a already regenerated it) → `git checkout` the epoch
  file if only its date moved, and go to Task 1; or the two column moves named above.
- [ ] **Step 3 (only if the columns moved):** list into dir A0 and compare with A; the report must be
  exactly Task 0's block above. Commit:

```bash
git add packages/payments/drizzle scripts/migration-baseline-epoch.json
git commit -s -m "Regenerate the payments starting migration in schema column order (A1308 4b)"
```

  Use A0 as the "old" list for the slice's final compare.

### Task 1: The payments packages lose the offline path

**Files:** the payments, payments-stripe, payments-sumup and composition files listed under
"Modify — payments", the five deleted payments files, `scripts/schema-constraints.test.ts`,
`scripts/alert-codes.test.ts`, the generated payments files.

**Interfaces:**
- Produces: `PaymentState` = `"attempting" | "captured" | "voided" | "refunded" | "partially_refunded" | "failed" | "initiated"`;
  `PaymentResultState` = `PaymentState | "network_unavailable"`; `PaymentResult` without `offline`;
  `CollectParams` without `allowOffline`; `PaymentProvider` without `forward`; `ForwardResult`
  unchanged (still `resolvePending`'s result); `DeviceCollectOutcome` =
  `"captured" | "declined" | "network_unavailable"`; `StripeDeviceClient.collectOnDevice(params)`
  without `offlineAllowed`, and no `syncOfflineQueue`; `CapturedPaymentForOrder.state` = `"captured"`.
- Removed exports: `getPaymentPolicy`, `resolveOfflineDecision`, `PaymentPolicyRow`, `paymentPolicy`,
  `insertAcceptedOffline`, `listAcceptedOffline`, `claimAcceptedOffline`, `settleForwarded`,
  `declineForwarded`, `PAYMENTS_CONFIGURATION_TRANSFER`, `seedPaymentPolicy` (test helper).

- [ ] **Step 1: Re-run the trace.** These must print only test files, the files this task deletes,
  and the lines the "Traced" table lists:

```bash
git grep -n -E "payment_policy|paymentPolicy|getPaymentPolicy|resolveOfflineDecision" -- apps packages ':!*.test.ts' ':!**/drizzle/**' ':!**/test-fixtures/**' ':!**/fixtures/**'
git grep -n -E "insertAcceptedOffline|advanceAcceptedOffline|settleForwarded|declineForwarded" -- apps packages ':!*.test.ts'
git grep -n -E "provider\.forward\(|card\.forward\(|\.forward\(now|new StripeOnDeviceProvider|stripeDeviceClient\(" -- apps packages ':!*.test.ts'
```

  Anything else: stop (Stop point 1).

- [ ] **Step 2: Write the failing tests** in `packages/payments/src/migrations.test.ts`:
  - Replace `"accepts accepted_offline, settled and declined as payment states"` (line 89) with
    `it("accepts exactly the seven payment states", …)`:
    `expect(await acceptedPaymentStates()).toEqual(["attempting","captured","voided","refunded","partially_refunded","failed","initiated"])`.
    Reason: the old test pinned the states being removed.
  - Add `it.each(["accepted_offline","settled","declined"])("refuses a payment moved to the retired state %s", …)`:
    seed with `seedWorkingOrder` (`packages/payments/test/seed.ts:53`), write a row with
    `insertCapturedPayment`, then `update payments set state = ${state} where payment_ref = …` inside
    `captureError`, as the singleton case at 170-178 does; `isRefusal(error, CHECK_VIOLATION)` is
    true, `engineErrorMessage(error)` matches `/payments_state_ck/`, and the row still reads `captured`.
  - Add `it("still accepts a captured payment moving to refunded", …)`: same row,
    `update … set state = 'refunded'` succeeds and reads back `refunded` (the legitimate write,
    rules §4).
  - Rewrite `"creates payment_policy and leaves every money column a count of whole cents"` (119) as
    `"leaves every money column a count of whole cents"`, removing only the `payment_policy` entries
    from its lists; delete `"keeps payment_policy to one row…"` (161-191). Reason: the table goes.

- [ ] **Step 3: Run them to see them fail.**
  `pnpm --filter @waitron/payments exec vitest run src/migrations.test.ts`
  Expected: the seven-states test and the three refusal cases FAIL (the CHECK still accepts them).

- [ ] **Step 4: Delete and narrow the code.**
  - `schema/payments.ts:24-40`: drop the three values from `paymentState`; the doc comment loses the
    `accepted_offline` sentence. `provider.ts`: the type changes in Interfaces; delete `forward` and
    its doc, `allowOffline`, `offline`, and the `accepted_offline` clause of `PaymentResult`'s doc.
  - Delete `policy.ts`, `schema/payment-policy.ts`, `configuration-transfer.ts`; their lines in
    `schema/index.ts:7` and `index.ts:31, 33(declineForwarded), 43, 48, 111-112, 131` and
    `settleForwarded`'s export line.
  - `store.ts`: delete `insertAcceptedOffline` (112-117), `selectForwardable`, `claimAcceptedOffline`,
    `listAcceptedOffline` (462-505), `settleForwarded`, `declineForwarded`, `advanceAcceptedOffline`
    (552-580); narrow `342` to `"captured"`, `378` to `["captured"]` (keep `inArray`'s shape or use
    `eq`), `760` to `eq(payments.state, "captured")`; the `722` comment loses its last sentence.
  - `handover-summary.ts:5`: `OPEN_PAYMENT_STATES = IN_PROGRESS_PAYMENT_STATES`; doc at 37 drops
    `accepted_offline`.
  - `classification.ts:18` deleted. `errors.ts:38` deleted.
  - `simulator.ts:177`, `payments-sumup/src/provider.ts:280`, `payments-stripe/src/provider.ts:249-256`:
    delete `forward`.
  - `testing/fake-provider.ts`: delete `forward` (290-323) and `declineForwardRefs`;
    `collectOffline` keeps `assertReaderStartable` and always returns `network_unavailable` writing
    nothing.
  - `device-provider.ts`: `collect` reads only the idempotency key in its transaction; delete the
    `accepted_offline` branch (131-145) and `forward` (150-203); the comment at 30-31 goes;
    `recordIncidentOnce` and `AppError`/`brandSaleId`/`jobOrigin` imports go if unused.
    `device-client.ts`, `stripe-device-client.ts`, `testing/fake-stripe-device.ts`: per Interfaces;
    the fake's `"offline"` scenario always answers `network_unavailable`.
  - `test/seed.ts:142-155`: delete `seedPaymentPolicy`.
  - `packages/composition/src/modules.ts:74, 274`: `configurationTransfer: { kind: "none" }`.
  - `scripts/schema-constraints.test.ts:743-745` deleted; the `"packages/payments-stripe/src/device-provider.ts",` entry of
    `INCIDENT_CODE_SOURCES` in `scripts/alert-codes.test.ts` deleted (line 40 at d908a5b8d4; line 38
    is `packages/fiscal-verifactu/src/reconcile.ts`, which stays).

- [ ] **Step 5: Rebuild the starting migration.**
  `pnpm --filter @waitron/server migration-baseline rebuild --set payments`. Check
  `git diff packages/payments/drizzle/0000_baseline.sql` shows only the table's removal and the CHECK.

- [ ] **Step 6: Delete or re-point the package tests.** Delete each case that exercises offline
  acceptance, `forward`, the policy or the three states; re-point only these:
  - `backup-verification.test.ts`: drop `payment_policy` from the lists (40, 89-90, 263, 414);
    `"refuses a missing restored payment table"` (433-443) drops and restores
    `payment_hold_outcomes` instead (a table nothing points at).
  - `device-provider.test.ts`, `fake-provider.test.ts`, `provider-write-queue.test.ts`,
    `collection-owner.test.ts` (both packages), `device.wiring.test.ts`: remove
    `seedPaymentPolicy(...)` calls before online-capture cases; delete offline, forward and policy
    cases; the network-down case now asserts `state: "network_unavailable"` and no row, unchanged.
  - `simulator.test.ts:87`, `payments-stripe/src/provider.test.ts:548`,
    `payments-sumup/src/provider.test.ts:375`: delete the all-zero `forward` cases.
  - `handover-summary.test.ts:53, 154`: `OPEN_STATES = ["attempting","initiated"]`; the test title
    drops `accepted_offline`.
  - `monetary-columns.test.ts`, `index.test.ts:285-294`, `schema-ownership.test.ts:13`,
    `store.test.ts`, `reconcile.test.ts:95`, `provider.test.ts:34`: delete the policy and
    `accepted_offline` cases.
  - `packages/provisioning/src/configuration-transfer.reader-slip-setting.test.ts`: retitle
    "keeps hardware readers and their slip settings outside configuration bundles"; drop the policy
    insert, update and round-trip; `expect(Object.keys(exported.tables)).toEqual([])`. The reader
    assertions stay.

- [ ] **Step 7: Run.**
  `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments-stripe test && pnpm --filter @waitron/payments-sumup test && pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.reader-slip-setting.test.ts && pnpm exec vitest run scripts/schema-constraints.test.ts scripts/alert-codes.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/live-subscriptions.test.ts`
  Expected: each prints a `Tests` count, all passing. Server, till and dashboard do not typecheck
  until Task 2; that is expected, because nothing is pushed until Task 6.

- [ ] **Step 8: Commit:**
  `git commit -s -m "Remove offline card acceptance and payment_policy from the payments packages (A1308 4b)"`

### Task 2: The server, till and dashboard stop offering offline acceptance

**Files:** the `apps/server`, `apps/dashboard`, `apps/till` source and test files listed under
"Modify — payments"; `scripts/a1308/4b-offline-alert-sample.mjs`.

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `IntegratedPayRequest` without `allowOffline`; `CollectCardDetail` without
  `allowOffline`; `CardDraft` = `{ tip: string; simulation: "captured" | "declined" }`.

- [ ] **Step 1: Delete the flag's cases** in `apps/server/src/bill-payments.card.test.ts`: the case
  at 270-287 (which expected `allowOffline: true` refused with `params: { field: "allowOffline" }`)
  and the table rows at 462-466 (`allowOffline: "yes"`, offline consent on cash). No case replaces
  them (owner, 2026-11-09; Review Focus 2). This task removes behaviour and adds none, so there is no
  failing test to write first.
- [ ] **Step 2: Run the suite before the change** to record its `Tests` count:
  `pnpm --filter @waitron/server exec vitest run src/bill-payments.card.test.ts` — PASS.
- [ ] **Step 3: Change the code.**
  - `bill-payments-api.ts:123` drops `"allowOffline"`; delete 138-141 and the comment above them.
  - `till-sale.ts`: delete `allowOffline` (600-602) and its pass-through (1423); `1431` and `2109`
    test only `"captured"`; `1527` lists `["captured"]`; the four `v8 ignore` comments (1621, 1792,
    1968, 2063) say `captured` only.
  - `bill-payments-loop.ts:76`: `CHARGED = new Set(["captured"])`. `find-bill-transactions.ts:40`:
    `('captured','refunded','partially_refunded')`. `tender-refund-capture.ts:18`: drop `"settled"`.
    `bill-payments.ts:1417-1420`: drop `"declined"` from `NOT_CHARGED`. `attendance-integrated.ts:140`:
    `candidate.state === "failed"`.
  - `apps/dashboard/src/screens/payments-screen.ts:1491-1499`: drop the three states.
    `alert-messages.ts:332-335`: delete the wording.
  - Till: `tender-pay.ts` deletes `allowOffline` (75, 329, 685-690, 1164 block 1159-1169), the
    `offline` field of `CardDraft` (129, 372, 433, 439), the consent spread (644-646) and the doc at
    1098-1101; `client.ts:1137, 2937 (sentence), 2956`; `till-app.ts:6883`; `strings.ts:836, 2767`.
  - `apps/server/README.md:795-796`: "nor a `captured` one no sale records".
- [ ] **Step 4: Write and run the sample-code script.** `scripts/a1308/4b-offline-alert-sample.mjs`
  replaces the literal `payment.offline_forward_declined` with `payment.refund_unresolved` in
  exactly these files: `apps/server/src/alerts-api.test.ts`, `apps/server/src/alerts.test.ts`,
  `apps/dashboard/src/dashboard-app.a11y.test.ts`, `dashboard-app.help.test.ts`,
  `dashboard-app.test.ts`, `screens/alerts-screen.test.ts`, `screens/box-status-screen.test.ts`,
  `widgets/alerts-bell.test.ts`; it prints each file and count, and a second run changes nothing.
  `payment.refund_unresolved` is claimed by the same `payment.` prefix
  (`packages/payments/src/alerts.ts:4`) and has English and Spanish wording
  (`alert-messages.ts:360`). Then by hand in `apps/dashboard/src/i18n/alerts.test.ts`: the
  "registers the dashboard's alert wording on import" case uses `payment.refund_unresolved` with
  `{ amount: "12.50" }` and its English sentence from `alert-messages.ts:361`; delete the
  `payment.offline_forward_declined` row of the euro-sign table (58-63, the table already has a
  `payment.refund_unresolved` row) and its entry at line 60's list if separate. Then change the
  eight sentence assertions exactly as "Assertions that change, by design" lists them.
- [ ] **Step 5: Delete the offline cases** in `attendance-integrated-payments.test.ts:410-445`,
  `attendance-integrated-discovery.test.ts` (the `accepted_offline` and `declined` it.each rows, 60,
  72, 87, 147), `placed-order-one-payment.test.ts:640-660, 760-780`, `till-sale-integrated.test.ts:500-515`,
  `till-sale-integrated.db.test.ts:54, 1270, 1756` (the `accepted_offline` row of its table),
  `till-money.write-session.test.ts:330-360` (its `accepted_offline` row), `tender-refund-balance.test.ts:272`
  (three values out of the it.each), `device-delete.db.test.ts:558-560`, `configuration-transfer.test.ts`
  (744-745 comment, 817-825 raw insert, 983, 1005, 1024), `payments-screen.bill-recovery.test.ts:528-534`
  (the three rows), `apps/till/src/api/client.test.ts:392-430` (title and the `allowOffline` key),
  `till-app.test.ts:11052-11080, 24232-24270` (drop `allowOffline` from the emitted detail and the
  expected request; titles drop "+allowOffline"), `tender-pay.test.ts:1579-1625` (delete the toggle
  cases; the tip case keeps `{ tip: "0.30" }`), `tender-pay.a11y.test.ts:267` (title drops the
  toggle), `tender-pay.unsaved.test.ts` (both cases at 275 and 360, exactly as "Assertions that change, by
  design" lists them). Each removed key or row belongs
  to the dropped feature; nothing else changes.
- [ ] **Step 6: Run.**
  `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/dashboard typecheck`, then
  `pnpm --filter @waitron/server exec vitest run src/bill-payments.card.test.ts src/alerts-api.test.ts src/alerts.test.ts src/till-sale-integrated.test.ts src/till-sale-integrated.db.test.ts src/placed-order-one-payment.test.ts src/tender-refund-balance.test.ts src/device-delete.db.test.ts src/configuration-transfer.test.ts src/attendance-integrated-payments.test.ts src/attendance-integrated-discovery.test.ts src/till-money.write-session.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/screens/alerts-screen.test.ts src/screens/box-status-screen.test.ts src/widgets/alerts-bell.test.ts src/screens/payments-screen.bill-recovery.test.ts src/dashboard-app.help.test.ts src/dashboard-app.a11y.test.ts`,
  `pnpm --filter @waitron/till exec vitest run src/widgets/tender-pay.test.ts src/widgets/tender-pay.a11y.test.ts src/widgets/tender-pay.unsaved.test.ts src/api/client.test.ts`
  (and `src/till-app.test.ts`, `src/dashboard-app.test.ts` with `-t` on the touched cases; CI runs
  the rest). Browser suites: check `memory_pressure | grep free` first. Expected: a `Tests` count,
  all passing.
- [ ] **Step 7: Commit:** `git commit -s -m "Stop offering offline card acceptance on the till and server (A1308 4b)"`

### Task 3: Configuration export format and the Madrid capture

**Files:** `packages/provisioning/src/configuration-transfer.ts`, `apps/server/src/configuration-import.test.ts`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, plus any test the format number breaks.

Precedent: every table retirement from an export bumped the format (rows "A841 pre-theme-retirement"
etc. in `configuration-import.test.ts:118-200`; format 10 in #2415). Without it an older export is
refused by `checkedRows` as `setup.request_invalid` (`configuration-transfer.ts:552-554`), which
does not tell the person the file is old.

- [ ] **Step 1: Failing test.** In `configuration-import.test.ts`'s refusal table add
  `["pre-payment-policy-retirement export with the policy", { version: N, tables: { ...bundle.tables, payment_policy: [] } }]`
  and `["pre-payment-policy-retirement export without it", { version: N }]`, and change the
  "future version" row to `N + 2`, where `N` is the format on `main` when you start (10 at
  d908a5b8d4; another A1308 slice may have raised it). Run
  `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts` — the new
  "without it" row FAILS (format N is still current).
- [ ] **Step 2: Bump** `configuration-transfer.ts:123, 160, 474, 476` from `N` to `N + 1`.
- [ ] **Step 3:** `seed.madrid-baseline.test.ts:39`: add `"payment_policy"` to `REMOVED_TABLES`
  (the capture is hash-pinned and must not change).
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`
  and `pnpm --filter @waitron/provisioning test`. Any other test pinning the number is updated to
  `N + 1`; a test pinning anything else is a stop.
- [ ] **Step 5: Commit:** `git commit -s -m "Raise the configuration export format: payments transfers nothing (A1308 4b)"`

### Task 4: Remove the old recovery bundle

**Files:** "Delete" bundle files and "Modify — recovery bundle".

**Interfaces:**
- Produces: `export const MIN_RECOVERY_KEY_LENGTH = 12` in `apps/server/src/backup-config.ts`
  (same value as `recovery-bundle.ts:7`); `export type StateSecretFiles = Record<string, string>` in
  `apps/server/src/state-secrets.ts`, used by `collectStateSecrets`, `unpackBundleToDir` and
  `restore.ts`'s `restoreSecrets`.
- Kept: `recovery.passphrase_invalid` (thrown by `packages/provisioning/src/artifact-cipher.ts:88`
  and `apps/server/src/artifact-cipher-file.ts:80`, used by backup, restore and setup — the design's
  "`recovery.passphrase_*` codes" over-reached), `recovery.bundle_invalid` (still thrown with
  `reason: "unsafe_path"`, `state-secrets.ts:113, 126`), `recovery.state_incomplete`,
  `collectStateSecrets`, `RECOVERY_FILES`, `scrypt-kdf.ts`.

- [ ] **Step 1: Failing test.** In `apps/server/src/boot.test.ts`, replace the probe at 676-683
  ("a 404 would mean `mountRecoveryBundleApi` never ran") with: `POST /api/box/recovery-bundle`
  answers 404. Run `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "<that case's it title>"`
  — FAIL (401 today).
- [ ] **Step 2: Move, then delete.** Add the two exports above; re-point `backup-config.ts:15, 226-227`,
  `backup-api.ts:45, 407`, `backup-recovery-pack-parts.ts:32, 107`, `boot.test.ts:104, 3700` to
  `MIN_RECOVERY_KEY_LENGTH`; `state-secrets.ts:6, 29-30, 105` and `restore.ts:76, 856` to
  `StateSecretFiles`. Delete the seven bundle files, `boot.ts:380` and `3230`, the
  `"waitron-recovery"` command and `src/bin-recovery.ts=dist/bin-recovery.js` in
  `apps/server/package.json:10, 17`, `deploy/Dockerfile:212, 231`, `bin-recovery` in
  `image-smoke.yml:273`, and `apps/server/test-durations.json:882, 883, 907`.
- [ ] **Step 3: Errors and comments.** `errors.ts`: delete `recovery.passphrase_required` and
  `recovery.passphrase_too_short` (1363-1366); `recovery.bundle_invalid`'s comment becomes "A secret
  file's path, from a backup archive being restored, would land outside the state folder or on a
  first-setup host file; `reason` is `unsafe_path`."; `recovery.state_incomplete`'s says "a complete
  backup archive cannot be built". `state-secrets.ts:10-15, 25` say "every backup archive carries",
  not "a recovery bundle". `restore.ts:845` drops "exactly as the recovery-bundle unpack does".
  `node-entry.ts:724` names `run-server.ts` only. `backup-screen.ts:52` names
  `MIN_RECOVERY_KEY_LENGTH` in `apps/server/src/backup-config.ts`. `backup-api.route.test.ts:65,
  1209` comments name the new constant. `first-setup-entry.test.ts:188`'s title "does not import
  host claim or enrolment files through the generic recovery bundle writer" becomes "…through the
  generic state-secrets writer" (title only). `deploy/README.md:555-556`: drop "to `/app/bin-recovery.js unpack …`,".
- [ ] **Step 4: Run** `pnpm --filter @waitron/server typecheck`,
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/state-secrets.test.ts src/restore.test.ts src/backup-api.route.test.ts src/backup-recovery-pack-parts.test.ts src/first-setup-entry.test.ts`,
  `pnpm exec vitest run scripts/manifest-commands.test.ts scripts/deploy-image-env.test.ts scripts/errors-reachable.test.ts scripts/vitest-duration-sequencer.test.mjs`.
  Expected: passing `Tests` counts. (`image-smoke` runs in CI only.)
- [ ] **Step 5: Commit:** `git commit -s -m "Remove the old recovery bundle and WAITRON_RECOVERY_PASSPHRASE (A1308 4b)"`

### Task 5: Remove `WAITRON_TILL_LOCALE`; the trading context carries the venue's display language

**Files:** "Modify — display language".

**Interfaces:**
- Produces: `TillAppSettings = { tipsEnabled: boolean }`; `loadTillAppSettings(env)` reads only
  `WAITRON_TILL_TIPS`; `TradingContext` gains its own `locale: string` ("the venue's display
  language, `readVenueLocale`'s answer at start; not a receipt language") and loses
  `invoiceLocales` and `localeOverride`; `readVenueLocale(db: Database): Promise<SupportedLocale>`
  (no `params`).
- Behaviour: in Spain unchanged — `es-ES` before (the env default, `till-config.ts:18`) and after
  (`readVenueLocale` gives `es-ES` for every Spanish area, since only `es-ES` and `en-GB` are
  supported, `country.ts:236-257`; read, not run, pinned by step 1's tests). Outside Spain the ten
  readers change from `es-ES` to the venue's language (a GB venue: `en-GB`): the unit abbreviation
  on kitchen tickets and in the made-here answer (`kitchen-print.ts:305, 346, 705`,
  `till-api.ts:1309`, `working-order.ts:3201`), the moved-items notice when no ticket prints
  (`kitchen-print.ts:1937`), the content language a sale falls back on when the venue saved none
  (`working-order.ts:785, 1146, 6031`), and `cancelItem`'s default (`line-cancel.ts:98`). A dev box
  seeded in English for a Spanish venue now starts in Spanish (`dev-setup.ts:158` no longer writes
  the variable); each person's own saved language still wins once signed in.

- [ ] **Step 1: Failing tests.**
  - `boot.node-configuration.test.ts`: replace `"GB boot uses raw override rather than defaulted locale (%s)"`
    (195-233) with `it.each(ROWS)("a %s venue in %s answers its own display language with no locale variable", …)`,
    no `WAITRON_TILL_LOCALE`, seeding `tenants` and `locations` from the row exactly as the GB case
    does today (`operationDescription: "Hospitality"`, the same `nodes` row):

    | country | taxId | legalName | province | timeZone | invoiceLocales | expected |
    | --- | --- | --- | --- | --- | --- | --- |
    | `GB` | `GB123456789` | `British Test Ltd` | `London` | `Europe/London` | `["en-GB"]` | `en-GB` |
    | `ES` | `66000001Y` | `Prueba Madrid SL` | `Madrid` | `Europe/Madrid` | `["es-ES"]` | `es-ES` |
    | `ES` | `66000001Y` | `Prueba Barcelona SL` | `Barcelona` | `Europe/Madrid` | `["ca-ES"]` | `es-ES` |

    (`66000001Y` is the Spanish taxpayer id `receipt-language.test.ts:138` already seeds; the
    Barcelona receipt language `ca-ES` differs from its display language on purpose.)
    Assertions: `GET /api/till` answers `locale: expected`; `observed.cfg.locale` is `expected`.
    For the Barcelona row also assert
    `findAdministrativeArea(getCountryPack("ES")!, "Barcelona")?.defaultLocale` is `"ca-ES"`
    (`@waitron/country`, `@waitron/country-packs`; not `@waitron/country-es`, which the module-seams
    guard keeps out of the server), so the row proves an area language the apps cannot display is
    skipped, not that Barcelona has none. Before step 2, the GB row fails on its assertion
    (`observed.cfg.locale` is `es-ES`, the old default); the Spanish rows pass, which is expected:
    Spain does not change.
  - `kitchen-print.language.test.ts`: add `it("a GB venue's kitchen ticket picks the unit in the venue's display language", …)`
    (design §5 measure 8): build `cfg` with `locale: await readVenueLocale(suite.db)` after setting
    the tenant to GB, a line with `unitName: { "en-GB": "EN-unit", "es-ES": "ES-unit" }` and
    `sold_in_each = 0` as in the A964 case (262-300); the ticket contains `1 EN-unit x`. Control in
    the same file: a Spanish tenant prints `1 ES-unit x`. Vitest does not typecheck, so before
    step 3 both fail first with a plain `TypeError` (reading `override` of `undefined`), because
    `readVenueLocale` still destructures its `params` argument (`venue-locale.ts:51-54`). That is
    the missing argument, not the old behaviour; the GB boot row above is the failure that shows
    the old behaviour. After step 3 these two pin the chain from the venue's geography to the
    printed unit, and the Spanish one must pass unchanged.
  Run `pnpm --filter @waitron/server exec vitest run src/boot.node-configuration.test.ts src/kitchen-print.language.test.ts` — FAIL.
- [ ] **Step 2: Shrink the settings.** `till-config.ts` per Interfaces. `trading-context.ts:16-17`:
  `TradingContext` adds `locale: string`.
- [ ] **Step 3: Boot.** In `boot.ts`, compute `venueLocale = await readVenueLocale(db)` before the
  `tradingContext` literal (2084) and set `locale: venueLocale` in it; delete the old comment and call
  at 2096-2098. `venue-locale.ts:44-63`: drop `params` and the override sentence; pass no
  `override` to `resolveInstalledCountryLocale`.
- [ ] **Step 4: Dev setup.** `scripts/dev-setup.ts`: delete `WAITRON_TILL_LOCALE` from `DevEnv`,
  `ENV_KEYS` and `devEnvFor` (90, 101, 158); the `locale:` console line (464) prints
  `receiptLocale`'s source instead or is deleted (delete it); `seedDemoDevices`' literal (283-289)
  drops `invoiceLocales`. `dev-setup.test.ts`: delete the `WAITRON_TILL_LOCALE` assertions and the
  "carries WAITRON_TILL_LOCALE…" and "maps bare seed locale %s into full-tag WAITRON_TILL_LOCALE…"
  cases (63-66, 145-155); other assertions stay. Reason: the variable no longer exists.
- [ ] **Step 5: Re-point the tests that set or read the override.** Assertion changes allowed here,
  each because the override or field is gone:
  - `till-config.test.ts`: delete the three locale cases (58-82) and the locale part of the node-id
    case at 44 (its title drops "and defaults locale to es-ES"); keep the tips cases (84-99); expected
    `loadTillAppSettings` objects (51, 182) become `{ tipsEnabled: false }`.
  - `node-config.test.ts:20-41, 84-95`: drop `WAITRON_TILL_LOCALE` from inputs; expected
    `loadTillAppSettings` output `{ tipsEnabled: true }`; delete `"keeps raw locale %s distinct from its default"`.
  - `venue-locale.test.ts`: calls become `readVenueLocale(suite.db)`; delete the override cases
    (62-75) and `"raw locale override leaves GB geography visible"` (228-240).
  - `boot.node-configuration.test.ts:143, 258, 270-276`: drop the variable; the "%s retains app
    preferences" case keeps `locale: "en-GB"` (the GB venue's own) and drops `invoiceLocales` from
    its `toMatchObject`.
  - `first-fiscal-mode.test.ts:28`: drop the variable.
  - `receipt-language.test.ts:163-175`: `venueWith` builds `cfg` with `...loadTillAppSettings({})`
    and `locale: await readVenueLocale(db)`, losing its `envLocale` parameter. `"is not decided by
    WAITRON_TILL_LOCALE"` (385) becomes `"is not decided by the venue's display language"`:
    `venueWith(suite.db, ["gl-ES"], MADRID)`, `expect(v.cfg.locale).toBe("es-ES")`, and every receipt
    assertion unchanged. The title at 331 drops ", with WAITRON_TILL_LOCALE unset".
  - `boot.box-emails.test.ts:358`: `readVenueLocale(suite.db)`.
- [ ] **Step 6: Typecheck-driven deletions.** Run `pnpm --filter @waitron/server typecheck`. For
  each error that a `TradingContext`-typed literal names `invoiceLocales` or `localeOverride`
  (TS2353), delete that property line; for each read of `cfg.invoiceLocales` (about 20, Finish line
  3's grep) write `[cfg.locale]` (or `cfg.locale` where `[0]` was taken); for each literal that
  spread `loadTillAppSettings(...)` and now lacks `locale` (`boot.setup-routes.test.ts:587`,
  `boot.test.ts:2093, 3023, 3238`, `receipt-guests.routes.test.ts:129`) add `locale: "es-ES"`.
  A `RecordSale`, `seedVenue` or provisioning `invoiceLocales` is a different field and stays.

  Test support under `apps/server/src/testing/` is treated like tests. Nine helpers carry a
  `TradingContext` `invoiceLocales`; in each, the one to delete is the line in the `cfg` literal
  beside `tipsEnabled: false` (the other `invoiceLocales` in the file feeds provisioning or
  `recordSale` and stays):
  - typecheck errors: `clock-venue.ts` (68), `signed-in-till.ts` (103), `split-extras-venue.ts`
    (62), `venue-fixtures.ts` (48); reads: `order-venue.ts:262` and
    `invoice-customer-fixture.ts:128` (`venue.cfg.invoiceLocales` → `[venue.cfg.locale]`);
  - no error (the literal is not directly typed), but the key is dead and goes too:
    `bill-venue.ts` (169), `party-venue.ts` (139), `adjustment-venue.ts` (356).
  An error anywhere else outside `*.test.ts`, `boot.ts` and `scripts/dev-setup.ts` is Stop point 3.
- [ ] **Step 7: Comments and docs.** `packages/country-packs/src/registry.ts:178-180`: "…writes its
  amounts and dates." (drop the `loadTillAppSettings` clause). `apps/till/README.md`: delete line 116
  and the table row at 135. `docs/developers/conventions-ui.md:1862`: "Unit-map selection keeps
  `cfg.locale`, the venue's display language (`readVenueLocale`);".
- [ ] **Step 8: Run** `pnpm --filter @waitron/server typecheck` and
  `pnpm --filter @waitron/server exec vitest run src/till-config.test.ts src/node-config.test.ts src/venue-locale.test.ts src/boot.node-configuration.test.ts src/first-fiscal-mode.test.ts src/receipt-language.test.ts src/kitchen-print.language.test.ts src/boot.box-emails.test.ts src/receipt-guests.routes.test.ts scripts/dev-setup.test.ts`
  plus every test file step 6 touched (CI runs the full package). Expected: passing `Tests` counts.
- [ ] **Step 9: Commit:** `git commit -s -m "Remove WAITRON_TILL_LOCALE: the trading context carries the venue's display language (A1308 4b)"`

### Task 6: Backlog, docs, protection list, finish

**Files:** "Modify — docs and backlog".

- [ ] **Step 1: Backlog.** Delete `docs/backlog/architecture.md:1279` (`payment_policy`'s DELETE
  restriction: the table is gone). `docs/backlog/payments.md:544`: drop ", including accepted or
  forwarded offline payments". `docs/backlog/till.md:71-72`: drop "`GET /api/till` never sends
  `stripe_on_device`, so the offline-consent toggle cannot appear;". `till.md:3930`: "reader and
  tip". `docs/backlog/box.md:265-266`: drop "; and the recovery bundle's `encryptBundle` and
  `decryptBundle` (…)". `docs/backlog/setup.md:814`: "a restore archive holding it is refused". `docs/backlog/box.md:192`
  (the `resolveSafeEntryPath` entry): "keeps none of `waitron-recovery unpack`'s destination
  refusals (a symbolic link, another user's folder, not a folder) on the state folder it is given"
  becomes "refuses none of these on the state folder it is given: a symbolic link, another user's
  folder, or something that is not a folder" (the command is gone; the restore's behaviour is
  unchanged). `docs/developers/conventions-data.md:1038-1040`: "It reads `('cash_only', 5000)`
  today — `apps/server/src/configuration-transfer.test.ts` (its `payment_policy` insert)." becomes
  "It read `('cash_only', 5000)` until A1308 slice 4b deleted `payment_policy` and that insert
  (`apps/server/src/configuration-transfer.test.ts`, 2026-11)." The sentences around it stay.
  `docs/backlog/english-only-audit.md`: a dated note at the top, in the file's style:
  "_2026-11-xx, A1308 slice 4b: `WAITRON_TILL_LOCALE` is gone; kitchen-ticket units and the other
  `cfg.locale` readers follow the venue's display language (`readVenueLocale`). References below
  describe the earlier setting._". `docs/developers/conventions-data.md:1821-1824` and
  `design-system.md:5840`: the new format number. No guide (EN or ES) mentions any of the three
  (grep of `apps/server/src/guide/` on 2026-11-08), so none changes.
- [ ] **Step 2: Finish-line greps** (Finish line 1–3). Each prints what it says.
- [ ] **Step 3: Protection list.** From `apps/server`: `pnpm protection-list list --out <empty dir B>`,
  then `pnpm protection-list compare --old <A or A0> --new <B> --report <file>`. Paste the report
  into the PR and mark each line against "Expected protection-list difference". Any other line is a
  stop.
- [ ] **Step 4: Format.** `pnpm exec prettier --check` on the changed non-`docs/` files (`docs/` is
  ignored; `prettier --file-info` confirms).
- [ ] **Step 5: Commit, `/finish-branch`, PR** with the first line from the header. After merge:
  `wa-wt reset` for the dev slots and the Santet venue (rules §2).
