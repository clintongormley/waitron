# Retain an emergency allocation outside the box

When you cannot establish the current short-name register, an emergency allocation uses a fresh
random identity. It does not declare a short paper name free. This W41s-6 candidate collector
requires a separately configured outside confirmation file and an existing writable incident
directory. It does not provide the complete paper-only operator journey.

Keep the incident directory on storage outside the box and outside its backups. Configure its
mount yourself; the collector does not establish that a configured path is outside the machine.
A directory beside `venue.db` does not meet that requirement. A missing directory refuses
recovery; the collector does not create a replacement directory on the box.

```sh
export WAITRON_FISCAL_CONFIRMATION_FILE=/outside/current/restore-event.json
export WAITRON_FISCAL_EMERGENCY_DIRECTORY=/outside/incidents
```

Prepare your current confirmation independently of the submitted restore request. Use the selected
backup's digest, target node, fresh unpredictable event ID and the operator established by that
backup's node recovery key. For example:

```json
{
  "version": 1,
  "priorActivation": "none",
  "binding": {
    "module": "fiscal-verifactu",
    "action": "restore",
    "eventId": "replace-with-a-fresh-unpredictable-event-id",
    "sourceId": "replace-with-the-selected-copy-digest",
    "targetNodeId": "c0000000-0000-4000-8000-000000000001"
  },
  "operatorId": {
    "kind": "recovery-key",
    "nodeId": "c0000000-0000-4000-8000-000000000001",
    "eventId": "replace-with-a-fresh-unpredictable-event-id"
  },
  "taxpayerNif": "89890001K",
  "environment": "preproduction",
  "requiredBases": [
    { "code": "A", "purpose": "standard" },
    { "code": "FF", "purpose": "full" },
    { "code": "R", "purpose": "rectificative" }
  ],
  "incidentEvidence": "outside/register/this-recovery-event",
  "knownIdentities": null,
  "uncertaintyRecorded": true
}
```

The labels and NIF are synthetic. Replace them with the selected venue's values. Use `null` for
`knownIdentities` when outside history is unavailable and record that uncertainty explicitly.
When you have current outside history, supply its known installation identities as an array.
The collector discards a draw that matches one of those names.

The public recovery operation keeps the same `binding`. Its module `input` contains
`"emergency": {"version": 1}` and `approval`, instead of `allocation` and `approval`.
The approval has the same format as a paper recovery approval: matching event, source, target,
operator and incident reference, with `oldMachineOffline: true`, `oldMachineAbsent: false` and
`noParallelRecovery: true`. Supply the node recovery key separately, never in this record.
Archive encryption still uses its own key. An administrator-led re-registration uses its
authenticated person ID and `re-register` instead of `restore`.

After authenticating the key, the collector rereads your outside confirmation. It draws the
identity from the operating system's cryptographic generator and writes the allocation, complete
series set, checksum, approval and outside-history statement to the incident directory. It flushes
that file and its directory before passing the allocation to activation. The filename is the
SHA-256 digest of the event ID followed by `.json`; it is created exclusively with mode `0600`.
It contains no node recovery key or archive encryption key. Retain it even if activation fails.

An event already recorded outside cannot claim another identity. Reordering the request or
changing its source does not reopen it. After an interrupted uncommitted attempt, leave that
record consumed and prepare a different event with a new draw. Never delete the incident file
to make a retry work.

For a confirmed committed retry, consult the outside record again and set `priorActivation` to
`committed`. The collector rereads the retained allocation and approval. Activation returns its
existing result only when the current database contains the exact matching committed result,
identity and live series. A restored old backup lacking that local result refuses the retry;
the retained file cannot authorise a new activation. Use `uncertain` when you cannot establish
the earlier outcome. That state refuses activation and leaves the record consumed.

The collector retains the consumption record; recording each later attempt's result in your
incident history and the complete operator confirmation and handover remain part of the
unfinished Task 6 procedure. No network service or subscription supplies authority to this path.
