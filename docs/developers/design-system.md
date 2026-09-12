# Design system

Every screen in this project is built from `wt-*` primitives styled by `--wt-*` tokens.
This document is the contract. If you are building a view, read this first.

## The rule

**No hardcoded chrome.** No hex colours, no `rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/
`oklch()`/`color-mix()` colours, no named colours (`red`, `blue`, …), no font sizes, no radii, no
px spacing above `1`, and no `rem`/`em` sizing at all (not even inside `min()`/`max()`/`clamp()`)
in any component or view. Every such value reads a token instead. `transparent`, `currentColor`,
and `inherit` are legitimate escape hatches, not chrome. This is enforced by
`packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers every primitive automatically via
`import.meta.glob("./components/*.ts", ...)` (excluding `*.test.ts`), scans each one's `static
styles`, and fails the build on violations — a new component under `src/components/` is covered
the moment it exists, with nothing to remember to register.

If a token you need does not exist, add it to the token layer — do not inline a value.

## Setting up a theme root

```ts
import { applyTokens } from "@waitron/ui";

applyTokens(document.querySelector("#app")!);
```

`applyTokens(root)` marks `root` with `data-wt-theme-root` and adopts the token stylesheet (a
single cached `CSSStyleSheet`, shared across every call) onto `root`'s document — or its shadow
root, if `root` lives inside one — via `adoptedStyleSheets`. The token CSS itself is written
entirely in `:where()`-wrapped attribute selectors (`:where([data-wt-theme-root])`,
`:where([data-wt-theme-root][data-theme="light"])`, etc. — see "Themes" below for why every one of
them is `:where()`-wrapped), so what a given theme root resolves depends only on its own
attributes. That means two elements on the same page can both be theme roots — one
`data-theme="light"`, one `data-theme="dark"` — and each resolves `--wt-*` independently and
simultaneously. That's what the workbench demonstrates, and what
`packages/ui/src/tokens/multi-root.test.ts` pins down with an assertion: two roots mounted at once,
each still reporting its own resolved `--wt-color-bg`.

## Themes

Light and dark ship by default. Selection order:

1. `prefers-color-scheme` — the default, read from the OS/browser.
2. `data-theme="light" | "dark"` on the theme root — always wins, in both directions.

**Every rule in the token layer — the `prefers-color-scheme` block and both `data-theme` blocks —
is wrapped in `:where(...)`, which contributes zero specificity.** `data-theme` still wins over
`prefers-color-scheme` in both directions, but purely by **source order** (the `data-theme` rules
are written after the `@media` block in `colors.css`), not by specificity.

This matters beyond theme selection: because every built-in rule sits at specificity 0, **any**
plain selector in a deployment's own stylesheet — a class, an ID, an attribute selector — outranks
the token layer and wins, regardless of whether `data-theme` is set. An earlier version of this
file wrapped only the `prefers-color-scheme` block in `:where()` and left the two `data-theme`
blocks as plain attribute selectors (specificity 0,2,0). That made a deployment override like
`.brand { --wt-color-primary: purple }` (specificity 0,1,0) lose to the `data-theme` block whenever
`data-theme` was set — silently breaking retheming on exactly the configuration the shipped
workbench itself uses (each panel sets `data-theme` directly). See
`packages/ui/src/tokens/structure.test.ts`'s `deployment rules override the token layer's defaults
even when data-theme is set` for the regression test.

## Retheming a deployment

Override tokens on the theme root, with a selector of your own (a class or ID — not an inline
style, and not a bare `[data-wt-theme-root]`/`[data-theme]` selector, which only matches the token
layer's own specificity). Never patch component styles.

```css
#app {
  --wt-color-primary: #7c3aed;
  --wt-radius-md: 0px;
}
```

This works whether or not `#app` also carries `data-theme` — see "Themes" above.

## Tokens

### Colour

`--wt-color-bg`, `--wt-color-surface`, `--wt-color-surface-raised`, `--wt-color-text`,
`--wt-color-text-muted`, `--wt-color-primary`, `--wt-color-on-primary`, `--wt-color-danger`,
`--wt-color-on-danger`, `--wt-color-success`, `--wt-color-border`, `--wt-color-focus`,
`--wt-color-scrim`

Colours are semantic, not literal. There is no `--wt-color-blue`. `--wt-color-scrim` was added
after the rest of the palette to back `wt-dialog`'s `::backdrop` — if you need a similar
overlay/veil colour elsewhere, reuse it rather than inventing a new one.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-size-sm|md|lg|xl`, `--wt-font-weight-normal|bold`, `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`, `--wt-dialog-max-width`, `--wt-opacity-disabled`,
`--wt-opacity-hover`

`--wt-opacity-hover` is `wt-button`'s hover feedback (`button:hover:not(:disabled)`) — a plain
opacity dip, the same treatment for every variant. A variant-specific background or border-colour
change would need a distinct value per variant to stay visible in both themes: `--wt-color-surface`
and `--wt-color-surface-raised`, the pair other primitives already hover onto (`wt-tabs`,
`wt-data-table`), are identical in the light theme today, so that idiom would be invisible on
`wt-button`'s own secondary variant, which already rests on `--wt-color-surface`.

`wt-button` also exposes its inner `<button>` as a CSS part (`part="button"`), so a consuming
screen can layer its own hover accent onto specific buttons — `wt-button.foo::part(button):hover`
— without changing what a variant looks like everywhere else `wt-button` is used. See "Card action
buttons" under "Page composition" below for the pattern this exists for.

`--wt-dialog-max-width` (`min(90vw, 32rem)`) exists so `wt-dialog` never spells out a literal
`rem` value inline — the no-hardcoded-chrome guard (see below) checks `rem`/`em` sizing, not just
`px`, so any component-level size, including one wrapped in `min()`/`max()`/`clamp()`, must resolve
through a token.

### `--wt-tap-min`

Minimum interactive target, 44px, **on both axes**. POS screens are touched under time pressure by
staff who are not looking carefully — a numpad key ("1", "+", "−") fails just as badly if it's
44px tall but only 32px wide as if it were too short. `wt-button`, `wt-input`, and `wt-switch`
apply `min-width` and `min-height` to the element that actually forms the hit target (the inner
`button` for `wt-button`; the inner `input` for `wt-input`; both `:host` and `.control` for
`wt-switch`) — never to an element that can overflow its own container (see "Hit targets must not
overflow their container" below).

`min-width` is a floor, not a request: `wt-input`'s inner `<input>` sets both `width: 100%` (to
fill its container) and `min-width: var(--wt-tap-min)`, so in a grid or flex cell narrower than
44px it will **overflow that cell rather than shrink to fit it**. This is intentional — a POS input
that shrinks below the tap-min floor to fit its container defeats the point of the token — but it's
a real, visible layout consequence: if you see a `wt-input` overflowing a narrow cell, that's this
rule working as designed, not a bug. Widen the cell (or the grid track/flex basis it sits in)
rather than the component. `packages/ui/src/tap-target-and-focus.test.ts` mounts every interactive
primitive, including `wt-input`, in a deliberately narrower-than-44px host specifically to guard
this floor — removing the `min-width` regresses that guard.

## Primitives

| Element | Properties | Events |
| --- | --- | --- |
| `wt-button` | `variant` (`primary`\|`secondary`\|`danger`\|`ghost`), `size` (`sm`\|`md`\|`lg`), `disabled`, `loading`, `aria-label` | native `click` |
| `wt-icon` | `name`, `size` (`sm`\|`md`\|`lg`) | — |
| `wt-spinner` | `size` (`sm`\|`md`\|`lg`), `label` (the status region's accessible name), `decorative` | — |
| `wt-card` | `raised`; default slot (body), `header` slot | — |
| `wt-input` | `value`, `label`, `name`, `type`, `autocomplete`, `placeholder`, `required`, `disabled`, `invalid`, `error`; `help` and `end` slots | `wt-change` — `detail: { value: string }` |
| `wt-switch` | `checked`, `disabled`, `label`, `name` | `wt-change` — `detail: { checked: boolean }` |
| `wt-dialog` | `open`, `heading`, `aria-label` (fallback name when there is no `heading`); default slot (body), `footer` slot | `wt-close` |
| `wt-modal` | `open`, `heading`, `aria-label`; default slot (scrolling body), `footer` slot (fixed actions) | `wt-close` |
| `wt-form-error-summary` | `heading`, `errors` | — |
| `wt-form-actions` | `cancel`, `secondary`, and default slots | — |
| `wt-help-tooltip` | `aria-label`; default slot | — |
| `wt-tabs` | `items` (`{ key, label }[]`), `value`, `label`; named slots matching item keys | `wt-change` — `detail: { value: string }` |
| `wt-row-actions` | `label`; default slot of action buttons | native events from actions |
| `wt-data-table` | `rows`, `columns`, `rowKey`, `loading`, `loadingMessage`, `emptyMessage`, `errorMessage`, `aria-label` | native events from consumer-provided cells |

`wt-button` has no `type` property — see "Forms" below. `wt-button loading` is how a button shows an
action in progress: it disables the button, sets `aria-busy`, and leads the label with a decorative
`wt-spinner` while keeping the label readable — swap the label to what is happening ("Scanning…" /
"Buscando…"), which is then the one thing announced. Existing `?disabled=${busy}` buttons predate
this and are not yet migrated. `wt-spinner` on its own is for a region that is loading; there it is a
`role="status"` live region, so give `label` the localized text.

Use `wt-data-table` for sortable administrative collections such as people, devices, printers and
canvases. Define columns and cell content in the consuming screen so domain actions stay outside the
primitive. Always supply `aria-label`; use its loading, empty and error properties instead of
replacing the table with unrelated markup. A column can supply `sortValue` for a stable sortable
header and `align: "center" | "end"` for non-text values; cell rendering stays with the consumer.

Use `wt-modal` for an add or edit form. Its portrait panel fills the viewport height with 24px
top and bottom margins. The body scrolls independently, so your footer actions stay visible.
It uses the raised surface and shadow tokens: white in the light theme, with the matching dark
surface in the dark theme. Put `wt-form-actions` in its `footer` slot to keep Cancel on the left
and Save on the right:

```html
<wt-modal heading="Add printer">
  <wt-input name="printer-name" label="Printer name"></wt-input>
  <wt-form-actions slot="footer">
    <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
    <wt-button variant="primary">Save</wt-button>
  </wt-form-actions>
</wt-modal>
```

**A page with a persistent view and one reused `wt-modal` for every edit action** (a settings-style
screen editing itself, as opposed to a list opening a modal per row) has one more thing to get
right: the underlying native `<dialog>`'s `close` event lands asynchronously relative to the
`open` property change that triggers it. If your own code (Cancel, or a successful Save) already
switched to a different mode/state *before* that pending `close` event arrives — because the
caller opened a new edit right after closing the old one — a plain `@wt-close=${() =>
closeHandler()}` will stomp the newer state back to closed. Reproduced only under real timing load
(passed reliably in isolation, failed intermittently in the full suite) — arm a flag when *you*
close the modal programmatically, and have the `wt-close` handler consume-and-ignore it once,
rather than unconditionally acting on every `wt-close`:

```ts
#closingModal = false;
#closeModal(): void {
  this.#closingModal = true;
  this.#edit("view");
}
// in the template:
// @wt-close=${() => {
//   if (this.#closingModal) { this.#closingModal = false; return; }
//   this.#edit("view");
// }}
```

See `apps/dashboard/src/screens/profile-screen.ts` (`#closeModal`) for the full pattern and
`profile-screen.test.ts`'s "a stale close from the previous modal never reopens or reverts a newer
one" for how to reproduce the race deterministically (dispatch the delayed `wt-close` by hand
rather than depending on timing luck).

Set `open` to show or close the modal. Handle button clicks in your form and listen for `wt-close`
to handle dismissal, including Escape. The native dialog keeps focus inside while open and
returns focus to its trigger on close. Use `wt-dialog` for a compact confirmation.

Variant- and state-like properties (`variant`, `size`, `name`, `raised`, `disabled`, `loading`,
`decorative`, `checked`, `invalid`, `open`) all reflect to attributes, which is what makes `:host([variant="..."])`-style
styling possible — see "Adding a primitive" below.

Icons are registered by the consuming app, so `packages/ui` depends on no icon library:

```ts
import { registerIcons } from "@waitron/ui";
registerIcons({ check: "M2 8 L6 12 L14 4" });
```

An unregistered `name` renders nothing — there is no broken-icon fallback markup.

### Accessible, clickable labels (`wt-input`, `wt-switch`)

Both associate their visible `<label>` with the native control through a real `for`/`id` pair —
not by wrapping the control inside the `<label>` — so the existing layout and font sizing stay
untouched. A named `wt-input` uses that semantic name for its native `name` and `id`. An unnamed
legacy input and every `wt-switch` use a module-level counter (`wt-input-N` / `wt-switch-N`).

- `wt-input name="email"`: `<label for="email">` + `<input id="email" name="email">`. The label
  supplies the input's accessible name through that native association, while automation and
  password managers receive a stable field purpose instead of a generated component id.
- `wt-switch`: `name` forwards your semantic field name to the native input; unnamed switches
  omit it. The same `for`/`id` pairing is what makes clicking the visible label text toggle the
  switch. Because the control also carries `role="switch"` (re-purposing a native checkbox), its
  `<input>` *additionally* sets `aria-label` directly from the `label` property, so the accessible
  name doesn't depend on how a given screen reader resolves a `for`/`id` pair against a
  non-default role.

This is a fix, not the original shape: both primitives used to render `<label>` and the control as
unconnected siblings — no `for`/`id`, no `aria-label` — which left every `wt-input` silent to a
screen reader and made `wt-switch`'s visibly pointer-cursored label inert on click. If you add a
labelled primitive, follow this pattern, not the unconnected-siblings one.

### Accessible names (`wt-button`, `wt-dialog`, `wt-input`)

A shadow-DOM host's own `aria-label` attribute does not reach the focusable element inside its
shadow root on its own — the native `ariaLabel` accessor every `HTMLElement` carries just
reads/writes the host's own attribute, and the host itself has no interactive semantics. Every
primitive that can otherwise end up with no accessible name explicitly forwards one:

- `wt-button`: declares `@property({ attribute: "aria-label" }) override ariaLabel` and binds it
  onto the inner `<button>`. This matters most for icon-only buttons — `<wt-button
  aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>` — where `wt-icon`'s own SVG is
  `aria-hidden` and there is no text content to fall back on.
- `wt-dialog`: gives its `<h2>` a unique id (`wt-dialog-heading-N`, same per-instance-counter
  pattern as `wt-input`/`wt-switch`) and points the inner `<dialog>`'s `aria-labelledby` at it
  whenever `heading` is set. When there is no `heading` (so no `<h2>` exists to point at), it falls
  back to the same forwarded-`aria-label` pattern as `wt-button` — set `aria-label` directly on
  `<wt-dialog>` for a heading-less dialog that still needs an accessible name. The inner `<dialog>`
  also carries an explicit `role="dialog"`, which looks redundant (a native `<dialog>` already gets
  an implicit `dialog` role once shown modally) but isn't: axe-core's `aria-dialog-name` check —
  the rule that actually verifies the `aria-labelledby`/`aria-label` wiring above — only runs
  against elements with an *explicit* `role="dialog"`/`role="alertdialog"` attribute; it does not
  infer the implicit role of a bare `<dialog>`. Confirmed empirically while wiring up
  `wt-dialog.a11y.test.ts`: with the explicit `role` removed, stripping
  `aria-labelledby`/`aria-label` from an open dialog produced **zero** axe violations even though
  the dialog was left with no accessible name at all. Do not remove that `role` attribute — doing
  so silently blinds both `wt-dialog.test.ts`'s `declares an explicit dialog role...` test and the
  a11y suite to a real regression.
- `wt-input`: the `invalid` property was visual-only (it only reddened the border). It now also
  sets `aria-invalid="true"|"false"` on the inner `<input>`, so a screen reader user gets the same
  signal a sighted user gets from the red border.

### Hit targets must not overflow their container

A primitive's tap target must come from the element that actually forms its visible/layout box, not
from an inner control stretched past that box's edges with `position: absolute`. `wt-switch` used to
give the native `<input>` itself `min-height: var(--wt-tap-min)` while it was `position: absolute;
inset: 0`, inside an 18px-tall host — the input stretched to 44px tall and overflowed 24px+ past the
switch, silently stealing clicks from whatever was stacked next to or below it. The fix gives
`:host` and `.control` (the `input`'s actual containing block) the minimum size instead, and lets
the input fill exactly that box via `inset: 0` with no size of its own. If you build a primitive
where the hit target is a covering, invisible native control, size the *container*, not the
control.

### Focus delegation (`wt-button`, `wt-input`, `wt-switch`)

Each interactive primitive sets:

```ts
static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };
```

Without this, calling `.focus()` on the host element leaves the shadow root's inner control
unfocused — `document.activeElement` becomes the host, but nothing inside its shadow root ever
receives focus, so keyboard interaction and `:focus-visible` styling never engage. A POS needs
"focus the quantity field" constantly (e.g. after adding a line item); `delegatesFocus: true` makes
`wtInput.focus()` actually focus the inner `<input>`.

### Forms

`wt-button` has no `type` property. A `<button type="submit">` rendered inside a shadow root is
**not form-associated** — clicking it produces zero native `submit` events, and the enclosing
`<form>`'s `.elements` never lists any `wt-input`/`wt-button` inside a shadow root either. A `type`
property that looked like it selected native submit behaviour but silently did nothing would be
worse than no property at all. Full form association via `ElementInternals`
(`attachInternals().form`, `formAssociated = true`, etc.) is out of scope for this design system —
if a screen needs form-like behaviour, wire it up in JS: listen for `wt-change` on each field and
call your own submit handler on the triggering `wt-button`'s `click` event.

Do not disable the primary action merely because a required field is empty. The operator needs to
be able to press it and learn what is wrong. On an invalid submission:

- mark every required field with `required`; `wt-input` renders the visible asterisk and forwards
  the native constraint;
- pass a plain-language sentence to each invalid field's `error` property;
- pass the same sentences to `wt-form-error-summary`, with a localized heading equivalent to
  “There is a problem with this form”;
- keep the entered values so the operator can correct them.

Give every field an explicit semantic `name`. Use the standard autocomplete purposes where they
exist: `username` for a login email, `current-password` for a login password, and `new-password`
for password creation and confirmation. A generated name such as `wt-input-2` describes the widget,
not the value, and gives automation nothing useful to work with.

Put an icon-only password visibility button in the input's `end` slot. Toggle the native input type
between `password` and `text`, retain the entered value, and give the button a localized accessible
label that describes its current action: “Show password” or “Hide password”. The slot reserves room
inside the field only while it contains an action.

Put the final action row at the bottom of the form with `wt-form-actions`. Its default slot stays on
the bottom right. Put the expected primary action there. Put Cancel or Back in the `cancel` slot so
it stays on the bottom left. A secondary action that belongs beside the primary action goes in the
`secondary` slot.

```ts
html`
  <wt-form-error-summary
    heading=${t("form.error_heading")}
    .errors=${errors}
  ></wt-form-error-summary>
  <wt-input
    name="email"
    autocomplete="username"
    required
    label=${t("login.email")}
    error=${emailError}
  ></wt-input>
  <wt-form-actions>
    <wt-button slot="cancel" variant="secondary">${t("action.cancel")}</wt-button>
    <wt-button variant="primary">${t("action.continue")}</wt-button>
  </wt-form-actions>
`;
```

Use `wt-help-tooltip` for short explanations that would distract from the form when always visible.
Give its question-mark button a localized `aria-label`. It opens on click, stays open while you
interact with it, and closes when you press Escape or click anywhere outside it. Place it in a
`wt-input`'s `help` slot to align it beside that field's label.

### Dashboard banner

Keep the dashboard's branded banner at the very top of the page, spanning its full width, on the
login screen and every authenticated screen. The menu and page content belong underneath it. The
banner shows the canonical Waitron lockup and the deployment tenant's legal name, not a location
name: one deployment database represents one tenant, while that tenant can contain several
locations. Once a session is active, put Logout at the banner's trailing (right-hand in the shipped
locales) edge. Do not show Logout before authentication.

### Dashboard sidebar navigation

A sidebar nav row is a `.nav-item` — a plain flat `<button>`, not `wt-button`. `wt-button`'s own
box (border, background, bold text) is right for a page action, but a sidebar lists ~20 of them;
stacking that many buttons reads as a wall of buttons, not navigation. A resting row is
`--wt-color-text-muted`, not full-strength text — at equal weight and colour, ~20 items compete
with the group headers above them and bury the current page's accent in a crowd of equally dark
siblings. The selected item carries `aria-current="page"` and is styled from that attribute: an
accent-coloured leading edge plus bold, full-strength coloured text, no background fill — the same
idiom `wt-tabs` already uses for its selected tab (`border-bottom-color` there,
`border-inline-start-color` here), not a new one — and it is now the one loud thing in an otherwise
calm list. Hovering a row moves it to full-strength text plus a `--wt-color-surface` background —
visible here because the sidebar itself sits on `--wt-color-bg`, unlike `wt-button`'s own secondary
variant (see `--wt-opacity-hover` above). A `.nav-group` header takes the same small-caps treatment
as a card's group-label (uppercase, `letter-spacing: 0.04em`) so it reads as a label, not a fainter
link.

The sidebar and the content column both scroll independently, bounded to the space below the
banner (`.shell { height: 100vh }`, `.sidebar`/`.main` both `max-height: 100%; overflow-y: auto`) —
the page itself never scrolls. Before this, only `.sidebar` was self-contained
(`max-height: 100vh`); `.main` just grew with its content and pushed the whole page taller, so once
a screen exceeded one viewport the sidebar — capped to one screen — visibly stopped short of where
the page actually ended. Both panes now share the same bound, so they always end at the same line.

### Dashboard authentication

Show **Please log in to continue** above the initial Email field and offer passive passkey autofill
when the browser supports it. Continue opens the password form for an email without a saved method.
An opted-in preference can select the returning method, but a modal passkey prompt still needs an
explicit action. Navigation, refresh, logout and session expiry must leave that prompt closed.
Never use server-side account status or passkey enrolment to select a public screen, because the
difference would reveal whether the account exists or has a passkey.

On method screens, use **Login with password**, **Login with passkey** or **Login with Google** as the heading. Show an
Email label and the address as text, with an accessible change-account icon on the right. That icon
clears both the current attempt and the saved email/method, then returns to blank email entry.
Keep the hidden semantic username input for password managers. Ordinary login has no separate
Cancel or Forget button.

On password, passkey and Google screens, show alternative methods as a persistent bulleted list of links. Put **I've forgotten my password**
directly below the password field. Recovery opens **Check your email** with the address, delivery
guidance and a one-minute resend countdown. Use the same public acknowledgement for every address:
pending accounts receive a setup link and active accounts receive a reset link. Invitation emails
use links; the login screen has no manual invitation-code entry.

Offer **Remember my email on this device** only on initial email entry. Save the authenticated email
and successful method in localStorage only when selected; unchecked Remember writes neither local
nor session storage. Keep the current email in component memory while you change methods. Saving a
shortcut neither stores credentials nor extends the authenticated session, and one account's consent
must not carry over to a different account selected by a passkey or Google. Cancelling or completing an account-activation link leaves an unrelated saved shortcut alone; that flow has no Remember choice.

Keep an authenticator or recovery code off the password form. Request it on a separate screen only
after the server accepts the password and says the account requires a second factor. Keep the
password in component memory for the second request, and issue no session before both checks pass.

Account setup and password-reset links validate their action before showing new credentials. Show
the language chooser and the server-confirmed email on these forms. An invalid or expired action
can request a replacement with the same acknowledgement for every account state. After setting a
password, offer optional passkey creation with a recognizable name. A password reset still requires
normal sign-in, including any enrolled second factor, before that offer.

The authenticator setup screen presents the enrolment URI as a QR code, keeps the setup key behind
a manual fallback, and enables the factor only after the server accepts a current six-digit code.

Every authenticated dashboard banner includes **Your profile**, including for staff without a
sidebar. Profile edits cannot expose role or suspension controls.

### Empty slots don't reserve space

`wt-card`'s `header` slot and `wt-dialog`'s `footer` slot only add their spacing/divider when
something is actually projected into them — an unused slot must not leave a spurious gap or a bare
bar in the layout. The two primitives get there differently:

- `wt-card` does it in pure CSS: the header's `margin-bottom` lives on `.header ::slotted(*)`, so
  it only applies when there is slotted content for that selector to match.
- `wt-dialog` does it imperatively: `updateHasFooter()` reads `assignedNodes({ flatten: true })`
  off the footer slot — once on first render, again on every `slotchange` — and toggles a
  `.has-content` class that the footer's padding and top border are conditioned on.

If you build a primitive with an optional slot that carries its own spacing, use one of these two
patterns rather than reserving space unconditionally.

## Page composition

The rules above cover individual primitives; a screen built only from them with no further
guidance drifts into an unstructured stack of label/value pairs. These rules cover how to arrange
primitives into a settings- or detail-style screen. `wt-data-table` and `wt-tabs` (see "Tabbed
management pages" below) already carry their own composition guidance — this section is for
everything else, built from `wt-card`, `wt-input`, and `wt-button`.

### Group related fields into cards

One `wt-card` per logical group. Give the group a small label above the card — not inside it —
`--wt-font-size-sm`, bold, uppercase, `--wt-color-text-muted`. Inside the card, each field is a
row: label on top, value below, both left-aligned:

- field label: `--wt-font-size-sm`, normal weight, `--wt-color-text-muted`
- field value: `--wt-font-size-md`, bold, `--wt-color-text`

A group label and a field label are both small and muted; only the group label is bold and
uppercase. That distinction is the entire signal separating "this is a section" from "this is a
field" — apply it consistently or it stops working.

Separate rows inside a card with a `--wt-color-border` hairline; the last row carries none.

### One action per row or card — matching what it actually opens

Never give a row a generic "edit this" affordance (a chevron, an icon) when the action actually
opens something bigger than that one field, and never give a card a single action when each row
inside it does something different. Four shapes cover what's needed so far:

- **A card edited as one form** (e.g. name, phone, email and language together): one "Edit" action
  in a footer below every row, not per-row. The footer sits below the last row, separated by the
  same hairline border the rows use.
- **A field whose value can't be shown** (a password, a PIN): don't render a fake masked value —
  there's nothing real to show. Put the label and its one action ("Change") on the same row.
- **A repeatable list** (passkeys today; the same shape applies to printers, staff, devices): each
  item is its own row carrying its own action ("Remove"), and an "Add" action sits in the same
  footer position the single-form case uses for "Edit".
- **A purely informational card** (a status sentence, nothing to edit): just the sentence, muted,
  with no action — unless there's actually something to configure, in which case that's the
  card's one action.

Every one of these actions opens a `wt-modal`, not an inline mode-swap that replaces the whole
page — the view stays on screen, dimmed behind the modal, exactly like a list opening its "Edit"
modal per row (`person-edit.ts`). This fixes two things an inline swap gets wrong on a page built
from these cards: the edit form no longer needs to fit the page's own (narrower) width, since a
modal sizes itself independently; and there's no more "why doesn't the current page highlight in
the sidebar while editing" confusion, since the page never stopped being the page. See "Card action
buttons" below for the button styling this pairs with, and the `wt-modal` entry under "Primitives"
above for the close-event race a shared, reused modal needs to guard against.

### Card action buttons: calm at rest, accented on hover

A card or row's action button (Edit, Change, Add, Remove, Set up, Disable, Replace, Confirm) stays
`secondary` (plain/outlined) **at rest**, regardless of what it does — filling every action solid
at rest (an earlier version of this rule made "primary" mean "the card's one forward action" and
painted it blue always-on) reads as visual noise once a screen has several cards, each with its own
"primary" fighting for attention, and different-length labels at solid fill read as mismatched
pills. Colour appears only on **hover**, via `wt-button`'s exposed `button` CSS part:

```css
.card-action.accent-primary::part(button):hover {
  border-color: var(--wt-color-primary);
  color: var(--wt-color-primary);
}
.card-action.accent-danger::part(button):hover {
  border-color: var(--wt-color-danger);
  color: var(--wt-color-danger);
}
```

Use `accent-primary` for a forward/constructive action, `accent-danger` for one that removes or
disables something, and neither class for a purely maintenance action ("Replace recovery codes"
when 2FA is already on) — it gets only `wt-button`'s own generic hover dim. This is deliberately
**not** a change to what `variant="primary"`/`"danger"` mean on `wt-button` itself — those still
render solid at rest everywhere else (the till's checkout button, for one, needs to read as
"the important action" without anyone hovering it first, and there is no hover on a touchscreen at
all). The part hook lets a screen layer an accent onto specific buttons without touching that
contract.

Give every card action a fixed `min-width` (`ch`-based — see `--dashboard-sidebar-width` in
`dashboard-app.ts` for the same reasoning) so a row of differently-worded actions still reads as
one uniform set rather than a jumble of pill widths, and keep labels short — reuse the small shared
`action.*` vocabulary (`action.edit`, `action.remove`, `action.add`, `action.change`,
`action.setup`, `action.disable`, `action.replace`, `action.confirm`) rather than spelling out what
the surrounding row or card label already says. Where a short label repeats more than once on the
same screen for genuinely different things (two "Change" buttons, for Password and PIN; two "Set
up" buttons, for the authenticator and Google), give each an `aria-label` with the fuller wording —
otherwise a screen reader's "list all buttons" navigation can't tell them apart. A label that
appears once on the screen doesn't need one, matching the sitewide bare "Edit"/"Remove" convention.

Right-align a card's footer actions (`justify-content: flex-end`) — the same "primary action
bottom-right" rule `wt-form-actions` already applies to forms sitewide (see "Forms" above).

### Spacing rhythm

Using the existing `--wt-space-*` scale:

- `--wt-space-6` between the page title and the first group label
- `--wt-space-5` between one card and the next group label (i.e. between whole sections)
- `--wt-space-2` between a group label and its card
- row padding inside a card: `--wt-space-3` vertical, `--wt-space-4` horizontal

### Left-anchor narrow content — don't centre it

A narrower `max-width` on a settings/form screen keeps line length readable, but the screen itself
stays anchored to the body's left padding, the same as a full-width `wt-data-table` screen — never
`margin-inline: auto`. Centering a narrow screen in the *remaining* space beside the sidebar makes
it read as a visually different app from the wide table screens next to it; anchoring both to the
same edge and varying only the width does not. `backup-screen.ts` and `receipt-screen.ts` already
follow this (`max-width` alone); `profile-screen.ts` used to be the outlier. The one legitimate
exception is a full-page screen with no sidebar at all, like the login screen — centering a
freestanding form with nothing to anchor to is the normal, expected treatment there.

### Typography roles

| Role | Token(s) | Example |
| --- | --- | --- |
| Page title | `--wt-font-size-xl`, bold | "Your profile" |
| Group label | `--wt-font-size-sm`, bold, uppercase, muted | "YOUR DETAILS" |
| Field label | `--wt-font-size-sm`, normal weight, muted | "Name" |
| Field value | `--wt-font-size-md`, bold | "Clinton Gormley" |

`wt-button` carries its own type sizing through its `size` property — these roles cover page text,
not button labels.

The till and kitchen-display surfaces reuse the same tokens but have their own constraints (touch
targets, glanceability at a distance) that these rules don't yet cover; treat them separately
rather than assuming this composition applies unchanged.

## Event discipline

Custom events crossing a shadow boundary are `composed: true`, so a native event re-emitted
without care fires twice. **Always `stopPropagation()` the native event before dispatching your
own.** `wt-input` and `wt-switch` are the reference implementations.

Custom events are named `wt-*` and carry data in `detail`.

## Testing

Component tests run in real Chromium via `@vitest/browser` + Playwright, not jsdom — the things
being asserted (computed styles, `adoptedStyleSheets`, shadow-DOM event composition) don't exist
in a DOM simulator. Shared test helpers live in `packages/ui/src/test-helpers.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

test("paints from the primary token", async () => {
  const el = await mount('<wt-button variant="primary">Cobrar</wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const button = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

- `mount(html)` — creates a fresh `<div>`, appends it to `document.body`, calls `applyTokens` on it
  (making it its own theme root), sets `innerHTML` to `html`, awaits the mounted element's
  `updateComplete`, and returns that element (the markup's first child).
- `host` — a live binding to the wrapper `<div>` from the most recent `mount()` call. Set token
  overrides on it (`host.style.setProperty(...)`) to prove a component reads a token rather than
  hardcoding a value.
- `cleanup()` — removes every host mounted since the last call. Call it from `afterEach`.

### Accessibility testing (axe)

Every primitive also gets an automated accessibility test, in `packages/ui/src/components/*.a11y.test.ts`
(the `.a11y.test.ts` suffix keeps it out of `no-hardcoded-chrome.test.ts`'s component glob, same as
`*.test.ts`). These run [`axe-core`](https://github.com/dequelabs/axe-core) — the real engine, not
`vitest-axe`/`jest-axe` (those target jsdom; this project runs real Chromium) — directly against the
mounted, shadow-rooted markup. Shared helpers live in `packages/ui/src/a11y-helpers.ts`:

```ts
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-button a11y (%s theme)", (theme) => {
  test("icon-only button", async () => {
    await mountThemed(
      '<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
```

- `mountThemed(html, theme?)` — `mount()`, plus paints the host's own `background` from
  `--wt-color-bg` (exactly what `packages/ui/index.html`'s `.panel { background: var(--wt-color-bg) }`
  does) and, if `theme` is passed, sets `data-theme="light"|"dark"` on the host. Without the painted
  background, a component with no background of its own (e.g. `wt-input`'s `<label>`) would be
  contrast-checked against the browser's default white page background regardless of theme —
  meaningless for dark mode.
- `expectNoA11yViolations(context)` — runs the full default axe ruleset against `context` (almost
  always `host`) and fails with a readable message (rule id, impact, offending selectors) if axe
  finds anything. **The ruleset is never narrowed** — every caller runs the same, full default set;
  narrowing it to make a test pass is exactly the kind of box-ticking this exists to prevent.

**Shadow DOM is the whole point here** — every interesting element in these components (the actual
`<button>`, `<input>`, `<dialog>`, ...) lives inside a shadow root, and `axe.run()` does traverse
into open shadow roots automatically. `a11y-helpers.test.ts` is the standing proof of that: it mounts
an icon-only `wt-button` with a deliberately missing `aria-label` (so the only accessible-name
candidate — the `<button>` — lives entirely inside the shadow root) and asserts axe's `button-name`
rule actually fires. Do not trust a green a11y run on a shadow-DOM component you haven't seen this
kind of test go red first.

**A rule not firing is not the same as a component being accessible.** While building this suite,
stripping `wt-dialog`'s `aria-labelledby`/`aria-label` produced zero axe violations until an explicit
`role="dialog"` was added to the inner `<dialog>` — axe's `aria-dialog-name` check does not infer the
implicit role of a bare native `<dialog>` (see "Accessible names" above). Breaking a component and
watching the relevant test *fail* is not optional busywork; it is the only way to know the test would
have caught the defect it's named after.

**Colour contrast** is checked as part of the same default ruleset, per theme, via `mountThemed`'s
`theme` argument — see the `describe.each(["light", "dark"])` pattern above, used throughout the
`*.a11y.test.ts` files. As of this writing axe reports zero contrast violations for any `--wt-color-*`
pairing actually used by every primitive in the table above, in either theme, across every documented state (`wt-input`
invalid, `wt-switch` checked/unchecked, `wt-dialog` open, `wt-button` icon-only and every variant,
disabled and loading states; `wt-spinner` as a status region and decorative, 2026-09-11). No token
values needed changing. (axe does flag two unrelated `incomplete` — not
violation — results on `wt-dialog`: a `color-contrast` "background partially obscured" reading on the
`.body` slot, an [axe/shadow-DOM slot-content limitation](https://github.com/dequelabs/axe-core), and
an `aria-prohibited-attr` note about `aria-label` on the light-DOM `<wt-dialog>` host itself, which axe
can't know is deliberately forwarded into the shadow root. Both are engine limitations, not defects —
verified by hand: `--wt-color-text` on `--wt-color-surface-raised` computes to ~13:1 in dark and >15:1
in light, both far past the 4.5:1 AA floor for the 15px body text involved.)

New primitives require an axe test covering every meaningfully distinct accessibility-relevant state
(not just the default render) — see the checklist below.

## Adding a primitive

1. Write the test first, in a real browser. Include a test proving it paints from a token — set
   the token on the `host` (see Testing, above) and assert the computed style changes. A component
   that renders correctly but ignores tokens is not a primitive.
2. Extend `LitElement`, and put `baseStyles` first in `static styles`.
3. Reflect variant-like properties so they are styleable via `:host([variant="..."])`.
4. If it's interactive (clickable/focusable/typeable), add `static override shadowRootOptions = {
   ...LitElement.shadowRootOptions, delegatesFocus: true }` and give the actual hit-target element
   (not just `:host`) `min-width`/`min-height: var(--wt-tap-min)` — see "Focus delegation" and
   "`--wt-tap-min`" above. Nothing needs registering with `no-hardcoded-chrome.test.ts` — it
   discovers `src/components/*.ts` automatically via `import.meta.glob`, so a new primitive is
   covered as soon as the file exists.
5. Add an axe a11y test, `src/components/<name>.a11y.test.ts` (see "Accessibility testing (axe)"
   above) — every meaningfully distinct state (open/closed, checked/unchecked, invalid, icon-only,
   ...), in both light and dark themes. Before trusting it, break the component's accessibility on
   purpose (remove an `aria-label`, unassociate a label) and confirm the test actually goes red,
   then restore the fix.
6. Add it to the workbench and to the table above.

## Workbench

```bash
pnpm --filter @waitron/ui dev
```

Serves `packages/ui/index.html` on `http://localhost:5180`, showing every primitive in light and
dark side by side, each panel driven by its own `applyTokens` call — the same two-roots-at-once
behaviour `multi-root.test.ts` asserts. Check both before committing.

## Local checks before pushing

A Husky `pre-push` hook (`.husky/pre-push`) runs before any push leaves your machine, and **what it
runs depends on what the push contains.** On a push carrying code, in order: the sign-off (DCO)
check, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, then `typecheck` and
`test:coverage` **scoped to the changed packages and their dependents**. A documentation-only push
stops after `format:check`; a push that only deletes refs skips the gate entirely; and anything the
hook cannot attribute to a package — root config, `.github/`, `.husky/`, `scripts/`, the lockfile —
widens the run back to the whole workspace. It runs from the repo root regardless of which
subdirectory you're in, stops at the first failing step, and prints both which step failed and the
exact command to reproduce it locally.

(This paragraph has twice described a hook that no longer existed. It said
`pnpm --filter @waitron/ui …` for `typecheck` and `test` after #9 had widened both, and then said
the hook "always runs everything" and had no coverage thresholds after `feat/scoped-pre-push-hook`
had given it both scoping and `test:coverage`. `git log -p -- .husky/pre-push` is the authority;
this file is a paraphrase of it.)

Coverage thresholds ARE in the hook now — `test:coverage` is the same script CI's shards run, and
closing that gap is most of why the hook was rewritten. **Mutation testing and the `bundle-smoke`
builds are still deliberately out**, so a green hook does not imply a green CI. The hook's own
header names both, with a measurement behind the first and only a reason behind the second:
mutation testing because `mutation-verifactu` alone was 3m26s of a 4m8s CI run, and `bundle-smoke`
because nothing the hook runs builds an esbuild bundle, so that job's failure modes are invisible to
it by construction. Two further gaps are listed beside them, and both are consequences of the
scoping rather than choices: `packages/db`'s two cross-package guard suites do not run on a scoped
push that does not reach `packages/db`, and a scope holding only packages with no `test:coverage`
script runs no tests at all while still reporting success. Read that list before treating a green
hook as evidence. Both the hook and CI narrow on a change, so a green from either is evidence
about the packages that ran. A merge to `main` is the only run that is unfiltered, and that is what
verifies the narrowing was right.

`pnpm install` wires the hook up automatically (via the root `prepare` script), including on a
fresh clone — nothing else to set up.

**Emergency bypass:** `git push --no-verify` skips the hook entirely. Use it when the hook is
wrong, blocking on something unrelated to your change, or an environment issue you don't have time
to fight — CI runs the same checks and will still catch a real problem on the PR either way. The
hook's own output repeats this on every failure so you're never stuck without it.

### Submit ordinary forms with Enter

When you finish typing a field, Enter should perform the same action as its submit button.
Bind `submitOnEnter` from `@waitron/ui` to that form's fields or dialog, and pass its specific
submit control:

```ts
html`<wt-input
  @keydown=${(event: KeyboardEvent) =>
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
></wt-input>`;
```

For a screen with several editable rows, select the Save button for that row. The helper clicks
that existing control, so your normal validation still runs. Keep the action's in-flight guard
and disabled binding: the keyboard path uses the same action as a click.

Only single-line input fields submit implicitly. Enter in a textarea inserts a newline, and
selectors, switches, file pickers, and keypad buttons retain their own keyboard behavior.
Composition, held keys, and Enter with Shift, Control, Alt, or Meta do not submit. Leave live
filters and controls that persist each edit immediately unbound. If a field edits a draft that you
commit with Save, bind it to that Save even when its preview updates as you type.


### Tabbed management pages

When one management area contains several lists, use `wt-tabs` to show one concern at a time.
Give each tab a stable key, a localized label and a matching named slot:

```ts
html`<wt-tabs
  label="Venue operations"
  .items=${[{ key: "status", label: "Status" }, { key: "menus", label: "Menus" }]}
  .value=${this.view}
  @wt-change=${this.selectView}
>
  <section slot="status">${this.renderStatus()}</section>
  <section slot="menus">${this.renderMenus()}</section>
</wt-tabs>`;
```

Your selection handler receives `event.detail.value`. Ignore events whose `target` differs from
`currentTarget` if your panels contain controls that also emit `wt-change`. The component updates its
own selection, while your screen records it with `UrlStateController`. An unknown or omitted value
shows the first tab. Arrow keys wrap between tabs; Home and End select the first and last tab.
The tab strip scrolls on narrow screens. Hidden panels remain mounted, so switching tabs retains
their input values. Supply unique, nonempty keys and a localized `label` for the tab group.

Put each list in `wt-data-table`. Use `wt-row-actions` for its hamburger menu, with a label that
identifies the row, such as `Actions: Restaurant`. Put Create in a menu beside the table heading,
and Edit, Delete or domain-specific actions in each row's menu. The menu uses a native popover:
clicking outside or pressing Escape closes it. Its action buttons follow normal Tab navigation.

Open create and edit forms in `wt-modal`, with `wt-form-actions` in its footer. Keep validation
messages inside the modal, retain entered values after a failed save, and refresh the table after
success. Use the existing Forms contract for required markers, field errors and keyboard submission.
Only offer operations your domain supports: department removal deactivates the department; removing
a product from a menu removes that offer.

### Navigation and language controls

Your selected tab belongs in the URL. `UrlStateController` reads path segments, updates them without
removing unrelated query parameters, and restores the screen on browser Back/Forward. The screen validates
identifiers against its loaded data and permissions; a URL never establishes authentication. Use
replacement history for defaults and invalid destinations, and push history for a new selection.
Keep passwords, PINs, pairing codes and unsaved form contents out of the URL.

Module management tabs use `/manage/<section>/view/<key>`; Venue operations uses `status`,
`departments`, `menus`, `zones` and `routing`. The dashboard preserves module-owned `view` segments
while the module validates its keys.

Use `/manage/<section>` for dashboard destinations and `/tabs/<key>` for till tabs. Nested views,
zones and saved canvas tabs extend those paths, such as `/manage/floor/view/plano/zone/<id>`.
Till Schedule, Kitchen, Pass and Allergens use `/tabs/<key>/view/<destination>`, with destinations
`schedule`, `station`, `expo` and `allergens`. The operator Kitchen picker adds `/station/<id>`;
embedded station cards keep their selection local to the enclosing tab. Restore these destinations
only after login and device validation. Kitchen displays keep their bound station and cannot open
operator destinations from a path. Unsaved canvas tabs stay out of both URL writes and history,
including when you reselect them; saved tabs become destinations after persistence.
Only meaningful navigation pushes history. Payment steps, modifier dialogs and draft edits do not;
an automatic return home after payment replaces the current entry. Menu choice is a browser-tab
preference in `sessionStorage`, retained through new and parked orders. Every successful login resets
it to the location default (or the first available menu). Refresh currently returns to PIN login,
so logging in after refresh also resets the menu. It belongs in neither the path nor browser history.

Dietary filters (vegan, vegetarian, no meat and no fish) follow the same login boundary. The till app
owns the selection and passes it to counter and table-order screens, including embedded cards.
Screen changes, menu changes, payment and new or parked orders retain the selection. Tapping the
selected filter clears it everywhere; a new login starts with no dietary filter. Changing a filter
never alters basket contents or browser history. Browser storage being blocked must not stop filtering.

The production server serves app HTML for browser navigation under `/manage` and `/tabs`. APIs and
static assets keep their own responses; setup continues to use its existing root page.

The till and dashboard language controls display the names from `SUPPORTED_LOCALES` before their
options load. Place the chooser at the bottom right, open its menu upwards, and leave enough bottom
padding for the last content and action buttons to scroll clear of it. A signed-in operator's choice
uses the existing preference write; login, pairing and kitchen-display choices are local UI changes.
