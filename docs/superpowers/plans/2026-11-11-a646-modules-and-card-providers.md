# A646 Modules and card providers implementation plan

Google is entirely out (owner, 2026-11-11 15:03; A1507). Other optional modules will be listed but cannot be switched.

**Request:** “A Modules page listing the optional modules, where the administrator switches each on or off and fills in its settings.” “SumUp and Stripe are set up from that page too. Card payments links to the list, filtered to card providers.” Source: [A646](../../backlog/architecture.md#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up).

**Authority:** watcher 2026-11-11 14:54 cut the old eight-slice plan to the list and card providers; owner15:03 removed Google. Import PR #2842 is separate. A separate Sol-high invocation authored the draft; the driver checked it and Claude read it once (303s, lane D `receipts/a646-page-plan-review.md`). Findings are incorporated below. Watcher15:52 cleared one saved provider setting in shared settings and administrator-only state changes. Watcher 2026-11-11 16:02 cleared this setup-first order with the six corrections incorporated below; no owner approval of this revised design is claimed. The [historical design](../specs/2026-10-16-a646-modules-page-design.md) supplies retained screen behavior.

**Reuse and limit:** Disconnect deletes credentials (`apps/server/src/payments-api.ts:776–794`), while refunds reopen them through the provider pool (`bill-refunds.ts:102–116`). Source inference, not runtime-tested evidence: Off must retain credentials. Reuse the existing active-reader refusal, so Off is available only after readers are removed/unpaired. Claude’s simpler route checks the setting when readers are added/adopted, rather than changing payment admission. Do not modify `requireConnected`: recovery also calls it. The watcher cleared this slice order and remove-readers-before-Off behavior at 16:02. A646 stays OPEN after slice 2: A483 blocks switching workforce, workforce-es, payments, bookings and staffing.

## Slice 1: complete catalogue and provider setup, within three hours to PR

**Usable result:** browse every optional module, follow Card payments to all providers, and configure SumUp/Stripe in Modules modals. On/Off follows in slice 2; ordinary module switches remain unavailable with a visible reason. Watcher17:15 cleared removing Configure and its empty window from rows with no settings; such rows have no kebab.

- [ ] Test first. Add `apps/server/src/modules-api.ts`, mounted in `boot.ts`, deriving optional rows from every composition descriptor with `tier: "toggleable"`, plus contributed providers. Never infer the whole catalogue from enabled browser contributions or maintain a member list in dashboard code.
- [ ] Add dashboard `screens/modules-screen.ts`; wire `dashboard-app.ts`, `navigation.ts`, `api/{client,live-queries}.ts`. Labels live in the browser composition twin `packages/dashboard-modules/src/i18n/module-labels.ts` (new), exported by `src/index.ts`. Reuse `hardware.manage` for reading/configuring; the full read-only list need not be hidden from managers. No new core permission or permission-filtered duplicate catalogue.
- [ ] Enabled is initial; Add selects Disabled; Category is independent. Use the design’s `/manage/modules/view/card-providers/state/all` for the Card payments link and redirect old setup addresses there. Providers start Enabled when Payments is enabled, even without credentials; show Needs setup separately. Watcher17:20 cleared deriving the catalogue state from the parent module, without changing collection gates or stored settings.
- [ ] Reuse `CardProviderPanel.renderConnectForm` and the existing panel registry in the shared dialog with `draftScopeFor`; Configure changes credentials only. Keep destructive Disconnect separate. Close after successful save, then refresh. Remove superseded provider presentation from `payments-screen.ts`, preserving readers and recovery tools.

**Tests:** server `modules-api.test.ts` owns catalogue completeness and authorization. Dashboard `modules-screen.test.ts` owns rows, filters/direct links, panel selection, no empty Configure actions and refusal recovery; `modules-screen.unsaved.test.ts` owns dirty close/Back/Escape and save-success/refresh-failure. Preserve relevant behavioral assertions from `payments-screen.disconnect.test.ts`; provider-owned form suites retain their responsibility. Navigation/registry tests cover changed contracts.

**Forecast, added/removed:** production +420/−100; tests +350/−65; support/help +35/−20 (about 990 changed lines, unmeasured). Provider forms retain their own validation tests; the page tests modal/draft integration. At three hours, checkpoint the tested catalogue and provider windows and ask the watcher for the smallest cut before opening an incomplete PR.

## Slice 2: administrator-only provider on/off, within three hours to PR

**Usable result:** an administrator turns new provider use Off after removing its readers, without losing credentials for earlier-payment refunds/checks. A manager cannot change that state.

- [ ] Test first. Add Payments-owned `src/settings.ts` via `defineSettingsDocument`/`saveSettings`, registered in `packages/composition/src/modules.ts`: one boolean map, default On, `transfers: false`. Use the existing settings table/revision; no new table or operation record.
- [ ] Add a Payments-declared `payments.providers.manage` permission granted from admin, registered through its descriptor, for state commands. Keep current configuration permissions. `payments-api.ts` checks it and the existing active-reader refusal; saveSettings owns stale-revision refusal; retains credentials and the pool; returns the new state/revision.
- [ ] Check enabled at the existing reader pair/adopt boundaries, before provider work and again before writing an active reader. Leave `requireConnected`, the pool, payment-start/store paths, refunds and existing-payment checks unchanged. Show separate state confirmations and persistent red refusals naming attached readers and linking directly to their removal on Card payments; no fresh sign-in for reversible On/Off; refresh with existing settings/query support.

**Tests:** Payments `settings.test.ts` owns parsing/defaults. Server `payments-api.test.ts` owns manager refusal/admin success, in-use refusals (settings owns stale-revision tests unless the API answer differs), credential retention, reader-add/adopt refusal while Off and one real recovery call while Off. No new pool-only or money-path tests. Dashboard cases own state confirmation/refusal and On versus connection status.

**Forecast, added/removed:** production +180/−10; tests +150/−10; support/help +25/−5 (about 380 changed lines, unmeasured).

**Both slices:** add EN/ES `apps/server/src/guide/{en,es}/modules.md` and update their `printers.md` card-reader sections and dashboard `help-guide.ts`, with shared heading IDs. Run named focused files via `pnpm --filter <owner> exec vitest run <file>`, root `scripts/{module-seams,guide-links}.test.ts` and server `guide-content.test.ts`; inspect EN/ES, light/dark, 390/1280px and keyboard focus. Normal hook and current-head CI follow; no whole-package local runs.

**Excluded:** generic module switching/editors, Google, payment-path gates, pending operations, request holds/crash protocols, all-reader rerouting, retained-table protection (A483), migrations and repeating PR #2842. Material growth returns to the watcher before build.
