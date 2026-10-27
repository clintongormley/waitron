# A964 Kitchen Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, the owner-selected method, task by task. Steps use checkbox (`- [ ]`)
> syntax. Do not dispatch per-task implementer/reviewer pairs.

**Goal:** Print kitchen-ticket frame words and collection-number-slip words from English and Spanish catalogues, using the venue's saved default content
language.

**Architecture:** Resolve kitchen language inside the transaction that renders new paper, independently of `TillConfig.locale`. Keep pure ESC/POS renderers
separate from database reads and routing. Reuse the existing server i18n directory and bilingual allergy snapshots.

**Tech Stack:** TypeScript, Drizzle/SQLite, Vitest, `@waitron/printing`, server print previews and sharp.

**Spec:** [A964 in the backlog](../../backlog.md) and [A913's fix items](../../backlog/architecture.md#a913s-fix-items-general-code-english-only).
The campaign's per-item test-change and source-reservation rules apply to the future build.

## Global Constraints

- This document plans the future implementation. Publishing it changes no product behavior and does not satisfy any implementation dependency. The commands
  below are future build instructions, not completed verification.
- **BUILD gate:** Reorient Lane C A807/A808 and Lane G A773-2 B–D before implementing. A773-2 PR A landed at `509e8d42a`; B–D and C's A807/A808 remain pending
  in the supplied reservation state. Do not touch their same functions, lines or entries before landing or explicit release. Plan publication does not release
  reservations. Re-read landed code and adjust this plan's reading references before BUILD.
  **2026-10-27:** A807/A808 landed. Kitchen-note change slips are built inside `printCorrectionSlips` by
  `formatKitchenNoteChangeSlip`; the reprint heading is the literal `` `*** REPRINT ${hhmm(ticket.reprintedAt)} ***` `` in
  `kitchen-ticket.ts`. A kitchen-note change is no longer a `CorrectionSlip` kind: its words are in
  `kitchenNoteChangeHeading` and `emitKitchenNoteChange`. Line numbers into `kitchen-print.ts` and
  `kitchen-ticket.ts` in this plan predate A807/A808; find the code by function name.
- A756 owns printing settings; A773 owns course headings and coordination cues. Reuse their landed behavior and interfaces. Do not implement their pending
  work here. A966–A968 wait for A964 **implementation**, not this plan landing.
- No new locale setting, migration, compatibility path or backfill. If implementation reveals a genuine need for one, stop that decision and identify the
  unanswered owner question.
- No receipt/invoice text, fiscal fields, hashes, numbering/allocation, payment-slip policy or A965 work. Do not repurpose `cfg.locale`, `localeOverride` or
  `invoiceLocales`, or overwrite a copied config's locale to make kitchen printing work.
- Preserve widths, print-area/centering commands, routing, printer destinations, copy counts, transaction boundaries, rollback, replay and saved-byte resend
  behavior.
- Preserve all existing behavioral assertions except wording deliberately changed by A964. Inventory every changed check with `file:line`, old/new expectation
  and the authorizing requirement in the future PR's **Changed test checks** section and campaign FYI. Stop on weakened, unrelated or controversial changes.
- General code and new fixtures are English-only; Spanish expectations read the catalogue. Existing protected financial/golden checks stay untouched. Kitchen
  paper requires **FULL future Claude run-it review**, even though this plan is docs-only.

## Review Focus

1. Conflicting regional formatter, content and receipt languages: kitchen frame follows saved content default; card formats retain their input (Tasks 2–4).
2. A less common correction or shared printer: every frame uses the same language without extra slips/notices (Tasks 2 and 4).
3. A language change after sending: new reprints use current frame language and frozen names/allergy translations; old bytes remain fixed (Task 4).
4. Counter placing versus prepaid collection: both number-slip callers keep policy, destination and replay behavior (Task 3).
5. Long labels/notes on 58/80 mm paper: wrapping, centering, widths and cuts remain readable and bounded (Tasks 1, 3 and 5).

## Reading receipts and decisions

These are **source observations at `b4c98d3f0`, not runtime verification**. Proposed behavior below is prospective.

- Setting: `packages/catalogue/src/schema/menu.ts:20` declares singleton `content_languages.default_language`; `content-languages.ts:124` reads it, `:145`
  supplies a fallback, and `:160` writes it. Setup seeds it from geography (`packages/catalogue/src/provisioning.ts:76`). The management API reads/writes it
  at `apps/server/src/catalogue-api.ts:928`. Choose this existing venue setting, not a person's interface language or `locations.invoice_locales`.
- Refresh: catalogue change sources include classified `content_languages` (`packages/catalogue/src/classification.ts:11`, `:41`); composition exports them
  (`packages/composition/src/modules.ts:163`), boot installs them (`apps/server/src/boot.ts:1562`), and the venue dashboard query names the table
  (`packages/venue-service/src/dashboard/live-queries.ts:249`). Printing can read the saved value directly on every render; it needs no cached browser value.
- `readTillSetup` exposes boot-derived display locale and separate receipt choices (`apps/server/src/till-setup.ts:89`); `setupRevisionOf` hashes its returned
  fields (`:133`). `/api/menu-state` returns that revision (`till-api.ts:1607`); the till applies its listed venue fields at `apps/till/src/till-app.ts:9383`,
  without applying display locale there. A964 adds no till field/revision or browser refresh dependency.
- Config trace: `config.ts:536` calls the loader; `till-config.ts:82` defaults absent/empty `WAITRON_TILL_LOCALE` to `es-ES`, retains the raw override and
  initializes `invoiceLocales`. `trading-config.ts:33` writes neither locale variable nor language. `apps/server/scripts/dev-setup.ts:152` writes the
  development override. Boot passes raw override into `readVenueLocale` (`boot.ts:1634`), which derives display locale from geography (`venue-locale.ts:58`).
  Preserve that chain.
- Other `cfg.locale` consumers: content fallback/pricing/modifiers (`working-order.ts:691`, `:1048`, `:5461`); cancelled-extra snapshot units (`:2922` into
  `kitchen-print.ts:969`); cancellation-reason fallback (`line-cancel.ts:74`, `:326`); made-here response units (`till-api.ts:1254` into `made-here.ts:111`).
  Preserve these meanings, including existing unit lookup at `kitchen-print.ts:94`, `:268`, `:302`, `:666`.
- Card-slip trace: `payment-slip-print.ts:92` passes `cfg.locale` as `invoiceLocale`; `payment-slip.ts:41`, `:51`, `:54`, `:55` use it for dates and money,
  through `receipt-dates.ts:35` and `receipt-money.ts:26`. Preserve it and the existing slip words/policy. Test this boundary rather than changing global
  config semantics.
- Kitchen frame consumers: cross-references (`kitchen-print.ts:272`, `:329`), regular/held/reprint headers (`:629`), order-note changes (`:840`), station
  moves (`:922`), extra cancellation (`:1034`), corrections/allergy notices (`:1119`), moved-place text (`:1359`) and moved slips (`:1488`). Common rendering
  roots are `planKitchenTickets`, `printCorrectionSlips` and `notifyMoved`.
- Caller paths: working-order firing/corrections (`working-order.ts:2191`, `:2438`, `:2965`); held work (`order-groups.ts:1925`, `:1977`); station movement
  (`station-move.ts:140`, `:380`); notes (`order-kitchen-note.ts:233`); allergy changes (`kitchen-allergy.ts:398`, `:498`); move/split/merge
  (`moved-slips.ts:45`, `move-bill.ts:323`, `bill-actions.ts:202`); explicit reprint (`till-api.ts:2293`). Keep their public signatures and gates.
- Names: `buildTicketItems` uses recorded `kitchenPresentationName` and option snapshots (`kitchen-print.ts:318`), not translated customer names. Allergies
  freeze **both** language presentations (`kitchen-allergy.ts:134`, `:146`); renderer selects `block.labels[language]` (`kitchen-ticket.ts:189`). They are
  recorded content, not frame dictionary entries. Do not rebuild them from current catalogue/guest data.
- There is no current `order-number-slip.ts` in this checkout. The collection slip is inline in `receipt-print.ts:283`; extract it. Its callers are prepaid
  receipt handling (`receipt-print.ts:271`) and pay-on-collection placing (`working-order.ts:6525`). Its label currently comes from
  `receiptLabelsFor(cfg.locale)` (`receipt-print.ts:299`).
- Outbox: resend copies `job.payload` and the same printer (`packages/printing/src/outbox.ts:89`, `:117`); runtime sends claimed bytes (`runtime.ts:229`). A
  new kitchen reprint renders again (`kitchen-print.ts:1689`). Those operations must remain distinct.
- i18n siblings use named `as const` maps (`i18n/staff.ts:1`, `guide-certificate.ts:1`, `kitchen-allergy.ts:3`). Decode assertions use
  `testing/decode-ticket.ts:23`; previews expose actual bitmap blocks (`print-job-preview.ts:52`). Layout/centering rules are in
  `docs/developers/conventions-ui.md:963`, `:1111`; snapshot rules in `products.md:101` and `conventions-ui.md:1152`.

**Prospective language contract:** `readKitchenLanguage(tx)` reads `readContentLanguages(tx, FALLBACK_LOCALE).defaultLanguage`, with shared `FALLBACK_LOCALE`
(`en-GB`). Spanish base language selects `es`, case-insensitively; every other language selects `en` until a catalogue exists for it. Missing content
configuration therefore prints English, independent of `WAITRON_TILL_LOCALE`, geography and receipt language. A saved unsupported default such as
`ca-ES-valencia` also selects English, without rewriting the setting.

Read once per common render operation in its existing transaction, outside item/printer loops. New tickets, correction slips, moved slips, collection slips
and explicit reprints see the latest committed content default on their next render, with no restart. Already queued jobs, transport retries and saved-byte
resends keep their bytes. A language-setting change alone creates no print job or notice.

Keep language responsibilities explicit: frame words and cross-reference connectors use resolved kitchen language; allergy wording selects the same language
**from its frozen bilingual block**, never from live allergen names. Product/variant/option/kitchen names, free notes, station/table/party/course names remain
recorded text. Unit-map selection and its first-stored-value fallback retain their current `cfg.locale` behavior in A964; do not normalize, filter or rewrite
snapshots using enabled content languages.

## File map

- Create `apps/server/src/i18n/kitchen-ticket.ts`: typed English/Spanish frame dictionary, pure language selection and lookup; reuse existing
  `i18n/kitchen-allergy.ts` unchanged.
- Create `apps/server/src/kitchen-language.ts`: transaction-scoped content-default reader only.
- Modify `apps/server/src/kitchen-ticket.ts`: catalogue-backed frame rendering; retain current exported renderer signatures and semantic union values.
- Modify `apps/server/src/kitchen-print.ts`: pass resolved language through frame paths; retain unit/name reads, output planning and public enqueue
  signatures.
- Create `apps/server/src/order-number-slip.ts`: pure number-slip renderer; modify only the collection-slip body/imports in `receipt-print.ts`.
- Tests: new `i18n/kitchen-ticket.test.ts`, `kitchen-ticket.language.test.ts`, `kitchen-language.test.ts`, `kitchen-print.language.test.ts`,
  `order-number-slip.test.ts`, `kitchen-language.boundaries.test.ts`, `kitchen-language.look.test.ts`; extend existing print/allergy/collection suites named
  below.
- Future docs: `apps/till/README.md`, `apps/server/src/guide/{en,es}/{kitchen-service,content-and-images}.md`, `docs/developers/conventions-ui.md`;
  update A964 backlog entries only when implementation makes them stale. Include `docs/backlog/kitchen.md` in the prose audit.

### Task 1: Extract frame words without changing paper contracts

**Interfaces:** In `i18n/kitchen-ticket.ts`, export `KitchenLanguage = "en" | "es"`, `kitchenLanguageFor(locale: string): KitchenLanguage`,
`KitchenTicketWords` (English keys widened to `string`), `KITCHEN_TICKET_WORDS: Readonly<Record<KitchenLanguage, KitchenTicketWords>>`, and
`kitchenTicketWords(locale: string): KitchenTicketWords`.

Inventory keys: `collectionOrder`, `forKitchen`, `changed`, `cancel`, `movedTo`, `fromStation`; cross-reference templates `withRef`, `forRef`,
`forNoPreparation`; `alsoOnOrder`, `onHold`; `noteChanged`, `noteRemoved`, `noteRemovedBody`, `was`; `moved`, `order`, `fromPlace`, `toPlace`, `counter`;
operational markers `reprint`, `group`, `hold`, `fire`, `void`, `recalled`, `holdChanged`, `holdCancelled`. Keep placeholders `{name}`, `{station}`, `{time}`
and significant prefix spaces explicit.

**Wording inventory:** Move existing EN/ES branches at `kitchen-ticket.ts:177`, `:402`, `:412`, `:421`, `:443`, `:478`, `:526` unchanged into keys.
`collectionOrder` retains existing English Order/Spanish catalogue equivalent. Translate the displayed GROUP/HOLD/FIRE/VOID/RECALLED/HOLD CHANGED/
HOLD CANCELLED/REPRINT markers too; their mixed-language output is open work in `docs/backlog/kitchen.md:25` and `docs/backlog.md:1933`. Keep semantic
`kind`/`mark` enum values unchanged. Reuse the corresponding Spanish words already shown by the till (`table.group_n`, `table.group_held`,
`table.group_fire`, `station.notice.void`, `station.notice.recalled`, `action.reprint` in `apps/till/src/i18n/strings.ts`) as wording references, without
adding a server import from the till. Compose changed/cancelled held-work headings in the server catalogue; list their proposed Spanish wording in the
implementation's copy inventory. Reuse A808's released reprint-time template and A773's released heading/cue wording, preserving fields, times and order;
where their copy is still awaiting approval, retain that existing gate. English rendering retains its existing markers.

- [ ] Write `A964 frame catalogue` tests in the two new pure suites. Check equal key sets, Spanish regional/case variants, English/unsupported/empty fallback;
      table-drive regular, shared-station, HOLD/FIRE, reprint, every `CorrectionSlip.kind`, moved counter/table, cross-references, rest-of-order and note
      removal. Assert complete printed line arrays, quantities/signs, prefixes, order and times. Read Spanish from the frame/allergy catalogues; also assert
      that the displayed Spanish markers differ from the English enum strings, with identical quantities and semantic inputs.
- [ ] Run RED: `pnpm --filter @waitron/server exec vitest run src/i18n/kitchen-ticket.test.ts src/kitchen-ticket.language.test.ts -t 'A964 frame catalogue'`.
      An initial missing-module/export error identifies test wiring only. Establish a behavioral RED through the existing public renderer: Spanish input must
      print translated markers rather than the current English markers. Observe that assertion fail before extracting the catalogue; cover the remaining
      extraction with the preserved English output and existing renderer assertions.
- [ ] Implement the typed dictionary using sibling named-constant style; enforce Spanish key parity against English keys. Replace inline frame
      strings/branches in `kitchen-ticket.ts`, including marker rendering and moved-place words. Preserve wrapping, sanitization, grouping, join/cut and
      existing API contracts. Substitute free-text placeholders with callbacks so `$` in stored names remains text.
- [ ] Run GREEN with the same command unfiltered, then
      `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-ticket.kitchen-note.test.ts src/kitchen-ticket.allergy.test.ts`.
      Expect passing Tests counts. English bytes remain fixed for the same input; Spanish marker checks change deliberately to the translated catalogue
      values while retaining every quantity, prefix, order, time and routing assertion. Inventory those authorized wording changes. Add long names containing
      `$&` to cross-reference expectations.
- [ ] Stage only this task's files and make a signed commit: `git commit -s -m "refactor: extract kitchen paper frame catalogues"`.

### Task 2: Read the venue setting at every kitchen render boundary

**Interfaces:** `kitchen-language.ts` exports `readKitchenLanguage(tx: Transaction): Promise<KitchenLanguage>` using Task 1's selector. Private
`buildTicketItems(tx, cfg, lineIds, language: KitchenLanguage)` uses the new argument only for cross-reference frame connectors; its snapshot units still use
`cfg.locale`. The three common rendering roots resolve language and fill all top-level/nested renderer `locale` fields with it. Remove redundant private
`CorrectionChange.locale` fields/caller literals rather than passing stale overrides; public enqueue APIs keep their signatures.

- [ ] Write `A964 venue language` in `kitchen-language.test.ts` and `kitchen-print.language.test.ts`, using `useVenueDb` with real migration descriptors and
      existing `testing/split-extras-venue.ts` /`testing/party-venue.ts` helpers. With `cfg.locale="de-DE"`, content default `en` with enabled languages
      `["en", "es"]`, receipt locale `es-ES`, print a named table order, counter order, cross-station extra, rest-of-order and moved counter/table slips.
      Assert English connectors/frame and frozen kitchen names; then change content default to `es` in a separate transaction without remounting/restarting
      and assert new Spanish frame. Include no saved row with Spanish cfg, and saved `ca-ES-valencia`: both resolve English.
- [ ] Run RED: `pnpm --filter @waitron/server exec vitest run src/kitchen-language.test.ts src/kitchen-print.language.test.ts -t 'A964 venue language'`.
      Missing-reader imports are wiring errors, not behavioral receipts. First run the real existing print-root cases: conflicting-setting frame assertions
      must fail for the wrong printed language, not fixture validation. Only then add the reader and its direct tests.
- [ ] Implement the reader and thread language in `planKitchenTickets`, `printCorrectionSlips`, `notifyMoved`, cross-reference construction, moved-place text
      and all nested note/from/party/rest headers. Keep early no-work/no-printer exits. Do not use `{ ...cfg, locale: language }`, change snapshot-unit
      readers, alter notice payloads or add database reads per item/printer. Reorient A807 batching before editing the correction root.
- [ ] Run GREEN unfiltered; then
      `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/kitchen-print.shared-printers.test.ts src/kitchen-print.concurrency.test.ts src/station-move.test.ts src/moved-slips.test.ts`.
      Expect passing Tests counts, unchanged job counts/destinations/links, rollback and no-printer behavior. Assert one content-setting read per common
      rendering-root invocation, not per line or printer.
- [ ] Stage this task's files and `git commit -s -m "feat: resolve kitchen frame language from venue content settings"`.

### Task 3: Extract and localize both collection-number-slip paths

**Interfaces:** `order-number-slip.ts` exports
`formatOrderNumberSlip(input: { orderNumber: number; language: KitchenLanguage }, layout: EscSetting): Uint8Array`. `enqueueCollectionTicket` keeps its
signature, sale-policy gate and cached `PrinterLookup`; after finding an eligible printer it reads Task 2's language and calls this renderer. It remains a
`document` job with no sale id or drawer command. `working-order.ts` and prepaid caller signatures stay unchanged.

- [ ] Write `A964 collection language` in `order-number-slip.test.ts` and extend `receipt-print.test.ts:501`, `:548`, `:574`, `:619`. Cover both
      `ticket_then_pay` placing and prepaid payment with formatter `de-DE`, content `en`, receipt `es-ES`, then content `es`. Assert catalogue label and **the
      allocated number returned by the operation**, exactly one eligible slip, policy-off/no-printer no-op, original receipt/drawer behavior, printer lookup
      count and destination. Retain place replay's one-job assertion; add prepaid replay's unchanged slip count.
- [ ] Run RED: `pnpm --filter @waitron/server exec vitest run src/order-number-slip.test.ts src/receipt-print.test.ts -t 'A964 collection language'`. Expect
      the wrong existing cfg-based label in the caller cases before extracting the renderer; a missing-renderer import is not the behavioral receipt.
      Include a counter order delivered to a table; its kitchen label remains
      that table's stored text, while the number slip keeps its existing two-line content.
- [ ] Extract only the inline builder at `receipt-print.ts:294`. Use `KITCHEN_TICKET_WORDS[language].collectionOrder`; retain init, explicit grid-width print
      area, native center, order-number line, feed/cut. Do not alter receipt labels, receipt building or allocation.
- [ ] Run GREEN: `pnpm --filter @waitron/server exec vitest run src/order-number-slip.test.ts src/receipt-print.test.ts src/sent-order-number.test.ts`. Expect
      passing Tests counts. At 58/80 mm and 180/203 dpi assert GS L/GS W precede centering, widths 360/384/512/576 respectively, two lines, one cut and no
      pulse. Inventory only authorized wording expectation changes, including the existing collection label at `receipt-print.test.ts:534`.
- [ ] Stage this task's files and `git commit -s -m "feat: use venue kitchen language on collection number slips"`.

### Task 4: Pin corrections, snapshots and unaffected formatter behavior

**Files:** Extend `kitchen-print.language.test.ts`, `kitchen-print.allergy.test.ts`, `kitchen-allergy.notices.test.ts`,
`order-kitchen-note.corrections.test.ts`; create `kitchen-language.boundaries.test.ts`. Reuse the already landed A807/A808 assertions, without restoring their
previous behavior.

**Interfaces:** Exercise existing public enqueue/reprint/correction functions through real order operations; use `resendPrintJob`, `printSalePaymentSlip`,
`printedLines`, `printedCommands` and `opensDrawer`. Do not change production snapshot structures or financial functions.

- [ ] Write `A964 language boundaries` cases: regular and HOLD work, partial VOID/RECALLED, HOLD added/removed/cancelled, extra cancelled, station reroute,
      order-note changed/removed, allergy changed/removed, moved split/merge and joined fired/HOLD reprint. In `cfg.locale="de-DE"`, content `en`, receipt
      `es-ES`, assert every frame path and relevant quantity/sign/time, alongside existing notice, batching and destination assertions. Parameterize new cases
      over `en` /`es`; Spanish text comes only from i18n.
- [ ] Add a distinguishing snapshot case: staff `Staff roast`, customer `Diner roast`, kitchen `Pass roast`; variant and option names also differ across all
      three audiences. Record bilingual allergy labels, guest/note, weighted unit map and fired/held copies. Change live product names, guest/allergen
      selections and content default; reprint must select the stored allergy translation for the new frame language, keep original who/note/names and existing
      unit fallback, and preserve original snapshots/old job bytes. Assert both `originalBlock` and `currentBlock` unchanged by reprinting; ordinary reprints
      use the original block (`kitchen-print.ts:309`), while allergy correction slips use the updated current block. Unticked work has no allergy frame;
      removal correction has no guest block. Do not filter snapshots by the new enabled-language list.
- [ ] Add a frozen clock boundary case through `printSalePaymentSlip`: same settled payment before/after content-default change yields identical card-slip
      bytes, including `receiptDateTime(paidAt, cfg.locale)` and `formatMoney("1234.56", cfg.locale)`. Use an English formatter control whose date/money
      differ to make the assertion discriminating. Compare existing receipt bytes and stored sale/fiscal/series rows before/after kitchen-only rendering; do
      not change protected expectations. Resend a failed kitchen job after the language switch and assert identical saved payload/printer; an explicit kitchen
      reprint has current frame language. Language update alone enqueues nothing.
- [ ] For each new case run RED **before its minimal fix**, using
      `pnpm --filter @waitron/server exec vitest run src/kitchen-print.language.test.ts src/kitchen-print.allergy.test.ts src/kitchen-allergy.notices.test.ts src/order-kitchen-note.corrections.test.ts src/kitchen-language.boundaries.test.ts -t 'A964 language boundaries'`.
      Expected failures for a missing behavior are stale cfg-based frame paths or snapshot/byte mismatches. Preserved-behavior cases may already pass: test
      their strength in an independently installed disposable checkout containing the complete candidate tree. Delete the targeted language argument there,
      observe the intended assertion fail, restore it there and run the accepting control. Never swap or mutate feature-worktree files for a control; remove
      only that disposable checkout after collecting the evidence. Do not invent a production fix for an already-correct case.
- [ ] Run the same five files unfiltered. Expect passing Tests counts with all existing assertions preserved. Keep state/notice/job-count assertions even
      where wording is updated; document any fixture additions separately from changed expectations.
- [ ] Stage this task's files and `git commit -s -m "test: pin kitchen language and recorded print boundaries"`.

### Task 5: Inspect rendered paper and finish future implementation

**Files:** Create `kitchen-language.look.test.ts`; modify the documentation in the file map. Do not change printer transport or dashboard preview code.

**Interfaces:** Build the Task 1/3 pure fixtures, decode using `previewPrintJob`, and write actual `image` blocks as stacked monochrome PNGs with sharp when
`A964_LOOK_DIR` is set. Reuse the bit order shown in `apps/dashboard/src/widgets/print-paper.ts:74`; do not turn decoded text into a substitute rendering.

- [ ] Write `A964 paper layout` assertions for EN/ES regular/shared tickets, corrections, A808 reprint, moved counter/table, allergy note/clash and collection
      number. Use long distinct names and notes; cover 58/80 mm at both resolutions. Assert preview is neither unsupported nor truncated, image widths match
      printer dots, line wrapping stays within 30/42 columns, and expected labels/items/cuts survive. Observe the deliberate wrong-width/missing-content
      failure and restored accepting control only in the installed disposable checkout described in Task 4. Save PNGs plus fixture-language/layout metadata
      for LOOK.
- [ ] Run
      `env -u AI_AGENT -u CLAUDECODE A964_LOOK_DIR="$(mktemp -d /tmp/a964-paper.XXXXXX)" pnpm --filter @waitron/server exec vitest run src/kitchen-language.look.test.ts`.
      Require passing Tests count and printed artifact paths. Open and **LOOK at** every rendered 58/80 mm EN/ES sheet, including centering, accents,
      continuation indentation, marker separation, long allergy blocks and joined reprint's single cut. Record observed defects/fixes. This is rendered-output
      evidence, never a claim about physical printing.
- [ ] Update till README's locale-consumer description (`apps/till/README.md:139`), explaining kitchen frame's content-default choice, English fallback,
      next-render refresh and unchanged units/card formats. Update the kitchen-service and content-and-images guide twins with shared heading ids, and
      `conventions-ui.md`'s live-setting explanation; distinguish frame language from recorded names/allergies. Review whole touched prose for obsolete locale
      claims. Audit `docs/backlog/kitchen.md:25–30` and its root-backlog counterpart for the old English markers and `WAITRON_TILL_LOCALE` claims. Delete
      completed portions after implementation, retaining actual residuals and unrelated printing-problem entries. Preserve A966–A968's dependency until
      implementation lands.
- [ ] Run `pnpm --filter @waitron/server typecheck` and the new/changed suites unfiltered. Also run
      `pnpm --filter @waitron/server exec vitest run src/payment-slip.test.ts src/receipt-language.test.ts src/guide-content.test.ts` and
      `pnpm exec vitest run scripts/guide-links.test.ts scripts/kitchen-allergy-words.test.ts`. Require actual passing Tests counts and successful types; do
      not claim a docs formatter pass for an ignored path. Because collection slips share a receipt-printing file, also run the protected suites UNEDITED:
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. No failing fiscal check may be edited
      to make this item pass.
- [ ] Review `git diff --check`, the complete changed-test inventory, and diff prose/literals for Spanish outside i18n/guides. Stage only reviewed files and
      `git commit -s -m "docs: explain and verify venue kitchen paper language"`.
- [ ] Announce ready for `finish-branch`; execute it only in the implementation workflow. Require one **FULL Claude run-it whole-branch review** in its own
      throwaway checkout after initial rebase, triage findings, normal pre-push hook, and required current-head CI coverage results. Do not substitute this
      plan/self-review for runtime evidence or physical-paper evidence; do not merge without applicable owner authorization.

## Implementation handoff

Self-review against A964/A913 and the bounded assignment: setting/fallback/refresh and all locale consumers are recorded above; Tasks 1–3 define
dictionary/reader/renderer interfaces, Tasks 2–4 cover real callers and distinct snapshot names, Task 5 covers rendered output and FULL review. Each
review-focus case maps to an executable task. No new setting or schema is proposed.

The existing content default supplies the venue-language setting without adding configuration. Runtime outcomes, reservation releases and rendered/physical
output remain unverified by this plan. Reorient the BUILD gate before taking Task 1. Apply the established implementation, review, CI and landing workflow;
this document introduces no additional owner approval for ordinary non-fiscal implementation.
