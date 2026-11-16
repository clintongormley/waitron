# Account email through test Cloud

**Scope:** BOX-EMAIL-RELAY in Lane F’s queue, narrowed by the watcher in `questions.md`, 16 November 2026 at 21:06: “Plan the box side for the three classes Cloud’s version 1 carries today (invitation, password_reset, email_change)”. The separate Sol-high draft was source-checked and shortened by the driver. No owner design approval is claimed.

**Finish line:** A paired test box sends those three account messages through Cloud when its consenting owner enables relay; explicit off uses existing venue SMTP. Booking and receipt emails stay on their current paths. Demo capture and public reset privacy remain. Cloud failures use existing mail failure reporting, outside sales and database transactions.

**Contract:** `waitron-cloud/docs/transactional-email-relay-contract.md`, version 1, inspected at Cloud `220963875`. “Version 1 allows `invitation`, `password_reset` and `email_change`.” `relay-payload.ts:15–29` requires structured token/code fields, grant id/revision and expiry, not rendered message content. Use signed `email-submit`, `email-status`, `email-cancel` at `/v1/installations/email/{submit,status,cancel}`, not backup’s `/api/installations/...` paths. These are source observations, not live qualification.

## Dependencies before implementation

- Lane K must supply the named test-only on/off and grant-discovery contract. Current message routes accept a grant but expose no grant discovery; the ordinary worker still composes loopback capture. Pairing alone grants no email authority. The watcher was asked to settle this in Lane F’s questions; do not invent endpoints, a fifth installation service or fixed grant credentials.
- Settle recovery against that contract before building. Existing `outgoing_mail` supplies a UUID and conservative abandoned-claim outcome, but `account-mail.ts` generates fresh tokens per claim and stores only hashes. Cloud requires immutable-body replay and truthful queued/accepted status. Existing rows do not prove that replay. Any required persisted payload, route binding or changed restart policy returns to the watcher as a plan correction before code; add no new storage by assumption.

## Smallest implementation once those dependencies are settled

1. **Client, test first:** add `apps/server/src/cloud-email.ts` and `cloud-email.test.ts`; expose relay operations through `cloud-client.ts`. Reuse lease handling, `cloud-signed-request.ts`, `@waitron/contract`, and backup’s registration/test-environment/revocation/lease gates. Transport owns exact fields, response identity/state checks, bounded requests and refusal versus ambiguity.
2. **Account routing, test first:** change `account-mail.ts`, `mail-sender.ts`, `email-delivery.ts` and `boot.ts` only where needed to select relay for `account_action` and pass structured issued fields. Keep other mail owners on existing delivery. Distinguish explicit off from unreadable authority. Never fall back to SMTP, regenerate a token or mint another submission after ambiguous relay acceptance. Report Cloud queue admission separately from confirmed transport acceptance, using existing outcomes where their meanings agree.
3. **Availability and claims:** trace `EmailDelivery`/account-mail mode consumers in `management-api.ts`, `me-api.ts` and `email-inbox-api.ts` before changing a shared mode. Preserve generic public reset answers and capture rules. Update the EN/ES email guide twins and the existing A987 Cloud-delivery point in `docs/backlog.md` and `docs/backlog/box.md` only for delivered behaviour; retain booking/receipt limits.

## Tests and finish

`cloud-email.test.ts` owns signing, authority, invalid replies, refusal, deadline and lost reply. `cloud-client.test.ts` checks integration only. `email-delivery.test.ts` owns on/off/unconfigured/capture selection. `mail-sender.test.ts` owns settlement and agreed restart behaviour; `account-mail.test.ts` owns usable invitation/reset/code consumption, expiry and secret handling. Run affected mode-consumer tests only if changed. Reuse existing support and retain behavioural assertions; no repeated dependency failure grids in callers.

Observe each new behaviour fail before implementation, then run the changed files with `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts`. Live proof waits for TEST-CLOUD-AWS: deliver all three account classes to a controlled inbox, consume the links/code, switch off and verify SMTP, then verify a relay refusal and a continuing sale. Record pinned box/Cloud revisions; a local capture is not real delivery.

**Conditional size:** production +180–280 lines; tests/support +220–350; docs about +40. Re-estimate after contract/recovery settlement, before code. No booking producer, receipt PDF work, Cloud edits, SMS, production Cloud, UI redesign, fiscal/payment changes or new ledger/framework. Claude reviews this plan, then the watcher clears it; authorised finish-branch/land-branch follows focused checks, normal reviews/hook and current-head CI.
