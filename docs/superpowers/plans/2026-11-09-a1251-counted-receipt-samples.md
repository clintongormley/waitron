# A1251: counted receipt samples and the remaining test title

Watcher 9 November 13:11 approves the counted-unit correction, one quantity regression in the existing rendered-output case, retaining that case, and batching #2004’s approved title correction. A790’s requested page is now submitted; no A790 build is authorised.

The receipt picture tool currently uses `item`, which the real quantity renderer prints as `1 item`. The retained current-code probe prints bare `1` for `{en: "ea"}` and `1 kg` for weight. Restore the English Each abbreviation in this developer tool only. No production rendering, fiscal fixture or assertion is weakened.

Files: `apps/server/scripts/receipt-look.ts`; `apps/server/scripts/receipt-look.test.ts`; `apps/server/scripts/testing/venue.test.ts`; `docs/backlog.md`; `docs/backlog/ci.md`. Estimate: 5 source lines, 3 test lines (including the title), 8 documentation lines; under 25 changed lines excluding this plan. Nothing else.

First add counted and weighed quantity assertions to the existing PDF-output test and observe the counted assertion fail. Change the tool’s default Each abbreviation and language key, retain kg, then rerun that case. Narrow only the earlier administrator test title to “stores an English administrator name, email and role”; preserve its body byte-for-byte. Update A1251’s backlog wording from remaining historical reviews to remaining repairs; do not delete its still-open repairs.

Finish: focused output and two venue cases, source/title byte checks, look at one counted and one weighed generated receipt, one Claude whole-branch run-it review, normal hook and current-head CI. No extra test file, new harness, catalogue cleanup, unrelated title change, historical-plan edit or whole-package run. No payment/provider call or fiscal writer change.

This small plan may stay in receipts after approval if the watcher repeats its 12:16 direction to omit a one-use wording plan. No implementation before the required Claude plan read and watcher answer.
