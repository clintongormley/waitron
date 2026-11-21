# Explain the guest-menu sharing requirement

**Goal.** When Cloud requires a trial or paid plan for menu sharing, a manager sees why in
Guest menu preview and can open Cloud Billing to start a free trial if the venue can still take one.
Scope is Lane D’s `GUEST-MENU-TRIAL-PREVIEW` queue entry of 21 November 2026 at 06:05.

[Cloud #1342](https://github.com/waitron-io/waitron-cloud/pull/1342) gives the existing signed
guest-menu status an optional `planRequired: true`. It also returns
`403 guest_menu_plan_required` if a publish reaches Cloud after eligibility lapses. Use these
answers for this venue. The box’s billing display has billing level and dates, while its
local Cloud connection status already supplies the configured `accountUrl`. Build the existing
Cloud portal route `/account/billing` from that origin. Cloud handles sign-in and trial availability.

- [ ] Write the failing cases in `apps/server/src/cloud-guest-menu.test.ts` using the signed HTTP
  fixture. Show that an enabled publication gets `plan_required` and the trusted billing URL when
  the status carries the flag, including when Cloud holds a previously delivered copy. Check the
  exact publish refusal after an eligible status read, recovery on the next eligible pass, and
  withdrawal of a held copy while ineligible. Run the focused file and observe the failure.
- [ ] In `apps/server/src/cloud-guest-menu.ts`, retain the optional literal flag and project
  `plan_required` with `billingUrl` through the existing guest-menu GET and PUT delivery object.
  Map only the exact publish status and code using `serviceExchange`’s existing refusal hook, with
  the code in `apps/server/src/errors.ts`. Keep the result tied to the existing venue and serving
  checks. A plan flag stops a publish Cloud would decline. Cloud’s explicit block keeps precedence,
  and turning sharing off still withdraws. A subsequent signed status replaces the plan flag.
- [ ] In `apps/dashboard/src/widgets/guest-menu-preview.test.ts`, use the existing preview and
  sharing fixtures to show the one-line requirement, the Cloud Billing link and the available
  Turn sharing off action. Check a generic refusal still shows its own wording without the link.
  See the test fail before changing `apps/dashboard/src/api/client.ts`,
  `widgets/guest-menu-preview.ts` and `i18n/strings.ts`. Reuse the current status paragraph and
  a native link in both languages. “Sharing through Cloud needs an active trial or paid plan.”
  “Open Cloud Billing” leads to the trial and plan choices for the signed-in account.
- [ ] Add the Billing step to the English and Spanish `apps/server/src/guide/*/products.md`
  guest-sharing sections. Run focused Cloud delivery, guest-menu route, Dashboard preview and guide
  tests and the error-code guard. Inspect the preview in English and Spanish, both themes and
  phone and desktop widths. Check `git diff --check` and commit with sign-off.

Estimate 45–70 product lines and 75–115 test lines, plus two short guide additions. Reuse the
current Cloud poll and box routes. This slice covers the preview and its billing link. Cloud
enforcement, account setup, and mobile-data qualification are outside this slice.
