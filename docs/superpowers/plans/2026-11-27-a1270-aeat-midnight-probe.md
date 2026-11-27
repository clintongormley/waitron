# A1270 — which time zone AEAT uses to call an invoice's date "in the future" (plan)

Status: plan, 2026-11-27, after one fresh-context read (13 findings, all taken). Item: A1270 in
`docs/backlog/fiscal.md`; lane L queue (watcher, 18:59–19:00 27 Nov: the owner starts one command
before midnight tonight and goes to bed; it must run unattended). Session approved by the owner on
25 Nov ("yes", the watcher's queue entry); this plan's design is not owner-reviewed.

## What it answers

AEAT refuses a record whose `FechaExpedicionFactura` is "superior a la fecha actual" (`1112`). The
`@waitron/verifactu` fake compares the record's date at 00:00 **UTC** with its clock
(`dist/testing/fake-aeat.js:128`, `fechaToDate` builds `…T00:00:00Z`). AEAT's documents do not name
the zone. Between 00:00 and 01:00 in Madrid (23:00–00:00 UTC, winter) a UTC comparison refuses a
record dated the Madrid day; a Madrid comparison accepts it. One send in that hour, to AEAT's TEST
service, settles it.

## What is built

1. `apps/server/src/aeat-midnight-probe.ts` — pure helpers, no network:
   - `madridMinute(now)` and `inSendWindow(now)`: 00:05 ≤ Madrid time < 00:55.
   - `probeRecords(now, taxpayer)`: four `AltaInput`s sent in this order, each a simplified invoice
     (F2, base 1.00, 21 % VAT 0.21, total 1.21), each its own genuine first record
     (`PrimerRegistro: "S"`, its own installation number `A1270-<yyyymmddHHMM>-<label>`), system
     name `A1270 probe`, system id `PB`, invoice number `A1270-<yyyymmddHHMM>-<label>` (unique per
     record and run, so a rerun cannot meet `3000`). The producer in `SistemaInformatico` is the
     taxpayer's own tax number and legal name on all four. All generated at `now`:
     - **control**: dated `now − 24 h` in Madrid's offset (at 23:10 UTC 27 Nov: 27-11) — accepted
       under every reading;
     - **madrid-day**: dated `now` in Madrid's offset (28-11, generated `…T00:10:00+01:00`) — the
       question;
     - **own-offset**: offset 0, dated `now + 1 h` (28-11), generated `now` (`2026-11-27T23:10:00+00:00`)
       — accepted if AEAT compares with its own Madrid date, refused if it reads the date against
       the record's own offset or generation time;
     - **future**: dated `now + 24 h` in Madrid's offset (29-11) — `1112` under every reading,
       proving the probe sees `1112`.
     Madrid's offset is `timeZoneOffsetMinutes("Europe/Madrid", now)`.
   - `outcomeOf(line)`: **accepted** = `Correcto` or `AceptadoConErrores` (with its code, e.g. 2004
     or 2007); **1112** = `Incorrecto` with code 1112; **other** = anything else (another code, no
     line, a transport error, `3000`).
   - `verdict(outcomes)`, worded as what happened, never more:
     - control accepted, madrid-day 1112, future 1112 → "AEAT refused today's Madrid date at 00:10
       Madrid: it compares in UTC, as the fake does";
     - control, madrid-day and own-offset accepted, future 1112 → "AEAT accepted today's Madrid date
       at 00:10 Madrid, also when the record said UTC: it compares with its own Madrid date (or UTC
       with at least 50 minutes' leeway)";
     - control and madrid-day accepted, own-offset 1112, future 1112 → "AEAT accepted the Madrid date
       but refused the same date written in UTC: it reads the date in the record's own offset";
     - anything else → inconclusive, naming which record did what.
   - `resultText(...)`: each record's label, invoice number, date sent, outcome, status, code and
     text; send time in UTC and Madrid; the verdict. It never contains the certificate, passphrase,
     tax number or legal name: AEAT's text is printed with both masked, and the response's
     `IDFactura` and `DatosPresentacion` are never printed.
   Unit tests in `aeat-midnight-probe.test.ts` (normal suite, coverage holds): window edges (00:04:59
   out, 00:05 in, 00:54:59 in, 00:55 out); the four dates at 23:10 UTC 27 Nov (27-11, 28-11, 28-11
   at +00:00, 29-11); that the fake's rule refuses madrid-day at that instant; `validate` gives no
   error for control, madrid-day and own-offset, and only `FECHA_EXPEDICION_FUTURE` for future (never
   used to stop a send); each outcome and verdict branch; the masking.
2. `apps/server/src/aeat-midnight-date.preprod.test.ts` — beside `aeat.preprod.test.ts`, run only by
   `test:preprod`, skipped unless the certificate settings `check.sh` sets (`WAITRON_CERT_CHECK_PFX_BASE64`,
   `_PASSPHRASE`, `_NIF`, `_LEGAL_NAME`) are present. The endpoint is fixed:
   `aeatEndpointFor("preproduction")("representante")`; a `WAITRON_CERT_CHECK_ENVIRONMENT` other than
   `preproduction` refuses. Two modes, by `WAITRON_AEAT_PROBE_MODE`:
   - `preflight` (at start, before the wait): open the certificate without printing it, build and
     validate tonight's records, send one read-only `consultar` (files nothing), print
     "pre-flight ok" or the reason;
   - `send`: refuse outside `inSendWindow`; send each record in its own `submit`, each bounded
     (90 s); append each record's result to every file in `WAITRON_AEAT_PROBE_RESULT_FILES` as it
     arrives; then the verdict. Test time limit 400 s.
   `WAITRON_AEAT_PROBE_DRY_RUN=1` stops before any connection and writes "not sent". A test clock,
   `WAITRON_AEAT_PROBE_NOW`, is honoured only with the dry run; any other run that sees it refuses.
   The three new settings are test variables in `packages/shared/src/environment-variables.ts`
   beside the `WAITRON_CERT_CHECK_*` rows (guard: `scripts/environment-variables.test.ts`).
3. `apps/server/scripts/aeat-midnight-probe.sh` — the one command. Loads the certificate from
   `~/.waitron-cert-session/` into environment variables exactly as that folder's `check.sh` does
   (never printing them; no `set -x`, no `env`), runs the pre-flight, then waits until Madrid's
   clock is in 00:10–00:55 (`hm=$((10#$(TZ=Europe/Madrid date +%H%M)))`, every 30 s; refuses at once
   if started between 00:55 and 12:00 Madrid), then runs the send. Every run of vitest names the one
   file `src/aeat-midnight-date.preprod.test.ts` (the certificate settings also switch on the other
   preprod tests, which print the tax number). On every refusal, failure or missed window it writes a
   "not sent" line with the Madrid time and the reason. Results go to
   `~/.waitron-cert-session/a1270-result.txt` and `~/waitron-campaign-l/receipts/a1270/result.txt`.

The owner's command (before midnight; Mac plugged in, lid open):
`caffeinate -i -s <worktree>/apps/server/scripts/aeat-midnight-probe.sh deli`

Until `result.txt` exists, nobody edits, rebases or reinstalls this worktree: the test file is read
at 00:10, not at the start.

## Checks before handing over the command

- Unit tests pass; the failing case is shown first (TDD).
- A dry run of the script with a throwaway folder of dummy files and the dry-run clock set to 23:10
  UTC prints four records and "not sent". Nobody but the owner's run opens the real certificate.

## Afterwards (not tonight)

Own Madrid date → correct the fake's comparison in the `@waitron/verifactu` repository and release
it; own offset → correct it that way; UTC → one dated sentence in `docs/developers/testing-guide.md`
ends the entry. The backlog entry is deleted. Fiscal: the owner lands the PR; full finish-branch wave.

## Not built

No product change; nothing on a box files differently. No production send: the endpoint is fixed.
