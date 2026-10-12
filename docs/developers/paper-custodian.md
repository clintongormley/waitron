# Sign paper allocations outside the venue

A restored venue cannot tell you which paper entries another machine already consumed. Keep one
current master register outside venue backups, with a named custodian. Reserve each block there
before signing it, and cross out an entry there before signing its consumption receipt. The
signature records the custodian's evidence; it does not establish that the register is current.

The command below prepares signed evidence. Allocation activation and recovery-pack integration
remain open in W41s Task 4 and Task 6. It does not update your master register.

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
      "taxpayerNif": "B12345678",
      "softwareId": "WT",
      "environment": "preproduction",
      "installationIdentity": "P000042",
      "series": [{ "code": "A-P000042", "purpose": "standard" }],
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

When you recover with the current node recovery key, the consumption event names that
authentication rather than an account (owner decision, 2026-10-12 22:55). Replace the example's
`operatorId` with `{"kind":"recovery-key","nodeId":"replacement-node","eventId":"recovery-event"}`.
Use the same target node and event in the enclosing consumption and local approval. The signing
command refuses a mismatched node or event and any extra field in this object. Enter no recovery
key or password into the consumption JSON. This authority grants recovery only; it creates no
management session and changes no password. Administrator-led operations keep their person ID.
