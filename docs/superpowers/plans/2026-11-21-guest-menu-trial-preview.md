# Explain the guest-menu sharing requirement

**Goal.** When Cloud hides a guest menu for lack of an active trial or paid plan, a manager
sees why in Guest menu preview and can open Billing to start a free trial where available.
Scope is Lane D’s `GUEST-MENU-TRIAL-PREVIEW` queue entry of 21 November 2026 at 06:05.

The existing signed guest-menu status carries `planRequired: true` while the venue is ineligible.
Cloud hides any held copy, allows withdrawal and serves a still-shared copy again when eligibility
returns. Use the existing poll for this decision. The box’s local Cloud status already supplies
the configured account origin. The proposed link uses Cloud’s existing `/account/billing` route.
[Cloud #1342 contract](https://github.com/waitron-io/waitron-cloud/blob/85e0a5829e5c613b025e104673537a83a06d3346/docs/waitron-integration-contract.md#L2834-L2841)

Claude reviewed the plan and the watcher cleared it at 06:20 on 21 November 2026.
The watcher specified the direct Billing URL and the existing free-trial sentence in both languages.

- [ ] In `apps/server/src/cloud-guest-menu.test.ts`, use the signed HTTP fixture to show
  `plan_required` with the configured billing URL when Cloud flags a still-shared menu, including
  a held copy. Check a completed pass sends no publish then, a later status without the flag
  restores current delivery, and turning sharing off still withdraws the held copy. Run
  `pnpm --filter @waitron/server exec vitest run src/cloud-guest-menu.test.ts` and see the new
  assertions fail before changing delivery.
- [ ] In `apps/server/src/cloud-guest-menu.ts`, read only literal `true` as the plan flag and
  project `plan_required` with `new URL("/account/billing", accountUrl)` through the
  existing delivery object. The venue and serving checks, Cloud’s explicit block, and the
  off or no-publication path take precedence. When there are pages to share, skip a publish
  the signed status says Cloud will decline. Each new status replaces the flag, so a refusal
  after the status read gets its explanation from the next successful poll.
- [ ] In `apps/dashboard/src/widgets/guest-menu-preview.test.ts`, assert the plan line, exact
  billing link and available Turn sharing off action. Check the generic refusal keeps its
  current wording. Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/guest-menu-preview.test.ts`
  before changing `apps/dashboard/src/api/client.ts`, `widgets/guest-menu-preview.ts` and
  `i18n/strings.ts`. Reuse the status paragraph in both languages. “Your Cloud guest menu is
  hidden until your venue has an active trial or paid plan. Start the venue’s free trial in
  Waitron Cloud Billing.” Add “Open Cloud Billing” as a native
  link using the existing Cloud new-tab attributes so the print draft stays open.
- [ ] Add the Billing step to both `apps/server/src/guide/*/products.md` guest-sharing sections.
  After Cloud sign-in, choose Billing and select your venue if asked. Start a free trial if
  offered. Update the A670 delivery note in `docs/backlog/menu.md`. Rerun the focused suites,
  guest-menu route and guide checks. Inspect the preview in English and Spanish, both themes
  and phone and desktop widths. Run `git diff --check` and commit with sign-off.

Estimate 30–50 product lines and 50–80 test lines, plus two short guide additions and the backlog
line. The current Cloud poll and box routes suffice. Cloud enforcement and mobile-data
qualification have their own work.
