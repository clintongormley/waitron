# Sign-in and passkey leftovers

**Finish line.** One PR makes Profile send saved names, confirmed email and accepted passkeys to the browser from its profile reload, removing its extra signals request. Sign-in shares the hidden-username helper with each caller’s present behavior. Real password-manager results remain unverified.

**Authority.** SIGNIN-PASSKEY-LEFTOVERS, Lane K queue, watcher 2026-11-16 14:50. Separate Sol-high draft checked and shortened by the driver; Claude review and watcher clearance are required before build. No owner design approval is claimed. Source base: `1eb3093eb4`.

**Reuse and consumers.** Keep identity’s `readOwnProfile` answer unchanged: the HTTP reader is `apps/server/src/me-api.ts:192`; roster admission and registration verification in `management-api.ts` discard it. Dashboard `getProfile` feeds Profile, fresh-sign-in and Servers (`hasPassword`), including shell confirmation and background clients. Its live query already follows persons/credentials. Reuse `readPasskeySignals`, `managementSite`, the existing sender and hidden-field styles; preserve passive reads and draft ownership.

## Build, test first

1. **Fold signals into the HTTP profile.** In `apps/server/src/me-api.ts`, return required `passkeySignals: { rpId, ...signals }`, reading `readOwnProfile` then `readPasskeySignals` in the existing transaction; derive the site with `managementSite(c, proofSite)`. Add `passkeySignals: PasskeySignals` to `OwnProfile` in `apps/dashboard/src/api/client.ts`. Keep the standalone signals endpoint for sign-in. Before implementation, extend `me-api.test.ts`’s email case and `me-api.cross-person.test.ts`’s response assertions: current versus pending/confirmed email, own versus colleague credentials, empty list, server-provided local/remote staff site, signed-in-only response. Missing payload must fail first. Keep existing cross-person writes/refusals.

2. **Send the successful reload’s payload.** Extract `sendAcceptedPasskeys(signals: PasskeySignals): Promise<void>` in `apps/dashboard/src/passkey-signals.ts`; existing `signalAcceptedPasskeys(api)` keeps its feature-detected fetch and delegates. `passkey-signals.test.ts` owns absent/partial browser support and throwing/rejecting methods; retain its fetch-failure/no-fetch checks. In `screens/profile-screen.ts`, capture details/email/passkey/remove mode before closing, and send the profile returned by that action’s successful `#load`; no signal from stale data after failed refresh, passive updates or other settings. Preserve closure, saved status and draft/error handling. First extend `profile-screen.test.ts`: changed initial/reloaded names and credential lists, held reload, exact browser payload, one reload and zero standalone signals reads. Details/email and extra-request assertions must fail before the fix. Keep save-state and unsaved assertions.

3. **Share the hidden username.** In `apps/dashboard/src/widgets/autofill-username.ts`, add optional mode `"confirmation" | "login"`, default confirmation. Login keeps `name="email"`, `data-autofill-username` and rendering with empty email; confirmation keeps `name="username"` and empty/null → nothing. Replace three templates and duplicate styles in `screens/login-screen.ts`. Preserve native type/autocomplete/value/readonly, hidden bounds, tabindex and aria-hidden through existing `login-screen.test.ts` and `widgets/fresh-sign-in.test.ts` assertions; establish the current preservation checks before refactoring. Remove only login-screen’s obsolete allowance row in `scripts/native-form-fields.test.ts`; retain every guard assertion. This tighter guard-list change needs explicit watcher clearance under the lane’s changed-check rule.

4. **Follow the touched-form convention.** Adopt existing `FormFeedback` from `@waitron/ui` for the touched login/Profile forms’ attempt/reset, refusal dismissal and focus work, as `design-system.md` → Forms requires. Preserve validation, field mapping, message precedence and existing behavior checks; add no validation policy or controller framework. Reviewer must challenge the smallest sufficient adoption and its size.

5. **Reconcile the old coverage note.** `packages/identity/src/profile.test.ts:634` already tests a live session whose person was deleted. Planning ran its full file: 36 passed; the scoped coverage command below exited 1 against unchanged thresholds, and JSON records `profile.ts:78` throw hits 0, branch `[0,77]`. The resolver’s inner join at `management-session.ts:62` refuses first; under the same transaction the later guard appears redundant (source inference). Recommend retain guard and behavioral test unchanged, retire the stale note with watcher clearance, and add no duplicate or fake concurrent-delete test. This differs from the queue’s conditional add-test wording and needs an explicit ruling before build.

## Files, verification and finish

Main edits/tests are named above. Add truthful signal data to affected profile fixtures, particularly `dashboard-app.{test,profile-unsaved.test,unsaved-changes.test}.ts`, `main.session-generation.test.ts`, `screens/profile-screen.{unsaved,save-state}.test.ts`, `screens/recovery-pack-card.test.ts`, `widgets/fresh-sign-in{.a11y,-dialog}.test.ts`; inspect inferred stubs too. Reuse existing setup, no fixture framework. Run each changed test file; keep failures attributable and visible.

```sh
# Existing diagnostic: unchanged thresholds; a partial coverage run, not a green gate.
pnpm --filter @waitron/identity exec vitest run src/profile.test.ts --coverage --coverage.include=src/profile.ts --coverage.reporter=json --coverage.reportsDirectory=<outside-checkout>
# Focused behavior; browser runs only with measured memory headroom.
pnpm --filter @waitron/server exec vitest run src/me-api.test.ts src/me-api.cross-person.test.ts src/management-api-passkey.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/passkey-signals.test.ts src/screens/profile-screen.test.ts src/screens/profile-screen.unsaved.test.ts src/screens/profile-screen.save-state.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/login-screen.test.ts src/widgets/fresh-sign-in.test.ts src/widgets/fresh-sign-in.a11y.test.ts src/widgets/fresh-sign-in-dialog.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t 'telling the password manager which passkeys are accepted after a sign-in'
pnpm --filter @waitron/dashboard exec vitest run src/screens/servers-screen.handover.test.ts
pnpm exec vitest run scripts/native-form-fields.test.ts
```

Trim completed C98/C99/C101 text, the agreed Task 1b note and matching real-device bundle descriptions in `docs/backlog/dashboard.md`; reconcile its index in `docs/backlog.md`. Retain real-device, timing/expired-challenge, UUID and foreign-key questions. Check EN/ES staff guide’s own-account instructions; change only a sentence that becomes false. Background/helper edits change no drawn output; inspect any drawn change in both themes and at phone width.

No new state, tables, protocols, polyfills, permissions/login policy or unrelated repairs. After focused checks, announce readiness and run authorised `finish-branch`: two independent Claude run-it reads for sign-in risk, fixes/read, signed commits, normal hook and current-head CI. Then `land-branch`, exact-merge CI, main install and owned-worktree cleanup. No whole-package/workspace local run solely to finish.

**Forecast, additions/deletions separately:** production +135/−110; behavioral tests +190/−35; fixture/guard support +60/−5; prose +85/−20 = **640 changed lines**. At **960**, stop for watcher opinion with the real events causing growth; this is not a ceiling.
