# A1315 server-page help audit

**Status: pending.** One Claude read and watcher approval are required before implementation. Publication is not authorised. The owner’s 2026-11-10 instruction says, “The owner authorises finish-branch and land-branch.” That applies after the gate. The native driver executes inline; no further agents are needed.

**Goal:** make the remaining-work list honest. Apply [the orientation rule](../../developers/conventions-ui.md#a-help-bubble-orients) only to actual help bubbles in English and Spanish, preserving instructions people need to act.

## Audit finding

At base `16b56e109d91c8aa434540be0217917844357344`, the driver's tracked-source search found no `wt-help-tooltip`, `role=tooltip`, `popover`, `data-help`, `help-mode` or `title=` matches in `apps/server/src`, excluding tests, testing helpers and guide Markdown. Repeating its recorded command in this checkout returned exit 1 with no matches or stderr.

- `apps/server/src/trust-page.ts:53` and `apps/server/src/connection-bootstrap-page.ts:82` render certificate removal/installation tasks inside `<details>`; retain those instructions.

- `apps/server/src/recovery-surface.ts:226`, `apps/server/src/recovery-start-again.ts:75`, `apps/server/src/carry-on.ts:140`, `apps/server/src/waiting-page.ts:73`, `apps/server/src/restricted-page.ts:126` and `apps/server/src/spare-read-gate.ts:15` contain direct status, action or refusal instructions.

- `apps/server/src/setup-api.ts:223` is a finish-setup placeholder; `apps/server/src/guide-pages.ts:184` renders full guide content. Printed invoice/test pages are paper outputs, outside browser help.

The supplied Chromium audit records 90 rendered variants: trust/connection device variants, EN/ES waiting, spare, fresh recovery and secure/insecure Start again. It reports zero matching help controls or “?” buttons; injected markup matches all five chosen selector cases. This is bounded evidence, not exhaustive route/state coverage. No product bubble needing cuts has been identified. Receipts remain outside the checkout at `/Users/clintongormley/waitron-campaign-k/receipts/a1315-server-20261110/`: `source-checks.json`, `source-*.txt`, `render-results.json` and `render.log`.

## Proposed execution scope

- [ ] Obtain one completed Claude read through `~/workspace/tools/claude-seat.sh review-branch`, then present **PLAN FOR APPROVAL** to the watcher. Keep the candidate fixed during the read.

- [ ] After acceptance, edit only `docs/backlog.md` and `docs/backlog/dashboard.md`: remove the server-page remainder; retain the explicit till Transfers last-sentence owner choice, the missing guide destinations and existing A1247 work. An overlooked actual bubble must be named and referred to the driver before expanding scope.

- [ ] Run `git diff --check`; repeat the command in `source-checks.json`; verify only the rule anchor and affected backlog links. Inspect the diff for preserved remaining work.

- [ ] Expected diff: production 0, tests 0, generated 0; this plan approximately +25–40 lines, backlog approximately +3/−10. No copy change means no EN/ES before-after table, changed tests or visual regression claim. Add no report system, guard, helper or fixture.

- [ ] After watcher approval, use the docs-only landing path under H11 lock, with signed-off commit and authorised finish/land handling. No tiny PR for a measurement. Finish with the honest remaining-work list; this adds no user functionality.
