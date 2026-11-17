# Till top-bar focus and observer lifecycle

**Status:** Sol high-effort draft, shortened and checked by the Codex driver; awaiting Claude review and watcher plan clearance. No owner design approval claimed.
**Ask:** TILL-TOP-BAR-FIT in Lane H’s `queue.md`; the top-bar bundle in `docs/backlog/till.md`.
**Scope clearance:** The watcher, 2026-11-17 02:03 in Lane H’s `questions.md`: “keep the permanent strip; fix focus and lifecycle only”. The More-overflow direction was withdrawn. Preserve Counter, Floor, Parked, Waiting, Transfers and Pass on their permanent scrolling strip, with name and Help reachable (`design-system.md:6191–6203`).

**Usable result:** The counter’s first control has a complete keyboard focus ring. A handheld removed while a render is queued stops observing its size; reconnecting still fits. Phone/tablet strip overflow remains available for an owner review, not solved here.
**Reuse:** Native/shared outlines, `--wt-*` tokens, real ResizeObserver and the existing shell suites/helpers. No new primitive, dependency, data or navigation mechanism.

## Test-first work

1. In `apps/till/src/widgets/till-shell.keyboard.test.ts`, reproduce the clipped first counter control at 1280×800 with `BUSY_COUNTER`, no logo: one native tab and one zone-menu trigger, in light/dark. Focus the actual button by keyboard and measure its computed outline/offset against every clipping ancestor, particularly `.tabs` and `.till-strip`. The assertion must fail on clipped bounds. In `till-shell.ts`, make the smallest token-based spacing/overflow correction preserving control size, order, scrolling and the existing ring; do not rely on overflow-y visible inside an x scroller or a new clipping API without fallback. Run the same case green and inspect the scroll ends. A visible redesign returns to the watcher.
2. In `apps/till/src/widgets/till-shell.test.ts`, follow the counter’s queued-render test: establish one real host observation, clear the spy, change `operatorName`, remove the handheld and await `updateComplete`; expect zero new host observations. The current reproduction gets one. Add only an `isConnected` guard at the start of `#observe()`; retain teardown and reconnect. Run red, then green, retaining the existing reconnect and counter assertions.

Run named cases with `pnpm --filter @waitron/till exec vitest run <file> -t <name>`; inspect the Tests count and expected failure before implementation. No behavioural assertions are removed.

## Acceptance and records

Use existing `mountEquipmentApp`, normal boot/sign-in and `pageAt`/`page.viewport` for EN/ES, light/dark, 390×844, 1024×768 and 1280×800, 100/130%. Read actual innerWidth; inspect outlines, one row, unchanged control order/scrolling and reachable Help/name/More. Restore viewport, locale and theme styling.

In `docs/backlog/till.md`, remove only the two settled focus/lifecycle bullets and their detail entries; correct its count and the `docs/backlog.md` index. Record the unchanged overflow measurements there for future owner review, without a collapse proposal: at 390, 109 px available versus Counter 178/193 px EN/ES and six controls 674/739; at 1024, 682/747 against 675 at 100%, 785/867 against 650 at 130%; measured 1280 cases fit. These are shared-Mac Chromium measurements on b7e7e5de0d, not box figures. Keep all overflow/owner-decision bullets. No guide change is proposed because staff actions and navigation stay unchanged; verify its existing wording still applies. Temporary probes/screenshots stay outside commits.

**Focused checks:** changed keyboard/main shell suites plus `till-shell.counter-logo.test.ts`, `till-shell.counter-cleanup.test.ts`, `till-shell.handheld-bar.test.ts` and `till-shell.a11y.test.ts` under `apps/till/src/widgets/`. Run the queue’s unchanged gates:
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
- `pnpm --filter @waitron/server exec vitest run src/till-api.sell-published.test.ts`
- `pnpm --filter @waitron/till exec vitest run src/till-app-menu-refresh.test.ts`

Then finish-branch, normal hook, current-head CI and authorised land-branch. No package-wide local run. Expected production +10–35/−0–10 lines, tests +60–120/−0–5, small docs edits separately. At 1.5× stop for the watcher’s outside opinion.
**Excluded:** name width/A921, short-phone More, 320 px tabs, transfer-count refit, slow frame tests/A395 loose assertions, bill height, floor/table/dashboard/kitchen screens, API/data/money/fiscal changes. No till-app.ts change; rebase over #3601 if it lands first.
