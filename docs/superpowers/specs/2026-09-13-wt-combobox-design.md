# wt-combobox

Two new design-system primitives were requested: a searchable single-select dropdown and a
searchable multi-select dropdown, both able to offer "add a new option" when the typed text
matches nothing. Research turned up no existing generic dropdown/combobox/select primitive in
`packages/ui` — the closest things are two one-off, hardcoded pickers
(`apps/dashboard/src/widgets/allergen-picker.ts`, `dietary-origin-picker.ts`), each over a fixed
vocabulary with no search and no add-new. This is new primitive work, not a generalisation of
something that already exists.

Single-select and multi-select share the same search, filtering, keyboard navigation and add-new
behaviour, differing only in the selection model and whether picking an option closes the panel.
They ship as one element, `wt-combobox`, with a `multiple` boolean attribute — mirroring native
`<select multiple>` — rather than two separate custom elements duplicating that shared behaviour.

## Decisions

### API surface

| Property | Type | Notes |
| --- | --- | --- |
| `options` | `{ value: string, label: string }[]` | Consumer owns the full list; the component only filters and renders it. No per-option `disabled` in v1. |
| `multiple` | `boolean`, reflected | Switches the selection model and the closed-state display. |
| `value` | `string` | Meaningful only when `multiple` is false. Empty string means nothing selected. |
| `values` | `string[]` | Meaningful only when `multiple` is true. |
| `allowAdd` | `boolean`, reflected (`allow-add`), default `false` | Gates the whole "Add '…'" row. Most comboboxes are plain pick-from-a-list; a consumer opts in explicitly for an extensible vocabulary (e.g. dietary tags). When false, the add row never renders and `wt-combobox-add` never fires. |
| `label`, `name`, `placeholder`, `required`, `disabled`, `invalid`, `error` | same shape as `wt-input` | Forms-contract parity: visible required asterisk, `error` renders a message and sets `aria-invalid`, retains entered/selected state on an invalid submission. |
| `countLabel` | `(count: number) => string`, default `(count) => \`${count} selected\`` | Only read when `multiple` is true and more than one value is selected. Checked against real usage, not assumed: `wt-data-table` ships English defaults for the same kind of dynamic text (`emptyMessage = "No results"`, `loadingMessage = "Loading"`) and every real dashboard screen overrides them with `t(...)` (`apps/dashboard/src/screens/printers-screen.ts` and seven others) — nothing in this codebase actually leaves a primitive refusing to render without localized text. `countLabel` follows the same shape: a plain English default so an unconfigured combobox never renders blank, overridden by any consumer that localizes. |
| `noResultsLabel` | `string`, default `"No results"` | Shown in the panel in place of the option list when the filtered list is empty and `allowAdd` is false (with `allowAdd` true, the add row itself communicates "nothing matched, but you can create it," so no separate empty-state text renders). Same default-with-override convention as `countLabel`, matching `wt-data-table`'s `emptyMessage` default of the same text. |
| `searchPlaceholder` | `string`, default `"Search"` | Placeholder text for the search box inside the open panel — distinct from the trigger's own `placeholder`, which describes the empty closed state. A consumer with `allowAdd` set typically overrides this with something like "Search or add new"; the component doesn't infer that phrasing from `allowAdd` itself, since the exact wording is the consumer's copy to own. |
| `addLabel` | `(text: string) => string`, default `(text) => \`Add '${text}'\`` | Text of the add row itself. Same default-with-override shape as `countLabel` — the row's wording ("Add '…'", "Create '…'", a translated equivalent) is consumer copy, not something the primitive should decide unilaterally, but an unconfigured combobox still renders something sensible. |

This follows `wt-input`'s existing property names rather than inventing new ones, and keeps `value`
a plain string for the single-select case rather than a polymorphic `string | string[]` — consistent
with every other primitive's `value: string` convention (`wt-input`, `wt-tabs`).

Two named properties (`value` / `values`) rather than one generic `value: string[]` was a deliberate
choice: a single-select consumer that had to unwrap a one-element array for no benefit would be a
worse API than the small asymmetry of two names, and it avoids inventing a serialisation format for
the non-multiple case.

### Events

- `wt-change` — `detail: { value: string }` when `multiple` is false, `detail: { values: string[] }`
  when true. Same `dispatchWtChange` helper and `stopPropagation`-then-redispatch discipline as
  every other primitive (`packages/ui/src/interactive.ts`).
- `wt-combobox-add` — `detail: { text: string }`, dispatched when the add row is activated. The
  component never creates the option itself. A consumer that only needs a name adds
  `{ value, label }` to its own `options` array synchronously, which the component picks up on its
  next render — net effect reads as inline. A consumer whose new item needs more fields (e.g. a
  price) opens its own `wt-modal` in the event handler and updates `options` (and `value`/`values`,
  if the new item should end up selected) once that modal saves. One event contract serves both of
  the add-new shapes in the original screenshots; the component has no separate inline-vs-modal mode
  to maintain.

### Filtering and the add row

Filtering is client-side only: `options` is the full list, and typing in the search box filters it
by case-insensitive substring match against `label`. No async/server-search mode — nothing today
needs it, and it would add loading/empty/debounce states and their own accessibility surface for a
case that doesn't exist yet.

The add row appears (only when `allowAdd` is true) whenever the trimmed search text is non-empty and
does not case-insensitively match an existing option's `label`. It never appears while `allowAdd` is
false, regardless of search text.

### Interaction and accessibility

Follows the ARIA combobox pattern rather than inventing one:

- The always-visible trigger is a plain `<button>` carrying `aria-haspopup="listbox"` and
  `aria-expanded`: it says a listbox will open, and whether it is open right now.
- The combobox role itself lives on the search `<input>` inside the open panel, which carries
  `role="combobox"`, `aria-expanded`, `aria-controls` (pointing at the panel's listbox id) and
  `aria-activedescendant` (pointing at the currently active option). That is where keyboard focus
  stays while the panel is open, and the ARIA combobox pattern wants the `aria-controls` and
  `aria-activedescendant` wiring on the focused element — so arrow keys move the active option
  without moving real DOM focus off the search box.
- The floating panel is `role="listbox"`, with `aria-multiselectable="true"` when `multiple`. Each
  row is `role="option"` with `aria-selected` reflecting its selection state; the visible selection
  indicator in multi-select mode is a decorative `<span>`, not a real checkbox, and is
  `aria-hidden` since `aria-selected` on the option already carries that state to assistive tech.
  (An `<input type="checkbox">` inside `role="option"` is an axe `nested-interactive` violation —
  found by the real axe run in `packages/ui/src/components/wt-combobox.a11y.test.ts`.)
- Keyboard: ArrowUp/ArrowDown move the active option, Enter selects/toggles it, Escape closes the
  panel and returns focus to the trigger, typing filters the list and resets the active option to
  the first match.
- Popover positioning borrows `wt-row-actions`' opening sequence but not its clamp: open with
  `showPopover()` synchronously (so its dimensions are available before first paint — see the
  positioning trap in `docs/developers/testing-guide.md`), then measure and clamp against the
  viewport with a rule of its own. `wt-row-actions` floors the left edge at 8px, which suits a
  right-aligned popup that can compute a negative left; this panel is left-aligned with its trigger
  and must never be pushed right of it, so the horizontal rule differs — the shipped formula and
  the reason for it are in the comment above `maxLeft` in
  `packages/ui/src/components/wt-combobox.ts`.

Closing rule: selecting an existing option closes the panel when `multiple` is false (pick one,
done) and leaves it open when `multiple` is true, matching the checkbox behaviour in the original
screenshots. Activating the add row follows the same rule as picking an option in whichever mode is
active — it closes the panel in single-select mode, and leaves it open in multi-select mode.

### Closed-state display

- Nothing selected: the `placeholder`.
- Single-select with a value, or multi-select with exactly one value: that option's `label`.
- Multi-select with more than one value: a count badge, its text supplied by `countLabel(count)`,
  never a comma-joined list that can overflow or become unreadable as the selection grows.

### Testing

- The standard token-painting test (set a `--wt-*` token on `host`, assert the computed style
  changes) per "Adding a primitive" in `docs/developers/design-system.md`.
- `wt-combobox.a11y.test.ts`, in both themes, covering: closed/empty, open with results, open with
  the add row showing, open with no matches and `allowAdd` false (empty state, no add row), single
  vs. multiple, invalid, disabled, required. Each state gets confirmed to actually fail before the
  corresponding fix, per the design system's "a rule not firing is not the same as accessible" rule.
- Behavioural tests (real Chromium, `@vitest/browser`) cover: filtering, keyboard navigation, the
  `wt-combobox-add` event contract (including that it never fires when `allowAdd` is false), the
  single- vs. multi- close-on-select rule, and the closed-state display rules above.

### Non-goals for v1

- Async/server-side search.
- Per-option `disabled`.
- Native form association via `ElementInternals` — matches every other primitive; `wt-change` plus
  consumer-side wiring is the documented pattern (design-system.md § Forms).
- Chip-style closed display for multi-select — a count badge was chosen instead (see above).

Any of these can be added later without changing the shape of what ships here.
