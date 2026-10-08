# Interface languages — detail

The open entries are listed in [the backlog](../backlog.md), under "Interface languages". This file holds
their full text.

## Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all four (C125, owner 2026-10-02) — PARKED

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125, owner 2026-10-02) — PARKED by the owner (2026-10-02: "save the full translations for
  much later"); taken out of the campaign queues the same day.** Asked for on C113's question
  ("Land, review words later, and add full translations for catalán, valenciano, and gallego";
  "Receipt + whole app"; Basque: "Treat it like the others"). Nothing was written: the
  `docs/regional-languages` branch holds no commit and no draft. When it is picked up, the first
  step is a spec and plan, ending with the owner's choices:
  - **Receipt:** every fixed word C113 added in Catalan, Galician and Basque checked against an
    official or authoritative source (for example Termcat, the Acadèmia Valenciana de la Llengua,
    the Real Academia Galega or Xunta terminology, Euskaltzaindia or Euskalterm), each with a
    provenance row quoting the source; and Valencian as its own receipt language — which locations
    may or must use it (provinces 03, 12 and 46), what the law requires there, with sources, and
    which printed words differ from Catalan.
  - **Whole app:** the dashboard, the till and setup offered in all four beside English and
    Spanish — how strings are held today and every place that pins the list of interface
    languages (language choosers, `Accept-Language` matching, tests); how translations are
    produced and checked, and what shows when one is missing; whether Valencian is its own
    interface language or a variant; and an order of work that keeps `main` green.

## The payment slip was left alone

- **The payment slip was left alone.** Its words («JUSTIFICANTE DE PAGO», «Importe»,
  «Cobrado») stay Spanish (`apps/server/src/payment-slip.ts`), and its date and amounts still
  follow `WAITRON_TILL_LOCALE` (`apps/server/src/payment-slip-print.ts`). It is not the
  invoice, but art. 128-1.2.a also covers «els altres documents que hi facin referència o que
  en derivin», so a Catalan venue's slip is arguably covered.

## The translations need a native or official check before go-live

- **The translations need a native or official check before go-live.** Apart from the Catalan
  «Factura» and «Propina», which the Consumer Code and the agency's pages use, no word in the
  table was checked against a terminology source. The owner landed it as is on 2026-10-02
  ("land, review words later"); the follow-up (C125, below) was then parked by the owner on
  2026-10-02 ("save the full translations for much later").

## The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way

- The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish
  way (`20,00 €`, `5 ago 2026`), while its words are Galician or Basque. Measured 2026-10-02:
  Playwright's Chromium 153 resolved `gl-ES` and `eu-ES` number and date formats to `en-US`,
  and Google Chrome 154 on macOS to `en-GB`, so the screen falls back to the registry's
  `FALLBACK_RECEIPT_LOCALE` for any language the browser cannot format. The printed receipt is
  formatted on the server and keeps the language's own pattern.
