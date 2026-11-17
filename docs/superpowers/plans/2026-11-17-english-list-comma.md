# Kitchen lists use the supported regional locale

**Ask:** ENGLISH-LIST-COMMA in `~/waitron-campaign-i/queue.md`. Once landed,
printed kitchen cues use “Grill, Fryer and Pastry”, as the production till and
dashboard already do. The watcher cleared this replacement route at 16:03 and
16:11 on 2026-11-17 in this lane’s `questions.md`; no owner design approval is claimed.
Claude’s first plan read found that the production till already uses `en-GB`.

**Reuse and boundary:** Keep `packages/shared/src/list.ts` and its tests unchanged.
`readKitchenLanguage` currently reduces saved content settings to the two available
wording languages. Those settings hold language codes, not regions
(`packages/menu/src/content-languages.ts:163–180`). Keep that words selection, then
choose from `SUPPORTED_LOCALE_CODES` by matching `Intl.Locale.language`: prefer
the matching entry whose `Intl.Locale.region` equals the taxpayer country, otherwise
the first language match, otherwise `FALLBACK_LOCALE`. No language-specific exception.
Use `readTaxpayer` in the existing transaction, with its absent country treated as no match.

- [ ] In `apps/server/src/kitchen-language.ts`, keep the existing asynchronous reader
  and expose a small pure locale selector taking language, country and the supported
  list. Return the selected full locale from the reader. In `kitchen-print.ts`, widen
  the three `KitchenLanguage` parameter/field types to `string`, removing that type import.
  Trace `buildTicketItems`, `PortionRead`, `MovedSlipPrinting` and every reader caller.
  At the two allergen-wording calls, reduce the full locale through `kitchenLanguageFor`;
  those tables still index by the wording language. In `order-number-slip.ts`, accept
  a string and resolve `collectionOrder` through `kitchenTicketWords`, preserving its
  output for raw language codes and adding full-locale support.
  Do not change any shared list helper, wording table or content-language setting.
- [ ] First add a venue-to-paper regression in `apps/server/src/kitchen-language.test.ts`:
  keep selector/reader checks in this file. In `kitchen-print.language.test.ts`, use
  its existing four-station fixture and grouped-order helpers to fire an English
  order whose other-station cue has three names. Decode the queued print job and
  assert the literal cue has no comma before `and`; observe the extra comma before fixing.
  This must reach `enqueueKitchenTickets`, not call the formatter directly.
  Update existing reader assertions from reduced wording language to the full locale;
  retain every stored-settings unchanged assertion and unsupported-language fallback.
  Add a small table for the selector using two supported regional variants of another
  language: matching country, no country/region match (first), and no language match
  (fallback). The selector owns these choices; callers add no copies of those tests.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/kitchen-language.test.ts
  src/kitchen-ticket.test.ts src/kitchen-print.language.test.ts src/order-number-slip.test.ts
  src/receipt-print.test.ts src/kitchen-print.allergy.test.ts` and
  `pnpm --filter @waitron/server typecheck`, observing passing test counts. Keep all
  raw-locale kitchen-ticket assertions unchanged: `en` remains a valid request to Intl.
  These raw-Intl wrapping cases are not examples of the new production English paper.
  The reader suite owns locale selection and the print-language suite the queued cue; existing
  kitchen suites own paper wrapping, translation, reprints and correction slips.
- [ ] Delete only the serial-comma point in `docs/backlog/till.md` and use
  `1 entry, size S.` for that bundle; change its `docs/backlog.md` count to 1.
  Keep the counter-order question. Before landing, reconcile Lane C’s simultaneous
  KITCHEN-HEADINGS-MAIN-LANGUAGE change by rebasing only if needed and retaining both outcomes.

**Leave out:** changing the till, dashboard, shared helper, Spanish wording, raw `en`
formatting, settings, guides, counter-order cues, and unrelated cleanup.
**Expected size:** production 25–40 added/changed lines across kitchen-language.ts,
kitchen-print.ts and order-number-slip.ts; tests 45–75 added/changed lines; docs this short plan and the two named backlog edits.
No new package, file, setting, record or framework. Outside opinion before growth past
roughly 140 production/test changed lines.
