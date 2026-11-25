# Interface languages — detail

The open entries are listed in [the backlog](../backlog.md), under "Interface languages". This file holds
their full text.

## Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all four (C125, owner 2026-10-02; off hold 2026-11-08)

- **Off hold (owner, 2026-11-08): the staff screens should be offered in every official language.**
  Extend setup's English/Spanish working-language choice and its starter translations to the new
  languages, including Catalan, Valencian, Galician and Basque course names (A1458). Decided the same
  day: **Valencian is a variant of Catalan**, not a separate translation; only the words that differ
  get their own. Setup's starting content languages (`STARTER_CONTENT_LANGUAGES`,
  `packages/country-packs/src/starter-languages.ts`) lack Basque today; add it. Parked from
  2026-10-02 ("save the full translations for much later"). Asked for on C113's question
  ("Land, review words later, and add full translations for catalán, valenciano, and gallego";
  "Receipt + whole app"; Basque: "Treat it like the others"). When it is picked up, the first step is a spec and plan, ending with the owner's choices:
  - **Receipt:** every fixed word C113 added in Catalan, Galician and Basque checked against an
    official or authoritative source (for example Termcat, the Acadèmia Valenciana de la Llengua,
    the Real Academia Galega or Xunta terminology, Euskaltzaindia or Euskalterm), each with a
    provenance row quoting the source; and Valencian as its own receipt language — which venues
    may or must use it (provinces 03, 12 and 46), what the law requires there, with sources, and
    which printed words differ from Catalan.
  - **Whole app:** the dashboard, the till and setup offered in all four beside English and
    Spanish — how strings are held today and every place that pins the list of interface
    languages (language choosers, `Accept-Language` matching, tests); how translations are
    produced and checked, and what shows when one is missing; Valencian as a variant of Catalan
    (decided 2026-11-08); and an order of work that keeps `main` green.

- **Content-language names outside English and Spanish (A419 review, 2026-10-08):** when you add
  these interface languages, give Valencian its own translated display name and check the picker.
  The review probe returned the raw `ca-ES-valencia` code in Galician and the compound
  `Català (Espanya, valencià)` in Catalan from `languageDisplayName`; A419 supplies the English and
  Spanish names.

## The translations need a native or official check

Go live with the current words;
staff report anything that reads wrong (owner, 2026-10-21). A terminology review remains
future work, alongside the parked full-interface translations above. This is no longer a
condition for go-live.

## Bundle: Native speaker review

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The demo’s Catalan and Galician text needs a speaker’s check** (W109-3, #1321,
  owner decision 4, 2026-10-06). A speaker of each should read it.
  [Detail](setup.md#the-demo-data-carries-catalan-and-galician-text-w109-3-1321-task-3-of-the-same-plan--done-the-text-is-unchecked-by-a-speaker-owner-decision-4-2026-10-06--open)
- **The recovery page's Spanish has not been read by a native speaker.**
- **The translations need a native or official check**, including Catalan, Valencian, Galician
  and Basque starter-course words when C125 adds them.
  [Detail](languages.md#the-translations-need-a-native-or-official-check)

## Bundle: Regional languages

2 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125) — off hold (owner, 2026-11-08); Valencian is a variant of Catalan.**
  [Detail](languages.md#catalan-valencian-galician-and-basque--the-receipts-words-checked-and-the-whole-app-in-all-four-c125-owner-2026-10-02-off-hold-2026-11-08)
- The printed Basque date is the formatter's own pattern, «2026(e)ko urt. 15(a)», and on 58 mm
  paper it drops to its own line wherever it prints in words.
