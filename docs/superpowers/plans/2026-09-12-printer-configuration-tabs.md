# Printer configuration implementation

1. Reproduce the missing tab/default behavior, manual pairing opening, redundant Refresh action,
   and oldest-waiting-job omission with browser and API tests.
2. Reuse `wt-tabs` and URL state for printer navigation. Update the English and Spanish copy,
   widen only the hardware Add modals through the shared modal sizing option, and show status dots.
3. Tie pairing admission and passive join polling to the Add agent dialog. Serialize window changes
   and discard stale reads. Keep printer discovery's existing scan window and disabled-record reuse.
4. Return all unfinished jobs alongside the bounded completed history. Keep tenant filtering and
   payload omission. Align Disable wording and document the primary-only automatic enrolment limit.
5. Run focused regressions, changed-package coverage, and the repository gate. Report results and
   readiness for `finish-branch`; do not merge.
