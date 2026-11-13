# A670: printed menus that look like your restaurant

**One-page design comparison, 13 November 2026. Proposal, not an approved design or build plan.**
The owner’s request, quoted in Lane D `questions.md`, WATCHER 12 November 20:45:
“i'm interested to see how we support templates for printed menus, because the required flexibility
could be challenging. usually restaurants have custom layouts for their menus.” The watcher’s
13 November 19:31 request asks for options, two layout studies and a recommendation.

Your menu needs its own character without someone retyping every price after a change. All three
options would take names, prices, translations and declarations from a selected published menu.
You edit the paper arrangement separately, then preview one publication and language before output.
The [online study’s evidence table](2026-11-13-a670-online-go-live-study.md#evidence-and-future-acceptance-checks)
identifies reusable source pieces, not a working print editor or renderer.

| Option | What you can change as manager | Limit and relative effort |
| --- | --- | --- |
| **Fixed presets** | Choose template, logo, colours, curated fonts, spacing, one/two columns, section order and page breaks. | Lowest initial effort. A narrow wine panel or full-width feature needs a preset that supports it; each new composition adds another preset. |
| **Pages made from blocks**, recommended | Start with a template; arrange headings, section/dish groups, images and a written key. Choose one/two columns, their proportions, block backgrounds and page breaks. Save the arrangement for reuse. | More editor and pagination work, but bounded. No arbitrary positioning, overlapping artwork, rotated text or unrestricted columns. Long content continues onto another page rather than shrinking to fit. |
| **Designer-supplied template with placeholders** | Commission a bespoke HTML/CSS design with slots for live content; choose which groups fill them. | Greatest layout freedom and upkeep. Managers need the designer for structural repairs. File format, fonts/assets and pagination need defined limits. A flat PDF/image has no live slots. Defer upload support. |

## Two quick layout studies

Schematic A4 portrait pages using the same proposed blocks, not rendered mock-ups:

```text
NEIGHBOURHOOD BISTRO                 LUNCH AND WINE
┌─────────────────────────┐         ┌─────────────────────────┐
│ Logo · serif masthead   │         │ Bold restaurant heading │
├────────────┬────────────┤         ├────────────────┬────────┤
│ Starters   │ Mains      │         │ Lunch feature  │ Wine   │
│ name/price │ name/price │         │                │ list   │
│ marks/kinds│ marks/kinds│         │ dish groups    │ tinted │
├────────────┴────────────┤         │ names/prices   │ panel  │
│ Desserts · pale panel   │         │ marks/kinds    │        │
├─────────────────────────┤         ├────────────────┴────────┤
│ Written key · last page │         │ Written key · last page │
└─────────────────────────┘         └─────────────────────────┘
```

**Bistro:** restrained type, balanced columns and a full-width dessert panel. You can widen mains,
remove the panel or move desserts to another page. **Lunch and wine:** a wide lunch feature beside
a narrow, contrasting wine list. Moving wine below lunch needs no new template. These arrange
existing content; they introduce no set-lunch sales feature. Neither covers overlapping artwork.

**Recommendation:** start with blocks and these two templates, A4 portrait, curated type/spacing
choices and optional logo/image blocks. Select existing sections or dishes without changing prices
or the online menu’s order. Keep names, prices and declarations together. Default the written key
to the last page, retaining per-page and inline-words choices from the
[earlier proposal](2026-11-12-a670-guest-menu-design.md); keep cereal/nut kinds with their items.
Do not infer declarations from dish names.

**Future acceptance checks, not run:** inspect long EN/ES text, multipage continuations,
item/price/mark grouping, key placement and actual printed/saved output. These sketches establish
neither pagination nor print-shop readiness. No rendered mock-ups were inspected for this study.

**Open decisions:** do these controls cover the first restaurants’ layouts, or is there a specific
existing menu they cannot express? Recommend blocks first and a concrete counterexample before
adding uploads. Confirm the key-placement default. Decide browser Print / Save as PDF versus
direct PDF download after choosing templates; neither method is settled here.
