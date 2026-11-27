# Fresh read of the SETUP-CERT-FIRST piece 1 plan (235c8d5bd2), 2026-11-27

One fresh-context reader (Opus, high effort), lane B. Its findings, as reported; the plan at
450ba40dda takes in all of them.

**Should this exist?** Need: the owner asked on 25 Nov whether setup should take the company name and
tax number from the certificate, then "y" to the watcher's two pieces (lane B queue, SETUP-CERT-FIRST).
Simplest alternative is changing nothing, since AEAT's test likely already refuses another company's
certificate (error 4112, from reading); about 30 lines copying the dashboard's check are a fair price
for an earlier, plain message. Size at the time: 1 file, +88/−0, nothing generated.

**Critical:** none.

**Important**
1. "Today it is accepted, and the venue then files with another company's certificate" is not true as
   written: every production setup needs an accepted AEAT test submission signed with the same
   certificate (`setup-operation-routes.ts:262-266`, `fiscal-readiness-runner.ts:145`,
   `firstSetupPublicationDigest`), and AEAT refuses a holder who is not the taxpayer, a registered
   representative or a colaborador social (4112, `docs/compliance/getting-to-production.md:114`).
   Piece 1 refuses earlier and plainly, and newly refuses another company's certificate AEAT might
   accept (an accountancy firm's). Reading only.
2. The guide text and D2 rested on a difference that does not exist: on every live Spanish setup,
   leaving the venue page reserves the setup (`provisioning.ts:11`, `boot.ts:1560`,
   `setup-app.ts:1562`); Back from the certificate page leads to the fixed-details page
   (`setup-app.ts:1480-1497`); the way out is Back → abandon the attempt → enter new details while
   before the module step (`:1999`, `:3062`), else Start again. Ran
   `apps/setup/src/setup-app-first-fiscal.test.ts -t "frozen|scope edit after claim|Edit these details"`: 5 passed.
3. The refusal sentence offered one fix only; it should name both (the typed number may be the wrong
   one). D1 overstated the cost of showing the certificate's number: one new `PERSONAL_LOG_KEYS` name.
4. D3 undercounted: applying the check failed 29 apps/server cases (`setup-api` 9,
   `setup-api.throwaway` 10, `setup-email-provision` 6, `setup-certificate` 2,
   `first-fiscal-declared-publication` 1, `first-fiscal-hour-readiness` 1) and 20 provisioning cases
   (`cli-first-setup` 18, `cli-owned-entry` 2); 7 direct calls need the argument
   (`first-setup-settings.test.ts` 6, fiscal-verifactu `setup-certificate.test.ts` 1);
   `slot.test.ts:244` fails to compile. Without the change: 382 + 92 passing.
5. Personal certificates (no organisation identifier) are never checked (`certificate-file.ts:42-45`).

**Minor:** line numbers (:274, :81); no first-fiscal-activation test file; the three callers are the
only production callers and each holds the normalised number; values treated differently (G-type
letter/digit ending, a second identifier listed first) are refused, as on the dashboard; lane C's
#4465 edits the same guide section and `contribution.ts`; the `sealAeatSecret` comment would promise
more than it checks.

**Other paths:** every certificate seal is preceded by the check in the same request; configuration
imports carry no certificate. Piece 1 does not make piece 2 harder.

**Reading only:** AEAT's 4112 behaviour, that a real box always takes the reserved path, the other
paths, the shape of personal certificates.
