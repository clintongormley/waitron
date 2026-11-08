# A1308 venue and box, PR vb2: the taxpayer row narrows, and credentials keep a history — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** The `taxpayer` row holds only the fiscal identity: its privacy contact moves into the
venue's settings document. A change of the legal name and every save or removal of a sealed
credential leave an entry in `activity_log`. The two credential purposes nothing uses are deleted.

**Architecture:** `readPrivacyContact`/`savePrivacyContact` keep their names and read and save the
`venue` settings document (slice 1b-i's `readSettings`/`saveSettings`) instead of two `taxpayer`
columns. `renameTaxpayer`, `putCredential` and `deleteCredential` each take the acting person and
write their activity entry themselves, in the caller's transaction, through slice 2's
`recordActivity`, so no caller can forget it.

**Tech Stack:** Drizzle on `node:sqlite`, Vitest, Lit (dashboard live-query names only).

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.1, §1.16,
§2.1 (`privacyNoticeUrl`, `privacyEmail`), §3 (the `taxpayer.legal_name_changed`,
`credentials.saved`/`credentials.removed` rows), §5 (write-path guard on `tenants`: 2 files);
README §3 (`activity_log`), §5 U11 ("activity_log scope").

**Lands:** the lane (rules §6): no value that reaches a sale, an invoice or AEAT changes. Two files in
`packages/fiscal-verifactu` change only to pass the installing person's id to `putCredential`
(`certificate-install.ts:237`, `provisioning-secret.ts:102`); the PR's first line after the reset
line says so.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. `taxpayer` loses `privacy_notice_url` and `privacy_email` (`packages/db/src/schema/taxpayer.ts`
   after vb1; today `tenants.ts:45-46`). The `venue` document (slice 5b's definition) gains
   `privacyNoticeUrl: string | null` and `privacyEmail: string | null`, both `null` in its defaults,
   both required keys in its `parse`, each checked by `privacyContactProblem`
   (`packages/shared/src/privacy-contact.ts`). The document's `version` does not change: every venue
   is reset (CLAUDE.md §3, no compatibility code before go-live). Slice 5b leaves these two fields to
   this PR ([5b](2026-11-08-a1308-5b-venue-document.md) :158).
2. `readPrivacyContact(tx)` returns the two fields from the `venue` document, and `null` when that
   document's revision is 0 (no venue yet — today's "no taxpayer row", which `withTaxpayer`,
   `apps/server/src/venue-settings-api.ts:156-159`, turns into `venue.not_found`).
   `savePrivacyContact(tx, changes, personId)` (callers: the Privacy card's save route, which passes
   the manager's id, and the configuration import, `packages/provisioning/src/configuration-transfer.ts:786`,
   which passes the importing person's id or `null`) reads the document and its revision in the same
   transaction, merges the given keys, and saves with that revision; with no venue it writes nothing
   and returns `null`; with no key given it returns the read. The Privacy card's request body keeps
   no revision (`PUT /management-api/venue-privacy`, `:318-326`): the read and the save share one
   transaction under the venue's write lock, so no other save can land between them.
3. The configuration export reads the privacy contact through `readPrivacyContact`
   (`packages/provisioning/src/configuration-transfer.ts:69-89` loses the two columns). The bundle's
   shape is unchanged (`privacyContact`, `:138`), so its format version does not change (rules §9).
4. Dashboard live queries that read the privacy page depend on `settings.venue`, not `taxpayer`:
   `getVenuePrivacy`, `getLocales`, `getGoogleConfig` (`apps/dashboard/src/api/live-queries.ts:520-527`).
5. `scripts/write-path-tables.json`: `taxpayer` → `taxpayer-name.ts` and `venue-apply.ts` only
   (appendix §5).
6. Activity kinds, added to slice 2's registry (`packages/db/src/activity-kinds.ts`):
   - `"taxpayer.legal_name_changed": { from: string; to: string }`, subject `"taxpayer"`, subject id
     `"1"`. Slice 2's registry rule 1 states this kind as its one exception
     ([2](2026-11-08-a1308-2-activity-log.md) :213-214); the kind's comment cites that rule and adds
     nothing contrary.
   - `"credentials.saved": { keyVersion: number }` and `"credentials.removed": { keyVersion: number }`,
     subject `"credential"`, subject id the purpose. Never the secret, never a field value.
7. `renameTaxpayer(tx, { expected, legalName, personId })` records `taxpayer.legal_name_changed`
   with `from: expected`, `to: legalName` when it renamed; the legal-name route passes the manager's
   `authorizedBy` (`venue-settings-api.ts:257-292`). Today `gated` (`:170-182`) calls
   `authorizeManager` and throws its answer away, so `gated` changes to hand
   `authorizeManager`'s `authorizedBy` to its callback as a second argument; the legal-name route and
   the Privacy card's save route (`:318-326`) use it.
8. `putCredential(tx, ring, { purpose, value, personId })` records `credentials.saved` with the new
   key version; `deleteCredential(tx, { purpose, personId })` records `credentials.removed` with the
   removed row's key version, and only when a row was removed. `rotateCredentials` (the CLI's
   re-seal) records nothing: no one replaced a secret. It calls `putCredential` today
   (`packages/credentials/src/store.ts:277`), so the sealing write moves into an unexported helper,
   `sealCredentialRowTx(tx, ring, purpose, value)`, which both `putCredential` (then records) and
   rotation (does not) call. Every caller passes the person whose request
   this is, else `null`:

   | Caller | `personId` |
   | --- | --- |
   | `apps/server/src/email-settings-api.ts:87, :97` | the route's `authorizedBy` |
   | `apps/server/src/payments-api.ts:750, :775` | the route's `authorizedBy` |
   | `apps/server/src/stream-api.ts:243, :261` | the route's `authorizedBy` |
   | `apps/server/src/archive-settings.ts:349` | its caller's person (the backup settings route's `authorizedBy`) |
   | `apps/server/src/first-fiscal-activation.ts:284` | the activating administrator's id if the function receives one, else `null` |
   | `apps/server/src/setup-api.ts:951`, `packages/provisioning/src/first-setup-command-deployment.ts:240` | `null` (first setup: no person has signed in) |
   | `packages/credentials/src/cli.ts:131, :169` | `null` (an operator at the box's command line) |
   | `packages/fiscal-verifactu/src/certificate-install.ts:237` | the installing person's id if its deps carry one, else `null` |
   | `packages/fiscal-verifactu/src/provisioning-secret.ts:102` | `null` |
   | `packages/credentials/src/store.ts:277` (`rotateCredentials`) | not a caller any more: it calls `sealCredentialRowTx` |

   "If the function receives one" means a value already in scope or in its deps; this PR adds no new
   parameter to those functions' callers.
9. `PURPOSES` loses `sync.mirror_token` and `membership.node_key`
   (`packages/credentials/src/purposes.ts:28-33`). The node signing key's own seal label stays in
   `packages/credentials/src/node-signing-key.ts:22` and `apps/server/src/node-identity.ts:6`, which
   never read `PURPOSES`.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Settings saves recorded in `activity_log` | not in A1308 ([1b-i](2026-11-08-a1308-1b-settings-table.md), "What it leaves out") |
| Non-secret fields leaving `venue_credentials` (SMTP `from`, Stripe's return addresses, bucket details) | [env4](2026-11-08-a1308-env4-unsealed-settings.md) |
| A screen that shows these entries | follow-up (README U11) |
| `incidents.acknowledged_by`'s key, `node_membership.term` | vb3 |

## Files

Modify:
- `packages/db/src/schema/taxpayer.ts`; slice 5b's venue document definition (the file that calls
  `defineSettingsDocument({ module: "venue", … })`; find it with
  `git grep -n 'module: "venue"' -- packages`).
- `packages/db/src/activity-kinds.ts` — three kinds.
- `packages/provisioning/src/privacy-contact.ts`, `taxpayer-name.ts`, `configuration-transfer.ts`
  (`:69-89`, `:786`); their database tests `privacy-contact.db.test.ts`, `taxpayer-name.db.test.ts`.
- `packages/credentials/src/store.ts:104-131, :196-203`, `purposes.ts`.
- The callers in item 8; `apps/server/src/venue-settings-api.ts`.
- `apps/dashboard/src/api/live-queries.ts:520-527`.
- `scripts/write-path-tables.json`, and the allowed-file list in `scripts/write-path-tables.test.ts`'s
  header.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` — the expected `taxpayer` table loses
  the two columns (`madridWithRenamedColumns`' sibling: filter them out as `:166-167` does for
  `parties.main_bill_id`), and the expected `venue` settings row gains `privacyNoticeUrl` and
  `privacyEmail` with the capture's values, in whatever form slice 5b's transform builds that row.
- Docs: `docs/developers/conventions-data.md` write-path section (`:918-953`: the privacy writer
  leaves the `taxpayer` list and writes the venue document); A980's privacy doc lines if any name the
  columns (`git grep -n "privacy_notice_url\|privacy_email" -- docs/developers docs/operations`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Privacy fields to the document, read/save, export, live names | ~90 | ~90 (re-pointed fixtures that wrote the columns; the no-venue and merge cases) |
| Legal-name entry, `gated` | ~25 | ~40 |
| Credential entries, callers, rotation's sealing helper | ~60 | ~80 |
| Dead purposes | ~5 | ~30 (sample rows re-pointed) |
| Guard, Madrid, docs | ~30 | — |
| **Total** | **~210** | **~240** |

About 450 counted lines; 2–3 hours.

## Finish line

1. `pnpm --filter @waitron/provisioning exec vitest run src/privacy-contact.test.ts src/privacy-contact.db.test.ts src/taxpayer-name.db.test.ts src/configuration-transfer.privacy-contact.test.ts src/configuration-transfer.security.test.ts`
2. `pnpm --filter @waitron/credentials exec vitest run`
3. `pnpm --filter @waitron/db exec vitest run src/activity-log.test.ts src/schema/activity-log.test.ts`
4. `pnpm --filter @waitron/server exec vitest run src/venue-settings-api.test.ts src/email-settings-api.test.ts src/payments-api.test.ts src/stream-api.route.test.ts src/invoice-customer-data-api.test.ts src/invoice-email.test.ts src/personal-data-export-api.test.ts src/configuration-transfer.test.ts src/configuration-import.test.ts src/node-identity.test.ts src/reserved-identity.test.ts src/standby-operation.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`
5. `pnpm --filter @waitron/composition exec vitest run src/credentials-backup-verification.test.ts`;
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-install.test.ts src/provisioning-secret.test.ts`
   (and the fiscal pair, unedited, prints a `Tests` line).
6. Root: `pnpm exec vitest run scripts/write-path-tables.test.ts scripts/live-subscriptions.test.ts scripts/schema-constraints.test.ts scripts/personal-log-params.test.ts`
7. `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/venue-privacy-panel.test.ts`
8. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
changed table taxpayer.columnOrder
missing table taxpayer.columns[privacy_notice_url]
missing table taxpayer.columns[privacy_email]
```

Under the two `change-feed` headers also:

```text
changed trigger waitron_change_taxpayer_update.when
```

(`old:`/`new:` follow each `changed` line: the column list without the two names; the update
trigger's comparison without their two terms.) Why: appendix §1.1 and §2.1 move the privacy contact
to the document; the change feed's update trigger compares every column. Made by simulation on
`a086eedfb7`'s built change-feed `venue.db` (the two columns dropped and the update trigger
rewritten, compared through the tool's `readSchema`/`compareSchemaLists`): these four lines.

## Assertions that change, by design (rules §4)

- `packages/composition/src/credentials-backup-verification.test.ts:94` names
  `"vault:sync.mirror_token"` among the declared secrets; it names `"vault:backup.archive"` (appendix
  §1.16 deletes the purpose).
- Activity: none — every new entry is a new assertion.

Re-pointed, assertion kept: the "the venue's vault holds no node key" checks
(`apps/server/src/reserved-identity.test.ts:80, :153`, `standby-operation.test.ts:334, :736, :844`)
read `select count(*) from venue_credentials where purpose = 'membership.node_key'` and expect 0,
since `tryGetCredential` no longer accepts the deleted purpose; the credentials package's sample rows
under `sync.mirror_token` (`packages/credentials/src/backup-verification.test.ts:80-208`) use
`backup.archive` with `{ "settings": "<the same sentinel text>" }`.

## Stop points (beyond rules §5)

1. A caller in item 8 has no person id in scope where the table says the route's `authorizedBy`.
2. Slice 5b's venue document cannot take the two fields without a version change it would enforce
   (for example a `parse` that refuses unknown keys on documents already saved by tests that build
   their own rows).
3. A test that saves the venue document concurrently with the Privacy card now gets
   `settings.out_of_date` where it got success: behaviour moved (rules §5.3).
4. The configuration import has no importing person's id in scope at `configuration-transfer.ts:786`:
   pass `null` and say so in the PR (no new parameter is threaded for it).

## Needs

vb1 (names). Outside: 1b-i (`readSettings`, `saveSettings`), 2 (`recordActivity`, the registry),
5b (the `venue` document). Within the area it is independent of vb3–vb9.

---

## Task 1: The privacy contact lives in the venue document

**Files:** `packages/db/src/schema/taxpayer.ts`; 5b's venue document file;
`packages/provisioning/src/privacy-contact.ts`, `configuration-transfer.ts`;
`apps/server/src/venue-settings-api.ts`; `apps/dashboard/src/api/live-queries.ts`;
`scripts/write-path-tables.json` and its test header; the Madrid test.

**Interfaces — Produces:** `readPrivacyContact(tx: Transaction): Promise<PrivacyContact | null>`
(unchanged signature); `savePrivacyContact(tx: Transaction, changes: Partial<PrivacyContact>, personId: string | null): Promise<PrivacyContact | null>`.

- [ ] **Step 1:** Run `pnpm protection-list list --out <A>` from `apps/server`.
- [ ] **Step 2: Write the failing tests** in `packages/provisioning/src/privacy-contact.db.test.ts`:
  "reads null before a venue exists"; "saves one field and keeps the other" (save
  `{ privacyEmail: "privacy@example.test" }` over `{ privacyNoticeUrl: "https://example.test/p" }`:
  both come back); "records the saving person on the document" (`readSettings` row's `updated_by`
  equals the id); "leaves the taxpayer row untouched" (`select * from taxpayer` has no privacy
  column — a schema read).
- [ ] **Step 3: Run** `pnpm --filter @waitron/provisioning exec vitest run src/privacy-contact.db.test.ts` — FAIL.
- [ ] **Step 4: Implement** items 1–5; rebuild core
  (`pnpm --filter @waitron/server migration-baseline rebuild --set core`).
- [ ] **Step 5: Run** Finish-line items 1, 4 (privacy suites), 6, 7 — PASS.
- [ ] **Step 6: Commit** `git commit -s -m "venue: the privacy contact moves from the taxpayer row to the venue document"`.

## Task 2: The legal name's history

**Files:** `packages/db/src/activity-kinds.ts`; `packages/provisioning/src/taxpayer-name.ts`;
`apps/server/src/venue-settings-api.ts`.

**Interfaces — Produces:** `renameTaxpayer(tx: Transaction, input: { readonly expected: string; readonly legalName: string; readonly personId: string | null }): Promise<{ renamed: boolean }>`.

- [ ] **Step 1: Write the failing tests.** `packages/provisioning/src/taxpayer-name.db.test.ts`: "records the old and new name
  with the person" — after a rename, `readActivityForSubject(tx, { kind: "taxpayer", id: "1" })`
  is one entry with `kind: "taxpayer.legal_name_changed"`, `data: { from: "Old SL", to: "New SL" }`,
  `personId` the id; "records nothing when the stored name was not the expected one".
  `apps/server/src/venue-settings-api.test.ts`: "the legal-name route records the signed-in
  manager".
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement** item 7.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "taxpayer: a legal-name change leaves an activity entry"`.

## Task 3: Credential saves and removals, and the dead purposes

**Files:** `packages/db/src/activity-kinds.ts`; `packages/credentials/src/store.ts`, `purposes.ts`;
the callers in item 8; the tests re-pointed under "Assertions that change".

**Interfaces — Produces:** `putCredential(tx: Transaction, ring: KeyRing, params: { purpose: Purpose; value: Record<string, unknown>; personId: string | null }): Promise<void>`;
unexported `sealCredentialRowTx(tx: Transaction, ring: KeyRing, purpose: Purpose, value: Record<string, unknown>): Promise<number>` (returns the key version written);
`deleteCredential(tx: Transaction, ref: CredentialRef & { personId: string | null }): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests** in `packages/credentials/src/store.test.ts`: "a save
  records the purpose and key version, never the value" (entry `subjectId: "email.smtp"`,
  `data: { keyVersion: 1 }`; `JSON.stringify(entry)` does not contain the sealed URL); "a removal
  records the removed row's key version"; "removing a purpose with no row records nothing";
  "rotation re-seals and records nothing" (a `rotateCredentials` run over a sealed row leaves
  `readActivityForSubject` empty for that purpose). `purposes.test.ts`: "the deleted purposes are not purposes"
  (`isPurpose("sync.mirror_token") === false`, same for `membership.node_key`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/credentials exec vitest run` — FAIL.
- [ ] **Step 3: Implement** items 8 and 9; update every caller.
- [ ] **Step 4: Run** Finish-line items 2, 4, 5 — PASS.
- [ ] **Step 5:** `pnpm protection-list list --out <B>`; `compare`; paste and mark the report.
- [ ] **Step 6: Commit** `git commit -s -m "credentials: saves and removals leave an activity entry; two dead purposes go"`.
