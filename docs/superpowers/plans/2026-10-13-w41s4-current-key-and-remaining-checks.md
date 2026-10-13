# W41s-4: current recovery key and remaining test changes

**Owner answers, 2026-10-13 10:40–10:55:** Decision 1 is B: cold restore accepts the selected
backup's node key, with a warning to retain older paper keys until no older backup remains.
Decision 2 is A: exactly the nine rows below, retaining every stated assertion. Name each newly
issued key beside its verifier and on its paper handover; Task 4 supplies the stored name and
handover-screen/restore output, and Task 6 supplies physical paper and backup-chooser display.
No outside current-key record is authorised. The proposals and experiment below record the
checkpoint at which the questions were asked.


When you recover an older backup, its saved record for checking the node key can be older too. The owner's
2026-10-12 22:55 decision requires the **current** node recovery key, with no account or
password. The present internal helper checks the verifier in the database you recovered.
Production wiring needs a decision about where the current verifier comes from.

This document proposes that decision and collects the remaining test changes found by a
read-only consumer audit at `f20d32467e00239dc6841c2c29f166b5c0f3aa4e`. It grants no new
permission. The existing signer, identity, standby and assertion approvals remain valid.

## The archive experiment

In an installed disposable checkout at that commit, two new cases ran the real database
archiver, key replacement and `withRecoveryKeyOperation`. Each case saved a database before
replacing its node key, reopened that archive and attempted recovery authentication.
The live database supplied the control in the other direction:

| Database | Old key | Replacement key |
| --- | --- | --- |
| Live database after replacement | Refused | Accepted |
| Archive saved before replacement | Accepted | Refused |

Command: `pnpm --filter @waitron/server exec vitest run src/recovery-current-key.probe.test.ts`.
Both intended recovery checks failed: the old-key promise resolved with `authorised`; the
replacement-key promise rejected with `promotion.break_glass_invalid`. Neither failure was
a fixture or import error. The cases contain no fixed real secret and print no key.

The reproducer and complete output are retained in Lane E's local receipts as
`w41s4-current-key.probe.test.ts` and `w41s4-current-key-red.log`. The experiment checks
authentication on a real archived database, not the complete boot or fiscal restore journey.
The existing local authentication cases passed: three files, 48 cases. The unchanged golden
hash and immutability suites plus venue-field checks passed: three files, 34 cases.

The helper's reads and recheck are at `apps/server/src/operation-authentication.ts:43–46`;
`packages/db/src/deployment.ts:203–207` reads `node_roles.break_glass_verifier`.
The signed consumption names the node and authentication event, but carries no current-key
verifier or version (`packages/fiscal-verifactu/src/paper-evidence.ts:36–47` and
`allocation-operator.ts:18–25`). The custodian fingerprint authenticates the paper signer.
These inspected paths do not establish which node key is current after an old-backup restore.

## Decision 1: what authorises recovery from an old backup?

**Recommended A: keep a current-key record outside venue backups.** Extend the approved
custodian procedure with a signed record containing the node, deployment scope and current
key verifier. Replacing the key replaces that outside record. On fresh offline hardware,
enrol the custodian through the approved independent fingerprint comparison and confirm the
key record against the current outside master before checking the secret. The secret alone
remains the credential; no account, password or management session is added.

This adds a duty when you create or replace a node key. A missing current-key record refuses
recovery authentication until you recover that record or follow a separately approved key
replacement procedure. Missing allocation history may still permit an emergency allocation;
it does not establish the current recovery key. The signature alone does not prove a record
is current, so the outside confirmation remains necessary. No such key record or replacement
procedure has been implemented by this checkpoint.

**Alternative B: accept the node key saved in the selected backup.** Document that restoring
an older backup may accept a replaced key and reject its replacement. This changes the
current-key decision for cold restore; ordinary live takeover can still use the live verifier.

Do not connect cold restore to the current helper until this choice is settled. The backup
encryption key remains separate from the node recovery key under either choice.

## Decision 2: approve these remaining exact test changes

The owner approved specific assertions at 14:40 and 17:30 on 2026-10-12. The following
checks fall outside those lists. Recommended **A**: approve these ports while retaining the
behaviour in the last column. Alternative **B**: retain the checks and revise the coupled
integration before changing them. The source lines refer to `f20d32467`.

| Existing check | Proposed replacement and retained behaviour |
| --- | --- |
| `apps/server/scripts/register-till.test.ts:49,56–59,66–70,79`, installation history `1`, `2`, `3` | Use independently supplied `S000001`, `P000042`, `P000043`. Keep exact history and live/retired flags, the unknown-node refusal, count of three identities and one-live-SIF assertion. |
| `apps/server/src/provision-till.test.ts:74`, report matches `installation 1` | Match the exact supplied setup identity. Keep the complete module list and taxpayer/software assertions. Its row-value port at line 82 is already approved. |
| `packages/fiscal-verifactu/src/venue-fields.test.ts:44–48`, accepts 38 characters and refuses 39 | Accept 21 and refuse 22, matching the approved emergency suffix budget. Keep a successful boundary control and the same field refusal. |
| `apps/setup/src/server-fields.test.ts:7–14`, English and Spanish messages name 38 characters | Name 21 in both messages. Keep locale-at-read behaviour and every other field assertion. |
| `packages/fiscal-verifactu/src/restore.test.ts:113`, live series remain unsuffixed `FA`, `RE`, `S7` | Compare the exact active allocated codes `FA-P000042`, `RE-P000042`, `S7-P000042`. Keep returned series metadata, every purpose, retained record and sequence, old-SIF retirement and rollback assertions. The allocation operation owns the series writes; the host must not repeat them. |
| `apps/server/src/reserved-identity.test.ts:89,96`, establishment has a live SIF and one series | Assert a retained dormant reservation and no active SIF or series at establishment; assert the supplied identity and complete series at takeover in the new integration cases. Keep node/key ownership, retry and rollback assertions. Line 89's earlier numeric-to-text approval did not cover this lifecycle change. |
| `apps/server/src/boot.promote.test.ts:432,442` and `promote-endpoint-e2e.test.ts:423`, promotion returns the series ID read before takeover | Compare the first result with the active series created by takeover and its exact allocated code; the already-primary retry returns that same committed ID. Keep role, membership, persisted identity, response, restart and permission checks. |
| `packages/provisioning/src/venue-apply.test.ts:533`, rejected reapplication retains exact codes `A`, `FF`, `R` | Compare the exact supplied initial codes `A-S000001`, `FF-S000001`, `R-S000001`; keep the refusal and the unchanged-row comparison. Initial setup must return the active references, rather than its former unsuffixed scaffold IDs. |
| Counter snapshot inputs in `standby-allocation.test.ts:119,129–131`, `dormant-allocation.test.ts:133,156–158`, `dormant-takeover.test.ts:170` | Check the retired table is absent; retain active-state before/after equalities, exact new reservation-row assertions and unchanged reservation rows on refused/replayed takeover. No rollback equality or recorded-row assertion is deleted. |

The unchanged `register-till` and `provision-till` baseline ran seven passing cases. The
venue-field boundary cases ran in the 34-case fiscal check above. Other rows are source
inventories, not execution receipts for their proposed replacements. Additional new cases
must fail before each implementation change. The proposed setup design avoids retained
scaffold series so its existing row-count checks are intended to remain unchanged; qualify
that design during integration. No row-count relaxation is requested.

Golden hash and immutability files remain unedited. No root guard logic, coverage bar,
shipped migration, alta builder, invoice-number allocation or hash-chain change is requested.
The final text schema still needs full regeneration on current main, populated-upgrade
qualification, the two required full reviews, the normal hook and current-head CI.
