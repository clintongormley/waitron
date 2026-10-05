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
  - `standard` — `--wt-modal-standard-width: 40rem` (640px): an ordinary editor. It must hold a form
    at `--wt-form-max-width` (36rem = 576px) plus the body's inline padding at its largest
    (`--wt-space-5` each side = 48px), i.e. 624px, with room left for a classic scrollbar.
  - `wide` — the existing `--wt-modal-max-width: 64rem`, unchanged: tables wider than a form,
    side-by-side layouts, image grids, toolbars that need one line.
- **How it is wired.** The dialog keeps reading `--wt-modal-max-width`. `wt-modal`'s styles add
  `:host([size="compact"]) { --wt-modal-max-width: var(--wt-modal-compact-width); }` and the same for
  `standard`. `wide` and no attribute add NO rule, so they read the inherited `--wt-modal-max-width`
  exactly as today. Consequences, each a test case: an unset or unknown size renders as wide today; a
  `--wt-modal-max-width` set on an ANCESTOR still sizes an unsized or `wide` modal (the existing
  "follows its width, margin and padding tokens" test depends on this and must pass unedited); a
  value set on the modal element itself (inline style or an outer selector) beats the size, because
  outer rules win over `:host` rules.
- **Phone fit is untouched**: the width stays `min(<size>, 100dvw − 2 × --wt-modal-inline-margin)`,
  so every size fills a phone exactly as today. Height, body scrolling, footer, focus and the
  message placement are not changed.
- **Unset stays wide** rather than becoming standard, so this change alters no modal it does not
  name and no existing assertion; every product modal is given an explicit size in Task 2. The
  design-system doc tells authors to pick one.
- **The unit chooser (W66) is a `wt-dialog`, not a `wt-modal`** (`product-editor.ts`
  `renderUnitChooser()`), sized by `.unit-chooser { inline-size: var(--wt-form-max-width) }`
  because a dialog is as wide as its content. It stays a dialog (a full-height modal for one
  combobox would be worse); its content width moves to `--wt-modal-compact-width` so it shares the
  compact size. Record this in the PR.

## Task 1 — tokens, component, contract test, docs for the component

Files: `packages/ui-core/src/tokens/structure.css`, `packages/ui-core/src/tokens/structure.test.ts`,
`packages/ui/src/components/wt-modal.ts`, `packages/ui/src/components/wt-modal.test.ts`,
`packages/ui/src/components/wt-modal.a11y.test.ts`, `docs/developers/design-system.md`.

1. Failing tests first:
   - `structure.test.ts`: add both new tokens to the "defines the structural contract" list (a
     whole-list pin gaining keys, allowed — name it in the PR); a test that compact < standard <
     wide (`--wt-modal-max-width`) in pixels; a test that standard ≥ `--wt-form-max-width` + 2 ×
     `--wt-space-5`. Rename the title "the standard modal is 64rem wide, …" to "the wide modal is …"
     (title only, its assertions unchanged — "standard" now names the 40rem size).
   - `wt-modal.test.ts`: at 1280×900, `size="compact"`, `"standard"`, `"wide"` and unset each
     render `min(token, viewport − 2 × margin)` wide with equal side margins (unknown value, e.g.
     `size="huge"`, renders as wide); at 390×844 and 320×568 every size is `viewport − 2 ×
     margin`; the property reflects to the attribute and changing it at runtime re-sizes an open
     modal; an ancestor's `--wt-modal-max-width` sizes an unsized and a `wide` modal but not a
     `compact` one; an inline `--wt-modal-max-width` on a `compact` modal wins; the body's field
     cap (`--wt-field-max-width` = form width) holds in every size (a field in a compact modal is
     bounded by the body, not wider).
   - `wt-modal.a11y.test.ts`: axe on an open compact and an open standard modal in both themes
     (follow the file's existing pattern).
   Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-modal` and
   `pnpm --filter @waitron/ui-core exec vitest run src/tokens/structure` — watch them fail.
2. Implement: the two tokens in `structure.css` beside `--wt-modal-max-width` (one comment line for
   what each size is for); `@property({ reflect: true }) size?: "compact" | "standard" | "wide"` and
   the two `:host([size=…])` rules in `wt-modal.ts`.
3. Prove by deletion: remove each `:host` rule in turn and see its case fail; restore.
4. `design-system.md`: in the `wt-modal` section (≈ line 874) describe the three sizes, what each is
   for, that unset is wide, that authors pick one by content, and the override order; add the two
   tokens to the token list (≈ line 207) and to the sizes paragraph (≈ line 258); keep claims to what
   the tests show.
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
1. Where a consumer's suite already measures its modal, or the product editor's suite can, add a
   failing check that the modal states its size (e.g. `product-editor` renders `size="standard"`,
   `extra-list-form` `size="wide"`); at minimum one check per size in a consumer. Then set every
   attribute. Move `.unit-chooser`'s `inline-size` to `var(--wt-modal-compact-width)` with a check
   that the chooser's content is that wide (fails first).
2. Any existing test that pins a consumer modal's width or a layout that the narrower size changes:
   change it only if the new width is what W70 deliberately asks for, list it under "Changed test
   checks" in the PR; anything else is a STOP (queue rule 2026-10-05).
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
