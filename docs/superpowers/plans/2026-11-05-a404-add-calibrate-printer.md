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
in the Spain country pack). One small primitive addition: `wt-input` gains `select()`. A new guide
page, `printers`, in English and Spanish.

**Tech stack:** Lit web components, Vitest 4 (browser mode, real Chromium, for the dashboard and
`ui-core`; Node for the server and the country packages), Hono.

**Spec:** `docs/backlog/printers.md`, section "A404 — adding and calibrating a printer" (points 1–8).
A405 ("printer details and the print queue", just below it) is a separate item and is not planned
here; the only A405-related work is that point 4's new label also shows on today's printer details,
which is automatic because both read the same string (`printers.portable`, used at
`printers-screen.ts:2978` and `:3556`).

Line numbers below were measured on `9b6e397df5`.

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
- A help bubble is a `wt-help-tooltip mode="help-mode"` with `guide-href` from
  `apps/dashboard/src/help-guide.ts` and `guide-label=${t("help.guide_link")}`, as
  `box-status-screen.ts:573-579` does.
- A look complaint about a shared `wt-*` component is fixed in the component, everywhere, and
  checked by screenshot; one screen's own layout is fixed in that screen.
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
  (`printers.ruler_disagrees`, `printers-screen.ts:3514-3520`) is where the two disagree.
- Every other consumer reads the pair through `textGrid` (dots across and columns:
  `print-api.ts:1396`, `:1521`, `receipt-preview-api.ts:263`, `packages/printing/src/escpos.ts:55`)
  or passes both fields on (`kitchen-print.ts:151-167`, `payment-slip-print.ts:99`,
  `orders-reprint.ts:24`, `invoice-delivery-actions.ts:90`, `report-api.ts:389`). Nothing stores
  millimetres, and nothing needs a field removed, so point 2 needs no schema change.

## Point 6 (a paired Bluetooth printer comes and goes), the cause

**Not the 45-second limit.** A paired printer is refreshed on every pull, so it never ages out: the
agent sends its paired devices as `visible` and as `pairedBluetooth` on every pull
(`packages/print-agent/src/agent.ts:652-654`, `:719-723`; `apps/print-agent/src/linux-devices.ts:165-177`
reports every paired device as visible), and both set `lastSeenAt: now`
(`apps/server/src/print-api.ts:611-639`). The paired-listing reuse window (`PAIRED_REUSE_MS`,
`linux-devices.ts:47`, `:138-150`) serves only a job's delivery path (`pairedFor`), not the list.

**The cause:** a `visible` report replaces the stored entry's description with its own fields
(`remember`, `print-api.ts:611-628`), and a visible report never carries `printerLike`
(`screenVisible`, `print-api.ts:277-298`). So every plain pull wipes the printer mark that a scan
set, and the dialog hides an unmarked Bluetooth device unless Show all devices is on
(`shown`, `printers-screen.ts:3929-3930`). A scan's results reach the server once, on the pull
after its pass ends (`agent.ts:657`, `:746`), so the printer shows for one pull and goes on the
next — missing while a scan runs, listed as it ends, missing again — exactly the owner's account.
The dashboard keeps reading the list after its scan ends, through its live subscription
(`printers-screen.ts:1010-1013`).

**Experiment (run, then deleted):** a case in `print-api.test.ts` pulled once with
`visible + scanned(printerLike: true) + pairedBluetooth`, then once with `visible + pairedBluetooth`.
`GET` of the discovered list gave `{"printerLike":true,"paired":true}` after the first pull and
`{"paired":true}` — no `printerLike` — after the second.

**The fix has two parts (Task 1), and touches no table — the list is held in memory.**
1. A plain report keeps the mark an earlier scan set.
2. The dialog lists any Bluetooth device its agent reports paired, without Show all devices. Part 1
   alone is not enough for the owner's words ("A printer that is already paired stays listed while
   the dialog is open"): the list starts empty when the server restarts, and a paired printer is
   unmarked until the agent's first scan pass answers.

**What `paired` means, and what part 2 lets through.** `paired` is set while the agent's last
paired listing named the device (`print-api.ts:1007-1008`), and that listing is everything
`bluetoothctl devices Paired` prints on the agent's machine, unfiltered
(`apps/print-agent/src/bluetooth.ts:232-233`, `linux-devices.ts:209-215`). So a paired device that
is not a printer would show too. On the box that is a device someone paired through Waitron's own
Pair — the box's operator has no terminal, and Waitron's dialog offers Pair on a device it does not
mark as a printer only under Show all devices (`printers-screen.ts:3929-3936`). A print agent on
another computer reports whatever that computer has paired (a keyboard, headphones), and those would
now show with Add. This is stated in PR 1's description as a consequence of the owner's rule.

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
  The sample must look like a real receipt, so it is not drawn here; Task 9 records it as a short
  open question in the backlog, and the PR description asks the owner.

## What goes beyond the spec

Said plainly here and in each PR description:
- a new `printers` guide page (English and Spanish) and two help bubbles linking to it — the screen
  had no guide (`git grep -n -i "add a printer\|añadir impresora\|calibrat" -- apps/server/src/guide`
  printed nothing on 2026-11-05);
- the name dialogs select the whole filled-in name on opening, so typing replaces it (the spec's
  "ready to overwrite");
- `product-list.ts:747`, which reaches into an inner input to select it, uses the new
  `WtInput.select()` instead;
- a paired Bluetooth device that is not a printer is listed (above);
- calibration step 3's drawer test button moves up beside the drawer switch.

## PR split and review weight

Nine tasks, so two PRs, in order. PR 2 is branched from `main` after PR 1 lands, because both
change `printers-screen.ts` and `strings.ts`.

The rule used for review weight: **changing a shared type or key list that other packages already
read is a cross-package contract change; adding a method that nothing yet relies on is not.**

- **PR 1 — "Adding a printer"** (this worktree and branch,
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a404-add-calibrate-printer`,
  `feat/a404-add-calibrate-printer`): Tasks 1–4, points 1, 5, 6, 7 and 8. `WtInput.select()` is a
  new method on a shared primitive, changing nothing existing callers use; discovery state is in
  memory. No risk trigger: the light review path.
- **PR 2 — "Calibrating a printer"** (new worktree:
  `python3 ~/workspace/tools/worktree.py new waitron feat/a404-calibrate-printer --headless`, after
  syncing `main`): Tasks 5–9, points 2, 3 and 4. Task 5 removes `sampleFooter` from
  `RECEIPT_LABEL_KEYS` and adds a field to `CountryPack` (`packages/country`), both read by
  `country-es`, `country-packs` and `apps/server`: a cross-package contract, so the full review path.

## Review focus

The five inputs most likely to bite that no step below would otherwise test; each has its test in
the owning task.

1. The Add dialog left open for minutes with a paired Bluetooth printer and no scan running — the
   printer must stay listed through many plain pulls and past 45 seconds; and after a server
   restart, before any scan, it must be listed at all (Task 1).
2. A sample dish name holding a letter the printer font lacks would print with its accent silently
   dropped by `prepareText` — every listed name must survive `prepareText` unchanged (Task 5).
3. A 58 mm roll: the longest Catalan name wraps; every name must still be printed whole (Task 5).
4. The Spanish screen at phone width (390 px): the calibration window's button row, answer row and
   result row must not run past the modal (Tasks 6a and 6b).
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
| guide | `printers.add_help_label` | new | About adding a printer | Sobre cómo añadir una impresora |
| guide | `printers.add_help` | new | Waitron lists the printers its print agents find. Not listed? Check it is on, or type its address under Check a known address. | Waitron muestra las impresoras que encuentran sus agentes de impresión. ¿No aparece? Comprueba que esté encendida o escribe su dirección en Comprobar una dirección conocida. |
| 2 | `printers.ruler_print` | changed | Print width test | Imprimir prueba de ancho |
| 2 | `printers.resolution_hint` | changed | Print the width test. Choose the last number you can see in full on the ruler, and measure the QR code’s black square without its white border. You do not need to scan it. | Imprime la prueba de ancho. Elige el último número de la regla que se ve entero y mide el cuadrado negro del código QR sin su borde blanco. No hace falta escanearlo. |
| 2 | `printers.qr_square` | new | QR code’s black square | Cuadrado negro del código QR |
| 2 | `printers.test_qr_help` | removed | (was the separate QR paragraph; its words are now in `printers.resolution_hint`) | |
| guide | `printers.calibration_help_label` | new | About calibration | Sobre la calibración |
| guide | `printers.calibration_help` | new | Calibration sets how wide Waitron prints and how large the QR code comes out. Run it again if you change the paper width. | La calibración fija el ancho de impresión y el tamaño del código QR. Repítela si cambias el ancho del papel. |
| 4 | `printers.portable` | changed | Portable printer | Impresora portátil |
| 4 | `printers.portable_hint` | new | Carried by one person, such as a belt printer; one device holds it at a time. | La lleva una persona, como una impresora de cinturón; la tiene un solo dispositivo a la vez. |
| 4 | `printers.calibration_drawer` | changed | Cash drawer and portable use | Cajón portamonedas y uso portátil |

Both help bubbles link with the existing `help.guide_link` (Read more in the guide / Más
información en la guía).

Unchanged and reused by point 2's result row: `printers.paper_width` (Paper width / Ancho del
papel), `printers.resolution` (Print resolution / Resolución de impresión),
`printers.paper_width_58`/`_80` (58 mm / 80 mm), `printers.resolution_180`/`_203` (180 dpi / 180 ppp,
203 dpi / 203 ppp), and the QR answers `printers.test_qr_40`/`_45` (Closer to 40 mm / Más cerca de
40 mm; Closer to 45 mm / Más cerca de 45 mm). `printers.ruler_disagrees` stays as it is.

### Server guide frame (`apps/server/src/i18n/guide-pages.ts`)

The new page's name in the guide's list of pages: English **Printers**, Spanish **Impresoras**.

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

The full text of both pages is in Tasks 4 and 9 and goes to the owner with the tables above.

## Existing tests whose assertions change

Each is allowed because the spec changes what it checks; name each in its PR.

PR 1:
- `printers-screen.test.ts` "leaves the empty discovered table without a message while Scan's
  spinner runs" — now expects `printers.scan_empty` (point 1). Rename it "says no printers are found
  yet while Scan's spinner runs".
- `printers-screen.test.ts` "offers Pair and add, not Add, for an unpaired printer-like device, and
  Add for a paired one" — its `bluetooth-note` text assertion reads the new one-line key (same key,
  new words; the assertion line itself is unchanged).
- `printers-screen.test.ts` "keeps a wrongly-described registered printer reachable in its printer
  row and through Show all" (about line 7481) — its device is reported `paired: true`, so it is now
  listed without Show all devices: `discovered-row-…` is present at once, and the Show all click
  goes (point 6). Its Enable assertions stay.
- `printers-screen.test.ts` "names a new A4 printer in a dialog whose Add waits for a name, then
  adds it from the row's discovery entry" — Add is enabled at open with the discovered name filled
  in (point 7). Its whitespace and "Back office" steps stay.
- `page-printer-add.unsaved.test.ts` "a press that reaches an untouched Add's handler sends nothing
  and marks nothing" (lines 157-169) and "closing untouched does not ask, and a name typed back to
  empty is no change" (line 101): they mount the dialog with no suggested name and keep today's
  assertions for that case; each gains a twin with a suggested name whose assertions differ (an
  untouched Add sends the suggestion; typing back to the suggestion is no change, while emptying it
  is a change).

PR 2:
- `printers-screen.test.ts` (Task 6a, the layout and words): "asks the width step's three questions
  in labelled dropdowns showing the printer's saved settings" (no QR paragraph; the QR answer's label
  is `printers.qr_square`) and "keeps the width step's rows, and the button beside the ruler's
  answer, within the form width on a wide window" (rewritten for the button's own row and the result
  row).
- `printers-screen.test.ts` (Task 6b, the paper-width dropdown removed, the QR answer renamed
  `printer-qr-square`): "keeps the printer's saved paper width and resolution when calibration is run
  again" (paper width read from the result row), the `it.each` "derives layout settings from the
  ruler and QR answers (%s)" (results instead of the dropdown), "says when the ruler's number and the
  chosen paper width and resolution disagree, without stopping the save" (drives
  `printer-qr-square`), "leaves the paper width alone when the ruler's answer is set back to Choose"
  (reads the result row).
- `printers-screen.test.ts` "clears the ruler answer when paper width is changed directly" —
  **deleted** in Task 6b: point 2 removes the direct paper-width control it tested.
- `printer-calibration.unsaved.test.ts` (Task 6b), each moving to the control named:
  - "calibration cancel/escape retains settings and focus until Discard" (lines 148-181): changes
    the paper width, focuses its control and asserts the control keeps focus and its value (lines
    150-179) — moves to the ruler's answer (`printer-ruler-number`: choose `360`, focus it, assert
    its value `360` and the result row's "58 mm"; after Discard and reopening, the ruler answer is
    empty and the result row reads "80 mm").
  - The unload loop (line 183): the row `["printer-paper-width", "58mm", "80mm"]` becomes
    `["printer-ruler-number", "360", "512"]` — 58 mm, then back to the saved 80 mm; not `""`, because
    an empty ruler answer leaves the paper width as it was ("leaves the paper width alone…") — and
    the row `["printer-resolution", "203dpi", "180dpi"]` becomes
    `["printer-qr-square", "203dpi", "180dpi"]`.
  - Value assertions on the paper-width dropdown at lines 220, 278, 460, 486 and 527 — read the
    result row (`[data-test=calibration-result-paper]`) instead, same expected width.
  - Setup-only `change(screen, "printer-paper-width", "58mm")` calls (lines 243, 264, 294, 315,
    331, 349, 371, 423, 454, 481, 501, 524, 542) become `change(screen, "printer-ruler-number",
    "360")`, and `printer-resolution` becomes `printer-qr-square` (lines 244, 298, 305, 307, 375,
    401, 430, 437, 447, 508, 513), the asserted values unchanged.
- Setup-only changes in Task 6b (assertions kept, only how the draft is changed): "opens calibration
  after adding, and saves the tested draft", "saves changed paper width and resolution through
  calibration alone", "uses explicit width and resolution, and prints a sample from the calibration
  draft", `printers-screen.save-state.test.ts`, and the step-1 states of
  `printers-screen.a11y.test.ts`.
- `apps/server/src/sample-receipt.test.ts` (Task 5): "A965 sample language keeps %s sample and
  document inputs together" (no footer; the document's sale now differs from the preview's sale by
  the added dishes) and "draws at the selected setting and prints an unmistakably simulated
  realistic receipt" (no «pingüino» line; the total follows the added dishes).
- `packages/country-es/src/spain.test.ts` (Task 5) "translates the sample names into %s without
  repeating the table caption" — no `sampleFooter`.

---

## PR 1 — Adding a printer

### Task 1: A paired Bluetooth printer stays listed (point 6)

**Files:**
- Modify: `apps/server/src/print-api.ts` (`remember`, lines 611-628)
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`shown`, lines 3929-3930)
- Test: `apps/server/src/print-api.test.ts`, inside `describe("Bluetooth Pair and Forget commands")`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`, beside "hides a device that does not
  look like a printer until Show all devices, and hides it again on reopening"

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**
  - Server, next to "keeps a scan's description when a later pairing report arrives, and drops the
    row once both are stale":
    `it("keeps a scanned printer marked as a printer while later pulls report it only as paired and visible")`
    — with `Date.now` mocked, pull at `start` with
    `visible: [{ transport: "bluetooth", localKey: mac, model: "BlueTooth Printer" }]`,
    `scanned: [scannedMac(mac, { name: "BlueTooth Printer", printerLike: true })]`,
    `pairedBluetooth: [{ localKey: mac, name: "BlueTooth Printer" }]`; then pull with only the
    `visible` and `pairedBluetooth` entries at `start + 2_000`, `start + 30_000` and
    `start + 60_000`. After each, the row for `mac` matches
    `{ printerLike: true, paired: true, name: "BlueTooth Printer" }`. (Today the first plain pull
    already drops `printerLike`.)
    `it("takes a later scan's answer over an earlier printer mark")` — pull with
    `scanned: [scannedMac(mac, { printerLike: true })]`, then with `scanned: [scannedMac(mac)]`; the
    row has no `printerLike`. (Passes today; it must still pass after the fix.)
    `it("lists a paired device on a fresh server before any scan has marked it")` — a new
    `mountApp()` (the state after a restart), one pull with only `visible` and `pairedBluetooth`
    for `mac`: the row has `paired: true` and no `printerLike`. (Passes today; it pins what the
    dashboard part reads.)
  - Dashboard: `it("lists a Bluetooth device its agent reports paired without Show all devices")` —
    with a discovered `{ transport: "bluetooth", localKey: OTHER, name: "BlueTooth Printer",
    paired: true }` (no `printerLike`), after opening Add a printer, `discovered-row-OTHER` is
    present and its Add button shows; with the same device not paired it is absent until
    `show-all-bluetooth` is pressed.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts -t "printer mark|before any scan"`
  — the first FAILS (`printerLike` missing after the first plain pull), the other two pass; and
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "reports paired"`
  — FAILS (the row is hidden). Read each run's `Tests` count.
- [ ] **Step 3: Implement.** In `remember`, when `stamp === "visibleAt"`, carry `prior?.printerLike`
  onto the new entry (a visible report never classifies a device); a scanned report keeps setting it
  from its own fields as today. In the dashboard, `shown` also passes a device with
  `d.paired === true`.
- [ ] **Step 4: Run** both files whole — all pass, except "keeps a wrongly-described registered
  printer reachable in its printer row and through Show all", whose assertion changes as listed
  above. Make that change.
- [ ] **Step 5: Commit** — `git commit -s -m "A paired Bluetooth printer stays listed between scans and after a restart (A404 point 6)"`.

### Task 2: The Add a printer dialog says what is happening, and its rows line up (points 1, 5 and 8)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderNewPrinter`, from line 3914;
  styles `::part(discovered-details)` 240-243, `::part(bluetooth-actions)` 269-278)
- Possibly modify: `packages/ui/src/components/wt-data-table.ts` (cell alignment, lines 269-278 and
  the `top-aligned` property at 995) — only if the cause is there (Step 3)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.scan_empty` new,
  `printers.no_discovered` and `printers.bluetooth_pair_note` changed — words from the table)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts` (and
  `packages/ui/src/components/wt-data-table.head-and-cells.test.ts` if the table changes)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**
  - Point 1: change "leaves the empty discovered table without a message while Scan's spinner runs"
    to "says no printers are found yet while Scan's spinner runs": `table.emptyMessage` is
    `t("printers.scan_empty", "es-ES")`. Keep "shows the empty discovery message after scanning
    finishes" as it is (it reads `printers.no_discovered` by key).
  - Point 8: `it("shows the one-line pairing note only while a Bluetooth printer is listed")`: with
    only a Bluetooth device that is neither printer-like nor paired (hidden until Show all devices),
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
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "spinner|pairing note|discovered name|discovered row|discovered list"`
  — point 1 FAILS on the empty message, point 8 FAILS where only a hidden device is found, point 5
  FAILS on the line count and the centres. Read the `Tests` count: every new case must be among
  those run.
- [ ] **Step 3: Implement.**
  - `emptyMessage`: `t(this.scanning ? "printers.scan_empty" : "printers.no_discovered")`.
  - The note shows when `rows` (what the list draws) holds a Bluetooth row, not when `addable` does.
  - Point 5: **find the cause first** and say it in the commit. `wt-data-table` lines cells up by
    their first line's baseline (`vertical-align: baseline`, `wt-data-table.ts:269-274`) and offers
    `top-aligned` (`:276-278`, `:993-995`). If the misalignment comes from the shared table's
    alignment (any table with a button cell beside a multi-line cell would show it), fix it in
    `wt-data-table` with a test in its own suite, and check other tables by screenshot; if it comes
    from this screen's parts (`discovered-details`, `bluetooth-actions` flex box), fix it in the
    screen's `::part` styles, or set `top-aligned` on this table if that lines the row up. Widen the
    name's `max-width: min(28vw, 24dvh)` cap so a name takes its column (the `24dvh` term is what
    wraps it at 1280 × 800: 192 px), keeping a cap so a phone's list does not widen past the screen.
    Styles only through `::part`, with `--wt-*` tokens.
- [ ] **Step 4: Run** the whole file, then `src/screens/printers-screen.a11y.test.ts` (and the
  `wt-data-table` suites if it changed) — all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Add a printer says it is still searching, lines its rows up and keeps the Bluetooth note to one line (A404 points 1, 5 and 8)"`.

### Task 3: Both name dialogs open with the name filled in and selected (point 7)

**Files:**
- Modify: `packages/ui-core/src/components/wt-input.ts` — add `select(): void`
- Test: `packages/ui-core/src/components/wt-input.test.ts`
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderPrinterName` from 3681,
  `#openPagePrinterAdd` 1390-1395, `#renderPagePrinterAdd` from 3896)
- Modify: `apps/dashboard/src/widgets/page-printer-add.ts` (the button at about 192-199 and the
  early return in `#add` at 118)
- Modify: `apps/dashboard/src/widgets/product-list.ts:747` — `box.select()` instead of
  `box.shadowRoot!.querySelector("input")!.select()`
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
  - `page-printer-add.unsaved.test.ts`, twins of the two cases named under "Existing tests whose
    assertions change", mounted with `suggestedName: "Back office"`:
    "an untouched Add with a suggested name sends the suggestion" (`registerPagePrinter` called
    with `{ ...entry, name: "Back office" }`, the dialog closes without asking) and "closing at once
    with a suggested name does not ask; typing back to the suggestion is no change, emptying it is"
    (`isDirty()` false at open, true after typing `""`, false after typing `"Back office"`). The two
    existing cases, mounted with no suggestion, keep their assertions.
- [ ] **Step 2: Run**
  `pnpm --filter @waitron/ui-core exec vitest run src/components/wt-input.test.ts -t "select"` —
  FAILS (`select` is not a function);
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "name dialog|fills the name"`
  — the receipt dialog FAILS on the selection (value and Add already pass today), the A4 dialog
  FAILS on the empty value and disabled Add;
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/page-printer-add.unsaved.test.ts -t "suggest"`
  — FAILS (no such property; the untouched Add sends nothing).
- [ ] **Step 3: Implement.**
  - `WtInput.select()` calls the inner input's `select()`.
  - Both dialogs call `select()` on their name field once the modal has opened and focused it.
  - `#openPagePrinterAdd` passes `suggestedName: this.#discoveredLabel(device)` through
    `addingPagePrinter`; `PagePrinterAdd` starts `name` and `#baseline` from `suggestedName` when a
    new `entry` arrives. One value, `savableAtOpen: this.suggestedName.trim() !== ""`, is passed to
    `saveActionState` in **both** places it is read — the Add button's `variant`/`disabled` and the
    early return at the top of `#add` — so an empty suggestion keeps today's behaviour.
  - The receipt-printer name dialog already uses `savableAtOpen: true` and its handler
    (`#registerDiscovered`) has no unchanged-draft early return — an empty name is refused by the
    form's own check — so it needs only the selection.
  - `product-list.ts:747` calls `box.select()`.
- [ ] **Step 4: Run** the three test files whole, plus `src/screens/printer-name.unsaved.test.ts`
  and `src/widgets/product-list.test.ts` (the category-name rename case that relies on the
  selection) — all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Name dialogs open with the found name filled in and selected, ready to type over (A404 point 7)"`.

### Task 4: PR 1's guide page, help bubble, backlog and a look at it

**Files:**
- Create: `apps/server/src/guide/en/printers.md`, `apps/server/src/guide/es/printers.md`
- Modify: `apps/server/src/guide-catalogue.ts` — add `"printers"` to `GUIDE_PAGES`
- Modify: `apps/server/src/i18n/guide-pages.ts` — `names.printers`: EN "Printers", ES "Impresoras"
  (its type requires every `GUIDE_PAGES` name)
- Modify: `apps/server/src/guide-content.test.ts` — a "registers its sections" case
- Modify: `apps/dashboard/src/help-guide.ts` — `"printers.add-printer": { page: "printers", section: "add-printer" }`
- Modify: `apps/dashboard/src/screens/printers-screen.ts` — a help bubble beside the Add a printer
  dialog's search hint (`printers.discovery_hint`)
- Modify: `apps/dashboard/src/i18n/strings.ts` — `printers.add_help_label`, `printers.add_help`
- Modify: `docs/backlog/printers.md` (the A404 section)

- [ ] **Step 1: Write the failing tests.**
  - `guide-content.test.ts`: `it.each(GUIDE_LANGUAGES)("the printers guide in %s registers its sections", …)`
    like the servers case: `GUIDE_PAGES` contains `"printers"`, the page renders, its section ids are
    `["add-printer"]`.
  - `printers-screen.test.ts`: `it("explains adding a printer in a help bubble that links to the guide")`
    — in the open Add a printer dialog a `wt-help-tooltip` has `mode="help-mode"`, `aria-label`
    `t("printers.add_help_label")`, text `t("printers.add_help")` and
    `guide-href` `guideHref("printers.add-printer")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts -t "printers"`
  and the dashboard case — FAIL (no page, no bubble).
- [ ] **Step 3: Write the page.** English:

  ```markdown
  # Printers

  ## Add a printer {#add-printer}

  In **Printers**, choose **Add a printer**. Waitron searches for network, USB and Bluetooth
  printers. Choose **Add** beside a receipt printer, change the name if you like, and choose **Add**
  again; calibration opens next. An office printer shows **Add as A4 printer** instead.

  A Bluetooth printer must be in pairing mode first. Choose **Pair and add** beside it and enter
  its PIN.

  If a network printer is not found, open **Check a known address** and type its address.
  ```

  Spanish (`es/printers.md`, same ids):

  ```markdown
  # Impresoras

  ## Añadir una impresora {#add-printer}

  En **Impresoras**, elige **Añadir impresora**. Waitron busca impresoras de red, USB y Bluetooth.
  Elige **Añadir** junto a una impresora de recibos, cambia el nombre si quieres y vuelve a elegir
  **Añadir**; después se abre la calibración. Una impresora de oficina muestra en su lugar **Añadir
  como impresora A4**.

  Una impresora Bluetooth debe estar antes en modo de emparejamiento. Elige **Emparejar y añadir**
  junto a ella e introduce su PIN.

  Si no aparece una impresora de red, abre **Comprobar una dirección conocida** y escribe su
  dirección.
  ```

  Check every bold word against what the screen shows in that language (`printers.list_title`,
  `printers.add_printer`, `action.add`, `printers.page_printer_add`, `printers.bluetooth_pair`,
  `printers.probe_title` in `strings.ts`) and fix the guide, not the screen, where they differ.
  Register the page in `GUIDE_PAGES` and `guide-pages.ts`; add the link and the bubble.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/i18n/guide-pages.test.ts`,
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts` (the links
  case now checks the new `printers.add-printer` link against the page's sections), and the
  dashboard printers suite — pass.
- [ ] **Step 5: Backlog.** In `docs/backlog/printers.md`, delete points 1, 5, 6, 7 and 8 from the
  A404 entry, renumbering what is left (2, 3, 4) — the entry stays open for PR 2.
- [ ] **Step 6: Look at it.** In a throwaway, uncommitted test file
  (`apps/dashboard/src/screens/zz-a404-look.test.ts`, deleted afterwards) mount the screen as
  `printers-screen.a11y.test.ts` does (`mountWidget(..., theme)`), open Add a printer with the
  Task 2 rows, and the name dialog, and save `page.screenshot({ path })` to an absolute path in a
  `mktemp -d` folder outside the worktree, for light and dark, at 1280 × 800 and 390 × 844, in
  English and Spanish. Open each image and check: the searching line, the one-line note, names on
  one line and level with their buttons, the filled and selected name. If Task 2 changed
  `wt-data-table`, also screenshot two other screens' tables. Render the guide page through the
  server's guide route and look at it. Screenshots are never committed and never copied to Drive;
  show them to the owner directly. Delete the throwaway file.
- [ ] **Step 7: Commit** — `git commit -s -m "A printers guide page and help bubble for adding a printer, and the finished A404 points removed from the backlog"`.
  Then `/finish-branch` with this worktree, naming this plan. The PR description lists the changed
  assertions, what goes beyond the spec, and the words for points 1, 8 and the bubble.

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
- Modify: `docs/backlog/english-only-audit.md:197` — the row's `sample-receipt.ts:38` pointer and
  «…pingüino · 5 €» go; the row keeps only the printer test page's sample
  (`apps/server/src/i18n/printer-test-page.ts:3`, «Café, jamón, niño · 5 € · ¿Sí? ¡Sí!»)
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
    `sampleItemName`. Update "translates the sample names…" to drop `sampleFooter`. (No
    `@waitron/printing` import here: `country-es` does not depend on it.)
  - `registry.test.ts`: `receiptSampleItemsFor("ca-ES")` equals the imported
    `SPAIN_RECEIPT_SAMPLE_ITEMS["ca-ES"]` (no words typed into the test); an unknown locale gets
    `SPAIN_RECEIPT_SAMPLE_ITEMS["es-ES"]`.
  - `sample-receipt.test.ts`:
    `"draws every sample dish of %s without changing a letter"` — for each name of
    `receiptSampleItemsFor(locale)`, `prepareText(name) === name.normalize("NFC")` (`prepareText`
    from `@waitron/printing`); for each locale, the 80 mm text of `formatSampleReceipt` contains
    every name of `receiptSampleItemsFor(locale)` and not `"pingüino"`; at 58 mm, the printed lines
    joined with spaces and runs of spaces collapsed contain every name; for `es-ES` (five dishes) the
    80 mm lines match `/^TOTAL +16,50 €$/`, `/^Base imponible 10% +15,00 €$/`, `/^IVA 10% +1,50 €$/`,
    `/^Efectivo +20,00 €$/` and `/^Cambio +3,50 €$/`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts`,
  `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/sample-receipt.test.ts` — FAIL: no list, no
  function, the footer still printed.
- [ ] **Step 3: Implement.** In `sampleDocument`, after the existing line, one line per name:
  `{ descriptions: { [locale]: name }, quantity: "1", gross: "2.20" }`; the sale's `total` is
  `5.50 + 2.20 × n`, its one VAT row `{ rate: "10", base: 5.00 + 2.00 × n, tax: 0.50 + 0.20 × n }`,
  and the cash tendered the smallest multiple of 10.00 strictly above the total (`change` =
  tendered − total; with no dishes this is today's 10.00 and 4.50). Use `@waitron/shared`'s decimal
  helpers, not floating point. Drop `receipt.footerMessage` from `sampleDocument`. Update the
  English-only audit row.
- [ ] **Step 4: Run** the three files whole, then
  `pnpm --filter @waitron/server exec vitest run src/page-test-page.test.ts src/receipt-preview-api.test.ts src/print-api.test.ts`
  and `pnpm --filter @waitron/country exec vitest run` — pass; `pnpm --filter @waitron/country exec tsc --noEmit`
  and the same for `country-es`, `country-packs`, `server` — clean.
- [ ] **Step 5: Commit** — `git commit -s -m "The sample receipt lists dishes using each language's accented letters instead of the pingüino line (A404 point 3)"`.

### Task 6a: Calibration step 1 — the button on its own row, and the results shown (point 2, first half)

Both dropdowns stay in this task; Task 6b removes the paper-width one. Each task leaves the suites
green.

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (`#renderEditPrinter` step 1, from line
  3449; styles `.ruler-row` 379-381)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.ruler_print`,
  `printers.resolution_hint` changed; `printers.qr_square` new; `printers.test_qr_help` removed)
- Modify: `docs/developers/design-system.md:695-700` — the `.field-row` sentence no longer names a
  button beside the ruler's answer; the guard list there still names "the calibration case in
  `printers-screen.test.ts`" (the rewritten layout case)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

**Interfaces:** results are `[data-test=calibration-results]` holding
`[data-test=calibration-result-paper]` and `[data-test=calibration-result-resolution]`.

After this task the step reads, top to bottom: heading, hint (`printers.resolution_hint`); a row
holding only the **Print width test** button, at the row's end (`justify-content: flex-end`, the
row as wide as `--wt-field-max-width`); a `.field-row` of the ruler's answer
(`printer-ruler-number`, as today) and the QR answer (still `name="printer-resolution"`, label now
`printers.qr_square`, options as today); the paper-width dropdown, as today, on its own row; a row
of the two results as a `<dl>` (label `printers.paper_width`, value `printers.paper_width_58`/`_80`;
label `printers.resolution`, value `printers.resolution_180`/`_203`), showing the draft's values;
then the disagreement line as today. The separate QR paragraph
(`[data-test=calibration-qr-question]`) goes.

- [ ] **Step 1: Write the failing tests** (changing the Task 6a cases listed above):
  - "asks the width step's questions and shows its two results": the button text is
    `t("printers.ruler_print")`; the QR combobox's label is `t("printers.qr_square")`; no
    `[data-test=calibration-qr-question]`; a printer stored `58mm`/`203dpi` shows results "58 mm"
    and "203 dpi"; after choosing ruler `512` and QR `180dpi` the results read "80 mm" and "180 dpi".
  - Layout at `page.viewport(1280, 800)`: the button's bottom is above the answers' top (it has its
    own row); its right edge is within 2 px of the QR combobox's right edge; the results row's top
    is below the answers' bottom; every row ends within the form width. At
    `page.viewport(390, 844)` in Spanish: no row's right edge is past the modal body's.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "width step"`
  — FAIL: no results, the old QR label, the button beside the answer.
- [ ] **Step 3: Implement** the layout above; remove `.ruler-row`.
- [ ] **Step 4: Run** `printers-screen.test.ts`, `printer-calibration.unsaved.test.ts`,
  `printers-screen.save-state.test.ts` and `printers-screen.a11y.test.ts` whole — pass with no
  other change.
- [ ] **Step 5: Commit** — `git commit -s -m "Calibration step 1: the width test button on its own row, and the paper width and resolution shown as results (A404 point 2)"`.

### Task 6b: Calibration step 1 — the answers alone set the results (point 2, second half)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (step 1)
- Test: `printers-screen.test.ts`, `printer-calibration.unsaved.test.ts`,
  `printers-screen.save-state.test.ts`, `printers-screen.a11y.test.ts` — the changes listed under
  "Existing tests whose assertions change", Task 6b

**Interfaces:** the QR answer's combobox becomes `name="printer-qr-square"` (options `180dpi` →
`printers.test_qr_45`, `203dpi` → `printers.test_qr_40`, value the draft's resolution). The
paper-width dropdown (`printer-paper-width`) is removed: choosing a ruler number sets the paper width,
as today; choosing a QR answer sets the resolution.

- [ ] **Step 1: Write the failing tests.** Change the Task 6b cases as listed: "keeps the printer's
  saved paper width and resolution…" reads the result row and the QR answer `203dpi`, ruler empty;
  the `it.each` over the four `SETTING_WIDTHS` reads the results; add
  `it("has no paper-width dropdown; the ruler's answer sets the paper width")` —
  `wt-combobox[name="printer-paper-width"]` is absent, and choosing ruler `360` makes the result
  row read "58 mm". Delete "clears the ruler answer when paper width is changed directly".
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "width step|ruler|paper-width"`
  — FAIL: the dropdown is still there and the QR answer has its old name.
- [ ] **Step 3: Implement**; move the setup-only tests and the `printer-calibration.unsaved.test.ts`
  cases to the controls named in the list.
- [ ] **Step 4: Run** the four files whole — pass.
  `git grep -n "printer-paper-width\|printer-resolution\|test_qr_help\|calibration-qr-question" -- apps/dashboard`
  prints nothing.
- [ ] **Step 5: Commit** — `git commit -s -m "Calibration step 1: the two answers set the paper width and resolution, with no separate paper-width dropdown (A404 point 2)"`.

### Task 7: "Portable printer", with its explanation, under a step heading that fits (point 4)

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (step 3, from line 3538)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES: `printers.portable`,
  `printers.calibration_drawer` changed; `printers.portable_hint` new)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

Step 3 reads: heading `printers.calibration_drawer`; the cash drawer switch, then its test button
and answer (moved up from the end of the step — beyond the spec, so the drawer's controls sit
together); the portable switch with a hint line `<p class="hint">` holding `printers.portable_hint`
under it, also passed as the switch's `description`; then "When picked up"
(`printer-pickup-roles`) as today.

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

### Task 8: The calibration help bubble (guide link)

Folded into Task 9 if Task 9's implementer has room; kept apart so a reviewer can judge the bubble's
words alone.

**Files:**
- Modify: `apps/dashboard/src/help-guide.ts` — `"printers.calibrate": { page: "printers", section: "calibrate" }`
- Modify: `apps/dashboard/src/screens/printers-screen.ts` — a help bubble beside step 1's heading
- Modify: `apps/dashboard/src/i18n/strings.ts` — `printers.calibration_help_label`,
  `printers.calibration_help`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

This task needs the guide's `calibrate` section, so do Task 9 Step 1 first, then:
- [ ] **Step 1:** `it("explains calibration in a help bubble that links to the guide")` — on step 1
  a `wt-help-tooltip` has `mode="help-mode"`, `aria-label` `t("printers.calibration_help_label")`,
  text `t("printers.calibration_help")` and `guide-href` `guideHref("printers.calibrate")`.
- [ ] **Step 2: Run** it — FAILS (no bubble).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the printers suite and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A help bubble on calibration's first step, linking to the guide (A404)"`.

### Task 9: PR 2's guide section, backlog and a look at it

**Files:**
- Modify: `apps/server/src/guide/en/printers.md`, `apps/server/src/guide/es/printers.md`
- Modify: `apps/server/src/guide-content.test.ts` — the printers case expects
  `["add-printer", "calibrate"]`
- Modify: `docs/backlog.md` (delete the A404 entry, about line 3890), `docs/backlog/printers.md`
  (delete the A404 section; add the open entry below)

- [ ] **Step 1: Add the section** (first change the test's expected ids, run it, watch it fail).
  English, after "Add a printer":

  ```markdown
  ## Calibrate a receipt printer {#calibrate}

  Calibration has three steps. It opens after you add a receipt printer, and **Calibrate printer**
  on the printer's details runs it again.

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

  La calibración tiene tres pasos. Se abre al añadir una impresora de recibos, y **Calibrar
  impresora** en los detalles de la impresora la repite.

  1. Elige **Imprimir prueba de ancho**. En el papel, elige el último número de la regla que se ve
     entero y mide el cuadrado negro del código QR sin su borde blanco. Waitron muestra el ancho del
     papel y la resolución de impresión que resultan. Si dice que no coinciden, vuelve a medir.
  2. Elige **Imprimir recibo de muestra** y comprueba que todas las letras salen con sus acentos y
     que el recibo ocupa el ancho del papel.
  3. Indica si hay un cajón portamonedas conectado y pruébalo. Activa **Impresora portátil** para una
     impresora que lleva una persona, como una de cinturón. Elige **Guardar**.
  ```

  Check each bold word against the screen's words in that language, as in Task 4.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/i18n/guide-pages.test.ts`
  and `pnpm exec vitest run scripts/guide-links.test.ts` — pass. Then Task 8.
- [ ] **Step 3: Backlog.** Delete the A404 entry from `docs/backlog.md` and its section from
  `docs/backlog/printers.md` (both points lists are now done). Add, in the Printers area of both
  files, a short entry "**A rule between TOTAL and the tax lines on a simplified receipt (left open
  by A404).** The owner's A404 list (2026-10-08) asked for a rule before the tax lines; A663 later
  put TOTAL straight after the items, then the rates, with no rule between them. Owner to say
  whether one is wanted; it would change every printed simplified receipt." Leave the entry "While a
  discovery window is open, a device not reported within 45 seconds drops off the list" — still
  true for unpaired devices.
- [ ] **Step 4: Look at it.** As in Task 4 Step 6: screenshots of calibration steps 1 and 3 in both
  themes, at 1280 × 800 and 390 × 844, English and Spanish, before and after answering step 1, and
  the guide page. And the paper: in a throwaway `apps/server` test print
  `printedLines(formatSampleReceipt(...))` for each receipt language at 58 and 80 mm and read it —
  every dish whole, no `?`, no lost accent, the totals adding up. Nothing is committed; the
  throwaway files are deleted. A photo of a real print is the owner's.
- [ ] **Step 5: Commit** — `git commit -s -m "A printers guide section for calibration, and A404 removed from the backlog with its one open question"`.
  Then `/finish-branch` with PR 2's worktree, naming this plan. The PR description lists the
  changed assertions, what goes beyond the spec, the New words tables, and asks the owner the
  TOTAL-rule question.
