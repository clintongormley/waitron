# Till keyboard input — design

Status: approved by the owner, 2026-11-21. First of three linked pieces of work (keyboard
input, then the Counter's custom item, then reading scale-label barcodes); see
`docs/handoffs/2026-11-21-keyboard-custom-item-scales.md`.

## Why

A till can be a laptop, a device with a USB keyboard plugged in, or a tablet or handheld that only
has the keyboard drawn by its own system. Today every number the till asks for — a PIN, the cash
handed over, a weight — can only be entered by tapping the till's own number pad
(`apps/till/src/widgets/numeric-pad.ts`). On a laptop or with a USB keyboard that is slow. On a
tablet or handheld, the device's built-in keyboard already opens for text (line notes, bill names,
search, invoice details: about 35 till files use a text field) and nothing in the till adjusts the
screen when it does (a search for `visualViewport`, `interactive-widget` and `virtualKeyboard`
under `apps/till/src` and `apps/till/index.html` found nothing). The Counter's custom item, which
comes next, adds another typed name.

## Approaches considered

- **A. Numbers on the till's own pad, text on the device's keyboard, one layout fix for the whole
  till.** Chosen by the owner, 2026-11-21. The busiest screens (PIN, payment) never jump, because
  the device keyboard never opens on them; text keeps the device keyboard's accents, languages,
  autocorrect and dictation; the layout fix also repairs the existing text fields.
- **B. Draw our own full keyboard everywhere.** Rejected: letter layouts per language, accents, no
  autocorrect or dictation, every existing text field would have to move to it, and it would sit
  unused on a laptop because a web page cannot reliably tell whether a physical keyboard is
  attached.
- **C. The device's keyboard for everything, numbers included.** Rejected: the PIN and payment
  screens would jump each time it opens, the digit layout differs per device, and the big pad that
  is easy to hit during service is lost.

## What gets built

1. **A physical keyboard drives every till number pad.** On the four screens that show the pad —
   the PIN screen (`till-lock-screen.ts`), the supervisor's PIN (`supervisor-override-dialog.ts`),
   cash entry and weight entry (`tender-pay.ts`) — and on the custom item's price when that lands:
   - digits, from the main row or the number block, do what tapping that digit does;
   - Backspace does what ⌫ does;
   - on a money or weight pad, both `.` and `,` do what the decimal key does, whatever the screen's
     language; on a PIN pad they do nothing, as the drawn PIN pad has no decimal key;
   - Enter presses the screen's main button (Log in, Authorize, Confirm payment, Add) only when that
     button is enabled — it never bypasses a disabled button;
   - Escape presses the screen's Cancel or Back.
   The pad stays on screen on every device: nothing hides it when a keyboard is present.
2. **The PIN pad gets a Clear key** (owner, 2026-11-21) in its empty bottom-left space, which
   empties the whole PIN at once; the Delete key does the same. The money and weight pads keep
   their decimal key there and get no Clear key. Wording in English and Spanish; the shortest
   that reads clearly beside ⌫ (for example "Clear" / "Borrar todo") — the builder's call.
3. **Keys reach a pad only when it is the thing in front of the person.** A key is ignored by a
   pad while focus is in a text field (typing a note never feeds a weight), and by a pad that sits
   under an open window.
4. **No text field on the number-pad screens**, so a tablet or handheld never opens its built-in
   keyboard there. That is true today and must stay true.
5. **When a device's built-in keyboard opens, the till fits around it.** The open window or screen
   shrinks to the space left above the keyboard, and the field being typed into stays in view, with
   its window's buttons reachable by scrolling. One fix for the whole till, not per screen.

## Non-goals

- Typing on the Counter or the table screen to search the menu or pick a dish. Possible later; not
  asked for.
- Keyboard shortcuts for other till actions.
- Telling a barcode scanner apart from typing. A USB scanner types like a fast keyboard and ends
  with Enter; the scale-label piece of work handles that. This design must not make it harder:
  route keys through one place in the till rather than a separate listener per screen, so a later
  scanner check has one place to sit.
- Changing the dashboard, which is a desktop app with ordinary form fields.

## Constraints

- The pad stays presentational (it knows nothing of money, weight or PINs) and the parent still
  owns the value; a PIN's leading zeros survive (`nextPinValue`).
- Forms rule and its open question on number pads (`docs/backlog/till.md`, "Other till surfaces
  have not been checked against the forms rule") are unchanged by this work.
- English and Spanish: no new words are expected; if any appear, both languages, and the till
  guide where it describes these screens.

## Left to the builder

- Whether key handling lives in `till-numeric-pad` or in a till-wide key router the pad registers
  with (item 3 and the scanner non-goal point towards the router).
- How item 5 is done (for example the viewport's `interactive-widget=resizes-content` setting on
  Chromium for Android, and the `visualViewport` reading for Safari on iPad and iPhone). It must
  be checked on a real Android device and a real iPad or iPhone, because a desktop browser's device
  emulation draws no built-in keyboard; screenshots of each, both themes, go to the owner.
