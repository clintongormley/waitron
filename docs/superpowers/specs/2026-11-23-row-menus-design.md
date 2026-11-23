# Row menus as lists, with one icon per verb — design

Owner decisions, 2026-11-23. The owner said the ⋮ action menus "look ugly": every action was
centred, and each was drawn as a separate bordered button. A mock-up comparing today's Menus row
menu with a list layout, in both themes, plus an icon sheet was shown to the owner, who approved it
("beautiful!") and chose normal-weight labels and grey icons. The mock-up is not committed; the
watcher holds the screenshot for the lane.

The menu is the shared `wt-row-actions` (`packages/ui/src/components/wt-row-actions.ts`). About
40 files use it across the dashboard, the till and the module packages. Today it centres its
actions on purpose (`--wt-button-justify: center`, and `design-system.md` says "action labels are
centred"), and each slotted `wt-button` keeps its secondary border and bold label.

## Decisions

1. **An action is a list row, not a button.** Each row:
   - fills the menu's width, with no border and no fill at rest
   - is at least `--wt-tap-min` tall
   - starts its content at the start edge (left in English and Spanish)
   - has a label at `--wt-font-size-md`, **normal weight** (owner), in `--wt-color-text`
   - takes a neutral fill on hover and while pressed. The mock-up used `--wt-color-field-fill`,
     with `--wt-radius-sm` corners. Keyboard focus keeps the usual focus ring.
   - looks as it does today when disabled, through `disabledStyles`

   Links slotted as actions (`a[href]`) look the same as buttons.

2. **An icon in a fixed column at the start of every action row.**
   - The icon is `--wt-font-size-lg` square, painted **`--wt-color-text-muted`** (owner).
   - The gap to the label is `--wt-space-3`, so every label in a menu starts at the same place.
   - In a pick-one list inside a `wt-row-actions`, such as the till's floor view choice or the
     card reader picker, the tick for the current choice sits in that same column.

3. **Delete is last, red, and under a divider.**
   - The divider is a hairline in `--wt-color-border` with `--wt-space-1` above and below it.
   - Delete's label and icon are `--wt-color-danger`.
   - Red means the action destroys something. **Disable** and **Remove** can be undone, so they
     also go below the divider but stay in the normal colours.
   - A menu's other actions keep their current order.

4. **"…" only on actions that open a dialog asking for more**, for example Rename…, Copy… and
   Delete… when it asks for confirmation. Use the single "…" character, never three dots, in
   English and Spanish alike. Actions that take effect straight away, such as Make default and
   Move up, have no dots.

5. **The menu box** keeps its border, `--wt-shadow-2` and `--wt-radius-md`, but its padding
   drops to `--wt-space-1`. Its width is still its content's width, with a minimum of 12rem so
   that a short menu does not look stubby.

6. **Unchanged:** the ⋮ trigger, the single-Delete shortcut (a menu holding only Delete shows a
   bin and acts at once), placement, keyboard behaviour, `data-keep-open`, `wt-menu-row` help
   badges, and menus whose content is not a list of actions (the alerts bell's list keeps its own
   layout).

## Icon vocabulary

Every action in a `wt-row-actions` menu carries the icon for its verb. There is one icon per verb,
the same everywhere; a new kind of action adds a row here rather than picking an icon ad hoc. The
icons are Google's Material Symbols (outlined, weight 400), already used under Apache-2.0 in
`apps/dashboard/src/icons.ts` and `packages/ui/src/components/wt-combobox.ts`.

| Verb               | Material Symbol      | Actions it covers today (from the label keys)                                         |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| Open               | `arrow_forward`      | Open (menus, find bill, schedule, profile, station)                                   |
| Edit               | `edit`               | Edit, Edit details, a role's Edit, a reason's Edit                                    |
| Rename             | `edit_note`          | Rename (menus, floor plans, themes, courses)                                          |
| Copy               | `content_copy`       | Copy, Duplicate, Make a copy                                                          |
| Make default       | `star`               | Make default, Set as default, Use everywhere                                          |
| Move up / earlier  | `arrow_upward`       | Move up, Group earlier                                                                |
| Move down / later  | `arrow_downward`     | Move down, Group later                                                                |
| Move to…           | `swap_horiz`         | Move to another station                                                               |
| Settings           | `settings`           | Configure (modules), device zone settings                                             |
| Details            | `info`               | Payment details, About                                                                |
| Translations       | `translate`          | Edit translations, Add a version                                                      |
| Variants           | `layers`             | Set-menu variants                                                                     |
| Add                | `add`                | New bill, Add a spare, Add …                                                          |
| Invite / Enable    | `person_add`         | Enable and invite                                                                     |
| Resend             | `send`               | Resend invitation                                                                     |
| Reset login        | `key`                | Reset login                                                                           |
| Reset PIN          | `lock_reset`         | Reset PIN                                                                             |
| Account            | `person`             | Account settings                                                                      |
| Log out            | `logout`             | Log out                                                                               |
| Undo / Unserve     | `undo`               | Unserve                                                                               |
| Fire now           | `local_fire_department` | Send a course now (till)                                                           |
| Bill               | `receipt_long`       | Whole table (till)                                                                    |
| Remove             | `do_not_disturb_on`  | Remove (content languages), Void line                                                 |
| Disable            | `block`              | Disable                                                                               |
| Delete             | `delete`             | Delete, a period's Delete, an image's Delete                                          |

The third column is a starting map, not a complete list: the lane maps every action in every
`wt-row-actions` to a verb, and an action that fits none comes back to the owner with a proposed
row.

## How (a suggestion; the lane decides)

- Register the vocabulary once in `packages/ui`, beside the `kebab` registration in
  `packages/ui/src/components/wt-icon.ts`, so the dashboard, the till and every module package get
  the same icons. Convert each path to the 16×16 grid `registerIcons` expects, and carry the
  Apache-2.0 attribution as `wt-combobox.ts` does.
- Give each action a way to name its icon. One option is an `icon` property on `wt-button` that
  draws a leading `wt-icon`; slotted links and native buttons need the same. Another is for
  `wt-row-actions` to draw the icon from a `data-icon` attribute on each action. A `wt-button` in
  a menu gets the row look from `wt-row-actions`, not from a new variant every call site must set.
- Give the divider a name screens can use, such as a slotted `<hr>` that `wt-row-actions` styles.

## Checks

- `wt-row-actions` is a shared primitive. Update its token-painting test, and its
  `*.a11y.test.ts` must cover the new states in both themes: a row with an icon, a Delete row, a
  divider and a disabled row.
- Look at the result, in both themes and at phone width, on at least these menus: Menus (Open,
  Rename…, Copy…), Floor plans, Staff, Staff roles, the till's table actions, and the till's
  account menu. Post the screenshots in the PR.
- Update `docs/developers/design-system.md`'s `wt-row-actions` entry, which today says action
  labels are centred, and the Components section of `DESIGN.md`.
- Relabelled strings ("..." → "…") change in the English and Spanish translation files together.

## Implementation decisions, 2026-11-23

The watcher cleared the additions below after the owner's “icons: fine, we can make changes later
if we need to” at 21:16 in Lane K. Each icon is registered once in
`packages/ui/src/components/wt-icon.ts` under its action name. The check uses the same column in the
bill and counter-zone pickers. New bill uses Add. The separate reader dialog and the floor's
List/Map toggle keep their existing layouts. Disconnect and Unpair are red below the divider.
The watcher confirmed Unpair at 21:58. Delete stays last.

| Action | Material Symbol |
| --- | --- |
| Print or reprint | `print` |
| Archive | `archive` |
| Clear | `ink_eraser` |
| Follow the season | `event_repeat` |
| Cancel publication | `event_busy` |
| Cancel and credit | `assignment_return` |
| Disconnect or unpair | `link_off` |
| Pair again | `link` |
| Join or merge | `call_merge` |
| Split | `call_split` |
| Discount or comp | `percent` |
| Record unpaid departure | `credit_card_off` |
| Finish table | `done_all` |
| Cash in or out | `currency_exchange` |
| Close drawer | `point_of_sale` |
| Report a problem | `warning` |
| Clock in, start break, end break | `login`, `pause`, `play_arrow` |
| Retry clock read, My hours | `refresh`, `schedule` |
| List, Map and reset today's plan | `format_list_bulleted`, `map`, `restart_alt` |
| Download their data | `download` |
| Equipment label | `qr_code` |
| Current bill or counter zone | `check` |
