# Node HTTPS refusal implementation plan

**Authority:** NODE-HTTPS-REFUSAL in `/Users/clintongormley/waitron-campaign-k/queue.md`; ask: “The encrypted-connection check is copied across several routes, and `promote-api.ts` still answers plain-HTTP or cross-site requests with `authorization.not_permitted`.” This is queue authority, not owner approval of this design. Separate Sol-high draft checked by the driver, including existing path checks. Claude review, then watcher clearance, precede implementation; material departures return to the watcher.

**Finish line:** one socket predicate serves every listed duplicate; node-operation transport refusals answer HTTP 403 with `node.operation_page_required`, empty params, and actionable English/Spanish wording. Genuine permission refusals remain `authorization.not_permitted`. One PR; no new flow, record, framework or HTTP security mechanism.

Paths below use **S** = `apps/server/src/`, **D** = `apps/dashboard/src/`, **U** = `apps/setup/src/`, **F** = `packages/fiscal-verifactu/src/`; brace lists name individual files.

## 1. Share the socket predicate

- [ ] **RED — “recognises only an encrypted TLSSocket”:** create `S/encrypted-socket.test.ts`, importing the absent `isEncryptedSocket(socket: unknown): boolean`. Own the socket matrix here: missing/null, ordinary socket, forged encrypted object, real TLS socket, and TLS socket with encryption false. Observe the expected missing-export failure before implementation.
- [ ] **GREEN:** add `S/encrypted-socket.ts`, preserving `instanceof TLSSocket && socket.encrypted`. Replace only socket comparisons in `S/{node-operation-https,box-host-api,backup-recovery-pack-api,recovery-start-again,setup-first-fiscal-api,setup-recovery-preparation-api}.ts`. Keep extraction in callers and `isSecure`; reuse `sentFromThisOrigin` unchanged. Run both `src/encrypted-socket.test.ts` and `src/node-operation-https.test.ts` through `pnpm --filter @waitron/server exec vitest run`.

Reuse existing file-local request fixtures, `S/testing/two-box-takeover.ts:boxRequest`, `S/testing/tls-fixture.ts`, and `apps/server/test/first-fiscal.ts` where applicable; no new test-support helper. Preserve recovery/setup codes, box-join reasons, body-read ordering, content-type and CSRF checks. In particular, recovery's `isSecure` remains socket-only.

## 2. Give node operations the truthful answer

- [ ] **RED — “requires this box’s encrypted page”:** strengthen `S/node-operation-https.test.ts` to assert the complete new 403 envelope; observe the old permission code. Retain own-page positive/negative controls, absent-header admission and forwarded-header rejection. Routes own refusal envelope, no side effects, genuine permission refusal and positive control, without repeating the exhaustive socket matrix.
- [ ] **GREEN:** declare the code in `S/errors.ts`; change the guard and add status entries in `S/{promote-api,handover-emergency-api,handover-activation,handover-preparation,handover-source-start-api}.ts` and `F/conflict-recovery-routes.ts`. Keep existing permission entries and gate placement, including promotion’s conditional path. `S/live-module-operation.ts` already delegates the gate; test that actual bridge in `S/live-module-operation.test.ts`.

Run route suites `S/{promote-api,handover-emergency-declare,handover-emergency-followed,handover-activation,handover-preparation,handover-source-start-api}.test.ts` and `F/conflict-recovery-routes.test.ts`. Emergency assertions cover each gated endpoint, including upload and passkey challenge; the module route must map the actual bridge refusal to 403, before parsing/admission.

## 3. Carry the answer through existing screens

The trace reaches dashboard API → `D/screens/servers-screen.ts` → `D/i18n/codes.ts`; setup API → `U/screens/handover-screen.ts` (permission wording and held-sign-in retry classification) → promotion entry’s `F/setup/recovery-hour.ts:refusalMessage`; module bridge → `F/dashboard/conflict-recovery.ts` (old permission-to-transport mapping). `S/carry-on.ts` catches transport as a boolean before sign-in; its later permission catch remains genuine. Recovery surface/administrator consume socket-only `isSecure`.

- [ ] **RED — “transport refusal offers HTTPS, not sign-in”:** add EN/ES assertions in `D/screens/servers-screen.handover.test.ts`, `U/screens/{handover-screen.emergency,handover-screen.activate}.test.ts`, `F/setup/recovery-hour.browser.test.ts`, and `F/dashboard/conflict-recovery.test.ts`, using real HTTP error parsing. Expect old/generic wording to fail.
- [ ] **GREEN:** update `D/i18n/codes.ts`, `U/screens/handover-screen.ts`, `U/i18n/strings.ts`, `F/setup/recovery-hour.ts`, and `F/dashboard/{conflict-recovery.ts,conflict-recovery-strings.ts}`: explain that this operation needs this box’s own encrypted page; open this page at the box’s `https://` address and retry. Separate recovery-hour’s mixed permission/transport wording. Preserve carry-on’s existing EN/ES HTTPS remedy. Update `S/guide/en/{servers,backup-recovery}.md` and both Spanish twins with the same next step; keep section ids. Look at the refusal in EN/ES, light/dark and phone/desktop.

Run these suites plus `S/{box-host-api.join,backup-recovery-pack-api.make,recovery-start-again,setup-first-fiscal.route,setup-recovery-preparation-api,waiting-start,recovery-bookings,recovery-environment.boot}.test.ts`; preserve existing assertions. Run root `scripts/{alert-codes,errors-reachable}.test.ts`. Run unedited `S/first-fiscal-setup.e2e.test.ts` and `F/{write-path.e2e,inmutabilidad}.test.ts`; H2 excludes `computeHuella`, `registerSif`, `restoreFiscal`, hash chains and fiscal allocation. No proxy trust, forwarded-header admission or wider route policy. Remove three duplicate entries from `docs/backlog/box.md`; narrow `docs/backlog.md`’s bundle line. Normal hook/current-head CI and full permissions/transport review follow. Coordinate Lane J’s shared source-start file; second lander rebases.

**Forecast, added/removed lines:** production 95/35; tests 260/60; support 0/0; prose 100/20: 570 changed lines, within 400–650. Beyond 855 (1.5×), stop for watcher/outside opinion; explain real events behind growth, not an artificial ceiling.
