# Work through a Spain VAT return

When you check a VAT return, reconcile the recorded invoice amounts before looking at the file.
This example follows August 2026 trade through Waitron's reporting functions. You can run the
same figures against real sale writes and a fake fiscal backend from the repository root:

```sh
pnpm --filter @waitron/server exec vitest run src/reporting-write-workflows.test.ts
```

The scenario uses one venue in `Europe/Madrid`, with a 05:00 business-day changeover and two
recording nodes. Every sale is issued at 12:00 Madrid time, with a recorded offset of 120 minutes.
The fake backend keeps this example separate from tax-agency submission.

## Start with the recorded sales

You have six ordinary invoices and one correction. All amounts below are euros.

| Node | August day | VAT rate | Base | Tax |
| --- | --- | --- | --- | --- |
| One | 3 | 21% | 100.00 | 21.00 |
| One | 10 | 10% | 50.00 | 5.00 |
| One | 17 | 21% | 200.00 | 42.00 |
| Two | 5 | 10% | 80.00 | 8.00 |
| Two | 12 | 21% | 40.00 | 8.40 |
| Two | 24 | 10% | 30.00 | 3.00 |
| One, correction of day 3 | 18 | 21% | -5.00 | -1.05 |

Call `computeVatReturn(tx, { year: 2026, period: { kind: "month", month: 8 } })` to
aggregate the period by the invoices' recorded civil issue dates. Its output VAT, *IVA devengado*, is:

| Rate | Base | Tax |
| --- | --- | --- |
| 10% | 160.00 | 16.00 |
| 21% | 335.00 | 70.35 |
| Total | 495.00 | 86.35 |

For an operational report, call `computeVatSummaryForPeriod` with business days August 1 to 31
and the clock settings from `resolveVenueClock`. The whole month gives base 495.00, tax 86.35 and
gross 581.35. Filter by node and you get base/tax/gross of 345.00/66.95/411.95 for node one and
150.00/19.40/169.40 for node two. Narrow the business-day range to August 3 to 9 and you get
180.00/29.00/209.00. The test checks each result separately.

## Add the supplier invoices

The deduction period uses each supplier invoice's received date. Keep the recorded tax amount:
the first invoice below carries 41.99, even though 21% of its base is 42.00.

| Invoice | Issued | Received | Regime | Kind | Rate | Base | Recorded tax |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026/501 | Aug 1 | Aug 4 | General | Ordinary | 21% | 200.00 | 41.99 |
| F-88 | Aug 6 | Aug 9 | General | Ordinary | 10% | 100.00 | 10.00 |
| INV-7 | Aug 11 | Aug 14 | General | Capital | 21% | 1000.00 | 210.00 |
| T-3 | Aug 17 | Aug 20 | Equivalence surcharge | Ordinary | 21% | 50.00 | 10.50 |

With the full deduction proportion used by this fixture, the general-regime input VAT,
*IVA deducible*, has base 1300.00 and tax 261.99. The surcharge invoice is excluded from this
calculation. Ordinary and capital purchases remain separate in `deductible.byRate`.

Your result is `86.35 - 261.99 = -175.64`. July and September have no trade in this dataset,
so the third-quarter return equals August and the annual aggregate has the same figures.
The test also adds the three monthly results to check the quarter.

## Inspect the file

Pass the return to `mapModelo303`, then call `toDr303Record` with tax id `50000000K`, name
`Deli Example Ltd`, year `2026`, period `08` and declaration type `C`. Here `C` is an explicit
example choice. The reporting functions do not select the declaration type for you.

The test checks the monthly file and a quarterly file with period `3T`. Both have 2944 bytes.
It reads these slices independently of the serializer's field map, with zero-based offsets:

| Slice | Meaning | Monthly bytes |
| --- | --- | --- |
| 10–11 | Period | `08` |
| 1023–1039 | Box 27, output VAT | `00000000000008635` |
| 1346–1362 | Box 46, general-regime result | `N0000000000017564` |

The quarterly period bytes are `3T`; the two amount slices are the same. The `N` prefix encodes
this example's negative result. These checks exercise Waitron's serialization; they do not send
a file to AEAT or establish that AEAT accepts it. You can inspect the Spain-specific mapping and
layout in [modelo-303.ts](../src/modelo-303.ts) and [dr303.ts](../src/dr303.ts).
