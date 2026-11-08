# A987 sender naming implementation plan

**Goal:** SMTP displays the trading/location name, retaining the configured mailbox.
**Basis:** [approved amendment](../specs/2026-10-22-a987-prepare-venue-email-design.md), [Tasks 8–13 and Cut D](2026-10-22-a987-prepare-venue-email.md).

| Authority supplied by driver | Meaning |
| --- | --- |
| Lane E `questions.md`, WATCHER2026-11-07 19:21: “Account delivery details and sender naming stay for their later cuts.” | Naming is this later cut. |
| Current RUNNER H13, OWNER2026-11-01: “build on main and whoever lands second resolves overlap” | Source overlap does not require waiting. |
| Owner launch, 2026-11-08: explicitly authorises finish-branch and land-branch | Driver may finish and land after checks. |

These external records are driver-supplied authority, not independently inspected here. Baseline: `1f1d02fa67`. Account metadata PR2590 (`4d82f845ee01b5c846836e8240b59e60f3f0dca7`, CI42467357347 running at launch) shares that base: do not import/depend on it; eventual overlap requires the second lander's rebase.

**Limits:** Preserve content, subjects, PDF bytes, capture sender, persisted outcomes/retries, authority and privacy. No protected fiscal writers/hash/numbering/immutable-data/registration/restore changes; no schema, dependencies, protocols or evidence formats. Lane F owns body wording. Cloud/D102, stage-policy repair and unauthenticated setup-test target repair are separate; A951-S draft2543 stays parked for physical reboot. Any actual unreleased owner gate stays explicit; report ambiguity to driver.

Server paths below mean `apps/server/src/`. Driver obtains Claude's pre-build read before coding. Implement inline, failing test → observed failure → minimal implementation → passing count.

- [ ] **Transport naming, Tasks 8/12.** Add `email-sender-name.ts`: `venueSmtpFrom(storedFrom:string,senderName:string):{name:string;address:string}`. Installed nodemailer 10.3.1 exports default `nodemailer/lib/addressparser` (exports/declaration inspected only); use unflattened parsing and identity's `isValidEmail`. Accept one mailbox, bare or display-mailbox; refuse invalid/empty/multiple/group/CRLF senders with `server.credential_unusable`, `{purpose:"email.smtp",field:"from"}`. In `email-delivery.ts`, widen delivery-only `from` to `SmtpConnection["from"]`; name SMTP from `(await readVenue(tx)).name` (`packages/db/src/venue.ts:60`), without location-id injection. Trace both `boot.ts` account wrappers/invoice availability, `attendance-email-worker.ts`, `certificate-reminder-worker.ts`, `box-alert-email.ts` and settings first. Capture stays unchanged. Adapt `invoice-email.ts` envelope type only; retain transport/outbox behavior and box-alert write-lock semantics.
- [ ] **Tests and settings, Tasks 9/10.** In `setup-email-api.ts`, validate ordinary `venue.name`; thread senderName through setup `api/client.ts`, `setup-app.ts`, `screens/email-screen.ts`. Owner-held `setup-first-fiscal-api.ts` uses `state.frozen.request.name`; keep its email-only body/header and publication recovery. Settings test derives name server-side; `email-settings-api.ts` GET keeps raw saved `from:string`, redaction and authority, adds `senderName`; dashboard `api/client.ts`/`screens/email-settings-panel.ts` previews it without changing form values. No name override or secrets exposed.
- [ ] **Red/green proof.** Before implementation, add failing `email-sender-name.test.ts` and envelope/route checks: parsed From has distinct trading/legal names, punctuation/Unicode/header-like names without injected headers, unchanged mailbox/content; invalid senders refuse before network. Retain no-route/capture, accepted-test invalidation including name edits, manager/admin, own-recipient, password-reset privacy, worker outcomes/retries and exact invoice attachment-byte controls. No permanent self-mutation tests.

Focused commands:

`pnpm --filter @waitron/server exec vitest run src/{email-sender-name,email-delivery,account-email,attendance-email,certificate-reminder-email,box-alert-email.context,setup-email-api,setup-first-fiscal.route,email-settings-api,invoice-email,invoice-delivery,boot.invoice-delivery,guide-content}.test.ts`

`pnpm --filter @waitron/setup exec vitest run src/{api/client,screens/email-screen,setup-app-first-fiscal,first-setup-session}.test.ts`

`pnpm --filter @waitron/dashboard exec vitest run src/{screens/email-settings-panel,widgets/email-settings-form,widgets/email-settings-form.unsaved}.test.ts`

`pnpm exec vitest run scripts/guide-links.test.ts`

Update EN/ES email guides, README/backlog; inspect preview/guides in both themes/390px. Sign commits; finish-branch's Claude run-it review, normal hook and current-head scoped CI precede authorised land-branch and merged-head CI. No whole-workspace local duplication.
