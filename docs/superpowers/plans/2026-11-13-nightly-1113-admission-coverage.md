# NIGHTLY-1113: restore the fiscal fixture and provisioning coverage

**Author:** Codex. **Status:** Claude reviewed; corrected for watcher clearance.
**Request:** Lane K queue, NIGHTLY-1113, watcher 2026-11-13 03:42. Repair CI
43350911465 on f46da9fc0e: four correction-amount huella cases fail to sign in; provisioning
statements/functions fall below 98%. The queue requires clearance before editing a protected
fiscal test. Watcher 03:50 cleared that setup-only edit in lane K questions.md.

**Finish line:** the existing correction amount/hash assertions execute again, and the
provisioning package tests demonstrate the newly added import membership behavior at its own
layer. Land one test-only repair PR, then dispatch full ci.yml on main and read its result.

**Reuse:** seedPersons supplies the fixture job admitted by seedTenantWithSif's device;
move the existing direct-import test from apps/server/src/configuration-transfer.test.ts:8237–8305
to provisioning, reusing useVenueDb and that test's applyVenue/buildConfigurationBundle setup. No production or fiscal-policy changes,
new helper/framework, exclusion, threshold change, migration or weakened assertion.

1. **Fiscal setup** — packages/fiscal-verifactu/src/correction-amount.huella.test.ts.
   Existing test RED is observed: four pin.invalid/not_admitted failures. After explicit watcher
   clearance, replace only the raw supervisor creation with seedPersons, passing id: newId() and createdAt: nowIso(), keeping its role, PIN
   and all fiscal inputs. Run the four cases, plus the unedited write-path.e2e.test.ts and
   inmutabilidad.test.ts. Compare the complete assertion bodies with base; they must be identical.
2. **Import membership coverage** — move the three cases at the end of
   apps/server/src/configuration-transfer.test.ts into new
   packages/provisioning/src/configuration-transfer.job-roles.test.ts, preserving every
   behavioral assertion. The local baseline reproduced CI exactly: 1,916 tests pass,
   statements 97.74%, functions 97.81%; configuration-transfer.ts:921–942 is uncovered.
   These cases already check the exporting operator's jobs, all visible jobs when none are held,
   and the target's translated starter job when the source is empty, with activity and no mail.
   Reuse bundle.modules in place of server-only schemaVersionsByModule. No fourth case or second
   copy of these tests. Prove them with the membership block deleted in a disposable copy,
   restore and run the focused file, then package coverage. Run the changed server test file.
   If this does not restore the bar, inspect the remaining gap and ask before expanding.
3. **Finish** — sign off commits; this moves test ownership and changes no product behavior,
   so there is no new backlog state to record. Run finish-branch's two Claude reviews because
   the fixture touches sign-in/fiscal testing, the normal hook, selected current-head CI,
   land-branch and the requested manual main verification. Respect the watcher 03:50 push/CI hold.

**Size:** production 0 lines; tests about 200 changed lines (roughly 80 removed and 120 added); plan about 40 lines.
Seek an outside opinion before 300 changed test lines. The two fixes share no implementation interface.

**Review:** Claude plan read, 150s, lane K receipts/nightly-1113/plan-review.md. Accepted its
move instead of duplicate tests, omitted the extra fallback case, and removed the open-ended
backlog work. The watcher clears this corrected approach; no owner plan approval is claimed.
