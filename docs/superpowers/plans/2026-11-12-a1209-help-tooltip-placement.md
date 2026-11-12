# A1209: Help tooltip placement

Author: Codex Sol high; separate Lane D plan author.
Status: pending Claude review and watcher clearance; no owner approval of this design.
Do not implement before both gates.

## Request and smallest outcome

Queue A1209: "when there is no room below, the tooltip slides up over it instead of opening above; on a phone it covers the till's Order bar."
Recorded in `docs/backlog.md` and `docs/backlog/till.md`, A1209.
Open above the badge when below cannot fit and above can, leaving the badge clear.

## Existing path and scope

`packages/ui/src/components/wt-help-tooltip.ts:192` clamps the below position upward.
Its sole caller is `onTriggerClick`, synchronously after `showPopover()`.
Keep that timing, the 4px gap and 8px viewport margin.
Prefer below when it fits; otherwise choose above when it fits.
Retain the existing vertical fallback when neither side fits, and horizontal clamping.
No resize listeners, observers, live positioning, guide text, framework or new helpers.

## Build after clearance

1. In `packages/ui/src/components/wt-help-tooltip.test.ts`, replace
   "lifts a bottom-anchored tooltip back inside the viewport" with
   "opens above when below cannot fit".
   Reuse `mount`, `cleanup`, `userEvent.click` and real popup rectangles.
   Wait for final content/fonts, then assert measured room above, insufficient room below,
   `popup.bottom ≈ trigger.top - 4`, and the 8px viewport margin.
   Give above generous headroom for CI fonts, including wrapped text and a guide link.
   Retain existing below-placement and left/right-clamp behavioural assertions.
2. Red: `pnpm --filter @waitron/ui test src/components/wt-help-tooltip.test.ts -t 'opens above when below cannot fit'`.
   Confirm failure at the above-placement assertion.
3. Change only `positionTooltip`'s vertical choice. Green: repeat that command, then
   `pnpm --filter @waitron/ui test src/components/wt-help-tooltip`.
   Confirm nonzero passing test counts.
4. Using the existing demo till, visually inspect Order-bar help in EN/ES,
   light/dark, at 1280×900 and 390×844. Check badge/bar clearance and wrapping.
   Keep screenshots uncommitted.
5. Remove A1209 from `docs/backlog.md` and its section in `docs/backlog/till.md`.

## Expected size

Production: 8–15 changed lines, one component.
Tests: 32–65 changed lines, existing test file; combined target 40–80.
Support: two backlog removals and this plan; no helper changes.
