# Till keyboard input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A laptop or USB keyboard types into every till number pad (PIN, supervisor PIN, cash,
weight); the PIN pad gains a Clear key; when a tablet's or handheld's own keyboard opens for text,
the till fits into the space above it.

**Architecture:** One till-wide key router (`apps/till/src/state/pad-keys.ts`) listens on the
document, picks the one number pad in front of the person (connected, visible, not inert, not
under an open window or popup), maps the key, and hands it to that pad. The pad turns it into the
same `wt-change` a tap makes, or into `pad-enter` / `pad-escape`, which each screen answers by
clicking its own main or Cancel button only if that button is enabled and not busy. The device-
keyboard fix starts with one viewport setting and a check on real devices; anything more is built
only if a device shows it is needed.

**Tech Stack:** Lit web components, TypeScript, Vitest browser mode (Chromium), `vitest/browser`'s
`userEvent`.

**Spec:** `docs/superpowers/specs/2026-11-21-till-keyboard-input-design.md`

## Global Constraints

- Numbers stay on the till's own pad; text keeps the device's built-in keyboard (owner, approach A).
- The pad stays on screen on every device; nothing hides it when a keyboard is present.
- No text field on the number-pad screens (PIN, supervisor PIN, cash, weight).
- Enter presses the screen's main button only when that button is enabled; it never bypasses a
  disabled button.
- On a money or weight pad both `.` and `,` are the decimal key whatever the language; on a PIN pad
  they do nothing.
- The PIN pad's Clear key sits in its empty bottom-left space and empties the PIN; the Delete key
  does the same. Copy: English `Clear`, Spanish `Borrar todo` (Spanish `Borrar` is already
  backspace's name, `apps/till/src/i18n/strings.ts:2885`).
- A PIN's leading zeros survive (`nextPinValue`).
- Keys reach pads through one listener in the till, so the later scale-label work can tell a
  scanner apart from typing there.
- New CSS reads declared tokens only (`scripts/style-token-names.test.ts`,
  `scripts/no-hardcoded-chrome-views.test.ts`, `packages/ui/src/no-hardcoded-chrome.test.ts`).
- Every implementer's verify step runs format check on its changed files:
  `pnpm exec prettier --check <files>`.
- Tests: run `pnpm --filter <pkg> exec vitest run <file>`; read the `Tests` count, not the exit
  status. To run one case use `exec vitest run <file> -t "<name>"`, never `pnpm test <file> -t`
  (pnpm drops the `-t`).
- **Reading of the spec for the supervisor window:** the spec's "Escape presses the screen's Cancel
  or Back" is met there by the window's own Escape, which closes it as Cancel does today. Escape is
  not rebound to its Back button.

## Review Focus

1. **Enter right after tapping something.** After tapping a pad key, Enter submits and does not
   type that digit again; after tapping a weighed product's tile in the menu, Enter adds the weight
   and does not pick the product again. Tests in Task 3 and Task 4.
2. **A pad that cannot be tapped takes no keys:** one under an open window or popup, one inside an
   inert part of the screen (the lock screen while sign-in is throttled, `till-lock-screen.ts:558`;
   the menu browser while an order is sending, `till-table-order-screen.ts:3083`). Tests in Task 3.
3. **Keyboards that need Shift for digits** (French AZERTY sends `key: "1"` with `shiftKey: true`)
   still type digits; the number block types digits. Tests in Task 2.
4. **Holding a key down.** A held digit types once; a held Backspace keeps deleting. Test in Task 3.
5. **Typing keeps the till awake.** Key presses with nothing focused count as activity for the idle
   sign-out and help-off timers, as taps do. Test in Task 4.

---

### Task 1: The PIN pad's Clear key

**Files:**
- Modify: `apps/till/src/widgets/numeric-pad.ts` (`nextPinValue`, `#keys` pin list, `#renderKey`)
- Modify: `apps/till/src/i18n/strings.ts` (English and Spanish tables)
- Test: `apps/till/src/widgets/numeric-pad.test.ts`, `apps/till/src/widgets/numeric-pad.a11y.test.ts`

**Interfaces:**
- Produces: pad key id `"clear"` (pin mode only); `nextPinValue(value, "clear") === ""`; string key
  `"pad.clear"`.

- [ ] **Step 1: Write the failing tests** in `numeric-pad.test.ts`:
  - `nextPinValue("0123", "clear")` → `""`.
  - Change "renders keys in phone-dialpad order (1-2-3 on top) in pin mode" to expect
    `["1","2","3","4","5","6","7","8","9","clear","0","backspace"]` (the owner's 2026-11-21
    decision replaces the empty space).
  - "pressing Clear in pin mode emits an empty value": mount `{ value: "0123", mode: "pin" }`,
    click `[data-key="clear"]`, expect `wt-change` detail `{ value: "" }`.
  - "decimal mode has no Clear key": `[data-key="clear"]` is `null` with no `mode`.
  - "Clear is named in Spanish": `setLocale("es")`, pin mode, the Clear key's text contains
    `Borrar todo`; restore `setLocale("en")`.
  - In `numeric-pad.a11y.test.ts`, add a pin-mode case with a partly entered PIN, both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/numeric-pad.test.ts src/widgets/numeric-pad.a11y.test.ts` — expect the new cases to FAIL.
- [ ] **Step 3: Implement.** `nextPinValue` returns `""` for `"clear"`. The pin list's spacer
  `{ key: "", glyph: "" }` becomes `{ key: "clear", glyph: t("pad.clear") }`; delete the now-unused
  spacer branch in `#renderKey`. Add `"pad.clear": "Clear"` and `"pad.clear": "Borrar todo"`.
- [ ] **Step 4: Run** the same command — all PASS; then `pnpm --filter @waitron/till typecheck` and
  prettier on the changed files.
- [ ] **Step 5: Commit** `git commit -s -m "Till: a Clear key on the PIN pad"`.

---

### Task 2: What a key means, and what is in front

> **As built (2026-11-21, finish-branch review):** a held key's repeats are dropped in `routeKey`
> (`apps/till/src/state/pad-keys.ts`) after the same ownership checks, not by `padInputFor`;
> `surfaceOutside` leaves out the dialogs of windows `modal-layer.ts` tracks, whose order
> `underModal` decides; `inInertTree` lives in `packages/ui/src/tabbable.ts`.

**Files:**
- Modify: `packages/ui/src/modal-layer.ts`; move `composedContains`, `composedParent` (as used by
  it) and `openSurfaces` there from `packages/ui/src/components/wt-dialog.ts:17-34`, which then
  imports them.
- Modify: `packages/ui/src/index.ts` (exports below)
- Test: `packages/ui/src/modal-layer.test.ts`
- Create: `apps/till/src/state/pad-keys.ts` (this task: `PadInput`, `padInputFor` only)
- Test: `apps/till/src/state/pad-keys.test.ts`

**Interfaces:**
- Produces (in `@waitron/ui`):
  - `underModal(node: Node): boolean` (existing, now exported)
  - `modalOpen(): boolean` — `true` while any modal is recorded open.
  - `inInertTree(node: Node): boolean` — `true` when `node` or any ancestor across shadow roots and
    slots (the same walk as `underModal`'s `flatParent`) has the `inert` property set.
  - `surfaceOutside(node: Node): boolean` — `true` when some open popover or modal `<dialog>` (from
    `openSurfaces(document)`) does not contain `node` (`composedContains`).
- Produces (in `pad-keys.ts`):
  - `type PadInput = { kind: "key"; key: string } | { kind: "enter" } | { kind: "escape" }`
  - `padInputFor(event: KeyboardEvent, mode: "decimal" | "pin"): PadInput | null`

- [ ] **Step 1: Write failing tests** in `modal-layer.test.ts`:
  - `modalOpen`: `false` with nothing open; `true` after `modalOpened(el, 1)`; `false` after
    `modalClosed(el)`.
  - `inInertTree`: an element inside an `inert` div → `true`; inside a shadow root whose host's
    ancestor is `inert` → `true`; a slotted child of an inert slot's host chain → `true`; no inert
    ancestor → `false`.
  - `surfaceOutside`: nothing open → `false`; an open `popover` elsewhere → `true`; an open popover
    that contains the node → `false`; an open modal `<dialog>` inside a shadow root, not holding
    the node → `true`.
  - Every existing `wt-dialog` test still passes after the move (run in Step 4).
- [ ] **Step 2: Write failing tests for `padInputFor`** in `pad-keys.test.ts`, building real
  `new KeyboardEvent("keydown", { … })` objects:
  - `"0"`–`"9"` → `{ kind: "key", key: <digit> }` in both modes; also with `shiftKey: true`
    (AZERTY) and with `code: "Numpad7"` (number block).
  - `"Backspace"` → key `"backspace"`, also when `repeat: true`.
  - A digit with `repeat: true` → `null`.
  - `"."` and `","` → key `"."` in decimal mode; `null` in pin mode.
  - `"Delete"` → key `"clear"` in pin mode; `null` in decimal mode.
  - `"Enter"` → `{ kind: "enter" }`; with `repeat: true` → `null`. `"Escape"` → `{ kind: "escape" }`.
  - Any key with `ctrlKey`, `metaKey` or `altKey` → `null`; `isComposing: true` or `keyCode: 229` →
    `null` (through `belongsToComposition` from `@waitron/ui`).
  - `"a"`, `"End"`, `"Tab"` → `null`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/ui exec vitest run src/modal-layer.test.ts` and
  `pnpm --filter @waitron/till exec vitest run src/state/pad-keys.test.ts` — expect FAIL.
- [ ] **Step 4: Implement**, then run Step 3's commands plus
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-dialog` — all PASS; both packages'
  typecheck; prettier on changed files.
- [ ] **Step 5: Commit** `git commit -s -m "Till: what a key means on a number pad, and which windows are in front"`.

---

### Task 3: The router hands keys to the pad in front

**Files:**
- Modify: `apps/till/src/state/pad-keys.ts` (add the router and `pressIfEnabled`)
- Modify: `apps/till/src/widgets/numeric-pad.ts` (register while connected; `receiveKey`; move to
  front on `pointerdown`)
- Test: `apps/till/src/widgets/numeric-pad.keyboard.test.ts`

**Interfaces:**
- Consumes: Task 1's `"clear"`; Task 2's `PadInput`, `padInputFor`, `underModal`, `modalOpen`,
  `inInertTree`, `surfaceOutside`.
- Produces (in `pad-keys.ts`):
  - `interface PadKeyTarget extends HTMLElement { mode: "decimal" | "pin"; receiveKey(input: PadInput, event: KeyboardEvent): void }`
  - `registerPad(pad: PadKeyTarget): () => void` — returns the unregister function.
  - `bringPadToFront(pad: PadKeyTarget): void` — moves a registered pad to the end of the order.
  - `pressIfEnabled(button: HTMLElement | null): void` — clicks `button` unless it is `null`, or has
    `disabled === true` or `loading === true` (`wt-button`'s own busy flag, `wt-button.ts:169-174`).
- Produces (pad events, app-owned so plainly named): `pad-enter` and `pad-escape`, `CustomEvent`
  with `bubbles: true, composed: true`, no detail.

Router rule, on each document `keydown` (one bubbling listener, added with the first pad and
removed with the last), in this order:
1. return if `event.defaultPrevented`;
2. return if `event.composedPath()` holds an `HTMLInputElement`, `HTMLTextAreaElement`,
   `HTMLSelectElement` or an element with `isContentEditable`;
3. the target pad is the LAST in the order that `isConnected`, is visible (`checkVisibility()`
   where the browser has it, otherwise `getClientRects().length > 0`), `!inInertTree(pad)` and
   `!underModal(pad)`; none → return;
4. `input = padInputFor(event, pad.mode)`; `null` → return;
5. return if `surfaceOutside(pad)` (an open popup or window the pad is not in gets the key —
   Escape then closes it as it does today). This walks the page, so it runs only here, after a
   key has mapped; time it on the table screen with a full menu and put the figure in the PR;
6. for `enter`: return if `composedPath()[0]` is a `button`, `a[href]` or `[role="button"]` element
   inside the pad's own screen — `pad.getRootNode()` is in `composedPath()` — and not inside the
   pad (so a focused Cancel beside the pad keeps its Enter; a product tile in another component
   does not);
7. for `escape`: return if `modalOpen()` (rule 3 already dropped a pad under a window, so the
   pad is inside the open one) — that window's own Escape handling closes it;
8. `event.preventDefault()` (this also stops the browser activating a focused pad key on Enter),
   then `pad.receiveKey(input, event)`.

- [ ] **Step 1: Write failing browser tests** in `numeric-pad.keyboard.test.ts`, typing with
  `userEvent.keyboard` (and `userEvent.click` to move focus; with nothing focused, as
  `packages/ui/src/components/wt-dialog.test.ts:1963` does), each asserting the `wt-change` values,
  `pad-enter` / `pad-escape` counts, or that nothing was emitted:
  - "typing digits with nothing focused emits each value": a decimal pad whose `value` the test
    sets from each event; `"12,5"` yields `"1"`, `"12"`, `"12."`, `"12.5"`.
  - "pin pad: Delete clears, comma does nothing".
  - "ignores keys while a text field has focus": a `wt-input` mounted beside the pad, focused.
  - "ignores keys while an open wt-dialog does not hold the pad" and "delivers to a pad inside the
    open wt-dialog".
  - "ignores keys while an open popover does not hold the pad, and Escape closes the popover".
  - "ignores keys for a pad inside an `inert` container" (Review Focus 2).
  - "the later visible pad receives keys; a hidden later pad does not" (`display: none`); "tapping
    the earlier pad brings it to the front".
  - "Enter after tapping a pad key fires pad-enter and types nothing" (Review Focus 1).
  - "Enter while a button in the pad's own screen has focus is left to that button": pad and a
    `wt-button` inside the same test host's shadow root; the button's click fires, no `pad-enter`.
  - "Enter while a button in another component has focus goes to the pad".
  - "Escape for a pad inside an open wt-dialog is left to the window": the pad is INSIDE the
    dialog (a pad under it is already dropped by rule 3, so that would not test rule 7);
    `pad-escape` not fired; the dialog closes.
  - "Escape with no window open fires pad-escape".
  - "held digit types once, held Backspace repeats" (`{5>3}` repeat syntax; Review Focus 4).
  - "Ctrl+1 and Meta+R type nothing".
  - "stops listening once the last pad leaves": spy on `document.removeEventListener`, assert it
    was called with `"keydown"` and the router's own handler (wt-dialog removes listeners too).
  - `pressIfEnabled`: clicks an enabled `wt-button`; not a disabled one; not a `loading` one; not
    `null`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/numeric-pad.keyboard.test.ts` — expect FAIL.
- [ ] **Step 3: Implement the router** in `pad-keys.ts` by the rule above.
- [ ] **Step 4: Implement in `numeric-pad.ts`:** `connectedCallback` calls `registerPad(this)` and
  keeps the unregister function; `disconnectedCallback` calls it; a `pointerdown` on the pad calls
  `bringPadToFront(this)`. `receiveKey`: a `key` input goes through the existing
  `#press(key, event)`; `enter` / `escape` dispatch `pad-enter` / `pad-escape`.
- [ ] **Step 5: Run** Step 2's command and the whole of `src/widgets/numeric-pad*.test.ts` — all
  PASS; typecheck; prettier on changed files.
- [ ] **Step 6: Commit** `git commit -s -m "Till: a keyboard types into the number pad in front"`.

---

### Task 4: The four pad screens answer Enter and Escape; typing counts as activity

**Files:**
- Modify: `apps/till/src/screens/till-lock-screen.ts:559-575`
- Modify: `apps/till/src/widgets/supervisor-override-dialog.ts:229-246`
- Modify: `apps/till/src/widgets/tender-pay.ts:1547-1563` (paying) and `:1583-1600` (weighing)
- Modify: `apps/till/src/till-app.ts:3110-3112, 3174` and `apps/till/src/state/help-idle.ts:39, 46`
  (hear `keydown` on the document instead of the app element; `pointerdown` unchanged)
- Test: `apps/till/src/screens/till-lock-screen.test.ts` (reuse `stubApi`, `flush`, `type`),
  `apps/till/src/widgets/supervisor-override-dialog.test.ts` (reuse `mount`, `pick`, `typePin`),
  `apps/till/src/widgets/tender-pay.test.ts` (reuse its `type`, `press`),
  `apps/till/src/widgets/menu-browser.test.ts` (the weighed-tile case),
  `apps/till/src/state/help-idle.test.ts` and the till-app idle test that covers `#onInteraction`

**Interfaces:**
- Consumes: `pad-enter`, `pad-escape`, `pressIfEnabled` from Task 3.

Each `<till-numeric-pad>` gets `@pad-enter=${() => pressIfEnabled(<main button>)}` and, except in
the supervisor window (see Global Constraints), `@pad-escape=${() => pressIfEnabled(<cancel>)}`,
the buttons found in the component's own render root: lock screen `.submit` / `.cancel`;
supervisor `.authorize`; paying `.confirm` / `.cancel`; weighing `.add` / `.cancel`. Clicking the
real button keeps each button's own guards (the lock screen's `#submit` checks, Confirm payment's
quiet-tap explanation).

- [ ] **Step 1: Write the failing tests**, typing with `userEvent.keyboard`:
  - Lock screen: after picking a person, typing `0123` then Enter calls the login API once with
    `"0123"`; Enter with no PIN calls nothing; Escape returns to the person picker; Delete empties
    the PIN dots. "Enter twice quickly sends one login": the stubbed login stays PENDING (an
    unresolved promise) until after the second Enter, then resolves; exactly one call.
  - Lock screen while throttled: typing changes nothing (Review Focus 2).
  - Supervisor window: typing a PIN and Enter authorizes with it; Enter with no PIN does nothing;
    Escape still closes the window (unchanged behaviour, pinned here).
  - Tender-pay paying, in Spanish: typing `20,5` shows the Spanish amount for 20.5; Enter while
    short of the total does not confirm; Enter with enough confirms once; Escape asks to cancel as
    the Cancel button does.
  - Tender-pay weighing: typing `0.25` then Enter adds 0.25 of the product; Enter with `0` adds
    nothing.
  - Menu browser: click a weighed product's tile, type `0.25`, press Enter — 0.25 is added and the
    product is not picked again (Review Focus 1).
  - Menu browser inside an order that is sending (inert): typing does not change the weight.
  - Each of the four screens renders no `input`, `textarea` or `select` in its render root while its
    pad shows (spec item 4).
  - Idle: with nothing focused, a key press resets the till's idle timer and help's idle timer, as
    a tap does (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run` on the test files listed above
  — new cases FAIL.
- [ ] **Step 3: Implement** the bindings and the two listener moves.
- [ ] **Step 4: Run** Step 2's command plus each changed widget's `*.a11y.test.ts` and
  `*.unsaved.test.ts` siblings — all PASS; typecheck; prettier on changed files.
- [ ] **Step 5: Commit** `git commit -s -m "Till: Enter and Escape work the PIN, cash and weight screens"`.

---

### Task 5: The till fits above a device's built-in keyboard

> **As built (2026-11-22, landscape fix):** the Pixel tablet failed in landscape, so Step 3 was
> built: `apps/till/src/state/keyboard-inset.ts` sets `--wt-keyboard-inset` and
> `--wt-keyboard-top`; `wt-dialog` and `wt-modal` fit between them, with top and bottom margins
> that shrink to `--wt-space-2` (a `full` modal's side margin when smaller). `apps/till/src/main.ts`
> starts the watcher, which also scrolls the field being typed in back into view after the visible
> area changes height. Tests are in `packages/ui/src/components/wt-dialog.keyboard-inset.test.ts`,
> `apps/till/src/state/keyboard-inset.test.ts`, `apps/till/src/main.keyboard-inset.test.ts` and
> `apps/till/src/widgets/modifier-picker.keyboard-inset.test.ts`. The unit tests' readings are
> estimated from the owner's screenshots, as no remote-inspection reading was taken. This task did
> not change `index.html`'s body height or `till-app.ts`. The re-check on the tablet is in
> `docs/backlog.md`.

The reviewer found the full fix (measure the keyboard, shrink the page and every window) touches
`wt-dialog` and `wt-modal` (`packages/ui/src/components/wt-modal.ts:19-20, 41-42` sets its own
`100dvh` height), which the dashboard shares, and that how Safari reports the keyboard is
unverified (and cannot be checked here: no Apple device). So this task starts with the one-line setting and a device check, and the rest is
built only for what the devices show.

**Files:**
- Modify: `apps/till/index.html` (viewport meta)
- Then, only if Step 2 shows a problem: create `apps/till/src/state/keyboard-inset.ts` + test,
  modify `apps/till/index.html` (body height), `apps/till/src/till-app.ts`,
  `packages/ui/src/components/wt-dialog.ts`, `packages/ui/src/components/wt-modal.ts`.

- [ ] **Step 1: Add `interactive-widget=resizes-content`** to the till's viewport meta; commit
  `git commit -s -m "Till: ask Android to shrink the page when its keyboard opens"`.
- [ ] **Step 2 (driver, not an implementer): check on real devices.** Desktop device emulation
  draws no built-in keyboard, so only a device proves this. Open the branch's till on the owner's
  Android phone and Android tablet (the owner has no Apple device, 2026-11-21, so Safari on iPad
  and iPhone stays untested; the PR says so). On each, in light and dark: a line note on the
  Counter, the bill name window, and Find a bill's search. Pass: with the keyboard open, the field
  being typed into is visible and the window's buttons can be reached by scrolling. Screenshot
  each, show the owner, and write down per device what moved (did the page shrink, did the window
  move, what `visualViewport.height` and `offsetTop` read with the keyboard open, read through
  remote inspection). If every case passes, the task ends here.
- [ ] **Step 3 (only for a failing device): write the fix to fit what Step 2 recorded.** Fixed
  points, whatever the measurements:
  - the variable is `--wt-keyboard-inset`, declared with a `0px` default in a stylesheet so
    `scripts/style-token-names.test.ts` sees it (no unprefixed name);
  - the till sets it from `visualViewport`; the dashboard never does, so it stays `0px` there;
  - `wt-dialog` and `wt-modal` both subtract it from their height AND move their bottom edge up by
    it (a centred modal capped in height alone still sits half under the keyboard); any margin is a
    spacing token, not the browser's `6px + 2em`, and the PR says that dashboard windows change
    height by that difference;
  - tests: setting the variable shrinks a `wt-dialog` and a `wt-modal` and keeps the footer inside
    the visible area (`wt-dialog.scroll.test.ts`, the `wt-modal` tests); the inset calculation's
    unit tests use the readings recorded in Step 2.
  Run those tests, `packages/ui/src/no-hardcoded-chrome.test.ts`, and from the root
  `pnpm vitest run scripts/style-token-names.test.ts scripts/no-hardcoded-chrome-views.test.ts`;
  repeat Step 2 on the failing device; commit.

---

## Out of this plan

- Typing on the Counter or table screen to search or pick a dish; other shortcuts; the dashboard.
- Telling a barcode scanner apart from typing (the scale-label work, which builds on Task 3's
  single listener).
- The open forms-rule question for number pads (`docs/backlog/till.md`).
- The till guide: no section describes the number pad today, and typing with a keyboard does not
  change what staff do on screen, so no guide sentence is added.
