# NIGHTLY-1113: restore the fiscal fixture and provisioning coverage

**Author:** Codex. **Status:** draft for Claude review and watcher clearance.
**Request:** Lane K queue, NIGHTLY-1113, watcher 2026-11-13 03:42. Repair CI
43350911465 on f46da9fc0e: four correction-amount huella cases fail to sign in; provisioning
statements/functions fall below 98%. The queue requires clearance before editing a protected
fiscal test. That fixture-only clearance is pending in lane K questions.md.

**Finish line:** the existing correction amount/hash assertions execute again, and the
provisioning package tests demonstrate the newly added import membership behavior at its own
layer. Land one test-only repair PR, then dispatch full ci.yml on main and read its result.

**Reuse:** seedPersons supplies the fixture job admitted by seedTenantWithSif's device;
useVenueDb, test/configuration-bundle.ts and the existing synthetic transfer-module pattern
exercise importConfigurationTables on a real database. No production or fiscal-policy changes,
new helper/framework, exclusion, threshold change, migration or weakened assertion.

1. **Fiscal setup** — packages/fiscal-verifactu/src/correction-amount.huella.test.ts.
   Existing test RED is observed: four pin.invalid/not_admitted failures. After explicit watcher
   clearance, replace only the raw supervisor creation with seedPersons, keeping its role, PIN
   and all fiscal inputs. Run the four cases, plus the unedited write-path.e2e.test.ts and
   inmutabilidad.test.ts. Compare the complete assertion bodies with base; they must be identical.
2. **Import membership coverage** — new
   packages/provisioning/src/configuration-transfer.job-roles.test.ts. Reproduce the named
   coverage failure with test:coverage and inspect the table. Test the uncovered import branches:
   importing administrators receive the exporting operator's jobs, or all visible imported jobs
   when the operator has none; an empty job export retains the target's starter job name (Team
   if none exists). Assert stored membership names and membership activity facts, and no mail.
   Reuse one real fixture and parameterize only the meaningful alternatives. The import layer
   owns these assertions; no duplicated route tests. Prove them against a disposable copy with
   the membership block deleted, restore it and run the focused file, then package coverage.
   If these new-code cases do not restore the bar, inspect the remaining real gap before adding
   another behavior; stay within the queued repair and ask before expansion.
3. **Finish** — sign off commits; inspect any relevant backlog CI entry and correct stale state
   (no new product behavior is delivered). Run finish-branch's two Claude reviews because the
   fixture touches sign-in/fiscal testing, the normal push hook, selected current-head CI,
   land-branch and the requested manual main verification. No automatic unchanged rerun.

**Size:** production 0 lines; tests about 140 changed lines; plan about 40 lines. Seek an outside
opinion before 210 changed test lines. The two fixes share no implementation interface.
