# A1315 server-page help audit

**Status: approved.** The watcher approved this docs-only closure on 2026-11-10 at 02:27 after the completed Claude read and its corrections: “Publish the docs-only closure as asked (both backlog corrections, keep the Transfers owner choice and the missing-guide work).” The owner’s 2026-11-10 instruction authorises finish-branch and land-branch. The native driver executes inline; no further agents are needed.

**Goal:** make the remaining-work list honest. Apply [the orientation rule](../../developers/conventions-ui.md#a-help-bubble-orients) only to actual help bubbles in English and Spanish, preserving instructions people need to act.

## Audit finding

At base `16b56e109d91c8aa434540be0217917844357344`, the driver's tracked-source search found no `wt-help-tooltip`, `role=tooltip`, `popover`, `data-help`, `help-mode` or `title=` matches in `apps/server/src`, excluding tests, testing helpers and guide Markdown. Repeating its recorded command in this checkout returned exit 1 with no matches or stderr.

- `apps/server/src/trust-page.ts:53,68` and `apps/server/src/connection-bootstrap-page.ts:82` render certificate removal/installation tasks inside `<details>`; retain those instructions.

- `apps/server/src/connection-bootstrap-strings.ts:24-33,62-72` supplies `choiceHelp`, `retainedHelp`, `newTrustHelp`, `downloadHelp` and the installation heading. At `connection-bootstrap-page.ts:176-182` these are inline instructions for the displayed certificate/action choices, so keep them. The control search does not classify their wording.

- `apps/server/src/recovery-surface.ts:226`, `apps/server/src/recovery-start-again.ts:75`, `apps/server/src/carry-on.ts:140`, `apps/server/src/waiting-page.ts:73`, `apps/server/src/restricted-page.ts:127` and `apps/server/src/spare-read-gate.ts:15` contain direct status, action or refusal instructions.

- `apps/server/src/setup-api.ts:223` is a finish-setup placeholder; `apps/server/src/guide-pages.ts:184` renders full guide content. Printed invoice/test pages are paper outputs, outside browser help.

The supplied Chromium audit records 90 rendered variants: trust/connection device variants, EN/ES waiting, spare, fresh recovery and secure/insecure Start again. It reports zero matching help controls or “?” buttons; injected markup matches all five chosen selector cases. This is bounded evidence. Restricted/successor and failure pages, the carry-on form, non-fresh recovery, full guides/not-found and the setup placeholder were read in source only. No product bubble needing cuts has been identified. Receipts remain outside the checkout at `/Users/clintongormley/waitron-campaign-k/receipts/a1315-server-20261110/`: `source-checks.json`, `source-*.txt`, `render-results.json` and `render.log`.

## Proposed execution scope

- [ ] Obtain one completed Claude read through `~/workspace/tools/claude-seat.sh review-branch`, then present **PLAN FOR APPROVAL** to the watcher. Keep the candidate fixed during the read.

- [ ] After acceptance, edit only `docs/backlog.md` and `docs/backlog/dashboard.md`: remove the server-page remainder and its completed-area history, leaving the open work; retain the explicit till Transfers last-sentence owner choice, the missing guide destinations and existing A1247 work. An overlooked actual bubble must be named and referred to the driver before expanding scope.

- [ ] Run `git diff --check`; repeat the command in `source-checks.json`; verify only the rule anchor and affected backlog links. Inspect the diff for preserved remaining work.

- [ ] Expected diff: production 0, tests 0, generated 0; this plan approximately +25–40 lines, backlog approximately +3/−10. No copy change means no EN/ES before-after table, changed tests or visual regression claim. Add no report system, guard, helper or fixture.

- [ ] After watcher approval, use the docs-only landing path under H11 lock, with signed-off commit and authorised finish/land handling. No tiny PR for a measurement. Finish with the honest remaining-work list; this adds no user functionality.
