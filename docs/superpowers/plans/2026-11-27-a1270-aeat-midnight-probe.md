# A1270 — which time zone AEAT uses to call an invoice's date "in the future" (plan)

Status: plan, 2026-11-27. Item: A1270 in `docs/backlog/fiscal.md`; lane L queue (watcher, 18:59–19:00
27 Nov: the owner starts one command before midnight tonight and goes to bed; it must run unattended).

## What it answers

AEAT refuses a record whose `FechaExpedicionFactura` is "superior a la fecha actual" (`1112`). The
`@waitron/verifactu` fake compares the record's date at 00:00 **UTC** with its clock
(`dist/testing/fake-aeat.js:128`, `fechaToDate` builds `…T00:00:00Z`). AEAT's documents do not name
the zone. Between 00:00 and 01:00 in Madrid (23:00–00:00 UTC, winter) the two readings disagree
about a record dated the Madrid day: a Madrid comparison accepts it, a UTC comparison refuses it
with `1112`. One send in that hour, to AEAT's TEST service, settles it.

## What is built

1. `apps/server/src/aeat-midnight-probe.ts` — pure helpers, no network:
   - `madridWindow(now)`: whether `now` is between 00:05 and 00:55 Madrid time.
   - `probeRecords(now, identity)`: three `AltaInput`s, each a simplified invoice (F2, 1.00 + 0.21
     VAT), each with its own throwaway installation number so each is a genuine first record
     (`PrimerRegistro: "S"`), throwaway system name `A1270 probe` and series `A1270-<yyyymmddHHMM>`:
     - **control**: dated the day before (`now − 24 h`) — accepted under either reading;
     - **madrid-day**: dated `now` in Madrid — THE question;
     - **future**: dated `now + 24 h` — `1112` under either reading, proving the probe sees `1112`.
     All generated at `now`, offset read from `timeZoneOffsetMinutes("Europe/Madrid", now)`.
   - `verdict(results)`: `madrid` (control accepted, madrid-day accepted, future `1112`), `utc`
     (control accepted, madrid-day `1112`, future `1112`), otherwise `inconclusive` with why.
   - `resultText(...)`: per record its label, series, date sent, AEAT's status, error code and
     text; the send time in UTC and Madrid; the verdict. No certificate, passphrase, NIF or name.
   Unit tests in `aeat-midnight-probe.test.ts` (normal suite, coverage holds): window edges
   (00:04:59 out, 00:05 in, 00:54:59 in, 00:55 out); the three dates at 23:10 UTC 27 Nov
   (26-11, 28-11, 29-11) and that the fake's rule would refuse madrid-day at that instant; each
   verdict branch; that the text never contains the NIF or name passed in.
2. `apps/server/src/aeat-midnight-date.preprod.test.ts` — beside `aeat.preprod.test.ts`, run only by
   `test:preprod`, skipped unless the certificate settings `check.sh` already sets
   (`WAITRON_CERT_CHECK_PFX_BASE64`, `_PASSPHRASE`, `_NIF`, `_LEGAL_NAME`, `_ENVIRONMENT`) are present.
   The probe's own three settings (`WAITRON_AEAT_PROBE_RESULT_FILES`, `_DRY_RUN`, `_NOW`) are
   declared as test variables in `packages/shared/src/environment-variables.ts` beside the
   `WAITRON_CERT_CHECK_*` rows (guard: `scripts/environment-variables.test.ts`). It refuses unless the
   environment is `preproduction` (the endpoint is `aeatEndpointFor("preproduction")`, never read from
   a setting), refuses outside `madridWindow`, builds the records with `buildAltaRecord`, sends each
   in its own `submit` (control, madrid-day, future) through `mtlsFetch`, and writes `resultText` to
   every path in `WAITRON_AEAT_PROBE_RESULT_FILES` and the terminal. A transport failure is written
   as its kind, HTTP status and SOAP fault only. `WAITRON_AEAT_PROBE_DRY_RUN=1` builds, validates
   (`validate`, no errors) and writes the text with "not sent", stopping before any connection.
3. `apps/server/scripts/aeat-midnight-probe.sh` — the one command. It waits until Madrid's clock is
   in 00:10–00:55 (checking every 30 s; refuses at once if started between 00:55 and 12:00 Madrid),
   then loads the certificate from `~/.waitron-cert-session/` into environment variables exactly as
   that folder's `check.sh` does (never printing them) and runs the preprod test file. Results go to
   `~/.waitron-cert-session/a1270-result.txt` and `~/waitron-campaign-l/receipts/a1270/result.txt`.

The owner's command (from the worktree, before midnight):
`caffeinate -i <worktree>/apps/server/scripts/aeat-midnight-probe.sh deli`

## Checks before handing over the command

- Unit tests pass; the failing case is shown first (TDD).
- A dry run of the script with a throwaway folder of dummy files and the window forced (a test-only
  `WAITRON_AEAT_PROBE_NOW` read by the script and the test) prints three records and "not sent".
  Nobody but the owner's run opens the real certificate files.

## Afterwards (not tonight)

`madrid` → correct the fake's comparison in the `@waitron/verifactu` repository and release it;
`utc` → one dated sentence in `docs/developers/testing-guide.md` ends the entry. Either way the
backlog entry is deleted. Fiscal: the owner lands the PR; full finish-branch wave.

## Not built

No product change; nothing on a box files differently. No production send: the endpoint is fixed.
