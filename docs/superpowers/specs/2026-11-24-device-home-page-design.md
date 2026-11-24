# Device home page: one page for every device, one Save

Status: approved by the owner, 2026-11-24 (interactive design session, quoted below: "this looks
good"). Follows the [menu editor design](2026-11-24-menu-editor-redesign-design.md), which left this
tab for its own round. **My call** marks the session's own choices that the owner was not shown.

## Why

The owner, on the Home page tab:

- "i don't think we need the Till vs Device thing. We can just have a single device home page. do we
  need to let the user choose the number of columns, or does that flow out of the layout on the device?"
- "Perhaps 'Home page' is not very meaningful"
- "the radio buttons for colours vs thumbnails and which section first don't look great"
- "on the device home page, i don't think we need the word 'Section', the folder icon works fine"
- "why does coffee show a price of 1.60€ when it has variants, should be a range"
- "perhaps we don't need 5.50€/ea, we can just say 5.50€? unless another unit is specified"

## Approaches for the columns

A setting per menu (today, one per kind of device), a setting on each device, or none, the layout
deciding. The owner chose none, asked about putting sections on a row of their own, and concluded
"the order is about muscle memory more than anything". Lost: up to 10 small columns on a large till. A
"start a new row" marker could be added later without a column setting; it is not in this work.

## Decisions

### The settings

- A menu has **one** home page display for every device: what tiles show, and what is shown first.
  The Handheld / Till choice and both column settings go, in the schema, the published document, the
  save and transfer requests and the dashboard.
- **Columns come from the layout**, by one rule shared by the till and the dashboard's preview
  (`HOME_GRID_COLUMNS`): about 3 on a phone (360 and 390 px wide), about 6 on a 1280 px counter till's
  menu area (792 px), fewer on a small tablet, and no more than about 6 or 7 on a large one, because
  tiles grow there. A minimum tile width of about 15% of the grid, between about 100 and 160 px, gave
  those numbers on paper; the lane measures it, at the larger text sizes too.
- Tiles show **Colours** or **Photos** (was Thumbnails). **Shown first** is Shortcuts or Full menu (was
  "After search", "Device Home Page first" / "Menu first"). Both are `wt-segmented-control`, in a row
  above the page. On a phone they stack, each with its label above and filling the width in two equal
  halves, so they line up in any language (owner: "it would be good if they were the same width so they
  line up on the phone, but difficult with different widths of text in different languages").

### The tab

- Named **Device home page** (Spanish: the lane proposes one that fits the tab row at 390 px), and the
  same words wherever the product says "Device Home Page".
- The page is drawn once, at most as wide as a counter till's menu area; on a phone, the phone's width.
  The "Preview" heading, "Table order preview" and its order pane, and the note about other menus go.
- Shortcuts keep their handle, bin, dashed missing and not-shown tiles, keys and drag.
- **One Add shortcuts tile** replaces Add products and Add sections, with products and sections in one
  searchable list. It adds them in the order chosen, as today.
- **Cancel and Save**, the same fixed bar as Structure's: adding, removing and reordering shortcuts and
  both settings wait for Save, which sends them together, all or nothing, and replaces what is there.
  Removing a shortcut asks nothing. Cancel, and leaving or changing tab with unsaved changes, ask.
  A shortcut whose target was deleted meanwhile is saved as the missing tile it would be today
  (**my call**).
- Saved changes are unpublished changes, as today.

### Tiles, on the till and in the dashboard

- The word **Section** goes from section tiles; the folder icon stays. With a photo, the folder is a
  small badge on it, so a section and a product differ. The tile's accessible name keeps "section". The
  till's "Nothing matches the filter" line stays.
- A product with variants shows the **range** of the prices its variants have on this menu, or one price
  when they are equal. Variants that cannot be ordered just now are left out unless none can
  (**my call**). In a set menu's folder, tiles keep saying what they say today.
- A price names its unit only when the unit is not Each: "€5.50", "€89.00/kg". Today's two writers are
  `#productButton` in `apps/till/src/widgets/menu-browser.ts` and
  `apps/dashboard/src/widgets/device-home-preview.ts`; they share one function after this.
- The folder rule, the range and the unit apply to every tile the menu browser draws: shortcuts, the
  full menu, inside a section and in search results.

### Guide and design contract

The Products guide's home page section, and the till guide where it describes the menu, in English and
Spanish. Rewrite, not append to, the Device Home Page paragraphs of
`docs/developers/design-system.md`.

## Delivery

1. Tiles: the range, the unit and the folder, on the till and in the preview. Small, and can land
   before anything else.
2. One display with no columns, and the joined buttons. It changes the menus schema and the published
   document, so it needs a venue reset, said in the PR's first line.
3. The tab: one page, one Add shortcuts, Cancel and Save. After the menu editor's Structure piece, whose
   bar and save it follows.

Screenshots for the owner before landing each: the tab and a real till and handheld, 1440, 1280 and
390 px, light and dark, English and Spanish, Colours and Photos, with and without shortcuts.

## Not in this work

The guest menu preview; Structure and Preview; what the till's search does.

## Pictures

Not committed. On the owner's machine, in the main checkout, `.impeccable/shots/menu-editor-mock-10.png`,
and `-11.png` for the two controls on a phone, in English and Spanish (its Spanish tab name is too long,
as it shows). Drawn, not screenshots: where they differ from a shared `wt-*` component, the component
wins. The prices and "Popular drinks" are invented.
