# A646 Modules and card providers implementation plan

Google is entirely out (owner, 2026-11-11 15:03; A1507). Other optional modules will be listed but cannot be switched.

**Request:** “A Modules page listing the optional modules, where the administrator switches each on or off and fills in its settings.” “SumUp and Stripe are set up from that page too. Card payments links to the list, filtered to card providers.” Source: [A646](../../backlog/architecture.md#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up).

**Authority:** the watcher’s 2026-11-11 14:54 scope read cut the old eight-slice plan to the list and card providers; 14:59/15:03 removed Google. The watcher cleared import PR #2842 separately. This replacement was authored by a separate Sol-high invocation and checked by the driver; Claude’s one re-read and watcher clearance are required before build. No owner approval of this revised design is claimed. The [historical design](../specs/2026-10-16-a646-modules-page-design.md) supplies layout and permission intent only where these later decisions retain it.

**Choice needing clearance:** existing Disconnect deletes credentials and evicts the pool (`apps/server/src/payments-api.ts:776–794`); refunds read that pool (`bill-refunds.ts:102–116`), whose adapters reopen credentials (`packages/payments-{stripe,sumup}/src/card-provider.ts`). Source inference, not a runtime experiment: Disconnect cannot supply the watcher’s “Off blocks new collections; refunds/checks keep working” meaning across a rebuild. Recommend one provider-enabled boolean map in a Payments-owned `defineSettingsDocument`, using the existing shared `settings` table, revision and `saveSettings`; not a field in core’s `VENUE_SETTINGS`. Default On; `transfers: false` so imports start On. No new table, operation record or service generation. The watcher must clear this small admission setting, or revise the Off requirement, before build.

## Slice 1: complete list and provider on/off, within three hours to PR

**Usable result:** open Settings → Modules, browse every optional module, follow Card payments to all providers, and enable/disable new provider collections while retaining credentials for refunds/checks. Existing provider setup remains on Card payments until slice 2.

- [ ] Start with failing tests; derive rows from all composition descriptors, not only enabled browser contributions. Add `apps/server/src/modules-api.ts` and mount in `boot.ts`; browser rows consume safe server metadata, with labels in the composition twin `packages/dashboard-modules/src/module-labels.ts`/`index.ts`. No member inventory in dashboard code.
- [ ] Add `apps/dashboard/src/screens/modules-screen.ts`; wire `dashboard-app.ts`, `navigation.ts`, `api/{client,live-queries}.ts`. Enabled is initial; Add selects Disabled; Category is independent. Card payments links to `/manage/modules/category/card-providers/state/all`, overriding remembered filters. Keep persistent reasons beside unsupported module actions and pin row menus at the end.
- [ ] Preserve the design’s administrator-only full catalogue (`modules.manage`, declared in `packages/identity/src/permissions.ts`); the existing provider permission is actually `hardware.manage` (`payments-api.ts:138`), including managers. Server-filter the manager’s provider-only view. Reuse fresh sign-in and separate state confirmations.
- [ ] If cleared, add `packages/payments/src/settings.ts` and register its document in `packages/composition/src/modules.ts`. Extend provider reads and a revision-checked state command in `payments-api.ts`, reusing its active-reader refusal. Retain credentials; Configure/connection state is separate from admission.
- [ ] Gate only new attempts in `packages/payments/src/store.ts:insertAttempting`, before network work. Preserve refunds, checks, recovery and attempts already admitted. Add the domain refusal in `payments/src/errors.ts`, its reservation-release handling in `apps/server/src/bill-payments.ts:REFUSED_START`, and EN/ES dashboard/till code text. Refresh/subscription follows existing settings and query support.

**Tests by owner:** Payments `settings.test.ts`/`store.test.ts` own parsing/defaults and Off refusal/On admission using `useVenueDb`. Server `modules-api.test.ts` owns complete/permission-filtered rows; `payments-api.test.ts` owns revision, fresh sign-in, active-reader refusal and credential retention. One `card-provider-pool.test.ts` case owns refund/check through a rebuilt credential-backed client after Off; `bill-payments-api.test.ts` owns releasing the refused reservation. Dashboard `modules-screen.test.ts` owns visible rows, independent filters/direct links, confirmations and refusal recovery; navigation/registry tests own their changed contracts. Do not repeat provider failure matrices.

**Forecast:** production +420/−15; tests +290/−10; support/help +90/−5 (about 830 changed lines). Forecast, not measured. Required integration belongs in this usable PR.

## Slice 2: provider configuration modals, within three hours to PR

**Usable result:** configure SumUp/Stripe on Modules; Card payments retains readers and payment/refund recovery and links to provider setup.

- [ ] Test first, then reuse `CardProviderPanel.renderConnectForm` and the existing panel registry in `modules-screen.ts`; shared dialog and `draftScopeFor` preserve child drafts. Configure saves credentials without changing On/Off. Close after a successful save, refresh separately. Keep destructive Disconnect separate with its existing confirmation/refusal.
- [ ] Remove superseded provider presentation from `payments-screen.ts`. `modules-screen.unsaved.test.ts` owns dirty close/Back/Escape and save-success/refresh-failure; retain/move the actual behavioral assertions from `payments-screen.disconnect.test.ts`. Provider-owned form suites keep their existing responsibility.

**Forecast:** production +150/−150; tests +160/−65; support/help +45/−30 (about 600 changed lines). No infrastructure-only slice.

**Both slices:** EN/ES `guide/{en,es}/modules.md`, payment guides and dashboard `help-guide.ts` explain the usable state with shared heading IDs. Run focused Vitest files named above via `pnpm --filter <owner> exec vitest run <file>`; run root `scripts/{module-seams,guide-links}.test.ts` and server `guide-content.test.ts`. Inspect EN/ES, light/dark, 390/1280px, keyboard focus and refusal placement. Normal hook and current-head CI follow; no whole-package local runs.

**Excluded:** generic module switching/editors, Google, pending operations, request holds/crash protocols, all-reader rerouting, retained-table protection (A483), migrations and repeating PR #2842. Material growth returns to the watcher before build.
