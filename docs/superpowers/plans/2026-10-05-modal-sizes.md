# Modal sizes chosen for their content (W70) — plan

Status: ready. Branch `feat/modal-sizes`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-modal-sizes`. One pull request. No migration.

**Spec:** backlog W70 (owner 2026-10-04, on the Product editor: "the modal is too wide for these
forms. we need modals of different sizes for different display purposes"). Add a small, documented
set of responsive widths to the shared `wt-modal`, backed by `--wt-*` tokens; give the Product editor
and W66's unit chooser a narrower size; audit the other modals and give each a size by its content —
no widening everything, no one-off CSS. Keep the body/footer layout, focus, accessibility and phone
fit. Measure compact, standard and wide at desktop and phone width in both themes. A focused shared
component test for the size contract. Update `docs/developers/design-system.md` and
`docs/backlog.md`.

## Design

- **Three sizes, one attribute.** `wt-modal` gains a reflected `size` property:
  `"compact" | "standard" | "wide"`, default unset.
  - `compact` — `--wt-modal-compact-width: 28rem` (448px): a confirmation, or one or two short fields.
  - `standard` — `--wt-modal-standard-width: 42rem` (672px): an ordinary editor. The dialog is
    `box-sizing: border-box` with a 1px border, so its content is 672 − 2 − 48 (inline padding at its
    largest, `--wt-space-5` each side) = 622px; that holds a form at `--wt-form-max-width` (36rem =
    576px) beside a classic scrollbar (~15–17px) — the Product editor's body always scrolls.
  - `wide` — the existing `--wt-modal-max-width: 64rem`, unchanged: tables wider than a form,
    side-by-side layouts, image grids, toolbars that need one line.
- **How it is wired: the width is set on the size's own dialog, never passed down.** For each of
  compact and standard, `wt-modal` adds
  `:host([size="compact"]) dialog { width: min(var(--wt-modal-compact-width), calc(100dvw - 2 * var(--wt-modal-inline-margin))); }`
  (and the same for standard). Setting a custom property on the host instead would be inherited by
  a modal slotted inside it: a probe (plan review, Playwright Chromium 1.63, a stand-in element)
  showed a wide modal nested in a standard one rendering at the parent's width — the image chooser
  inside the Product editor would have shrunk. `wide` and unset add no rule and read
  `--wt-modal-max-width` exactly as today.
- **Override order** (each a test case): a compact or standard modal reads only its own size token,
  so `--wt-modal-max-width` set on an ancestor or on the element sizes only an unsized or `wide`
  modal (the existing "follows its width, margin and padding tokens" test sets it on an ancestor of
  an unsized modal and must pass unedited); to resize one sized modal, set its size token
  (`--wt-modal-compact-width`, `--wt-modal-standard-width`) on it. A wide or unsized modal opened
  inside a compact or standard one keeps 64rem.
- **Phone fit is untouched**: every size stays `min(<size>, 100dvw − 2 × --wt-modal-inline-margin)`,
  so every size fills a phone exactly as today. Height, body scrolling, footer, focus and message
  placement are not changed — so a compact confirmation is a narrow full-height column; screenshot
  one and list it in the PR as an open point (height is out of scope).
- **Unset stays wide** rather than becoming standard: those are the values today's tests pin, a
  too-wide modal still shows everything where a too-narrow one scrolls sideways, and every product
  modal is given an explicit size in Task 2. The design-system doc tells authors to pick one.
- **The unit chooser (W66) is a `wt-dialog`, not a `wt-modal`** (`product-editor.ts`
  `renderUnitChooser()`); a full-height modal for one combobox would be worse, so it stays a
  dialog. It takes the compact size the way `design-system.md` (≈262) documents resizing a dialog:
  `--wt-dialog-max-width: min(90vw, var(--wt-modal-compact-width))` on the chooser's `wt-dialog`,
  keeping the content's `inline-size` (form width) and `max-inline-size: 100%` so it fills. Update
  the comment at `product-editor.ts` ≈272. Its existing tests only check `box.width > 0`
  (`product-editor.test.ts` ≈498) and axe (`product-editor.a11y.test.ts` ≈324) — no assertion changes.
- **Order and neighbours.** The spec says W70 comes after W69; the watcher reversed that in lane B's
  queue (2026-10-05 ~05:40: lane A starts W69 only after W70 lands). Lane C's held PR #1208 (W71g)
  touches `wt-modal.test.ts`, `wt-dialog.test.ts`, `design-system.md` and `backlog.md`; whichever
  lands second rebases.

## Task 1 — tokens, component, contract test, docs for the component

Files: `packages/ui-core/src/tokens/structure.css`, `packages/ui-core/src/tokens/structure.test.ts`,
`packages/ui/src/components/wt-modal.ts`, `packages/ui/src/components/wt-modal.test.ts`,
`packages/ui/src/components/wt-modal.a11y.test.ts`, `docs/developers/design-system.md`.

1. Failing tests first:
   - `structure.test.ts`: add both new tokens to the "defines the structural contract" list (a
     whole-list pin gaining keys, allowed — name it in the PR); a test that compact < standard <
     wide (`--wt-modal-max-width`) in pixels; a test that standard − 2 × 1px border − 2 ×
     `--wt-space-5` − 17px (a classic scrollbar) ≥ `--wt-form-max-width`. Rename the title "the standard modal is 64rem wide, …" to "the wide modal is …"
     (title only, its assertions unchanged — "standard" now names the 42rem size).
   - `wt-modal.test.ts`: at 1280×900, `size="compact"`, `"standard"`, `"wide"` and unset each
     render `min(token, viewport − 2 × margin)` wide with equal side margins (unknown value, e.g.
     `size="huge"`, renders as wide); at 390×844 and 320×568 every size is `viewport − 2 ×
     margin`; the property reflects to the attribute and changing it at runtime re-sizes an open
     modal; an ancestor's `--wt-modal-max-width` sizes an unsized and a `wide` modal but not a
     `compact` or `standard` one; `--wt-modal-compact-width` set on a compact modal resizes it; a
     wide and an unsized modal slotted inside an open compact and an open standard modal keep the
     64rem width (this case fails if the size is passed down as a custom property); the body's field
     cap (`--wt-field-max-width` = form width) holds in every size (a field in a compact modal is
     bounded by the body, not wider).
   - `wt-modal.a11y.test.ts`: axe on an open compact and an open standard modal in both themes
     (follow the file's existing pattern).
   Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-modal` and
   `pnpm --filter @waitron/ui-core exec vitest run src/tokens/structure` — watch them fail.
2. Implement: the two tokens in `structure.css` beside `--wt-modal-max-width` (one comment line for
   what each size is for); `@property({ reflect: true }) size?: "compact" | "standard" | "wide"` and
   the two `:host([size=…]) dialog { width: … }` rules in `wt-modal.ts`.
3. Prove by deletion: remove each rule in turn and see its case fail; restore. Also rewrite one rule
   temporarily as a host custom property and see the nested-modal case fail; restore.
4. `design-system.md`: in the `wt-modal` section (≈ line 874) describe the three sizes, what each is
   for, that unset is wide, that authors pick one by content, and the override order; add the two
   tokens to the token list (≈ line 207) and to the sizes paragraph (≈ 258). Fix the sentences the
   change makes stale: ≈260–262 ("`wt-modal` is at most `64rem`", "Overriding `--wt-modal-max-width`
   therefore resizes `wt-modal` alone"), ≈273 ("There is one standard modal size"), ≈1876 (profile
   "bounded by `--wt-modal-max-width` like any other"). "Standard" now names both the form width
   (≈268) and a modal size: make the doc tell them apart (call the form width "the form width");
   leave test titles alone. Keep claims to what the tests show.
5. `pnpm --filter @waitron/ui exec vitest run src/components/wt-modal src/no-hardcoded-chrome`,
   the ui-core structure test, `pnpm --filter @waitron/ui typecheck`, `pnpm format:check`.
   Commit `-s`.

## Task 2 — give every modal its size, look at them, backlog

Assign by the content survey (one `size=` attribute per `<wt-modal`; a mode-dependent size only
where one element serves modes of clearly different sizes). Re-read each before setting it.

| Size | Modals |
| --- | --- |
| compact | `catalogue-screen.ts` delete confirmation (≈774); `menus-screen.ts` `#formModal` (≈1745: layout name, include, delete); `printers-screen.ts` edit agent (≈1863), add printer by name (≈2769), Bluetooth PIN (≈2826); `add-content-language.ts`; `catalogue-browser.ts` in Move mode; `image-library.ts` delete confirmation (≈803); `prep-stations-screen.ts` watcher remove (≈1351), switch-off/close/open (≈1659), and the claim-folder and delete-exception modes of ≈1434; `reasons-screen.ts` deactivate mode; `venue-operations-screen.ts` confirm-remove mode; `profile-screen.ts` modes other than details and authenticator setup; demo "Create team member" |
| standard | `dashboard-app.ts` profile (≈1745); `profile-screen.ts` details and authenticator setup; `catalogue-screen.ts` courses (≈810); `menus-screen.ts` add products (≈2362); `modifiers-screen.ts` both (≈683, ≈712: one-column tables); `printers-screen.ts` add agent (≈1812), edit printer wizard (≈2507); `add-to-menus.ts`; `catalogue-browser.ts` delete modes; `menu-prices-table.ts`; `option-label-form.ts`; `option-list-form.ts`; `person-edit.ts`; `person-form.ts`; `print-job-preview.ts`; **`product-editor.ts`**; `section-details-form.ts`; `unit-form.ts`; `variant-form.ts`; `apps/till/src/widgets/modifier-picker.ts`; `reasons-screen.ts` form mode; `image-library.ts` upload/edit (≈579); `prep-stations-screen.ts` watcher form (≈1326), station and exception modes of ≈1434; `venue-operations-screen.ts` other modes; demo "Add printer" |
| wide | `printers-screen.ts` discover printers (≈3002: two-column table, 40vw parts); `units-screen.ts` delete unit (≈504: toolbar ≈650px + three-column table); `extra-list-form.ts` (table min-width 696px); `image-upload.ts` (embeds the image library's card grid); `image-library.ts` viewer (≈488: photo beside its uses); `prep-stations-screen.ts` preview table (≈1564); `station-hours-form.ts` (one row of three 145px+ controls and Remove) |

Steps:
1. Failing checks first that MEASURE, not only read the attribute: the Product editor's dialog is
   the standard width in pixels at 1280; the image chooser opened from the Product editor is the
   wide width (fails if a size leaks into a nested modal); the unit chooser dialog is the compact
   width at 1280; `extra-list-form`'s dialog is wide and `add-content-language`'s compact. Then set
   every attribute and the unit chooser's `--wt-dialog-max-width`.
2. Existing checks the narrower sizes change. Known now: `add-content-language.test.ts` ≈201
   ("holds the field and its error to the standard form width…") expects a body wider than 576px and
   a ~576px field; a compact body is narrower. Rewrite it to check the field and its error fill the
   compact body's content width — as strict as before — and list it under "Changed test checks".
   The other form-width checks map to standard and still fit (`profile-screen.test.ts` ≈483,
   `reasons-screen.test.ts` ≈655, `venue-operations-screen.test.ts` ≈545, `printers-screen.test.ts`
   ≈557); confirm by running them. Any other check that breaks: change it only if the new width is
   what W70 deliberately asks for and list it; anything else is a STOP (queue rule 2026-10-05).
3. Run the touched consumers' focused suites (`apps/dashboard`, `apps/till`,
   `packages/adjustments`, `packages/media`, `packages/venue-service`).
4. **Look.** Open a compact (add content language), a standard (Product editor with variants and
   modifiers; Extras is wide), and a wide (Extras editor table, image chooser) modal at 1280 and 390
   wide in light and dark themes, with the workspace's playwright Chromium against the dev stack
   (`wa-wt demo waitron-feat-modal-sizes`) or the browser-mode harness; record the measured widths
   in the PR. Check nothing in a standard modal now scrolls sideways at 1280 (the product editor's
   variant and modifier tables, the edit-printer wizard rows, the add-products filter row).
5. `docs/backlog.md`: mark W70 done with the PR number placeholder the land step fills; note the
   unit chooser decision. `pnpm format:check`, typecheck of the touched packages. Commit `-s`.

## Not in scope

W69 (unsaved-changes warning) also changes `wt-modal`; lane A starts it after this lands. Modal
height, body/footer structure and message placement are unchanged.
