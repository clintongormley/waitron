# Sign paper allocations outside the venue

A restored venue cannot tell you which paper entries another machine already consumed. Keep one
current master register outside venue backups, with a named custodian. Reserve each block there
before signing it, and cross out an entry there before signing its consumption receipt. The
signature records the custodian's evidence; it does not establish that the register is current.

The command below prepares signed evidence. It does not update your master register.

**2026-10-14 status:** Task 4's allocation activation, default fiscal hooks and text identities
landed in #1700. Earlier paragraphs below describing those as unfinished refer to its development
checkpoints. Successful allocated standby adoption still needs the primary's venue copy and fresh
establishment authority. Task 6's candidate adds the pack handover and recovery-record entry below;
the complete Task 11 exercise remains separate. For the container mounts, selected-copy review,
restore inputs and generated-record handover, follow
[Recover a filing box](offline-fiscal-restore.md). Its optional host-managed emergency collector
is described in [Emergency recovery](emergency-recovery.md).

## Create the custodian's key

Build the standalone command from the repository:

```sh
pnpm --filter @waitron/fiscal-verifactu build
```

On the custodian's machine, choose an existing directory outside every venue backup. Generate a
new key there and save its public information separately:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js keygen \
  --custodian register-custodian \
  --key /secure/master/custodian-2026.pem \
  > /secure/master/custodian-2026.public.json
```

The private file is created with mode `0600`, so its owner can read and write it. An existing file
is refused. Standard output contains `custodianId`, `publicKey` and `fingerprint`. Keep the private
key with the custodian; never put it in a venue database, allocation, consumption receipt or pack.

If you lose the public file, derive it again without replacing the private key:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js public \
  --custodian register-custodian \
  --key /secure/master/custodian-2026.pem \
  > /secure/master/custodian-2026.public.json
```

## Enrol the public key independently

Record the custodian's name and fingerprint in the current outside master register. The fingerprint
is SHA-256 of the public key's DER SPKI representation, a binary encoding of the key. The recovery
pack may carry the public key and fingerprint, but you compare that fingerprint with the current
outside register before trusting the pack on replacement hardware.

The verifier takes this independently enrolled key separately from the submitted evidence. A key
inside a reservation cannot enrol itself. You also confirm that you consulted the current register
and marked this entry consumed. A valid signature cannot replace either confirmation.

### Configured host source on the Task 4 branch

The internal `createPaperAllocationSource` accepts a host-selected custodian public-file path,
a current-confirmation file path and the fingerprint you compared with the outside register.
The custodian file uses the command's public output above. The source reads both files on each
attempt and refuses missing or malformed files and files larger than 64 KiB. An altered key requires a new
independent fingerprint comparison. You configure both file paths explicitly; the production
module collector reads the settings described below.

Prepare the confirmation from your consultation of the current outside master for this exact
operation. Its format is:

```json
{
  "version": 1,
  "allocationId": "paper-42",
  "binding": {
    "module": "fiscal-verifactu",
    "action": "restore",
    "eventId": "restore-1",
    "sourceId": "archive-2026-10-13",
    "targetNodeId": "replacement-node"
  },
  "operatorId": {
    "kind": "recovery-key",
    "nodeId": "replacement-node",
    "eventId": "restore-1"
  },
  "priorActivation": "none",
  "incidentEvidence": "master-register/restore-1",
  "requiredBases": [
    { "code": "A", "purpose": "standard" },
    { "code": "FF", "purpose": "full" },
    { "code": "R", "purpose": "rectificative" }
  ],
  "recipientVenueId": "venue-madrid",
  "generationId": "generation-1",
  "blockId": "block-1",
  "currentRegisterConfirmed": true,
  "consumptionConfirmed": true,
  "currentEntryState": "consumed-for-event"
}
```

The labels in this example are synthetic. Use the authenticated operation's event, source and
node, the consumed allocation's exact ID and the current register's scope. An administrator-led
operation uses the authenticated person's ID instead of the recovery-key object. Mark an uncertain
previous attempt as `uncertain`; a confirmed committed retry uses `committed` and must retain
the original signed allocation and approval.

This file records your statement; copying or rereading it does not establish that the outside
master is current. Consult that master again before another attempt. Keep both this consultation
and the compared fingerprint separate from the submitted allocation and a restored recovery pack.
The production collector now selects this source from the host settings. The default fiscal
hooks, text identity transition and complete setup/restore/takeover journey remain unfinished.

## Sign a reserved block

Your `block.json` contains the frozen scope and complete identity set. For example:

```json
{
  "version": 1,
  "custodianId": "register-custodian",
  "generationId": "generation-1",
  "blockId": "block-1",
  "packVersion": 1,
  "recipientVenueId": "venue-madrid",
  "allocations": [
    {
      "version": 1,
      "allocationId": "paper-42",
      "taxpayerNif": "89890001K",
      "softwareId": "W1",
      "environment": "preproduction",
      "installationIdentity": "P000042",
      "series": [
        { "code": "A-P000042", "purpose": "standard" },
        { "code": "FF-P000042", "purpose": "full" },
        { "code": "R-P000042", "purpose": "rectificative" }
      ],
      "source": "paper",
      "issuedAt": "2026-10-12T08:00:00.000Z"
    }
  ]
}
```

This example is signing-tool input, not an AEAT filing or a live taxpayer. Include every required
series and purpose. Reserve the names in the master register across all of that taxpayer's venues
and nodes, for this software and environment. Then sign:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js sign-block \
  --key /secure/master/custodian-2026.pem \
  --input block.json --output signed-block.json --reserved-outside
```

The flag records your confirmation that reservation happened outside the venue. The command does
not check or write the master register. Its output contains the validated payload and signature.
It refuses an existing output file. Reprinting it does not create fresh names or clear consumption
marks; the pack still identifies its generation and block and states that its snapshot may be stale.

## Download and print a node recovery pack

To give the venue a signed register file it can upload, use the same reserved block and signing
key on the custodian's machine:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js sign-register \
  --key /secure/master/custodian-2026.pem \
  --input block.json --output recovery-register.json --reserved-outside
```

The output combines the signed block with the custodian's public key and fingerprint. Keep the
private signing key with the custodian. This command signs the reserved block again; it does not
allocate another block or clear any entry's consumption history.

In the dashboard, open **Backups**, enter the current **Node recovery key**, choose
`recovery-register.json`, and select **Create pack**. You need management permission and the node
key you already hold. You do not need bucket settings or a subscription. A wrong node key or a
register for a different taxpayer, environment, venue or series set is refused.

Download the JSON pack and the **Printable copy**. Open the downloaded HTML file in your browser
and print it using the browser's Print action. It has no external assets. It includes the node
key's stored name and secret, the signed register and the custodian's public fingerprint. Keep
both downloads and the paper outside the server and its backups. Choose **Clear pack** to remove
the screen's download links; this does not delete files you already downloaded.

The printed register is a snapshot. Compare its custodian fingerprint with the current outside
master before trusting it for recovery, and consult that master before consuming an entry.
Reprinting a pack cannot establish that a name remains free. Keep paper keys needed by older
backups even after you replace the live node key. The archive encryption key opens a backup file;
the node recovery key authenticates the node operation. They remain separate credentials.

## Reserve an entry for a named standby

A spare box needs its own reserved names while the primary is still selling. Record the named
spare, primary, operator and join event in the current outside register. Keep the entry reserved;
joining does not consume it or activate its fiscal identity. Prepare `join.json`:

```json
{
  "eventId": "join-1",
  "operatorId": "administrator",
  "sourceId": "primary-node",
  "targetNodeId": "standby-node",
  "incidentEvidence": "master-register/join-1",
  "reservedAt": "2026-10-12T09:00:00.000Z"
}
```

Use the actual node IDs and a fresh unpredictable event ID. After recording the assignment, sign
the reservation with the same outside custodian key that signed the block:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js sign-reservation \
  --key /secure/master/custodian-2026.pem \
  --block signed-block.json --allocation paper-42 \
  --input join.json --output reservation.json \
  --current-register-confirmed --reserved-outside
```

The command writes a signed reservation bound to the block, allocation and named spare. It
refuses the primary as its own spare, a setup-only allocation and an existing output file. The
verifier requires an independently enrolled key and current outside confirmation that this entry
is still reserved for that assignment. Abandoned or consumed entries do not qualify.

The reservation has a separate signature format from a consumption receipt. When the spare takes
over, you still authenticate the administrator, isolate the old box, rule out parallel recovery
and mark this allocation consumed for the new takeover event before local activation. An
abandoned reservation stays retired in the outside register. The signing and validation tools
are implemented on the Task 4 branch; bundle, adoption and promotion integration remain open.

## Sign a consumed entry

Create an unpredictable recovery event ID before claiming an allocation. Record the event, backup
or setup source, target node, operator and incident reference in the current outside register.
Cross out the entry there before local activation. Prepare `event.json`:

```json
{
  "eventId": "restore-1",
  "operatorId": "administrator",
  "sourceId": "backup-1",
  "targetNodeId": "new-node",
  "incidentEvidence": "master-register/restore-1",
  "consumedAt": "2026-10-12T09:00:00.000Z"
}
```

The example event ID is a label for the example; generate a fresh unpredictable ID for an actual
recovery. With the entry marked, sign its evidence:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js sign-consumption \
  --key /secure/master/custodian-2026.pem \
  --block signed-block.json --allocation paper-42 \
  --input event.json --output consumption.json \
  --current-register-confirmed --consumed-outside
```

The command verifies the block with the custodian's key and requires that the allocation belongs
to it. It signs the block's digest, allocation ID and complete event. A changed block, another
signer or an entry outside the block is refused. Retain the receipt with the outside incident
record. A failed local activation never frees the crossed-out entry.

## Replace a signing key without resetting the register

Generate the replacement under a new private filename. Keep the same current master register,
including all reserved, consumed, abandoned and retired entries. Record the replacement custodian
key and fingerprint there. Retire outstanding blocks signed by the old key in that register; do
not treat their names as free. Issue a fresh block of unused names under the replacement key.

Administrators compare the new fingerprint against the current outside register before enrolling
it on replacement hardware. An old pack cannot authorise its old key after that replacement.
Keep original signed incident evidence for the audit. If you cannot establish the current outside
register, stop short-name allocation and follow the separately approved emergency procedure.

The command supplies key generation and signing; you perform these register and enrolment steps.
Recovery-pack enrolment and persistent activation must implement this procedure before the paper
path is connected to trading.

## Recovery authorised by a node key

When you recover with a node recovery key, the consumption event names that
authentication rather than an account. Live takeover checks the live database; cold restore
checks the selected backup (owner decisions, 2026-10-12 22:55 and 2026-10-13 10:40). Replace the example's
`operatorId` with `{"kind":"recovery-key","nodeId":"replacement-node","eventId":"recovery-event"}`.
Use the same target node and event in the enclosing consumption and local approval. The signing
command refuses a mismatched node or event and any extra field in this object. Enter no recovery
key or password into the consumption JSON. This authority grants recovery only; it creates no
management session and changes no password. Administrator-led operations keep their person ID.


## Keep the paper key for older backups

Restoring an older backup brings back the recovery key that was current when you made that
backup. A key you replaced on the live box can work again on the restored box, and its
replacement can be refused. Keep the older paper key until you have deleted every backup
made before you replaced it.

Write the displayed key name beside the secret on your paper. The box stores the name and a
verifier, a value used to check the secret. It cannot print an old secret from a backup. The
restore output names the selected backup's key when that backup contains a name. Fetch the
paper with that name. The backup encryption key is a separate secret; it opens the backup
file and does not authenticate the node's recovery operation.


## Configure the Task 4 host collector

The Task 4 branch now selects the paper collector in the production module list. Configure its
public custodian file, current-event confirmation file and separately compared fingerprint:

```sh
export WAITRON_FISCAL_CUSTODIAN_FILE=/secure/public/custodian.json
export WAITRON_FISCAL_CONFIRMATION_FILE=/secure/current/setup-event.json
export WAITRON_FISCAL_CUSTODIAN_FINGERPRINT='<fingerprint compared with the current outside master>'
```

The collector rereads both files for each attempt. Missing or empty settings refuse collection.
Keep the custodian's private signing key outside the venue; these settings name public evidence.
The event file's statements remain your confirmation of the outside master, not independent proof
that an old snapshot is current. Use the formats in the configured-source section above.

For initial setup, add `initialOperations` to your setup request. It contains `nodeId`,
`administratorId` and an `inputs` array. Each entry has `module`, `eventId`, `sourceId` and `input`.
The fiscal input is the signed allocation and its approval. Create the planned IDs before signing;
the signed consumption, approval and separate event confirmation must name those same identities.
Do not put a signing key, recovery secret, host path or trust object in this input.

The provisioning CLI reads that same object from the file named by `WAITRON_INITIAL_VENUE_INPUT`.
It limits the whole file to 128 KiB and validates it before writing the permanent environment stamp.
An unreadable, malformed or oversized file, or an input for an unselected seed, returns
`provisioning.initial_input_invalid` without echoing its contents.

The default fiscal seed/restore/standby hooks and text identity schema remain unfinished on this
branch. The new host tests supply the allocated seed explicitly; this checkpoint is not a complete
setup or recovery procedure. Finish the coupled transition before using it for a venue.

## Export a paper recovery operation

After the custodian marks the current outside entry consumed and signs its receipt, prepare the
public record you will give the replacement box. Keep the selected backup's digest, node, event
and recovery-key operator in the consumption receipt, local approval and separate current-event
confirmation. The chooser displays the digest; a bucket generation label is not that digest.

Your `approval.json` uses this shape, with synthetic values replaced by your selected copy:

```json
{
  "version": 1,
  "eventId": "replace-with-a-fresh-unpredictable-event-id",
  "operatorId": {
    "kind": "recovery-key",
    "nodeId": "c0000000-0000-4000-8000-000000000001",
    "eventId": "replace-with-a-fresh-unpredictable-event-id"
  },
  "sourceId": "replace-with-the-selected-copy-digest",
  "targetNodeId": "c0000000-0000-4000-8000-000000000001",
  "oldMachineOffline": true,
  "oldMachineAbsent": false,
  "noParallelRecovery": true,
  "confirmedAt": "2026-10-14T09:00:00.000Z",
  "incidentEvidence": "outside/this-recovery-event"
}
```

Confirm the former machine is off and no parallel recovery is underway before setting those
flags. On the custodian's machine, or replacement hardware holding the public files, run:

```sh
node packages/fiscal-verifactu/dist/paper-custodian.js prepare-recovery \
  --block signed-block.json --consumption consumption.json \
  --input approval.json --output recovery-operation.json \
  --custodian /outside/current/custodian.public.json \
  --fingerprint '<fingerprint compared with the current outside master>' \
  --confirmation /outside/current/restore-event.json \
  --taxpayer 89890001K --environment preproduction --action restore
```

Use the current-confirmation format above, including every configured series base and purpose.
Select the taxpayer and environment from the backup you reviewed. The command verifies the
signed block and receipt, current entry state, independent fingerprint, complete series and
approval binding. It writes a new owner-only operation file and leaves the outside register
unchanged. It reads each supplied block, receipt and approval file up to 64 KiB and refuses a
missing, malformed or oversized file. It needs no private signing key or node recovery secret.

Transfer the public operation from a phone or another computer and paste its complete JSON into
the candidate restore screen's recovery-record field. A changed signed value is refused; typing
the installation name alone supplies no consumption evidence. Enter the selected backup's node
key in its separate field. Keep the receipt and operation with your outside incident record.
This is a paper-custodian handoff; the Cloud registry adapter remains a later W41s item.

Use `--action re-register` for a node re-registration, with a matching current-event confirmation.
After a confirmed committed attempt, retain the original operation for the host's replay checks;
the export command refuses to assemble a new operation from a committed or uncertain attempt.
Exporting an approval does not authenticate its operator. The host still checks the selected
database's node key and rereads separately configured current outside evidence before activation.

## Supply a recovery operation to the host

The Task 4 branch accepts a public operation file for re-registration and cold restore. Keep its
signed allocation and approval separate from the node recovery key. The file binds the module,
action, event, source and target node; the host authenticates the key against the database it uses
for that operation before collecting the current outside evidence.

Use the export command above for a paper allocation. For a module input you already hold, the
generic envelope is:

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const allocation = JSON.parse(readFileSync("allocation.json", "utf8"));
const approval = JSON.parse(readFileSync("approval.json", "utf8"));
writeFileSync("recovery-operation.json", JSON.stringify({
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: approval.targetNodeId
  },
  input: { allocation, approval }
}), { mode: 0o600 });
JS
export WAITRON_RECOVERY_OPERATION_FILE="$PWD/recovery-operation.json"
```

Use `re-register` for `register-till`, and `restore` for either `waitron-restore` source.
Supply the node key through `WAITRON_NODE_RECOVERY_KEY`, never a command argument or either JSON
file. The command reads at most 128 KiB of operation input. An unreadable, malformed or oversized
file returns `server.config_invalid` with the variable name and `invalid_operation`; its contents
are not included in that refusal.

For a staged restore, the entry process reads the same environment settings after restart. A
request may instead carry `recoveryOperation` in its marker. That marker takes precedence over the
environment's operation file, but it supplies no authentication authority: the entry process must
still receive the node key and reread the current outside evidence. The key is not copied into
the marker. Inputs that would change when saved as JSON are refused before replacing a staged
request.

**2026-10-14 reading note:** the following qualification paragraph records the earlier Task 4
checkpoint. The status at the top and the staged-input section below describe the later host.

The host qualification uses the allocated hooks explicitly and source-tree migrations. Default
fiscal hooks, packaged boot, text schema/counter retirement and the complete setup screen remain
unfinished. This is branch development guidance, not a qualified venue recovery procedure.


## Staged node keys on the Task 6 candidate

The restart backend can stage a node recovery key separately from the archive encryption key.
The candidate public restore forms collect this credential. A host request supplies
`nodeRecoverySecret` alongside its public `recoveryOperation`; the secret goes into
`restore-request.node-key` with mode `0600`, not into the JSON marker. On the first attempt, the selected
backup's verifier checks it again. An interrupted attempt uses the placed database's verifier.
Both reread current outside evidence. A missing or
invalid staged credential refuses recovery rather than falling back to an environment key.

For requests carrying a staged node key, bind `recoveryOperation.binding.sourceId` to the selected
copy. For an archive, use the preview's `sourceId`, the SHA-256 digest of its encrypted bytes. For a
bucket, use `activationSourceId`, which covers the prepared closed database and unlocked entries
before preview migrations. The displayed bucket `sourceId` is only a generation reference. Opening
a downloaded SQLite database changes its journal-mode header, so `activationSourceId` identifies
the prepared file rather than the untouched bucket object. A later download with different bytes
needs a fresh review and matching outside recovery evidence.

The backend checks this binding before replacing a staged request and again at restart. A fresh
attempt removes the staged key after success or a refusal before placement is marked started;
a venue-lock refusal keeps it for another fresh attempt. Once placement is marked started, any
failure keeps the request and key for a checked resume, including a thrown file-write error after
activation commits. A successful resume removes them. Restaging replaces the credential. Each attempt
still authenticates the key and collects current outside evidence. See
[interrupted staged restores](emergency-recovery.md#resume-an-interrupted-staged-restore). An interrupted write with no marker leaves no runnable request, and the
next entry pass removes the orphaned node-key file. These rules do not establish that a copied
marker proves an allocation can be reused. Environment-only command inputs retain their existing
contract.

To submit these inputs through the candidate setup API, send `recoveryOperation` and
`nodeRecoverySecret` together. Bucket and Cloud restores accept them in the JSON body. For an
archive, send a multipart form with `artifact` as a file, `recoveryKey`, `environment`,
`recoveryOperation` as JSON text, and `nodeRecoverySecret`. Set `oldBoxGone` to `1` only after
confirming the old box is off; `0` leaves that confirmation unset. The archive encryption key is
still `recoveryKey`. The browser API client and candidate restore screens forward the recovery pair.

The setup request's saved hash includes the operation and node key, so a completed request cannot
be replayed with different inputs. Its saved progress contains neither key. Forwarding the operation
does not supply outside authority: after restart, recovery still checks the selected database's node
key and collects current outside evidence. These API checks do not complete the offline procedure.
