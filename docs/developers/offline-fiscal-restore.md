# Recover a filing box from an old backup

An archive gives you the venue's saved history. It cannot tell you which installation names
were used after that copy was made. Before restoring, consult the current outside register,
isolate the former box and rule out another recovery. Use a fresh paper allocation, including
one reserved by phone, or the [emergency procedure](emergency-recovery.md) when that history
cannot be established. Neither route needs a Cloud subscription. Downloading a bucket or
managed-Cloud copy still needs its source connection.

Keep three things separate: the archive encryption key opens the archive; the selected backup's
named node recovery key authenticates recovery; current outside evidence authorises the new
fiscal identity. Keep older named keys while you retain their backups. Keeping the existing
node and location identifiers still requires a fresh fiscal allocation after a cold restore.

## Make the outside evidence available to the container

The standard `compose.yml` does not forward `WAITRON_FISCAL_*` variables or mount outside
evidence. Exporting these variables in your shell alone does not configure its app service.
Add an explicit override beside the installed `compose.yml`, named `recovery.override.yml`:

```yaml
services:
  app:
    environment:
      WAITRON_FISCAL_CUSTODIAN_FILE: /outside/custodian.json
      WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: ${WAITRON_FISCAL_CUSTODIAN_FINGERPRINT:-}
      WAITRON_FISCAL_CONFIRMATION_FILE: /outside/current.json
      WAITRON_FISCAL_EMERGENCY_DIRECTORY: /outside/incidents
    volumes:
      - type: bind
        source: ${WAITRON_RECOVERY_PUBLIC_DIR:?Set the outside public-evidence directory}
        target: /outside
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: ${WAITRON_RECOVERY_INCIDENT_DIR:?Set the outside incident directory}
        target: /outside/incidents
        bind:
          create_host_path: false
```

Choose existing directories on your outside storage, such as an independently retained mounted
share. A directory beside the venue database, or another folder in its state volume, does not
establish outside continuity. This override cannot verify where a share is physically stored.
The public directory must contain an `incidents` subdirectory as the nested mount point.
For example, with your real mount paths substituted:

```sh
export WAITRON_RECOVERY_PUBLIC_DIR=/mnt/olivo-recovery/public
export WAITRON_RECOVERY_INCIDENT_DIR=/mnt/olivo-recovery/incidents
```

The app runs as uid and gid `10001`. Give that identity read access to the public files and
write access to the incident directory, including permission to create and rename files. Retain
the incident files at mode `0600`. Do not put the custodian's private signing key in either
mounted directory. On paper recovery, separately compare the custodian fingerprint with the
current outside master, then export `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT` with that value.
Do not obtain your confirmation of that fingerprint from the backup you are restoring.

## Review the copy and prepare the request

Open Restore on the setup screen and select the archive, bucket or managed-Cloud copy. The
review shows its business, date, source and saved node-key name. For a stream copy, use the
review's `activationSourceId` when preparing the operation; its generation reference alone does
not identify the selected database bytes.

For paper or a phone reservation, have the custodian mark the entry consumed for this event
before use. Obtain its signed block and consumption receipt, confirm the current entry state,
and [export the public operation](paper-custodian.md#export-a-paper-recovery-operation). Put the
public custodian file in `custodian.json` and the separately prepared current-event confirmation
in `current.json` in the public directory. A signed old pack alone is insufficient. A retired
entry, a different taxpayer, an altered signed value or consumption for another event is refused.

For emergency recovery, prepare `current.json` using the
[emergency confirmation format](emergency-recovery.md). Put the matching emergency request in
the form. The box draws the actual identity later, after checking the selected node key and
rereading that outside confirmation. The request download therefore contains no generated
identity or activation result.

Enter the selected backup's node key in its separate field. Check the source, event and target,
isolate the former machine, then download and retain the public request with your outside
records. A changed request clears its retention confirmation. The node secret stays out of that
download. Missing fields and refusals appear beside their fields and above the restore action.

## Run the restore with the outside mounts

Before submitting the final restore action, recreate only the app with the override so its
restart reads the outside evidence. Run this from the directory holding your installed Compose
files, keeping the same Compose project and state volume:

```sh
docker compose -f compose.yml -f recovery.override.yml up -d --no-deps --force-recreate app
```

Reopen the selected copy if recreating the app interrupted its preview. Submit the reviewed
request and node key through the form. The archive encryption key remains in the archive-key
field. The restart stages the node credential separately from the public request, checks that
key against the selected database and rereads current outside evidence before activation.

If you use the operator CLI instead, stop the app first and supply the same override to
`docker compose run`. Set `WAITRON_NODE_RECOVERY_KEY` and, for a local archive,
`WAITRON_BACKUP_RECOVERY_KEY` privately in your shell. Export no secret as a command argument.
Keep `operation.json` in the public directory and mount the selected archive read-only:

```sh
docker compose -f compose.yml -f recovery.override.yml stop app
docker compose -f compose.yml -f recovery.override.yml run --rm --no-deps \
  -e WAITRON_NODE_RECOVERY_KEY -e WAITRON_BACKUP_RECOVERY_KEY \
  -e WAITRON_RECOVERY_OPERATION_FILE=/outside/operation.json \
  -e WAITRON_ENV=preproduction \
  -v "$PWD/selected-backup.wt:/input/archive.wt:ro" \
  --entrypoint node app /app/bin-restore.js restore /input/archive.wt
```

The example selects a **preproduction** backup. For a real production backup, explicitly use
`WAITRON_ENV=production`; environments are never interchangeable. The command prints
`restored /input/archive.wt` on success. Use the old-box confirmation flag only after establishing
that the former box is permanently off. The bucket and archive-pack CLI forms retain their
existing source-download and confirmation requirements; the override supplies their outside
fiscal evidence too.

## Retain the generated result

For emergency recovery, open the generated `.json.txt` file on the outside incident storage.
Its filename starts with the SHA-256 of your event ID. It contains the actual installation
identity, checksum, complete series, selected source and attempt history. Keep it with its JSON
file, even after a refusal. Compare the text's printed SHA-256 with the JSON bytes before relying
on a saved printout. See [reading the incident](emergency-recovery.md#read-and-retain-the-generated-incident).

Both copies are flushed before activation and refreshed before the restore publishes trading
settings. This retention is not evidence that somebody read or printed them. An unavailable or
read-only incident directory refuses recovery; never substitute storage in the venue backup.
For paper, retain the custodian's consumed entry, signed receipt and matching request.

After a successful CLI restore, start the app and check its health and selected key name before
using the till. Startup can still refuse configuration unrelated to fiscal activation; a restored
database alone is not a healthy server. Once recovery is complete, you can recreate the app with
the ordinary Compose file to detach the outside storage. Keep the outside evidence and incidents.

If a process was interrupted, follow the [checked restart procedure](emergency-recovery.md#resume-an-interrupted-staged-restore).
Do not remove a consumed incident or placement marker to retry. A matching local committed result
and fresh current outside evidence are required for exact replay. An uncommitted identity remains
burned; a new attempt takes a new event and allocation.


## Qualification and limits, 2026-10-14

The container rehearsal ran the candidate's production `bin-restore.js` and `node-entry.js`,
migrations and assets over the existing `waitron:dev` runtime (Node 26.8.1), as uid `10001`, with
`--network none`. Paper and emergency CLI restores exited 0. Both staged restores reached
`server.listening`; their placed databases kept the same node/location and held the fresh
identity with all three series at number 1. The emergency JSON and readable copy matched the
stored allocation and source and retained the returned attempt. Separate staged-restore tests
check that neither key appears in the readable copy. Missing outside configuration, a read-only incident directory and a wrong paper
fingerprint each exited 1 without publishing trading settings. The documented Compose override
was resolved with `docker compose config --format json` and checked for its two mount modes and
unchanged state-volume name.

This used synthetic backups and separate host directories as outside storage. It exercised the
packaged server entry points, not a new full-image build, physical replacement hardware, a real
remote share or a physical printer. The first fixture omitted its credential-vault key, then
included a second venue from a shared fiscal fixture; startup refused each. The final rehearsal
used one venue and complete saved configuration. Task 11 owns the later full operational exercise.
