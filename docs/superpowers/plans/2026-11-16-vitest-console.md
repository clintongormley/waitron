# Disable Vite browser-console forwarding

**Authority and result.** Lane I `queue.md`, VITEST-SETTINGS follow-up, asks for
`server: { forwardConsole: false }` everywhere browser tests run. The watcher quotes the
owner’s “Turn it off everywhere” in `questions.md`, 16 November 2026, 02:25, and permits
the follow-up PR. This authorises the policy, not this plan. Claude’s read and watcher
clearance precede building. The smallest usable result is disabled Vite forwarding for
every browser project and instance, with the existing guide and backlog brought current.

**Configuration edits.** Re-enumeration with
`rg -l '@vitest/browser-playwright' --glob '*vitest*config*' apps packages`
found the thirteen configs below. Add exactly one `server: { forwardConsole: false },`
line at the indicated Vite level; preserve every unrelated option and comment.

| Files | Placement |
| --- | --- |
| `apps/setup/vitest.config.ts`, `apps/till/vitest.config.ts`, `packages/ui/vitest.config.ts`, `packages/ui-core/vitest.config.ts` | Top level beside `test`. |
| `packages/fiscal-verifactu/vitest.config.ts` | Top level; its browser project already has `extends: true`. |
| `packages/adjustments/vitest.config.ts`, `packages/bookings/vitest.config.ts`, `packages/media/vitest.config.ts`, `packages/payments-stripe/vitest.config.ts`, `packages/payments-sumup/vitest.config.ts`, `packages/staffing/vitest.config.ts`, `packages/venue-service/vitest.config.ts` | Inside the inline browser project, beside its `test`, not inside it. |
| `apps/dashboard/vitest.config.ts` | Verify only; its existing top-level setting and inherited browser/touch projects need no churn. |

Reuse the existing configs and provider/instance declarations. Installed Vitest 4.1.12
`resolveProjects` uses `configFile: false` without `extends: true`
(`node_modules/vitest/dist/chunks/cli-api.B0Pz1_R7.js:11180`). The installed
`@vitest/browser/dist/index.js` `createBrowserServer` reloads that config file and spreads
`project.options.server`. This source inspection supports the placement above; it is not
a runtime check. Keep inheritance unchanged rather than importing unrelated outer options.

**Focused verification, owned by the implementer.** Before editing, use a disposable
Node read/resolve check outside the committed tree with installed `vitest/node`
`createVitest` and Vite `resolveConfig`. Inspect every resolved browser project/instance,
following `createBrowserServer`’s config-file/options merge; do not merely read exported
flags. Record package, project and resolved `server.forwardConsole`. Under agent variables,
the missing settings should resolve enabled; dashboard is the disabled comparison.
After editing, require every browser server to resolve
`{ enabled: false, unhandledErrors: false, logLevels: [] }` under agent variables.
The separate agent-unset run is a comparison, not evidence that the edit works. Close created contexts and keep temporary caches/results outside the tree.
If resolution leaves uncertainty, use only the existing small
`packages/adjustments/src/dashboard/strings.test.ts` browser fixture from an inline project
without `extends: true`, retaining its assertions and reading the actual browser-server setting
as well as the Tests count. No package/workspace suite locally. Normal pre-push checks and selected
current-head PR CI remain the finishing responsibility; do not duplicate them locally.

**Documentation after applying.** In `docs/developers/testing-guide.md`, retain A902’s
14 November receipt and reviewer attribution, replacing only the pending-rollout wording
with the verified scope and placement. Do not claim all Vitest output is silenced.
Remove the completed A902 item from the existing bundle in `docs/backlog/ci.md` and update
its count and `docs/backlog.md` summary. Rename the remaining bundle to
“Vitest settings: remaining measurements”, updating its anchor/link and the guide’s by-name
mention; do not leave the completed console policy in a current heading. Preserve loaded-runner
worker qualifications and the inconclusive/unmeasured optimizer work, including
`docs/backlog/dependencies.md`. Leave the earlier dated plan as historical evidence.

**Size and exclusions.** Expected added/removed lines: production configuration **+12/−0**
(application code **0/0**), tests **0/0**, support **0/0**, docs including this plan
**about +65/−8**. No framework, registry, permanent scanner, subprocess harness, dependency
bump, worker/optimizer sweep, console-fixture sweep or further policy question. Routine
verification details stay with the implementer. This planning turn writes only this file;
it runs no reviews, commits or implementation.
