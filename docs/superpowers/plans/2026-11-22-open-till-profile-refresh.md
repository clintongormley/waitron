# Refresh idle logout and clocking on an open till

A signed-in till with no order open picks up an administrator’s new idle logout interval
and shows or removes the clock controls when that profile setting changes. Staff keep
their current screen and can continue without signing in again.

The owner said “when the till is empty” on 22 November at 13:07, recorded under
OPEN-TILL-ADOPTS-SETTINGS in Lane F’s queue. On main at a7c4f7e555, a timeout-only
change reached the till’s setup response and left the old timer running. Clock in
reached the profile and left the clock controls unavailable. The same browser
opened the changed starting screen at its next sign-in. The dashboard refused to
change the form factor of the assigned profile with `device_profile.in_use`.
This slice covers the two measured profile gaps. Zone payment flow has its own
measurement and a pending watcher decision about unsaved baskets.

1. In `apps/till/src/till-app-setup-refresh.test.ts`, use the existing signed-in app,
   setup revision and fake-clock harness. Change only the idle timeout and show
   the session stays open past its old expiry. Enable and disable clocking through
   the poll and check the account menu, with no new clock-in prompt or clock write.
   Keep an existing counter basket through a changed setup and verify the pending
   change takes effect on clearing it. Keep the existing order, sign-in and
   newer-response tests.
2. In `apps/till/src/till-app.ts`, use the existing setup reads and sequence numbers.
   Keep the latest live timeout and clock eligibility until the current operator
   has no counter basket, open table order or order request in progress. Apply
   after an idle poll or when that work is cleared. Use the existing idle timer
   configuration and clocking and attendance start/stop methods. On live enable,
   use their prompt-free path. Start or stop on a real eligibility change, and
   keep server refusals authoritative. Boot and a deliberate profile switch still
   initialise the profile. The active navigation and device zone reconciliation
   keep their existing paths. Drop pending values on operator or server change.
3. Update the English and Spanish Staff guide’s Device profiles section and the
   setup-read explanation in `docs/developers/conventions-ui.md`. Retire A787’s
   profile-refresh entries where this slice closes them. Keep the zone-payment
   backlog for that slice. Run the setup-refresh file and the existing idle
   logout and clocking cases that cover the reused paths, then the normal branch
   review and CI.

Expected change: about 55 added and 15 removed application lines, and 100 added
test lines. No new request, storage or schema. Existing terms for the recorded
order and the settings that govern a first save are outside this slice.
