# A1308 environment, PR 4 of 8: settings that are not secret leave the credentials store — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The email sender address stops being sealed with the SMTP secret it sits beside. It moves
to a new `mail` settings document; the sealed SMTP credential keeps only the connection URL.
Stripe's two return addresses are not moved (owner, 2026-11-09; "What it leaves out").

**Architecture:** The credentials store (`tenant_credentials`, renamed `venue_credentials` by the
venue-and-box area; "sealed" means encrypted with the box's vault key) declares, per purpose, the
fields a payload must hold (`packages/credentials/src/purposes.ts`). One purpose loses its
non-secret field: `email.smtp` keeps `url` (an SMTP connection URL, which may carry a password) and
drops `from`. Each writer saves the secret part sealed and the sender in the `mail` document in the
same transaction; the reader puts the two back together, so the HTTP answers and the dashboard do
not change. `payments.stripe` is not touched.

**Tech Stack:** TypeScript, drizzle-orm on `node:sqlite`, Hono, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U7 ("Settings that are sealed
today but are not secret … move to their module's settings document; only the secret values stay
sealed"); [`tables-venuebox.md`](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.16;
[3a-ii](2026-11-08-a1308-3a-ii-mail-queue.md) "What it leaves out" (the SMTP sender's non-secret
settings come here); [3a-i](2026-11-08-a1308-3a-i-smtp-transport.md) and
[3a-iii](2026-11-08-a1308-3a-iii-account-mail.md) for where the sender is read. Rules: [the slice rules](2026-11-08-a1308-slice-rules.md). Part overview:
[env1](2026-11-08-a1308-env1-tuning-constants.md).

**Needs:** 1b-i (the API and
`liveResourceTypes(sources, settingsModules)`); 3a-i, 3a-ii and 3a-iii (the one SMTP transport and mail
sender; follow their `from` reader wherever it now lives); the venue-and-box area slice (the `venue_credentials` rename).

**Owner lands:** no. Nothing here reaches a sale, an invoice number, a fiscal record, the fiscal
identity, AEAT sending or a hashed value. `apps/server/src/first-fiscal-activation.ts:284` seals the
SMTP settings in the first fiscal activation's transaction; this plan changes only where the sender
address is written there, nothing fiscal in that transaction. Read, not run.

**No venue reset:** no starting migration changes. A box that saved SMTP before this lands
holds a sealed payload with the old fields, which the narrowed purpose now refuses to read
(`credentials.invalid_payload`, `purposes.ts:66-75`); before go-live that box is re-set up or the
owner re-enters the settings (CLAUDE.md §3, "No backwards-compatibility or data-migration code until
Waitron is in production"). The pull request says so in its description.

## Global Constraints

- One transaction for the sealed part and the document (CLAUDE.md §3, "Multi-table writes share ONE
  transaction").
- The email HTTP answers and request bodies keep their shapes, so the dashboard, the
  setup wizard and Waitron Cloud need no change.
- The sender save names no revision, as today: the email screen never carried one. Each route reads the document and saves from that read inside its own transaction, so no save
  can clash with itself; two people saving at once end with the later save, which is today's
  behaviour for the sealed payload. Stated here as a decision.
- No secret enters a settings document, a log line or an error's params (CLAUDE.md §3).

## Review Focus

1. Removing SMTP must also clear the sender address, or a later re-entry of only a URL would send as
   a stale sender. DELETE saves `from: null` in the same transaction.
2. A sealed SMTP payload with the old `{ url, from }` fields must fail the same way as any other
   wrong shape, not be half-read.
3. The setup wizard and the first fiscal activation write SMTP too (`setup-api.ts:951`,
   `first-fiscal-activation.ts:284`); both must split the payload, or the venue's first mail has no
   sender.
4. Nothing about Stripe changes: `packages/payments-stripe`, `packages/payments/src/card-provider.ts`,
   `apps/server/src/payments-api.ts` and `apps/server/src/webhook.ts` are not in the diff.

---

## What it builds

1. `email.smtp` purpose = `["url"]`.
2. `MAIL_SETTINGS` (module `mail`, version 1, transfers `false`, `{ from: string | null }`), owned by
   the server; the email routes, the setup wizard's SMTP step and the first fiscal activation save the
   sender there; `readSavedSmtp` joins the two.
3. The server admits `settings.mail` as a live type.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `fiscal.aeat`'s `certKind` | env8 (the owner lands it: the AEAT endpoint depends on it) |
| `backup.stream` and `backup.archive` | env6 |
| Google's client id | A646 slice 5 |
| Stripe's return addresses (`successUrl`, `cancelUrl`): they stay sealed in `payments.stripe`, where and as they are today. No production code calls `createCheckoutSession`, their only reader (`git grep -n "createCheckoutSession\|\.initiate(" -- apps packages ':!*.test.ts'` finds `packages/payments-stripe/src/hosted-provider.ts:30` and nothing that calls `StripeHostedProvider.initiate`; read, not run) | **Owner, 2026-11-09:** "Leave this for when we test Stripe." Deferred to the Stripe work: one line in `docs/backlog/payments.md`'s "Bundle: Stripe adapter upkeep" |

## Interfaces

```ts
// apps/server/src/mail-settings.ts (new; beside email-delivery.ts wherever batch 2 put it)
export interface MailDocument { from: string | null }
export const MAIL_SETTINGS: SettingsDocument<MailDocument>; // module "mail", version 1, transfers false
export const SERVER_SETTINGS_KEYS: readonly string[];      // ["mail"]; env6 adds "backup"

// apps/server/src/email-delivery.ts — readSavedSmtp keeps its signature and answer
export function readSavedSmtp(tx: Transaction, ring: KeyRing): Promise<{ url: string; from: string } | null>;
// null when no email.smtp credential is sealed; throws server.credential_unusable
// { purpose: "email.smtp", field: "from" } when the credential exists but the document's from is null
```

`boot.ts` passes `[...moduleSettingsKeys, ...SERVER_SETTINGS_KEYS]` as `liveResourceTypes`' second
argument (1b-i). `MAIL_SETTINGS.parse` refuses a `from` that is not a string or null, naming `from`;
it does not check the address (that stays `venueSmtpFrom`'s job, `email-sender-name.ts:6-23`).

## Files

- Create: `apps/server/src/mail-settings.ts`, `mail-settings.test.ts`.
- Modify: `packages/credentials/src/purposes.ts:11-14` (the `email.smtp` entry only) and
  `purposes.test.ts`; `apps/server/src/email-delivery.ts:55-66`; `apps/server/src/email-settings-api.ts:78-100`;
  `apps/server/src/setup-api.ts:899,951`; `apps/server/src/first-fiscal-activation.ts:95,284`;
  `apps/server/src/boot.ts` (the `liveResourceTypes` call); `apps/dashboard/src/api/live-queries.ts`
  (the email settings query depends on `settings.mail`).
- Tests whose set-up seals the `{ url, from }` SMTP payload:
  `git grep -l -E "purpose: \"email.smtp\"" -- '*.test.ts' 'apps/server/src/testing/*.ts' 'packages/*/src/testing/*.ts'`
  (seal the narrowed payload and save the document; assertions unchanged).
- Docs: `apps/server/src/guide/en/email.md` and its Spanish twin only if they describe where the sender is
  kept (read them; they describe the screen, which does not change); `docs/developers/conventions-data.md`'s
  credentials section if it lists the purposes' fields.

## Size

Counted, hand-written: about 100 lines of code (mail document and its writers and reader 80, live
type 20) and about 160 lines of tests (mail 120, re-pointed fixtures 40). **About 260 counted.**
About 1½ hours. (Stripe's part, about 70 lines of code and 140 of tests, is not built: owner,
2026-11-09.)

## Finish line

1. `pnpm --filter @waitron/credentials exec vitest run src/purposes.test.ts`;
   `pnpm --filter @waitron/server exec vitest run src/mail-settings.test.ts src/email-settings-api.test.ts src/email-delivery.test.ts src/boot.setup-routes.test.ts src/first-setup-finish.route.test.ts src/first-fiscal-setup.e2e.test.ts`
   (use the base's file names where a suite was split) each print a `Tests` count with no failure.
2. `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts` passes.
3. `git diff --stat <base> -- packages/payments-stripe packages/payments/src/card-provider.ts apps/server/src/payments-api.ts apps/server/src/webhook.ts`
   prints nothing (Stripe is left as it is), and `PURPOSES["payments.stripe"]` still lists its four
   fields (`purposes.test.ts` unchanged for it).

## Expected protection-list difference

EQUAL. Settings rows and sealed payloads are data. Any line is a stop.

## Stop points (beyond rules §5)

1. 3a moved the reading of `from` somewhere `readSavedSmtp` no longer reaches, and two readers now
   disagree: follow 3a's reader; if there are two, stop and ask which one stays.
2. A backup-verification suite fails because it seals or expects the old payload shape and its
   assertion would have to change (rules §5.3).

---

### Task 1: the sender address moves to the `mail` document

**Files:** `mail-settings.ts` and test, `purposes.ts`, `email-delivery.ts`, `email-settings-api.ts`,
`setup-api.ts`, `first-fiscal-activation.ts`, `boot.ts`, `live-queries.ts`, tests.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Failing cases.**
  - `mail-settings.test.ts` (on `useVenueDb`): defaults `{ from: null }` at revision 0;
    `parse({ from: 3 })` → `{ ok: false, field: "from" }`; `transfers === false`.
  - `email-delivery.test.ts`: `"joins the sealed URL and the saved sender"` — seal `{ url }`, save
    `{ from: "Bar <bar@example.test>" }` → `readSavedSmtp` answers both; `"no credential, no SMTP"` →
    null even with a `from` saved; `"a credential with no sender is unusable"` → throws
    `server.credential_unusable` `{ purpose: "email.smtp", field: "from" }` (so
    `resolveEmailDelivery`'s existing catch, `:40-47`, still answers `unconfigured`).
  - `email-settings-api.test.ts`: PUT seals only `url` and saves `from`; GET answers the same body as
    before; DELETE removes the credential and saves `from: null`.
  - `boot.setup-routes.test.ts` (setup wizard) and `first-fiscal-setup.e2e.test.ts` (first fiscal activation): after the SMTP step, the credential has
    only `url` and the document holds `from`.
  - `purposes.test.ts`: `PURPOSES["email.smtp"]` equals `["url"]`.
- [ ] **Step 2: Run; fail. Step 3: Implement.** Each writer keeps `parseEmailSettings` (it still
  returns `{ url, from }`) and splits the result: `putCredential(tx, ring, { purpose: "email.smtp", value: { url } })`
  and `saveSettings(tx, MAIL_SETTINGS, { doc: { from }, expectedRevision: <read in tx>, personId })`
  where `personId` is the signed-in person the route already authorised, or null for setup and
  activation. Add `SERVER_SETTINGS_KEYS` to the `liveResourceTypes` call in `boot.ts`; the dashboard's
  email settings query lists `settings.mail` as a dependency.
- [ ] **Step 4: Run** finish lines 1–2; pass.
- [ ] **Step 5: Docs** per **Files**. **Step 6: Protection list:** nothing. **Step 7: Commit:**
  `git commit -s -m "The email sender address moves to the mail document (A1308 env4)"`, then
  `/finish-branch`.

## Waitron Cloud

Nothing to change: Cloud's repository reads no `email.smtp` or `payments.stripe` payload and calls
no email or payment-provider route (grep at `d4451d227`).
