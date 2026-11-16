# Sign-in and passkey leftovers

**Finish line:** one PR sends Profile’s saved names, confirmed email and accepted passkeys from its profile reload, removing the extra signals request, and shares the hidden-username helper without changing each caller’s behavior. Real password-manager results remain unverified.

**Authority:** SIGNIN-PASSKEY-LEFTOVERS, Lane K queue, watcher 2026-11-16 14:50. Separate Sol-high draft checked by driver; one Claude source review completed. Watcher clearance is pending, including the rulings below. No owner design approval claimed. Source base `1eb3093eb4`.

**Reuse/consumers:** keep identity’s `readOwnProfile` answer unchanged; its management-api admission/registration callers discard it. Extend only the HTTP answer in `me-api.ts`. Dashboard `getProfile` also feeds fresh-sign-in and Servers; neither sends signals. Keep live dependencies/passive reads/draft ownership, `readPasskeySignals`, `managementSite`, existing browser fallback/error handling and the standalone signals endpoint for shell sign-in.

## Build, test first

1. **HTTP answer:** in `apps/server/src/me-api.ts`, sequentially read profile and signals in the existing transaction; return required `passkeySignals: { rpId, ...signals }`, using `managementSite(c, proofSite)`. Add `passkeySignals: PasskeySignals` to dashboard `OwnProfile` in `api/client.ts`. First extend `me-api.test.ts` and `me-api.cross-person.test.ts`: current versus pending/confirmed email, own/colleague credentials, empty list, configured local site and existing anonymous refusals. Missing payload must fail first. Keep existing assertions; reuse `management-api-passkey.test.ts`’s remote-site coverage, with no new harness.

2. **Browser sending:** extract `sendAcceptedPasskeys(signals: PasskeySignals): Promise<void>` in `apps/dashboard/src/passkey-signals.ts`; fetching `signalAcceptedPasskeys(api)` delegates while preserving unsupported-browser/no-fetch behavior. `passkey-signals.test.ts` owns unavailable/partial support, throws/rejections and nonfatal handling. `screens/profile-screen.ts` captures details/email/passkey/remove mode before closing. Make `#load` return the profile snapshot actually applied, independently of locales/Google failure; no snapshot on profile failure or unsubscribe without apply. Send that returned payload with existing operation/connection checks, never stale `this.profile`. Do not reuse scope-based `active()` after `#closeSaved`, which disposes that scope. Navigating away during reload drops this update’s signal; name that limit in the PR.

   First extend `profile-screen.test.ts`: distinct old/reloaded payloads, held reload, exact browser arguments, one profile reload and zero signals requests; details/email/extra-request checks fail before implementation. Keep failed-write, unrelated-setting, successful-write/failed-refresh, save-state and unsaved assertions; pin no stale signal and successful profile signaling despite auxiliary-read failure. The current sole observer’s release removes its cache entry (`live-data.ts:102–108`); keep the held-reload proof mandatory. No passive-update signaling or new coordination machinery.

3. **Hidden username:** add optional `"confirmation" | "login"` mode to `widgets/autofill-username.ts`, default confirmation. Login alone keeps `name="email"`, its data hook and empty rendering; confirmation keeps `name="username"` and empty/null → nothing. Replace all three login templates and duplicate styles. Shared styles also zero the clipped input’s padding/border. Before refactoring, pin existing DOM/name/autocomplete/value/readonly/tabindex/aria-hidden/hidden-bounds behavior in `login-screen.test.ts` and `widgets/fresh-sign-in.test.ts`. Remove only login’s obsolete native-field allowance row; retain every guard assertion.

4. **Watcher rulings before build:** Claude recommends no Profile FormFeedback migration for a post-close signal change, and treating replacement of non-interactive hidden login inputs as outside the form-adoption rule. Driver recommends that smaller scope, pending explicit ruling. Alternative: login-only FormFeedback adoption preserving account-action/password/factor/recovery attempt/refusal/focus behavior; no Profile migration. Separately clear the tighter native-field allowance change under the lane’s changed-check rule. Add no unrelated backlog item.

5. **Coverage recheck:** planning ran `packages/identity/src/profile.test.ts`:36 passed; scoped coverage exited1 against unchanged thresholds, recording `profile.ts:78` throw0hits, branch[0,77]. The existing deleted-person case634 reaches the resolver’s earlier inner join; the shared transaction’s write lock prevents another writer deleting between reads (source inference: `management-session.ts:62`, `tenancy.ts:30`, `write-queue.ts:62`). Retain guard/test; ask the watcher to retire the stale note without a duplicate/impossible-interleaving test, explicitly resolving the queue’s conditional wording. No coverage gate claimed or repeated diagnostic needed.

## Verification and finish

Run red then green for new behavior, and every changed test file. Use existing real-DB/browser helpers. Typecheck selects required profile-fixture additions; also complete inferred stubs that exercise signal-saving actions. No fixture framework. Focused commands:

```sh
pnpm --filter @waitron/server exec vitest run src/me-api.test.ts src/me-api.cross-person.test.ts src/management-api-passkey.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/passkey-signals.test.ts src/screens/profile-screen.test.ts src/screens/profile-screen.unsaved.test.ts src/screens/profile-screen.save-state.test.ts src/screens/login-screen.test.ts src/widgets/fresh-sign-in.test.ts src/widgets/fresh-sign-in.a11y.test.ts src/widgets/fresh-sign-in-dialog.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t 'telling the password manager which passkeys are accepted after a sign-in'
pnpm --filter @waitron/dashboard exec vitest run src/screens/servers-screen.handover.test.ts
pnpm exec vitest run scripts/native-form-fields.test.ts
```

Correct the hidden-field “two files” prose in `conventions-ui.md:226` and `design-system.md:3615`, naming the helper without a count. Trim completed C98/C99/C101 and agreed Task1b text/bundle descriptions in `docs/backlog/dashboard.md`; reconcile `docs/backlog.md`. Retain real-device, timing/expired-challenge, UUID and foreign-key questions. Checked EN/ES staff own-account instructions remain applicable; no guide edit. Inspect any drawn change in both themes and phone width; no new visible UI planned.

No new state, tables, protocols, polyfills, permissions/login policy or unrelated repair. After focused checks, announce readiness; authorised finish-branch gets two independent Claude run-it reads, fixes/read, normal hook and current-head CI. Then land-branch, exact-merge CI, main install and owned cleanup. No whole-package/workspace local run solely to finish.

**Forecast added/deleted:** production95/70; behavioral tests170/35; fixture/guard support60/5; prose65/20 = **520 changed lines**, outside opinion at780. Conditional login-only feedback adoption adds30/25 production (575total; opinion at863). Stops seek an outside opinion, never impose a ceiling.
