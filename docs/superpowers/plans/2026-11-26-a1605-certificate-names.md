# A1605. Identify the certificate this box replaces

A person repairing one box can match its previous certificate by name and SHA-256 fingerprint before removing it. New box roots have distinguishable names, even when two boxes use the same network name. A box that already has a usable root keeps that root and its installed trust.

## Give new roots a distinguishable name

In `apps/server/src/self-signed-cert.ts`, add a short suffix from the new root’s random serial to `waitron-setup-ca` and use that name for the root subject and its signer’s issuer. Keep the fixed old name and the new suffix format in the existing root-role check. Keep the other role, signature, usage, and name-constraint checks. Two synthetic mints for `waitron.local` show the same displayed name today. First add a failing case in `self-signed-cert.test.ts` for two such mints, then run the existing handshake and leaf-reissue cases and verify that a fixed-name root already in use still works unchanged.

## Show the previous certificate during repair

In `box-tls-repair.ts`, take the previous name and fingerprint from the public `ca.crt` already set aside by a completed replacement. Read it with the existing bounded archive reader. Recognise the former direct-signing root for identification only, using its fixed name and old certificate role. Keep identification separate from the checks that allow a root to be downloaded or used for TLS. Omit previous details when the archive is unavailable or the certificate cannot be identified. Keep the existing download fingerprint tied to the current certificate. Use the existing inspection result for both the repair reply and a refreshed repair page. This uses the existing archive lifetime and adds no saved fields or files.

In `connection-bootstrap-page.ts` and `connection-bootstrap-strings.ts`, show the old name and fingerprint together in the replacement instructions. Require both to match before removal. If details are absent, tell people to leave installed certificates alone and install the offered certificate. Use the same words in the English and Spanish device instructions. The ordinary installation page (`trust-page.ts`, `i18n/trust-page.ts`, and shared `trust-page-devices.ts`) has no previous identity, so remove its generic deletion step. Update both languages of the Backup and recovery and Table service guides. Use the existing sections, status messages, and certificate download.

Add failing cases to `box-tls-repair.test.ts` for a replacement of the former fixed-name root, checking the previous identity and the new download fingerprint on the reply and reread. Check that an absent old root yields no removal target and that retained trust has no removal target. Exercise the visible resulting instructions in `connection-bootstrap-page.test.ts` and the ordinary installation page in `trust-page.test.ts`. Run the TLS, repair, route and guide checks and inspect the page at phone and desktop widths in both languages and themes.

Expect about 100 added production lines and 85 added test lines, with about 45 lines removed or replaced across the instructions. The scope is certificate identification and wording. It adds no trust reset, certificate migration, host configuration, state layout or changes to the rules about which names a signer may vouch for.
