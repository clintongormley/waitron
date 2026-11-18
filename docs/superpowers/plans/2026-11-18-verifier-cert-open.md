# Cloud's backup verifier opens a venue's tax-agency certificate again (VERIFIER-CERT-OPEN)

Lane L, 2026-11-18. Request: lane L `queue.md` VERIFIER-CERT-OPEN (watcher 2026-11-18 03:28), from
lane G's measurement (lane G `questions.md` 2026-11-18 03:25). No owner design approval is claimed.

**Outcome.** Cloud's sandboxed backup verifier, which refuses to start any other program, checks a
venue backup's sealed AEAT certificate and answers `passed`, `invalid` or `unsupported` again,
instead of `unavailable / secret_unavailable` for every backup that holds one.

## Why #3429 moved opening into a separate program, and why that stays for the box

#3429 (c95d09ee5d, plan `2026-11-16-key-derivation-off-thread.md` step 1) opens a certificate file
in a child process with a two-second deadline and a forced stop
(`packages/fiscal-verifactu/src/certificate-open.ts`). Opening a PFX runs its key derivation
synchronously, and the file chooses how many rounds that takes: the hostile case in
`certificate-open.test.ts` sets the MAC iteration count to 2³¹−1. In the long-running server, that
would freeze every sale while it ran. The child keeps the server's event loop free and turns the
stall into a plain "unavailable, try again". Every box caller keeps this unchanged: setup, renewal,
the provision command and sealing.

## Why the verifier can open in-process

The fiscal module's backup check (`backup-verification-secrets.ts`) runs only inside the verifier:
its only caller is the module's verification contribution, which only `verifyBackupArtifact` runs,
and that is exported solely through `apps/server/src/backup-verification-entry.ts` for Cloud
(`grep -rn verifyBackupArtifact apps packages`: no box caller). That process is single-purpose and
is killed from outside: Cloud's bound entry kills it after 30 seconds
(waitron-cloud `packages/backups/src/container-entry.mjs`, its `watchdog`), which
`conventions-data.md` already requires ("Keep an independent deadline on the verifier process: its
cooperative checks cannot interrupt a synchronous SQLite statement"). A hostile certificate there
costs one verification that ends as Cloud's timeout, and nothing else waits on that process.

So the verifier's check calls the existing in-process `openCertificateFile` (after the same
`CERTIFICATE_MAX_BYTES` size check) instead of `openCertificate`. No permission is granted to the
Cloud verifier; no change to how the box opens a certificate.

## Work, failing test first

1. **Red:** in `apps/server/src/backup-verification.permission.test.ts`, run the bundled verifier
   with `--allow-child-process` removed (the same flags as Cloud's bound entry: `--permission` with
   file reads and writes only), and have the runner assert that starting a program is refused
   (`ERR_ACCESS_DENIED`, `ChildProcess`), as it already does for worker threads. Watch it fail:
   the fixture seals an AEAT certificate (`sealAeatSecret`), so the fiscal module answers
   `unavailable` and the result is not `passed`. Remove the bundling of `certificate-open.js` from
   that test.
2. **Green:** in `packages/fiscal-verifactu/src/backup-verification-secrets.ts`, refuse a PFX over
   `CERTIFICATE_MAX_BYTES` as `invalid` (today's answer for `too_large`), then call
   `openCertificateFile`; drop the now unreachable `unavailable` branch. One comment at the call
   names the outer deadline that bounds it.
3. **Existing tests:** `backup-verification-secrets.test.ts` and the fiscal backup-verification
   tests keep every answer (passed, invalid, unsupported, `decryption_unavailable` on a wrong
   passphrase). A test that pinned the child's launch-failure mapping for the verifier, if one
   exists, is replaced by the permission test above; it is named in the PR's "Changed test checks".
4. **Docs:** `docs/developers/conventions-data.md`: the verifier paragraph ("Certificate checks
   require child-process permission …") and the "Archive keys and certificate opening" section
   ("A launch failure, deadline or unusable child reply leaves backup verification unavailable")
   now say the verifier opens in-process under its outer deadline; the box's callers are unchanged.
5. **Lane G's paired fixture:** run it against this branch if it runs from a Waitron checkout
   without Cloud's guest machines; otherwise the permission test in step 1 (the same sandbox flags)
   is the paired proof here, and lane G re-runs theirs once this lands (watcher 03:28). Tell lane G
   in its `questions.md` when it lands.

## Checks

`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-secrets.test.ts
src/certificate-open.test.ts`, `pnpm --filter @waitron/server exec vitest run
src/backup-verification.permission.test.ts src/backup-verification.test.ts`, golden huella and
`inmutabilidad` unedited, typecheck of both packages. Nothing in the fiscal core changes (no
`computeHuella`, chain, numbering, `registros_facturacion` or record builder).

**Size forecast:** production about +6/−6, tests about +10/−6, docs about +6/−6. One pull request.
