# A404 — adding and calibrating a printer: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Dispatch every implementer as
> `subagent_type: "implementer"`.

**Goal:** Make the Add a printer dialog and the three-step calibration window say what is going
on and read in order — the eight points of the owner's A404 list.

**Architecture:** Almost all of it is the dashboard's Printers screen
(`apps/dashboard/src/screens/printers-screen.ts`) and its words (`apps/dashboard/src/i18n/strings.ts`,
English and Spanish — the dashboard ships no other language: `catalogues`, `strings.ts:7559-7564`).
Two server changes: the discovery list keeps a paired Bluetooth printer marked as a printer
(`apps/server/src/print-api.ts`), and the calibration sample receipt prints dish names that use each
receipt language's accented letters (`apps/server/src/sample-receipt.ts`, the names kept per language
in the Spain country pack). One small primitive addition: `wt-input` gains `select()`.

**Tech stack:** Lit web components, Vitest 4 (browser mode, real Chromium, for the dashboard and
`ui-core`; Node for the server and the country packages), Hono.

**Spec:** `docs/backlog/printers.md`, section "A404 — adding and calibrating a printer" (points 1–8).
A405 ("printer details and the print queue", just below it) is a separate item and is not planned
here; the only A405-related work is that point 4's new label also shows on today's printer details,
which is automatic because both read the same string (`printers.portable`, used at
`printers-screen.ts:2978` and `:3556`).

## Global constraints

- **A1308 hold:** no new or changed table, column, index, trigger or schema file. Nothing below
  needs one; if a step seems to, stop and report rather than work around it.
- No location concept anywhere: nothing new is keyed per location.
- Code is English; Catalan, Galician, Basque and Spanish words go only in
  `packages/country-es` (a Spain-specific package, allowed by CLAUDE.md §3) and in the dashboard's
  Spanish catalogue and the Spanish guide.
- Product text is as short as the meaning allows. Hints are placeholders or a muted line under the
  control, never a "?" button. The words in "New words for the owner" are the words to use, exactly.
- Forms follow `docs/developers/design-system.md` → Forms. A switch's explanation is drawn by the
  screen as a hint line and also passed as the switch's `description` (the `wt-switch` row of the
  primitives table, `design-system.md:862`).
- TDD: the failing test first, run it, watch it fail for the stated reason, then the code.
- An existing assertion may change only where the spec changes what it checks; each such change is
  listed under "Existing tests whose assertions change" and named in the PR description.
- Dashboard tests run real headless Chromium: check `memory_pressure | grep free` first and run
  beside another browser run only well above 15% free.
- Every commit `git commit -s`, message in plain English.
- Update the ledger `docs/handoffs/2026-11-05-a404-add-calibrate-printer.md` at the end of every task.

## The QR question (point 2), settled from the code

**Printing does need the resolution in its own right, and the QR square is the only physical
measure of it, so the QR question stays and point 2 is re-laid out as the spec describes.**

- The receipt's QR code is sized in millimetres from the stored resolution:
  `chooseQrDots(matrix.length, dpiValue(printer.resolution), safeWidthDots(printer.paperWidth))`
  (`apps/server/src/receipt-ticket.ts:156-163`), which takes the largest whole-dot scale up to
  `QR_MAX_MM = 40` (`packages/printing/src/layout.ts:151-168`). The same call sizes the portable
  printer's equipment label (`apps/server/src/equipment-label.ts:42-44`) and the printer test page
  (`apps/server/src/printer-test-page.ts:58-60`). The law's limit is quoted in
  `docs/compliance/verifactu-findings.md:1000`: «El código «QR» deberá tener un tamaño entre 30x30 y
  40x40 milímetros».
- Experiment (a throwaway Vitest case in `apps/server`, deleted afterwards): a 49-square code (a
  Veri\*Factu-length link) gets 5 dots a square when the printer is stored as 180 dpi and 6 when
  stored as 203 dpi. Printed for real: stored 180 / printer really 180 → 34.6 mm; stored 180 /
  really 203 → 30.7 mm; stored 203 / really 203 → 36.8 mm; **stored 203 / really 180 → 41.5 mm,
  over the 40 mm limit.** The failing case would have printed the same size whatever the stored
  resolution; it did not.
- The ruler alone does pick a (paper width, resolution) pair, because each of the four dot widths
  in `SETTING_WIDTHS` belongs to one pair (`layout.ts:30-39`). But two of those four widths are not
  measured (`layout.ts:22-29`: 384 "not a measured printable width", 576 "unmeasured"), so a printer
  whose head is not one of the four is stored with the wrong resolution unless something measures it
  independently. The QR square is that measure, and the existing mismatch line
  (`printers.ruler_disagrees`, `printers-screen.ts:3509-3515`) is where the two disagree.
- Every other consumer reads the pair through `textGrid` (dots across and columns:
  `print-api.ts:1396`, `:1521`, `receipt-preview-api.ts:263`, `packages/printing/src/escpos.ts:55`)
  or passes both fields on (`kitchen-print.ts:151-167`, `payment-slip-print.ts:99`,
  `orders-reprint.ts:24`, `invoice-delivery-actions.ts:90`, `report-api.ts:389`). Nothing stores
  millimetres, and nothing needs a field removed, so point 2 needs no schema change.

## Point 6 (a paired Bluetooth printer comes and goes), the cause

**Not the 45-second limit.** A paired printer is refreshed on every pull, so it never ages out: the
agent sends its paired devices as `visible` and as `pairedBluetooth` on every pull
(`packages/print-agent/src/agent.ts:650-654`, `:719-723`; `apps/print-agent/src/linux-devices.ts:165-177`
reports every paired device as visible), and both set `lastSeenAt: now`
(`apps/server/src/print-api.ts:612-639`). The paired-listing reuse window (`PAIRED_REUSE_MS`,
`linux-devices.ts:47`, `:138-150`) serves only a job's delivery path (`pairedFor`), not the list.

**The cause:** a `visible` report replaces the stored entry's description with its own fields
(`remember`, `print-api.ts:612-628`), and a visible report never carries `printerLike`
(`screenVisible`, `print-api.ts:277-298`). So every plain pull wipes the printer mark that a scan
set, and the dialog hides an unmarked Bluetooth device unless Show all devices is on
(`shown`, `printers-screen.ts:3922-3923`). A scan's results reach the server once, on the pull
after its pass ends (`agent.ts:656-658`, `:745`), so the printer shows for one pull and goes on the
next — missing while a scan runs, listed as it ends, missing again — exactly the owner's account.
The dashboard keeps reading the list after its scan ends, through its live subscription
(`printers-screen.ts:1010-1013`).

**Experiment (run, then deleted):** a case in `print-api.test.ts` pulled once with
`visible + scanned(printerLike: true) + pairedBluetooth`, then once with `visible + pairedBluetooth`.
`GET` of the discovered list gave `{"printerLike":true,"paired":true}` after the first pull and
`{"paired":true}` — no `printerLike` — after the second. The fix (Task 1) touches no table: the
list is held in memory.

## Points held, and one left to the owner

- **No point is held for the schema.**
- **Point 3's rules are already printed, bar one, which is left to the owner.** The spec (written
  2026-10-08) asks for rules after the venue name and NIF, before the first item, before the tax
  lines and before the total. A497 (#1560, 2026-10-12) and A663 added ruled sections since; today's
  Spanish 80 mm sample (printed with `printedLines`, experiment above) reads: header, rule, order and
  invoice lines, rule, the item, rule, `TOTAL`, `Base imponible 10%`, `IVA 10%`, rule, payment. So
  three of the four rules exist. The fourth — between `TOTAL` and the tax lines — would change every
  real simplified receipt, whose "TOTAL straight after the items, then the rates" layout the owner
  settled in A663 (`docs/superpowers/plans/2026-10-15-a663-receipt-layout.md:52`, `:1122-1129`).
  The sample must look like a real receipt, so it is not drawn here; Task 8 records it as a short
  open question in the backlog, and the PR description asks the owner.

## PR split

Eight tasks, so two PRs, in order. PR 2 is branched from `main` after PR 1 lands, because both
change `printers-screen.ts` and `strings.ts`.

- **PR 1 — "Adding a printer"** (this worktree and branch,
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a404-add-calibrate-printer`,
  `feat/a404-add-calibrate-printer`): Tasks 1–4, points 1, 5, 6, 7 and 8. No risk trigger
  (discovery state is in memory; UI; an additive primitive method): the light review path.
- **PR 2 — "Calibrating a printer"** (new worktree:
  `python3 ~/workspace/tools/worktree.py new waitron feat/a404-calibrate-printer --headless`, after
  syncing `main`): Tasks 5–8, points 2, 3 and 4. Task 5 changes the `CountryPack` interface in
  `packages/country`, a cross-package contract: the full review path.

## Review focus

The five inputs most likely to bite that no step below would otherwise test; each has its test in
the owning task.

1. The Add dialog left open for minutes with a paired Bluetooth printer and no scan running — the
   printer must stay listed through many plain pulls and past 45 seconds (Task 1).
2. A sample dish name holding a letter the printer font lacks would print with its accent silently
   dropped by `prepareText` — every listed name must survive `prepareText` unchanged (Task 5).
3. A 58 mm roll: the longest Catalan name wraps; every name must still be printed whole (Task 5).
4. The Spanish screen at phone width (390 px): the calibration window's button row, answer row and
   result row must not run past the modal (Task 6).
5. A name dialog opened on a device discovery found no name for: the address fills the field, and
   typing replaces it rather than appending (Task 3).

## New words for the owner

Shown to the owner before either PR lands. "New" adds a key; "changed" replaces an existing key's
text; "removed" deletes the key from both catalogues.

### Dashboard (`apps/dashboard/src/i18n/strings.ts`)

| Point | Key | Kind | English | Spanish |
| --- | --- | --- | --- | --- |
| 1 | `printers.scan_empty` | new | No printers found yet. Still searching… | Aún no se ha encontrado ninguna impresora. Seguimos buscando… |
| 1 | `printers.no_discovered` | changed | No printers found. Check that the printer is on and connected, then scan again. | No se ha encontrado ninguna impresora. Comprueba que esté encendida y conectada, y vuelve a buscar. |
| 8 | `printers.bluetooth_pair_note` | changed | A Bluetooth printer must be in pairing mode before you add it. | Una impresora Bluetooth debe estar en modo de emparejamiento antes de añadirla. |
| 2 | `printers.ruler_print` | changed | Print width test | Imprimir prueba de ancho |
| 2 | `printers.resolution_hint` | changed | Print the width test. Choose the last number you can see in full on the ruler, and measure the QR code’s black square without its white border. You do not need to scan it. | Imprime la prueba de ancho. Elige el último número de la regla que se ve entero y mide el cuadrado negro del código QR sin su borde blanco. No hace falta escanearlo. |
| 2 | `printers.qr_square` | new | QR code’s black square | Cuadrado negro del código QR |
| 2 | `printers.test_qr_help` | removed | (was the separate QR paragraph; its words are now in `printers.resolution_hint`) | |
| 4 | `printers.portable` | changed | Portable printer | Impresora portátil |
| 4 | `printers.portable_hint` | new | Carried by one person, such as a belt printer. One device holds it at a time; another device can take it over. Leave off for a fixed printer that devices share. | La lleva una persona, como una impresora de cinturón. La tiene un solo dispositivo a la vez; otro puede quedársela. Déjalo desactivado para una impresora fija que comparten los dispositivos. |
| 4 | `printers.calibration_drawer` | changed | Cash drawer and portable use | Cajón portamonedas y uso portátil |

Unchanged and reused by point 2's result row: `printers.paper_width` (Paper width / Ancho del
papel), `printers.resolution` (Print resolution / Resolución de impresión),
`printers.paper_width_58`/`_80` (58 mm / 80 mm), `printers.resolution_180`/`_203` (180 dpi / 180 ppp,
203 dpi / 203 ppp), and the QR answers `printers.test_qr_40`/`_45` (Closer to 40 mm / Más cerca de
40 mm; Closer to 45 mm / Más cerca de 45 mm). `printers.ruler_disagrees` stays as it is.

### Printed on the calibration sample receipt and the A4 test page (`packages/country-es`)

The line «Café, jamón, niño, pingüino · 5 €» (`sampleFooter`) is removed in every language. These
dishes are added after the existing sample dish, each `1 ×` at 2,20 €:

| Receipt language | Dishes added | Letters they cover |
| --- | --- | --- |
| Spanish (`es-ES`) | Atún con piña · Jamón con melón · Plátano frito · Maíz tostado · Güisqui con hielo | á é (in the existing «Café y tostada») í ó ú ü ñ |
| Catalan (`ca-ES`) | Pa amb tomàquet · Pastís de préssec · Suc de raïm · Arròs de caça · Mató amb mel · Postres de músic · Aigües amb gas · Col·lecció de formatges | à è (in «Cafè i torrada») é í ï ò ó ú ü ç l·l |
| Galician (`gl-ES`) | Polbo á feira · Queixo do país · Pementos de Padrón · Empanada de atún · Viño do Ribeiro | á é (in «Café e torrada») í ó ú ñ |
| Basque (`eu-ES`) | Iruñeko txistorra | ñ |
| English (`en-GB`) | (none — English writes no accented letters) | |

These names were written by a non-native writer: the owner should check each language.

### Guide (new page `apps/server/src/guide/en/printers.md` and `es/printers.md`)

The full text of both pages is in Tasks 4 and 8 and goes to the owner with the table above.

## Existing tests whose assertions change

Each is allowed because the spec changes what it checks; name each in its PR.

PR 1:
- `printers-screen.test.ts` "leaves the empty discovered table without a message while Scan's
  spinner runs" — now expects `printers.scan_empty` (point 1). Rename it "says no printers are found
  yet while Scan's spinner runs".
- `printers-screen.test.ts` "offers Pair and add, not Add, for an unpaired printer-like device, and
  Add for a paired one" — its `bluetooth-note` text assertion reads the new one-line key (same key,
  new words; the assertion line itself is unchanged).
- `printers-screen.test.ts` "names a new A4 printer in a dialog whose Add waits for a name, then
  adds it from the row's discovery entry" — Add is enabled at open with the discovered name filled
  in (point 7). Its whitespace and "Back office" steps stay.
- `page-printer-add.unsaved.test.ts` — any case that assumes the name starts empty (point 7).

PR 2:
- `printers-screen.test.ts`: "keeps the printer's saved paper width and resolution when calibration
  is run again", "asks the width step's three questions in labelled dropdowns showing the printer's
  saved settings", the `it.each` "derives layout settings from the ruler and QR answers (%s)", "says
  when the ruler's number and the chosen paper width and resolution disagree, without stopping the
  save", "leaves the paper width alone when the ruler's answer is set back to Choose", "keeps the
  width step's rows, and the button beside the ruler's answer, within the form width on a wide
  window" (rewritten for the new layout) — the paper width is now a result, not a dropdown, and the
  QR answer has its own name (point 2).
- `printers-screen.test.ts` "clears the ruler answer when paper width is changed directly" —
  **deleted**: point 2 removes the direct paper-width control it tested.
- Setup-only changes (assertions kept, only how the draft is changed): "opens calibration after
  adding, and saves the tested draft", "saves changed paper width and resolution through calibration
  alone", "uses explicit width and resolution, and prints a sample from the calibration draft",
  `printer-calibration.unsaved.test.ts`, `printers-screen.save-state.test.ts` and the step-1 states
  of `printers-screen.a11y.test.ts` — a change of paper width is made through the ruler's answer
  (`360` for 58 mm, `512` for 80 mm) instead of the removed dropdown, and `printer-resolution`
  becomes `printer-qr-square`.
- `apps/server/src/sample-receipt.test.ts`: "A965 sample language keeps %s sample and document
  inputs together" (no footer; the document's sale now differs from the preview's sale by the added
  dishes) and "draws at the selected setting and prints an unmistakably simulated realistic receipt"
  (no «pingüino» line; the total follows the added dishes) (point 3).
- `packages/country-es/src/spain.test.ts` "translates the sample names into %s without repeating the
  table caption" — no `sampleFooter` (point 3).

---

## PR 1 — Adding a printer

### Task 1: A paired Bluetooth printer stays listed (point 6)

**Files:**
- Modify: `apps/server/src/print-api.ts` (`remember`, about lines 612-628)
- Test: `apps/server/src/print-api.test.ts`, inside `describe("Bluetooth Pair and Forget commands")`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests** next to "keeps a scan's description when a later pairing
  report arrives, and drops the row once both are stale":
  - `it("keeps a scanned printer marked as a printer while later pulls report it only as paired and visible")`:
    with `Date.now` mocked, pull at `start` with
    `visible: [{ transport: "bluetooth", localKey: mac, model: "BlueTooth Printer" }]`,
    `scanned: [scannedMac(mac, { name: "BlueTooth Printer", printerLike: true })]`,
    `pairedBluetooth: [{ localKey: mac, name: "BlueTooth Printer" }]`; then pull with only the
    `visible` and `pairedBluetooth` entries at `start + 2_000`, `start + 30_000` and
    `start + 60_000`. After each, the row for `mac` matches
    `{ printerLike: true, paired: true, name: "BlueTooth Printer" }`. (Today the first plain pull
    already drops `printerLike`.)
  - `it("takes a later scan's answer over an earlier printer mark")`: pull with
    `scanned: [scannedMac(mac, { printerLike: true })]`, then with `scanned: [scannedMac(mac)]`; the
    row has no `printerLike` property. (Guards against the fix making the mark sticky for scans; it
    passes today and must still pass.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts -t "printer mark"`
  — the first FAILS (`printerLike` missing after the first plain pull); the second passes. Read the
  `Tests` count.
- [ ] **Step 3: Implement.** In `remember`, when `stamp === "visibleAt"`, carry `prior?.printerLike`
  onto the new entry (a visible report never classifies a device); a scanned report keeps setting it
  from its own fields as today.
- [ ] **Step 4: Run** the same command, then the whole file
  `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts` — all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A paired Bluetooth printer stays listed as a printer between scans (A404 point 6)"`.

### Task 2: The Add a printer dialog says what is happening, and its rows line up (points 1, 5 and 8)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderNewPrinter`, about 3895-4160;
  styles `::part(discovered-details)` 240-243, `::part(bluetooth-actions)` 269-278)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.scan_empty` new,
  `printers.no_discovered` and `printers.bluetooth_pair_note` changed — words from the table)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**
  - Point 1: change "leaves the empty discovered table without a message while Scan's spinner runs"
    to "says no printers are found yet while Scan's spinner runs": `table.emptyMessage` is
    `t("printers.scan_empty", "es-ES")`. Keep "shows the empty discovery message after scanning
    finishes" as it is (it reads `printers.no_discovered` by key).
  - Point 8: `it("shows the one-line pairing note only while a Bluetooth printer is listed")`: with
    only a Bluetooth device that is not printer-like (hidden until Show all devices),
    `[data-test=bluetooth-note]` is absent; after pressing `show-all-bluetooth` it shows
    `t("printers.bluetooth_pair_note")`; with a printer-like Bluetooth device it shows at once. Keep
    "says nothing about Bluetooth when no Bluetooth device was found".
  - Point 5, at `page.viewport(1280, 800)`, with discovered rows of an office printer named
    "HP Color LaserJet MFP M181fw" (`ippOnly`, `serverName: "DE0887"`) and a paired printer-like
    Bluetooth device (Add and Unpair):
    `it("draws a long discovered name on one line in its column")`: the row's `<strong>` has
    `getClientRects().length === 1`;
    `it("lines each discovered row's details up with its buttons")`: for each row, the vertical
    centre of the `<strong>` is within 2 px of the vertical centre of the row's first `wt-button`.
    At `page.viewport(390, 844)`, `it("keeps the discovered list inside the dialog at phone width")`:
    the table's right edge is not past the modal body's.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "Spinner|pairing note|discovered name|discovered row|discovered list"`
  (use the exact names) — point 1 FAILS on the empty message, point 8 FAILS where only a hidden
  device is found, point 5 FAILS on the line count and the centres.
- [ ] **Step 3: Implement.**
  - `emptyMessage`: `t(this.scanning ? "printers.scan_empty" : "printers.no_discovered")`.
  - The note shows when `rows` (what the list draws) holds a Bluetooth row, not when `addable` does.
  - Line the rows up: find what puts the name below the buttons (the cell's alignment and the
    `bluetooth-actions` flex box), fix it in the screen's `::part` styles, and widen the name's
    `max-width: min(28vw, 24dvh)` cap so a name takes its column (the `24dvh` term is what wraps it
    at 1280 × 800: 192 px), keeping a cap so a phone's list does not widen past the screen. Styles
    only through `::part`, with `--wt-*` tokens.
- [ ] **Step 4: Run** the whole file, then `src/screens/printers-screen.a11y.test.ts` — all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Add a printer says it is still searching, lines its rows up and keeps the Bluetooth note to one line (A404 points 1, 5 and 8)"`.

### Task 3: Both name dialogs open with the name filled in and selected (point 7)

**Files:**
- Modify: `packages/ui-core/src/components/wt-input.ts` — add `select(): void`
- Test: `packages/ui-core/src/components/wt-input.test.ts`
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderPrinterName`, `#openPagePrinterAdd`
  1390-1395, `#renderPagePrinterAdd`)
- Modify: `apps/dashboard/src/widgets/page-printer-add.ts`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`,
  `apps/dashboard/src/widgets/page-printer-add.unsaved.test.ts`
- Modify: `docs/developers/design-system.md` — the `wt-input` row of the primitives table (line 858)
  names the new method.

**Interfaces:**
- Produces: `WtInput.select(): void` — selects the native input's whole text (no-op before first render).
- Produces: `PagePrinterAdd.suggestedName: string` (`@property({ attribute: false })`, default `""`).

- [ ] **Step 1: Write the failing tests.**
  - `wt-input.test.ts`: `test("select() selects the whole value of the native input")` — value
    `"Bar printer"`, after `el.select()` the inner input's `selectionStart` is 0 and
    `selectionEnd` is 11.
  - `printers-screen.test.ts`:
    `it("opens the receipt printer's name dialog with the discovered name selected, so typing replaces it")`
    — open Add on a device named "HP Color LaserJet MFP M181fw" (`ippOnly`, `serverName: "DE0887"`):
    the field's value is `"HP Color LaserJet MFP M181fw (DE0887)"`, the confirm button is enabled,
    the native input's whole text is selected, and after `userEvent.keyboard("Bar")` the value is
    `"Bar"`.
    `it("fills the name with the address when discovery found nothing else")` — a network device with
    only `host: "192.168.10.81"`: value `"192.168.10.81"`.
    `it("opens the A4 printer's name dialog with the discovered name filled in and Add ready")` —
    `[data-test=page-printer-add-modal] wt-input[name=name]` value is the device's discovered label,
    its text is selected, `confirm-add-page-printer` is enabled at open, and pressing it sends that
    name to `registerPagePrinter`.
  - `page-printer-add.unsaved.test.ts`: closing at once after open asks nothing (the filled-in name
    is the dialog's starting point, not an edit).
- [ ] **Step 2: Run**
  `pnpm --filter @waitron/ui-core exec vitest run src/components/wt-input.test.ts -t "select"` —
  FAILS (`select` is not a function);
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "name dialog|fills the name"`
  — the receipt dialog FAILS on the selection (value and Add already pass today), the A4 dialog
  FAILS on the empty value and disabled Add.
- [ ] **Step 3: Implement.**
  - `WtInput.select()` calls the inner input's `select()`.
  - Both dialogs call `select()` on their name field once the modal has opened and focused it.
  - `#openPagePrinterAdd` passes `suggestedName: this.#discoveredLabel(device)` through
    `addingPagePrinter`; `PagePrinterAdd` starts `name` and `#baseline` from `suggestedName` when a
    new `entry` arrives, and its Add uses `saveActionState(this.#scope, { savableAtOpen: true })`.
- [ ] **Step 4: Run** the three test files whole, plus `src/screens/printer-name.unsaved.test.ts` and
  `src/widgets/page-printer-add.unsaved.test.ts` — all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Name dialogs open with the found name filled in and selected, ready to type over (A404 point 7)"`.

### Task 4: PR 1's guide, backlog and a look at it

**Files:**
- Create: `apps/server/src/guide/en/printers.md`, `apps/server/src/guide/es/printers.md`
- Modify: `apps/server/src/guide-catalogue.ts` — add `"printers"` to `GUIDE_PAGES`
- Modify: `docs/backlog/printers.md` (the A404 section)

- [ ] **Step 1: Check no guide already covers the Printers screen** —
  `git grep -n -i "add a printer\|añadir impresora\|calibrat" -- apps/server/src/guide` prints
  nothing today (checked 2026-11-05). If it prints a match, update that page instead of creating one.
- [ ] **Step 2: Write the page.** English:

  ```markdown
  # Printers

  ## Add a printer {#add-printer}

  In **Printers**, choose **Add a printer**. Waitron searches for network, USB and Bluetooth
  printers; each one found appears with **Add**. Choose **Add**, change the name if you like, and
  choose **Add** again. Calibration opens next.

  A Bluetooth printer must be in pairing mode first. Choose **Pair and add** beside it and enter
  its PIN.

  If a network printer is not found, open **Check a known address** and type its address.
  ```

  Spanish (`es/printers.md`, same ids):

  ```markdown
  # Impresoras

  ## Añadir una impresora {#add-printer}

  En **Impresoras**, elige **Añadir impresora**. Waitron busca impresoras de red, USB y Bluetooth;
  cada una que encuentra aparece con **Añadir**. Elige **Añadir**, cambia el nombre si quieres y
  vuelve a elegir **Añadir**. Después se abre la calibración.

  Una impresora Bluetooth debe estar antes en modo de emparejamiento. Elige **Emparejar y añadir**
  junto a ella e introduce su PIN.

  Si no aparece una impresora de red, abre **Comprobar una dirección conocida** y escribe su
  dirección.
  ```

  Before committing, check every bold word against what the screen shows in that language
  (`printers.add_printer`, `action.add`, `printers.bluetooth_pair`, `printers.probe_title` in
  `strings.ts`) and fix the guide, not the screen, where they differ.
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` — pass.
- [ ] **Step 4: Backlog.** In `docs/backlog/printers.md`, delete points 1, 5, 6, 7 and 8 from the
  A404 entry, renumbering what is left (2, 3, 4) — the entry stays open for PR 2.
- [ ] **Step 5: Look at it.** In a throwaway, uncommitted test file
  (`apps/dashboard/src/screens/zz-a404-look.test.ts`, deleted afterwards) mount the screen as
  `printers-screen.a11y.test.ts` does (`mountWidget(..., theme)`), open Add a printer with the
  Task 2 rows, and the name dialog, and save `page.screenshot({ path })` to an absolute path in a
  `mktemp -d` folder outside the worktree, for light and dark, at 1280 × 800 and 390 × 844, in
  English and Spanish. Open each image and check: the searching line, the one-line note, names on
  one line and level with their buttons, the filled and selected name. Screenshots are never
  committed and never copied to Drive; show them to the owner directly. Delete the throwaway file.
- [ ] **Step 6: Commit** — `git commit -s -m "A printers guide page for adding a printer, and the finished A404 points removed from the backlog"`.
  Then `/finish-branch` with this worktree, naming this plan.

---

## PR 2 — Calibrating a printer

### Task 5: The sample receipt tests each language's accented letters (point 3)

**Files:**
- Modify: `packages/country/src/country.ts` — remove `"sampleFooter"` from `RECEIPT_LABEL_KEYS`;
  add to `CountryPack`:
  `readonly receiptSampleItems?: Readonly<Record<string, readonly string[]>>;` with the one-line
  comment "Dish names a sample receipt adds, per receipt language, using between them every accented
  letter the language writes."
- Modify: `packages/country-es/src/receipt-labels.ts` — remove `sampleFooter` from the five sets;
  export `SPAIN_RECEIPT_SAMPLE_ITEMS` with the lists from "New words for the owner" (`en-GB: []`)
- Modify: `packages/country-es/src/spain.ts` — `receiptSampleItems: SPAIN_RECEIPT_SAMPLE_ITEMS`
- Modify: `packages/country-packs/src/registry.ts` — add `receiptSampleItemsFor`
- Modify: `apps/server/src/sample-receipt.ts`
- Test: `packages/country-es/src/spain.test.ts`, `packages/country-packs/src/registry.test.ts`,
  `apps/server/src/sample-receipt.test.ts`

**Interfaces:**
- Produces: `receiptSampleItemsFor(locale: string): readonly string[]` in `@waitron/country-packs` —
  the first pack's list for that exact locale, else the fallback receipt locale's list (the same
  fallback as `receiptLabelsFor`, `registry.ts:191-198`).
- `sampleDocument` (used by the calibration sample and the A4 test page) adds one line per item;
  `sampleSale` (used by the Receipts settings preview) is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `spain.test.ts`: `it.each` over the five locales
    `"lists sample dishes that use every accented letter %s writes"` with the expected letters
    `es-ES: "áéíóúüñ"`, `ca-ES: "àèéíïòóúüç"` plus the string `"l·l"`, `gl-ES: "áéíóúñ"`,
    `eu-ES: "ñ"`, `en-GB: ""` — each letter appears in the joined list or in the language's
    `sampleItemName`; and `"draws every sample dish of %s without changing a letter"`:
    `prepareText(name) === name.normalize("NFC")` for each name (`prepareText` from
    `@waitron/printing`). Update "translates the sample names…" to drop `sampleFooter`.
  - `registry.test.ts`: `receiptSampleItemsFor("ca-ES")` equals the Catalan list; an unknown locale
    gets the `es-ES` list.
  - `sample-receipt.test.ts`: for each locale, the 80 mm text of `formatSampleReceipt` contains every
    name of `receiptSampleItemsFor(locale)` and not `"pingüino"`; at 58 mm, the printed lines joined
    with spaces and runs of spaces collapsed contain every name; for `es-ES` (five dishes) the 80 mm
    lines match `/^TOTAL +16,50 €$/`, `/^Base imponible 10% +15,00 €$/`, `/^IVA 10% +1,50 €$/`,
    `/^Efectivo +20,00 €$/` and `/^Cambio +3,50 €$/`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts`,
  `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/sample-receipt.test.ts` — FAIL: no list, no
  function, the footer still printed.
- [ ] **Step 3: Implement.** In `sampleDocument`, after the existing line, one line per name:
  `{ descriptions: { [locale]: name }, quantity: "1", gross: "2.20" }`; the sale's `total` is
  `5.50 + 2.20 × n`, its one VAT row `{ rate: "10", base: 5.00 + 2.00 × n, tax: 0.50 + 0.20 × n }`,
  and the cash tendered the smallest multiple of 10.00 strictly above the total (`change` = tendered − total;
  with no dishes this is today's 10.00 and 4.50). Use `@waitron/shared`'s decimal helpers, not
  floating point. Drop `receipt.footerMessage` from `sampleDocument`.
- [ ] **Step 4: Run** the three files whole, then
  `pnpm --filter @waitron/server exec vitest run src/page-test-page.test.ts src/receipt-preview-api.test.ts src/print-api.test.ts`
  and `pnpm --filter @waitron/country exec vitest run` — pass; `pnpm --filter @waitron/country exec tsc --noEmit`
  and the same for `country-es`, `country-packs`, `server` — clean.
- [ ] **Step 5: Commit** — `git commit -s -m "The sample receipt lists dishes using each language's accented letters instead of the pingüino line (A404 point 3)"`.

### Task 6: Calibration step 1 reads in order and shows its results (point 2)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderEditPrinter` step 1, about
  3446-3516; styles `.ruler-row` 379-381)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.ruler_print`,
  `printers.resolution_hint` changed; `printers.qr_square` new; `printers.test_qr_help` removed)
- Modify: `docs/developers/design-system.md:695-700` — the `.field-row` sentence no longer names a
  button beside the ruler's answer; the guard list there still names "the calibration case in
  `printers-screen.test.ts`" (the rewritten layout case)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts` and the files in "Existing tests whose
  assertions change"

**Interfaces:** the QR answer's combobox is `name="printer-qr-square"`; results are
`[data-test=calibration-results]` holding `[data-test=calibration-result-paper]` and
`[data-test=calibration-result-resolution]`.

The step reads, top to bottom: heading, hint (`printers.resolution_hint`); a row holding only the
**Print width test** button, at the row's end (`justify-content: flex-end`, the row as wide as
`--wt-field-max-width`); a `.field-row` of the two answers — the ruler's last number
(`printer-ruler-number`, as today) and the QR square (`printer-qr-square`, label
`printers.qr_square`, options `180dpi` → `printers.test_qr_45`, `203dpi` → `printers.test_qr_40`,
value the draft's resolution); a row of the two results as a `<dl>` (label `printers.paper_width`,
value `printers.paper_width_58`/`_80`; label `printers.resolution`, value
`printers.resolution_180`/`_203`), showing the draft's values; then the disagreement line as today.
The paper-width dropdown and the separate QR paragraph go. Choosing a ruler number sets the paper
width, as today; choosing a QR answer sets the resolution.

- [ ] **Step 1: Write the failing tests** (rewriting the step-1 cases listed above):
  - "shows the saved paper width and resolution as results when calibration is run again": a
    printer stored `58mm`/`203dpi` opens with results "58 mm" and "203 dpi", the QR answer
    `203dpi`, the ruler answer empty.
  - "asks the width step's two questions and shows its two results": the button text is
    `t("printers.ruler_print")`; the ruler combobox's label, placeholder and options as today; the
    QR combobox's label `t("printers.qr_square")` and options above; no `printer-paper-width` and no
    `[data-test=calibration-qr-question]`.
  - The `it.each` "derives the results from the ruler and QR answers (%s)" over the four
    `SETTING_WIDTHS`: after both answers, the results read that row's paper width and resolution and
    no disagreement line shows.
  - The disagreement case drives `printer-qr-square` instead of `printer-resolution`; its expected
    sentences are unchanged.
  - Layout at `page.viewport(1280, 800)`: the button's bottom is above the answers' top (it has its
    own row); its right edge is within 2 px of the QR combobox's right edge; the results row's top
    is below the answers' bottom; every row ends within the form width.
    At `page.viewport(390, 844)` in Spanish: no row's right edge is past the modal body's.
  - Delete "clears the ruler answer when paper width is changed directly".
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "width step|results|ruler"`
  — FAIL: no results, no `printer-qr-square`, the button beside the answer.
- [ ] **Step 3: Implement** the layout above; remove `.ruler-row` and the paper-width combobox;
  update the setup-only tests to change paper width through the ruler's answer.
- [ ] **Step 4: Run** `printers-screen.test.ts`, `printer-calibration.unsaved.test.ts`,
  `printers-screen.save-state.test.ts` and `printers-screen.a11y.test.ts` whole — pass.
  `git grep -n "printer-paper-width\|printer-resolution\|test_qr_help\|calibration-qr-question" -- apps/dashboard`
  prints nothing.
- [ ] **Step 5: Commit** — `git commit -s -m "Calibration step 1: the width test button on its own row, the two answers, then the paper width and resolution they give (A404 point 2)"`.

### Task 7: "Portable printer", with its explanation, under a step heading that fits (point 4)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (step 3, about 3536-3620)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.portable`,
  `printers.calibration_drawer` changed; `printers.portable_hint` new)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

Step 3 reads: heading `printers.calibration_drawer`; the cash drawer switch, then its test button
and answer (moved up from the end of the step); the portable switch with a hint line
`<p class="hint">` holding `printers.portable_hint` under it, also passed as the switch's
`description`; then "When picked up" (`printer-pickup-roles`) as today.

- [ ] **Step 1: Write the failing tests:**
  `it("names the portable switch Portable printer and explains it under the switch")` —
  `wt-switch[name=printer-portable]`'s `label` is `t("printers.portable")`, its `description` is
  `t("printers.portable_hint")`, and a visible hint line directly after it has that text;
  `it("heads the last step for both the drawer and portable use")` — the step's `h2` reads
  `t("printers.calibration_drawer")`, and the drawer test button (with a drawer switched on) comes
  before the portable switch in document order;
  `it("shows Portable printer on the printer's details")` — the details' `printer-portable` field
  label reads `t("printers.portable")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "portable|last step"`
  — FAIL on the description, the hint line and the order. The two label assertions already pass,
  because they compare against the key; keep them, they pin which key each place reads.
- [ ] **Step 3: Implement** the order and hint; change the words.
- [ ] **Step 4: Run** `printers-screen.test.ts`, `printers-screen.save-state.test.ts`,
  `printer-calibration.unsaved.test.ts` and `printers-screen.a11y.test.ts` whole — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Calibration step 3: Portable printer with its explanation, under a heading for the drawer and portable use (A404 point 4)"`.

### Task 8: PR 2's guide, backlog and a look at it

**Files:**
- Modify: `apps/server/src/guide/en/printers.md`, `apps/server/src/guide/es/printers.md`
- Modify: `docs/backlog.md` (delete the A404 entry, about line 3890), `docs/backlog/printers.md`
  (delete the A404 section; add the open entry below)

- [ ] **Step 1: Add the section.** English, after "Add a printer":

  ```markdown
  ## Calibrate a receipt printer {#calibrate}

  Calibration has three steps; it opens after you add a printer, and **Calibrate printer** on the
  printer's details runs it again.

  1. Choose **Print width test**. On the paper, choose the last number on the ruler you can see in
     full, and measure the QR code's black square without its white border. Waitron shows the paper
     width and print resolution these give. If it says they disagree, measure again.
  2. Choose **Print sample receipt** and check that every letter prints with its accents and the
     receipt is as wide as the paper.
  3. Say whether a cash drawer is attached, and test it. Switch on **Portable printer** for a printer
     one person carries, such as a belt printer. Choose **Save**.
  ```

  Spanish:

  ```markdown
  ## Calibrar una impresora de recibos {#calibrate}

  La calibración tiene tres pasos; se abre al añadir una impresora, y **Calibrar impresora** en los
  detalles de la impresora la repite.

  1. Elige **Imprimir prueba de ancho**. En el papel, elige el último número de la regla que se ve
     entero y mide el cuadrado negro del código QR sin su borde blanco. Waitron muestra el ancho del
     papel y la resolución de impresión que resultan. Si dice que no coinciden, vuelve a medir.
  2. Elige **Imprimir recibo de muestra** y comprueba que todas las letras salen con sus acentos y
     que el recibo ocupa el ancho del papel.
  3. Indica si hay un cajón portamonedas conectado y pruébalo. Activa **Impresora portátil** para una
     impresora que lleva una persona, como una de cinturón. Elige **Guardar**.
  ```

  Check each bold word against the screen's words in that language, as in Task 4.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` — pass.
- [ ] **Step 3: Backlog.** Delete the A404 entry from `docs/backlog.md` and its section from
  `docs/backlog/printers.md` (both points lists are now done). Add, in the Printers area of both
  files, a short entry "**A rule between TOTAL and the tax lines on a simplified receipt (left open
  by A404).** The owner's A404 list (2026-10-08) asked for a rule before the tax lines; A663 later
  put TOTAL straight after the items, then the rates, with no rule between them. Owner to say
  whether one is wanted; it would change every printed simplified receipt." Leave the entry "While a
  discovery window is open, a device not reported within 45 seconds drops off the list" — still
  true for unpaired devices.
- [ ] **Step 4: Look at it.** As in Task 4 Step 5: screenshots of calibration steps 1 and 3 in both
  themes, at 1280 × 800 and 390 × 844, English and Spanish, before and after answering step 1. And
  the paper: in a throwaway `apps/server` test print `printedLines(formatSampleReceipt(...))` for each
  receipt language at 58 and 80 mm and read it — every dish whole, no `?`, no lost accent, the
  totals adding up. Nothing is committed; the throwaway files are deleted. A photo of a real print
  is the owner's.
- [ ] **Step 5: Commit** — `git commit -s -m "A printers guide section for calibration, and A404 removed from the backlog with its one open question"`.
  Then `/finish-branch` with PR 2's worktree, naming this plan. The PR description lists the
  changed assertions, the New words table, and asks the owner the TOTAL-rule question.
