# A1018 Slice 8: emergency handover page

**Authority.** Lane J `queue.md`: “Simple controlled and emergency handover, with Cloud only a placement — BUILD”; owner 2026-11-01: “Yes, build it”. Watcher `questions.md`, 2026-11-12 02:15: “Write the plan for A1018 Slice 8 meanwhile (docs only, no third branch of code), Claude read, PLAN FOR APPROVAL.” Proposed by Codex; awaits Claude review and watcher clearance.

**Basis.** [Design](../specs/2026-10-23-a1018-simple-handover-design.md) §§4/7/9; [original Slice 8](2026-11-02-a1018-handover-build.md#slice-8--emergency-declaration-page-and-guide); [Slice 7](2026-11-11-a1018-7-emergency-server.md).
**Finish line.** You can open a simulated joined spare's `/handover/emergency`, inspect its copy, declare shutdown, compare clocks and activate. Reload or another device resumes the same declaration; lost answers never start another operation.
**Reuse/bounds.** Extend `SetupHandoverScreen`/`SetupApi`; reuse `handover-status-api.ts`, `checkEmergencyCopy`, signed declaration replay, preparation/activation and `ModulePromotionEntry`. No new store/table, silence input, transport policy, allocation protocol or withdrawal. Physical-box qualification, Cloud, backup picker/Slice 14, A1342 implementation and unrelated fixes stay outside.

**Decisions, quoted from Lane J `questions.md`, 2026-11-11.**

- Owner 2026-11-11 10:14, “One-way, warned”: “Keep it one-way; the screen says plainly before declaring that it cannot be undone.” No withdraw step.
- Watcher 2026-11-11 10:45: “Apply the same rule to a literal IP: it counts as 'unreachable' only if this spare has itself completed a pinned handshake at that address and it is the last such address.”
- Lane J 11:07, agreeing Lane A 10:41: “3b-5a carries the restart-persistent last address reached through a pinned handshake, written only when it changes.” Reuse `sourceSilent`; **cannot land before that persistence is on main**. Transport remains Lane A’s #2779 scope.
- The 11:22 seam read covers `cf70678fcf`/`4a0fe0cc76`: native `CheckedAddressUnreached` alone admits unreachable. This plan changes no transport.

**Current gaps.** `handover-page-mount.ts` and setup `main.ts` treat `emergency` as an operation id. No preview exists. Declare replay already rechecks the copy after restart (`handover-emergency-api.ts:232`).

**One usable slice; one PR within 3 hours, including review/fixes.**

1. **Server.** Modify `apps/server/src/handover-emergency-api.ts`, `handover-page-mount.ts`, `read-only-exemptions.ts`.
   Add no-store `POST /api/node/handover/emergency/preview` with `{signIn}`, sharing declare's existing HTTPS/own-origin, `node.promote`, password/TOTP and throttle checks. Authenticate before exposing the free-text reason.
   Project only source/destination ids, source controlled-page link, checked `lastCopy`, and nullable stored destination `emergency_declared` resume `{operationId, statements, reason, locale, declaredAtMs}`. Resume returns recorded copy/time; replay checks today’s copy. Exclude actor, taxpayer, chart, keys and full envelope; preview neither declares nor restores activation readiness.
   Serve literal emergency first, mirror-only; retain slash/assets and operation pages after activation. Reuse boot mounts. The spare has no dashboard; use its direct address.
2. **Browser.** Modify `apps/setup/src/main.ts`, `api/client.ts`, `screens/handover-screen.ts`, `i18n/strings/handover.ts`.
   Dispatch emergency first; add typed preview/declare calls. After sign-in show checked copy and latest *dated activity held*, including null. Show EN/ES shutdown, network-split, missing-tail and irreversible-declaration warnings before recording.
   Require three statements, nonblank reason ≤500 characters, email/password and code when required; say passkeys unavailable. Use shared controls/tokens, inline/bottom errors and input-based action gating; refusals permit retry.
   Keep one operation id and exact statements/reason/locale across uncertain retries. Resume displays saved reason/time read-only, repeats that declaration with fresh sign-in, then creates the existing promotion component bound to its event/source/target. Emergency does not require controlled-only `copyPlaced`.
   Preparation/clock success enables activation through `readOperation()`. Clock refusal offers Check again; lost declaration answers retry identical inputs; lost activation answers read status first. Use `/handover/:operationId` after declaration and existing restart recovery. Clear secrets/selections on completion, account change/disconnect; separate read/action failures.
   Reachable main offers Check again and its own `/manage/servers` link, never the spare's dashboard. Offer repair/retry for trust/address failure and another administrator sign-in for permission refusal. Damaged/mismatched copy stops activation; no invented backup link.
3. **Guides.** Update `apps/server/src/guide/en/servers.md` and `es/servers.md`, shared `{#emergency}`/`{#old-box-returns}` anchors: direct address, shutdown, one-way declaration, retry, retention. Both warnings and guides follow current A1342 invoice/payment/refund return and pending-refund wording; no fiscal-only claim or promise of replayed orders/stock/drawer effects.
   Update A1018 in both `docs/backlog.md` and `docs/backlog/replication-cloud.md`, retaining open qualification/slices and correcting fiscal-only wording. Add a dated superseding pointer beside original Slice 8 in `docs/superpowers/plans/2026-11-02-a1018-handover-build.md`.

**Behavioural test ownership (paths relative to the named app's `src/`).**

- Server: new `handover-emergency-preview.test.ts`, “requires declaration sign-in before exposing resume”, “projects only copy/replay inputs without declaring”, “restart returns original declaration inputs”. Reuse `testing/handover-placed-copy.ts`; existing declare tests retain replay/copy/peer ownership.
- Extend server `handover-page-mount.test.ts`, “literal emergency is mirror-only”; `boot.handover-destination.test.ts`, “real spare boot serves emergency HTML/assets and protected preview”; `read-only-exemptions.test.ts`, exact protected exemption. Preserve primary/unknown-operation controls.
- Setup: new `screens/handover-screen.emergency.test.ts`, “warns one-way before declare in EN/ES”, “requires all statements and reason 1–500”, “lost declaration answer retries identical inputs”, “second device replays before preparation”, “real SetupApi sequences declaration, module clocks and activation”, “refusals recover sign-in/status on the same operation”. Assert requests/native controls.
- New setup `main.handover.test.ts`, “literal emergency dispatches without an emergency operation-id read”. Extend `screens/handover-screen.a11y.test.ts` across declaration/resume/refusal/clock states, both themes at 390 px. Keep controlled assertions/guide guards. No new harness.

**TDD during build.** Observe each named test fail, implement minimally, then rerun to printed passing counts. Run changed files and controlled regressions:

```sh
pnpm --filter @waitron/server exec vitest run src/handover-emergency-preview.test.ts src/handover-emergency-declare.test.ts src/handover-page-mount.test.ts src/boot.handover-destination.test.ts src/read-only-exemptions.test.ts src/guide-content.test.ts
pnpm --filter @waitron/setup exec vitest run src/main.handover.test.ts src/screens/handover-screen.emergency.test.ts src/screens/handover-screen.test.ts src/screens/handover-screen.activate.test.ts src/screens/handover-screen.a11y.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

Inspect EN/ES light/dark at 390 px and desktop; screenshots stay outside git. Normal hook/current-head scoped CI; no whole-package local suite. Use finish-branch after watcher clearance/build; planning runs no tests.

**Added/removed estimate.** Production +320/−40; tests +390/−10; support +0/−0; docs +120/−20; generated 0. Total 900 changed lines; before exceeding 1,350 (1.5×), stop for the watcher's outside opinion, explaining real venue events behind growth. At 3 hours report the clean stopping point; no unusable route-only split.
