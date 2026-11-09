# A1251: counted receipt samples and the remaining test title

Watcher 9 November 13:11 approves the counted-unit correction, one quantity regression in the existing rendered-output case, retaining that case, and batching #2004’s approved title correction. A790’s requested page is now submitted; no A790 build is authorised.

The receipt picture tool currently uses `item`, which the real quantity renderer prints as `1 item`. The retained current-code probe prints bare `1` for `{en: "ea"}` and `1 kg` for weight. Restore the English Each abbreviation in this developer tool only. No production rendering, fiscal fixture or assertion is weakened.

Files: `apps/server/scripts/receipt-look.ts`; `apps/server/scripts/receipt-look.test.ts`; `apps/server/scripts/testing/venue.test.ts`. Four source lines and four test lines (three assertions plus the title), approximately 13 added/removed lines excluding this plan. No backlog rewrite: A1251’s existing review/qualification conditions and open repairs still apply; this correction closes none of those listed points.

First assert “1 Bloody Mary” and “0.35 kg” in `full-weighed-and-counted-a4.pdf`, and “2 Mineral water” in the existing full-invoice text list; observe counted assertions fail. Change `line`’s default to English `ea` and its unit key to `en`; let `filed` pass an optional unit through to that default rather than duplicate it; use `{en: "ea"}` on FULL’s rows. Keep explicit kg, then rerun. This tests both default consumers and FULL without another harness. Narrow only the earlier administrator test title to “stores an English administrator name, email and role”; preserve its body byte-for-byte.

Finish: focused output and two venue cases, source/title byte checks, look at `simplified-two-rates-58mm-203.png` (counted and weighed through `line`) and one A4 invoice, one Claude whole-branch run-it review, normal hook and current-head CI. No extra test file, new harness, catalogue cleanup, unrelated title change, historical-plan edit or whole-package run. No payment/provider call or fiscal writer change.

Copy this one-use plan to receipts and remove it from the final branch, subject to the watcher’s confirmation, as recommended by the plan read and the earlier 12:16 direction. No implementation before the required Claude plan read and watcher answer.
