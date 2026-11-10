# B3 PR 10 proposal: enforce production setup choices

**Awaiting watcher approval.** Owner: “Yes, build it”, 2026-11-01; watcher02:27, 2026-11-10, directs W60 if no useful B3 slice can be built here. This firing authorises finish-branch/land-branch, but implementation waits for Claude’s concrete-plan read and watcher approval. Work inline.

**Deliverable:** a production-started box refuses Demo and Prepare at its public setup boundary, before provisioning, including requests supplying `initialOperations`. Keep the existing specific refusal and Reload remedy. Authority: [approved spec §12.1](../specs/2026-10-21-b3-usb-installer-design.md#121-which-modes-a-box-offers), [parent plan Task 8.1](2026-10-26-b3-usb-installer.md).

**Why this slice:** the installed service executes `deploy/box/waitron-box.sh` (`deploy/box/waitron-box@.service:6`), whose dispatch accepts only clock requests and otherwise returns `unknown_request` (`waitron-box.sh:168`). B3 has no installed Linux network/screen handler yet. A dashboard page would front an unavailable backend; simulated views cannot establish real box acceptance. The complete network/start page also needs API types/methods, registry/sidebar wiring, drafts, status refresh, failure wording, EN/ES locales/guides and browser checks: estimated 1,200–1,600 changed lines from sibling sizes, before any Linux runtime. Choose W60 instead.

The existing production choices and remedy already exist (`apps/setup/src/screens/mode-screen.ts:184`; `apps/setup/src/setup-app.ts:1653`). Public status reports the host environment (`apps/server/src/setup-api.ts:764`); onboarding intent is the provision body’s `mode`, submitted to `/setup-api/provision`. The separate first-setup claim accepts venue/import intent, with activation fixed to Live (`setup-first-fiscal-api.ts:380`; `setup-app.ts:1542`). The remaining source gap is `setup-api.ts:630`: supplied operations omit the throwaway marker; `provision.ts:133` only invokes that allocation check when the marker exists. A disposable route probe at base `efc1c7ecd53a0c9df2da7ba2f7cf0bf0e63953ae` reproduced both supplied-operations cases: HTTP 200, one successful provision callback, and two failed expected-400 assertions. This proves the route delegates forbidden modes, not that real fiscal provisioning succeeds. Receipt: `/Users/clintongormley/waitron-campaign-k/receipts/b3-10-20261110/probe-red.log`.

**Build:** after validating the object and mode in `parseProvisionPayload`, refuse host `production` plus Demo/Prepare with HTTP 400, `sif.throwaway_allocation_refused`, `{ environment: "production" }`. Move operations parsing after the checked mode and this refusal; preserve its existing validation on allowed modes. Both parser callers retain this rule: provision and fiscal-test; add one compact fiscal-test refusal case because its own answer changes from invalid mode to the existing production refusal. No fiscal worker or record input changes. Preserve allocation-layer checks and existing Live, restore/adoption, preproduction and development behavior. Delete the obsolete “refused not here” comment (`setup-api.ts:641`).

**Exact implementation file list:**

- `apps/server/src/setup-api.ts`
- `apps/server/src/setup-api.throwaway.test.ts`
- `docs/backlog/box.md` (B3 remaining work; retain historical explanations)
- `docs/backlog.md` (remove the stale open production restriction only; B3 stays open)

No UI, locale or guide edits: the public answer and available actions stay identical. Exclude This box, name-tag duty, Linux, installer, kiosk, disk keys, same-box cutover and new controllers/protocols/stores. LAN first claim is accepted and closed (`docs/backlog/box.md:575`); add no reservation.

**Size/time:** 1–1.5 hours to open PR. Forecast added/removed: production +12/−4; tests +85/−18; test support +0/−0; docs +12/−4, plus this proposal; generated +0/−0. Basis: one parser guard, replacement of two injected-refusal cases, compact supplied-operations coverage, existing fixtures reused. Count actual additions/removals separately with `git diff --numstat`; do not pad toward 1,000 lines.

**Assertions and checks:** route tests own early refusal with a provision fake that would succeed, both forbidden modes, with/without supplied operations; assert exact envelope and zero provision calls. Deliberately replace the old marker-forwarding/injected-refusal expectations at `setup-api.throwaway.test.ts:174`; retain response/log assertions and positive controls. Existing allocation tests own environment validation. Existing boot test owns empty tables/no restart; existing setup browser tests own choices, EN/ES wording and Reload.

Red, then minimal implementation, then green:

`pnpm --filter @waitron/server exec vitest run src/setup-api.throwaway.test.ts`

Regression checks:

`pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts -t 'refuses Demo with no supplied allocation'`

`pnpm --filter @waitron/setup exec vitest run src/screens/mode-screen.test.ts src/screens/mode-screen.a11y.test.ts src/setup-app.test.ts -t 'production|throwaway_allocation_refused|a11y'`

Inspect existing production chooser/refusal browser views in EN/ES, light/dark, 390/1280 pixels; these check rendering, not box hardware. No tests ran during authorship. Finish: production setup rejects either forbidden mode before provisioning; normal hook, Claude branch review and current-head selected CI pass before authorised landing. B3 installation remains unfinished.
