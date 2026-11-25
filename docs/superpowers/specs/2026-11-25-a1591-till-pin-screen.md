# A1591: the till's PIN screen on a phone

Status: approved by the owner on 2026-11-25, ready to build. No mock-up was made: the owner chose
the fixes from a critique and asked for the build to be queued.

## Why

The owner, on their phone (2026-11-25): "i find the buttons too small on the mobile, the whole
thing could be taller. also error messages are written in a bar at the top which pushes the
keyboard down, then if you start typing again the keyboard jumps back up as the error bar clears".

What the critique found, from the owner's screenshot (a phone about 363 by 735 CSS pixels for the
page) and the code on `main` at 42b62f3565:

- Each key is about 110 by 44 CSS pixels with 14-pixel digits (`wt-button`'s default `md` size,
  `--wt-tap-min`). The keypad is about 200 pixels tall, and about 262 pixels (36% of the page)
  sit empty below Log in.
- `#renderPin` in `apps/till/src/screens/till-lock-screen.ts` inserts the wait message, the
  "Loading…" line or the error bar between `.pin-display` and `.pad-wrap`. Each one pushes the
  keypad down (by about 44 pixels for the bars, about 28 for "Loading…", worked out from the CSS,
  not measured on a device). `#onPadChange` clears the error on the first key press, so the
  keypad moves back up while the person is typing.
- The heading is the device's name (`#renderHeading` draws `deviceName`), and the person whose
  PIN is asked for is small grey text (`.operator`). In the screenshot, "Clint" was the device and
  "Rehearsal Foo" the person.
- The wait after too many wrong PINs shows only "Try again in {n}s" (`login.throttled`), as a
  `role="alert"` that is rebuilt every second. The explaining sentence `pin.throttled` ("Too many
  wrong PINs. Wait a moment, then try again") exists and this screen does not use it. Waits start
  at the fourth wrong PIN (2 seconds, doubling to 60; `packages/identity/src/pin-throttle.ts`).
- Log in can be pressed after one digit although `MIN_PIN_LENGTH` is 4
  (`packages/identity/src/verify-pin.ts`).

## Decisions (owner, 2026-11-25)

The owner chose "all four" fixes, "shared keypad" and "in the dots line", then said "go" to the
plan below.

1. **One status line of fixed height replaces `.pin-display` and the three conditional lines.** It
   shows, in the same place: "Enter your PIN" (muted) while nothing is typed; the dots while
   typing; "Logging in…" while the request runs; "Wrong PIN, try again" (or the other login error)
   in the danger text colour; during a wait, the `pin.throttled` sentence with the countdown. Its
   height is reserved for two lines, through a new token, so a Spanish message or a raised venue
   text size does not move the keypad. Nothing above the keypad changes height in any state.
   The error stays until the next key press, as now; clearing it changes only that line.
2. **Bigger keys, in the shared keypad.** `apps/till/src/widgets/numeric-pad.ts` rows grow with the
   screen's height (a `clamp()` between about 62 and 88 pixels, around `9dvh`; about 66 pixels on
   the owner's phone), each key fills its row, and the digits are larger (`--wt-font-size-xl` or
   the till's headline size). The payment keypad and the manager-override PIN pad
   (`supervisor-override-dialog.ts`) get the same keys; check both at phone width.
3. **The keypad sits at the bottom.** On the full-screen login, the keypad and the Cancel / Log in
   row are pinned to the bottom of the page, where a thumb reaches, and the two buttons use
   `size="lg"`. The compact kitchen-screen login (`compact`, capped at `45dvh`) keeps its current
   placement: it must not stretch to the page.
4. **The person is the heading.** The person's name is the `<h1>`. The device name moves to a small
   muted line or leaves the PIN step. Cancel reads "Not {name}?" and still returns to the list.
5. **The wait explains itself and is announced once.** The `pin.throttled` sentence carries the
   meaning; the ticking number is hidden from screen readers, and the line is a polite status, not
   an alert re-announced every second.
6. **Log in stays unpressable until 4 digits are typed.** Take the 4 from the shared constant, not a
   literal in the till.
7. **"Loading…" on this screen becomes "Logging in…"**, in the status line only; it is not repeated
   beside Log in's own spinner.

Spanish strings come with every new English one. The Spanish "Clear" key ("Borrar todo") must fit
on one line in its key at phone width; it is estimated, not measured, to wrap today.

## Done when

- Screenshots in the PR, at about 363 by 735 and on a tablet size, both themes, English and
  Spanish: nothing typed, digits typed, logging in, wrong PIN, a wait running. The keypad's top
  edge is at the same height in every state.
- The payment keypad and the override PIN pad shown at phone width.
- The till guide, English and Spanish, still matches the screen; change it only where it describes
  the heading, the keypad or Cancel.
