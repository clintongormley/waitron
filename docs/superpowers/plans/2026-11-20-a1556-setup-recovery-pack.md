# A1556 setup recovery pack

A manager finishing Preparation can download a recovery pack containing the server identity key. Backups names that pack, explains both keys and offers a usable default destination. Scope comes from A1556 in the Lane D queue. Claude reviews this plan before watcher clearance. Build each behaviour with a failing focused test first.

## Issue and download the pack

- Wire a small `apps/server/src/setup-recovery-pack.ts` helper from `boot.ts` into `setup-api.ts`. Pass the one-time Preparation key and name to the module's existing `recoveryPackPage` through `backup-recovery-pack-parts.ts` and `recovery-document-evidence.ts`. Reuse the fonts, `@waitron/recovery-pack` renderer and its restore-readable attachment. The cover says the bucket and archives are yet to be set up.
- Render before recording the made pack. Use `nextRecoveryPackNumber` and `insertRecoveryPack` for the same node, number, date and carried key. Keep node-lock-before-venue-lock order. Preserve the current retry after a trading-settings write refusal before publication. Once the matching pack and key are committed, retries reuse that result without another pack, replacement key or private output.
- Deliver the PDF only in the existing HTTPS, same-origin, no-store Preparation response. Keep the PDF and raw key out of the operation journal, state files and logs. Keep the existing signed-in replacement action when the one-time response is lost.
- In `apps/setup/src/api/client.ts`, `setup-app.ts` and `screens/done-screen.ts`, offer **Download recovery pack (PDF)** in Preparation. Hold the bytes in tab memory, revoke the download URL and allow another attempt while the page is open. Keep the spare's existing text-file action.
- Backups shows the pack number and key it carries. A download click does not confirm saving, so keep the existing unconfirmed status and give the person a clear choice based on whether they have the PDF. Reuse the current pack card and keep its receipt permission rule.
- Extend server `setup-api.throwaway.test.ts`: parse the downloaded attachment, verify its key and record against the saved node, and check HTTPS/origin, pre-publication retry, completed replay and journal exclusion. Extend setup `api/client.test.ts`, `setup-app.test.ts` and `screens/done-screen.test.ts` for the link, a failed download and the existing missing-output action.

## Simplify the last page

- Remove the opening-hours card and its unused setup state and wire field, including the reads in `setup-api.ts` and `setup-first-fiscal-api.ts`. Remove the boot wiring and `setup-opening-hours.ts` and its obsolete suite. Leave the venue's opening-hours settings available in the dashboard.
- Remove the generic backups nudge and retire its EN/ES copy in `apps/setup/src/i18n/strings/finish.ts`. Keep the existing backup warning under the dashboard bell and Box status. It uses `backup.disabled` with a Backups link and EN/ES text.
- Pin both removals in `screens/done-screen.test.ts` and update the affected setup route assertions. Extend the existing `apps/server/src/boot.test.ts` backup-disabled case to verify severity and Backups target. Run `alert-sources.test.ts` for the current bucket and spare cases.

## Explain the keys and destinations

- Use **Server identity key** for authorising recovery or takeover and **Backup decryption key** for opening encrypted copies. Use the same EN/ES names in the relevant setup, restore, Backups, recovery pack and PDF copy. Each key keeps its existing job. The first pack holds the identity key. After enabling backups, the pack can include decryption material and point to the earlier pack for the identity key.
- In dashboard `screens/backup-screen.ts` and `backup-destination-model.ts`, offer the deployed default `/var/lib/waitron/backups` for a fresh folder choice. Preserve saved folders, bucket-only settings and drafts. Explain that the folder stays on this box and that an S3 bucket is a separate off-box destination. Keep both independently selectable.
- State where to get the bucket name, region, access key ID and secret, and when an endpoint or prefix is useful. Keep the existing fields and validation. Keep one page-level Backups guide link. Update `apps/server/src/guide/{en,es}/{backups,backup-recovery}.md` with the same wording and existing heading IDs.
- Extend dashboard `backup-destination-model.test.ts`, `backup-screen.archive-destination.test.ts`, `backup-screen.test.ts` and `recovery-pack-card.test.ts` for the initial folder, saved choices and payloads, one guide link and the made-pack copy.

Run the named focused suites, affected accessibility cases and guide link guards. Inspect synthetic EN/ES PDFs and the two screens in both themes at desktop and phone widths. Keep captures out of Git.

Expect 220–340 added code lines and 250–380 added test lines, plus 90–150 lines of bilingual UI/guide copy and removal of the old opening-hours helper. A1323 master-key work, A1557 Back up now and mount changes remain separate. Preserve Live's first pack and the existing key format, permissions, invoice series and fiscal chain.
