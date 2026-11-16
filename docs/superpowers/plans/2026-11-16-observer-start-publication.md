# Observer start publication

Smallest usable outcome: the fixture's count signals that its worker PID is available, preventing the missing-PID failure while keeping the exact worker-start counts.
Watcher directive, `~/waitron-campaign-i/questions.md`, 2026-11-16 16:17:

> "Publish start.2 before count2 in the fixture; no new wait, helper, timeout or assertion change. Show it failing with the order as is (your disposable reproduction) and passing after, open it as its own PR from main, land it yourself when green, then carry on."

Change only the fixture stub at `scripts/waitron-box-sh.test.mjs:90–94`: read and increment count, publish `start.$count` with the PID, then publish count.
Reuse the existing files and all `observer.count` consumers in that test file; preserve count values and every assertion.
Add no helper, wait, timeout, source-spelling test, gate, product change, runtime object, cache, record or migration.
Expected size: production 0; test fixture +3/-2; this plan about 20 lines; total about 25 lines.

Receipt: main run 43892006088 at ff362ded24 failed root job 133386464614 with missing `observer/start.2` at test line 775; 22,151 other cases passed.
Supplied blame dates lines 91/92 to 983a3908ee; the driver's health repair changed neither this file nor `deploy/box/waitron-box.sh`.
Of the last 12 failed CI runs checked, other root failures were English-only; yesterday's #3365 concerned a different extra-third-start barrier. These observations do not establish GitHub's internal cause.
The owned disposable probe ran the unchanged focused case (1/1 passed), inserted a 500 ms delay between count 2 and PID publication (1/1 reproduced the exact ENOENT), then reordered PID before count under the same delayed control (1/1 passed).
Logs and `observer-probe.diff`: `~/waitron-campaign-i/receipts/firing-20261116-1520/`; the temporary probe is already removed. Preserve this red/green scheduling control as disposable evidence; ship no delay.
After the fixture edit, run `pnpm exec vitest run scripts/waitron-box-sh.test.mjs -t 'starts after the grace and retains a burst while the worker is running'`, then `pnpm exec vitest run scripts/waitron-box-sh.test.mjs`; inspect the actual Tests count, including all 65 cases in the full file. Run no whole-workspace suite locally.

Before build, the driver checks this draft against the repository and obtains Claude's plan read; the watcher clears it, with confirmation needed only if review changes the directive's method. No owner design approval is claimed.
Finish one PR from main through the required `finish-branch` run-it reviews and any fix read, signed-off commits, the normal hook and selected current-head CI; land under the watcher's explicit authorization when green, then continue the lane.
No existing backlog entry describes this newly captured queue-only test defect: keep broad CI qualification/A935 open and add no backlog line.
