# A1155 changed test checks

Demo and test boxes need a venue reset (`wa-wt reset demo <worktree-name>`).
The owner’s 27 October node-name decision and 29 October joining-page decision replace the
box identity environment contract with one node setting. Location remains part of the
runtime configuration and is read from the selected database.

The original node-setting rename updates fixtures and assertions to the new spelling,
without changing their identity values. The following checks change for the subsequent
location-setting removal. Locations cited below are test names, so formatting does not
make the inventory stale.

| File and check | Previous expectation | Current expectation and authority |
| --- | --- | --- |
| `apps/server/src/till-config.test.ts`, identity shapes and missing/invalid inputs | Two required environment ids; partial pairs refused | One required node id; absent or empty means setup; malformed nodes still refuse with only the variable name. Location-key missing/invalid and partial-pair permutations are retired by the 29 October decision. |
| `apps/server/src/config.test.ts`, full config shape | Environment supplies node and location | Environment supplies node only; the exact object assertion stays. |
| `apps/server/src/first-fiscal-mode.test.ts`, completed setup | Completed publication matches both environment ids | Completed publication matches the node setting and the location in a real migrated database; a changed node or database location still refuses. |
| `apps/server/src/trading-config.test.ts`, file contents | Exact file includes a location line | Exact file omits that line; an additional absence assertion checks the removed setting. |
| `apps/server/scripts/dev-setup.test.ts`, rendering, parsing and config | Exact environment contains a location; config reads it | Exact environment and config omit it. Runtime fixture ids are unchanged. |
| `apps/server/scripts/dev-setup.test.ts`, reuse and inspection | Reuse and inspection compare the environment’s location | Reuse compares the full saved environment; inspection finds its node joined to a location. The inspection fixture gains its node row; a missing node table must refuse. |
| `apps/server/src/restore.test.ts`, sealed identity | Pure archive reader returns node and location | Pure reader returns node only; the read-only database reader returns the same original node and location, and refuses an absent node. |
| `apps/server/src/backup-verification-secrets.test.ts`, source binding | Each environment id must match the source | The sole node setting must match. `backup-verification-compatibility.test.ts` retains all node, missing-location and wrong-location database refusal checks with node-only archive text. |
| `apps/server/src/boot.test.ts`, second-venue refusal | A conflicting location setting refuses | A real second database location refuses with the same domain code. No location can now be selected by environment. |
| `apps/server/src/boot.test.ts`, provisioning output | Node and location lines are present | The node line is present; runtime layout and equipment fixtures keep their original location explicitly. |
| `apps/server/src/boot.setup-routes.test.ts`, device enrolment fixture | Runtime config derives location from env | Runtime fixture reads its node’s database location; device and route assertions remain. |
| `apps/server/src/reset-request.test.ts`, adoption output | Location is in the trading file | The file omits it and the pending adoption retains that exact location; node and admission assertions remain. |
| `apps/server/src/restore-fiscal-e2e.test.ts`, restored identity | Location is in the trading file | The file omits it and the restored database node retains that exact location. Series, counter and record assertions remain. |
| `apps/server/src/rejoin-command.test.ts`, invalid config | Partial pair reports generic config error | Malformed node reports the node validation error. Absent node retains the unprovisioned refusal, with singular wording. |
| `apps/server/src/hour-recovery-staged.test.ts`, injected request failure | Throw from pure identity reader | Throw from database identity reader; the same HTTP failure, retained-copy and retry assertions remain. |
| `scripts/no-till-as-issuer.test.ts`, scanner inputs | Node and location settings accepted | Only the node setting is accepted. The owner explicitly requests refusing the removed location spelling as well as the two previously retired spellings. |

Other environment fixtures omit the removed line. Shared boot fixtures move their unchanged
location literal into a separate constant for database seeding. Receipt-language and guest
route fixtures keep their original database location when constructing runtime configuration.
The protected hash and immutability test files are unchanged.
