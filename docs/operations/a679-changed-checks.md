# A679 changed test checks

Use this inventory to review changes to checks that existed before the replacement setup flow.
It records changes on the candidate branch, not acceptance of the finished product.

| Check | Before | After | Authority |
| --- | --- | --- | --- |
| `apps/server/src/first-fiscal-boot.test.ts:262` | Wait for `server.listening` in the interrupted child. | Wait for `recovery.listening`. | Owner approval, 2026-10-16 09:44, for these exact two lines. The replacement plan's Task 8 serves resolution before ordinary boot. |
| `apps/server/src/first-fiscal-boot.test.ts:280` | Child status equals `{ claimed: true }`. | Child status equals `{ claimed: true, resolution: true }`. | The same exact approval. Later ordinary raw-start status and resume checks stay unchanged. |

The launch fixtures in `apps/server/src/first-fiscal-launch.test.ts` now claim ownership, choose
candidates, import public evidence and confirm the current register before provisioning. Their
existing success, allocation-node and preproduction assertions stay unchanged. The two owner cases
use development mode to freeze preproduction, while the CLI case retains its explicit preproduction
environment. New checks compare the configured outside files' retained digests on both listeners.
Changing the passed paths to conflicting ambient paths failed both digest checks.

These launch fixtures isolate the fiscal contribution's external readiness requirement. With that
isolation removed, the direct development Live case returns `setup.request_invalid` for `aeatCert`:
preproduction forbids the certificate, but readiness's submission-target parser tries to read it.
The receipt is `a679-v2-audit/legacy-agent/real-dev-live-readiness-refusal.log` in the lane's local
receipts. Task 9 still needs to qualify that real path. Owner-bound activation uses its authenticated
public-evidence grant; the unchanged CLI case exercises the legacy environment fingerprint.

Earlier changes to non-fiscal workspace checks are recorded in the lane's 2026-10-16 07:24 FYI:
`packages/provisioning/src/first-setup-workspace.test.ts` now refuses changed current outside evidence
at selection installation. A separate case retains the original refusal after selection for changed
local directory evidence. The replacement plan's Task 8 distinguishes current outside sources from
the immutable retirement archive. No fiscal hash or filing assertion changes are covered by this inventory.

The Finish fixtures now supply a consumed-current-register answer, including its consulted person
and public history reference, separately from publication inputs. You can inspect these additions
in `first-fiscal-declared-publication.test.ts` and `first-setup-finish.route.test.ts`. Their existing
assertions stay unchanged. New cases check the audit records, original bytes, interrupted writes
and refusal before a database opens. The request addition follows the replacement plan's Task 8
and its retained `RegisterAnswer` shape; it does not replace fresh outside confirmation.

The empty-selection HTTPS fixture in `apps/server/src/first-setup-empty-selection.route.test.ts`
now migrates the complete application schema instead of core alone. The real resolution listener
composes every available module; the new empty proof checks their required schema. Its earlier
assertions stay unchanged. The schema-scanner tests deliberately retain isolated orphan rows
without parents, so a parent table cannot conceal a missing scan of the sale or filing table.
The owner authorised this read-only empty-proof inspection on 2026-10-16 at 13:40.
