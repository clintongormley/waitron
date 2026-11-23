# A quieter product editor — design

Owner decisions, 2026-11-23. They came out of an Impeccable critique of the Edit product dialog
(score 25/40) and two rounds of mock-ups shown to the owner. The editor is
`apps/dashboard/src/widgets/product-editor.ts`, and its sections use the shared
`packages/ui/src/components/wt-disclosure.ts`.

## The problem

The dialog felt noisy even with sections folded:

- In the first screenful there were five headings, five large arrows, five full-width lines,
  four summary lines and about twelve bold phrases.
- The fields people change most when editing (price, variants, extras, Available) sat at the
  bottom.
- About half of each summary said "None specified" or repeated a default.
- The Nutritional info summary had no styling at all. `wt-disclosure` styles its own summary
  text, but a summary a screen supplies itself was drawn at body size and full colour.

## Decisions

1. **One order for creating and editing:**
   - category path, then Name with its photo
   - the **Available** switch, always visible under Name
   - **Details** (a section)
   - **Pricing**, **Variants** and **Modifiers**

   The order matches how a product is first set up: what it is, then the harder pricing part.

2. **Details** replaces four sections: Selling, Prep station, Descriptors and Nutritional info. It
   holds five groups, in this order, each under a small, bold, capital, muted group label (the
   design system's group label):
   1. **Prep station**: prep station name and Course
   2. **On the menu**: customer-facing names and descriptions
   3. **Allergens and diet**: the allergen and diet picker
   4. **VAT**: the "Eaten here" line and the VAT when taken away
   5. **Ordering**: Standalone ordering by

   On a variant's page, Ordering is absent. VAT is absent when the venue has neither line.

3. **VAT moves out of Pricing into Details**, so Pricing holds only the price and its unit. The
   owner chose this knowing it puts VAT above the price, which overrules A219 ("the price comes
   before VAT, everywhere", 2026-10-02) for this editor.

4. **Which sections start open:**
   - Details: open when creating a new product (the editor has no `value`), closed when editing.
   - Pricing: open unless the product has an active variant (as today).
   - Variants: open only when the product has an active variant (as today).
   - Modifiers: open only when the product has some (as today).

   The owner's words: "only open the variants and modifiers if there are any".

5. **A closed summary shows only what is set.** It drops "None specified", "None" and default
   values. A section with nothing set shows no summary line at all. "Not yet reviewed" for
   allergens stays, in the warning colour, because it is a warning, not a value. On a variant's
   page, a value inherited from the product still shows, in italic as today. This replaces the
   design-system rule that a summary names every field, filled or not.

6. **Quieter headers, in `wt-disclosure`, for every screen that uses it:**
   - The arrow is `--wt-font-size-sm` square and in the muted text colour. This reverses #1177's
     18px minimum.
   - Field names inside a summary are normal weight, not bold. This reverses A200's bold names.
   - A summary a screen supplies itself is drawn small and muted, like the component's own.

7. **The product editor's sections are `--wt-space-5` (24px) apart**, the design system's spacing,
   not 16px.

## Out of scope

The variants table, the small variant window (`dashboard-variant-form`), and the unit chooser.
