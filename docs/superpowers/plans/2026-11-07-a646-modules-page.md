# A646 Modules page implementation plan

> Execute inline, one green slice per PR, using `superpowers:executing-plans`. Read TDD before code. Before build, obtain Claude's completed plan review through `~/workspace/tools/claude-seat.sh review-branch`.

**Goal:** Configure optional integrations without interrupting service or losing administrative access.

**Architecture:** Descriptor-owned catalogue, durable applied revisions and leased service generations. Configure saves settings; a separate confirmation changes admission. Unsupported adapters stay visible and refuse changes.

**Stack:** TypeScript, Hono, Drizzle/node:sqlite, sealed credentials, Lit/shared UI, Vitest/Chromium.

**Spec:** [Agreed design](../specs/2026-10-16-a646-modules-page-design.md).

## Authority and limits

Supplied outside-checkout evidence: Lane K queue copied from F, **2026-11-07 21:19**, records WATCHER **2026-11-01 ~10:45**, “A764 landed #1818; write docs-only PLAN now; build still follows A739.” It records OWNER **2026-10-17 ~00:15**, “design agreed”, protecting every active administrator: actor fresh non-Google proof, others supported recorded enrollment. These supersede the spec's pending wording. OWNER **2026-11-06 23:03**, A1384 export question, requires “module ON and EMPTY” on a new box loading an export made with that module Off.

Build remains open and gated on A739. Reset development venues; add no legacy conversion or automatic secret import. No fiscal writer/hash/alta/registerSif/restoreFiscal changes, regime switching, election protocol or live migrations. Keep existing fiscal guard tests unedited; slice 1 may only extend trigger protection. Stop for explicit review if it needs broader protected changes.

## Execution and review focus

For **each checkbox**: write named behavioral cases, run its command and observe the intended assertion failure, implement minimally, then rerun with a passing Tests count. Preserve assertions; use `useVenueDb`. Commands are future checks. Qualify critical guards by deletion in a disposable checkout, with permitted controls. Commit with `git commit -s`; use the normal hook and required current-head CI coverage, no full local suite.

Review particularly: missing retained tables (1), omitted module exports (3), stalled leases/crashes (4), racing administrator changes (6), and historical payment debt (7).

Source read at `a679818e98`; no runtime verification. Paths exist unless marked **new**. Host filenames mean `apps/server/src/`; package siblings retain their named directory.

## Eight slices

- [ ] **1. Repair retained protection first.** Existing: `apps/server/src/boot.ts`, `append-only-watch.ts`, `node-entry.ts`, `restore.ts`, `restore-stream.ts`; `packages/migrations/src/apply.ts`; `packages/store/src/append-only.ts`; `packages/provisioning/src/schema-ahead.ts`. Add **new** `packages/migrations/src/retained-protection.ts` and `apps/server/src/retained-protection.test.ts`.

  Separate selected migrations from all-composed retained protection. Before repair writes, under venue ownership, check environment and all-manifest history: hashes, prefix order/holes, ownership and format. Derive versioned expected tables from shipped SQL/snapshots; distinguish never-installed/future tables from missing required tables. Allow only recognized SQLite/journal/Litestream objects; preserve and refuse unknowns. Inspect altered triggers before writes; repair missing pairs, including new markers on dormant schemas, with the existing warning. Migrate selected sets only, retaining protection if a later set fails; re-inventory before duties. Watch expected identities and serving `recursive_triggers`; disabling never shrinks expectations. Runtime faults refuse trading without live repair.

  Cases: populated workforce/payment/fiscal declarations reject actual mutations; mutable control succeeds; altered/missing triggers, missing dependency/table, unknown/ahead history, unchanged dormant journal, later migration failure, table disappearance and pragma Off discriminate correctly. Use the current eight-set history, not pre-squash fixtures.

  Run `pnpm --filter @waitron/server exec vitest run src/retained-protection.test.ts src/append-only-watch.test.ts`; also `pnpm exec vitest run scripts/append-only-triggers.test.ts`. Because this slice touches fiscal table protection, run the unedited suites with `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.

- [ ] **2. Descriptor catalogue, read-only.** Extend `packages/module/src/module.ts`, `config.ts`, `packages/payments/src/card-provider.ts`, `packages/dashboard-kit/src/contract.ts`, and composition/browser registries. Add **new** `packages/module/src/module-catalogue.ts` and `.test.ts`.

  Planned catalogue contract: typed module/provider entries with tier, category, settings/readiness, default-enabled metadata, runtime capability and effective dependents. Composition alone assembles server modules; browser panels use `packages/dashboard-modules/src/`. Derive providers from that assembly. Current `packages/composition/src/modules.ts` makes Identity/Credentials mandatory and has no separate Scheduler descriptor. Keep every optional entry visible, including unsupported/no-settings entries; required/provision-only entries are separately readable, selected regime labelled **Chosen during setup**. Test inventory/browser parity, closure, essential host consumers, no cascade, incomplete adapters refusing, and independent state/category filters.

  Run `pnpm --filter @waitron/module exec vitest run src/module-catalogue.test.ts`; `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.

- [ ] **3. Durable state and one resolver.** Add **new** `packages/db/src/schema/module-control.ts`, `apps/server/src/module-control.ts` and `.test.ts`. Core owns control state; classify/generate migrations accordingly. Credentials owns sealed staging, outside control JSON. Planned `AppliedModules` carries revision, module states, provider admission and credential references; `ModuleChange` carries operation ID, expected revision, actor, phase and bounded refusal. Permit one pending operation; identical operation retries are idempotent, stale revisions/mismatched retries conflict.

  Route `module-config.ts`, provisioning handoff (`provision.ts`, `module-operation-host.ts`), boot/session responses, `mirror-bundle.ts`, `handover-manifest.ts`, restore and `configuration-export-api.ts` through this resolver. Revision zero preserves provisioning's pinned selection; thereafter database state wins and conflicting files are diagnosed. Mirrors read only. Restore reconstructs applied state and interrupts pending intentions. In `packages/provisioning/src/configuration-transfer.ts`, add **new** `configuration-transfer.optional.test.ts`: Off-export/On-empty destination through real import/setup, ordinary round-trip and invalid-module controls. Exclude control state/intentions, credentials, Google links/flows; imported metadata cannot enable Google.

  Run `pnpm --filter @waitron/server exec vitest run src/module-control.test.ts`; `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.optional.test.ts src/first-setup-command-import.test.ts`.

- [ ] **4. Runtime generation seam, no newly switchable product.** Add **new** `apps/server/src/module-runtime.ts` and `.test.ts`; wire boot, `live-api.ts`, `live-resources.ts` and `apps/dashboard/src/api/live-queries.ts`.

  Planned adapter contract: prepare isolated generation, admission leases, debt/readiness, cleanup and restart. Dispatch through a fixed outer/replaceable child router. Freeze settings/client before work; retain leases through network/final writes. Recheck authority/revision/dependencies/debt/access after preparation and transactionally at publication; network stays outside transactions. Barrier affects only involved work. After five seconds, refuse without cancellation, release barrier and retain old state; explicit retry only. Atomically promote sealed settings/applied revision, replace pointer without an admission gap, then notify once and clean up. Before-commit crash keeps old revision/Interrupted; after-commit crash reconstructs or explicitly refuses. Absent/stale schema refuses, never migrates while trading. Tests hold requests across Save/Disable, prove unrelated cash/sends continue, rollback/cleanup, restart and subscription reconnect. Navigation, permissions, settings, floor hooks, translations and alerts share the snapshot; keep permission declarations/resource names registered, feeds only on existing tables.

  Run `pnpm --filter @waitron/server exec vitest run src/module-runtime.test.ts src/live-api.test.ts`.

- [ ] **5. Inert Google vault boundary.** Add **new** `packages/identity-google/src/module.ts`, `settings.ts`; no owned tables move. Extend `packages/credentials/src/purposes.ts`, staging/store and composition with explicit **default-off** `identity-google`, requiring identity/credentials. Leave current environment login operational until slice 8.

  Test sealed ID+secret, explicit keep/replace/clear (no mask/empty-string sentinel), metadata-only GET with derived callback URL, logs/transfer exclusion, rotation/wrong/missing keys and authorized recovery with existing installation keyring (`state-secrets.ts`). Add **new** `apps/server/src/google-module.test.ts`: use real `google-oidc.ts` token exchange with controlled HTTP/signed tokens; cover cookie/state/nonce/PKCE/replay, revision-bound ten-minute flows/callback leases and restore invalidation. Save while disabled stays disabled. No persisted access/refresh tokens or replacement key on unreadability.

  Run `pnpm --filter @waitron/server exec vitest run src/google-module.test.ts src/google-oidc.test.ts`.

- [ ] **6. All-administrator proof and Google adapter.** Add **new** `packages/identity/src/module-change-proof.ts`, `.test.ts`; integrate `profile.ts`, `passkey.ts`, `staff.ts`, `account-action.ts` and Google adapter.

  For disable/removal/client-identity change, test fresh password plus required TOTP or origin/RP-bound user-verified passkey; bind proof to actor/operation/revision, rejecting expiry/replay/wrong purpose. Session/PIN/recovery promise is insufficient. Elena's proof cannot disable while Pablo lacks supported enrollment; his enrollment permits retry without possession proof. Serialize publication against role/status/factor/reset/admin-admission races, preserving every active admin's supported alternative while Google is Off and at least one admin. Refuse sole Google-only actor and active flows/callbacks; retain sessions, factors and links. Include permitted controls.

  Run `pnpm --filter @waitron/identity exec vitest run src/module-change-proof.test.ts src/profile.test.ts src/passkey.concurrency.test.ts src/account-action.concurrency.test.ts`.

- [ ] **7. Provider admission and retained services.** Extend `payments-api.ts`, `card-provider-pool.ts`, `bill-refunds.ts`, `bill-payments-loop.ts`, `pending-card-recovery.ts` and owning Stripe/SumUp seats. Add **new** `apps/server/src/provider-admission.test.ts`.

  Reuse A739/A764/A737 states. Off blocks new collections only; retain credentials, historical-provider refunds/checks, webhooks, reconciliation and incidents. Serialize collections, readers/assignments/pairing, sweeps, refunds and manual resolution with final publication checks. Any attempting/unknown/pending work refuses; timeout never means uncharged. Freeze actual clients by credential revision; require same account/environment for replacement, otherwise refuse while history needs it. Legacy connect/disconnect cannot bypass guards. Test real sealed seat/HTTP-SDK boundary with 401/403/409, lazy-cache rotation, concurrent unknown/refund/check, restart debt and refund after Off. Add no financial transitions.

  Run `pnpm --filter @waitron/server exec vitest run src/provider-admission.test.ts src/bill-refunds.card.test.ts`; `pnpm --filter @waitron/payments-stripe exec vitest run src/provider-unknown-http.test.ts`.

- [ ] **8. Catalogue/modal/link/profile cutover.** Add **new** `apps/server/src/modules-api.ts`, `.test.ts`, `apps/dashboard/src/screens/modules-screen.ts`, `.test.ts`, `.unsaved.test.ts`. Wire existing `management-api.ts`, `config.ts`, dashboard shell/navigation/API, payments/profile/login screens, contributed panels and EN/ES guides with shared heading IDs.

  Require `modules.manage`, initially granted only to administrators; check the privilege, not the role name. Provider changes require `payments.manage` and remain available in the restricted provider view without `modules.manage`. Managers get only server-filtered provider views; refuse staff/expired/mirror writes before secrets/network and before commit. Enabled default; Add selects Disabled preserving category; `/manage/modules/view/card-providers/state/all` and old setup redirects override remembered filters. Test all combinations, pinned `actions` kebabs, persistent specific red refusals/recovery, centred modal, no toggles, no-settings Close, separate state confirmation/fresh checks. Use draftScopeFor/saveActionState, required fields, retryable refusals, dirty/live/stale/Back/Escape/Enter cases and successful-save/failed-refresh separation. Cut environment Google precedence only now, with explicit sealed re-entry; refuse unsafe cutover. Profile uses applied state; public methods use passive venue capabilities, unreadability offers repair, unavailable Remember falls back without prompting passkeys. Keep readers/payment recovery on Card payments. Inspect EN/ES, 390/1280px, both themes, focus/axe.

  Run `pnpm --filter @waitron/server exec vitest run src/modules-api.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run src/screens/modules-screen.test.ts src/screens/modules-screen.unsaved.test.ts src/screens/profile-screen.test.ts`.

No owner decision remains open. Unqualified adapters/account evidence mean visible refusal.
