# Pass a Cloud allocation through local recovery

A consumed Cloud receipt records a reserved installation name and its complete invoice-series
set. To use it on a replacement box, you still authenticate with the node recovery key from the
selected backup and confirm that the former machine is isolated. A Cloud account never supplies
that local authority.

This adapter is for the explicitly configured recovery path. It does not select production
custody, a continuity service, signing-key enrolment policy or subscription policy. Qualify those
separately before enabling Cloud allocations for a real venue. Paper recovery remains available
without Cloud.

## Supply the public operation

Use the existing archive or bucket restore operation, with its selected-copy digest, target node
and fresh event. Its opaque fiscal `input` contains exactly these fields:

```ts
{
  allocation: consumedReceipt.payload.allocation,
  approval: consumedReceipt.payload.approval,
  receipt: manualPacket
}
```

`manualPacket` is the complete `WAITRON-FISCAL-ALLOCATION-1:` packet, including its signature.
The packet's event, source, target, operator and all series purposes must match the local
operation. Preserve a recovery-key operator as `{kind: "recovery-key", nodeId, eventId}`.
Do not replace it with a person or Cloud account ID. The local verifier compares the submitted
allocation and approval with the signed snapshot before passing them through module preparation.

Configure the host separately from the submitted operation:

```sh
export WAITRON_FISCAL_CLOUD_TRUST_FILE=/outside/public/cloud-signer.json
export WAITRON_FISCAL_CLOUD_FINGERPRINT='<independently confirmed SPKI SHA-256 fingerprint>'
export WAITRON_FISCAL_CONFIRMATION_FILE=/outside/current/cloud-event.json
export WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY=/outside/receipts
```

The trust file contains exactly `issuer`, `fingerprint` and `publicKey`. The public key is the
base64url-encoded Ed25519 SPKI DER key; its SHA-256 must match the independently confirmed
fingerprint. Do not enrol a signer from an untrusted packet or the backup being restored.

The current-event file contains exactly `version: 1`, `binding`, `operatorId`, `allocationId`,
`receiptId`, `priorActivation`, `incidentEvidence` and `requiredBases`. Its binding is the complete
local module/action/event/source/target binding. `requiredBases` lists every configured base and
purpose, including full invoices. The `allocationId` and `receiptId` name the consumed signed
receipt. Obtain these current facts outside the restored database.

Set `priorActivation` to `none` only when the current outside record establishes that this
allocation has not been attempted locally. An uncertain attempt uses `uncertain`, which refuses
activation. Use `committed` only for a checked retry of the exact committed result. It does not
permit an old backup to recreate a missing local result.

Keep the confirmation and retained receipts independently of the venue and its backups. The
receipt directory must already exist and allow private-file creation and directory flushing.
For containers, explicitly forward these variables and mount the directories, following the
[outside-storage instructions](offline-fiscal-restore.md#make-the-outside-evidence-available-to-the-container).
The standard Compose file does not supply them.

Before activation, the adapter creates an exclusive receipt file named by the SHA-256 of the
allocation ID. It retains the signed receipt, local binding, key-event operator and stable report
operation ID. Any later refusal, including a local taxpayer, environment or series mismatch, keeps that receipt
spent in this directory. The outside allocation was already consumed; this path never frees its
name. Reuse
requires the current outside confirmation and the exact local committed activation. If either is
missing, use a fresh allocation and event; do not delete the retained receipt to retry.

## Report later, outside a sale transaction

`readCloudAllocationReport(db, node, {receiptPath, trust})` collects an opaque report only when
the signed retained receipt matches a locally committed allocation and approval. It reads the
committed result rather than inferring activation from consumption. Keep historical public
verification keys available under your selected compromise and retention policy.

Pass the returned `{operationId, body, expectedReceiptId}` to
`reconcileCloudFiscalAllocation({directory, operation, transport, authenticate})` from the server
adapter. The transport is `createCloudFiscalAllocationClient`; `authenticate` supplies the
current installation ID, private machine key, lease and pinned origin. For paper reports, supply
`expectedReceiptId: null`; Cloud receipt reports use the consumed receipt ID. A reply naming
another receipt is refused and leaves the report pending. The proof signs Cloud's
`waitron.fiscal-machine-report` domain, the stable operation ID and the canonical body digest.
The journal retains public evidence and results; the machine key and lease are not written there.

The adapter also carries a separately prepared public paper-history report unchanged. Cloud
validates that signed history. A report records evidence; it does not import a register, consume
an allocation or activate the box. Account-side paper import remains a separate Cloud operation.

The adapter signs and checks the complete request size before retaining a new operation. An
oversized proof is refused without binding its operation ID; never truncate a signed receipt or
block to make it fit. Journal files are written privately, flushed and published with an exclusive
hard link, so a failed short write does not publish a partial final file. Use an existing writable
report directory on a filesystem that supports hard links. The consumed receipt and its outside
continuity remain separate from this reporting journal.

A lost reply leaves the same operation and body pending. Renew authentication and retry that
operation, because a missing reply does not tell you whether Cloud recorded it. A returned result
is retained and later calls return it without another request. A returned conflict stays visible
in that retained result and does not replace the original evidence. Changed evidence for the same
operation is refused. A crash can leave the report's lock file behind; inspect the pending
operation and outside result before arranging a retry, rather than deleting its journal.

These are explicit adapter calls. This change adds no background report scheduler or call from
invoice issuance. The account status method requires an explicit Cloud session and CSRF token;
never persist either in the public evidence journal.

## Qualification

Run the local recovery and transport checks with:

```sh
pnpm --filter @waitron/server exec vitest run \
  src/cloud-fiscal-allocation.test.ts src/cloud-fiscal-allocation-client.test.ts \
  src/cloud-fiscal-reconciliation.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run \
  src/cloud-evidence.test.ts src/cloud-preparation.test.ts \
  src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

The archive and bucket cases use the real restore entry point and local key authentication.
They compare retained fiscal rows, check complete series activation and reject an old backup's
missing local result. The sale case replaces global `fetch` with a throwing recorder and checks zero calls.
It also uses a filing-client resolver that throws if invoice issuance tries to resolve that client. The paper case consumes a signed paper allocation offline, then reports its original
history through a controlled HTTP listener. That listener does not qualify Cloud's PostgreSQL
implementation or a production signing policy.

The separately owned Cloud joint test is
`packages/account-http/test/fiscal-waitron-client.test.ts`. Run it against the pinned Waitron
candidate using Task 7's PostgreSQL command before considering W41s-C3 complete. A local HTTP
fixture or a structurally valid packet alone is not that joint result.
